'use client'

/**
 * 사용량 — 전체 병원 대시보드 (projects/usage_overview_design.md §10, 2026-11-25 개편)
 * 수집 중인 병원 전체의 가동률을 서비스 단위로 본다. 병원을 누르면 병원별 화면(/usage?hospital=)으로 간다.
 * 위에서 아래로:
 *   제목·집계 시각 → 저장된 보기 목록 → 기기·판매모델 · 필터(종별 · 병원 지정 · 추이 기간)
 *   ① 핵심 수치 — 전체 가동률(+판매모델별) · 수집 범위(운영 병원 대비) · 측정 활동
 *   ② 전체 가동률 추이(고른 기간) · 종별 가동률 · 가동률 분포
 *   ③ 상위 10 · 하위 10
 *   ④ 이전 30일 대비 변화(많이 오른·내린 병원) · 점검 필요
 *   ⑤ 전체 병원 표 (필터·검색·정렬)
 * 조건(기기 · 판매모델 · 종별 · 병원 지정 · 추이 기간)은 주소에 담고, 저장된 보기는 `view=번호` 로 연다
 * (projects/usage_dashboard_filter_design.md). 필터는 서버가 걸어 화면 전체가 같은 병원 집합으로 다시 계산된다.
 * 계산 규칙은 lib/usage/overview.ts, 값은 일별 집계(lib/usage/stats.ts)에서 온다. 이 파일은 받은 값을 배치만 한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Minus, Server, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageHeader from '@/app/components/ui/PageHeader'
import Badge from '@/app/components/ui/Badge'
import { Card } from '@/app/components/ui/Card'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import type { UsageModel } from '@/lib/usage/metrics'
import type { OverviewDeviceKey, OverviewHold, OverviewRow, OverviewTotal, UsageOverview as OverviewData } from '@/lib/usage/overview'
import { DEFAULT_FILTERS, DEFAULT_TREND, diffFilters, filtersFromParams, filtersToParams, type ViewFilters } from '@/lib/usage/filters'
import UsageCriteriaButton from './UsageCriteria'
import { FilterBar } from './OverviewFilters'
import { ViewBar, type UsageViewItem } from './OverviewViews'

/** 조회 응답 — 저장된 보기로 열었으면 그 보기가 함께 온다 */
type Overview = OverviewData & { view: UsageViewItem | null }

const DEVICES: { key: OverviewDeviceKey; label: string }[] = [
  { key: 'ecg', label: '심전계' },
  { key: 'spo2', label: '산소포화도' },
  { key: 'cart', label: '카트온' },
]
const MODELS: { key: UsageModel; label: string }[] = [
  { key: 'all', label: '합산' },
  { key: 'general', label: '일반형' },
  { key: 'usage', label: '사용량비례형' },
]
/** 순위 영역이 보여 주는 병원 수 · 변화 영역이 보여 주는 병원 수 */
const RANK_N = 10
const MOVER_N = 5
/** 표 필터 — 앞의 넷은 늘 보이는 칩, 나머지는 '점검 필요'에서 고르는 조건 */
type Filter = 'all' | 'up' | 'down' | 'hold' | 'over' | 'zero' | 'delayed' | 'partial' | 'nocap'
type SortKey = 'rate' | 'prevRate' | 'change'
type Sort = { key: SortKey; desc: boolean }
type Ranked = OverviewRow & { rank: number | null }

const HOLD_LABEL: Record<OverviewHold, string> = {
  pending: '집계 전',
  no_capacity: '계약·공급 수량 없음',
  behind: '기기 이력 수신 중',
  short: '유효한 날 부족',
}
/** 가동률 분포 구간 — 10%p 간격, 마지막은 100% 초과 */
const BUCKETS = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100+']

const md = (date: string) => date.slice(5)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`)
const pct1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`)
const signedPp = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%p`
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`
const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString())
const stamp = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16) : '—')
const isPartial = (r: OverviewRow) => r.receive.expected !== null && r.receive.collecting < r.receive.expected

const FILTER_TEST: Record<Filter, (r: OverviewRow) => boolean> = {
  all: () => true,
  up: (r) => r.verdict === 'up',
  down: (r) => r.verdict === 'down',
  hold: (r) => r.verdict === 'hold',
  over: (r) => r.rate !== null && r.rate > 100,
  zero: (r) => r.rate !== null && r.rate === 0,
  delayed: (r) => r.receive.delayed,
  partial: isPartial,
  nocap: (r) => r.hold === 'no_capacity',
}

