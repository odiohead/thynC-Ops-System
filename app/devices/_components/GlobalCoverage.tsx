'use client'

/**
 * 전역 뷰 A — 병원 커버리지 표(백필 진행판, §6.1-A) — GROUP A
 * 필터 [전체 ▾ | 미등록만 | 차이 있음 | 등록 완료] · 검색 [병원명/코드] · 정렬 [차이 큰 순 ▾ | 병원명 | 마지막 이벤트]
 * 컬럼: 병원 | 상태 | 계약 ECG | 배치 중 ECG(평가용 제외) | 차이 | 평가용(별도, 전 모델) | SpO2(참고) | GW | 회수(30일) | 마지막 이벤트 | 마지막 임포트 | →
 *  - registered=false 행: 배치/차이 '미등록', 나머지 '—', 우측 [임포트](onOpenImport) / 그 외 [열기](onOpenHospital)
 *  - expected=null(딜 0건 또는 전 딜 모델별 수량 미입력 — 디바이스수 폴백 제거 2026-09-02): 계약 열 '—' · diff 0 → '0 ✔' · 음수 → '−12 ▲' (배치 중 ECG·차이는 평가용 EVAL 제외 §9.1)
 * 서버 페이지네이션(page/limit 50). 빈 상태에도 전 헤더 노출. 모바일 md:hidden 카드.
 * 요약 줄('고객 병원 n · …')과 탭 바는 orchestrator(DevicesClient)가 렌더한다 — 여기는 표만.
 *
 * v1 단순화(2026-09-01~02 사용자 피드백, 3차 개정: 병원당 1행) — `compact` prop(기본 false = 구 전체 표):
 *  열 `병원명 | 상태 | 판매유형 | 심전계 | 심전계(라이트) | 산소포화도 | 산소포화도(라이트) | 혈압계 | 혈압계(라이트) | 마지막 이벤트` — 병원당 **1행**.
 *  - 판매유형: 일반/라이트 배지 — (계약완료 딜 유형 ∪ ACTIVE 배치 유형) 합집합, 둘 다면 두 배지(일반 먼저), 없으면 '—'
 *  - 기기 6셀: ACTIVE 배치 수(평가용 포함) — 기본 열 = product_type '일반', (라이트) 열 = '라이트'. 혈압계 = **링 혈압계(CART BP) SL-MPF1K07**(onprem_device_type 10, MBP100U 아님).
 *    고정 폭(w-20)·우측 정렬 tabular-nums로 그리드 정렬, 0은 회색 '0'(원장 없는 병원도 '미등록' 문구 없이 전부 0). 심전계 셀 툴팁에 그 유형 계약 수(expectedByType)
 *  - 미지정 ACTIVE 배치는 어느 열에도 합산하지 않음 — 병원명 옆 warning 배지 `미지정 n`(툴팁 '기기 목록에서 지정하세요')
 *  - [임포트] 퀵 액션 없음(등록은 병원 진입 후). GW·제3자(링 제외) 수는 이 표에 없음
 *  툴바 = 필터(전체|등록 0|차이 있음|등록 완료 — 'unregistered' 값·동작 유지, 라벨만) + 병원명 검색(정렬 '차이 큰 순' 고정, 셀렉트 숨김), 50행, 행 클릭 → onOpenHospital.
 *  모바일 카드: 병원+상태+판매유형 배지, '일반 E n · S n · BP n' / '라이트 …' 두 줄.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import Badge from '@/app/components/ui/Badge'
import Button from '@/app/components/ui/Button'
import { Input, Select } from '@/app/components/ui/Input'
import { Table, TBody, TD, TH, THead, TR } from '@/app/components/ui/Table'
import { cn } from '@/lib/cn'
import { DEVICE_EVENT_TYPE_LABELS, todayKst, toYmd, type DeviceEventType } from '@/lib/deviceRegistryShared'
import { errorMessage, getCoverage } from './api'
import type { CoverageFilter, CoverageFilters, CoverageModelCounts, CoverageProductTypeKey, CoverageResponse, CoverageRow, CoverageSort } from './types'

export interface GlobalCoverageProps {
  /** q/page는 URL 동기화, filter/sort/limit는 orchestrator 로컬 state — setFilters로만 변경 */
  filters: CoverageFilters
  setFilters: (patch: Partial<CoverageFilters>) => void
  onOpenHospital: (code: string) => void
  onOpenImport: (code: string) => void
  /** 값이 바뀌면 재조회 */
  reloadKey: number
  /** v1 단순 표(7열 + 미등록 [임포트]) — 기본 false(구 12열 전체 표) */
  compact?: boolean
  /** 오케스트레이터의 커버리지 캐시(filter=all·q없음·sort=diff 전체 모집단) — 기본 필터 상태에서는 이 데이터로 첫 페이지를 그려 중복 fetch를 없앤다(2026-09-02 로딩 개선) */
  preloaded?: CoverageResponse | null
  /** 캐시 로드 중이면 자체 fetch를 미룬다(캐시 실패 시 false + null → 자체 fetch 폴백) */
  preloadedLoading?: boolean
}

