/**
 * 출고요청 생성 공용 코어 (2026-11-10 — projects/as_lost_stock_out_link_design.md §4.2)
 * `POST /api/stock-out-requests`(수동 생성)와 분실 AS [출고요청](`createStockOutForAsLines`)이 같은 검증·발번·티켓 생성을 쓴다.
 *  - prepareStockOutCreate: 본문 검증 → 정규화 입력 (쓰기 없음)
 *  - createStockOutRequestIn: 레코드+라인+연결 티켓 (호출부 트랜잭션 안)
 *  - createStockOutRequest: 단독 트랜잭션 + 발번 P2002 1회 재시도
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextSorCode, validateStockOutLines } from '@/lib/stockOut'
import { isStockOutPurpose, isStockOutSalesType, STOCK_OUT_SUB_PURPOSES, stockOutTitle, type StockOutPurpose } from '@/lib/stockOutShared'
import { createTicketForStockOut } from '@/lib/ticket-domains/stockOut'

export class StockOutCreateError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.name = 'StockOutCreateError'; this.status = status }
}

export interface StockOutCreateBody {
  purpose?: unknown; requestDate?: unknown; projectCode?: unknown; subPurpose?: unknown
  destType?: unknown; destHospitalCode?: unknown; destText?: unknown; shipAddress?: unknown; recipient?: unknown
  items?: unknown; statusId?: unknown; note?: unknown
  /** 분실 AS 연동 — 접수 id (2026-11-10) */
  asReceiptId?: number | null
}

export interface StockOutCreatePrepared {
  purpose: StockOutPurpose
  requestDate: Date
  project: { projectCode: string; projectName: string; hospitalCode: string } | null
  sales: { subPurpose: string; destType: 'HOSPITAL' | 'OTHER'; destHospitalCode: string | null; destText: string | null; destHospitalName: string | null; shipAddress: string; recipient: string } | null
  items: { inventoryItemId: number; quantity: number }[]
  statusId: number | null
  statusName: string | null
  note: string | null
  title: string
  asReceiptId: number | null
}

