import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; deviceInfoId: string } }

/**
 * 병원 × 기기 비계약 공급 수량 — upsert / 삭제 (projects/third_party_supply_design.md §6)
 * 권한: USER 등급 이상(VIEWER 불가 — 영업·운영 실무자가 대웅 자료를 바로 기입, 쟁점 1 결정).
 * 기기 `supply_tracked` 검증 — 꺼진 기기도 기존 행이 있으면 수정·삭제 허용(데이터 유실 방지).
 * 공급처는 1차 '대웅제약' 고정(body 미수신). 수량 0 = 확인했는데 없음, 행 삭제 = 파악 안 됨.
 */

async function guard(request: NextRequest, params: Params['params']) {
  const user = await getAuthUser(request)
  if (!user || !isUserOrAbove(user.role)) return { error: NextResponse.json({ error: '공급 수량 편집은 USER 등급 이상만 가능합니다.' }, { status: 403 }) }
  const deviceInfoId = Number(params.deviceInfoId)
  if (!Number.isInteger(deviceInfoId) || deviceInfoId <= 0) return { error: NextResponse.json({ error: '잘못된 기기 ID입니다.' }, { status: 400 }) }
  const [hospital, device, existing] = await Promise.all([
    prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } }),
    prisma.deviceInfo.findUnique({ where: { id: deviceInfoId }, select: { id: true, deviceName: true, deviceModel: true, supplyTracked: true } }),
    prisma.hospitalDeviceSupply.findUnique({ where: { hospitalCode_deviceInfoId: { hospitalCode: params.code, deviceInfoId } } }),
  ])
  if (!hospital) return { error: NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 }) }
  if (!device) return { error: NextResponse.json({ error: '기기를 찾을 수 없습니다.' }, { status: 404 }) }
  return { user, hospital, device, existing, deviceInfoId }
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export async function PUT(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error
  if (!g.device.supplyTracked && !g.existing) {
    return NextResponse.json({ error: `'${g.device.deviceName}'은(는) 공급 현황 관리 대상이 아닙니다. 설정 > 장비 정보에서 '공급 현황' 체크 후 입력하세요.` }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity < 0) return NextResponse.json({ error: '수량은 0 이상의 정수여야 합니다.' }, { status: 400 })
  let checkedOn: Date | null = null
  if (body.checkedOn !== undefined && body.checkedOn !== null && body.checkedOn !== '') {
    const d = new Date(String(body.checkedOn))
    if (isNaN(d.getTime())) return NextResponse.json({ error: '파악일이 올바르지 않습니다.' }, { status: 400 })
    checkedOn = d
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  const row = await prisma.hospitalDeviceSupply.upsert({
    where: { hospitalCode_deviceInfoId: { hospitalCode: params.code, deviceInfoId: g.deviceInfoId } },
    create: { hospitalCode: params.code, deviceInfoId: g.deviceInfoId, quantity, checkedOn, note, updatedById: g.user.userId },
    update: { quantity, checkedOn, note, updatedById: g.user.userId },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: g.existing ? 'UPDATE' : 'CREATE',
    resource: 'hospital_device_supply',
    resourceId: row.id,
    resourceLabel: `${g.hospital.hospitalName} / ${g.device.deviceName} / ${quantity}대`,
    before: g.existing ? { quantity: g.existing.quantity, checkedOn: ymd(g.existing.checkedOn), note: g.existing.note } : undefined,
    after: { quantity, checkedOn: ymd(checkedOn), note, supplier: row.supplier },
  })

  return NextResponse.json({ supply: { deviceInfoId: row.deviceInfoId, quantity: row.quantity, supplier: row.supplier, checkedOn: ymd(row.checkedOn), note: row.note } })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error
  if (!g.existing) return NextResponse.json({ error: '공급 수량 행이 없습니다.' }, { status: 404 })

  await prisma.hospitalDeviceSupply.delete({ where: { id: g.existing.id } })
  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'DELETE',
    resource: 'hospital_device_supply',
    resourceId: g.existing.id,
    resourceLabel: `${g.hospital.hospitalName} / ${g.device.deviceName} / ${g.existing.quantity}대`,
    before: { quantity: g.existing.quantity, checkedOn: ymd(g.existing.checkedOn), note: g.existing.note },
  })
  return NextResponse.json({ success: true })
}
