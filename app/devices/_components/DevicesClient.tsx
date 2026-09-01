'use client'

/**
 * /devices 오케스트레이터 (projects/hospital_device_registry_design.md §6.1)
 *
 * 소유: 권한 프로브 · 병원 옵션(커버리지 모집단) · URL 상태(useDevicesUrlState) · 로컬 필터(정렬·WMS·기간 등) · 선택(Map) · 요약 · 탭 카운트 · 모달 · 토스트.
 * 자식은 props/콜백으로만 통신:
 *   - onMutated()           : 요약·활성 탭·드로어 재조회(reloadKey++) + router.refresh()
 *   - onDone(MutationDone)  : 토스트 + 모달 닫기 + 선택 해제 + onMutated (+ openDeviceId면 드로어)
 *   - onAction(action, ref) : 행 ⋯/드로어/모바일 → 모달 열기
 *   - onOpenDevice(id)      : URL ?device= 드로어
 * 헤더: 디바이스 원장 · [Excel](활성 탭 기준) · 시리얼 조회 · 병원 콤보
 * 병원 미선택: 요약 줄 + 탭 [병원 커버리지][최근 이벤트] / 선택: SummaryStrip + 탭 [기기 목록 (n)][이력 (n)][병동 (n)][임포트 (n)] + 액션(USER+) + 선택 바
 *
 * P3-0 스켈레톤 소유 파일 — P3 Verify(2026-09-01)에서 배선 보강: 등록 프리필(RECOVERED 재등록)·요약 로드 전 등록/교체 가드·드로어 onOpenDevice·전역 최근 이벤트 기본 30일·콤보 '배치 중 n대'.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/app/components/ui/PageHeader'
import Button from '@/app/components/ui/Button'
import { cn } from '@/lib/cn'
import { todayKst } from '@/lib/deviceRegistryShared'
import { errorMessage, exportCoverageUrl, exportEventsUrl, exportUnitsUrl, getCapabilities, getCoverage, getEvents, getHospitalOption, getHospitalSummary, getImportBatches, getUnitIds } from './api'
import { DevicesToastProvider, useDevicesToast } from './toast'
import { defaultGlobalEventFrom } from './groupd-shared'
import { useDevicesUrlState, type DevicesUrlState } from './useDevicesUrlState'
import {
  GLOBAL_TABS,
  GLOBAL_TAB_LABELS,
  HOSPITAL_TABS,
  HOSPITAL_TAB_LABELS,
  READ_ONLY_CAPABILITIES,
  toWardOption,
  type Capabilities,
  type CoverageFilters,
  type CoverageTotals,
  type DeviceAction,
  type DeviceRef,
  type DevicesTab,
  type EventFilters,
  type HospitalDeviceSummary,
  type HospitalOption,
  type HospitalTab,
  type ListFilters,
  type LookupNavigateTarget,
  type MutationDone,
  type Selection,
  type WardOption,
} from './types'
import { HospitalPicker } from './HospitalPicker'
import { SerialLookup } from './SerialLookup'
import { GlobalCoverage } from './GlobalCoverage'
import { ExcelButton } from './ExcelButton'
import { SummaryStrip } from './SummaryStrip'
import { DeviceTable } from './DeviceTable'
import { BulkActionBar } from './BulkActionBar'
import { DeviceHistoryDrawer } from './DeviceHistoryDrawer'
import { CorrectionModal } from './CorrectionModal'
import { ProductTypeModal } from './ProductTypeModal'
import { RegisterModal } from './RegisterModal'
import { MoveWardModal } from './MoveWardModal'
import { RecoverModal } from './RecoverModal'
import { ReplaceModal } from './ReplaceModal'
import { MobileActionBar } from './MobileActionBar'
import { ImportPanel } from './ImportPanel'
import { WardPanel } from './WardPanel'
import { EventsTab } from './EventsTab'

export interface DevicesClientProps {
  /** page.tsx가 searchParams를 parseDevicesParams로 파싱해 전달(첫 렌더 일치용) */
  initialParams: DevicesUrlState
}

