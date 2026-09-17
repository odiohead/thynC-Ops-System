/**
 * 디바이스 원장 표시 헬퍼 (GROUP B 소유 — SummaryStrip · DeviceTable · DeviceHistoryDrawer · CorrectionModal 공용)
 * 순수 함수만. 날짜는 lib/deviceRegistryShared 의 toYmd 기준(@db.Date = UTC 자정 ISO), 기록 시각은 KST 표시.
 */
import {
  DEVICE_EVENT_TYPE_LABELS,
  DEVICE_SITE_FALLBACK_LABELS,
  LOCATION_NONE_LABEL,
  PRODUCT_TYPE_UNSET_LABEL,
  deviceConditionLabel,
  deviceSiteLabel,
  isDeviceSiteValue,
  toYmd,
  todayKst,
  unitStateChangesOf,
  type DeviceEventType,
  type DeviceLocationSnapshot,
  type ProductType,
  type ProductTypeContext,
  type UsageTypeRef,
} from '@/lib/deviceRegistryShared'
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

/** CORRECT 이벤트 changes 필드 라벨 — condition/location(2026-09-17 상태·위치 축)은 `unitStateChangeLines`가 문장화한다 */
export const CORRECT_FIELD_LABELS: Record<string, string> = {
  deviceInfoId: '모델',
  serialNo: '시리얼',
  serialRaw: '원문',
  macAddress: 'MAC',
  extDeviceCode: '닉네임',
  usageTypeId: '용도',
  productType: '상품유형',
  dealCode: '계약건',
  condition: '기기 상태',
  location: '위치',
}

/** 스냅샷 키 — 일반 필드 루프에서 제외하고 문장화 헬퍼로 넘긴다 */
const UNIT_STATE_CHANGE_KEYS: readonly string[] = ['condition', 'location']

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

/**
 * CORRECT changes → ['시리얼: A12016 → A120160', '용도: 미지정 → 평가용', '기기 상태: 수리완료 → AS접수', …]
 * (serialRaw는 시리얼 행에 함께 표시되므로 숨김. condition/location 키는 `unitStateChangeLines` 문장화 — 값이 같으면 생략)
 */
export function changeSummaryLines(changes: ChangeSet | null | undefined, models?: readonly ModelSummary[], usageTypes?: readonly UsageTypeRef[], hospitalNames?: HospitalNameMap): string[] {
  if (!changes) return []
  const plain = Object.entries(changes)
    .filter(([field]) => field !== 'serialRaw' && !UNIT_STATE_CHANGE_KEYS.includes(field))
    .map(([field, c]) => `${CORRECT_FIELD_LABELS[field] ?? field}: ${changeValue(field, c?.before, models, usageTypes)} → ${changeValue(field, c?.after, models, usageTypes)}`)
  return [...plain, ...unitStateChangeLines(changes, { hospitalNames })]
}

// ─────────────────────────────────────────────────────────────────────────────
// 기기 상태(condition) · 위치(location) — 2026-09-17 device_condition_location_design.md §5.3·§6.2
// 문장화 헬퍼 단일 소스: changeSummaryLines · DeviceHistoryDrawer EventSummary · groupd-shared eventContent · 이벤트 export · PATCH 감사 라벨이 공유
// ─────────────────────────────────────────────────────────────────────────────

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'outline'

/** 기기 상태 배지 톤 — 사용중 success · AS접수 warning · 수리완료 primary · 출고 전 outline · 분실 destructive · 폐기·미확인(NULL) default(gray) */
export function conditionBadgeVariant(condition: string | null | undefined): BadgeVariant {
  switch (condition) {
    case 'IN_USE':
      return 'success'
    case 'AS_WAITING':
      return 'warning'
    case 'REPAIRED':
      return 'primary'
    case 'PRE_SHIP':
      return 'outline'
    case 'LOST':
      return 'destructive'
    default:
      return 'default'
  }
}

/** 병원 코드 → 병원명 해석용(이벤트 스냅샷은 코드만 싣는다). 없으면 '병원 {코드}'로 표시 */
export type HospitalNameMap = ReadonlyMap<string, string> | Readonly<Record<string, string>> | null | undefined

function hospitalNameOf(code: string, names?: HospitalNameMap): string | null {
  if (!names) return null
  if (names instanceof Map) return names.get(code) ?? null
  return (names as Record<string, string>)[code] ?? null
}

