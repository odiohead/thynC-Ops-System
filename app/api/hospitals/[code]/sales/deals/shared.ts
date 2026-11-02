import { prisma } from '@/lib/prisma'
import { parseAmount, parseDateOnly } from '@/lib/sales'

/** 딜 생성/수정 공용 — body → prisma data (hospitalCode·roundNo·dealCode 제외) */

/** 상품유형 어휘 — 등록 시 필수 (2026-11-02) */
export const DEAL_PRODUCT_TYPES = ['일반', '라이트'] as const
export type DealProductType = (typeof DEAL_PRODUCT_TYPES)[number]
export const isDealProductType = (v: unknown): v is DealProductType => typeof v === 'string' && (DEAL_PRODUCT_TYPES as readonly string[]).includes(v)
export const DEAL_PRODUCT_TYPE_REQUIRED = '상품유형(일반/라이트)을 선택하세요.'
export const DEAL_DEVICES_REQUIRED = '도입 기기 수량을 1대 이상 입력하세요.'

/**
 * 도입 기기 수량 — body.devices 배열을 정제 (quantity>0 행만). 키 미전송(undefined/비배열)이면 null = 기존 값 보존(PUT).
 * 등록(POST)·딜 상세 저장은 합계 1대 이상 필수 (2026-11-02 — 분실 10%·라이트 100% 한도의 분모라 비어 있으면 AS 정책 계산 불가)
 */
export function parseDealDevices(body: Record<string, unknown>): Array<{ deviceInfoId: number; quantity: number }> | null {
  if (!Array.isArray(body.devices)) return null
  return (body.devices as Array<{ deviceId?: unknown; deviceInfoId?: unknown; quantity?: unknown }>)
    .map((d) => ({ deviceInfoId: Number(d.deviceId ?? d.deviceInfoId), quantity: Number(d.quantity) }))
    .filter((d) => Number.isInteger(d.deviceInfoId) && Number.isInteger(d.quantity) && d.quantity > 0)
}

/** 기기 마스터 존재 검증 — 오류 메시지 or null */
export async function validateDealDevices(devices: Array<{ deviceInfoId: number }>): Promise<string | null> {
  if (devices.length === 0) return null
  const found = await prisma.deviceInfo.count({ where: { id: { in: devices.map((d) => d.deviceInfoId) } } })
  return found === devices.length ? null : '기기 목록에 없는 항목이 있습니다.'
}

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
    // 상품유형 (일반/라이트) — 키 미전송 PUT은 기존 값 보존. 어휘 검증은 호출부(isDealProductType) — 등록 시 필수 (2026-11-02)
    ...(isDealProductType(body.productType) ? { productType: body.productType } : {}),
    remark: str(body.remark),
    warrantyText: str(body.warrantyText),
    firstContactDate: parseDateOnly(body.firstContactDate),
    // 대웅 축 (2026-07-31 — thynC_status_DW.xlsx 원장 + 구파일 보강)
    daewoongClientCode: str(body.daewoongClientCode),
    daewoongCountType: str(body.daewoongCountType),
    daewoongOrderStatus: str(body.daewoongOrderStatus),
    daewoongModelKind: str(body.daewoongModelKind),
    daewoongModel: str(body.daewoongModel),
    daewoongDeviceCount: intOrNull(body.daewoongDeviceCount),
    daewoongAmountTotal: parseAmount(body.daewoongAmountTotal),
    daewoongBuildDate: parseDateOnly(body.daewoongBuildDate),
    daewoongAmountProduct: parseAmount(body.daewoongAmountProduct),
    daewoongAmountConstruction: parseAmount(body.daewoongAmountConstruction),
    daewoongAmountActual: parseAmount(body.daewoongAmountActual),
    daewoongAmountService: parseAmount(body.daewoongAmountService),
    daewoongTaxInvoice: str(body.daewoongTaxInvoice),
    daewoongSettlement: str(body.daewoongSettlement),
    daewoongPriceType: str(body.daewoongPriceType),
    daewoongDivision: str(body.daewoongDivision),
    daewoongOffice: str(body.daewoongOffice),
    daewoongManager: str(body.daewoongManager),
    daewoongPhone: str(body.daewoongPhone),
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
