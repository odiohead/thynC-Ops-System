import { prisma } from '@/lib/prisma'
import { parseAmount, parseDateOnly } from '@/lib/sales'

/** 딜 생성/수정 공용 — body → prisma data (hospitalCode·roundNo·dealCode 제외) */

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const intOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v))
  return Number.isInteger(n) && n >= 0 ? n : null
}

export function parseDealBody(body: Record<string, unknown>) {
  return {
    projectCode: str(body.projectCode),
    hospitalSaleModelId: intOrNull(body.hospitalSaleModelId),
    seersSaleModelId: intOrNull(body.seersSaleModelId),
    wardCount: intOrNull(body.wardCount),
    bedCount: intOrNull(body.bedCount),
    wardsText: str(body.wardsText),
    deptsText: str(body.deptsText),
    amountProduct: parseAmount(body.amountProduct),
    amountConstruction: parseAmount(body.amountConstruction),
    amountTotal: parseAmount(body.amountTotal),
    amountService: parseAmount(body.amountService),
    amountActual: parseAmount(body.amountActual),
    priceTypeId: intOrNull(body.priceTypeId),
    firstContactDate: parseDateOnly(body.firstContactDate),
    contractDate: parseDateOnly(body.contractDate),
    deliveryDate: parseDateOnly(body.deliveryDate),
    warrantyMonths: intOrNull(body.warrantyMonths),
    settlementStatusId: intOrNull(body.settlementStatusId),
    taxInvoiceStatusId: intOrNull(body.taxInvoiceStatusId),
    revenueRecognitionId: intOrNull(body.revenueRecognitionId),
    remark: str(body.remark),
  }
}

/** StatusCode FK가 올바른 영업 카테고리를 가리키는지 검증 — 오류 메시지 or null */
export async function validateDealCodes(data: ReturnType<typeof parseDealBody>): Promise<string | null> {
  const checks: Array<[number | null, string, string]> = [
    [data.hospitalSaleModelId, 'SALES_MODEL_HOSPITAL', '병원 판매모델'],
    [data.seersSaleModelId, 'SALES_MODEL_SEERS', '씨어스 판매방식'],
    [data.priceTypeId, 'SALES_PRICE_TYPE', '판매가 유형'],
    [data.settlementStatusId, 'SALES_SETTLEMENT', '정산 상태'],
    [data.taxInvoiceStatusId, 'SALES_TAX_INVOICE', '세금계산서 발행'],
    [data.revenueRecognitionId, 'SALES_REVENUE_RECOG', '매출 인식'],
  ]
  const ids = checks.map(([id]) => id).filter((id): id is number => id !== null)
  if (ids.length === 0) return null
  const codes = await prisma.statusCode.findMany({ where: { id: { in: ids } }, select: { id: true, category: true } })
  const map = new Map(codes.map((c) => [c.id, c.category]))
  for (const [id, category, label] of checks) {
    if (id !== null && map.get(id) !== category) return `${label} 값이 올바르지 않습니다.`
  }
  return null
}

/** 디바이스 배열 정규화 — 유효 항목만 (수량 1 이상, 중복 디바이스 제거) */
export function parseDealDevices(raw: unknown): Array<{ deviceInfoId: number; quantity: number; unitPrice: bigint | null }> {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: Array<{ deviceInfoId: number; quantity: number; unitPrice: bigint | null }> = []
  for (const r of raw) {
    const deviceInfoId = intOrNull((r as Record<string, unknown>)?.deviceInfoId)
    const quantity = intOrNull((r as Record<string, unknown>)?.quantity)
    if (deviceInfoId === null || quantity === null || quantity <= 0 || seen.has(deviceInfoId)) continue
    seen.add(deviceInfoId)
    out.push({ deviceInfoId, quantity, unitPrice: parseAmount((r as Record<string, unknown>)?.unitPrice) })
  }
  return out
}
