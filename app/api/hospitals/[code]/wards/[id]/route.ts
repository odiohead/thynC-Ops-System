import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { mapDbError } from '@/lib/deviceRegistry'
import { normalizeWardName } from '@/lib/deviceRegistryShared'
import { BadRequest, errorResponse, guardHospitalRoute, optBoolean, optInt, optString, readJsonObject } from '../../devices/shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; id: string } }

function parseWardId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * PUT /api/hospitals/[code]/wards/[id] — 병동 수정 (§7.1, write · 비활성은 admin)
 * body `{ name?, extWardCode?, sortOrder?, isActive? }` — `hospitalCode`는 받지 않는다(복합 FK ON UPDATE CASCADE — §5.6, 일괄 이전 전용 경로)
 * isActive=false: admin + 배치 중 기기 0대(아니면 409). 동명·온프렘 코드 중복 409. 개명은 이력 표시에 즉시 반영(같은 실체)
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code, { write: true })
  if (!g.ok) return g.response
  const { user, hospital } = g
  const hospitalCode = hospital.hospitalCode

  const id = parseWardId(params.id)
  if (id == null) return NextResponse.json({ error: '잘못된 병동 ID입니다.' }, { status: 400 })
  const before = await prisma.hospitalWard.findFirst({ where: { id, hospitalCode } })
  if (!before) return NextResponse.json({ error: '병동을 찾을 수 없습니다.' }, { status: 404 })

  try {
    const body = await readJsonObject(request)
    if (!body) return NextResponse.json({ error: '요청 본문(JSON)이 올바르지 않습니다.' }, { status: 400 })
    if (body.hospitalCode !== undefined) throw new BadRequest('병동의 소속 병원(hospitalCode)은 변경할 수 없습니다.')

    const data: { name?: string; nameNorm?: string; extWardCode?: string | null; sortOrder?: number; isActive?: boolean } = {}

    if (body.name !== undefined) {
      const name = optString(body.name)
      if (!name) throw new BadRequest('병동명을 입력하세요.')
      const nameNorm = normalizeWardName(name)
      if (!nameNorm) throw new BadRequest('병동명을 입력하세요.')
      if (nameNorm !== before.nameNorm) {
        const dup = await prisma.hospitalWard.findUnique({ where: { hospitalCode_nameNorm: { hospitalCode, nameNorm } }, select: { id: true, name: true } })
        if (dup && dup.id !== id) return NextResponse.json({ error: '같은 이름의 병동이 이미 있습니다', existing: dup }, { status: 409 })
      }
      data.name = name
      data.nameNorm = nameNorm
    }
    if (body.extWardCode !== undefined) {
      const extWardCode = optString(body.extWardCode)
      if (extWardCode && extWardCode !== before.extWardCode) {
        const dup = await prisma.hospitalWard.findFirst({ where: { hospitalCode, extWardCode, NOT: { id } }, select: { id: true, name: true } })
        if (dup) return NextResponse.json({ error: `같은 온프렘 병동 코드가 이미 있습니다: ${dup.name}`, existing: dup }, { status: 409 })
      }
      data.extWardCode = extWardCode
    }
    if (body.sortOrder !== undefined) {
      const sortOrder = optInt(body.sortOrder, '정렬 순서(sortOrder)')
      if (sortOrder == null) throw new BadRequest('정렬 순서(sortOrder)가 올바르지 않습니다.')
      data.sortOrder = sortOrder
    }
    if (body.isActive !== undefined) {
      const isActive = optBoolean(body.isActive, '활성 여부(isActive)')
      if (isActive == null) throw new BadRequest('활성 여부(isActive)가 올바르지 않습니다.')
      if (!isActive) {
        // 비활성(폐병동)은 admin + 배치 중 기기 0대 (§6.1 병동 탭 [비활성](admin, 배치 0))
        const denial = await checkDeviceRegistryAccess(user, { admin: true })
        if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })
        if (before.isActive) {
          const activeCount = await prisma.hospitalDevice.count({ where: { wardId: id, hospitalCode, status: 'ACTIVE' } })
          if (activeCount > 0) {
            return NextResponse.json({ error: `배치 중인 기기 ${activeCount}대가 있어 비활성화할 수 없습니다 — 먼저 다른 병동으로 이동하세요.`, activeCount }, { status: 409 })
          }
        }
      }
      data.isActive = isActive
    }
    if (Object.keys(data).length === 0) throw new BadRequest('변경할 항목이 없습니다.')

    let ward
    try {
      ward = await prisma.hospitalWard.update({ where: { id }, data })
    } catch (e) {
      throw mapDbError(e)
    }

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_ward',
      resourceId: id,
      resourceLabel: `${hospital.hospitalName} 병동 ${ward.name}`,
      before,
      after: ward,
    })
    return NextResponse.json({ ward })
  } catch (e) {
    return errorResponse(e, '병동 수정 중 오류가 발생했습니다.')
  }
}

/**
 * DELETE /api/hospitals/[code]/wards/[id] — 병동 삭제 (§7.1, admin) — 기기·이벤트 참조가 있으면 409(비활성 처리 안내)
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code, { admin: true })
  if (!g.ok) return g.response
  const { user, hospital } = g
  const hospitalCode = hospital.hospitalCode

  const id = parseWardId(params.id)
  if (id == null) return NextResponse.json({ error: '잘못된 병동 ID입니다.' }, { status: 400 })
  const before = await prisma.hospitalWard.findFirst({ where: { id, hospitalCode } })
  if (!before) return NextResponse.json({ error: '병동을 찾을 수 없습니다.' }, { status: 404 })

  try {
    const [deviceCount, eventCount] = await Promise.all([
      prisma.hospitalDevice.count({ where: { wardId: id } }),
      prisma.hospitalDeviceEvent.count({ where: { OR: [{ fromWardId: id }, { toWardId: id }] } }),
    ])
    if (deviceCount > 0 || eventCount > 0) {
      return NextResponse.json(
        { error: `이 병동을 참조하는 기기 ${deviceCount}대·이력 ${eventCount}건이 있어 삭제할 수 없습니다 — 대신 비활성 처리하세요.`, deviceCount, eventCount },
        { status: 409 }
      )
    }
    try {
      await prisma.hospitalWard.delete({ where: { id } })
    } catch (e) {
      throw mapDbError(e) // 경합 참조 P2003 → 409
    }

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'DELETE',
      resource: 'hospital_ward',
      resourceId: id,
      resourceLabel: `${hospital.hospitalName} 병동 ${before.name}`,
      before,
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    return errorResponse(e, '병동 삭제 중 오류가 발생했습니다.')
  }
}
