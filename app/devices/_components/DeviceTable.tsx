'use client'

/**
 * 기기 목록 탭 (§6.1-B) — GROUP B
 * 필터: 상태(● 배치 중 / 회수됨(미재배치) / 전체) · 모델 칩(summary.models) · 병동(summary.wards + 미지정 + 폐쇄 포함) · 시리얼 검색(키·원문·닉네임, 디바운스 → setFilters({q})) · WMS(linked/unlinked/in_stock)
 * 컬럼: ☐ | 시리얼(mono, ⚠형식 불일치 = matchesSerialPattern(serialNo, deviceInfo.serialPattern)===false, 원문 2행) | 모델 | 용도(판매용 default·평가용 warning 배지, 미지정 '—') | 병동 | 상태 | 배치일 | 회수일·사유 | 최근 이벤트 | 연결(refLink) | 창고 개체(wms 일시 매칭 '(자동 매칭)', wmsWarning ⚠) | 메모(USER+ 인라인 저장 → patchDevice({memo}) → onMutated) | ⋯(onAction)
 * 정렬: 병동→시리얼(기본)/시리얼/배치일/최근 이벤트 (filters.sort — 헤더 클릭·셀렉트). page/limit 50(≤500) 서버 페이지네이션.
 * 다중 선택(ACTIVE 행만) + '검색 결과 전체 선택 N건'(getUnitIds ≤2,000 → Map에 id→(행 있으면 ref, 없으면 null)) → selection/setSelection.
 * 빈 상태: 헤더 + "등록된 기기가 없습니다. [+ 등록] 또는 [임포트] 탭에서 시작하세요." (onRegister / onOpenTab('import'))
 * 모바일: md:hidden 카드(시리얼 크게+상태, 모델·병동, 최근 이벤트, 카드 체크박스 · ⋯).
 * 조회 후 기본 필터(배치 중·조건 없음)일 때만 onTotalChange(total)로 탭 카운트 갱신. reloadKey 변경 시 재조회.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronLeft, ChevronRight, MoreHorizontal, Search, X } from 'lucide-react'
import Badge from '@/app/components/ui/Badge'
import Button from '@/app/components/ui/Button'
import EmptyState from '@/app/components/ui/EmptyState'
import { Input, Select } from '@/app/components/ui/Input'
import { TBody, TD, TH, THead, TR } from '@/app/components/ui/Table'
import { cn } from '@/lib/cn'
import { DEVICE_STATUS_LABELS, REGISTRY_REF_TYPE_LABELS, USAGE_TYPE_LABELS, matchesSerialPattern, refLink, todayKst, type RegistryRefType, type UsageFilter, type UsageTypeRef } from '@/lib/deviceRegistryShared'
import { errorMessage, getUnitIds, getUnits, patchDevice } from './api'
import { useDevicesToast } from './toast'
import { RegistryFloatingPanel, RegistryMenuItem } from './RegistryFloatingPanel'
import { lastEventText, usageBadgeVariant, wmsCell, ymdOrDash } from './deviceDisplay'
import {
  toDeviceRef,
  type Capabilities,
  type DeviceAction,
  type DeviceListRow,
  type DeviceRef,
  type HospitalDeviceSummary,
  type HospitalTab,
  type ListFilters,
  type Selection,
  type UnitsSort,
  type UnitsStatusFilter,
  type UnitsWmsFilter,
} from './types'

export interface DeviceTableProps {
  hospitalCode: string
  capabilities: Capabilities
  /** 모델 칩·병동 필터 옵션 소스(없으면 필터만 비활성, 표는 그려짐) */
  summary: HospitalDeviceSummary | null
  filters: ListFilters
  /** page는 patch에 없으면 orchestrator가 1로 리셋 */
  setFilters: (patch: Partial<ListFilters>) => void
  selection: Selection
  setSelection: (next: Selection) => void
  /** 행 클릭 → 드로어(URL ?device=) */
  onOpenDevice: (id: number) => void
  /** 행 ⋯ 메뉴: 병동 이동 / 회수 / 교체 / 식별 정정(admin) */
  onAction: (action: DeviceAction, device: DeviceRef) => void
  /** 빈 상태 [+ 등록] · RECOVERED 행 ⋯ '재등록(등록 폼)'(시리얼 프리필) */
  onRegister: (serials?: string[]) => void
  /** 빈 상태 [임포트] 탭 링크 */
  onOpenTab: (tab: HospitalTab) => void
  /** 메모 인라인 저장 등 표 내부 mutation 후 */
  onMutated: () => void
  onTotalChange?: (total: number) => void
  reloadKey: number
}

