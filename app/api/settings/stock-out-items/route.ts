/**
 * 출고 품목 노출 설정 — 조회 (projects/stock_out_v2_design.md §6)
 * 품목 소스 = 자재관리 품목(inventory_items, 인벤토리×품목 행). 체크 상태는 stock_out_item_purposes.
 * GET            : 활성 품목 전체 + 각 품목의 purposes (설정 화면 — 로그인 전원 조회 가능, 쓰기는 ADMIN)
 * GET ?purpose=  : 해당 업무에 체크된 활성 품목만 (출고요청 폼용)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { isStockOutPurpose } from '@/lib/stockOutShared'

export const dynamic = 'force-dynamic'

export interface StockOutItemOption {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  categoryName: string | null
  isSerialManaged: boolean
  isLotManaged: boolean
  stockTotal: number
  purposes: string[]
  /** 이 품목 1개에 포함되는 부자재(출고요청 구성 안내 — stock_out_item_components) */
  components: { childItemId: number; childName: string; quantity: number }[]
}
export interface StockOutInventoryGroup {
  id: number
  name: string
  items: StockOutItemOption[]
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const purposeParam = request.nextUrl.searchParams.get('purpose')
  if (purposeParam && !isStockOutPurpose(purposeParam)) return NextResponse.json({ error: '업무 구분이 올바르지 않습니다.' }, { status: 400 })

  const items = await prisma.inventoryItem.findMany({
    where: {
      isActive: true,
      inventory: { isActive: true },
      stockOutKind: { is: null }, // 시스템 구성품 종류는 직접 요청 품목이 아님 — 목록에서 제외 (2026-11-12)
      ...(purposeParam ? { stockOutPurposes: { some: { purpose: purposeParam } } } : {}),
    },
    select: {
      id: true, itemCode: true, name: true, modelName: true, isSerialManaged: true, isLotManaged: true,
      inventory: { select: { id: true, name: true, sortOrder: true } },
      category: { select: { name: true, sortOrder: true } },
      stockOutPurposes: { select: { purpose: true } },
      // 시스템 구성 — 구성품 종류로 등록된 것만, 수량 0(미포함)은 제외 (2026-11-12)
      stockOutComponents: { where: { quantity: { gt: 0 }, child: { stockOutKind: { isNot: null } } }, select: { childItemId: true, quantity: true, child: { select: { name: true } } }, orderBy: { sortOrder: 'asc' } },
      stocks: { select: { quantity: true } },
    },
    orderBy: [{ inventory: { sortOrder: 'asc' } }, { inventory: { id: 'asc' } }, { category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { id: 'asc' }],
  })

  const groups: StockOutInventoryGroup[] = []
  for (const it of items) {
    let g = groups.find((x) => x.id === it.inventory.id)
    if (!g) { g = { id: it.inventory.id, name: it.inventory.name, items: [] }; groups.push(g) }
    g.items.push({
      id: it.id, itemCode: it.itemCode, name: it.name, modelName: it.modelName,
      categoryName: it.category?.name ?? null, isSerialManaged: it.isSerialManaged, isLotManaged: it.isLotManaged,
      stockTotal: it.stocks.reduce((s, b) => s + b.quantity, 0),
      purposes: it.stockOutPurposes.map((p) => p.purpose),
      components: it.stockOutComponents.map((c) => ({ childItemId: c.childItemId, childName: c.child.name, quantity: c.quantity })),
    })
  }
  // 시스템 구성품 종류(고정 목록) — 출고요청 팝업의 '시스템 구성품'·'미출고 수량' 섹션 (2026-11-12)
  const kinds = await prisma.stockOutComponentKind.findMany({ select: { itemId: true, item: { select: { name: true } } }, orderBy: [{ sortOrder: 'asc' }, { itemId: 'asc' }] })
  return NextResponse.json({ inventories: groups, componentKinds: kinds.map((k) => ({ itemId: k.itemId, name: k.item.name })) })
}