/** 커버리지 모집단 로드 — limit 200씩, total까지(최대 10페이지) */
const OPTIONS_PAGE_LIMIT = 200
const OPTIONS_MAX_PAGES = 10

type ModalState =
  | { kind: 'register'; initialSerials?: string[] }
  | { kind: 'move'; devices: DeviceRef[]; ids: number[]; note?: string | null }
  | { kind: 'recover'; devices: DeviceRef[]; ids: number[]; scanMode?: boolean }
  | { kind: 'replace'; oldDevice: DeviceRef | null }
  | { kind: 'correct'; device: DeviceRef }
  | { kind: 'productType'; devices: DeviceRef[]; ids: number[]; note?: string | null }
  | null

type ListLocal = Pick<ListFilters, 'limit' | 'sort' | 'wms' | 'usage' | 'productType'>
type EventLocal = Omit<EventFilters, 'q' | 'page'>
type CoverageLocal = Pick<CoverageFilters, 'filter' | 'sort' | 'limit'>

const DEFAULT_LIST_LOCAL: ListLocal = { limit: 50, sort: 'ward', wms: null, usage: null, productType: null }
const DEFAULT_EVENT_LOCAL: EventLocal = { limit: 50, type: null, from: null, to: null, refType: null, source: null }
/** 이벤트 로컬 필터 기본값 — 전역 '최근 이벤트'는 기본 30일(§6.1-A), 병원 이력은 전체 기간 */
function defaultEventLocal(hospital: string | null): EventLocal {
  return hospital ? DEFAULT_EVENT_LOCAL : { ...DEFAULT_EVENT_LOCAL, from: defaultGlobalEventFrom() }
}
const DEFAULT_COVERAGE_LOCAL: CoverageLocal = { filter: 'all', sort: 'diff', limit: 50 }