export default function UsageOverview() {
  const router = useRouter()
  const params = useSearchParams()
  const [views, setViews] = useState<UsageViewItem[] | null>(null)
  const [data, setData] = useState<Overview | null>(null)

  // 조건: 저장된 보기(view=번호)의 조건 위에 주소에 적힌 조건을 덮는다 — 서버(조회 API)와 같은 순서
  const qs = params.toString()
  const viewParam = params.get('view')
  const viewId = viewParam !== null && /^\d+$/.test(viewParam) ? Number(viewParam) : null
  const activeView = viewId === null ? null : (views?.find((v) => v.id === viewId) ?? (data?.view?.id === viewId ? data.view : null))
  const current: ViewFilters = useMemo(
    () => ({ ...(activeView?.filters ?? DEFAULT_FILTERS), ...filtersFromParams((k) => new URLSearchParams(qs).get(k)) }),
    [activeView, qs],
  )
  const { device, model } = current
  const viewChanged = !!activeView && diffFilters(current, activeView.filters).length > 0

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'rate', desc: true })
  const tableRef = useRef<HTMLDivElement>(null)

  /** 조건을 바꾼다 — 보기를 연 상태면 그 보기에서 달라진 것만 주소에 적는다('바뀜') */
  const update = useCallback(
    (patch: Partial<ViewFilters>) => {
      const next: ViewFilters = { ...current, ...patch }
      let q: URLSearchParams
      if (activeView) {
        q = filtersToParams(next, diffFilters(next, activeView.filters))
        q.set('view', String(activeView.id))
      } else q = filtersToParams(next)
      const s = q.toString()
      router.replace(s ? `/usage?${s}` : '/usage', { scroll: false })
    },
    [router, current, activeView],
  )
  /** 보기를 연다 (null = 조건 없는 전체) */
  const openView = useCallback((id: number | null) => router.replace(id === null ? '/usage' : `/usage?view=${id}`, { scroll: false }), [router])
  const loadViews = useCallback(async () => {
    const res = await fetch('/api/usage/views', { cache: 'no-store' })
    if (res.ok) setViews(((await res.json()).views ?? []) as UsageViewItem[])
    else setViews([])
  }, [])
  useEffect(() => {
    void loadViews()
  }, [loadViews])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fetch(`/api/usage/overview${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) {
          setError(body.error ?? '사용량을 불러오지 못했습니다.')
          setData(null)
        } else {
          setData(body as Overview)
        }
      })
      .catch(() => {
        if (alive) setError('사용량을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [qs])

  // 순위는 가동률 높은 순(서버가 그 순서로 준다) — 정렬·필터를 바꿔도 순위 숫자는 그대로다
  const ranked = useMemo<Ranked[]>(() => {
    let n = 0
    return (data?.rows ?? []).map((r) => ({ ...r, rank: r.rate === null ? null : ++n }))
  }, [data])
  const rated = useMemo(() => ranked.filter((r) => r.rate !== null), [ranked])
  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>
    for (const k of Object.keys(FILTER_TEST) as Filter[]) c[k] = ranked.filter(FILTER_TEST[k]).length
    return c
  }, [ranked])
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = ranked.filter((r) => (!q || r.hospitalName.toLowerCase().includes(q) || r.hospitalCode.toLowerCase().includes(q)) && FILTER_TEST[filter](r))
    // 값이 없는 병원은 정렬 방향과 무관하게 아래로
    const dir = sort.desc ? -1 : 1
    return [...list].sort((a, b) => {
      const x = a[sort.key]
      const y = b[sort.key]
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
      return (x - y) * dir
    })
  }, [ranked, filter, search, sort])

  const top = useMemo(() => rated.slice(0, RANK_N), [rated])
  const bottom = useMemo(() => [...rated].reverse().slice(0, RANK_N), [rated])
  const risers = useMemo(() => ranked.filter((r) => r.verdict === 'up').sort((a, b) => b.change! - a.change!).slice(0, MOVER_N), [ranked])
  const fallers = useMemo(() => ranked.filter((r) => r.verdict === 'down').sort((a, b) => a.change! - b.change!).slice(0, MOVER_N), [ranked])
  const dist = useMemo(() => {
    const bins = BUCKETS.map(() => 0)
    for (const r of rated) bins[r.rate! > 100 ? 10 : Math.min(9, Math.floor(r.rate! / 10))]++
    const sorted = rated.map((r) => r.rate!).sort((a, b) => a - b)
    const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    const mean = sorted.length === 0 ? null : sorted.reduce((a, b) => a + b, 0) / sorted.length
    return { bins, median, mean, max: Math.max(1, ...bins) }
  }, [rated])

  const total = data?.total
  /** 수집 서버가 등록된 병원 전체 수 — 필터와 무관 */
  const collectingTotal = (data?.options.types ?? []).reduce((a, t) => a + t.count, 0)
  const deviceLabel = DEVICES.find((d) => d.key === device)!.label
  const modelLabel = MODELS.find((m) => m.key === model)!.label
  /** 병원을 좁힌 조건을 한 줄로 — 제목 뒤에 붙인다 */
  const scopeText = [current.types.length > 0 ? current.types.join(' · ') : null, current.hospitals.length > 0 ? `지정 병원 ${current.hospitals.length}곳` : null].filter(Boolean).join(' · ')
  const open = useCallback(
    (r: OverviewRow) => {
      const q = new URLSearchParams({ hospital: r.hospitalCode, days: '30' })
      if (model !== 'all') q.set('model', model)
      return `/usage?${q.toString()}`
    },
    [model],
  )
  const toggleSort = (key: SortKey) => setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: true }))
  /** 위 영역에서 조건을 골라 아래 표로 내려간다 */
  const jump = (f: Filter) => {
    setFilter(f)
    setSearch('')
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const CHIPS: { key: Filter; label: string; title?: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'up', label: '증가', title: data ? `이전 30일보다 ${data.thresholds.trendPp}%p 이상 오른 병원` : undefined },
    { key: 'down', label: '감소', title: data ? `이전 30일보다 ${data.thresholds.trendPp}%p 이상 내린 병원` : undefined },
    { key: 'hold', label: '판정 보류', title: '집계 전 · 수량 없음 · 기기 이력 수신 중 · 유효한 날 부족' },
  ]
  const CHECKS: { key: Filter; label: string; hint: string }[] = [
    { key: 'over', label: '가동률 100% 초과', hint: '계약·공급 수량보다 많이 쓰고 있습니다 — 수량이나 판매모델 구분을 확인하세요' },
    { key: 'zero', label: '사용 없음 (0%)', hint: '최근 30일 동안 이 기기를 쓴 기록이 없습니다' },
    { key: 'delayed', label: '수신 지연', hint: `${data?.thresholds.receiveDelayHours ?? 24}시간 넘게 수신이 없습니다 — 그 뒤의 날은 평균에서 뺍니다` },
    { key: 'partial', label: '일부 서버만 수집', hint: '등록한 서버 중 일부만 수집 중입니다 — 수치가 낮게 나올 수 있습니다' },
    { key: 'nocap', label: '계약·공급 수량 없음', hint: '분모가 없어 가동률을 낼 수 없습니다' },
  ]
  const extraFilter = CHECKS.find((c) => c.key === filter)

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <PageHeader
        title="사용량"
        description="수집 중인 전체 병원의 가동률입니다. 병원을 누르면 그 병원의 일별 사용량으로 이동합니다."
        actions={
          // 좁은 화면에서는 줄을 바꾼다 (PageHeader 의 actions 칸은 줄어들지 않으므로 폭 상한을 준다)
          <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <div className="flex h-9 items-center gap-2 text-[13px] text-muted-foreground" data-testid="overview-run">
              <span aria-hidden className={`h-2 w-2 rounded-full ${data?.run ? 'bg-success' : 'bg-gray-400'}`} />
              <span>{data ? (data.run ? `집계 ${stamp(data.run.finishedAt)} · 수집 병원 ${collectingTotal}곳` : `집계 전 · 수집 병원 ${collectingTotal}곳`) : loading ? '불러오는 중' : '—'}</span>
            </div>
            <UsageCriteriaButton />
            <Link
              href="/usage/agents"
              data-testid="overview-agents"
              className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Server size={14} aria-hidden />
              에이전트 관리
            </Link>
          </div>
        }
      />

      <div className="flex flex-col gap-5">
        {/* 저장된 보기 — 누르면 그 조건으로 화면 전체가 바뀐다 */}
        <ViewBar views={views} activeId={activeView ? activeView.id : null} changed={viewChanged} current={current} onOpen={openView} onRevert={() => activeView && openView(activeView.id)} onReload={loadViews} />

        {/* 조건 — 아래 모든 영역에 함께 적용된다 */}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
          <Segmented label="기기" id="overview-device" options={DEVICES} value={device} onChange={(v) => update({ device: v })} />
          <Segmented label="판매모델" id="overview-model" options={MODELS} value={model} onChange={(v) => update({ model: v })} />
          <FilterBar
            filters={current}
            typeOptions={data?.options.types ?? []}
            firstDate={data?.options.firstDate ?? null}
            hospitalCount={data ? data.rows.length : null}
            onChange={update}
            onClear={() => update({ types: [], hospitals: [], trend: DEFAULT_TREND })}
          />
        </div>
        {data && (
          <p className="-mt-2 text-xs text-muted-foreground">
            가동률 · 순위 · 변화는 최근 30일 {md(data.recent.from)} ~ {md(data.recent.to)} (오늘 제외) 과 이전 30일 {md(data.prev.from)} ~ {md(data.prev.to)} 기준입니다. 추이 기간은 추이 영역에만 적용됩니다.
          </p>
        )}

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        {data?.run && data.run.failed.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            마지막 집계에서 병원 {data.run.failed.length}곳을 계산하지 못했습니다 — 그 병원의 값은 이전 집계 그대로입니다.
          </div>
        )}

        {/* 다시 불러오는 동안에는 이전 화면을 흐리게 유지한다 */}
        <div className={`flex flex-col gap-5 transition-opacity ${loading && data ? 'opacity-60' : ''}`}>
          {/* ① 핵심 수치 */}
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="flex flex-col justify-between gap-4 p-5 lg:col-span-5" data-testid="overview-total">
              <div>
                <div className="text-[13px] font-medium text-muted-foreground" data-testid="overview-total-title">
                  전체 {deviceLabel} 가동률{model !== 'all' && ` · ${modelLabel}`}
                  {scopeText && ` · ${scopeText}`}
                </div>
                <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                  <span className={`text-5xl font-bold leading-none tracking-tight ${total?.rate == null ? 'text-muted-foreground' : 'text-foreground'}`} data-testid="overview-total-rate">
                    {pct1(total?.rate)}
                  </span>
                  {total?.change != null && <Delta value={total.change} unit="pp" label="이전 30일 대비" />}
                </div>
                <p className="mt-2 text-[13px] text-muted-foreground" title="병원별 (최근 30일 평균 최대 동시사용 수)의 합 ÷ 병원별 계약·공급 수량의 합">
                  평균 최대 동시 <b className="font-semibold text-foreground">{num(total?.peakSum)}</b>대 / 계약·공급{' '}
                  <b className="font-semibold text-foreground">{num(total?.capacitySum)}</b>대 · 병원 {total?.rated ?? '—'}곳
                </p>
              </div>
              <div className="flex flex-col gap-2 border-t border-border pt-3.5" data-testid="overview-by-model">
                {MODELS.map((m) => (
                  <ModelMeter key={m.key} label={m.label} total={data?.byModel?.[m.key]} active={m.key === model} onClick={() => update({ model: m.key })} />
                ))}
              </div>
            </Card>

            <Card className="flex flex-col justify-between gap-4 p-5 lg:col-span-3" data-testid="overview-coverage">
              <div>
                <div className="text-[13px] font-medium text-muted-foreground">수집 범위 · 운영 병원 기준{scopeText && ` · ${scopeText}`}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-[28px] font-bold leading-tight text-foreground">{data ? data.coverage.collecting.toLocaleString() : '—'}</span>
                  <span className="text-sm text-muted-foreground">/ {data ? data.coverage.operating.toLocaleString() : '—'}곳</span>
                  {data && data.coverage.operating > 0 && (
                    <span className="ml-1 text-sm font-semibold text-foreground">{pct((data.coverage.collecting / data.coverage.operating) * 100)}</span>
                  )}
                </div>
                <Meter value={data && data.coverage.operating > 0 ? (data.coverage.collecting / data.coverage.operating) * 100 : null} className="mt-2.5" />
                <p className="mt-2 text-xs text-muted-foreground">{scopeText ? '같은 조건의 운영 병원' : '운영 중인 병원'} 가운데 최근 24시간 안에 수신한 병원</p>
              </div>
              <dl className="flex flex-col gap-1.5 border-t border-border pt-3.5 text-[13px]">
                <Row
                  label="수량 기준"
                  title={`운영 병원 전체의 ${deviceLabel} 계약·공급 수량 가운데 수집 중인 병원의 수량`}
                  value={
                    data?.coverage.capacityOperating
                      ? `${num(data.coverage.capacityCollecting)} / ${num(data.coverage.capacityOperating)}대 (${pct(((data.coverage.capacityCollecting ?? 0) / data.coverage.capacityOperating) * 100)})`
                      : '—'
                  }
                />
                <Row label="수신 지연" value={data ? `${data.coverage.delayed}곳` : '—'} warn={!!data && data.coverage.delayed > 0} />
                <Row label="일부 서버만 수집" value={data ? `${data.coverage.partial}곳` : '—'} warn={!!data && data.coverage.partial > 0} />
              </dl>
            </Card>

            <Card className="flex flex-col justify-between gap-4 p-5 lg:col-span-4" data-testid="overview-activity">
              <div>
                <div className="text-[13px] font-medium text-muted-foreground">
                  신규 측정 · 최근 30일{model !== 'all' && ` · ${modelLabel}`}
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[28px] font-bold leading-tight text-foreground">{data ? data.activity.started.toLocaleString() : '—'}</span>
                  <span className="text-sm text-muted-foreground">건</span>
                  {data?.activity.startedChange != null && <Delta value={data.activity.startedChange} unit="pct" label="이전 30일 대비" />}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  하루 평균 측정 환자 <b className="font-semibold text-foreground">{num(data?.activity.avgMeasured)}</b>명 · 이전 30일 {data ? data.activity.prevStarted.toLocaleString() : '—'}건 (전 병원 합)
                </p>
              </div>
              <DailyBars days={data?.activity.days ?? []} />
            </Card>
          </div>

          {/* ② 추이 · 종별 · 분포 */}
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-6" data-testid="overview-trend">
              <PanelHead
                title={
                  current.trend.kind === 'weeks'
                    ? `전체 가동률 ${current.trend.weeks}주 추이`
                    : current.trend.kind === 'all'
                      ? '전체 가동률 추이 · 전체 기간'
                      : `전체 가동률 추이 · ${data?.trend.from ?? current.trend.from} ~ ${data?.trend.to ?? current.trend.to}`
                }
                note={`${data?.trend.unit === 'month' ? '달' : '주(월~일)'}마다 병원별 평균 최대 동시의 합 ÷ 수량의 합`}
              />
              <div className="px-2 pb-3 pt-1 sm:px-4">
                <TrendChart trend={data?.trend ?? null} />
              </div>
            </Card>
            <Card className="lg:col-span-3" data-testid="overview-by-type">
              <PanelHead title="종별 가동률" note="누르면 그 종별만" />
              <TypeBreakdown
                rows={data?.byType ?? []}
                selected={current.types}
                loading={loading}
                onPick={(t) => update({ types: current.types.length === 1 && current.types[0] === t ? [] : [t] })}
              />
            </Card>
            <Card className="lg:col-span-3" data-testid="overview-dist">
              <PanelHead
                title="가동률 분포"
                note={dist.median === null ? '병원 수 · 10%p 구간' : `중앙값 ${pct(dist.median)} · 평균 ${pct(dist.mean)}`}
              />
              <Distribution bins={dist.bins} max={dist.max} />
            </Card>
          </div>

          {/* ③ 상위 · 하위 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card data-testid="overview-top">
              <PanelHead title={`가동률 상위 ${RANK_N}`} note="최근 30일 · 평균 최대 동시 / 계약·공급 수량" />
              <RankList rows={top} open={open} empty={loading ? '불러오는 중...' : '가동률을 낼 수 있는 병원이 없습니다.'} />
            </Card>
            <Card data-testid="overview-bottom">
              <PanelHead title={`가동률 하위 ${RANK_N}`} note={counts.zero > RANK_N ? `0%인 병원이 ${counts.zero}곳 있어 그중 ${RANK_N}곳만 보입니다` : '가동률이 낮은 순'} />
              <RankList rows={bottom} open={open} empty={loading ? '불러오는 중...' : '가동률을 낼 수 있는 병원이 없습니다.'} />
            </Card>
          </div>

          {/* ④ 변화 · 점검 */}
          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-8" data-testid="overview-change">
              <PanelHead title="이전 30일 대비 변화" note={data ? `±${data.thresholds.trendPp}%p 이상이면 증가·감소 · 유효한 날 ${data.thresholds.minValidDays}일 미만은 판정 보류` : undefined} />
              <VerdictBar total={total} onPick={jump} />
              <div className="grid gap-x-6 border-t border-border sm:grid-cols-2">
                <MoverList title="많이 오른 병원" tone="up" rows={risers} open={open} empty="증가한 병원이 없습니다." />
                <MoverList title="많이 내린 병원" tone="down" rows={fallers} open={open} empty="감소한 병원이 없습니다." className="border-t border-border sm:border-l sm:border-t-0" />
              </div>
            </Card>
            <Card className="lg:col-span-4" data-testid="overview-checks">
              <PanelHead title="점검 필요" note="누르면 아래 표에서 해당 병원만 봅니다" />
              <ul className="divide-y divide-border">
                {CHECKS.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      disabled={!counts[c.key]}
                      onClick={() => jump(c.key)}
                      title={c.hint}
                      data-testid={`overview-check-${c.key}`}
                      className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left text-[13px] transition-colors enabled:hover:bg-accent/50 disabled:cursor-default"
                    >
                      <AlertTriangle size={14} aria-hidden className={counts[c.key] ? 'text-warning' : 'text-muted-foreground/40'} />
                      <span className={counts[c.key] ? 'text-foreground' : 'text-muted-foreground'}>{c.label}</span>
                      <span className={`ml-auto tabular-nums ${counts[c.key] ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{data ? counts[c.key] : '—'}곳</span>
                      <ChevronRight size={14} aria-hidden className={counts[c.key] ? 'text-muted-foreground' : 'invisible'} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* ⑤ 전체 병원 표 */}
          <div ref={tableRef} className="scroll-mt-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-b border-border px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h3 className="text-sm font-semibold">전체 병원</h3>
                <div role="group" aria-label="빠른 필터" className="flex flex-wrap gap-1.5">
                  {CHIPS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      aria-pressed={filter === f.key}
                      title={f.title}
                      data-testid={`overview-filter-${f.key}`}
                      onClick={() => setFilter(f.key)}
                      className={`h-7 rounded-full border px-3 text-xs font-medium tabular-nums transition-colors ${
                        filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      {f.label} {counts[f.key]}
                    </button>
                  ))}
                  {extraFilter && (
                    <button
                      type="button"
                      data-testid="overview-filter-extra"
                      onClick={() => setFilter('all')}
                      title="조건 지우기"
                      className="flex h-7 items-center gap-1 rounded-full border border-primary bg-primary px-3 text-xs font-medium tabular-nums text-primary-foreground"
                    >
                      {extraFilter.label} {counts[extraFilter.key]}
                      <X size={12} aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="병원 검색"
                aria-label="병원 검색"
                className="h-8 w-[200px] rounded-md border border-border bg-card px-3 text-[13px] text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" data-testid="overview-table">
                <thead className="bg-muted">
                  <tr className="text-xs font-medium text-muted-foreground">
                    <th scope="col" className="w-12 whitespace-nowrap px-5 py-2.5 text-right">#</th>
                    <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-left">병원</th>
                    <SortHeader label="가동률 (최근 30일)" k="rate" sort={sort} onSort={toggleSort} title={data ? `${md(data.recent.from)} ~ ${md(data.recent.to)} · 오늘 제외 · 평균 최대 동시사용 수 / 계약·공급 수량` : undefined} />
                    <SortHeader label="이전 30일" k="prevRate" sort={sort} onSort={toggleSort} title={data ? `${md(data.prev.from)} ~ ${md(data.prev.to)}` : undefined} />
                    <SortHeader label="변화" k="change" sort={sort} onSort={toggleSort} title="최근 30일 − 이전 30일 (%p)" />
                    <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-left" title="주(월~일)별 가동률 평균, 왼쪽이 12주 전 · 오른쪽이 이번 주">
                      12주 추이
                    </th>
                    <th scope="col" className="whitespace-nowrap px-5 py-2.5 text-left">수신</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">
                        {loading ? '불러오는 중...' : ranked.length === 0 ? (scopeText ? '고른 조건에 수집 중인 병원이 없습니다. 필터를 바꿔 보세요.' : '아직 수집 중인 병원이 없습니다. 병원 서버에 수집 Agent를 설치하면 여기에 나타납니다.') : '조건에 맞는 병원이 없습니다.'}
                      </td>
                    </tr>
                  )}
                  {visible.map((r) => (
                    <tr key={r.hospitalCode} data-testid={`overview-row-${r.hospitalCode}`} onClick={() => router.push(open(r))} className="cursor-pointer transition-colors hover:bg-accent/50">
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{r.rank ?? '—'}</td>
                      <td className="whitespace-nowrap px-3.5 py-3">
                        <Link href={open(r)} onClick={(e) => e.stopPropagation()} className="font-medium text-foreground hover:underline">
                          {r.hospitalName}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">{r.hospitalType}</span>
                        {isPartial(r) && (
                          <Badge
                            variant="warning"
                            className="ml-2"
                            data-testid={`overview-partial-${r.hospitalCode}`}
                            title={`등록한 서버 ${r.receive.expected}대 중 ${r.receive.collecting}대만 수집 중입니다(최근 24시간) — 이 병원의 수치는 일부 서버의 것일 수 있습니다. 에이전트 관리에서 확인하세요`}
                          >
                            서버 {r.receive.collecting}/{r.receive.expected}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3.5 py-3 text-right">
                        <RateCell row={r} />
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-3 text-right tabular-nums text-muted-foreground" title={r.prevRate === null ? undefined : `유효한 날 ${r.prevValidDays}일`}>
                        {pct(r.prevRate)}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-3 text-right">
                        <ChangeCell row={r} />
                      </td>
                      <td className="px-3.5 py-3">
                        <Sparkline weeks={r.weeks} tone={r.verdict} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <ReceiveCell row={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && (
              <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                가동률 = 그날 최대 동시사용 수 ÷ 그날의 계약·공급 수량, 그 일별 값의 평균. 최근 30일({md(data.recent.from)} ~ {md(data.recent.to)}, 오늘 제외)과 이전 30일({md(data.prev.from)} ~ {md(data.prev.to)})을 비교해{' '}
                {data.thresholds.trendPp}%p 이상 차이 나면 증가·감소로 봅니다. 어느 한 기간의 유효한 날이 {data.thresholds.minValidDays}일 미만이면 판정을 보류합니다.
              </p>
            )}
          </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function Segmented<T extends string>({ label, id, options, value, onChange }: { label: string; id: string; options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div id={`${id}-label`} className="text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div role="group" aria-labelledby={`${id}-label`} className="flex h-9 gap-1 rounded-md border border-border bg-card p-[3px]">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={o.key === value}
            data-testid={`${id}-${o.key}`}
            onClick={() => onChange(o.key)}
            className={`h-7 rounded px-3.5 text-[13px] font-medium transition-colors ${
              o.key === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PanelHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 pb-2.5 pt-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

/** 증감 표시 — 방향은 화살표와 부호로도 읽힌다 (색만으로 구분하지 않는다) */
function Delta({ value, unit, label }: { value: number; unit: 'pp' | 'pct'; label: string }) {
  const flat = Math.abs(value) < 0.05
  const tone = flat ? 'text-muted-foreground' : value > 0 ? 'text-success' : 'text-destructive'
  return (
    <span className="inline-flex items-center gap-1 text-[13px]">
      <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${tone}`}>
        {flat ? <Minus size={13} aria-hidden /> : value > 0 ? <ArrowUp size={13} aria-label="증가" /> : <ArrowDown size={13} aria-label="감소" />}
        {unit === 'pp' ? signedPp(value) : signedPct(value)}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

/** 0~100% 가로 막대. 100%를 넘으면 끝까지 채운다 */
function Meter({ value, className = '', thin = false }: { value: number | null; className?: string; thin?: boolean }) {
  return (
    <div aria-hidden className={`${thin ? 'h-1.5' : 'h-2'} w-full overflow-hidden rounded-full bg-primary/15 ${className}`}>
      {value !== null && <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />}
    </div>
  )
}

/** 판매모델별 전체 가동률 한 줄 — 누르면 그 판매모델로 본다 */
function ModelMeter({ label, total, active, onClick }: { label: string; total: OverviewTotal | undefined; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={total?.rate == null ? undefined : `평균 최대 동시 ${num(total.peakSum)}대 / 계약·공급 ${num(total.capacitySum)}대 · 병원 ${total.rated}곳`}
      className="group grid grid-cols-[84px_1fr_92px] items-center gap-3 rounded text-left text-[13px]"
    >
      <span className={active ? 'font-semibold text-foreground' : 'text-muted-foreground group-hover:text-foreground'}>{label}</span>
      <Meter value={total?.rate ?? null} thin />
      <span className="text-right tabular-nums">
        <b className={`font-semibold ${total?.rate == null ? 'text-muted-foreground' : 'text-foreground'}`}>{pct1(total?.rate)}</b>
        <span className="ml-1.5 text-xs text-muted-foreground">{total ? `${total.rated}곳` : ''}</span>
      </span>
    </button>
  )
}

function Row({ label, value, title, warn }: { label: string; value: string; title?: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3" title={title}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${warn ? 'font-semibold text-foreground' : 'text-foreground'}`}>
        {warn && <AlertTriangle size={12} aria-hidden className="mr-1 inline -translate-y-px text-warning" />}
        {value}
      </dd>
    </div>
  )
}

/** 최근 30일 일별 신규 측정 수 — 작은 막대. 값은 막대에 올리면 보이고, 합계는 위 숫자가 말한다 */
function DailyBars({ days }: { days: Overview['activity']['days'] }) {
  if (days.length === 0) return <div className="flex h-12 items-end border-t border-border pt-3.5 text-xs text-muted-foreground">일별 집계가 아직 없습니다.</div>
  const max = Math.max(1, ...days.map((d) => d.started))
  return (
    <div className="border-t border-border pt-3.5">
      <div className="flex h-12 items-end gap-[2px]" role="img" aria-label={`일별 신규 측정 수 ${md(days[0].date)} ~ ${md(days[days.length - 1].date)}`}>
        {days.map((d) => (
          <div key={d.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${md(d.date)} · 신규 측정 ${d.started.toLocaleString()}건 · 측정 환자 ${d.measured.toLocaleString()}명`}>
            <div className="w-full rounded-t-[3px] bg-primary/45 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(d.started > 0 ? 4 : 0, (d.started / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{md(days[0].date)}</span>
        <span>일별 신규 측정 수</span>
        <span>{md(days[days.length - 1].date)}</span>
      </div>
    </div>
  )
}

/** 전체 가동률 추이 — 한 줄짜리 선. 고른 기간을 주 또는 달 단위로, 진행 중인 마지막 구간까지 그리고 마지막 값에 표시 */
function TrendChart({ trend }: { trend: Overview['trend'] | null }) {
  const chart = useChartTheme()
  const month = trend?.unit === 'month'
  const rows = (trend?.points ?? []).map((w) => ({ label: w.label, rate: w.rate === null ? null : Math.round(w.rate * 10) / 10, hospitals: w.hospitals }))
  const values = rows.map((r) => r.rate).filter((v): v is number => v !== null)
  if (values.length === 0) return <div className="flex h-[220px] items-center justify-center px-4 text-center text-sm text-muted-foreground">{trend && trend.points.length === 0 ? '고른 기간에 집계가 없습니다.' : '추이를 그릴 집계가 아직 없습니다.'}</div>
  const hi = Math.max(...values)
  // 세로축: 0 에서 시작, 눈금은 10·20·50 단위의 깔끔한 값
  const step = hi * 1.15 <= 50 ? 10 : hi * 1.15 <= 100 ? 20 : 50
  const top = Math.max(step, Math.ceil((hi * 1.15) / step) * step)
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)
  const lastIdx = rows.map((r) => r.rate !== null).lastIndexOf(true)
  return (
    <div className="h-[220px]" role="img" aria-label={`전체 가동률 추이: ${rows.map((r) => `${r.label} ${r.rate === null ? '없음' : r.rate + '%'}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 18, right: 58, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke={chart.grid} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={{ stroke: chart.grid }} interval="preserveStartEnd" minTickGap={14} />
          <YAxis domain={[0, top]} ticks={ticks} tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} width={48} />
          <Tooltip
            cursor={{ stroke: chart.tick, strokeWidth: 1 }}
            contentStyle={chart.tooltip}
            labelFormatter={(l) => (month ? `${l}` : `${l} 주`)}
            formatter={(v, _n, item) => [`${v}% · 병원 ${(item?.payload as { hospitals?: number })?.hospitals ?? 0}곳`, '가동률']}
          />
          <Line
            type="monotone"
            dataKey="rate"
            stroke={chart.blue}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={{ r: 5, stroke: chart.tooltip.backgroundColor, strokeWidth: 2 }}
            dot={(p: { cx?: number; cy?: number; index?: number; value?: number | null }) => {
              if (p.cx == null || p.cy == null || p.value == null) return <g key={`d${p.index}`} />
              const last = p.index === lastIdx
              return (
                <g key={`d${p.index}`}>
                  <circle cx={p.cx} cy={p.cy} r={last ? 4.5 : rows.length > 30 ? 1.5 : 2.5} fill={chart.blue} stroke={chart.tooltip.backgroundColor} strokeWidth={last ? 2 : 1} />
                  {last && (
                    <text x={p.cx + 9} y={p.cy + 4} fontSize={12} fontWeight={700} fill={chart.tooltip.color}>
                      {p.value}%
                    </text>
                  )}
                </g>
              )
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** 종별마다 전체 가동률(Σ 평균 최대 동시 ÷ Σ 수량) · 병원 수 · 이전 30일 대비. 줄을 누르면 그 종별 하나로 필터 */
function TypeBreakdown({ rows, selected, loading, onPick }: { rows: Overview['byType']; selected: string[]; loading: boolean; onPick: (type: string) => void }) {
  if (rows.length === 0) return <p className="px-5 pb-6 pt-3 text-center text-sm text-muted-foreground">{loading ? '불러오는 중...' : '표시할 종별이 없습니다.'}</p>
  return (
    <ul className="pb-2">
      {rows.map((r) => {
        const on = selected.includes(r.type)
        const dim = selected.length > 0 && !on
        return (
          <li key={r.type}>
            <button
              type="button"
              aria-pressed={on}
              data-testid={`by-type-${r.type}`}
              onClick={() => onPick(r.type)}
              title={r.total.rate == null ? `${r.type} · 병원 ${r.hospitals}곳` : `${r.type} · 평균 최대 동시 ${num(r.total.peakSum)}대 / 계약·공급 ${num(r.total.capacitySum)}대 · 병원 ${r.hospitals}곳`}
              className={`flex w-full flex-col gap-1 px-5 py-2 text-left transition-colors hover:bg-accent/50 ${dim ? 'opacity-50' : ''}`}
            >
              <span className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className={on ? 'font-semibold text-foreground' : 'text-foreground'}>
                  {r.type}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{r.hospitals}곳</span>
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  <b className={`font-bold ${r.total.rate == null ? 'text-muted-foreground' : 'text-foreground'}`}>{pct1(r.total.rate)}</b>
                  {r.total.change != null && (
                    <span className={`ml-1.5 text-xs ${Math.abs(r.total.change) < 0.05 ? 'text-muted-foreground' : r.total.change > 0 ? 'text-success' : 'text-destructive'}`}>{signedPp(r.total.change)}</span>
                  )}
                </span>
              </span>
              <Meter value={r.total.rate ?? null} thin />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** 가동률 10%p 구간별 병원 수 — 세로 막대, 값은 막대 위에 */
function Distribution({ bins, max }: { bins: number[]; max: number }) {
  const total = bins.reduce((a, b) => a + b, 0)
  if (total === 0) return <div className="flex h-[220px] items-center justify-center px-5 text-sm text-muted-foreground">가동률을 낼 수 있는 병원이 없습니다.</div>
  return (
    <div className="px-5 pb-4 pt-1">
      <div className="flex h-[176px] items-end gap-[2px] border-b border-border" role="img" aria-label={`가동률 구간별 병원 수: ${bins.map((n, i) => `${BUCKETS[i]}%대 ${n}곳`).join(', ')}`}>
        {bins.map((n, i) => (
          <div key={i} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${i === 10 ? '100% 초과' : `${i * 10}% 이상 ${i * 10 + 10}% 미만`} · ${n}곳`}>
            <span className={`mb-1 text-[11px] tabular-nums ${n ? 'text-foreground' : 'text-muted-foreground/50'}`}>{n}</span>
            <div
              className={`w-full max-w-[24px] rounded-t-[4px] transition-colors ${i === 10 ? 'bg-warning/70 group-hover:bg-warning' : 'bg-primary/70 group-hover:bg-primary'}`}
              style={{ height: `${n === 0 ? 0 : Math.max(3, (n / max) * 140)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[11px] tabular-nums text-muted-foreground">
        {BUCKETS.map((b) => (
          <span key={b} className="min-w-0 flex-1 text-center">
            {b}
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">가동률(%) — 구간의 시작 값, 100+ 는 수량보다 많이 쓰는 병원</p>
    </div>
  )
}

/** 순위 목록 — 순위 · 병원 · 막대 · 비율(주 정보) · 평균 최대 동시 / 수량 · 변화 */
function RankList({ rows, open, empty }: { rows: Ranked[]; open: (r: OverviewRow) => string; empty: string }) {
  if (rows.length === 0) return <p className="px-5 pb-6 pt-3 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <ol className="pb-2">
      {rows.map((r) => (
        <li key={r.hospitalCode}>
          <Link href={open(r)} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-2 transition-colors hover:bg-accent/50 sm:grid-cols-[28px_minmax(0,11rem)_minmax(0,1fr)_auto]">
            <span className="text-right text-xs tabular-nums text-muted-foreground">{r.rank}</span>
            <span className="truncate text-[13px] font-medium text-foreground" title={r.hospitalName}>
              {r.hospitalName}
            </span>
            <span className="hidden items-center gap-2 sm:flex">
              <Meter value={r.rate} />
              {r.rate! > 100 && (
                <span className="shrink-0 text-warning" title="계약·공급 수량보다 많이 쓰고 있습니다">
                  <AlertTriangle size={12} aria-label="100% 초과" />
                </span>
              )}
            </span>
            <span className="flex items-baseline justify-end gap-2 whitespace-nowrap tabular-nums">
              <span className="hidden text-xs text-muted-foreground md:inline">
                {r.avgPeak === null ? '—' : r.avgPeak.toFixed(1)} / {r.capacity === null ? '—' : r.capacity.toLocaleString()}
              </span>
              <b className="w-12 text-right text-sm font-bold text-foreground">{pct(r.rate)}</b>
              <MiniChange row={r} />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

/** 순위 목록의 변화 표시 — 증가·감소만 화살표, 유지·보류는 흐리게 */
function MiniChange({ row }: { row: OverviewRow }) {
  if (row.change === null || row.verdict === 'hold') return <span className="w-[72px] text-right text-xs text-muted-foreground/60">—</span>
  const tone = row.verdict === 'up' ? 'text-success' : row.verdict === 'down' ? 'text-destructive' : 'text-muted-foreground'
  return (
    <span className={`inline-flex w-[72px] items-center justify-end gap-0.5 text-xs ${tone}`} title="이전 30일 대비">
      {row.verdict === 'up' && <ArrowUp size={11} aria-label="증가" />}
      {row.verdict === 'down' && <ArrowDown size={11} aria-label="감소" />}
      {signedPp(row.change)}
    </span>
  )
}

/** 증가·유지·감소·판정 보류 병원 수 — 한 줄 막대 + 범례(수치). 범례를 누르면 아래 표에서 그 병원만 본다 */
function VerdictBar({ total, onPick }: { total: OverviewTotal | undefined; onPick: (f: Filter) => void }) {
  const parts: { key: 'up' | 'flat' | 'down' | 'hold'; label: string; value: number; bar: string; filter: Filter | null; icon?: 'up' | 'down' }[] = [
    { key: 'up', label: '증가', value: total?.up ?? 0, bar: 'bg-success', filter: 'up', icon: 'up' },
    { key: 'flat', label: '유지', value: total?.flat ?? 0, bar: 'bg-muted-foreground/45', filter: null },
    { key: 'down', label: '감소', value: total?.down ?? 0, bar: 'bg-destructive', filter: 'down', icon: 'down' },
    { key: 'hold', label: '판정 보류', value: total?.hold ?? 0, bar: 'bg-muted-foreground/20', filter: 'hold' },
  ]
  const sum = parts.reduce((a, p) => a + p.value, 0)
  return (
    <div className="px-5 pb-4 pt-1">
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}곳`).join(', ')}>
        {sum === 0 ? <div className="h-full w-full bg-muted" /> : parts.filter((p) => p.value > 0).map((p) => <div key={p.key} className={`h-full ${p.bar}`} style={{ width: `${(p.value / sum) * 100}%` }} title={`${p.label} ${p.value}곳`} />)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        {parts.map((p) => {
          const body = (
            <>
              <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${p.bar}`} />
              <span className="text-muted-foreground">{p.label}</span>
              {p.icon === 'up' && <ArrowUp size={12} aria-hidden className="text-success" />}
              {p.icon === 'down' && <ArrowDown size={12} aria-hidden className="text-destructive" />}
              <b className="text-base font-bold tabular-nums text-foreground">{total ? p.value : '—'}</b>
              <span className="text-xs text-muted-foreground">곳</span>
            </>
          )
          return p.filter && p.value > 0 ? (
            <button key={p.key} type="button" onClick={() => onPick(p.filter!)} data-testid={`overview-verdict-${p.key}`} className="flex items-center gap-1.5 rounded hover:underline">
              {body}
            </button>
          ) : (
            <span key={p.key} data-testid={`overview-verdict-${p.key}`} className="flex items-center gap-1.5">
              {body}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** 변화가 큰 병원 — 이전 → 최근, 변화폭, 12주 추이 */
function MoverList({ title, tone, rows, open, empty, className = '' }: { title: string; tone: 'up' | 'down'; rows: Ranked[]; open: (r: OverviewRow) => string; empty: string; className?: string }) {
  return (
    <div className={`pb-2 ${className}`}>
      <div className="flex items-center gap-1.5 px-5 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
        {tone === 'up' ? <ArrowUp size={12} aria-hidden className="text-success" /> : <ArrowDown size={12} aria-hidden className="text-destructive" />}
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-5 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.hospitalCode}>
              <Link href={open(r)} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-5 py-1.5 transition-colors hover:bg-accent/50">
                <span className="truncate text-[13px] font-medium text-foreground" title={r.hospitalName}>
                  {r.hospitalName}
                </span>
                <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {pct(r.prevRate)} → <b className="font-semibold text-foreground">{pct(r.rate)}</b>
                </span>
                <span className={`w-[68px] whitespace-nowrap text-right text-[13px] font-semibold tabular-nums ${tone === 'up' ? 'text-success' : 'text-destructive'}`}>{signedPp(r.change!)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SortHeader({ label, k, sort, onSort, title }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; title?: string }) {
  const active = sort.key === k
  return (
    <th scope="col" aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'} className="whitespace-nowrap px-3.5 py-2.5 text-right" title={title}>
      <button type="button" data-testid={`overview-sort-${k}`} onClick={() => onSort(k)} className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground' : ''}`}>
        {label}
        {active ? sort.desc ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden /> : <span aria-hidden className="w-3" />}
      </button>
    </th>
  )
}

/** '평균 최대 동시 / 수량 (비율)' — 비율이 주 정보(굵게), 아래에 막대 */
function RateCell({ row }: { row: OverviewRow }) {
  if (row.rate === null) return <span className="text-muted-foreground">—</span>
  return (
    <div className="ml-auto flex w-[190px] flex-col items-end gap-1">
      <div className="whitespace-nowrap tabular-nums" title={`유효한 날 ${row.validDays}일의 평균`}>
        <span className="text-muted-foreground">
          {row.avgPeak === null ? '—' : row.avgPeak.toFixed(1)} / {row.capacity === null ? '—' : row.capacity.toLocaleString()}
        </span>{' '}
        <span className="font-bold text-foreground">({pct(row.rate)})</span>
      </div>
      <Meter value={row.rate} thin />
    </div>
  )
}

function ChangeCell({ row }: { row: OverviewRow }) {
  const tone = row.verdict === 'up' ? 'text-success' : row.verdict === 'down' ? 'text-destructive' : row.verdict === 'hold' ? 'text-muted-foreground' : 'text-foreground'
  const holdText =
    row.hold === 'short' ? `${HOLD_LABEL.short} (최근 ${row.validDays}일 · 이전 ${row.prevValidDays}일)` : row.hold ? HOLD_LABEL[row.hold] : null
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={`inline-flex items-center gap-1 tabular-nums ${tone} ${row.verdict === 'up' || row.verdict === 'down' ? 'font-semibold' : ''}`}>
        {row.verdict === 'up' && <ArrowUp size={13} aria-label="증가" />}
        {row.verdict === 'down' && <ArrowDown size={13} aria-label="감소" />}
        {row.change === null ? '—' : signedPp(row.change)}
      </span>
      {holdText && <span className="text-[11px] text-muted-foreground">판정 보류 · {holdText}</span>}
      {row.capacityChange && (
        <span className="text-[11px] text-muted-foreground tabular-nums" title="두 기간 사이에 계약·공급 수량이 바뀌었습니다 — 사용이 그대로여도 가동률이 달라집니다">
          수량 {row.capacityChange.from.toLocaleString()} → {row.capacityChange.to.toLocaleString()}
        </span>
      )}
    </div>
  )
}

/** 주별 가동률 12개를 잇는 작은 선 — 모양(오르내림)을 보는 용도라 병원마다 세로 범위를 따로 잡는다. 값이 없는 주는 끊는다 */
function Sparkline({ weeks, tone }: { weeks: OverviewRow['weeks']; tone: OverviewRow['verdict'] }) {
  const W = 132
  const H = 28
  const PAD = 3
  const values = weeks.map((w) => w.rate).filter((v): v is number => v !== null)
  if (values.length === 0) return <span className="text-muted-foreground">—</span>
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi - lo < 10) {
    // 변화가 작으면 잡음이 크게 보이지 않게 최소 10%p 범위로
    const mid = (hi + lo) / 2
    lo = mid - 5
    hi = mid + 5
  }
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, weeks.length - 1)
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD)
  const segments: string[] = []
  let cur: string[] = []
  weeks.forEach((w, i) => {
    if (w.rate === null) {
      if (cur.length) segments.push(cur.join(' '))
      cur = []
    } else cur.push(`${x(i).toFixed(1)},${y(w.rate).toFixed(1)}`)
  })
  if (cur.length) segments.push(cur.join(' '))
  const lastIdx = weeks.map((w) => w.rate !== null).lastIndexOf(true)
  const color = tone === 'up' ? 'text-success' : tone === 'down' ? 'text-destructive' : 'text-muted-foreground'
  const label = weeks.map((w) => `${md(w.weekStart)} 주 ${w.rate === null ? '—' : Math.round(w.rate) + '%'}`).join('\n')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`12주 추이: ${weeks.map((w) => (w.rate === null ? '없음' : Math.round(w.rate) + '%')).join(', ')}`} className={color}>
      <title>{label}</title>
      {segments.map((pts, i) => (pts.includes(' ') ? <polyline key={i} points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /> : null))}
      {weeks.map((w, i) => (w.rate === null ? null : <circle key={i} cx={x(i)} cy={y(w.rate)} r={i === lastIdx ? 2.5 : 1.2} fill="currentColor" />))}
    </svg>
  )
}

function ReceiveCell({ row }: { row: OverviewRow }) {
  const { lastSuccessAt, delayed, behind } = row.receive
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {delayed ? (
        <Badge variant="warning" title="마지막 수신 이후의 날은 평균에서 뺐습니다">
          수신 지연 · {lastSuccessAt ? stamp(lastSuccessAt) : '기록 없음'}
        </Badge>
      ) : (
        <span className="text-[13px] text-muted-foreground tabular-nums" title="마지막 수신">
          {stamp(lastSuccessAt)}
        </span>
      )}
      {behind && (
        <Badge variant="outline" title="기기 상태 이력을 아직 다 받지 못했습니다 — 과거 가동률이 낮게 나올 수 있습니다">
          이력 수신 중
        </Badge>
      )}
    </div>
  )
}
