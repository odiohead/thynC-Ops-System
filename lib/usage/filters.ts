/**
 * 사용량 — 전체 병원 대시보드의 조건 묶음 (projects/usage_dashboard_filter_design.md)
 *
 * 화면(주소) · 조회 API · 저장된 보기가 같은 모양을 쓴다. 이 파일은 DB 를 읽지 않는다(화면에서도 불러 쓴다).
 *   기기 · 판매모델                         고른 값
 *   종별 types                             여러 개. 비면 전체
 *   병원 지정 hospitals                     병원 코드 목록. 비면 지정 없음. 종별과 함께면 둘 다 만족하는 병원
 *   도입 병상 beds                          병원 정보의 도입 병상 수 범위(min ~ max, max 없으면 그 이상 전부). null 이면 범위 없음.
 *                                          범위를 정하면 도입 병상이 비어 있는 병원은 빠진다
 *   추이 기간 trend                         12주(기본) · 26주 · 52주 · 전체 · 직접 지정(from ~ to)
 * 추이 기간은 추이 영역의 범위만 바꾼다 — 가동률 · 순위 · 판정은 '최근 30일 대 이전 30일' 그대로다.
 */

export const FILTER_DEVICES = ['ecg', 'spo2', 'cart'] as const
export type FilterDevice = (typeof FILTER_DEVICES)[number]
export const FILTER_MODELS = ['all', 'general', 'usage'] as const
export type FilterModel = (typeof FILTER_MODELS)[number]

export const TREND_WEEK_OPTIONS = [12, 26, 52] as const
export type TrendWeeks = (typeof TREND_WEEK_OPTIONS)[number]
export type TrendRange = { kind: 'weeks'; weeks: TrendWeeks } | { kind: 'all' } | { kind: 'range'; from: string; to: string }

/** 도입 병상 수 범위 — 끝 포함. max 가 null 이면 min 이상 전부 */
export type BedRange = { min: number; max: number | null }

export type OverviewFilters = { types: string[]; hospitals: string[]; beds: BedRange | null; trend: TrendRange }
export type ViewFilters = OverviewFilters & { device: FilterDevice; model: FilterModel }

export const DEFAULT_TREND: TrendRange = { kind: 'weeks', weeks: 12 }
export const DEFAULT_FILTERS: ViewFilters = { device: 'ecg', model: 'all', types: [], hospitals: [], beds: null, trend: DEFAULT_TREND }

/** 주 단위로 보여 주는 최대 길이(주) — 이보다 길면 월 단위 */
export const TREND_WEEKLY_MAX_WEEKS = 26
/** 한 보기에 담을 수 있는 병원 수 · 종별 수 */
export const FILTER_MAX_HOSPITALS = 500
export const FILTER_MAX_TYPES = 20
/** 도입 병상 범위로 받아들이는 가장 큰 수 */
export const FILTER_MAX_BEDS = 100_000
/** 도입 병상 범위의 빠른 선택 */
export const BED_PRESETS: { label: string; range: BedRange }[] = [
  { label: '0~50', range: { min: 0, max: 50 } },
  { label: '51~100', range: { min: 51, max: 100 } },
  { label: '101~200', range: { min: 101, max: 200 } },
  { label: '201~', range: { min: 201, max: null } },
]

const CODE_RE = /^[A-Za-z0-9_-]{1,40}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
const uniq = (xs: string[]) => Array.from(new Set(xs))

function cleanTypes(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  return uniq(list.map((x) => String(x).trim()).filter((x) => x.length > 0 && x.length <= 30)).slice(0, FILTER_MAX_TYPES)
}
function cleanHospitals(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  return uniq(list.map((x) => String(x).trim()).filter((x) => CODE_RE.test(x))).slice(0, FILTER_MAX_HOSPITALS)
}

const isBedCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= FILTER_MAX_BEDS

/**
 * 도입 병상 범위를 정리한다 — 모르는 모양이면 undefined, '범위 없음'(0 이상 전부)이면 null.
 * min 이 없으면 0, max 가 없으면 상한 없음.
 */
export function parseBeds(v: unknown): BedRange | null | undefined {
  if (v === null) return null
  if (!v || typeof v !== 'object') return undefined
  const b = v as { min?: unknown; max?: unknown }
  const min = b.min === undefined || b.min === null ? 0 : b.min
  const max = b.max === undefined ? null : b.max
  if (!isBedCount(min) || (max !== null && (!isBedCount(max) || max < min))) return undefined
  return min === 0 && max === null ? null : { min, max }
}

