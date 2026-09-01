/**
 * 디바이스 원장 클라이언트 fetch 헬퍼 — 라우트 1:1 (projects/hospital_device_registry_design.md §7.1)
 *
 * - 모든 호출 `credentials: 'include'`(쿠키 JWT). 비-2xx는 `ApiError { status, error, conflicts?, rows?, skipped? }`로 throw
 * - 응답 형상은 ./types.ts. 라우트 구현이 스펙과 다르면 라우트를 따른다(p2_routes_api.md)
 * - xlsx 3종은 URL 빌더만 제공(`exportUnitsUrl`·`exportEventsUrl`·`exportCoverageUrl`) — 다운로드는 ExcelButton(그룹 A)이
 *   fetch → blob 으로 처리해 400(`필터를 좁혀 …`)을 JSON 오류로 보여준다(`downloadXlsx` 참고)
 *
 * P3-0 스켈레톤 소유 파일 — 그룹 A~D는 import만.
 */
import type {
  BulkBody,
  BulkResponse,
  Capabilities,
  CoverageFilter,
  CoverageResponse,
  CoverageSort,
  DevicePatchBody,
  DevicePatchResponse,
  EventCancelResponse,
  EventPatchBody,
  EventPatchResponse,
  EventsQueryParams,
  EventsResponse,
  HospitalDeviceSummary,
  HospitalOption,
  ImportBatchCancelResponse,
  ImportBatchDateResponse,
  ImportBatchesResponse,
  ImportExecuteResponse,
  ImportOptions,
  ImportPreviewResponse,
  LookupResponse,
  MaintenanceLookupResponse,
  MoveBody,
  MoveResponse,
  RecoverBody,
  RecoverResponse,
  RecoveryReason,
  UsageType,
  RegisterBody,
  RegisterPreviewResponse,
  RegisterResponse,
  ReplaceBody,
  ReplaceResponse,
  UnitDetailResponse,
  UnitIdsResponse,
  UnitsQueryParams,
  UnitsResponse,
  WardCreateBody,
  WardRow,
  WardUpdateBody,
  WardsResponse,
  Conflict,
  RegistryErrorRow,
  SkippedItem,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// 오류 · 공통 fetch
// ─────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number
  error: string
  conflicts?: Conflict[]
  rows?: RegistryErrorRow[]
  skipped?: SkippedItem[]
  /** 라우트별 부가 필드(existing·activeCount·deviceCount·eventCount 등) */
  body: Record<string, unknown>

  constructor(status: number, body: Record<string, unknown> | null, fallback?: string) {
    const error = (body && typeof body.error === 'string' && body.error) || fallback || `요청 실패 (${status})`
    super(error)
    this.name = 'ApiError'
    this.status = status
    this.error = error
    this.body = body ?? {}
    if (body && Array.isArray(body.conflicts)) this.conflicts = body.conflicts as Conflict[]
    if (body && Array.isArray(body.rows)) this.rows = body.rows as RegistryErrorRow[]
    if (body && Array.isArray(body.skipped)) this.skipped = body.skipped as SkippedItem[]
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

/** 오류 → 사용자 문구 (ApiError면 서버 메시지, 아니면 네트워크/예외 문구) */
export function errorMessage(e: unknown, fallback = '요청 처리 중 오류가 발생했습니다.'): string {
  if (isApiError(e)) return e.error
  if (e instanceof Error && e.message) return e.message
  return fallback
}

export type QueryValue = string | number | boolean | null | undefined

/** `{ a: 1, b: '', c: null }` → `?a=1` (빈 문자열·null·undefined·false 생략, true는 '1') */
export function buildQuery(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue
    sp.set(k, v === true ? '1' : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function parseBody(res: Response): Promise<Record<string, unknown> | null> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return null
  try {
    const j = (await res.json()) as unknown
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export interface ApiFetchInit extends Omit<RequestInit, 'body'> {
  /** 객체면 JSON 직렬화(+Content-Type), FormData/문자열은 그대로 */
  body?: unknown
}

/** JSON 응답 fetch — 2xx 외는 ApiError */
export async function apiFetch<T>(url: string, init: ApiFetchInit = {}): Promise<T> {
  const { body, headers, ...rest } = init
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const res = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...rest,
    headers: {
      ...(body !== undefined && !isForm && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : isForm || typeof body === 'string' ? (body as BodyInit) : JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await parseBody(res))
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const enc = encodeURIComponent

// ─────────────────────────────────────────────────────────────────────────────
// 읽기 — /api/devices/*
// ─────────────────────────────────────────────────────────────────────────────

export function getCapabilities(): Promise<Capabilities> {
  return apiFetch<Capabilities>('/api/devices/can-manage')
}

export interface CoverageQueryParams {
  page?: number
  /** 기본 50, ≤200 */
  limit?: number
  filter?: CoverageFilter | null
  q?: string | null
  sort?: CoverageSort | null
}

export function getCoverage(params: CoverageQueryParams = {}): Promise<CoverageResponse> {
  return apiFetch<CoverageResponse>(`/api/devices/summary${buildQuery(params as Record<string, QueryValue>)}`)
}

/** page/limit 제거(idsOnly·export는 페이지 무시) */
function omitPaging(q: Record<string, QueryValue>): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {}
  for (const [k, v] of Object.entries(q)) if (k !== 'page' && k !== 'limit') out[k] = v
  return out
}

function unitsQuery(params: UnitsQueryParams): Record<string, QueryValue> {
  return {
    hospital: params.hospital,
    model: params.model,
    ward: params.ward,
    status: params.status,
    q: params.q,
    wms: params.wms,
    usage: params.usage,
    productType: params.productType,
    page: params.page,
    limit: params.limit,
    sort: params.sort,
  }
}

/** 전역 [디바이스] 뷰 모델 필터 옵션 — `GET /api/settings/devices`(로그인 전원) 중 원장 대상(serialTracked) 모델. 없으면 전체 활성 모델 */
export interface DeviceModelOption {
  id: number
  deviceModel: string
  deviceName: string
  deviceClass: string
  isActive: boolean
  serialTracked: boolean
}

export async function getDeviceModels(): Promise<DeviceModelOption[]> {
  const r = await apiFetch<{ devices: DeviceModelOption[] }>('/api/settings/devices')
  const tracked = r.devices.filter((d) => d.serialTracked)
  return tracked.length > 0 ? tracked : r.devices.filter((d) => d.isActive)
}

export function getUnits(params: UnitsQueryParams): Promise<UnitsResponse> {
  return apiFetch<UnitsResponse>(`/api/devices/units${buildQuery(unitsQuery(params))}`)
}

/** '검색 결과 전체 선택' — page/limit 무시, ≤2,000 */
export function getUnitIds(params: UnitsQueryParams): Promise<UnitIdsResponse> {
  return apiFetch<UnitIdsResponse>(`/api/devices/units${buildQuery({ ...omitPaging(unitsQuery(params)), idsOnly: 1 })}`)
}

export function getUnitDetail(id: number): Promise<UnitDetailResponse> {
  return apiFetch<UnitDetailResponse>(`/api/devices/units/${id}`)
}

export function lookupSerial(serial: string): Promise<LookupResponse> {
  return apiFetch<LookupResponse>(`/api/devices/lookup${buildQuery({ serial })}`)
}

/** q가 MNT-YYYYMM-NNNN 정확 형식이면 hospital 무시(타 병원 건 hospitalMismatch:true) */
export function lookupMaintenance(hospital: string | null | undefined, q: string): Promise<MaintenanceLookupResponse> {
  return apiFetch<MaintenanceLookupResponse>(`/api/devices/maintenance-lookup${buildQuery({ hospital, q })}`)
}

function eventsQuery(params: EventsQueryParams): Record<string, QueryValue> {
  return {
    hospital: params.hospital,
    device: params.device,
    type: params.type,
    from: params.from,
    to: params.to,
    refType: params.refType,
    refCode: params.refCode,
    batch: params.batch,
    actionGroup: params.actionGroup,
    source: params.source,
    q: params.q,
    page: params.page,
    limit: params.limit,
  }
}

export function getEvents(params: EventsQueryParams): Promise<EventsResponse> {
  return apiFetch<EventsResponse>(`/api/devices/events${buildQuery(eventsQuery(params))}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 병원 — 요약 · 옵션
// ─────────────────────────────────────────────────────────────────────────────

export function getHospitalSummary(code: string): Promise<HospitalDeviceSummary> {
  return apiFetch<HospitalDeviceSummary>(`/api/hospitals/${enc(code)}/devices/summary`)
}

/** URL `?hospital=`이 콤보 모집단 밖일 때 단건 조회 (GET /api/hospitals/[code] → { hospital }) */
export async function getHospitalOption(code: string): Promise<HospitalOption> {
  const r = await apiFetch<{ hospital: { hospitalCode: string; hospitalName: string; status: string | null } }>(
    `/api/hospitals/${enc(code)}`
  )
  return { hospitalCode: r.hospital.hospitalCode, hospitalName: r.hospital.hospitalName, status: r.hospital.status ?? null }
}

/** '전체 병원 검색' 토글 — GET /api/hospitals?search= (page 1, 20건) */
export async function searchHospitals(search: string): Promise<HospitalOption[]> {
  const r = await apiFetch<{ hospitals: { hospitalCode: string; hospitalName: string; status: string | null }[] }>(
    `/api/hospitals${buildQuery({ search, page: 1 })}`
  )
  return (r.hospitals ?? []).map((h) => ({ hospitalCode: h.hospitalCode, hospitalName: h.hospitalName, status: h.status ?? null }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 쓰기 — 등록 · 교체 · 이동 · 회수 · 일괄 · 개체 PATCH
// ─────────────────────────────────────────────────────────────────────────────

/** 등록 폼 실시간 판별(임포트와 같은 엔진, DB 쓰기 없음) */
export function previewRegister(code: string, body: RegisterBody): Promise<RegisterPreviewResponse> {
  return apiFetch<RegisterPreviewResponse>(`/api/hospitals/${enc(code)}/devices/register?preview=true`, { method: 'POST', body })
}

export function registerDevices(code: string, body: RegisterBody): Promise<RegisterResponse> {
  return apiFetch<RegisterResponse>(`/api/hospitals/${enc(code)}/devices/register`, { method: 'POST', body })
}

export function replaceDevice(code: string, body: ReplaceBody): Promise<ReplaceResponse> {
  return apiFetch<ReplaceResponse>(`/api/hospitals/${enc(code)}/devices/replace`, { method: 'POST', body })
}

export function moveDevice(id: number, body: MoveBody): Promise<MoveResponse> {
  return apiFetch<MoveResponse>(`/api/devices/units/${id}/move`, { method: 'POST', body })
}

export function recoverDevice(id: number, body: RecoverBody): Promise<RecoverResponse> {
  return apiFetch<RecoverResponse>(`/api/devices/units/${id}/recover`, { method: 'POST', body })
}

export function bulkDeviceAction(body: BulkBody): Promise<BulkResponse> {
  return apiFetch<BulkResponse>('/api/devices/units/bulk', { method: 'POST', body })
}

/** memo(write) / usageTypeId·productType(write → CORRECT) / 식별 보정(admin → CORRECT) — 상태·병원·병동 키는 400 */
export function patchDevice(id: number, body: DevicePatchBody): Promise<DevicePatchResponse> {
  return apiFetch<DevicePatchResponse>(`/api/devices/units/${id}`, { method: 'PATCH', body })
}

// ─────────────────────────────────────────────────────────────────────────────
// 관리(admin) — 이벤트 정정 · 취소
// ─────────────────────────────────────────────────────────────────────────────

export function patchEvent(id: number, body: EventPatchBody): Promise<EventPatchResponse> {
  return apiFetch<EventPatchResponse>(`/api/devices/events/${id}`, { method: 'PATCH', body })
}

/** 마지막 이벤트 취소(LIFO, 교체·이관 쌍은 함께) */
export function cancelEvent(id: number): Promise<EventCancelResponse> {
  return apiFetch<EventCancelResponse>(`/api/devices/events/${id}`, { method: 'DELETE' })
}

// ─────────────────────────────────────────────────────────────────────────────
// 임포트
// ─────────────────────────────────────────────────────────────────────────────

/** 옵션 → multipart 필드(배열·객체는 JSON 문자열) */
function appendImportOptions(fd: FormData, options: ImportOptions) {
  for (const [k, v] of Object.entries(options)) {
    if (v === undefined || v === null || v === '') continue
    fd.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
}

export type ImportSource = { file: File } | { text: string }

function importRequest(source: ImportSource, options: ImportOptions): ApiFetchInit {
  if ('file' in source) {
    const fd = new FormData()
    fd.set('file', source.file, source.file.name)
    appendImportOptions(fd, { fileName: source.file.name, ...options })
    return { method: 'POST', body: fd }
  }
  return { method: 'POST', body: { text: source.text, ...options } }
}

export function previewImport(code: string, source: ImportSource, options: ImportOptions = {}): Promise<ImportPreviewResponse> {
  return apiFetch<ImportPreviewResponse>(`/api/hospitals/${enc(code)}/devices/import?preview=true`, importRequest(source, options))
}

/** 실행(단일 tx) — 400 미제외 오류 `{ error, rows[] }` · 409 `{ error, conflicts[] }` · 409 소급 불성립 `{ error, rows[] }` */
export function executeImport(code: string, source: ImportSource, options: ImportOptions = {}): Promise<ImportExecuteResponse> {
  return apiFetch<ImportExecuteResponse>(`/api/hospitals/${enc(code)}/devices/import`, importRequest(source, options))
}

export function getImportBatches(code: string, params: { page?: number; limit?: number } = {}): Promise<ImportBatchesResponse> {
  return apiFetch<ImportBatchesResponse>(`/api/hospitals/${enc(code)}/devices/imports${buildQuery(params)}`)
}

/** admin — 배치 업무일자 일괄 정정 */
export function patchImportBatchDate(code: string, batchId: number, occurredOn: string): Promise<ImportBatchDateResponse> {
  return apiFetch<ImportBatchDateResponse>(`/api/hospitals/${enc(code)}/devices/imports/${batchId}`, { method: 'PATCH', body: { occurredOn } })
}

/** admin — 배치 취소(배치 밖 상태 이벤트 있으면 409) */
export function cancelImportBatch(code: string, batchId: number): Promise<ImportBatchCancelResponse> {
  return apiFetch<ImportBatchCancelResponse>(`/api/hospitals/${enc(code)}/devices/imports/${batchId}/cancel`, { method: 'POST' })
}

// ─────────────────────────────────────────────────────────────────────────────
// 병동
// ─────────────────────────────────────────────────────────────────────────────

export function getWards(code: string): Promise<WardsResponse> {
  return apiFetch<WardsResponse>(`/api/hospitals/${enc(code)}/wards`)
}

/** 409 `{ error:'같은 이름의 병동이 이미 있습니다', existing }` → ApiError.body.existing */
export function createWard(code: string, body: WardCreateBody): Promise<{ ward: WardRow }> {
  return apiFetch<{ ward: WardRow }>(`/api/hospitals/${enc(code)}/wards`, { method: 'POST', body })
}

/** isActive:false는 admin + 배치 0대(409 `{ error, activeCount }`) */
export function updateWard(code: string, id: number, body: WardUpdateBody): Promise<{ ward: WardRow }> {
  return apiFetch<{ ward: WardRow }>(`/api/hospitals/${enc(code)}/wards/${id}`, { method: 'PUT', body })
}

/** admin — 참조 있으면 409 `{ error, deviceCount, eventCount }` */
export function deleteWard(code: string, id: number): Promise<{ success: true }> {
  return apiFetch<{ success: true }>(`/api/hospitals/${enc(code)}/wards/${id}`, { method: 'DELETE' })
}

// ─────────────────────────────────────────────────────────────────────────────
// 마스터
// ─────────────────────────────────────────────────────────────────────────────

export async function getRecoveryReasons(): Promise<RecoveryReason[]> {
  const r = await apiFetch<{ statusCodes: RecoveryReason[] }>('/api/settings/device-recovery-reason')
  return r.statusCodes
}

/** 용도 마스터(DEVICE_USAGE_TYPE — 판매용 SALE / 평가용 EVAL) */
export async function getUsageTypes(): Promise<UsageType[]> {
  const r = await apiFetch<{ statusCodes: UsageType[] }>('/api/settings/device-usage-type')
  return r.statusCodes
}

// ─────────────────────────────────────────────────────────────────────────────
// Excel URL (헤더 [Excel]은 활성 탭 기준 — §6.1 Excel)
// ─────────────────────────────────────────────────────────────────────────────

/** 기기 목록 xlsx — units와 같은 필터(정렬 반영), page/limit 무시, 10,000행 캡 */
export function exportUnitsUrl(params: UnitsQueryParams): string {
  return `/api/devices/export${buildQuery(omitPaging(unitsQuery(params)))}`
}

/** 이력 xlsx — events와 같은 필터, 10,000행 캡 */
export function exportEventsUrl(params: EventsQueryParams): string {
  return `/api/devices/events/export${buildQuery(omitPaging(eventsQuery(params)))}`
}

/** 커버리지 xlsx — 1,000행 캡 */
export function exportCoverageUrl(params: { filter?: CoverageFilter | null; q?: string | null; sort?: CoverageSort | null }): string {
  return `/api/devices/summary/export${buildQuery(params as Record<string, QueryValue>)}`
}

/**
 * xlsx 다운로드 — 400(`필터를 좁혀 … 이하로 내보내세요`)을 JSON 오류로 받아 ApiError로 throw.
 * 파일명은 Content-Disposition(filename*=UTF-8'' 우선)에서 복원.
 */
export async function downloadXlsx(url: string, fallbackName = 'export.xlsx'): Promise<void> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' })
  if (!res.ok) throw new ApiError(res.status, await parseBody(res), 'Excel 내보내기에 실패했습니다.')
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') ?? ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  const plain = /filename="?([^";]+)"?/i.exec(cd)
  let name = fallbackName
  if (star) {
    try {
      name = decodeURIComponent(star[1])
    } catch {
      name = star[1]
    }
  } else if (plain) name = plain[1]
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
