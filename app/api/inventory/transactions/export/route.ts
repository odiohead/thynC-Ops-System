import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { txInclude, buildTxWhere } from '@/lib/inventoryQuery'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = { IN: '입고', OUT: '출고', MOVE: '이동', TRANSFER: '이관(구)' }

/** 입출고 내역 Excel export — 이력 화면과 동일한 필터 적용 (최대 10,000행) */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const where = buildTxWhere(searchParams)

  const txs = await prisma.inventoryTransaction.findMany({
    where,
    include: txInclude,
    orderBy: { createdAt: 'desc' },
    take: 10000,
  })

  const rows = txs.map((tx) => ({
    전표코드: tx.txCode,
    입출고일: tx.txDate.toISOString().slice(0, 10),
    처리일시: new Date(tx.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    유형: TYPE_LABEL[tx.txType] ?? tx.txType,
    입출고유형: tx.txType === 'MOVE' ? '이동' : tx.txType === 'TRANSFER' ? '이관(구)' : (tx.reasonCode?.name ?? ''),
    품목코드: tx.item.itemCode,
    품목명: tx.item.name,
    수량: tx.quantity,
    단위: tx.item.unit,
    인벤토리: tx.inventory.name + (tx.toInventory ? ` → ${tx.toInventory.name}` : ''),
    이관일자: tx.transferDate ? new Date(tx.transferDate).toISOString().slice(0, 10) : '',
    이관단가: tx.transferPrice ?? '',
    위치: tx.warehouse.name + (tx.toWarehouse ? ` → ${tx.toWarehouse.name}` : ''),
    LOT: tx.lotNo ?? '',
    요청자: tx.requester ?? '',
    출고처: tx.destination ?? '',
    병원: tx.hospital?.hospitalName ?? '',
    업무코드: tx.refCode ?? '',
    세트출고: tx.parentTx ? `부자재 (${tx.parentTx.txCode})` : tx.childTxs.length > 0 ? `주자재 (부자재 ${tx.childTxs.length}종)` : '',
    처리자: tx.actor?.name ?? '',
    비고: tx.note ?? '',
    취소: tx.canceledAt ? `취소됨 (${tx.canceledBy?.name ?? ''})` : '',
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 15 }, { wch: 20 }, { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 24 }, { wch: 6 }, { wch: 6 },
    { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 8 }, { wch: 20 }, { wch: 14 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '입출고내역')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const filename = encodeURIComponent(`입출고내역_${ymd}.xlsx`)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  })
}