/** 유닛 행의 위치 필드(UnitView 평탄화 형상) — 목록·드로어·export 공용 입력 */
export interface LocationSource {
  locationHospitalCode?: string | null
  locationHospitalName?: string | null
  locationSiteValue?: string | null
  locationSite?: { name?: string | null; value?: string | null } | null
}

export function locationKindOf(u: LocationSource): 'HOSPITAL' | 'SITE' | null {
  if (u.locationHospitalCode) return 'HOSPITAL'
  if (u.locationSite || u.locationSiteValue) return 'SITE'
  return null
}

/** 위치 표시 — 병원명(없으면 코드) / 거점 마스터 name(없으면 value 폴백 리프레시센터·thynC Connected Hub) / '—' */
export function locationText(u: LocationSource): string {
  if (u.locationHospitalCode) return u.locationHospitalName || u.locationHospitalCode
  const site = deviceSiteLabel(u.locationSite ?? u.locationSiteValue ?? null)
  return site ?? LOCATION_NONE_LABEL
}

/** 스냅샷 위치 값 → 문구: '병원 세란병원'(names 없으면 '병원 A123') / '리프레시센터' / '없음' */
export function locationSnapshotText(loc: DeviceLocationSnapshot | null | undefined, hospitalNames?: HospitalNameMap): string {
  if (!loc || !loc.kind || !loc.code) return '없음'
  if (loc.kind === 'HOSPITAL') return `병원 ${hospitalNameOf(loc.code, hospitalNames) ?? loc.code}`
  return isDeviceSiteValue(loc.code) ? DEVICE_SITE_FALLBACK_LABELS[loc.code] : loc.code
}

/**
 * 스냅샷 changes → 상태·위치 변경 문장. 기본은 값이 바뀐 축만('기기 상태: 사용중 → AS접수', '위치: 병원 A → 리프레시센터 (입고 미확인)'),
 * `includeUnchanged`면 둘 다. 스냅샷이 없으면 [].
 */
export function unitStateChangeLines(changes: unknown, opts?: { hospitalNames?: HospitalNameMap; includeUnchanged?: boolean }): string[] {
  const ch = unitStateChangesOf(changes)
  if (!ch) return []
  const out: string[] = []
  const cb = ch.condition.before ?? null
  const ca = ch.condition.after ?? null
  if (opts?.includeUnchanged || cb !== ca) out.push(`${CORRECT_FIELD_LABELS.condition}: ${deviceConditionLabel(cb)} → ${deviceConditionLabel(ca)}`)
  const lb = ch.location.before
  const la = ch.location.after
  const locChanged = (lb.kind ?? null) !== (la.kind ?? null) || (lb.code ?? null) !== (la.code ?? null)
  if (opts?.includeUnchanged || locChanged) {
    const note = ch.location.note ? ` (${ch.location.note})` : '' // A-4(a) '입고 미확인'
    out.push(`${CORRECT_FIELD_LABELS.location}: ${locationSnapshotText(lb, opts?.hospitalNames)} → ${locationSnapshotText(la, opts?.hospitalNames)}${note}`)
  }
  return out
}

/** 스냅샷 after 요약 '사용중 · 병원 세란병원' — REGISTER/RECOVER/AS_* 행에 '→ …'로 병기. 스냅샷 없으면 null */
export function unitStateAfterText(changes: unknown, hospitalNames?: HospitalNameMap): string | null {
  const ch = unitStateChangesOf(changes)
  if (!ch) return null
  const loc = ch.location.after
  const locText = loc.kind ? locationSnapshotText(loc, hospitalNames) : null
  const note = ch.location.note ? ` (${ch.location.note})` : ''
  return `${deviceConditionLabel(ch.condition.after)}${locText ? ` · ${locText}` : ''}${note}`
}

/** 위치 이동 문구 'A → B' (SITE_MOVE) — 스냅샷 없으면 null */
export function locationMoveText(changes: unknown, hospitalNames?: HospitalNameMap): string | null {
  const ch = unitStateChangesOf(changes)
  if (!ch) return null
  return `${locationSnapshotText(ch.location.before, hospitalNames)} → ${locationSnapshotText(ch.location.after, hospitalNames)}`
}

/** '(09-14~)' — 상태·위치 진입 업무일자 병기 */
export function sinceText(v: string | null | undefined, today?: string): string | null {
  const d = fmtShortDate(v, today)
  return d ? `(${d}~)` : null
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
