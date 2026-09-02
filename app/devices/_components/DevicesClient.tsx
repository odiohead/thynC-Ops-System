'use client'

/**
 * /devices 오케스트레이터 (projects/hospital_device_registry_design.md §6.1 — v1 단순화 2026-09-01 사용자 피드백)
 *
 * 소유: 권한 프로브 · 병원 옵션(커버리지 모집단) · URL 상태(useDevicesUrlState) · 로컬 필터(정렬·WMS·기간 등) · 선택(Map) · 요약 · 탭 카운트 · 모달 · 토스트.
 * 자식은 props/콜백으로만 통신:
 *   - onMutated()           : 요약·활성 탭·드로어 재조회(reloadKey++) + router.refresh()
 *   - onDone(MutationDone)  : 토스트 + 모달 닫기 + 선택 해제 + onMutated (+ openDeviceId면 드로어)
 *   - onAction(action, ref) : 행 ⋯/드로어 → 모달 열기(병원 문맥 필요 — [디바이스] 뷰에서는 병원별 뷰로 전환 안내)
 *   - onOpenDevice(id)      : URL ?device= 드로어
 *
 * 레이아웃(v1): 헤더 = 제목 + 메인 탭 [병원별][디바이스](`?view=`)만.
 *   [병원별] 1행 병원 콤보 … (USER+) [+ 등록][임포트] / 2행 요약 한 줄 `배치 중 n · 계약 m(팝오버) · 회수 k · 병동 w` / 3행 소형 탭 [기기 목록|이력|병동|임포트](+ Excel·[선택] 토글)
 *             병원 미선택 → 축약 병원 커버리지 표(GlobalCoverage compact — 병원 블록: 병원명·상태·마지막 이벤트 + 일반/라이트(/미지정) 소행 심전계·산소포화도·혈압계, 블록 클릭 → 병원 선택)
 *   [디바이스] DeviceListTab(전 기기 평면 목록 — 병원 무관)
 * v1에서 렌더하지 않는 것(파일은 보존): SummaryStrip(매트릭스 표) · GlobalCoverage 전체 12열 모드 · 전역 최근 이벤트 탭 · SerialLookup(헤더 시리얼 조회 → [디바이스] 검색이 대체) · MobileActionBar · GlobalTotalsLine
 *
 * P3-0 스켈레톤 소유 파일 — P3 Verify(2026-09-01)에서 배선 보강: 등록 프리필(RECOVERED 재등록)·요약 로드 전 등록/교체 가드·드로어 onOpenDevice·콤보 '배치 중 n대'.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckSquare, Info } from 'lucide-react'
import PageHeader from '@/app/components/ui/PageHeader'
import Button from '@/app/components/ui/Button'
import Badge from '@/app/components/ui/Badge'
import { cn } from '@/lib/cn'
import { PRODUCT_TYPE_UNSET_LABEL, todayKst } from '@/lib/deviceRegistryShared'
import { clearDeviceAs, errorMessage, exportEventsUrl, exportUnitsUrl, getCapabilities, getCoverage, getEvents, getHospitalOption, getHospitalSummary, getImportBatches, getUnitIds } from './api'
import { DevicesToastProvider, useDevicesToast } from './toast'
import { useDevicesUrlState, type DevicesUrlState } from './useDevicesUrlState'
import {
  DEVICE_VIEWS,
  DEVICE_VIEW_LABELS,
  HOSPITAL_TABS,
  HOSPITAL_TAB_LABELS,
  READ_ONLY_CAPABILITIES,
  toWardOption,
  type Capabilities,
  type CoverageFilters,
  type CoverageResponse,
  type CoverageRow,
  type DeviceAction,
  type DeviceRef,
  type DevicesTab,
  type DevicesView,
  type EventFilters,
  type GlobalListFilters,
  type HospitalDeviceSummary,
  type HospitalOption,
  type HospitalTab,
  type ListFilters,
  type MutationDone,
  type Selection,
  type WardOption,
} from './types'
import { diffText, fmtDeal, modelLabel, productTypeBadgeVariant } from './deviceDisplay'
import { RegistryFloatingPanel } from './RegistryFloatingPanel'
import { HospitalPicker } from './HospitalPicker'
import { GlobalCoverage } from './GlobalCoverage'
import { ExcelButton } from './ExcelButton'
import { DeviceTable } from './DeviceTable'
import { DeviceListTab } from './DeviceListTab'
import { BulkActionBar } from './BulkActionBar'
import { DeviceHistoryDrawer } from './DeviceHistoryDrawer'
import { CorrectionModal } from './CorrectionModal'
import { ProductTypeModal } from './ProductTypeModal'
import { DealModal } from './DealModal'
import { AsFlagModal } from './AsFlagModal'
import { RegisterModal } from './RegisterModal'
import { MoveWardModal } from './MoveWardModal'
import { RecoverModal } from './RecoverModal'
import { ReplaceModal } from './ReplaceModal'
import { ImportPanel } from './ImportPanel'
import { WardPanel } from './WardPanel'
import { EventsTab } from './EventsTab'

export interface DevicesClientProps {
  /** page.tsx가 searchParams를 parseDevicesParams로 파싱해 전달(첫 렌더 일치용) */
  initialParams: DevicesUrlState
}

/** 커버리지 모집단 로드 — 1,000씩(라우트 캡 COVERAGE_MAX_LIMIT), 보통 1요청으로 전체 모집단 확보(최대 10페이지 안전장치) */
const OPTIONS_PAGE_LIMIT = 1000
const OPTIONS_MAX_PAGES = 10

type ModalState =
  | { kind: 'register'; initialSerials?: string[] }
  | { kind: 'move'; devices: DeviceRef[]; ids: number[]; note?: string | null }
  | { kind: 'recover'; devices: DeviceRef[]; ids: number[]; scanMode?: boolean }
  | { kind: 'replace'; oldDevice: DeviceRef | null }
  | { kind: 'correct'; device: DeviceRef }
  | { kind: 'productType'; devices: DeviceRef[]; ids: number[]; note?: string | null }
  | { kind: 'deal'; devices: DeviceRef[]; ids: number[]; note?: string | null }
  | { kind: 'asOpen'; device: DeviceRef }
  | null

type ListLocal = Pick<ListFilters, 'limit' | 'sort' | 'wms' | 'usage' | 'productType' | 'deal' | 'as'>
type EventLocal = Omit<EventFilters, 'q' | 'page'>
type CoverageLocal = Pick<CoverageFilters, 'filter' | 'sort' | 'limit'>

