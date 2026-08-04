/**
 * 품목 UDI 정보 (projects/inventory_udi_ledger_design.md — 2026-08-04 설계 정정)
 *
 * UDI-DI는 **품목(inventory_items) 속성**이다.
 * 같은 모델이라도 사양·포장 변경으로 UDI가 바뀌면 신규 품목으로 분리해 관리하며,
 * 그 결과 재고 버킷(품목×위치×인벤토리×LOT)이 곧 UDI × LOT 단위가 된다.
 *
 * 인벤토리별로 품목이 분리되어 있으므로 같은 UDI 값이 복수 품목에 중복 존재한다(정상).
 */

/** 품명 구분 — 대장 헤더 '품 명' 칸 */
export const PRODUCT_CLASSES = ['완제품', '반제품', '원자재'] as const

/** create/update 입력에 그대로 펼쳐 넣을 수 있는 스칼라 필드 집합 */
export type ItemUdiFields = {
  udiDi?: string | null
  ledgerName?: string | null
  productClass?: string | null
  materialNo?: string | null
  packUnit?: string
}

/**
 * 품목 UDI 필드의 부분 갱신 데이터 생성.
 * body에 키가 있을 때만 갱신해, UDI를 다루지 않는 기존 PUT이 값을 지우지 않도록 한다.
 */
export function buildItemUdiUpdate(body: Record<string, unknown>): ItemUdiFields {
  const data: ItemUdiFields = {}
  const text = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s === '' ? null : s
  }

  if ('udiDi' in body) data.udiDi = text(body.udiDi)
  if ('ledgerName' in body) data.ledgerName = text(body.ledgerName)
  if ('materialNo' in body) data.materialNo = text(body.materialNo)
  if ('productClass' in body) {
    const v = text(body.productClass)
    data.productClass = v && (PRODUCT_CLASSES as readonly string[]).includes(v) ? v : null
  }
  if ('packUnit' in body) data.packUnit = text(body.packUnit) ?? 'EA'

  return data
}

/** UDI-DI 형식 검증 — GS1 GTIN(숫자) 또는 자유 형식 허용, 공백·비허용 문자 차단 */
export function validateUdiDi(udiDi: unknown): string | null {
  if (udiDi === null || udiDi === undefined || udiDi === '') return null
  if (typeof udiDi !== 'string') return 'UDI-DI 형식이 올바르지 않습니다.'
  const v = udiDi.trim()
  if (v === '') return null
  if (!/^[A-Za-z0-9()+._/-]+$/.test(v)) return 'UDI-DI에 사용할 수 없는 문자가 포함되어 있습니다.'
  if (v.length > 50) return 'UDI-DI는 50자를 넘을 수 없습니다.'
  return null
}

/** 대장에 표기할 상품명 — 표기명 미입력 시 모델명, 그것도 없으면 품목명 */
export function ledgerDisplayName(item: {
  ledgerName: string | null
  modelName: string | null
  name: string
}): string {
  return item.ledgerName?.trim() || item.modelName?.trim() || item.name
}

/**
 * GS1 GTIN 체크디지트 검증 — 숫자만으로 이루어진 값에만 적용.
 * 잘못 입력한 UDI가 품질기록에 박히는 것을 막기 위한 경고용(저장은 막지 않는다).
 */
export function isValidGtin(udiDi: string): boolean | null {
  const v = udiDi.trim()
  if (!/^\d{8}$|^\d{12,14}$/.test(v)) return null // GTIN 형식이 아니면 판정하지 않음
  const digits = v.split('').map(Number)
  const check = digits.pop()!
  let sum = 0
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1) })
  return (10 - (sum % 10)) % 10 === check
}