/** 주소의 beds 값 — '51-100' · '201-'(이상) · '-50'(이하). 비었거나 모르는 모양이면 범위 없음(null) */
export function parseBedsParam(text: string): BedRange | null {
  const m = /^(\d{0,6})-(\d{0,6})$/.exec(text.trim())
  if (!m) return null
  return parseBeds({ min: m[1] === '' ? 0 : Number(m[1]), max: m[2] === '' ? null : Number(m[2]) }) ?? null
}

export function sameBeds(a: BedRange | null, b: BedRange | null): boolean {
  return a === null || b === null ? a === b : a.min === b.min && a.max === b.max
}

/** 병원의 도입 병상 수가 범위에 드는가 — 범위가 있으면 값이 비어 있는 병원은 들지 않는다 */
export function inBedRange(beds: number | null | undefined, range: BedRange | null): boolean {
  if (!range) return true
  if (beds === null || beds === undefined) return false
  return beds >= range.min && (range.max === null || beds <= range.max)
}

export function bedsLabel(b: BedRange | null): string {
  if (!b) return '전체'
  return b.max === null ? `${b.min.toLocaleString()}병상 이상` : `${b.min.toLocaleString()}~${b.max.toLocaleString()}병상`
}

/** 추이 기간 — 모르는 모양이면 null */
export function parseTrend(v: unknown): TrendRange | null {
  if (!v || typeof v !== 'object') return null
  const t = v as { kind?: unknown; weeks?: unknown; from?: unknown; to?: unknown }
  if (t.kind === 'all') return { kind: 'all' }
  if (t.kind === 'weeks' && TREND_WEEK_OPTIONS.includes(Number(t.weeks) as TrendWeeks)) return { kind: 'weeks', weeks: Number(t.weeks) as TrendWeeks }
  if (t.kind === 'range' && isDate(t.from) && isDate(t.to) && t.from <= t.to) return { kind: 'range', from: t.from, to: t.to }
  return null
}

/**
 * 주소의 조건 → 조건 묶음의 일부. **주소에 적힌 것만** 돌려준다(저장된 보기 위에 덮어쓰기 위해).
 * device · model · types · hospitals · beds=51-100|201- · weeks=12|26|52 · range=all · from&to
 */
export function filtersFromParams(get: (key: string) => string | null): Partial<ViewFilters> {
  const out: Partial<ViewFilters> = {}
  const device = get('device')
  if (device && (FILTER_DEVICES as readonly string[]).includes(device)) out.device = device as FilterDevice
  const model = get('model')
  if (model && (FILTER_MODELS as readonly string[]).includes(model)) out.model = model as FilterModel
  const types = get('types')
  if (types !== null) out.types = cleanTypes(types)
  const hospitals = get('hospitals')
  if (hospitals !== null) out.hospitals = cleanHospitals(hospitals)
  const beds = get('beds')
  if (beds !== null) out.beds = parseBedsParam(beds)
  const weeks = get('weeks')
  const range = get('range')
  const from = get('from')
  const to = get('to')
  const trend = range === 'all' ? parseTrend({ kind: 'all' }) : from && to ? parseTrend({ kind: 'range', from, to }) : weeks ? parseTrend({ kind: 'weeks', weeks: Number(weeks) }) : null
  if (trend) out.trend = trend
  return out
}

/** 조건 묶음 → 주소의 조건. 기본값은 적지 않는다. only 를 주면 그 키만 적는다(저장된 보기에서 바뀐 것만) */
export function filtersToParams(f: ViewFilters, only?: (keyof ViewFilters)[]): URLSearchParams {
  const q = new URLSearchParams()
  const want = (k: keyof ViewFilters) => !only || only.includes(k)
  if (want('device') && (only || f.device !== DEFAULT_FILTERS.device)) q.set('device', f.device)
  if (want('model') && (only || f.model !== DEFAULT_FILTERS.model)) q.set('model', f.model)
  if (want('types') && (only || f.types.length > 0)) q.set('types', f.types.join(','))
  if (want('hospitals') && (only || f.hospitals.length > 0)) q.set('hospitals', f.hospitals.join(','))
  if (want('beds') && (only || f.beds !== null)) q.set('beds', f.beds ? `${f.beds.min}-${f.beds.max ?? ''}` : '')
  if (want('trend') && (only || !sameTrend(f.trend, DEFAULT_TREND))) {
    if (f.trend.kind === 'all') q.set('range', 'all')
    else if (f.trend.kind === 'range') {
      q.set('from', f.trend.from)
      q.set('to', f.trend.to)
    } else q.set('weeks', String(f.trend.weeks))
  }
  return q
}