const DEFAULT_LIST_LOCAL: ListLocal = { limit: 50, sort: 'ward', wms: null, usage: null, productType: null, deal: null, as: false }
/** 병원 이력 탭 로컬 필터 기본값 — 전체 기간 */
const DEFAULT_EVENT_LOCAL: EventLocal = { limit: 50, type: null, from: null, to: null, refType: null, source: null }
/** 병원 미선택 축약 커버리지 표 — 정렬은 '차이 큰 순' 고정(compact에서 셀렉트 미노출), 50행 */
const DEFAULT_COVERAGE_LOCAL: CoverageLocal = { filter: 'all', sort: 'diff', limit: 50 }

export default function DevicesClient({ initialParams }: DevicesClientProps) {
  return (
    <DevicesToastProvider>
      <DevicesInner initialParams={initialParams} />
    </DevicesToastProvider>
  )
}

function DevicesInner({ initialParams }: DevicesClientProps) {
  const router = useRouter()
  const notify = useDevicesToast()
  const url = useDevicesUrlState(initialParams)
  const { view, hospital, tab, device: drawerDeviceId } = url.state

  // [디바이스] 뷰로 갔다가 [병원별]로 돌아올 때 직전 병원 복원
  const lastHospitalRef = useRef<string | null>(hospital)
  useEffect(() => {
    if (hospital) lastHospitalRef.current = hospital
  }, [hospital])

  // ── 권한 프로브 (§8 — 읽기 전원, 로드 전엔 읽기 전용으로 렌더)
  const [capabilities, setCapabilities] = useState<Capabilities>(READ_ONLY_CAPABILITIES)
  useEffect(() => {
    let alive = true
    getCapabilities()
      .then((c) => alive && setCapabilities(c))
      .catch(() => alive && setCapabilities(READ_ONLY_CAPABILITIES))
    return () => {
      alive = false
    }
  }, [])

  // ── 커버리지 캐시(계약완료 딜 보유 ∪ 원장 보유 — 2026-09-02 모집단 축소) — 1요청으로 콤보 옵션 + 미선택 첫 표 페이지 겸용
  const [coverageCache, setCoverageCache] = useState<CoverageResponse | null>(null)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  /** mutation 후 콤보 라벨('배치 중 n대')·커버리지 표 갱신용 재조회 키 */
  const [optionsKey, setOptionsKey] = useState(0)
  const loadedOptionsKey = useRef(-1)

  useEffect(() => {
    if (view !== 'hospital') return // [디바이스] 뷰에서는 커버리지·콤보 모집단이 필요 없다 — [병원별] 진입 시 로드
    if (loadedOptionsKey.current === optionsKey) return
    loadedOptionsKey.current = optionsKey
    let alive = true
    ;(async () => {
      setOptionsLoading(true)
      try {
        const acc: CoverageRow[] = []
        let first: CoverageResponse | null = null
        let page = 1
        do {
          const r = await getCoverage({ page, limit: OPTIONS_PAGE_LIMIT, filter: 'all', sort: 'diff' })
          if (!first) first = r
          acc.push(...r.data)
          page += 1
        } while (first != null && acc.length < first.total && page <= OPTIONS_MAX_PAGES)
        if (!alive || !first) return
        setCoverageCache({ ...first, data: acc })
      } catch (e) {
        if (alive) notify(errorMessage(e, '병원 목록을 불러오지 못했습니다.'), 'error')
      } finally {
        if (alive) setOptionsLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [notify, optionsKey, view])

  /** 병원 콤보 옵션 — 커버리지 캐시에서 파생(병원명 정렬) */
  const options = useMemo<HospitalOption[]>(
    () =>
      (coverageCache?.data ?? [])
        .map((row) => ({ hospitalCode: row.hospitalCode, hospitalName: row.hospitalName, status: row.status, registered: row.registered, activeTotal: row.activeTotal }))
        .sort((a, b) => a.hospitalName.localeCompare(b.hospitalName, 'ko')),
    [coverageCache]
  )

  // URL 병원이 모집단 밖이면 단건 조회해 옵션에 합친다(§6.1 — 모집단과 무관하게 렌더)
  const [extraOption, setExtraOption] = useState<HospitalOption | null>(null)
  useEffect(() => {
    if (!hospital || optionsLoading) return
    if (options.some((o) => o.hospitalCode === hospital)) {
      setExtraOption(null)
      return
    }
    if (extraOption?.hospitalCode === hospital) return
    let alive = true
    getHospitalOption(hospital)
      .then((o) => alive && setExtraOption(o))
      .catch((e) => {
        if (!alive) return
        notify(errorMessage(e, '병원을 찾을 수 없습니다.'), 'error')
        url.setHospital(null)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospital, options, optionsLoading])

  const pickerOptions = useMemo(
    () => (extraOption && !options.some((o) => o.hospitalCode === extraOption.hospitalCode) ? [extraOption, ...options] : options),
    [options, extraOption]
  )

  // ── 병원 요약
  const [summary, setSummary] = useState<HospitalDeviceSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  useEffect(() => {
    if (!hospital) {
      setSummary(null)
      setSummaryError(null)
      return
    }
    let alive = true
    setSummaryLoading(true)
    getHospitalSummary(hospital)
      .then((s) => {
        if (!alive) return
        setSummary(s)
        setSummaryError(null)
      })
      .catch((e) => {
        if (!alive) return
        setSummary(null)
        setSummaryError(errorMessage(e, '요약을 불러오지 못했습니다.'))
      })
      .finally(() => alive && setSummaryLoading(false))
    return () => {
      alive = false
    }
  }, [hospital, reloadKey])

  // ── 탭 카운트(이력·임포트는 경량 조회, 목록은 표가 보고, 병동은 요약)
  const [counts, setCounts] = useState<{ list: number | null; history: number | null; imports: number | null }>({ list: null, history: null, imports: null })
  useEffect(() => {
    setCounts({ list: null, history: null, imports: null })
    if (!hospital) return
    let alive = true
    getEvents({ hospital, limit: 1 })
      .then((r) => alive && setCounts((c) => ({ ...c, history: r.total })))
      .catch(() => {})
    getImportBatches(hospital, { limit: 1 })
      .then((r) => alive && setCounts((c) => ({ ...c, imports: r.total })))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [hospital, reloadKey])

  // ── 로컬 필터(URL 키가 아닌 것) — 병원 바뀌면 초기화
  const [listLocal, setListLocal] = useState<ListLocal>(DEFAULT_LIST_LOCAL)
  const [eventLocal, setEventLocal] = useState<EventLocal>(DEFAULT_EVENT_LOCAL)
  const [selection, setSelectionState] = useState<Selection>(() => new Map())
  const [selectionNote, setSelectionNote] = useState<string | null>(null)
  /** v1: 체크박스 선택 모드 — [선택] 토글(기본 off) */
  const [selectMode, setSelectMode] = useState(false)
  const prevHospital = useRef(hospital)
  useEffect(() => {
    if (prevHospital.current === hospital) return
    prevHospital.current = hospital
    setListLocal(DEFAULT_LIST_LOCAL)
    setEventLocal(DEFAULT_EVENT_LOCAL)
    setSelectionState(new Map())
    setSelectionNote(null)
    setSelectMode(false)
  }, [hospital])

  const listFilters = useMemo<ListFilters>(
    () => ({ status: url.state.status, model: url.state.model, ward: url.state.ward, q: url.state.q, page: url.state.page, ...listLocal }),
    [url.state.status, url.state.model, url.state.ward, url.state.q, url.state.page, listLocal]
  )
  const setListFilters = useCallback(
    (patch: Partial<ListFilters>) => {
      const { status, model, ward, q, page, ...local } = patch
      if (Object.keys(local).length > 0) setListLocal((prev) => ({ ...prev, ...local }))
      const urlPatch: Partial<Pick<DevicesUrlState, 'status' | 'model' | 'ward' | 'q' | 'page'>> = {}
      if (status !== undefined) urlPatch.status = status
      if (model !== undefined) urlPatch.model = model
      if (ward !== undefined) urlPatch.ward = ward
      if (q !== undefined) urlPatch.q = q
      if (page !== undefined) urlPatch.page = page
      if (Object.keys(urlPatch).length > 0) url.setFilters(urlPatch)
      else if (Object.keys(local).length > 0 && url.state.page !== 1) url.setFilters({ page: 1 })
    },
    [url]
  )

  const eventFilters = useMemo<EventFilters>(() => ({ q: url.state.q, page: url.state.page, ...eventLocal }), [url.state.q, url.state.page, eventLocal])
  const setEventFilters = useCallback(
    (patch: Partial<EventFilters>) => {
      const { q, page, ...local } = patch
      if (Object.keys(local).length > 0) setEventLocal((prev) => ({ ...prev, ...local }))
      const urlPatch: Partial<Pick<DevicesUrlState, 'q' | 'page'>> = {}
      if (q !== undefined) urlPatch.q = q
      if (page !== undefined) urlPatch.page = page
      if (Object.keys(urlPatch).length > 0) url.setFilters(urlPatch)
      else if (Object.keys(local).length > 0 && url.state.page !== 1) url.setFilters({ page: 1 })
    },
    [url]
  )

  /** 병원 미선택 축약 커버리지 표 필터 — q/page는 URL, filter는 로컬 */
  const [coverageLocal, setCoverageLocal] = useState<CoverageLocal>(DEFAULT_COVERAGE_LOCAL)
  const coverageFilters = useMemo<CoverageFilters>(() => ({ q: url.state.q, page: url.state.page, ...coverageLocal }), [url.state.q, url.state.page, coverageLocal])
  const setCoverageFilters = useCallback(
    (patch: Partial<CoverageFilters>) => {
      const { q, page, ...local } = patch
      if (Object.keys(local).length > 0) setCoverageLocal((prev) => ({ ...prev, ...local }))
      const urlPatch: Partial<Pick<DevicesUrlState, 'q' | 'page'>> = {}
      if (q !== undefined) urlPatch.q = q
      if (page !== undefined) urlPatch.page = page
      if (Object.keys(urlPatch).length > 0) url.setFilters(urlPatch)
      else if (Object.keys(local).length > 0 && url.state.page !== 1) url.setFilters({ page: 1 })
    },
    [url]
  )

  /** [디바이스] 뷰 필터 — 전부 URL */
  const globalListFilters = useMemo<GlobalListFilters>(
    () => ({ status: url.state.status, model: url.state.model, usage: url.state.usage, productType: url.state.productType, q: url.state.q, page: url.state.page }),
    [url.state.status, url.state.model, url.state.usage, url.state.productType, url.state.q, url.state.page]
  )
  const setGlobalListFilters = useCallback((patch: Partial<GlobalListFilters>) => url.setFilters(patch), [url])

  // ── 선택
  const setSelection = useCallback((next: Selection) => {
    setSelectionState(next)
    if (next.size === 0) setSelectionNote(null)
  }, [])
  const clearSelection = useCallback(() => {
    setSelectionState(new Map())
    setSelectionNote(null)
  }, [])
  const selectedRefs = useMemo(() => Array.from(selection.values()).filter((v): v is DeviceRef => v != null), [selection])
  const selectedIds = useMemo(() => Array.from(selection.keys()), [selection])

  // ── mutation 후 재조회
  const onMutated = useCallback(() => {
    setReloadKey((k) => k + 1)
    setOptionsKey((k) => k + 1)
    router.refresh()
  }, [router])

  // ── 모달
  const [modal, setModal] = useState<ModalState>(null)
  const closeModal = useCallback(() => setModal(null), [])
  const onDone = useCallback(
    (r: MutationDone) => {
      notify(r.message, 'success', { details: r.warnings })
      setModal(null)
      clearSelection()
      onMutated()
      if (r.openDeviceId != null) url.setDevice(r.openDeviceId)
    },
    [notify, clearSelection, onMutated, url]
  )

  /** 등록·교체 폼은 모델·병동 옵션(summary)이 필요 — 요약 로드 전에는 안내만(모달을 '자동' 옵션만 있는 채로 열지 않음) */
  const summaryReady = summary != null
  const openRegister = useCallback(
    (serials?: string[]) => {
      if (!summaryReady) return notify(summaryError ? '병원 요약을 불러오지 못해 등록 폼을 열 수 없습니다. 새로고침 후 다시 시도하세요.' : '병원 요약을 불러온 뒤 사용할 수 있습니다.', 'info')
      setModal({ kind: 'register', initialSerials: serials && serials.length > 0 ? serials : undefined })
    },
    [summaryReady, summaryError, notify]
  )
  const openReplace = useCallback(
    (oldDevice: DeviceRef | null) => {
      if (!summaryReady) return notify(summaryError ? '병원 요약을 불러오지 못해 교체 폼을 열 수 없습니다. 새로고침 후 다시 시도하세요.' : '병원 요약을 불러온 뒤 사용할 수 있습니다.', 'info')
      setModal({ kind: 'replace', oldDevice })
    },
    [summaryReady, summaryError, notify]
  )

  const onAction = useCallback(
    (action: DeviceAction, ref: DeviceRef) => {
      // AS 표시/해제(B-24)는 병원 요약 문맥이 필요 없다 — 어느 뷰에서든 즉시 처리
      if (action === 'asOpen' || action === 'asClear') {
        if (ref.status !== 'ACTIVE') {
          notify('AS 표시는 배치 중(사용중) 기기에서만 가능합니다.', 'info')
          return
        }
        if (action === 'asOpen') {
          setModal({ kind: 'asOpen', device: ref })
          return
        }
        if (!window.confirm(`${ref.serialNo}의 AS진행중 표시를 해제할까요?`)) return
        clearDeviceAs(ref.id)
          .then(() => onDone({ message: `AS 해제: ${ref.serialNo}` }))
          .catch((e) => notify(errorMessage(e, 'AS 해제에 실패했습니다.'), 'error'))
        return
      }
      // 모달은 병원 문맥(요약·병동 옵션)이 필요 — [디바이스] 뷰(또는 병원 미선택)에서는 그 기기의 병원으로 전환 + 드로어 유지 후 다시 실행하도록 안내
      if (view !== 'hospital' || !hospital) {
        if (ref.hospitalCode) {
          url.setHospital(ref.hospitalCode, { device: ref.id })
          notify('병원별 뷰로 전환했습니다 — 드로어에서 다시 실행하세요.', 'info')
        } else notify('회수된 기기입니다 — [병원별] 뷰에서 병원을 선택한 뒤 실행하세요.', 'info')
        return
      }
      switch (action) {
        case 'move':
          setModal({ kind: 'move', devices: [ref], ids: [ref.id] })
          break
        case 'recover':
          setModal({ kind: 'recover', devices: [ref], ids: [ref.id] })
          break
        case 'replace':
          openReplace(ref)
          break
        case 'correct':
          setModal({ kind: 'correct', device: ref })
          break
      }
    },
    [view, hospital, url, notify, openReplace, onDone]
  )

  const openBulkMove = useCallback(() => setModal({ kind: 'move', devices: selectedRefs, ids: selectedIds, note: selectionNote }), [selectedRefs, selectedIds, selectionNote])
  const openBulkRecover = useCallback(
    (scanMode = false) => setModal({ kind: 'recover', devices: selectedRefs, ids: selectedIds, scanMode: scanMode && selectedIds.length === 0 }),
    [selectedRefs, selectedIds]
  )
  const openBulkProductType = useCallback(() => setModal({ kind: 'productType', devices: selectedRefs, ids: selectedIds, note: selectionNote }), [selectedRefs, selectedIds, selectionNote])
  const openBulkDeal = useCallback(() => setModal({ kind: 'deal', devices: selectedRefs, ids: selectedIds, note: selectionNote }), [selectedRefs, selectedIds, selectionNote])

  /** 병동 탭 [기기 일괄 이동] — 그 병동 배치 중 전체를 선택해 이동 모달 */
  const onBulkMoveWard = useCallback(
    async (wardId: number) => {
      if (!hospital) return
      try {
        const r = await getUnitIds({ hospital, ward: wardId, status: 'active' })
        if (r.ids.length === 0) {
          notify('이 병동에 배치 중인 기기가 없습니다.', 'info')
          return
        }
        const wardName = summary?.wards.find((w) => w.id === wardId)?.name ?? `#${wardId}`
        const next: Selection = new Map(r.ids.map((id) => [id, null]))
        setSelectionState(next)
        const note = `${wardName} 배치 중 전체 ${r.total.toLocaleString()}대${r.truncated ? ` 중 ${r.ids.length.toLocaleString()}대(상한 ${r.max.toLocaleString()})` : ''}`
        setSelectionNote(note)
        setModal({ kind: 'move', devices: [], ids: r.ids, note })
      } catch (e) {
        notify(errorMessage(e), 'error')
      }
    },
    [hospital, summary, notify]
  )

  const openHospital = useCallback((code: string) => url.setHospital(code), [url])
  const openImport = useCallback((code: string) => url.setHospital(code, { tab: 'import' }), [url])
  const openDevice = useCallback((id: number) => url.setDevice(id), [url])
  const closeDrawer = useCallback(() => url.setDevice(null), [url])

  // ── 파생값
  const canWrite = capabilities.canWrite
  const today = summary?.today ?? todayKst()
  const wardOptions = useMemo<WardOption[]>(() => (summary ? summary.wards.map(toWardOption) : []), [summary])
  const models = summary?.models ?? []

  /** 병원 뷰 Excel — 기기 목록/이력 탭 기준(헤더 전역 [Excel]은 v1에서 제거, [디바이스] 뷰는 DeviceListTab 자체 버튼) */
  const excelHref = useMemo(() => {
    if (!hospital) return null
    if (tab === 'list') return exportUnitsUrl({ hospital, ...listFilters })
    if (tab === 'history') return exportEventsUrl({ hospital, ...eventFilters })
    return null
  }, [hospital, tab, listFilters, eventFilters])

  const tabItems = useMemo<{ key: HospitalTab; label: string; count: number | null }[]>(() => {
    const list = counts.list ?? summary?.activeTotal ?? null
    return HOSPITAL_TABS.map((k) => ({
      key: k,
      label: HOSPITAL_TAB_LABELS[k],
      count: k === 'list' ? list : k === 'history' ? counts.history : k === 'wards' ? (summary ? summary.wards.length : null) : counts.imports,
    }))
  }, [counts, summary])

  const toggleSelectMode = useCallback(() => {
    setSelectMode((on) => {
      if (on) clearSelection()
      return !on
    })
  }, [clearSelection])

  const changeView = useCallback((v: DevicesView) => url.setView(v, { hospital: lastHospitalRef.current }), [url])

  return (
    <div className="px-4 py-6 md:px-6">
      <PageHeader title="디바이스 원장" actions={<ViewTabs active={view} onChange={changeView} />} />

      {view === 'hospital' ? (
        <>
          {/* 1행: 병원 콤보 … [+ 등록][임포트] */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">병원:</span>
            <HospitalPicker value={hospital} options={pickerOptions} loading={optionsLoading} onChange={(code) => url.setHospital(code)} className="w-full sm:w-96" />
            {hospital && canWrite && (
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" onClick={() => openRegister()} disabled={summaryLoading && !summaryReady} title={summaryReady ? undefined : '병원 요약 로드 후 사용 가능'}>
                  + 등록
                </Button>
                <Button size="sm" variant="outline" onClick={() => url.setTab('import')}>
                  임포트
                </Button>
              </div>
            )}
          </div>

          {hospital ? (
            <>
              {/* 2행: 계약건(딜)별 현황 표 (B-23 — 구 요약 한 줄 대체) */}
              <HospitalContractTable summary={summary} loading={summaryLoading} error={summaryError} onWardsClick={() => url.setTab('wards')} />

              {/* 3행: 소형 탭 + Excel·선택 토글 */}
              <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-b border-border">
                <TabBar items={tabItems} active={tab} onChange={url.setTab} />
                <div className="mb-1.5 flex items-center gap-1">
                  {tab === 'list' && canWrite && (
                    <Button size="sm" variant={selectMode ? 'secondary' : 'ghost'} onClick={toggleSelectMode} aria-pressed={selectMode} className="h-7 gap-1 text-xs" title="체크박스로 여러 기기를 골라 일괄 이동·회수·상품유형 지정">
                      <CheckSquare size={13} aria-hidden="true" />
                      선택{selectMode && selection.size > 0 ? ` (${selection.size.toLocaleString()})` : ''}
                    </Button>
                  )}
                  {excelHref && <ExcelButton href={excelHref} />}
                </div>
              </div>

              <div className="mt-3">
                {selectMode && <BulkActionBar count={selection.size} canWrite={canWrite} onMove={openBulkMove} onRecover={() => openBulkRecover(false)} onSetProductType={openBulkProductType} onSetDeal={openBulkDeal} onClear={clearSelection} note={selectionNote} />}

                {tab === 'list' && (
                  <DeviceTable
                    hospitalCode={hospital}
                    capabilities={capabilities}
                    summary={summary}
                    filters={listFilters}
                    setFilters={setListFilters}
                    selection={selection}
                    setSelection={setSelection}
                    onOpenDevice={openDevice}
                    onAction={onAction}
                    onRegister={openRegister}
                    onOpenTab={(t: HospitalTab) => url.setTab(t)}
                    onMutated={onMutated}
                    onTotalChange={(n) => setCounts((c) => (c.list === n ? c : { ...c, list: n }))}
                    reloadKey={reloadKey}
                    compact
                    showSelection={selectMode}
                  />
                )}
                {tab === 'history' && (
                  <EventsTab
                    hospitalCode={hospital}
                    filters={eventFilters}
                    setFilters={setEventFilters}
                    capabilities={capabilities}
                    onOpenDevice={openDevice}
                    onTotalChange={(n) => setCounts((c) => (c.history === n ? c : { ...c, history: n }))}
                    reloadKey={reloadKey}
                  />
                )}
                {tab === 'wards' && <WardPanel hospitalCode={hospital} capabilities={capabilities} onMutated={onMutated} onBulkMove={onBulkMoveWard} reloadKey={reloadKey} />}
                {tab === 'import' && (
                  <ImportPanel
                    hospitalCode={hospital}
                    capabilities={capabilities}
                    summary={summary}
                    onDone={onDone}
                    onTotalChange={(n) => setCounts((c) => (c.imports === n ? c : { ...c, imports: n }))}
                    reloadKey={reloadKey}
                  />
                )}
              </div>

              {/* 모달 — hospital 문맥 필요 */}
              <RegisterModal
                open={modal?.kind === 'register'}
                onClose={closeModal}
                hospitalCode={hospital}
                models={models}
                wards={wardOptions}
                deals={summary?.contractedDeals ?? []}
                today={today}
                initialSerials={modal?.kind === 'register' ? modal.initialSerials : undefined}
                onDone={onDone}
              />
              <MoveWardModal
                open={modal?.kind === 'move'}
                onClose={closeModal}
                hospitalCode={hospital}
                initialDevices={modal?.kind === 'move' ? modal.devices : []}
                initialDeviceIds={modal?.kind === 'move' ? modal.ids : []}
                wards={wardOptions}
                today={today}
                note={modal?.kind === 'move' ? modal.note : null}
                onDone={onDone}
              />
              <RecoverModal
                open={modal?.kind === 'recover'}
                onClose={closeModal}
                hospitalCode={hospital}
                initialDevices={modal?.kind === 'recover' ? modal.devices : []}
                initialDeviceIds={modal?.kind === 'recover' ? modal.ids : []}
                today={today}
                scanMode={modal?.kind === 'recover' ? modal.scanMode : false}
                onSwitchToReplace={openReplace}
                onDone={onDone}
              />
              <ReplaceModal
                open={modal?.kind === 'replace'}
                onClose={closeModal}
                hospitalCode={hospital}
                oldDevice={modal?.kind === 'replace' ? modal.oldDevice : null}
                models={models}
                wards={wardOptions}
                deals={summary?.contractedDeals ?? []}
                today={today}
                productTypeContext={summary?.productTypeContext ?? null}
                onDone={onDone}
              />
              <ProductTypeModal
                open={modal?.kind === 'productType'}
                onClose={closeModal}
                hospitalCode={hospital}
                devices={modal?.kind === 'productType' ? modal.devices : []}
                deviceIds={modal?.kind === 'productType' ? modal.ids : []}
                context={summary?.productTypeContext ?? null}
                today={today}
                note={modal?.kind === 'productType' ? modal.note : null}
                onDone={onDone}
              />
              <DealModal
                open={modal?.kind === 'deal'}
                onClose={closeModal}
                hospitalCode={hospital}
                devices={modal?.kind === 'deal' ? modal.devices : []}
                deviceIds={modal?.kind === 'deal' ? modal.ids : []}
                deals={summary?.deals ?? []}
                today={today}
                note={modal?.kind === 'deal' ? modal.note : null}
                onDone={onDone}
              />
            </>
          ) : (
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted-foreground">병원별 기기 현황 — 행을 클릭하면 그 병원의 기기 목록으로 이동합니다. 시리얼로 찾으려면 [디바이스] 탭에서 검색하세요.</p>
              <GlobalCoverage compact filters={coverageFilters} setFilters={setCoverageFilters} onOpenHospital={openHospital} onOpenImport={openImport} reloadKey={reloadKey} preloaded={coverageCache} preloadedLoading={optionsLoading} />
            </div>
          )}
        </>
      ) : (
        <DeviceListTab filters={globalListFilters} setFilters={setGlobalListFilters} onOpenDevice={openDevice} reloadKey={reloadKey} />
      )}

      {/* 드로어·정정·AS 표시 모달 — 병원 문맥 무관(양쪽 뷰 ?device= 딥링크) */}
      <DeviceHistoryDrawer deviceId={drawerDeviceId} onClose={closeDrawer} capabilities={capabilities} onMutated={onMutated} onAction={onAction} onOpenDevice={openDevice} reloadKey={reloadKey} />
      <CorrectionModal open={modal?.kind === 'correct'} onClose={closeModal} hospitalCode={hospital} device={modal?.kind === 'correct' ? modal.device : null} models={models} onDone={onDone} />
      <AsFlagModal open={modal?.kind === 'asOpen'} onClose={closeModal} device={modal?.kind === 'asOpen' ? modal.device : null} today={today} onDone={onDone} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 소형 컴포넌트 (orchestrator 소유)
// ─────────────────────────────────────────────────────────────────────────────

function TabBar({ items, active, onChange }: { items: { key: HospitalTab; label: string; count: number | null }[]; active: HospitalTab; onChange: (t: DevicesTab) => void }) {
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={active === it.key}
          onClick={() => onChange(it.key)}
          className={cn(
            'whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
            active === it.key ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
          )}
        >
          {it.label}
          {it.count != null && <span className="ml-1 tabular-nums text-muted-foreground">({it.count.toLocaleString()})</span>}
        </button>
      ))}
    </nav>
  )
}

/** 메인 탭 [병원별][디바이스] — 세그먼트 컨트롤(헤더 우측) */
function ViewTabs({ active, onChange }: { active: DevicesView; onChange: (v: DevicesView) => void }) {
  return (
    <div role="tablist" aria-label="보기" className="inline-flex rounded-md border border-border bg-card p-0.5 text-sm">
      {DEVICE_VIEWS.map((v) => {
        const on = active === v
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(v)}
            className={cn('rounded px-3 py-1 font-medium transition-colors', on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
          >
            {DEVICE_VIEW_LABELS[v]}
          </button>
        )
      })}
    </div>
  )
}

/** B-25 모델 셀 — '도입 n / 등록 m'. 도입 null은 '—', 폴백 ECG 셀은 ⓘ(디바이스수 기준) */
function ModelPairCell({ exp, act, fallback, warn }: { exp: number | null; act: number; fallback?: boolean; warn?: boolean }) {
  return (
    <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">
      <span className={cn(exp == null && 'text-muted-foreground', warn && 'text-warning-subtle-foreground')} title={fallback && exp != null ? '모델별 수량 미입력 — 디바이스수 기준' : undefined}>
        {exp != null ? exp.toLocaleString() : '—'}
        {fallback && exp != null && (
          <span aria-hidden="true" className="ml-0.5 text-muted-foreground">
            ⓘ
          </span>
        )}
      </span>
      <span className="text-muted-foreground"> / </span>
      <span>{act.toLocaleString()}</span>
    </td>
  )
}

/** 모바일 압축 표기 — 'E 100/98' */
function pairText(exp: number | null, act: number): string {
  return `${exp != null ? exp.toLocaleString() : '—'}/${act.toLocaleString()}`
}

/**
 * 병원 뷰 상단 — 계약건(딜)별 현황 표(B-23·B-25, 2026-09-02 — 구 '요약 한 줄' 대체)
 * 열: 계약건 | 유형 | 심전계(도입/등록) | 산소포화도(도입/등록) | 혈압계(도입/등록) | 교체 건수.
 * 도입 = 딜 모델별 수량(sales_deal_devices) 1순위 — 행 없는 폴백 딜은 심전계 도입=디바이스수 ⓘ. 등록 = 그 딜 × 모델 배치 중.
 * 딜 없는 배치·교체가 있으면 '(미지정)' 행, 마지막 합계 행의 ⓘ가 구 요약 팝오버(모델별 대조·근거 딜·상품유형별·교체 집계)를 연다.
 * AS진행중 n 칩(B-24)·상품유형 혼합 배지는 헤더 줄. 모바일(sm 미만)은 딜당 'E 100/98 · S 50/50' 압축 줄.
 */
function HospitalContractTable({ summary, loading, error, onWardsClick }: { summary: HospitalDeviceSummary | null; loading: boolean; error: string | null; onWardsClick: () => void }) {
  const [popAnchor, setPopAnchor] = useState<HTMLElement | null>(null)
  const closePop = useCallback(() => setPopAnchor(null), [])

  const models = summary?.models ?? []
  const deals = summary?.contractedDeals ?? []
  const expected = summary?.expectedDeviceCount ?? null
  const hardModels = models.filter((m) => m.compare === 'hard')
  const hasDiff = hardModels.some((m) => m.diff != null && m.diff !== 0)
  /** B-25 합계 재료 — 도입 = Σ deals[].expectedByModel(전부 null이면 '—'), 등록 = 모델 요약 active(미지정 포함) */
  const dealRowsAll = summary?.deals ?? []
  const sumExpectedOf = (k: 'ecg' | 'spo2' | 'bp'): number | null => {
    let has = false
    let s = 0
    for (const d of dealRowsAll) {
      const v = d.expectedByModel?.[k]
      if (v != null) {
        has = true
        s += v
      }
    }
    return has ? s : null
  }
  const totalActiveOf = (t: number): number => models.find((m) => m.onpremDeviceType === t)?.active ?? 0
  const activeTitle = models.length > 0 ? models.map((m) => `${m.deviceName} ${m.active.toLocaleString()}${(m.activeEval ?? 0) > 0 ? ` (평가용 ${m.activeEval.toLocaleString()})` : ''}`).join(' · ') : undefined
  const ptKeys = summary ? Object.keys(summary.replacements?.byType ?? {}) : []

  return (
    <div className="mt-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground" aria-label="계약 현황">
      {loading && !summary ? (
        <span className="text-xs text-muted-foreground">요약 불러오는 중…</span>
      ) : !summary ? (
        <span className="text-xs text-destructive">{error ?? '요약을 불러올 수 없습니다.'}</span>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-semibold">계약 현황</span>
            {summary.asInProgress > 0 && (
              <Badge variant="warning" className="tabular-nums" title="AS진행중 표시가 켜진 배치 중 기기 — 기기 목록 [필터 더보기]의 'AS진행중만'으로 조회">
                AS진행중 {summary.asInProgress.toLocaleString()}
              </Badge>
            )}
            {summary.productTypeContext?.mixed && (
              <Badge variant="primary" title="계약완료 딜에 일반·라이트가 함께 있는 병원 — 등록 시 상품유형 선택 필수">
                상품유형 혼합
              </Badge>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-muted-foreground">
              <span title={activeTitle}>
                배치 중 {summary.activeTotal.toLocaleString()}
                {(summary.evalTotal ?? 0) > 0 ? ` (평가용 ${summary.evalTotal.toLocaleString()})` : ''}
              </span>
              <span title="최근 30일 회수(업무일자 기준)">회수 {summary.recovered30dTotal.toLocaleString()}</span>
              <button type="button" onClick={onWardsClick} className="rounded underline-offset-2 hover:underline" title={summary.unassigned > 0 ? `병동 미지정 ${summary.unassigned.toLocaleString()}대 — 병동 탭` : '병동 탭'}>
                병동 {summary.wards.length.toLocaleString()}
                {summary.unassigned > 0 ? ` (미지정 ${summary.unassigned.toLocaleString()})` : ''}
              </button>
            </span>
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[34rem] text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-1 pr-2 text-left font-medium">계약건</th>
                  <th className="py-1 pr-2 text-left font-medium">유형</th>
                  <th className="py-1 pr-2 text-right font-medium" title="심전계 — 도입(딜 모델별 수량, 미입력 딜은 디바이스수 ⓘ) / 등록(이 계약건 배치 중)">
                    심전계 <span className="font-normal">도입/등록</span>
                  </th>
                  <th className="py-1 pr-2 text-right font-medium" title="산소포화도 — 도입(딜 모델별 수량) / 등록(이 계약건 배치 중)">
                    산소포화도 <span className="font-normal">도입/등록</span>
                  </th>
                  <th className="py-1 pr-2 text-right font-medium" title="링 혈압계(CART BP) — 도입(딜 모델별 수량) / 등록(이 계약건 배치 중)">
                    혈압계 <span className="font-normal">도입/등록</span>
                  </th>
                  <th className="py-1 text-right font-medium" title="회수 시점 계약건 기준 교체 짝 수">교체 건수</th>
                </tr>
              </thead>
              <tbody>
                {summary.deals.map((d) => (
                  <tr key={d.dealCode} className="border-b border-border/60">
                    <td className="py-1 pr-2 font-mono">
                      {d.dealCode}
                      {d.roundNo != null ? (
                        <span className="ml-1 font-sans text-muted-foreground">({d.roundNo}차)</span>
                      ) : (
                        <span className="ml-1 font-sans text-warning-subtle-foreground" title="계약완료 딜 목록에 없는 코드 — 딜 재적재로 끊겼거나 지정 오류(계약건 지정으로 정리)">
                          (계약 외)
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2">{d.productType ? <Badge variant={productTypeBadgeVariant(d.productType) ?? 'default'}>{d.productType}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                    <ModelPairCell exp={d.expectedByModel?.ecg ?? null} act={d.activeByModel.ecg} fallback={d.expectedSource === 'fallback'} />
                    <ModelPairCell exp={d.expectedByModel?.spo2 ?? null} act={d.activeByModel.spo2} />
                    <ModelPairCell exp={d.expectedByModel?.bp ?? null} act={d.activeByModel.bp} />
                    <td className="py-1 text-right tabular-nums">{d.replacements.toLocaleString()}</td>
                  </tr>
                ))}
                {(summary.dealUnassigned.active > 0 || summary.dealUnassigned.replacements > 0) && (
                  <tr className="border-b border-border/60 text-muted-foreground">
                    <td className="py-1 pr-2" title="계약건이 지정되지 않은 배치·교체 — 선택 바 [계약건 지정]으로 정리">(미지정)</td>
                    <td className="py-1 pr-2">—</td>
                    <ModelPairCell exp={null} act={summary.dealUnassigned.activeByModel.ecg} />
                    <ModelPairCell exp={null} act={summary.dealUnassigned.activeByModel.spo2} />
                    <ModelPairCell exp={null} act={summary.dealUnassigned.activeByModel.bp} />
                    <td className="py-1 text-right tabular-nums">{summary.dealUnassigned.replacements.toLocaleString()}</td>
                  </tr>
                )}
                {summary.deals.length === 0 && summary.dealUnassigned.active === 0 && summary.dealUnassigned.replacements === 0 && (
                  <tr className="border-b border-border/60">
                    <td colSpan={6} className="py-1.5 text-muted-foreground">
                      계약완료 딜·등록 기기가 없습니다 — 등록·임포트에서 계약건을 지정할 수 있습니다.
                    </td>
                  </tr>
                )}
                <tr className="font-medium">
                  <td className="py-1 pr-2">
                    합계
                    <button
                      type="button"
                      onClick={(e) => {
                        const el = e.currentTarget
                        setPopAnchor((prev) => (prev ? null : el))
                      }}
                      aria-expanded={popAnchor != null}
                      aria-label="모델별 대조 상세"
                      className="ml-1 inline-flex items-center rounded align-middle text-muted-foreground hover:text-primary"
                      title="모델별 대조·근거 딜·상품유형별·교체 집계 보기"
                    >
                      <Info size={12} aria-hidden="true" />
                    </button>
                  </td>
                  <td className="py-1 pr-2" />
                  <ModelPairCell exp={sumExpectedOf('ecg')} act={totalActiveOf(1)} warn={hasDiff} />
                  <ModelPairCell exp={sumExpectedOf('spo2')} act={totalActiveOf(3)} />
                  <ModelPairCell exp={sumExpectedOf('bp')} act={totalActiveOf(10)} />
                  <td className="py-1 text-right tabular-nums">{summary.replacements.total.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* 모바일 — 딜당 압축 줄 'E 도입/등록 · S … · BP … · 교체 n' */}
          <ul className="space-y-1.5 text-xs sm:hidden">
            {summary.deals.map((d) => (
              <li key={d.dealCode} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono">{d.dealCode}</span>
                {d.productType && <Badge variant={productTypeBadgeVariant(d.productType) ?? 'default'}>{d.productType}</Badge>}
                <span className="tabular-nums text-muted-foreground">
                  E {pairText(d.expectedByModel?.ecg ?? null, d.activeByModel.ecg)}
                  {d.expectedSource === 'fallback' && 'ⓘ'} · S {pairText(d.expectedByModel?.spo2 ?? null, d.activeByModel.spo2)} · BP {pairText(d.expectedByModel?.bp ?? null, d.activeByModel.bp)} · 교체 {d.replacements}
                </span>
              </li>
            ))}
            {(summary.dealUnassigned.active > 0 || summary.dealUnassigned.replacements > 0) && (
              <li className="tabular-nums text-muted-foreground">
                (미지정) E —/{summary.dealUnassigned.activeByModel.ecg} · S —/{summary.dealUnassigned.activeByModel.spo2} · BP —/{summary.dealUnassigned.activeByModel.bp} · 교체 {summary.dealUnassigned.replacements}
              </li>
            )}
            <li className="flex items-center gap-1 font-medium tabular-nums">
              합계 E {pairText(sumExpectedOf('ecg'), totalActiveOf(1))} · S {pairText(sumExpectedOf('spo2'), totalActiveOf(3))} · BP {pairText(sumExpectedOf('bp'), totalActiveOf(10))} · 교체 {summary.replacements.total}
              <button
                type="button"
                onClick={(e) => {
                  const el = e.currentTarget
                  setPopAnchor((prev) => (prev ? null : el))
                }}
                aria-expanded={popAnchor != null}
                aria-label="모델별 대조 상세"
                className="inline-flex items-center rounded text-muted-foreground hover:text-primary"
              >
                <Info size={12} aria-hidden="true" />
              </button>
            </li>
          </ul>

          <RegistryFloatingPanel open={popAnchor != null} anchor={popAnchor} onClose={closePop} align="left" className="w-96 max-w-[calc(100vw-1rem)] p-3 text-xs" keepOnScroll>
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
              <Info size={14} className="text-muted-foreground" />
              계약 대조
            </div>
            {/* 모델별 대조 */}
            <table className="mb-2 w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="py-0.5 text-left font-medium">모델</th>
                  <th className="py-0.5 text-right font-medium">배치(대조)</th>
                  <th className="py-0.5 text-right font-medium">계약</th>
                  <th className="py-0.5 text-right font-medium">차이</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.deviceInfoId}>
                    <td className="py-0.5">{modelLabel(m.deviceName, m.deviceModel)}</td>
                    <td className="py-0.5 text-right tabular-nums">
                      {(m.compare === 'none' ? m.active : (m.activeForCompare ?? m.active)).toLocaleString()}
                      {(m.activeEval ?? 0) > 0 && <span className="ml-1 text-warning-subtle-foreground">(+평가용 {m.activeEval.toLocaleString()})</span>}
                    </td>
                    <td className="py-0.5 text-right tabular-nums">
                      {m.compare === 'hard' ? (m.expected == null ? '—' : m.expected.toLocaleString()) : m.compare === 'soft' ? <span className="text-muted-foreground">{m.expected == null ? '—' : `(참고 ${m.expected.toLocaleString()})`}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={cn('py-0.5 text-right tabular-nums', m.compare === 'hard' && m.diff != null && (m.diff === 0 ? 'text-success-subtle-foreground' : 'font-medium text-warning-subtle-foreground'))}>
                      {m.compare === 'hard' && m.diff != null ? diffText(m.diff) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
                {models.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-1 text-muted-foreground">
                      시리얼 추적 대상 모델이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {/* 근거 딜 */}
            <div className="mb-1 font-medium">계약 근거 딜(계약완료)</div>
            {deals.length > 0 ? (
              <ul className="mb-2 space-y-1">
                {deals.map((d) => (
                  <li key={d.dealCode} className="flex items-center justify-between gap-2">
                    <Link href={`/hospitals/${encodeURIComponent(summary.hospitalCode)}`} className="text-primary hover:underline" onClick={closePop}>
                      {fmtDeal(d)}
                    </Link>
                    <span className="font-mono text-[11px] text-muted-foreground">{d.dealCode}</span>
                  </li>
                ))}
                <li className="border-t border-border pt-1 text-right font-medium tabular-nums">합계 {expected == null ? '—' : `${expected.toLocaleString()}대`}</li>
              </ul>
            ) : (
              <p className="mb-2 text-muted-foreground">— (계약완료 딜 없음)</p>
            )}
            {/* 상품유형별 */}
            {summary.productTypeContext && summary.productTypeContext.byType.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1 text-muted-foreground">
                상품유형:
                {summary.productTypeContext.byType.map((b) => (
                  <span key={b.type} className="inline-flex items-center gap-1">
                    <Badge variant={productTypeBadgeVariant(b.type) ?? 'default'}>{b.type}</Badge>
                    <span className="tabular-nums">{b.devices.toLocaleString()}대 ({b.deals}건)</span>
                  </span>
                ))}
                {summary.productTypeContext.mixed && <span>— 혼합(등록 시 선택 필수)</span>}
              </div>
            )}
            {summary.productTypeMixed && summary.productTypes.length > 0 && (
              <div className="mb-2 text-muted-foreground">
                유형별 대조(ECG):{' '}
                {summary.productTypes.map((t) => `${t.type} ${t.activeForCompare.toLocaleString()}/${t.expected == null ? '—' : t.expected.toLocaleString()}${t.diff != null ? ` (${diffText(t.diff)})` : ''}`).join(' · ')}
              </div>
            )}
            {/* 교체 집계 */}
            {summary.replacements && (summary.productTypeMixed || summary.replacements.total > 0) && (
              <div className="mb-2 tabular-nums text-muted-foreground" title="교체 = 같은 병원 RECOVER와 짝지어진 교체 등록(REGISTER) 건수 — RECOVER 시점 상품유형 기준">
                교체: 전체 {summary.replacements.total.toLocaleString()}
                {summary.productTypeMixed && ptKeys.length > 0 && (
                  <>
                    {' '}
                    ({ptKeys
                      .filter((k) => k !== PRODUCT_TYPE_UNSET_LABEL || (summary.replacements.byType[k as keyof typeof summary.replacements.byType] ?? 0) > 0)
                      .map((k) => `${k} ${(summary.replacements.byType[k as keyof typeof summary.replacements.byType] ?? 0).toLocaleString()}`)
                      .join(' · ')})
                  </>
                )}{' '}
                · 최근 30일 {summary.replacements.last30d.total.toLocaleString()}
              </div>
            )}
            <p className="text-muted-foreground">
              계약 = 계약완료 딜의 대웅 디바이스 수 합(ECG 기준). SpO2는 참고(ECG 동수 가정), GW는 계약 축 없음. 도입 병상 수와 무관합니다. 배치(대조)·차이는 평가용(EVAL) 기기를 제외한 수입니다.
            </p>
            <p className="mt-1 text-muted-foreground">대조는 참고 신호입니다 — 차이가 있어도 딜 데이터 정정 요청 대상이 아니며, 원장 등록·회수 누락 여부를 먼저 확인하세요.</p>
          </RegistryFloatingPanel>
        </>
      )}
    </div>
  )
}
