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
import type { DevicesTab, HospitalTab, UnitsStatusFilter } from './types'
import { DEFAULT_URL_STATE, parseDevicesParams, resolveTab, serializeDevicesParams, type DevicesUrlState } from './urlState'

export { DEFAULT_URL_STATE, parseDevicesParams, resolveTab, serializeDevicesParams } from './urlState'
export type { DevicesUrlState } from './urlState'

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
