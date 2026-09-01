/**
 * 디바이스 원장 표시 헬퍼 (GROUP B 소유 — SummaryStrip · DeviceTable · DeviceHistoryDrawer · CorrectionModal 공용)
 * 순수 함수만. 날짜는 lib/deviceRegistryShared 의 toYmd 기준(@db.Date = UTC 자정 ISO), 기록 시각은 KST 표시.
 */
import { DEVICE_EVENT_TYPE_LABELS, PRODUCT_TYPE_UNSET_LABEL, toYmd, todayKst, type DeviceEventType, type ProductType, type ProductTypeContext, type UsageTypeRef } from '@/lib/deviceRegistryShared'
import type { ChangeSet, ContractedDeal, ModelSummary, WmsMatch } from './types'

/** @db.Date ISO → 'YYYY-MM-DD', 없으면 '—' */
export function ymdOrDash(v: string | null | undefined): string {
  return toYmd(v) ?? '—'
}

/** 올해면 'MM-DD', 아니면 'YYYY-MM-DD' (요약·최근 이벤트 등 좁은 셀용) */
export function fmtShortDate(v: string | null | undefined, today: string = todayKst()): string | null {
  const d = toYmd(v)
  if (!d) return null
  return d.slice(0, 4) === today.slice(0, 4) ? d.slice(5) : d
}

const KST_DT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** 타임스탬프 → KST 'YYYY-MM-DD HH:mm' */
export function fmtKstDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return KST_DT.format(d).replace(',', '')
}

/** 타임스탬프의 KST 날짜(YYYY-MM-DD) — 업무일자와 비교용(D7) */
export function kstYmd(iso: string | null | undefined): string | null {
  const s = fmtKstDateTime(iso)
  return s ? s.slice(0, 10) : null
}

/** '08-20 등록' — 최근 이벤트 셀 */
export function lastEventText(type: string | null | undefined, on: string | null | undefined, today?: string): string {
  const d = fmtShortDate(on, today)
  if (!d) return '—'
  const label = type && type in DEVICE_EVENT_TYPE_LABELS ? DEVICE_EVENT_TYPE_LABELS[type as DeviceEventType] : (type ?? '')
  return `${d} ${label}`.trim()
}

export interface WmsCell {
  text: string
  /** 페이지 단위 임시 매칭(영속 링크 아님) */
  transient: boolean
  status: string
}

/** '창고 개체' 셀 — 영속 링크 우선, 없으면 임시 매칭 '(자동 매칭)' */
/** '창고 개체' 셀 — WMS 일시 매칭만(영속 링크 없음 → 항상 '(자동 매칭)') */
export function wmsCell(wms: WmsMatch | null | undefined): WmsCell | null {
  if (wms) return { text: `${wms.inventoryName} · ${wms.status}`, transient: true, status: wms.status }
  return null
}

/** CORRECT 이벤트 changes 필드 라벨 */
export const CORRECT_FIELD_LABELS: Record<string, string> = {
  deviceInfoId: '모델',
  serialNo: '시리얼',
  serialRaw: '원문',
  macAddress: 'MAC',
  extDeviceCode: '닉네임',
  usageTypeId: '용도',
  productType: '상품유형',
}

function changeValue(field: string, v: unknown, models?: readonly ModelSummary[], usageTypes?: readonly UsageTypeRef[]): string {
  if (v === null || v === undefined || v === '') return field === 'usageTypeId' || field === 'productType' ? PRODUCT_TYPE_UNSET_LABEL : '(없음)'
  if (field === 'deviceInfoId' && models) {
    const m = models.find((x) => x.deviceInfoId === Number(v))
    if (m) return `${m.deviceName} ${m.deviceModel}`
  }
  if (field === 'usageTypeId' && usageTypes) {
    const u = usageTypes.find((x) => x.id === Number(v))
    if (u) return u.name
  }
  return String(v)
}

/** CORRECT changes → ['시리얼: A12016 → A120160', '용도: 미지정 → 평가용', …] (serialRaw는 시리얼 행에 함께 표시되므로 숨김) */
export function changeSummaryLines(changes: ChangeSet | null | undefined, models?: readonly ModelSummary[], usageTypes?: readonly UsageTypeRef[]): string[] {
  if (!changes) return []
  return Object.entries(changes)
    .filter(([field]) => field !== 'serialRaw')
    .map(([field, c]) => `${CORRECT_FIELD_LABELS[field] ?? field}: ${changeValue(field, c?.before, models, usageTypes)} → ${changeValue(field, c?.after, models, usageTypes)}`)
}

/** 상품유형 배지 톤 — 일반 default · 라이트 info(primary) · 미지정 없음 (B-22) */
export function productTypeBadgeVariant(v: ProductType | string | null | undefined): 'default' | 'primary' | null {
  if (!v) return null
  return v === '라이트' ? 'primary' : 'default'
}

/** 상품유형 옵션 라벨 — '기본값 (계약 딜 기준: 라이트)' / '기본값 (계약 딜 없음: 미지정)' / 혼합 '선택 필수 (일반·라이트 딜 혼합)' */
export function productTypeDefaultLabel(ctx: ProductTypeContext | null | undefined): string {
  if (!ctx) return '기본값 (병원 딜 기준)'
  if (ctx.mixed) return '— 선택 필수 (일반·라이트 딜 혼합) —'
  if (ctx.default) return `기본값 (계약 딜 기준: ${ctx.default})`
  return '기본값 (계약완료 딜 없음: 미지정)'
}

/** 용도 배지 톤 — 판매용 default · 평가용 warning · 미지정 없음 */
export function usageBadgeVariant(u: UsageTypeRef | null | undefined): 'default' | 'warning' | null {
  if (!u) return null
  return u.value === 'EVAL' ? 'warning' : 'default'
}

/** '1차 2025-03 40대' */
export function fmtDeal(d: ContractedDeal): string {
  const ym = d.contractDate ? (toYmd(d.contractDate) ?? '').slice(0, 7) : null
  return `${d.roundNo}차${ym ? ` ${ym}` : ''} ${d.count.toLocaleString()}대`
}

/** 모델 표시명 '심전계 MC200M-T' */
export function modelLabel(deviceName: string | null | undefined, deviceModel: string | null | undefined): string {
  return [deviceName, deviceModel].filter(Boolean).join(' ') || '—'
}

/** 차이 셀 텍스트 — '0 ✔' / '−2 ▲' / '+3 ▲' */
export function diffText(diff: number | null | undefined): string {
  if (diff === null || diff === undefined) return '—'
  if (diff === 0) return '0 ✔'
  return `${diff < 0 ? '−' : '+'}${Math.abs(diff).toLocaleString()} ▲`
}

export function pluralCount(n: number | null | undefined, unit = '대'): string {
  return n == null ? '—' : `${n.toLocaleString()}${unit}`
}