const FILTER_OPTIONS: { value: CoverageFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'unregistered', label: '등록 0' },
  { value: 'diff', label: '차이 있음' },
  { value: 'complete', label: '등록 완료' },
]

const SORT_OPTIONS: { value: CoverageSort; label: string }[] = [
  { value: 'diff', label: '차이 큰 순' },
  { value: 'name', label: '병원명' },
  { value: 'lastEvent', label: '마지막 이벤트' },
]

const COLUMNS = ['병원', '상태', '계약 ECG', '배치 중 ECG', '차이', '평가용', 'SpO2(참고)', 'GW', '회수(30일)', '마지막 이벤트', '마지막 임포트', '→'] as const
/** compact 열 — 병원당 1행. 기기 6셀(3~8)은 고정 폭(w-20)·우측 정렬 */
const COMPACT_COLUMNS = ['병원명', '상태', '판매유형', '심전계', '심전계(라이트)', '산소포화도', '산소포화도(라이트)', '혈압계', '혈압계(라이트)', '마지막 이벤트'] as const
const COLUMN_TITLES: Partial<Record<(typeof COLUMNS)[number] | (typeof COMPACT_COLUMNS)[number], string>> = {
  '배치 중 ECG': '배치 중 ECG(평가용 제외 — 계약 대조 기준)',
  차이: '배치 중 ECG(평가용 제외) − 계약 ECG',
  평가용: '배치 중 평가용(EVAL) 기기 수(전 모델) — 계약 대조 제외',
  판매유형: '계약완료 딜 유형 ∪ 배치 중 상품유형',
  심전계: "배치 중 심전계(ECG) — 상품유형 '일반', 평가용 포함",
  '심전계(라이트)': "배치 중 심전계(ECG) — 상품유형 '라이트', 평가용 포함",
  산소포화도: "배치 중 산소포화도(SpO2) — 상품유형 '일반', 평가용 포함",
  '산소포화도(라이트)': "배치 중 산소포화도(SpO2) — 상품유형 '라이트', 평가용 포함",
  혈압계: "배치 중 링 혈압계(CART BP) SL-MPF1K07 — 상품유형 '일반', 평가용 포함",
  '혈압계(라이트)': "배치 중 링 혈압계(CART BP) SL-MPF1K07 — 상품유형 '라이트', 평가용 포함",
}
const SEARCH_DEBOUNCE_MS = 300

// ─────────────────────────────────────────────────────────────────────────────
// 표시 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

const DASH = <span className="text-muted-foreground">—</span>

function fmtInt(n: number): string {
  return n.toLocaleString()
}

/** @db.Date(UTC 자정 ISO) → 올해면 'MM-DD', 아니면 'YYYY-MM-DD' */
function fmtDay(v: string | null | undefined, today: string): { short: string; full: string } | null {
  const ymd = toYmd(v)
  if (!ymd) return null
  return { short: ymd.slice(0, 4) === today.slice(0, 4) ? ymd.slice(5) : ymd, full: ymd }
}

/** timestamp ISO → KST 일자 */
function fmtKstDay(v: string | null | undefined, today: string): { short: string; full: string } | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  return { short: ymd.slice(0, 4) === today.slice(0, 4) ? ymd.slice(5) : ymd, full: ymd }
}