export async function prepareStockOutCreate(body: StockOutCreateBody, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<StockOutCreatePrepared> {
  const purpose: StockOutPurpose = body.purpose === undefined || body.purpose === null ? 'BUILD' : (body.purpose as StockOutPurpose)
  if (!isStockOutPurpose(purpose)) throw new StockOutCreateError('업무 구분이 올바르지 않습니다.')
  const isSales = isStockOutSalesType(purpose)
  const requestDate = body.requestDate ? new Date(body.requestDate as string) : new Date(NaN)
  if (isNaN(requestDate.getTime())) throw new StockOutCreateError('희망 출고일을 입력하세요.')
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

  let project: StockOutCreatePrepared['project'] = null
  let sales: StockOutCreatePrepared['sales'] = null
  if (!isSales) {
    const projectCode = typeof body.projectCode === 'string' ? body.projectCode.trim() : ''
    if (!projectCode) throw new StockOutCreateError('프로젝트를 선택하세요.')
    project = await client.project.findUnique({ where: { projectCode }, select: { projectCode: true, projectName: true, hospitalCode: true } })
    if (!project) throw new StockOutCreateError('프로젝트를 찾을 수 없습니다.')
  } else {
    const options = STOCK_OUT_SUB_PURPOSES[purpose]
    const subPurpose = typeof body.subPurpose === 'string' && body.subPurpose ? body.subPurpose : options.length === 1 ? options[0].code : ''
    if (!options.some((o) => o.code === subPurpose)) throw new StockOutCreateError('목적을 선택하세요.')
    const destType = body.destType
    let destHospitalCode: string | null = null, destHospitalName: string | null = null, destText: string | null = null
    if (destType === 'HOSPITAL') {
      const code = typeof body.destHospitalCode === 'string' ? body.destHospitalCode.trim() : ''
      const h = code ? await client.hospital.findUnique({ where: { hospitalCode: code }, select: { hospitalCode: true, hospitalName: true } }) : null
      if (!h) throw new StockOutCreateError('납품처 병원을 검색해서 선택하세요.')
      destHospitalCode = h.hospitalCode; destHospitalName = h.hospitalName
    } else if (destType === 'OTHER') {
      destText = str(body.destText, 200)
      if (!destText) throw new StockOutCreateError('납품처를 입력하세요.')
    } else throw new StockOutCreateError('납품처 구분(병원/기타)을 선택하세요.')
    const shipAddress = str(body.shipAddress, 500)
    if (!shipAddress) throw new StockOutCreateError('수령지를 입력하세요.')
    const recipient = str(body.recipient, 100)
    if (!recipient) throw new StockOutCreateError('수취인을 입력하세요.')
    sales = { subPurpose, destType, destHospitalCode, destText, destHospitalName, shipAddress, recipient }
  }

  let items: { inventoryItemId: number; quantity: number }[]
  try { items = await validateStockOutLines(body.items, purpose) } catch (e) { throw new StockOutCreateError((e as Error).message) }

  let statusId: number | null = null
  if (body.statusId !== undefined && body.statusId !== null && body.statusId !== '') {
    const sid = Number(body.statusId)
    const row = Number.isInteger(sid) ? await client.statusCode.findFirst({ where: { id: sid, category: 'STOCK_OUT_STATUS' }, select: { id: true } }) : null
    if (!row) throw new StockOutCreateError('상태가 올바르지 않습니다.')
    statusId = row.id
  } else {
    const req = await client.statusCode.findFirst({ where: { category: 'STOCK_OUT_STATUS', name: '요청' }, select: { id: true } })
    statusId = req?.id ?? null
  }
  const statusRow = statusId ? await client.statusCode.findUnique({ where: { id: statusId }, select: { name: true } }) : null
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
  const title = stockOutTitle({ purpose, subPurpose: sales?.subPurpose, project, destType: sales?.destType, destText: sales?.destText, destHospital: sales?.destHospitalName ? { hospitalName: sales.destHospitalName } : null })
  const asReceiptId = Number.isInteger(body.asReceiptId) ? (body.asReceiptId as number) : null
  return { purpose, requestDate, project, sales, items, statusId, statusName: statusRow?.name ?? null, note, title, asReceiptId }
}

/** 레코드 + 라인 + 연결 티켓 — 호출부 트랜잭션 안에서 (티켓 없는 출고요청을 만들지 않는다) */
export async function createStockOutRequestIn(tx: Prisma.TransactionClient, p: StockOutCreatePrepared, actor: { userId: string; name: string | null }): Promise<{ id: number; sorCode: string; ticketId: number; title: string }> {
  const sor = await tx.stockOutRequest.create({
    data: {
      sorCode: await nextSorCode(tx),
      projectCode: p.project?.projectCode ?? null,
      purpose: p.purpose,
      ...(p.sales ? { subPurpose: p.sales.subPurpose, destType: p.sales.destType, destHospitalCode: p.sales.destHospitalCode, destText: p.sales.destText, shipAddress: p.sales.shipAddress, recipient: p.sales.recipient } : {}),
      statusId: p.statusId,
      requestDate: p.requestDate,
      note: p.note,
      createdById: actor.userId,
      asReceiptId: p.asReceiptId,
    },
  })
  await tx.stockOutRequestItem.createMany({ data: p.items.map((l) => ({ requestId: sor.id, ...l })) })
  const ticketId = await createTicketForStockOut(tx, {
    id: sor.id, sorCode: sor.sorCode, title: p.title,
    hospitalCode: p.project?.hospitalCode ?? p.sales?.destHospitalCode ?? null,
    statusName: p.statusName, statusId: sor.statusId, note: sor.note, requestDate: sor.requestDate, resolvedAt: null, createdAt: sor.createdAt,
  }, actor.userId, 'domain')
  return { id: sor.id, sorCode: sor.sorCode, ticketId, title: p.title }
}

/** 단독 생성 — 발번 P2002 1회 재시도 */
export async function createStockOutRequest(body: StockOutCreateBody, actor: { userId: string; name: string | null }): Promise<{ id: number; sorCode: string; ticketId: number; title: string }> {
  const prepared = await prepareStockOutCreate(body)
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction((tx) => createStockOutRequestIn(tx, prepared, actor))
    } catch (err) {
      if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
}
