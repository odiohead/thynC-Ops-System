import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { canManageStock } from '@/lib/inventory'
import { buildLedger, listLedgerModels } from '@/lib/udiLedger'

export const dynamic = 'force-dynamic'

function parseInventoryIds(sp: URLSearchParams): number[] | undefined {
  const raw = sp.get('inventoryIds')
  if (!raw) return undefined
  const ids = raw.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n))
  return ids.length ? ids : undefined
}

// GET — 모델 목록(modelName 없을 때) 또는 해당 모델의 대장 데이터
//
// 문서 1부 = 모델 1종. 내용은 UDI × LOT 단위 행으로 구성된다.
// 대장은 GMP 품질기록 산출물이므로 일반 조회보다 권한을 상향한다(관리자 또는 재고 담당자).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await canManageStock(user))) {
    return NextResponse.json(
      { error: '입출고대장 조회 권한이 없습니다. (재고 담당자 또는 관리자만 가능)' },
      { status: 403 },
    )
  }

  const sp = new URL(req.url).searchParams
  const inventoryIds = parseInventoryIds(sp)
  const modelName = sp.get('modelName')

  if (!modelName) {
    return NextResponse.json({ models: await listLedgerModels(inventoryIds) })
  }

  const ledger = await buildLedger({
    modelName,
    inventoryIds,
    from: sp.get('from'),
    to: sp.get('to'),
  })
  if (!ledger) {
    return NextResponse.json({ error: 'UDI가 등록된 품목이 없는 모델입니다.' }, { status: 404 })
  }

  return NextResponse.json({ ledger })
}