function eventTypeLabel(type: string): string {
  return (DEVICE_EVENT_TYPE_LABELS as Record<string, string>)[type as DeviceEventType] ?? type
}

function statusVariant(status: string | null): 'success' | 'primary' | 'warning' | 'outline' {
  switch (status) {
    case '운영':
      return 'success'
    case '계약완료':
      return 'primary'
    case '보류':
      return 'warning'
    default:
      return 'outline'
  }
}

/** 계약 ECG — 딜 0건 '— (계약완료 딜 없음)' · 딜 있으나 모델별 수량 미입력 '— ⓘ'(2026-09-02 개정 — 디바이스수 폴백 제거) */
function ExpectedCell({ row }: { row: CoverageRow }) {
  if (row.expected == null)
    return row.deals > 0 ? (
      <span className="text-xs text-muted-foreground" title="모델별 도입 기기 수량 미입력 — 딜 상세(규모·계약 카드)에서 입력하세요">
        — <span aria-hidden="true">ⓘ</span>
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">— (계약완료 딜 없음)</span>
    )
  return (
    <span className="tabular-nums" title={`계약완료 딜 ${row.deals}건 · 딜 모델별 도입 기기 수량(ECG) 합`}>
      {fmtInt(row.expected)}
    </span>
  )
}

/** 차이 — 미등록 '미등록' / 계약 축 없음 '—' / 0 '0 ✔' / 음수 '−12 ▲' / 양수 '+5 ▲' */
function DiffCell({ row }: { row: CoverageRow }) {
  if (!row.registered) return <span className="text-xs text-muted-foreground">미등록</span>
  if (row.diff == null) return DASH
  if (row.diff === 0) return <span className="tabular-nums text-success-subtle-foreground">0 ✔</span>
  const negative = row.diff < 0
  return (
    <span className={cn('tabular-nums font-medium', negative ? 'text-destructive-subtle-foreground' : 'text-warning-subtle-foreground')} title="배치 중 ECG(평가용 제외) − 계약 ECG (참고 신호)">
      {negative ? '−' : '+'}
      {fmtInt(Math.abs(row.diff))} ▲
    </span>
  )
}

function RegisteredNum({ row, value, muted }: { row: CoverageRow; value: number; muted?: boolean }) {
  if (!row.registered) return DASH
  return <span className={cn('tabular-nums', muted && 'text-muted-foreground')}>{fmtInt(value)}</span>
}

/** 평가용 — 0이면 회색 '0', 있으면 warning 톤(ECG 평가용 수를 툴팁에) */
function EvalCell({ row }: { row: CoverageRow }) {
  if (!row.registered) return DASH
  const n = row.evalTotal ?? 0
  if (n === 0) return <span className="tabular-nums text-muted-foreground">0</span>
  return (
    <span className="tabular-nums font-medium text-warning-subtle-foreground" title={`평가용 ${fmtInt(n)}대 (ECG ${fmtInt(row.activeEcgEval ?? 0)}) — 계약 대조 제외`}>
      {fmtInt(n)}
    </span>
  )
}

const EMPTY_PT_COUNTS: CoverageModelCounts = { ecg: 0, spo2: 0, bp: 0 }

function ptCounts(row: CoverageRow, key: CoverageProductTypeKey): CoverageModelCounts {
  return row.byProductType?.[key] ?? EMPTY_PT_COUNTS
}

/** 판매유형 — (계약완료 딜 유형 dealProductTypes — 수량 무관) ∪ (ACTIVE 배치 유형), 일반 먼저 */
function saleTypes(row: CoverageRow): ('일반' | '라이트')[] {
  return (['일반', '라이트'] as const).filter((k) => {
    const c = ptCounts(row, k)
    return row.dealProductTypes?.[k] || row.expectedByType?.[k] != null || c.ecg + c.spo2 + c.bp > 0
  })
}

/** 상품유형 미지정 ACTIVE 배치 수(ECG+SpO2+BP) */
function unassignedPtCount(row: CoverageRow): number {
  const u = ptCounts(row, '미지정')
  return u.ecg + u.spo2 + u.bp
}

/** compact 수치 셀 — 0은 회색 '0'(미등록 문구 없음) */
function PtCount({ n: v, title }: { n: number; title?: string }) {
  return (
    <span className={cn('tabular-nums', v === 0 && 'text-muted-foreground')} title={title}>
      {fmtInt(v)}
    </span>
  )
}

