import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { AS_CATEGORIES, AS_CATEGORY_LABELS, AS_OUTCOME_LABELS, AS_SHIP_METHOD_LABELS, type AsCategory, type AsMethod, type AsOutcome } from '@/lib/asReceiptShared'

export const dynamic = 'force-dynamic'

/**
 * AS업무 Excel 내보내기 (CX #9 — 발송 일자별 안내 메시지 발송 등에 활용)
 * 목록과 동일 필터(접수일·상태·구분·검색) + 발송일 기간(shippedFrom/To — 라인 shippedAt).
 * 행 = 기기 라인 1건 (접수 헤더 정보 반복). 최대 10,000라인.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const where: Prisma.AsReceiptWhereInput = {}

  const from = sp.get('from')
  const to = sp.get('to')
  if (from || to) {
    where.receiptDate = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) }
  }
  const statusIds = sp.getAll('statusId').map((v) => parseInt(v)).filter((v) => Number.isInteger(v))
  if (statusIds.length === 1) where.statusId = statusIds[0]
  else if (statusIds.length > 1) where.statusId = { in: statusIds }
  const category = sp.get('category')
  if (category && (AS_CATEGORIES as readonly string[]).includes(category)) where.category = category
  const hospitalCode = sp.get('hospitalCode')
  if (hospitalCode) where.hospitalCode = hospitalCode
  const q = sp.get('q')?.trim()
  if (q) {
    where.OR = [
      { asCode: { contains: q, mode: 'insensitive' } },
      { reporterName: { contains: q, mode: 'insensitive' } },
      { hospital: { hospitalName: { contains: q, mode: 'insensitive' } } },
      { items: { some: { serialNo: { contains: q.replace(/\s+/g, ''), mode: 'insensitive' } } } },
    ]
  }
  const shippedFrom = sp.get('shippedFrom')
  const shippedTo = sp.get('shippedTo')
  const shippedFilter = shippedFrom || shippedTo
    ? { shippedAt: { ...(shippedFrom ? { gte: new Date(shippedFrom) } : {}), ...(shippedTo ? { lte: new Date(shippedTo) } : {}) } }
    : null
  if (shippedFilter) where.items = { some: shippedFilter }

  const receipts = await prisma.asReceipt.findMany({
    where,
    include: {
      hospital: { select: { hospitalName: true } },
      status: { select: { name: true } },
      ticket: { select: { ticketCode: true, owner: { select: { name: true } } } },
      items: {
        select: {
          serialNo: true, deviceKind: true, wardName: true, symptom: true, processNote: true,
          outcome: true, newSerialNo: true, shipMethod: true, shipTrackingNo: true, shippedAt: true,
          device: { select: { deviceInfo: { select: { deviceName: true } }, placement: { select: { ward: { select: { name: true } } } } } },
        },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { receiptDate: 'desc' },
    take: 3000,
  })

  const d10 = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : '')
  const rows: Record<string, string>[] = []
  for (const r of receipts) {
    // 발송일 필터가 있으면 해당 기간에 발송된 라인만 출력 (안내 발송 용도)
    const items = shippedFilter
      ? r.items.filter((i) => i.shippedAt
          && (!shippedFrom || i.shippedAt >= new Date(shippedFrom))
          && (!shippedTo || i.shippedAt <= new Date(shippedTo)))
      : r.items
    for (const i of items) {
      rows.push({
        접수번호: r.asCode,
        접수일: d10(r.receiptDate),
        병원: r.hospital?.hospitalName ?? '',
        구분: AS_CATEGORY_LABELS[r.category as AsCategory] ?? r.category,
        상태: r.status?.name ?? '',
        고객명: r.reporterName ?? '',
        시리얼: i.serialNo,
        기기종류: i.device?.deviceInfo.deviceName ?? i.deviceKind ?? '',
        병동: i.device?.placement?.ward?.name ?? i.wardName ?? '',
        증상: i.symptom ?? '',
        처리내용: i.processNote ?? '',
        결과: i.outcome ? (AS_OUTCOME_LABELS[i.outcome as AsOutcome] ?? i.outcome) : '진행 중',
        발송일: d10(i.shippedAt),
        발송방법: i.shipMethod ? (AS_SHIP_METHOD_LABELS[i.shipMethod as AsMethod] ?? i.shipMethod) : '',
        송장: i.shipTrackingNo ?? '',
        교체기: i.newSerialNo ?? '',
        완료일: d10(r.resolvedAt),
        담당: r.ticket?.owner?.name ?? '',
        티켓: r.ticket?.ticketCode ?? '',
      })
      if (rows.length >= 10000) break
    }
    if (rows.length >= 10000) break
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 15 }, { wch: 11 }, { wch: 22 }, { wch: 6 }, { wch: 8 }, { wch: 18 }, { wch: 11 }, { wch: 10 },
    { wch: 10 }, { wch: 28 }, { wch: 28 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 15 }, { wch: 11 },
    { wch: 11 }, { wch: 8 }, { wch: 15 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'AS업무')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '')
  const filename = encodeURIComponent(`AS업무_${ymd}.xlsx`)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  })
}
