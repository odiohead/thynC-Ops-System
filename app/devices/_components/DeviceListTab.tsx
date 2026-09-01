'use client'

/**
 * 전역 [디바이스] 뷰 — 병원과 무관한 전 기기 평면 목록 (v1 단순화, 2026-09-01 사용자 피드백)
 * 툴바: 검색 [시리얼/병원명] · 모델 [전체▾] · 상태 [배치 중 | 회수됨 | 전체] · 용도 [전체▾] · 상품유형 [전체▾] · [Excel](같은 필터로 `/api/devices/export`)
 * 표: 시리얼 | 모델 | 용도 | 상품유형 | 현재 병원 | 병동 | 상태 | 배치일 | 최근 이벤트 — 행 클릭 → onOpenDevice(드로어). 페이지 50 고정.
 * 검색: `GET /api/devices/units?q=` — 시리얼 키·원문·닉네임·메모 + (병원 미지정이라) 현재/마지막 병원명. 정렬 기본 시리얼 오름차순이라 정확 일치가 접두 일치보다 앞서고,
 *       추가로 페이지 안에서 정확 일치(키 또는 원문) 행을 맨 위로 올린다(구 헤더 '시리얼 조회' 대체).
 * 쓰기 버튼 없음(등록·이동·회수는 병원 문맥 — 드로어 액션은 오케스트레이터가 병원별 뷰로 안내).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import Badge from '@/app/components/ui/Badge'
import Button from '@/app/components/ui/Button'
import EmptyState from '@/app/components/ui/EmptyState'
import { Input, Select } from '@/app/components/ui/Input'
import { TBody, TD, TH, THead, TR } from '@/app/components/ui/Table'
import { cn } from '@/lib/cn'
import { DEVICE_STATUS_LABELS, PRODUCT_TYPES, USAGE_TYPE_LABELS, matchesSerialPattern, normalizeSerial, todayKst, type ProductTypeFilter, type UsageFilter } from '@/lib/deviceRegistryShared'
import { errorMessage, exportUnitsUrl, getDeviceModels, getUnits, type DeviceModelOption } from './api'
import { ExcelButton } from './ExcelButton'
import { ProductTypeBadge, UsageBadge } from './DeviceTable'
import { lastEventText, ymdOrDash } from './deviceDisplay'
import type { DeviceListRow, GlobalListFilters, UnitsSort, UnitsStatusFilter } from './types'

export interface DeviceListTabProps {
  filters: GlobalListFilters
  /** page는 patch에 없으면 orchestrator가 1로 리셋 */
  setFilters: (patch: Partial<GlobalListFilters>) => void
  /** 행 클릭 → 드로어(URL ?device=) */
  onOpenDevice: (id: number) => void
  reloadKey: number
}

const PAGE_LIMIT = 50

const STATUS_OPTIONS: { value: UnitsStatusFilter; label: string }[] = [
  { value: 'active', label: '배치 중' },
  { value: 'recovered', label: '회수됨' },
  { value: 'all', label: '전체' },
]

const USAGE_OPTIONS: { value: '' | UsageFilter; label: string }[] = [
  { value: '', label: '용도 전체' },
  { value: 'SALE', label: USAGE_TYPE_LABELS.SALE },
  { value: 'EVAL', label: USAGE_TYPE_LABELS.EVAL },
  { value: 'none', label: '용도 미지정' },
]

const PRODUCT_TYPE_OPTIONS: { value: '' | ProductTypeFilter; label: string }[] = [
  { value: '', label: '상품유형 전체' },
  ...PRODUCT_TYPES.map((t) => ({ value: t, label: t })),
  { value: 'none', label: '상품유형 미지정' },
]

const COLUMNS: { key: string; label: string; sort?: UnitsSort }[] = [
  { key: 'serial', label: '시리얼', sort: 'serial' },
  { key: 'model', label: '모델' },
  { key: 'usage', label: '용도' },
  { key: 'productType', label: '상품유형' },
  { key: 'hospital', label: '현재 병원' },
  { key: 'ward', label: '병동' },
  { key: 'status', label: '상태' },
  { key: 'placedOn', label: '배치일', sort: 'placedOn' },
  { key: 'lastEvent', label: '최근 이벤트', sort: 'lastEvent' },
]

/** 검색어와 정확히 일치(정규화 키 또는 원문)하는 행을 페이지 맨 위로 */
function hoistExact(rows: DeviceListRow[], q: string): DeviceListRow[] {
  const raw = q.trim()
  if (!raw) return rows
  const key = normalizeSerial(raw).serialNo
  const up = raw.replace(/\s+/g, '').toUpperCase()
  const exact = rows.filter((r) => r.serialNo === key || r.serialNo === up || (r.serialRaw ?? '').toUpperCase() === up)
  if (exact.length === 0) return rows
  const ids = new Set(exact.map((r) => r.id))
  return [...exact, ...rows.filter((r) => !ids.has(r.id))]
}