function LastEventCell({ row, today }: { row: CoverageRow; today: string }) {
  if (!row.registered || !row.lastEvent) return DASH
  const d = fmtDay(row.lastEvent.on, today)
  if (!d) return DASH
  return (
    <span className="whitespace-nowrap tabular-nums" title={`${d.full} ${eventTypeLabel(row.lastEvent.type)}`}>
      {d.short} <span className="text-muted-foreground">{eventTypeLabel(row.lastEvent.type)}</span>
    </span>
  )
}

function LastImportCell({ row, today }: { row: CoverageRow; today: string }) {
  if (!row.registered || !row.lastImport) return DASH
  const d = fmtKstDay(row.lastImport.at, today)
  if (!d) return DASH
  const occurred = toYmd(row.lastImport.occurredOn)
  return (
    <span
      className="whitespace-nowrap tabular-nums"
      title={`배치 #${row.lastImport.id} · ${d.full} 실행 · ${fmtInt(row.lastImport.rowCount)}행 / 등록 ${fmtInt(row.lastImport.registeredCount)}${occurred ? ` · 업무일자 ${occurred}` : ''}`}
    >
      {d.short} <span className="text-muted-foreground">({fmtInt(row.lastImport.rowCount)}행)</span>
    </span>
  )
}

/** '상품유형 혼합' 배지(+혼합 병원의 미지정 배치 수) — B-22. 계약완료 딜이 일반·라이트 둘 다인 병원 */
function MixedBadge({ row }: { row: CoverageRow }) {
  if (!row.productTypeMixed) return null
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="primary" title="계약완료 딜에 일반·라이트가 함께 있는 병원 — 등록 시 상품유형 선택 필수, 요약은 상품유형별 매트릭스">
        상품유형 혼합
      </Badge>
      {row.registered && row.unassignedProductType > 0 && (
        <Badge variant="warning" title="상품유형 미지정 상태로 배치 중인 기기 — 선택 바 [상품유형 지정]으로 정리">
          미지정 {fmtInt(row.unassignedProductType)}
        </Badge>
      )}
    </span>
  )
}

function RowAction({ row, onOpenHospital, onOpenImport }: { row: CoverageRow; onOpenHospital: (code: string) => void; onOpenImport: (code: string) => void }) {
  const stop = (e: MouseEvent) => e.stopPropagation()
  if (!row.registered) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          stop(e)
          onOpenImport(row.hospitalCode)
        }}
        title="이 병원의 임포트 탭으로 이동"
      >
        임포트
      </Button>
    )
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={(e) => {
        stop(e)
        onOpenHospital(row.hospitalCode)
      }}
      title="이 병원의 기기 목록으로 이동"
    >
      열기
    </Button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 본체
// ─────────────────────────────────────────────────────────────────────────────

