import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import {
  REASON_CATEGORY,
  canEditTxMeta,
  parseTxDate,
  assertQuantityEditable,
  applyQuantityDelta,
  InventoryError,
} from '@/lib/inventory'
import { txInclude } from '@/lib/inventoryQuery'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 전표 메타 정보 수정 — 관리자(ADMIN 이상)이면서 재고 담당자 풀 등록자만 (2026-07-20 권한 강화).
 * 수량 수정(2026-07-21): 비시리얼 품목만 — 변경분을 재고 버킷에 반영, 결과 음수면 409.
 *   시리얼 품목(수량=개체 수)·세트출고 부모는 금지, 품목·위치·시리얼 개체 변경도 불가 — 취소 후 재등록으로 처리.
 * 유형(reason)은 같은 시스템 동작 부류(일반↔일반, 회수↔회수, 폐기↔폐기) 내에서만 변경 허용.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !(await canEditTxMeta(user))) {
    return NextResponse.json({ error: '전표 수정은 재고 담당자로 등록된 관리자만 가능합니다.' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.inventoryTransaction.findUnique({
    where: { id },
    include: {
      reasonCode: { select: { value: true } },
      inventory: { select: { name: true, linkHospital: true } },
      item: { select: { isSerialManaged: true, isLotManaged: true } },
      warehouse: { select: { name: true } },
      toWarehouse: { select: { name: true } },
      childTxs: { select: { id: true }, where: { canceledAt: null } },
    },
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
  if (body.txDate !== undefined) {
    const parsed = parseTxDate(body.txDate)
    if (!parsed) return NextResponse.json({ error: '입출고일 형식이 잘못되었습니다. (YYYY-MM-DD)' }, { status: 400 })
    data.txDate = new Date(parsed)
  }
  if (body.lotNo !== undefined && existing.txType !== 'MOVE') {
    const newLot = String(body.lotNo ?? '').trim() || null
    // LOT 재고 차원 품목(비시리얼+LOT)은 전표 LOT가 재고 버킷 키 — 사후 수정 시 재고와 어긋나므로 금지
    if (!existing.item.isSerialManaged && existing.item.isLotManaged && newLot !== existing.lotNo) {
      return NextResponse.json(
        { error: 'LOT 재고 관리 품목의 전표 LOT는 수정할 수 없습니다. 전표를 취소 후 올바른 LOT로 재등록하세요.' },
        { status: 409 },
      )
    }
    data.lotNo = newLot
  }

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

  // 수량 수정 — 비시리얼 품목만, 변경분(delta)을 재고 버킷에 반영
  let quantityDelta = 0
  if (body.quantity !== undefined) {
    try {
      const qty = assertQuantityEditable(existing, body.quantity)
      if (qty !== existing.quantity) {
        quantityDelta = qty - existing.quantity
        data.quantity = qty
      }
    } catch (e) {
      if (e instanceof InventoryError) return NextResponse.json({ error: e.message }, { status: e.status })
      throw e
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '수정할 항목이 없습니다.' }, { status: 400 })
  }

  let updated
  try {
    updated = await prisma.$transaction(async (client) => {
      if (quantityDelta !== 0) await applyQuantityDelta(client, existing, quantityDelta)
      return client.inventoryTransaction.update({ where: { id }, data, include: txInclude })
    })
  } catch (e) {
    if (e instanceof InventoryError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

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