/** 현재 병원 셀 — ACTIVE: 병원명 / RECOVERED: '회수 전 X' */
function hospitalText(row: DeviceListRow): { text: string; muted: boolean } {
  if (row.status === 'ACTIVE') return { text: row.hospitalName ?? row.hospital?.hospitalName ?? row.hospitalCode ?? '—', muted: false }
  const last = row.lastHospitalName ?? row.lastHospital?.hospitalName ?? row.lastHospitalCode
  return { text: last ? `회수 전 ${last}` : '—', muted: true }
}

function wardText(row: DeviceListRow): string {
  if (row.ward) return `${row.ward.name}${row.ward.isActive ? '' : ' (폐쇄)'}`
  return row.status === 'ACTIVE' ? '미지정' : '—'
}

export function DeviceListTab({ filters, setFilters, onOpenDevice, reloadKey }: DeviceListTabProps) {
  const today = todayKst()
  const [sort, setSort] = useState<UnitsSort>('serial')

  // ── 모델 옵션(1회)
  const [models, setModels] = useState<DeviceModelOption[]>([])
  useEffect(() => {
    let alive = true
    getDeviceModels()
      .then((m) => alive && setModels(m))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // ── 데이터
  const [rows, setRows] = useState<DeviceListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reqSeq = useRef(0)

  useEffect(() => {
    let alive = true
    const seq = ++reqSeq.current
    setLoading(true)
    getUnits({ hospital: null, status: filters.status, model: filters.model, usage: filters.usage, productType: filters.productType, q: filters.q || null, page: filters.page, limit: PAGE_LIMIT, sort })
      .then((r) => {
        if (!alive || seq !== reqSeq.current) return
        setRows(hoistExact(r.data, filters.q))
        setTotal(r.total)
        setError(null)
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
  }, [filters.status, filters.model, filters.usage, filters.productType, filters.q, filters.page, sort, reloadKey])

  // ── 검색 디바운스
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

  const hasFilter = filters.status !== 'active' || filters.model != null || filters.usage != null || filters.productType != null || filters.q !== ''
  const resetFilters = () => setFilters({ status: 'active', model: null, usage: null, productType: null, q: '', page: 1 })

  const excelHref = useMemo(
    () => exportUnitsUrl({ hospital: null, status: filters.status, model: filters.model, usage: filters.usage, productType: filters.productType, q: filters.q || null, sort }),
    [filters.status, filters.model, filters.usage, filters.productType, filters.q, sort]
  )

  const pages = Math.max(1, Math.ceil(total / PAGE_LIMIT))
  const from = total === 0 ? 0 : (filters.page - 1) * PAGE_LIMIT + 1
  const to = Math.min(total, filters.page * PAGE_LIMIT)
  const empty = !loading && !error && rows.length === 0

  return (
    <div>
      {/* ── 툴바 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="시리얼/병원명 검색"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') setFilters({ q: qInput.trim() })
              if (e.key === 'Escape') setQInput('')
            }}
            placeholder="시리얼 / 병원명"
            className="h-8 w-56 pl-8 pr-7 text-xs"
            autoComplete="off"
            spellCheck={false}
          />
          {qInput && (
            <button type="button" aria-label="검색어 지우기" onClick={() => setQInput('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
        <Select aria-label="모델" value={filters.model == null ? '' : String(filters.model)} onChange={(e) => setFilters({ model: e.target.value ? Number(e.target.value) : null })} className="h-8 w-auto text-xs">
          <option value="">모델 전체</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.deviceName} {m.deviceModel}
            </option>
          ))}
        </Select>
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
                {o.label}
              </button>
            )
          })}
        </div>
        <Select aria-label="용도" value={filters.usage ?? ''} onChange={(e) => setFilters({ usage: (e.target.value || null) as UsageFilter | null })} className="h-8 w-auto text-xs">
          {USAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select aria-label="상품유형" value={filters.productType ?? ''} onChange={(e) => setFilters({ productType: (e.target.value || null) as ProductTypeFilter | null })} className="h-8 w-auto text-xs">
          {PRODUCT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {hasFilter && (
          <Button size="sm" variant="ghost" onClick={resetFilters} className="h-8 text-xs">
            필터 초기화
          </Button>
        )}
        <span className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {loading ? '불러오는 중…' : `총 ${total.toLocaleString()}대`}
          <ExcelButton href={excelHref} fallbackName="디바이스원장_전체.xlsx" />
        </span>
      </div>

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
              {COLUMNS.map((c) => (
                <TH key={c.key}>
                  {c.sort ? (
                    <button type="button" onClick={() => setSort(c.sort as UnitsSort)} className={cn('inline-flex items-center gap-0.5 hover:text-foreground', sort === c.sort && 'text-foreground')} title={`${c.label} 순 정렬`}>
                      {c.label}
                      {sort === c.sort && <span aria-hidden="true">▾</span>}
                    </button>
                  ) : (
                    c.label
                  )}
                </TH>
              ))}
            </TR>
          </THead>
          {rows.length > 0 && (
            <TBody>
              {rows.map((row) => {
                const badFormat = matchesSerialPattern(row.serialNo, row.deviceInfo?.serialPattern) === false
                const h = hospitalText(row)
                return (
                  <TR key={row.id} className="cursor-pointer" onClick={() => onOpenDevice(row.id)}>
                    <TD>
                      <div className="flex items-center gap-1 font-mono font-medium">
                        <span>{row.serialNo}</span>
                        {badFormat && <AlertTriangle size={13} className="text-warning" aria-label="형식 불일치" />}
                      </div>
                      {row.serialRaw && row.serialRaw !== row.serialNo && <div className="font-mono text-[11px] text-muted-foreground">{row.serialRaw}</div>}
                    </TD>
                    <TD>
                      <div>{row.deviceInfo?.deviceName ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground">{row.deviceInfo?.deviceModel}</div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <UsageBadge usage={row.usageType} />
                    </TD>
                    <TD className="whitespace-nowrap">
                      <ProductTypeBadge value={row.productType} recovered={row.status === 'RECOVERED'} />
                    </TD>
                    <TD className={cn('whitespace-nowrap', h.muted && 'text-muted-foreground')}>{h.text}</TD>
                    <TD className="whitespace-nowrap">{wardText(row)}</TD>
                    <TD>
                      <Badge variant={row.status === 'ACTIVE' ? 'success' : 'default'}>{DEVICE_STATUS_LABELS[row.status] ?? row.status}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums">{ymdOrDash(row.placedOn)}</TD>
                    <TD className="whitespace-nowrap tabular-nums">{lastEventText(row.lastEventType, row.lastEventOn, today)}</TD>
                  </TR>
                )
              })}
            </TBody>
          )}
        </table>
        {empty && <ListEmpty hasFilter={hasFilter} onReset={resetFilters} />}
        {loading && rows.length === 0 && !error && <div className="px-4 py-10 text-center text-xs text-muted-foreground">불러오는 중…</div>}
      </div>

      {/* ── 모바일 카드 */}
      <div className={cn('md:hidden', loading && 'opacity-70 transition-opacity')}>
        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((row) => {
              const h = hospitalText(row)
              return (
                <li key={row.id} className="rounded-lg border border-border bg-card p-3" onClick={() => onOpenDevice(row.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-base font-semibold">{row.serialNo}</span>
                    <Badge variant={row.status === 'ACTIVE' ? 'success' : 'default'}>{DEVICE_STATUS_LABELS[row.status] ?? row.status}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {row.deviceInfo?.deviceName} {row.deviceInfo?.deviceModel} · <span className={cn(!h.muted && 'text-foreground')}>{h.text}</span> · {wardText(row)}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                    {row.usageType && <UsageBadge usage={row.usageType} />}
                    {row.productType && <ProductTypeBadge value={row.productType} recovered={row.status === 'RECOVERED'} />}
                    <span className="tabular-nums text-muted-foreground">{lastEventText(row.lastEventType, row.lastEventOn, today)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {empty && (
          <div className="rounded-lg border border-border bg-card">
            <ListEmpty hasFilter={hasFilter} onReset={resetFilters} />
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
    </div>
  )
}

function ListEmpty({ hasFilter, onReset }: { hasFilter: boolean; onReset: () => void }) {
  if (hasFilter) {
    return (
      <EmptyState
        title="조건에 맞는 기기가 없습니다."
        description="검색어·모델·상태·용도·상품유형 필터를 조정하세요."
        action={
          <Button size="sm" variant="outline" onClick={onReset}>
            필터 초기화
          </Button>
        }
        className="py-10"
      />
    )
  }
  return <EmptyState title="등록된 기기가 없습니다." description="[병원별] 탭에서 병원을 선택해 등록 또는 임포트로 시작하세요." className="py-10" />
}

export default DeviceListTab
