import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { mapDbError } from '@/lib/deviceRegistry'
import { normalizeWardName } from '@/lib/deviceRegistryShared'
import { BadRequest, errorResponse, guardHospitalRoute, optInt, optString, readJsonObject } from '../devices/shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/**
 * GET /api/hospitals/[code]/wards — 병동 목록 + 병동별 배치 중 기기 수·회수 누계 (§6.1 병동 탭, 로그인)
 * `{ data:[{ id, name, nameNorm, extWardCode, isActive, sortOrder, activeCount, recoveredCount, createdAt, updatedAt }], total, unassigned }`
 * 회수 누계 = 이 병동에서 나간 RECOVER 이벤트 수(from_ward_id) — 병동 개명에도 이력이 따라온다(RESTRICT FK)
 */
export async function GET(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code)
  if (!g.ok) return g.response
  const hospitalCode = g.hospital.hospitalCode
  try {
    const [wards, activeGroups, recoverGroups, unassigned] = await Promise.all([
      prisma.hospitalWard.findMany({ where: { hospitalCode }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.hospitalDevice.groupBy({ by: ['wardId'], where: { hospitalCode, status: 'ACTIVE', wardId: { not: null } }, _count: { _all: true } }),
      prisma.hospitalDeviceEvent.groupBy({ by: ['fromWardId'], where: { hospitalCode, eventType: 'RECOVER', fromWardId: { not: null } }, _count: { _all: true } }),
      prisma.hospitalDevice.count({ where: { hospitalCode, status: 'ACTIVE', wardId: null } }),
    ])
    const active = new Map(activeGroups.map((r) => [r.wardId, r._count._all]))
    const recovered = new Map(recoverGroups.map((r) => [r.fromWardId, r._count._all]))
    return NextResponse.json({
      data: wards.map((w) => ({ ...w, activeCount: active.get(w.id) ?? 0, recoveredCount: recovered.get(w.id) ?? 0 })),
      total: wards.length,
      unassigned,
    })
  } catch (e) {
    return errorResponse(e, '병동 목록 조회 중 오류가 발생했습니다.')
  }
}

/**
 * POST /api/hospitals/[code]/wards — 병동 추가 (§7.1, write) body `{ name, extWardCode?, sortOrder? }`
 * name_norm(`normalizeWardName`) 동명 409 '같은 이름의 병동이 이미 있습니다' · 온프렘 코드 중복 409. sortOrder 생략 시 마지막+1
 */
export async function POST(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code, { write: true })
  if (!g.ok) return g.response
  const { user, hospital } = g
  const hospitalCode = hospital.hospitalCode

  try {
    const body = await readJsonObject(request)
    if (!body) return NextResponse.json({ error: '요청 본문(JSON)이 올바르지 않습니다.' }, { status: 400 })
    const name = optString(body.name)
    if (!name) throw new BadRequest('병동명을 입력하세요.')
    const nameNorm = normalizeWardName(name)
    if (!nameNorm) throw new BadRequest('병동명을 입력하세요.')
    const extWardCode = optString(body.extWardCode)
    const sortOrderInput = optInt(body.sortOrder, '정렬 순서(sortOrder)')

    const dupName = await prisma.hospitalWard.findUnique({ where: { hospitalCode_nameNorm: { hospitalCode, nameNorm } }, select: { id: true, name: true } })
    if (dupName) return NextResponse.json({ error: '같은 이름의 병동이 이미 있습니다', existing: dupName }, { status: 409 })
    if (extWardCode) {
      const dupCode = await prisma.hospitalWard.findFirst({ where: { hospitalCode, extWardCode }, select: { id: true, name: true } })
      if (dupCode) return NextResponse.json({ error: `같은 온프렘 병동 코드가 이미 있습니다: ${dupCode.name}`, existing: dupCode }, { status: 409 })
    }
    let sortOrder = sortOrderInput
    if (sortOrder == null) {
      const last = await prisma.hospitalWard.aggregate({ where: { hospitalCode }, _max: { sortOrder: true } })
      sortOrder = (last._max.sortOrder ?? -1) + 1
    }

    let ward
    try {
      ward = await prisma.hospitalWard.create({ data: { hospitalCode, name, nameNorm, extWardCode, sortOrder } })
    } catch (e) {
      throw mapDbError(e) // 동시 생성 P2002 → 409 '같은 이름의 병동이 이미 있습니다'
    }

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'CREATE',
      resource: 'hospital_ward',
      resourceId: ward.id,
      resourceLabel: `${hospital.hospitalName} 병동 ${ward.name}`,
      after: ward,
    })
    return NextResponse.json({ ward }, { status: 201 })
  } catch (e) {
    return errorResponse(e, '병동 추가 중 오류가 발생했습니다.')
  }
}