export function sameTrend(a: TrendRange, b: TrendRange): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'weeks' && b.kind === 'weeks') return a.weeks === b.weeks
  if (a.kind === 'range' && b.kind === 'range') return a.from === b.from && a.to === b.to
  return true
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

/** 두 조건 묶음에서 다른 항목 (순서는 보지 않는다) */
export function diffFilters(a: ViewFilters, b: ViewFilters): (keyof ViewFilters)[] {
  const out: (keyof ViewFilters)[] = []
  if (a.device !== b.device) out.push('device')
  if (a.model !== b.model) out.push('model')
  if (!sameSet(a.types, b.types)) out.push('types')
  if (!sameSet(a.hospitals, b.hospitals)) out.push('hospitals')
  if (!sameBeds(a.beds, b.beds)) out.push('beds')
  if (!sameTrend(a.trend, b.trend)) out.push('trend')
  return out
}

/** 저장할 조건 묶음을 검사해 정리한다. 받아들일 수 없으면 오류 문구 */
export function normalizeViewFilters(input: unknown): { filters: ViewFilters } | { error: string } {
  if (!input || typeof input !== 'object') return { error: '조건이 올바르지 않습니다.' }
  const v = input as Record<string, unknown>
  if (!(FILTER_DEVICES as readonly string[]).includes(String(v.device))) return { error: '기기 값이 올바르지 않습니다.' }
  if (!(FILTER_MODELS as readonly string[]).includes(String(v.model))) return { error: '판매모델 값이 올바르지 않습니다.' }
  const trend = v.trend === undefined ? DEFAULT_TREND : parseTrend(v.trend)
  if (!trend) return { error: '추이 기간이 올바르지 않습니다.' }
  if (Array.isArray(v.hospitals) && v.hospitals.length > FILTER_MAX_HOSPITALS) return { error: `병원은 ${FILTER_MAX_HOSPITALS}곳까지 지정할 수 있습니다.` }
  // 도입 병상 필터가 생기기 전(2026-11-26)에 저장한 보기에는 beds 가 없다 — 범위 없음으로 읽는다
  const beds = v.beds === undefined ? null : parseBeds(v.beds)
  if (beds === undefined) return { error: '도입 병상 범위가 올바르지 않습니다.' }
  return { filters: { device: v.device as FilterDevice, model: v.model as FilterModel, types: cleanTypes(v.types), hospitals: cleanHospitals(v.hospitals), beds, trend } }
}

/** 저장돼 있던 조건 묶음을 읽는다 — 모양이 어긋난 항목은 기본값으로 */
export function readViewFilters(input: unknown): ViewFilters {
  const r = normalizeViewFilters(input)
  if ('filters' in r) return r.filters
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return {
    device: (FILTER_DEVICES as readonly string[]).includes(String(v.device)) ? (v.device as FilterDevice) : DEFAULT_FILTERS.device,
    model: (FILTER_MODELS as readonly string[]).includes(String(v.model)) ? (v.model as FilterModel) : DEFAULT_FILTERS.model,
    types: cleanTypes(v.types),
    hospitals: cleanHospitals(v.hospitals),
    beds: parseBeds(v.beds) ?? null,
    trend: parseTrend(v.trend) ?? DEFAULT_TREND,
  }
}

export function trendLabel(t: TrendRange): string {
  if (t.kind === 'all') return '전체'
  if (t.kind === 'range') return `${t.from} ~ ${t.to}`
  return `${t.weeks}주`
}

/** 종별을 보여 주는 순서 — 여기 없는 종별은 뒤에 이름순 */
export const HOSPITAL_TYPE_ORDER = ['상급종합', '종합병원', '병원', '요양병원', '정신병원', '한방병원', '치과병원', '의원']
export function sortTypes<T extends { type: string }>(list: T[]): T[] {
  const rank = (t: string) => {
    const i = HOSPITAL_TYPE_ORDER.indexOf(t)
    return i === -1 ? HOSPITAL_TYPE_ORDER.length : i
  }
  return [...list].sort((a, b) => rank(a.type) - rank(b.type) || a.type.localeCompare(b.type, 'ko'))
}
/** 종별이 비어 있는 병원을 묶는 이름 */
export const NO_TYPE_LABEL = '종별 없음'