const STATUS_OPTIONS: { value: UnitsStatusFilter; label: string }[] = [
  { value: 'active', label: '배치 중' },
  { value: 'recovered', label: '회수됨(미재배치)' },
  { value: 'all', label: '전체' },
]

const WMS_OPTIONS: { value: '' | UnitsWmsFilter; label: string }[] = [
  { value: '', label: 'WMS 전체' },
  { value: 'linked', label: '창고 개체 연결됨' },
  { value: 'in_stock', label: '재고 상태 ⚠(배치 중인데 창고 재고)' },
  { value: 'unlinked', label: '미연결' },
]

const USAGE_OPTIONS: { value: '' | UsageFilter; label: string }[] = [
  { value: '', label: '용도 전체' },
  { value: 'SALE', label: USAGE_TYPE_LABELS.SALE },
  { value: 'EVAL', label: USAGE_TYPE_LABELS.EVAL },
  { value: 'none', label: '용도 미지정' },
]

const SORT_OPTIONS: { value: UnitsSort; label: string }[] = [
  { value: 'ward', label: '병동 → 시리얼' },
  { value: 'serial', label: '시리얼' },
  { value: 'placedOn', label: '배치일' },
  { value: 'lastEvent', label: '최근 이벤트' },
]

const LIMIT_OPTIONS = [50, 100, 200, 500]

const COLUMNS: { key: string; label: string; sort?: UnitsSort; className?: string }[] = [
  { key: 'serial', label: '시리얼', sort: 'serial' },
  { key: 'model', label: '모델' },
  { key: 'usage', label: '용도' },
  { key: 'ward', label: '병동', sort: 'ward' },
  { key: 'status', label: '상태' },
  { key: 'placedOn', label: '배치일', sort: 'placedOn' },
  { key: 'recovered', label: '회수일·사유' },
  { key: 'lastEvent', label: '최근 이벤트', sort: 'lastEvent' },
  { key: 'ref', label: '연결' },
  { key: 'wms', label: '창고 개체' },
  { key: 'memo', label: '메모' },
]

function stop(e: MouseEvent) {
  e.stopPropagation()
}

