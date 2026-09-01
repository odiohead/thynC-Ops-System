/**
 * /devices URL 상태 — 순수 파서/직렬화 (서버 컴포넌트 page.tsx와 클라이언트 훅이 공용).
 * 'use client' 없음: 서버에서 import 시 클라이언트 참조 프록시가 되지 않도록 useDevicesUrlState.ts에서 분리.
 *
 * v1 단순화(2026-09-01 사용자 피드백) — 메인 탭 2개:
 *  - `?view=hospital&hospital=&tab=list|history|wards|import&status=&model=&ward=&q=&page=&device=` (병원 미선택이면 q/page = 축약 커버리지 표의 병원명 검색·페이지)
 *  - `?view=devices&status=&model=&usage=&productType=&q=&page=&device=`
 * 구 링크(`tab=coverage|events`, view 없음)는 기본값(view=hospital, tab=list)으로 관대하게 매핑.
 */
import {
  DEVICE_VIEWS,
  HOSPITAL_TABS,
  type DevicesTab,
  type DevicesView,
  type HospitalTab,
  type UnitsStatusFilter,
  type WardFilter,
} from './types'
import { PRODUCT_TYPE_FILTERS, USAGE_FILTERS, type ProductTypeFilter, type UsageFilter } from '@/lib/deviceRegistryShared'

export interface DevicesUrlState {
  /** 메인 탭 — 기본 hospital */
  view: DevicesView
  hospital: string | null
  /** 병원 뷰 하위 탭(기본 list). devices 뷰에서는 무시(직렬화 생략) */
  tab: HospitalTab
  status: UnitsStatusFilter
  model: number | null
  ward: WardFilter
  /** devices 뷰 전용 URL 필터(병원 뷰에서는 로컬 필터로 남는다) */
  usage: UsageFilter | null
  productType: ProductTypeFilter | null
  q: string
  page: number
  /** 드로어 딥링크 기기 id(양쪽 뷰 공통) */
  device: number | null
}

export const DEFAULT_URL_STATE: DevicesUrlState = {
  view: 'hospital',
  hospital: null,
  tab: 'list',
  status: 'active',
  model: null,
  ward: null,
  usage: null,
  productType: null,
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

export function resolveView(raw: string | null | undefined): DevicesView {
  return (DEVICE_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as DevicesView) : 'hospital'
}

/**
 * 하위 탭 보정 — 병원 뷰 탭만 유효(기본 list). 구 전역 탭 값(coverage/events)은 list로.
 * (시그니처는 구 호환: 첫 인자 hospital은 더 이상 분기에 쓰지 않는다)
 */
export function resolveTab(_hospital: string | null, raw: string | null | undefined): HospitalTab {
  return (HOSPITAL_TABS as readonly string[]).includes(raw ?? '') ? (raw as HospitalTab) : 'list'
}

/** 서버(page.tsx searchParams)·클라이언트(URLSearchParams) 공용 파서 — 잘못된 값은 기본값으로 */
export function parseDevicesParams(sp: RawParams): DevicesUrlState {
  const view = resolveView(first(sp, 'view'))
  const hospital = (first(sp, 'hospital') ?? '').trim() || null
  const statusRaw = first(sp, 'status')
  const wardRaw = first(sp, 'ward')
  const ward: WardFilter = wardRaw === 'unassigned' ? 'unassigned' : posInt(wardRaw)
  const usageRaw = first(sp, 'usage')
  const ptRaw = first(sp, 'productType')
  return {
    view,
    hospital: view === 'hospital' ? hospital : null,
    tab: resolveTab(hospital, first(sp, 'tab') as DevicesTab | null),
    status: STATUSES.includes(statusRaw as UnitsStatusFilter) ? (statusRaw as UnitsStatusFilter) : 'active',
    model: posInt(first(sp, 'model')),
    ward: view === 'hospital' ? ward : null,
    usage: view === 'devices' && (USAGE_FILTERS as readonly string[]).includes(usageRaw ?? '') ? (usageRaw as UsageFilter) : null,
    productType: view === 'devices' && (PRODUCT_TYPE_FILTERS as readonly string[]).includes(ptRaw ?? '') ? (ptRaw as ProductTypeFilter) : null,
    q: (first(sp, 'q') ?? '').trim(),
    page: posInt(first(sp, 'page')) ?? 1,
    device: posInt(first(sp, 'device')),
  }
}

/** 상태 → 쿼리 문자열(기본값은 생략해 URL을 짧게) */
export function serializeDevicesParams(s: DevicesUrlState): string {
  const sp = new URLSearchParams()
  const view = resolveView(s.view)
  if (view !== 'hospital') sp.set('view', view)
  if (view === 'hospital') {
    if (s.hospital) {
      sp.set('hospital', s.hospital)
      const tab = resolveTab(s.hospital, s.tab)
      if (tab !== 'list') sp.set('tab', tab)
      if (s.status !== 'active') sp.set('status', s.status)
      if (s.model != null) sp.set('model', String(s.model))
      if (s.ward != null) sp.set('ward', String(s.ward))
    }
    // 병원 미선택이면 q=병원명 검색·page는 축약 커버리지 표의 것(병원 선택 시 setHospital이 초기화)
    if (s.q) sp.set('q', s.q)
    if (s.page > 1) sp.set('page', String(s.page))
  } else {
    if (s.status !== 'active') sp.set('status', s.status)
    if (s.model != null) sp.set('model', String(s.model))
    if (s.usage) sp.set('usage', s.usage)
    if (s.productType) sp.set('productType', s.productType)
    if (s.q) sp.set('q', s.q)
    if (s.page > 1) sp.set('page', String(s.page))
  }
  if (s.device != null) sp.set('device', String(s.device))
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}