export function GlobalCoverage({ filters, setFilters, onOpenHospital, onOpenImport, reloadKey, compact = false, preloaded = null, preloadedLoading = false }: GlobalCoverageProps) {
  const columns: readonly string[] = compact ? COMPACT_COLUMNS : COLUMNS
  const [res, setRes] = useState<CoverageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const today = useMemo(() => todayKst(), [])

  // 검색어 디바운스 — URL(q)로 반영
  const [qInput, setQInput] = useState(filters.q)
  const lastSent = useRef(filters.q)
  useEffect(() => {
    if (filters.q !== lastSent.current) {
      lastSent.current = filters.q
      setQInput(filters.q)
    }
  }, [filters.q])
  useEffect(() => {
    if (qInput === lastSent.current) return
    const t = window.setTimeout(() => {
      lastSent.current = qInput
      setFilters({ q: qInput })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [qInput, setFilters])

  // 조회 — 기본 필터 상태(전체·검색 없음·1페이지·차이순)면 오케스트레이터 캐시를 잘라 쓰고 fetch 생략(중복 요청 제거)
  const preloadedUsable =
    preloaded != null && filters.filter === 'all' && !filters.q && filters.page === 1 && filters.sort === 'diff' && (preloaded.data.length >= preloaded.total || preloaded.data.length >= filters.limit)
  useEffect(() => {
    if (preloadedUsable && preloaded) {
      setRes({ ...preloaded, data: preloaded.data.slice(0, filters.limit), limit: filters.limit })
      setError(null)
      setLoading(false)
      return
    }
    if (preloaded == null && preloadedLoading) return // 캐시가 오는 중 — 자체 fetch로 이중 조회하지 않는다
    let alive = true
    setLoading(true)
    getCoverage({ page: filters.page, limit: filters.limit, filter: filters.filter, q: filters.q || null, sort: filters.sort })
      .then((r) => {
        if (!alive) return
        setRes(r)
        setError(null)
      })
      .catch((e) => {
        if (!alive) return
        setError(errorMessage(e, '커버리지를 불러오지 못했습니다.'))
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.page, filters.limit, filters.filter, filters.q, filters.sort, reloadKey, retryKey, preloaded, preloadedLoading, preloadedUsable])

  const rows = res?.data ?? []
  const total = res?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / (filters.limit || 50)))

  // 필터 변경 등으로 페이지가 범위를 벗어나면 1페이지로
  useEffect(() => {
    if (!loading && res && rows.length === 0 && total > 0 && filters.page > 1) setFilters({ page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, res, total, filters.page])

  const showEmpty = !loading && !error && rows.length === 0
  const emptyText = filters.q || filters.filter !== 'all' ? '조건에 맞는 병원이 없습니다.' : '표시할 병원이 없습니다 — 계약완료 딜 보유 또는 기기 등록 병원이 여기 나열됩니다.'

  let statusRow: ReactNode = null
  if (loading && rows.length === 0) statusRow = <span className="text-muted-foreground">불러오는 중…</span>
  else if (error)
    statusRow = (
      <span className="inline-flex flex-wrap items-center justify-center gap-2 text-destructive">
        {error}
        <Button size="sm" variant="outline" onClick={() => setRetryKey((k) => k + 1)}>
          다시 시도
        </Button>
      </span>
    )
  else if (showEmpty) statusRow = <span className="text-muted-foreground">{emptyText}</span>

  return (
    <div className="space-y-3">
      {/* 필터 · 검색 · 정렬 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">필터</span>
          <Select className="w-32" value={filters.filter} onChange={(e) => setFilters({ filter: e.target.value as CoverageFilter })} aria-label="커버리지 필터">
            {FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground sm:max-w-xs">
          <span className="whitespace-nowrap">검색</span>
          <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="병원명/코드" aria-label="병원명/코드 검색" className="min-w-0" />
        </label>
        {!compact && (
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">정렬</span>
          <Select className="w-36" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as CoverageSort })} aria-label="정렬">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {res ? `병원 ${fmtInt(total)}개` : ''}
          {loading && res ? ' · 갱신 중…' : ''}
        </span>
      </div>

      {/* 데스크톱 표 */}
      <div className={cn('hidden rounded-lg border border-border bg-card md:block', loading && res && 'opacity-70 transition-opacity')}>
        <Table className="whitespace-nowrap">
          <THead>
            <tr>
              {columns.map((c, i) => (
                <TH key={c} className={cn(compact ? i >= 3 && i <= 8 && 'w-20 text-right' : cn(i >= 2 && i <= 8 && 'text-right', i === columns.length - 1 && 'text-right'))} title={COLUMN_TITLES[c as keyof typeof COLUMN_TITLES]}>
                  {c}
                </TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {statusRow ? (
              <tr>
                <TD colSpan={columns.length} className="py-12 text-center text-sm">
                  {statusRow}
                </TD>
              </tr>
            ) : compact ? (
              rows.map((row) => <CompactHospitalRow key={row.hospitalCode} row={row} today={today} onOpenHospital={onOpenHospital} />)
            ) : (
              rows.map((row) => (
                <TR
                  key={row.hospitalCode}
                  className={cn('cursor-pointer', !row.registered && 'text-muted-foreground')}
                  onClick={() => onOpenHospital(row.hospitalCode)}
                  title={row.registered ? '클릭 → 기기 목록' : '원장 미등록 병원 — 클릭 → 병원 뷰'}
                >
                  <TD>
                    <div className={cn('flex flex-wrap items-center gap-1.5 font-medium', row.registered ? 'text-foreground' : 'text-muted-foreground')}>
                      {row.hospitalName}
                      <MixedBadge row={row} />
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{row.hospitalCode}</div>
                  </TD>
                  <TD>{row.status ? <Badge variant={statusVariant(row.status)}>{row.status}</Badge> : DASH}</TD>
                  <TD className="text-right">
                    <ExpectedCell row={row} />
                  </TD>
                  <TD className="text-right">{row.registered ? <span className="tabular-nums font-medium">{fmtInt(row.activeEcg)}</span> : <span className="text-xs text-muted-foreground">미등록</span>}</TD>
                  <TD className="text-right">
                    <DiffCell row={row} />
                  </TD>
                  <TD className="text-right">
                    <EvalCell row={row} />
                  </TD>
                  <TD className="text-right">
                    <RegisteredNum row={row} value={row.activeSpo2} muted />
                  </TD>
                  <TD className="text-right">
                    <RegisteredNum row={row} value={row.activeGw} />
                  </TD>
                  <TD className="text-right">
                    <RegisteredNum row={row} value={row.recovered30d} />
                  </TD>
                  <TD>
                    <LastEventCell row={row} today={today} />
                  </TD>
                  <TD>
                    <LastImportCell row={row} today={today} />
                  </TD>
                  <TD className="text-right">
                    <RowAction row={row} onOpenHospital={onOpenHospital} onOpenImport={onOpenImport} />
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </div>

      {/* 모바일 카드 */}
      <div className="space-y-2 md:hidden">
        {statusRow ? (
          <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm">{statusRow}</div>
        ) : (
          rows.map((row) => (
            <div
              key={row.hospitalCode}
              className="rounded-lg border border-border bg-card p-3 text-sm shadow-sm"
              onClick={() => onOpenHospital(row.hospitalCode)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpenHospital(row.hospitalCode)
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                    <span className="truncate">{row.hospitalName}</span>
                    {!compact && <MixedBadge row={row} />}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{row.hospitalCode}</div>
                </div>
                {row.status ? <Badge variant={statusVariant(row.status)}>{row.status}</Badge> : null}
              </div>
              {compact ? (
                <>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <SaleTypeBadges row={row} />
                    <UnassignedPtBadge row={row} />
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-xs tabular-nums">
                    {(['일반', '라이트'] as const).map((k) => {
                      const c = ptCounts(row, k)
                      const expected = row.expectedByType?.[k] ?? null
                      return (
                        <div key={k}>
                          <span className="mr-1 inline-block w-10 text-muted-foreground">{k}</span>
                          <span title={expected != null ? `${k} 계약 ${fmtInt(expected)}대 (딜 모델별 수량 기준)` : undefined}>E {fmtInt(c.ecg)}</span> · S {fmtInt(c.spo2)} · BP {fmtInt(c.bp)}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-2 text-xs">
                    <span className="text-muted-foreground">마지막 이벤트 </span>
                    <LastEventCell row={row} today={today} />
                  </div>
                </>
              ) : (
              <>
              <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">계약 ECG</dt>
                <dt className="text-muted-foreground">배치 중 ECG</dt>
                <dt className="text-muted-foreground">차이</dt>
                <dd>
                  <ExpectedCell row={row} />
                </dd>
                <dd>{row.registered ? <span className="tabular-nums font-medium">{fmtInt(row.activeEcg)}</span> : <span className="text-muted-foreground">미등록</span>}</dd>
                <dd>
                  <DiffCell row={row} />
                </dd>
                <dt className="text-muted-foreground">SpO2(참고)</dt>
                <dt className="text-muted-foreground">GW</dt>
                <dt className="text-muted-foreground">회수(30일)</dt>
                <dd>
                  <RegisteredNum row={row} value={row.activeSpo2} muted />
                </dd>
                <dd>
                  <RegisteredNum row={row} value={row.activeGw} />
                </dd>
                <dd>
                  <RegisteredNum row={row} value={row.recovered30d} />
                </dd>
                {row.registered && (row.evalTotal ?? 0) > 0 && (
                  <>
                    <dt className="text-muted-foreground">평가용(별도)</dt>
                    <dd className="col-span-2">
                      <EvalCell row={row} />
                    </dd>
                  </>
                )}
              </dl>
              <div className="mt-2 flex items-end justify-between gap-2 text-xs">
                <div className="space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">마지막 이벤트 </span>
                    <LastEventCell row={row} today={today} />
                  </div>
                  <div>
                    <span className="text-muted-foreground">마지막 임포트 </span>
                    <LastImportCell row={row} today={today} />
                  </div>
                </div>
                <RowAction row={row} onOpenHospital={onOpenHospital} onOpenImport={onOpenImport} />
              </div>
              </>
              )}
            </div>
          ))
        )}
      </div>

      {/* 페이지네이션 */}
      {(total > 0 || filters.page > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            총 {fmtInt(total)}개 병원 · {filters.page} / {totalPages} 페이지
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={filters.page <= 1 || loading} onClick={() => setFilters({ page: filters.page - 1 })}>
              이전
            </Button>
            <Button size="sm" variant="outline" disabled={filters.page >= totalPages || loading} onClick={() => setFilters({ page: filters.page + 1 })}>
              다음
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 판매유형 배지 — 일반/라이트(합집합), 없으면 '—' */
function SaleTypeBadges({ row }: { row: CoverageRow }) {
  const types = saleTypes(row)
  if (types.length === 0) return DASH
  return (
    <span className="inline-flex items-center gap-1">
      {types.map((t) => (
        <Badge key={t} variant={t === '라이트' ? 'primary' : 'default'}>
          {t}
        </Badge>
      ))}
    </span>
  )
}

/** '미지정 n' warning 배지 — 상품유형 미지정 ACTIVE 배치가 있을 때만 */
function UnassignedPtBadge({ row }: { row: CoverageRow }) {
  const n = unassignedPtCount(row)
  if (n === 0) return null
  return (
    <Badge variant="warning" title={`상품유형 미지정 배치 ${fmtInt(n)}대 — 기기 목록에서 지정하세요`}>
      미지정 {fmtInt(n)}
    </Badge>
  )
}

/** compact 병원 1행(데스크톱) — 병원명(+미지정 배지) | 상태 | 판매유형 | 기기 6셀(일반/라이트) | 마지막 이벤트 */
function CompactHospitalRow({ row, today, onOpenHospital }: { row: CoverageRow; today: string; onOpenHospital: (code: string) => void }) {
  const normal = ptCounts(row, '일반')
  const lite = ptCounts(row, '라이트')
  const cells: { key: string; n: number; title?: string }[] = [
    { key: 'ecg', n: normal.ecg, title: row.expectedByType?.일반 != null ? `일반 계약 ${fmtInt(row.expectedByType.일반)}대 (딜 모델별 수량 기준)` : undefined },
    { key: 'ecg-lite', n: lite.ecg, title: row.expectedByType?.라이트 != null ? `라이트 계약 ${fmtInt(row.expectedByType.라이트)}대 (딜 모델별 수량 기준)` : undefined },
    { key: 'spo2', n: normal.spo2 },
    { key: 'spo2-lite', n: lite.spo2 },
    { key: 'bp', n: normal.bp, title: '링 혈압계(CART BP) SL-MPF1K07' },
    { key: 'bp-lite', n: lite.bp, title: '링 혈압계(CART BP) SL-MPF1K07' },
  ]
  return (
    <TR className="cursor-pointer" onClick={() => onOpenHospital(row.hospitalCode)} title="클릭 → 기기 목록">
      <TD>
        <div className="flex flex-wrap items-center gap-1.5 font-medium text-foreground" title={row.hospitalCode}>
          {row.hospitalName}
          <UnassignedPtBadge row={row} />
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">{row.hospitalCode}</div>
      </TD>
      <TD>{row.status ? <Badge variant={statusVariant(row.status)}>{row.status}</Badge> : DASH}</TD>
      <TD className="whitespace-nowrap">
        <SaleTypeBadges row={row} />
      </TD>
      {cells.map((c) => (
        <TD key={c.key} className="w-20 text-right">
          <PtCount n={c.n} title={c.title} />
        </TD>
      ))}
      <TD>
        <LastEventCell row={row} today={today} />
      </TD>
    </TR>
  )
}

export default GlobalCoverage