export function DeviceTable({
  hospitalCode,
  capabilities,
  summary,
  filters,
  setFilters,
  selection,
  setSelection,
  onOpenDevice,
  onAction,
  onRegister,
  onOpenTab,
  onMutated,
  onTotalChange,
  reloadKey,
}: DeviceTableProps) {
  const notify = useDevicesToast()
  const { canWrite, canAdmin } = capabilities
  const today = summary?.today ?? todayKst()

  // ── 데이터
  const [rows, setRows] = useState<DeviceListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reqSeq = useRef(0)
  const onTotalChangeRef = useRef(onTotalChange)
  onTotalChangeRef.current = onTotalChange

  const hasFilter = filters.status !== 'active' || filters.model != null || filters.ward != null || filters.q !== '' || filters.wms != null || filters.usage != null

  useEffect(() => {
    let alive = true
    const seq = ++reqSeq.current
    setLoading(true)
    getUnits({
      hospital: hospitalCode,
      status: filters.status,
      model: filters.model,
      ward: filters.ward,
      q: filters.q || null,
      wms: filters.wms,
      usage: filters.usage,
      page: filters.page,
      limit: filters.limit,
      sort: filters.sort,
    })
      .then((r) => {
        if (!alive || seq !== reqSeq.current) return
        setRows(r.data)
        setTotal(r.total)
        setError(null)
        // 탭 카운트는 '배치 중 · 조건 없음' 기준(검색 결과 수로 덮어쓰지 않음)
        if (!hasFilter) onTotalChangeRef.current?.(r.total)
      })
      .catch((e) => {
        if (!alive || seq !== reqSeq.current) return
        setError(errorMessage(e, '기기 목록을 불러오지 못했습니다.'))
      })
      .finally(() => {
        if (alive && seq === reqSeq.current) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalCode, filters.status, filters.model, filters.ward, filters.q, filters.wms, filters.usage, filters.page, filters.limit, filters.sort, reloadKey])

  // ── 시리얼 검색 디바운스
  const [qInput, setQInput] = useState(filters.q)
  useEffect(() => {
    setQInput(filters.q)
  }, [filters.q])
  useEffect(() => {
    const next = qInput.trim()
    if (next === filters.q) return
    const t = window.setTimeout(() => setFilters({ q: next }), 350)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput])

  // ── 선택
  const selectableRows = useMemo(() => rows.filter((r) => r.status === 'ACTIVE'), [rows])
  const allPageSelected = selectableRows.length > 0 && selectableRows.every((r) => selection.has(r.id))
  const somePageSelected = !allPageSelected && selectableRows.some((r) => selection.has(r.id))
  const headerCheckbox = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = somePageSelected
  }, [somePageSelected])

  const toggleRow = useCallback(
    (row: DeviceListRow) => {
      const next: Selection = new Map(selection)
      if (next.has(row.id)) next.delete(row.id)
      else next.set(row.id, toDeviceRef(row))
      setSelection(next)
    },
    [selection, setSelection]
  )

  const togglePage = useCallback(() => {
    const next: Selection = new Map(selection)
    if (allPageSelected) for (const r of selectableRows) next.delete(r.id)
    else for (const r of selectableRows) next.set(r.id, toDeviceRef(r))
    setSelection(next)
  }, [selection, setSelection, allPageSelected, selectableRows])

  const [selectingAll, setSelectingAll] = useState(false)
  const selectAllResults = useCallback(async () => {
    setSelectingAll(true)
    try {
      const r = await getUnitIds({ hospital: hospitalCode, status: 'active', model: filters.model, ward: filters.ward, q: filters.q || null, wms: filters.wms, usage: filters.usage })
      const byId = new Map(rows.map((row) => [row.id, row] as const))
      const next: Selection = new Map()
      for (const id of r.ids) {
        const row = byId.get(id)
        next.set(id, row ? toDeviceRef(row) : (selection.get(id) ?? null))
      }
      setSelection(next)
      if (r.truncated) notify(`선택 상한 ${r.max.toLocaleString()}건까지만 선택했습니다 (검색 결과 ${r.total.toLocaleString()}건)`, 'info')
    } catch (e) {
      notify(errorMessage(e, '전체 선택에 실패했습니다.'), 'error')
    } finally {
      setSelectingAll(false)
    }
  }, [hospitalCode, filters.model, filters.ward, filters.q, filters.wms, filters.usage, rows, selection, setSelection, notify])

  const canSelectAllResults = filters.status === 'active' && allPageSelected && total > selectableRows.length && selection.size < Math.min(total, 2000)

  // ── 메모 인라인
  const [memoEdit, setMemoEdit] = useState<{ id: number; value: string } | null>(null)
  const memoSavingRef = useRef(false)
  const saveMemo = useCallback(
    async (row: DeviceListRow, value: string) => {
      if (memoSavingRef.current) return
      const next = value.trim()
      if (next === (row.memo ?? '')) {
        setMemoEdit(null)
        return
      }
      memoSavingRef.current = true
      try {
        await patchDevice(row.id, { memo: next || null })
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, memo: next || null } : r)))
        setMemoEdit(null)
        notify(`${row.serialNo} 메모 저장`, 'success')
        onMutated()
      } catch (e) {
        notify(errorMessage(e, '메모 저장에 실패했습니다.'), 'error')
      } finally {
        memoSavingRef.current = false
      }
    },
    [notify, onMutated]
  )

  // ── 행 ⋯ 메뉴
  const [menu, setMenu] = useState<{ row: DeviceListRow; anchor: HTMLElement } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenu = (row: DeviceListRow) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const anchor = e.currentTarget
    setMenu((prev) => (prev && prev.row.id === row.id ? null : { row, anchor }))
  }

  // ── 필터 옵션
  const models = summary?.models ?? []
  const wards = summary?.wards ?? []
  const activeWards = wards.filter((w) => w.isActive)
  const closedWards = wards.filter((w) => !w.isActive)

  const resetFilters = () => setFilters({ status: 'active', model: null, ward: null, q: '', wms: null, usage: null, page: 1 })

  const pages = Math.max(1, Math.ceil(total / filters.limit))
  const from = total === 0 ? 0 : (filters.page - 1) * filters.limit + 1
  const to = Math.min(total, filters.page * filters.limit)

  const setSort = (sort: UnitsSort) => setFilters({ sort })

  const empty = !loading && !error && rows.length === 0

  return (
    <div>
      {/* ── 필터 */}
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="상태" className="inline-flex rounded-md border border-border bg-card p-0.5 text-xs">
            {STATUS_OPTIONS.map((o) => {
              const active = filters.status === o.value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setFilters({ status: o.value })}
                  className={cn('rounded px-2.5 py-1 transition-colors', active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
                >
                  {active && <span aria-hidden="true">● </span>}
                  {o.label}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1" aria-label="모델">
            <Chip active={filters.model == null} onClick={() => setFilters({ model: null })}>
              전체 모델
            </Chip>
            {models.map((m) => (
              <Chip key={m.deviceInfoId} active={filters.model === m.deviceInfoId} onClick={() => setFilters({ model: filters.model === m.deviceInfoId ? null : m.deviceInfoId })} title={m.deviceModel}>
                {m.deviceName}
                <span className={cn('ml-1 tabular-nums', filters.model === m.deviceInfoId ? 'opacity-80' : 'text-muted-foreground')}>{m.active.toLocaleString()}</span>
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="병동"
            value={filters.ward == null ? '' : String(filters.ward)}
            onChange={(e) => {
              const v = e.target.value
              setFilters({ ward: v === '' ? null : v === 'unassigned' ? 'unassigned' : Number(v) })
            }}
            className="h-8 w-auto min-w-[9rem] text-xs"
          >
            <option value="">전체 병동</option>
            <option value="unassigned">미지정{summary ? ` (${summary.unassigned.toLocaleString()})` : ''}</option>
            {activeWards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.active.toLocaleString()})
              </option>
            ))}
            {closedWards.length > 0 && (
              <optgroup label="폐쇄 병동">
                {closedWards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} (폐쇄)
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              aria-label="시리얼 검색"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') setFilters({ q: qInput.trim() })
                if (e.key === 'Escape') setQInput('')
              }}
              placeholder="시리얼·원문·닉네임"
              className="h-8 w-48 pl-8 pr-7 font-mono text-xs uppercase placeholder:font-sans placeholder:normal-case"
              autoComplete="off"
              spellCheck={false}
            />
            {qInput && (
              <button type="button" aria-label="검색어 지우기" onClick={() => setQInput('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
          <Select aria-label="WMS" value={filters.wms ?? ''} onChange={(e) => setFilters({ wms: (e.target.value || null) as UnitsWmsFilter | null })} className="h-8 w-auto text-xs">
            {WMS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="용도" value={filters.usage ?? ''} onChange={(e) => setFilters({ usage: (e.target.value || null) as UsageFilter | null })} className="h-8 w-auto text-xs">
            {USAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="정렬" value={filters.sort} onChange={(e) => setSort(e.target.value as UnitsSort)} className="h-8 w-auto text-xs">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                정렬: {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label="페이지 크기" value={filters.limit} onChange={(e) => setFilters({ limit: Number(e.target.value) })} className="h-8 w-auto text-xs">
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}행
              </option>
            ))}
          </Select>
          {hasFilter && (
            <Button size="sm" variant="ghost" onClick={resetFilters} className="h-8 text-xs">
              필터 초기화
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{loading ? '불러오는 중…' : `총 ${total.toLocaleString()}대`}</span>
        </div>
      </div>

      {/* ── 전체 선택 안내 */}
      {filters.status === 'active' && allPageSelected && total > selectableRows.length && (
        <div className="mb-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          이 페이지의 배치 중 기기 {selectableRows.length.toLocaleString()}대가 선택되었습니다.{' '}
          {canSelectAllResults ? (
            <button type="button" onClick={selectAllResults} disabled={selectingAll} className="font-medium text-primary hover:underline disabled:opacity-50">
              {selectingAll ? '선택 중…' : `검색 결과 전체 선택 ${Math.min(total, 2000).toLocaleString()}건`}
              {total > 2000 && ' (상한)'}
            </button>
          ) : (
            <span>검색 결과 전체 {selection.size.toLocaleString()}건이 선택되어 있습니다.</span>
          )}
        </div>
      )}

      {error && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive-subtle px-3 py-2 text-xs text-destructive-subtle-foreground">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => setFilters({ page: filters.page })}>
            다시 시도
          </Button>
        </div>
      )}

      {/* ── 데스크톱 표 */}
      <div className={cn('hidden overflow-x-auto rounded-lg border border-border bg-card md:block', loading && 'opacity-70 transition-opacity')}>
        <table className="w-full text-sm">
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="w-8 px-3">
                <input
                  ref={headerCheckbox}
                  type="checkbox"
                  aria-label="이 페이지 전체 선택"
                  checked={allPageSelected}
                  onChange={togglePage}
                  disabled={selectableRows.length === 0}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
              </TH>
              {COLUMNS.map((c) => (
                <TH key={c.key} className={c.className}>
                  {c.sort ? (
                    <button type="button" onClick={() => setSort(c.sort as UnitsSort)} className={cn('inline-flex items-center gap-0.5 hover:text-foreground', filters.sort === c.sort && 'text-foreground')} title={`${c.label} 순 정렬`}>
                      {c.label}
                      {filters.sort === c.sort && <span aria-hidden="true">▾</span>}
                    </button>
                  ) : (
                    c.label
                  )}
                </TH>
              ))}
              <TH className="w-10 px-2 text-center">⋯</TH>
            </TR>
          </THead>
          {rows.length > 0 && (
            <TBody>
              {rows.map((row) => {
                const selected = selection.has(row.id)
                const selectable = row.status === 'ACTIVE'
                const badFormat = matchesSerialPattern(row.serialNo, row.deviceInfo?.serialPattern) === false
                const wms = wmsCell(row.wms ?? row.wmsTransient)
                const refHref = row.lastRef ? refLink(row.lastRef.type, row.lastRef.code) : null
                const editing = memoEdit?.id === row.id
                return (
                  <TR key={row.id} className={cn('cursor-pointer', selected && 'bg-primary-subtle/40 hover:bg-primary-subtle/60')} onClick={() => onOpenDevice(row.id)}>
                    <TD className="px-3" onClick={stop}>
                      <input
                        type="checkbox"
                        aria-label={`${row.serialNo} 선택`}
                        checked={selected}
                        disabled={!selectable}
                        title={selectable ? undefined : '회수된 기기는 일괄 이동·회수 대상이 아닙니다'}
                        onChange={() => toggleRow(row)}
                        className="h-4 w-4 rounded border-input accent-primary disabled:opacity-40"
                      />
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1 font-mono font-medium">
                        <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); onOpenDevice(row.id) }}>
                          {row.serialNo}
                        </button>
                        {badFormat && <AlertTriangle size={13} className="text-warning" aria-label="형식 불일치" />}
                      </div>
                      {row.serialRaw && <div className="font-mono text-[11px] text-muted-foreground">{row.serialRaw}</div>}
                    </TD>
                    <TD>
                      <div>{row.deviceInfo?.deviceName ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground">{row.deviceInfo?.deviceModel}</div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <UsageBadge usage={row.usageType} />
                    </TD>
                    <TD className="whitespace-nowrap">{wardText(row)}</TD>
                    <TD>
                      <StatusBadge status={row.status} />
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums">{ymdOrDash(row.placedOn)}</TD>
                    <TD className="whitespace-nowrap">
                      {row.recoveredOn ? (
                        <>
                          <span className="tabular-nums">{ymdOrDash(row.recoveredOn)}</span>
                          {row.recoverReason && <span className="text-muted-foreground"> · {row.recoverReason.name}</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {row.replacedBy && (
                        <div className="text-[11px] text-muted-foreground">
                          → 교체{' '}
                          <button type="button" className="font-mono text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onOpenDevice(row.replacedBy!.id) }}>
                            {row.replacedBy.serialNo}
                          </button>
                        </div>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums">{lastEventText(row.lastEventType, row.lastEventOn, today)}</TD>
                    <TD className="whitespace-nowrap" onClick={stop}>
                      {row.lastRef ? (
                        refHref ? (
                          <Link href={refHref} className="font-mono text-xs text-primary hover:underline" title={REGISTRY_REF_TYPE_LABELS[row.lastRef.type as RegistryRefType] ?? row.lastRef.type}>
                            {row.lastRef.code}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs" title={row.lastRef.type}>
                            {row.lastRef.code}
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-xs">
                      {wms ? (
                        <span className="inline-flex items-center gap-1">
                          {row.wmsWarning && <AlertTriangle size={13} className="shrink-0 text-warning" aria-label={row.wmsWarning} />}
                          <span title={row.wmsWarning ?? undefined}>{wms.text}</span>
                          {wms.transient && <span className="text-muted-foreground">(자동 매칭)</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="max-w-[14rem]" onClick={stop}>
                      {editing ? (
                        <Input
                          autoFocus
                          value={memoEdit.value}
                          maxLength={500}
                          onChange={(e) => setMemoEdit({ id: row.id, value: e.target.value })}
                          onBlur={() => saveMemo(row, memoEdit.value)}
                          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') saveMemo(row, memoEdit.value)
                            if (e.key === 'Escape') setMemoEdit(null)
                          }}
                          className="h-7 text-xs"
                          placeholder="각인·스티커 번호 등"
                        />
                      ) : canWrite ? (
                        <button
                          type="button"
                          onClick={() => setMemoEdit({ id: row.id, value: row.memo ?? '' })}
                          title={row.memo ? `${row.memo}\n(클릭하여 편집)` : '메모 추가'}
                          className={cn('block max-w-full truncate rounded px-1 text-left text-xs hover:bg-accent', row.memo ? 'text-foreground' : 'text-muted-foreground/70')}
                        >
                          {row.memo || '메모 추가'}
                        </button>
                      ) : (
                        <span className="block truncate text-xs" title={row.memo ?? undefined}>
                          {row.memo || <span className="text-muted-foreground">—</span>}
                        </span>
                      )}
                    </TD>
                    <TD className="px-2 text-center" onClick={stop}>
                      <button type="button" aria-label="행 메뉴" aria-haspopup="menu" onClick={openMenu(row)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <MoreHorizontal size={16} />
                      </button>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          )}
        </table>
        {empty && <TableEmpty hasFilter={hasFilter} canWrite={canWrite} onRegister={onRegister} onOpenTab={onOpenTab} onReset={resetFilters} />}
        {loading && rows.length === 0 && !error && <div className="px-4 py-10 text-center text-xs text-muted-foreground">불러오는 중…</div>}
      </div>

      {/* ── 모바일 카드 */}
      <div className={cn('md:hidden', loading && 'opacity-70 transition-opacity')}>
        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((row) => {
              const selected = selection.has(row.id)
              const selectable = row.status === 'ACTIVE'
              const badFormat = matchesSerialPattern(row.serialNo, row.deviceInfo?.serialPattern) === false
              const refHref = row.lastRef ? refLink(row.lastRef.type, row.lastRef.code) : null
              return (
                <li key={row.id} className={cn('rounded-lg border border-border bg-card p-3', selected && 'border-primary/50 bg-primary-subtle/30')} onClick={() => onOpenDevice(row.id)}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`${row.serialNo} 선택`}
                      checked={selected}
                      disabled={!selectable}
                      onChange={() => toggleRow(row)}
                      onClick={stop}
                      className="mt-1 h-5 w-5 rounded border-input accent-primary disabled:opacity-40"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 font-mono text-base font-semibold">
                          {row.serialNo}
                          {badFormat && <AlertTriangle size={13} className="text-warning" aria-label="형식 불일치" />}
                        </span>
                        <StatusBadge status={row.status} />
                      </div>
                      {row.serialRaw && <div className="font-mono text-[11px] text-muted-foreground">{row.serialRaw}</div>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                        <span>
                          {row.deviceInfo?.deviceName} {row.deviceInfo?.deviceModel} · {wardText(row)}
                        </span>
                        {row.usageType && <UsageBadge usage={row.usageType} />}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                        <span className="tabular-nums">{lastEventText(row.lastEventType, row.lastEventOn, today)}</span>
                        {row.lastRef && (refHref ? (
                          <Link href={refHref} onClick={stop} className="font-mono text-primary hover:underline">
                            {row.lastRef.code}
                          </Link>
                        ) : (
                          <span className="font-mono">{row.lastRef.code}</span>
                        ))}
                        {row.wmsWarning && (
                          <span className="inline-flex items-center gap-0.5 text-warning">
                            <AlertTriangle size={12} /> 창고 재고
                          </span>
                        )}
                      </div>
                      {row.recoveredOn && (
                        <div className="text-xs text-muted-foreground tabular-nums">
                          회수 {ymdOrDash(row.recoveredOn)}
                          {row.recoverReason ? ` · ${row.recoverReason.name}` : ''}
                        </div>
                      )}
                      {row.memo && <div className="mt-0.5 truncate text-xs italic text-muted-foreground">{row.memo}</div>}
                    </div>
                    <button type="button" aria-label="행 메뉴" aria-haspopup="menu" onClick={openMenu(row)} className="-mr-1 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {empty && (
          <div className="rounded-lg border border-border bg-card">
            <TableEmpty hasFilter={hasFilter} canWrite={canWrite} onRegister={onRegister} onOpenTab={onOpenTab} onReset={resetFilters} />
          </div>
        )}
        {loading && rows.length === 0 && !error && <div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div>}
      </div>

      {/* ── 페이지네이션 */}
      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            총 {total.toLocaleString()}대 · {from.toLocaleString()}–{to.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2" disabled={filters.page <= 1} onClick={() => setFilters({ page: filters.page - 1 })} aria-label="이전 페이지">
              <ChevronLeft size={14} />
            </Button>
            <span className="px-2 tabular-nums text-foreground">
              {filters.page} / {pages}
            </span>
            <Button size="sm" variant="outline" className="h-7 px-2" disabled={filters.page >= pages} onClick={() => setFilters({ page: filters.page + 1 })} aria-label="다음 페이지">
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* ── 행 ⋯ 메뉴 */}
      <RegistryFloatingPanel open={menu != null} anchor={menu?.anchor ?? null} onClose={closeMenu} className="w-44 py-1">
        {menu && (
          <>
            <div className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{menu.row.serialNo}</div>
            <RegistryMenuItem
              onClick={() => {
                closeMenu()
                onOpenDevice(menu.row.id)
              }}
            >
              이력 보기
            </RegistryMenuItem>
            {canWrite && menu.row.status === 'ACTIVE' && (
              <>
                <RegistryMenuItem onClick={() => { closeMenu(); onAction('move', toDeviceRef(menu.row)) }}>병동 이동</RegistryMenuItem>
                <RegistryMenuItem onClick={() => { closeMenu(); onAction('recover', toDeviceRef(menu.row)) }}>회수</RegistryMenuItem>
                <RegistryMenuItem onClick={() => { closeMenu(); onAction('replace', toDeviceRef(menu.row)) }}>교체</RegistryMenuItem>
              </>
            )}
            {canWrite && menu.row.status === 'RECOVERED' && (
              <RegistryMenuItem onClick={() => { closeMenu(); onRegister([menu.row.serialNo]) }} title="회수된 기기는 등록 폼에서 재등록합니다 — 시리얼을 미리 채웁니다">
                재등록(등록 폼)
              </RegistryMenuItem>
            )}
            {canAdmin && (
              <>
                <div className="my-1 border-t border-border" />
                <RegistryMenuItem onClick={() => { closeMenu(); onAction('correct', toDeviceRef(menu.row)) }}>식별 정정 (관리)</RegistryMenuItem>
              </>
            )}
          </>
        )}
      </RegistryFloatingPanel>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function wardText(row: DeviceListRow): string {
  if (row.ward) return `${row.ward.name}${row.ward.isActive ? '' : ' (폐쇄)'}`
  return row.status === 'ACTIVE' ? '미지정' : '—'
}

function StatusBadge({ status }: { status: DeviceListRow['status'] }) {
  return <Badge variant={status === 'ACTIVE' ? 'success' : 'default'}>{DEVICE_STATUS_LABELS[status] ?? status}</Badge>
}

/** 용도 배지 — 판매용 default · 평가용 warning · 미지정 '—' */
export function UsageBadge({ usage }: { usage: UsageTypeRef | null | undefined }) {
  const variant = usageBadgeVariant(usage)
  if (!usage || !variant) return <span className="text-muted-foreground">—</span>
  return (
    <Badge variant={variant} title={usage.value === 'EVAL' ? '평가용 — 계약 대조에서 제외' : undefined}>
      {usage.name}
    </Badge>
  )
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-accent'
      )}
    >
      {children}
    </button>
  )
}

function TableEmpty({ hasFilter, canWrite, onRegister, onOpenTab, onReset }: { hasFilter: boolean; canWrite: boolean; onRegister: () => void; onOpenTab: (tab: HospitalTab) => void; onReset: () => void }) {
  if (hasFilter) {
    return (
      <EmptyState
        title="조건에 맞는 기기가 없습니다."
        description="상태·모델·병동·검색어·WMS·용도 필터를 조정하세요."
        action={
          <Button size="sm" variant="outline" onClick={onReset}>
            필터 초기화
          </Button>
        }
        className="py-10"
      />
    )
  }
  return (
    <EmptyState
      title="등록된 기기가 없습니다."
      description={canWrite ? '[+ 등록] 또는 [임포트] 탭에서 시작하세요.' : '등록·임포트는 USER 등급부터 가능합니다.'}
      action={
        canWrite ? (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => onRegister()}>
              + 등록
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenTab('import')}>
              임포트 탭
            </Button>
          </div>
        ) : undefined
      }
      className="py-10"
    />
  )
}

export default DeviceTable
