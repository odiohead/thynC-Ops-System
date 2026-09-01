/**
 * /devices URL 상태 — 순수 파서/직렬화 (서버 컴포넌트 page.tsx와 클라이언트 훅이 공용).
 * 'use client' 없음: 서버에서 import 시 클라이언트 참조 프록시가 되지 않도록 useDevicesUrlState.ts에서 분리.
 */
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