function fmtInt(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString()
}

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
  const { hospital, tab, device: drawerDeviceId } = url.state

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

  // ── 병원 옵션(고객 ∪ 원장 보유) + 전역 요약 totals — 커버리지 엔드포인트 페이징
  const [options, setOptions] = useState<HospitalOption[]>([])
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [totals, setTotals] = useState<CoverageTotals | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [totalsKey, setTotalsKey] = useState(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setOptionsLoading(true)
      try {
        const acc: HospitalOption[] = []
        let page = 1
        let total = 0
        let lastTotals: CoverageTotals | null = null
        do {
          const r = await getCoverage({ page, limit: OPTIONS_PAGE_LIMIT, filter: 'all', sort: 'name' })
          total = r.total
          lastTotals = r.totals
          acc.push(
            ...r.data.map((row) => ({ hospitalCode: row.hospitalCode, hospitalName: row.hospitalName, status: row.status, registered: row.registered, activeTotal: row.activeTotal }))
          )
          page += 1
        } while (acc.length < total && page <= OPTIONS_MAX_PAGES)
        if (!alive) return
        setOptions(acc)
        setTotals(lastTotals)
      } catch (e) {
        if (alive) notify(errorMessage(e, '병원 목록을 불러오지 못했습니다.'), 'error')
      } finally {
        if (alive) setOptionsLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [notify, totalsKey])

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
  const hospitalName = useMemo(() => pickerOptions.find((o) => o.hospitalCode === hospital)?.hospitalName ?? hospital ?? null, [pickerOptions, hospital])

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
  const [eventLocal, setEventLocal] = useState<EventLocal>(() => defaultEventLocal(initialParams.hospital))
  const [coverageLocal, setCoverageLocal] = useState<CoverageLocal>(DEFAULT_COVERAGE_LOCAL)
  const [selection, setSelectionState] = useState<Selection>(() => new Map())
  const [selectionNote, setSelectionNote] = useState<string | null>(null)
  const prevHospital = useRef(hospital)
  useEffect(() => {
    if (prevHospital.current === hospital) return
    prevHospital.current = hospital
    setListLocal(DEFAULT_LIST_LOCAL)
    setEventLocal(defaultEventLocal(hospital))
    setSelectionState(new Map())
    setSelectionNote(null)
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
    setTotalsKey((k) => k + 1)
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
    [openReplace]
  )

  const openBulkMove = useCallback(() => setModal({ kind: 'move', devices: selectedRefs, ids: selectedIds, note: selectionNote }), [selectedRefs, selectedIds, selectionNote])
  const openBulkRecover = useCallback(
    (scanMode = false) => setModal({ kind: 'recover', devices: selectedRefs, ids: selectedIds, scanMode: scanMode && selectedIds.length === 0 }),
    [selectedRefs, selectedIds]
  )
  const openBulkProductType = useCallback(() => setModal({ kind: 'productType', devices: selectedRefs, ids: selectedIds, note: selectionNote }), [selectedRefs, selectedIds, selectionNote])

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

  /** 시리얼 조회 → 병원 전환 + 드로어(§6.1) */
  const onLookupNavigate = useCallback(
    (t: LookupNavigateTarget) => {
      if (t.hospitalCode) url.setHospital(t.hospitalCode, { status: t.status === 'RECOVERED' ? 'recovered' : 'active', device: t.deviceId })
      else url.setState({ device: t.deviceId })
    },
    [url]
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

  const excelHref = useMemo(() => {
    if (hospital) {
      if (tab === 'list') return exportUnitsUrl({ hospital, ...listFilters })
      if (tab === 'history') return exportEventsUrl({ hospital, ...eventFilters })
      return null
    }
    if (tab === 'coverage') return exportCoverageUrl({ filter: coverageFilters.filter, q: coverageFilters.q, sort: coverageFilters.sort })
    if (tab === 'events') return exportEventsUrl({ ...eventFilters })
    return null
  }, [hospital, tab, listFilters, eventFilters, coverageFilters])

  const tabItems = useMemo<{ key: DevicesTab; label: string; count: number | null }[]>(() => {
    if (hospital) {
      const list = counts.list ?? summary?.activeTotal ?? null
      return HOSPITAL_TABS.map((k) => ({
        key: k,
        label: HOSPITAL_TAB_LABELS[k],
        count: k === 'list' ? list : k === 'history' ? counts.history : k === 'wards' ? (summary ? summary.wards.length : null) : counts.imports,
      }))
    }
    return GLOBAL_TABS.map((k) => ({ key: k, label: GLOBAL_TAB_LABELS[k], count: null }))
  }, [hospital, counts, summary])

  return (
    <div className={cn('px-4 py-6 md:px-6', hospital && canWrite && 'pb-24 md:pb-6')}>
      <PageHeader
        title="디바이스 원장"
        description={hospitalName ? `${hospitalName} — 시리얼 단위 배치·회수·교체 이력` : '병원별 시리얼 원장 — 병원을 선택하면 기기 목록·이력·병동·임포트를 봅니다'}
        actions={
          <>
            <ExcelButton href={excelHref} />
            <SerialLookup onNavigate={onLookupNavigate} />
          </>
        }
      />

      {/* 병원 콤보 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">병원:</span>
        <HospitalPicker value={hospital} options={pickerOptions} loading={optionsLoading} onChange={(code) => url.setHospital(code)} className="w-full sm:w-96" />
        {hospital && (
          <Button size="sm" variant="ghost" onClick={() => url.setHospital(null)}>
            전역 뷰로
          </Button>
        )}
      </div>

      {hospital ? (
        <>
          <SummaryStrip summary={summary} loading={summaryLoading} error={summaryError} onWardsClick={() => url.setTab('wards')} />

          {/* 탭 바 + 액션 */}
          <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-b border-border">
            <TabBar items={tabItems} active={tab} onChange={url.setTab} />
            {canWrite && (
              <div className="mb-2 hidden items-center gap-2 md:flex">
                <Button size="sm" onClick={() => openRegister()} disabled={summaryLoading && !summaryReady} title={summaryReady ? undefined : '병원 요약 로드 후 사용 가능'}>
                  + 등록
                </Button>
                <Button size="sm" variant="outline" onClick={() => openReplace(null)} disabled={summaryLoading && !summaryReady} title={summaryReady ? undefined : '병원 요약 로드 후 사용 가능'}>
                  교체
                </Button>
                <Button size="sm" variant="outline" onClick={() => url.setTab('import')}>
                  임포트
                </Button>
              </div>
            )}
          </div>

          <div className="mt-3">
            <BulkActionBar count={selection.size} canWrite={canWrite} onMove={openBulkMove} onRecover={() => openBulkRecover(false)} onSetProductType={openBulkProductType} onClear={clearSelection} note={selectionNote} />

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

          <MobileActionBar
            canWrite={canWrite}
            selectedCount={selection.size}
            onRegister={() => openRegister()}
            onReplace={() => openReplace(null)}
            onRecover={() => openBulkRecover(true)}
          />

          {/* 모달 — hospital 문맥 필요 */}
          <RegisterModal
            open={modal?.kind === 'register'}
            onClose={closeModal}
            hospitalCode={hospital}
            models={models}
            wards={wardOptions}
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
        </>
      ) : (
        <>
          <GlobalTotalsLine totals={totals} loading={optionsLoading} />
          <div className="mt-4 border-b border-border">
            <TabBar items={tabItems} active={tab} onChange={url.setTab} />
          </div>
          <div className="mt-3">
            {tab === 'coverage' && <GlobalCoverage filters={coverageFilters} setFilters={setCoverageFilters} onOpenHospital={openHospital} onOpenImport={openImport} reloadKey={reloadKey} />}
            {tab === 'events' && (
              <EventsTab hospitalCode={null} filters={eventFilters} setFilters={setEventFilters} capabilities={capabilities} onOpenDevice={openDevice} reloadKey={reloadKey} />
            )}
          </div>
        </>
      )}

      {/* 드로어·정정 모달 — 병원 문맥 무관(시리얼 조회로 전역에서도 열림) */}
      <DeviceHistoryDrawer deviceId={drawerDeviceId} onClose={closeDrawer} capabilities={capabilities} onMutated={onMutated} onAction={onAction} onOpenDevice={openDevice} reloadKey={reloadKey} />
      <CorrectionModal open={modal?.kind === 'correct'} onClose={closeModal} hospitalCode={hospital} device={modal?.kind === 'correct' ? modal.device : null} models={models} onDone={onDone} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 소형 컴포넌트 (orchestrator 소유)
// ─────────────────────────────────────────────────────────────────────────────

function TabBar({ items, active, onChange }: { items: { key: DevicesTab; label: string; count: number | null }[]; active: DevicesTab; onChange: (t: DevicesTab) => void }) {
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

/** 전역 요약 줄(§6.1-A) — 커버리지 totals(옵션 로드 응답 재사용, 별도 조회 없음) */
function GlobalTotalsLine({ totals, loading }: { totals: CoverageTotals | null; loading: boolean }) {
  const t = totals
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
      <span className="mr-2 text-muted-foreground">요약:</span>
      {loading && !t ? (
        <span className="text-muted-foreground">불러오는 중…</span>
      ) : (
        <span className="inline-flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
          <span>고객 병원 {fmtInt(t?.customerHospitals)}</span>
          <span>· 원장 등록 병원 {fmtInt(t?.registeredHospitals)}</span>
          <span>
            · 배치 중 ECG {fmtInt(t?.active.ecg)} / SpO2 {fmtInt(t?.active.spo2)} / GW {fmtInt(t?.active.gw)} / 제3자 {fmtInt(t?.active.third)}
          </span>
          <span>· 최근 30일 이벤트 {fmtInt(t?.events30d)}</span>
          <span>· 회수(30일) {fmtInt(t?.recovered30d)}</span>
        </span>
      )}
    </div>
  )
}
