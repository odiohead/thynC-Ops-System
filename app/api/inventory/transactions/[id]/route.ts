import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { REASON_CATEGORY } from '@/lib/inventory'
import { txInclude } from '@/lib/inventoryQuery'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 전표 메타 정보 수정 (ADMIN 이상).
 * 수량·품목·위치·시리얼 개체는 재고 스냅샷과 얽혀 있어 수정 불가 — 취소 후 재등록으로 처리.
 * 유형(reason)은 같은 시스템 동작 부류(일반↔일반, 회수↔회수, 폐기↔폐기) 내에서만 변경 허용.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '전표 수정은 관리자만 가능합니다.' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.inventoryTransaction.findUnique({
    where: { id },
    include: { reasonCode: { select: { value: true } }, inventory: { select: { name: true, linkHospital: true } } },
  })
  if (!existing) return NextResponse.json({ error: '전표를 찾을 수 없습니다.' }, { status: 404 })
  if (existing.canceledAt) return NextResponse.json({ error: '취소된 전표는 수정할 수 없습니다.' }, { status: 409 })
  if (existing.txType === 'TRANSFER') {
    return NextResponse.json({ error: '과거 이관 전표는 수정할 수 없습니다.' }, { status: 409 })
  }

  const body = await request.json()
  const data: Record<string, unknown> = {}

  // 유형 변경 — IN/OUT만, 같은 카테고리 + 같은 시스템 동작 값(RETURN/DISPOSE/일반)만 허용
  if (body.reasonId !== undefined) {
    if (existing.txType === 'MOVE') {
      return NextResponse.json({ error: '이동 전표에는 유형이 없습니다.' }, { status: 400 })
    }
    const reason = await prisma.statusCode.findUnique({ where: { id: Number(body.reasonId) } })
    if (!reason || reason.category !== REASON_CATEGORY[existing.txType as 'IN' | 'OUT']) {
      return NextResponse.json({ error: '전표 유형에 맞지 않는 입출고 유형입니다.' }, { status: 400 })
    }
    if ((reason.value ?? null) !== (existing.reasonCode?.value ?? null)) {
      return NextResponse.json(
        { error: '회수·폐기 등 시스템 동작이 다른 유형으로는 변경할 수 없습니다. 전표를 취소 후 재등록하세요.' },
        { status: 409 },
      )
    }
    data.reasonId = reason.id
  }

  if (body.requester !== undefined) {
    const requester = String(body.requester ?? '').trim() || null
    if (existing.txType === 'OUT' && !requester) {
      return NextResponse.json({ error: '출고 전표의 요청자는 비울 수 없습니다.' }, { status: 400 })
    }
    data.requester = requester
  }
  if (body.note !== undefined) data.note = String(body.note ?? '').trim() || null
  if (body.lotNo !== undefined && existing.txType !== 'MOVE') data.lotNo = String(body.lotNo ?? '').trim() || null

  // OUT 전용 메타
  if (existing.txType === 'OUT') {
    if (body.destination !== undefined) data.destination = String(body.destination ?? '').trim() || null
    if (body.hospitalCode !== undefined) {
      const hospitalCode = body.hospitalCode ? String(body.hospitalCode) : null
      if (hospitalCode) {
        if (!existing.inventory?.linkHospital) {
          return NextResponse.json({ error: `병원 연결은 '${existing.inventory?.name}'에서 지원하지 않습니다.` }, { status: 400 })
        }
        const h = await prisma.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true } })
        if (!h) return NextResponse.json({ error: '연결할 병원을 찾을 수 없습니다.' }, { status: 404 })
      }
      data.hospitalCode = hospitalCode
      if (!hospitalCode) { data.workType = null; data.refCode = null }
    }
    if (body.workType !== undefined) data.workType = body.workType ? String(body.workType) : null
    if (body.refCode !== undefined) data.refCode = body.refCode ? String(body.refCode) : null
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '수정할 항목이 없습니다.' }, { status: 400 })
  }

  const updated = await prisma.inventoryTransaction.update({ where: { id }, data, include: txInclude })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'inventory_tx',
    resourceId: id,
    resourceLabel: `${existing.txCode} 메타 수정`,
    before: existing,
    after: updated,
  })

  return NextResponse.json({ transaction: updated })
}
