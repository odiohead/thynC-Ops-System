'use client'

/**
 * /devices URL 동기화 훅 (projects/hospital_device_registry_design.md §6)
 *
 * `?hospital=&tab=list|history|wards|import`(병원 선택 시) / `?tab=coverage|events`(병원 미선택 시)
 * `&status=&model=&ward=&q=&page=&device=<id>`(드로어 딥링크)
 *
 * - 단일 소스는 URL(useSearchParams) — 뒤로가기/앞으로가기도 그대로 반영. 첫 렌더는 서버가 파싱한 `initial`과 일치
 * - 모든 변경은 `router.replace(…, { scroll:false })` (히스토리 오염 없음). 타이핑 검색은 호출부에서 디바운스 후 setFilters
 * - 정렬·WMS 필터·이벤트 기간 등 URL 키가 아닌 필터는 DevicesClient 로컬 state (스펙 키만 URL에 둔다)
 *
 * P3-0 스켈레톤 소유 파일.
 */
import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  GLOBAL_TABS,
  HOSPITAL_TABS,
  type DevicesTab,
  type GlobalTab,
  type HospitalTab,
  type UnitsStatusFilter,
  type WardFilter,
} from './types'

export interface DevicesUrlState {
  hospital: string | null
  /** hospital 있으면 HospitalTab(기본 list), 없으면 GlobalTab(기본 coverage) — parse가 보정 */
  tab: DevicesTab
  status: UnitsStatusFilter
  model: number | null
  ward: WardFilter
  q: string
  page: number
  /** 드로어 딥링크 기기 id */
  device: number | null
}

export const DEFAULT_URL_STATE: DevicesUrlState = {
  hospital: null,
  tab: 'coverage',
  status: 'active',
  model: null,
  ward: null,
  q: '',
  page: 1,
  device: null,
}

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams

function first(sp: RawParams, key: string): string | null {
  if (sp instanceof URLSearchParams) return sp.get(key)
  const v = sp[key]
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

function posInt(v: string | null): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

const STATUSES: readonly UnitsStatusFilter[] = ['active', 'recovered', 'all']

export function resolveTab(hospital: string | null, raw: string | null | undefined): DevicesTab {
  if (hospital) return (HOSPITAL_TABS as readonly string[]).includes(raw ?? '') ? (raw as HospitalTab) : 'list'
  return (GLOBAL_TABS as readonly string[]).includes(raw ?? '') ? (raw as GlobalTab) : 'coverage'
}

/** 서버(page.tsx searchParams)·클라이언트(URLSearchParams) 공용 파서 — 잘못된 값은 기본값으로 */
export function parseDevicesParams(sp: RawParams): DevicesUrlState {
  const hospital = (first(sp, 'hospital') ?? '').trim() || null
  const statusRaw = first(sp, 'status')
  const wardRaw = first(sp, 'ward')
  const ward: WardFilter = wardRaw === 'unassigned' ? 'unassigned' : posInt(wardRaw)
  return {
    hospital,
    tab: resolveTab(hospital, first(sp, 'tab')),
    status: STATUSES.includes(statusRaw as UnitsStatusFilter) ? (statusRaw as UnitsStatusFilter) : 'active',
    model: posInt(first(sp, 'model')),
    ward,
    q: (first(sp, 'q') ?? '').trim(),
    page: posInt(first(sp, 'page')) ?? 1,
    device: posInt(first(sp, 'device')),
  }
}

/** 상태 → 쿼리 문자열(기본값은 생략해 URL을 짧게) */
export function serializeDevicesParams(s: DevicesUrlState): string {
  const sp = new URLSearchParams()
  if (s.hospital) sp.set('hospital', s.hospital)
  const tab = resolveTab(s.hospital, s.tab)
  const defaultTab: DevicesTab = s.hospital ? 'list' : 'coverage'
  if (tab !== defaultTab) sp.set('tab', tab)
  if (s.hospital) {
    if (s.status !== 'active') sp.set('status', s.status)
    if (s.model != null) sp.set('model', String(s.model))
    if (s.ward != null) sp.set('ward', String(s.ward))
  }
  if (s.q) sp.set('q', s.q)
  if (s.page > 1) sp.set('page', String(s.page))
  if (s.device != null) sp.set('device', String(s.device))
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export interface SetHospitalOptions {
  tab?: HospitalTab
  status?: UnitsStatusFilter
  device?: number | null
}

export interface DevicesUrlApi {
  state: DevicesUrlState
  /** 부분 갱신(페이지는 명시하지 않으면 유지) */
  setState: (patch: Partial<DevicesUrlState>) => void
  /** 병원 전환 — 필터·페이지·드로어 초기화(옵션으로 status/device/tab 지정: 시리얼 조회 진입 경로) */
  setHospital: (code: string | null, opts?: SetHospitalOptions) => void
  /** 탭 전환 — page 1로. 병원 뷰는 q(시리얼) 유지, 전역 뷰는 q 초기화(커버리지 q=병원명 ↔ 최근 이벤트 q=시리얼 의미가 다름) */
  setTab: (tab: DevicesTab) => void
  /** 목록 필터(status/model/ward/q) — page는 patch에 없으면 1로 리셋 */
  setFilters: (patch: Partial<Pick<DevicesUrlState, 'status' | 'model' | 'ward' | 'q' | 'page'>>) => void
  /** 드로어 열기/닫기 */
  setDevice: (id: number | null) => void
}

export function useDevicesUrlState(initial: DevicesUrlState = DEFAULT_URL_STATE): DevicesUrlApi {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const state = useMemo<DevicesUrlState>(() => (searchParams ? parseDevicesParams(searchParams) : initial), [searchParams, initial])

  const replace = useCallback(
    (next: DevicesUrlState) => {
      const qs = serializeDevicesParams(next)
      const current = searchParams?.toString() ? `?${searchParams.toString()}` : ''
      if (qs === current) return
      router.replace(`${pathname || '/devices'}${qs}`, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  const setState = useCallback((patch: Partial<DevicesUrlState>) => replace({ ...state, ...patch }), [replace, state])

  const setHospital = useCallback(
    (code: string | null, opts?: SetHospitalOptions) => {
      replace({
        ...DEFAULT_URL_STATE,
        hospital: code,
        tab: code ? (opts?.tab ?? 'list') : 'coverage',
        status: opts?.status ?? 'active',
        device: opts?.device ?? null,
      })
    },
    [replace]
  )

  const setTab = useCallback(
    (tab: DevicesTab) => replace({ ...state, tab: resolveTab(state.hospital, tab), page: 1, q: state.hospital ? state.q : '' }),
    [replace, state]
  )

  const setFilters = useCallback(
    (patch: Partial<Pick<DevicesUrlState, 'status' | 'model' | 'ward' | 'q' | 'page'>>) =>
      replace({ ...state, page: 1, ...patch }),
    [replace, state]
  )

  const setDevice = useCallback((id: number | null) => replace({ ...state, device: id }), [replace, state])

  return { state, setState, setHospital, setTab, setFilters, setDevice }
}
