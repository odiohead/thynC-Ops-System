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
    statusId: intOrNull(body.statusId),
    hospitalModelId: intOrNull(body.hospitalModelId),
    seersModelId: intOrNull(body.seersModelId),
    wardsText: str(body.wardsText),
    deptsText: str(body.deptsText),
    wardCount: intOrNull(body.wardCount),
    bedCount: intOrNull(body.bedCount),
    amountProduct: parseAmount(body.amountProduct),
    amountConstruction: parseAmount(body.amountConstruction),
    amountActual: parseAmount(body.amountActual),
    taxInvoiceId: intOrNull(body.taxInvoiceId),
    settlementId: intOrNull(body.settlementId),
    contractDate: parseDateOnly(body.contractDate),
    remark: str(body.remark),
  }
}

/** StatusCode FK가 올바른 카테고리를 가리키는지 검증 — 오류 메시지 or null */
export async function validateDealCodes(data: ReturnType<typeof parseDealBody>): Promise<string | null> {
  const checks: Array<[number | null, string, string]> = [
    [data.statusId, 'SALES_DEAL_STATUS', '딜 상태'],
    [data.hospitalModelId, 'SALES_MODEL', '병원 판매모델'],
    [data.seersModelId, 'SALES_MODEL', '씨어스 판매방식'],
    [data.taxInvoiceId, 'SALES_TAX_INVOICE', '세금계산서 발행'],
    [data.settlementId, 'SALES_SETTLEMENT', '정산 상태'],
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
