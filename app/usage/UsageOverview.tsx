'use client'

/**
 * 사용량 — 전체 병원 화면 (projects/usage_overview_design.md)
 * 수집 중인 병원을 한 표에 놓고 가동률 순위와 변화를 본다. 병원을 누르면 병원별 화면(/usage?hospital=)으로 간다.
 * 위에서 아래로: 제목·집계 시각 → 기기·판매모델 → 요약 한 줄 → 빠른 필터 → 병원 표
 * 계산 규칙은 lib/usage/overview.ts, 값은 일별 집계(lib/usage/stats.ts)에서 온다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp } from 'lucide-react'
import PageHeader from '@/app/components/ui/PageHeader'
import Badge from '@/app/components/ui/Badge'
import { Card } from '@/app/components/ui/Card'
import type { UsageModel } from '@/lib/usage/metrics'
import type { OverviewDeviceKey, OverviewHold, OverviewRow, UsageOverview as Overview } from '@/lib/usage/overview'
import UsageCriteriaButton from './UsageCriteria'

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
/** 순위 필터가 보여 주는 병원 수 */
const RANK_N = 10
type Filter = 'all' | 'top' | 'bottom' | 'up' | 'down' | 'hold'
type SortKey = 'rate' | 'prevRate' | 'change'
type Sort = { key: SortKey; desc: boolean }

const HOLD_LABEL: Record<OverviewHold, string> = {
  pending: '집계 전',
  no_capacity: '계약·공급 수량 없음',
  behind: '기기 이력 수신 중',
  short: '유효한 날 부족',
}

const md = (date: string) => date.slice(5)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`)
const signedPp = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%p`
const stamp = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16) : '—')

export default function UsageOverview() {
  const router = useRouter()
  const params = useSearchParams()
  const deviceParam = params.get('device')
  const device: OverviewDeviceKey = DEVICES.some((d) => d.key === deviceParam) ? (deviceParam as OverviewDeviceKey) : 'ecg'
  const modelParam = params.get('model')
  const model: UsageModel = MODELS.some((m) => m.key === modelParam) ? (modelParam as UsageModel) : 'all'

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'rate', desc: true })

  const go = useCallback(
    (d: OverviewDeviceKey, m: UsageModel) => {
      const q = new URLSearchParams()
      if (d !== 'ecg') q.set('device', d)
      if (m !== 'all') q.set('model', m)
      const qs = q.toString()
      router.replace(qs ? `/usage?${qs}` : '/usage', { scroll: false })
    },
    [router],
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fetch(`/api/usage/overview?device=${device}&model=${model}`)
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
  }, [device, model])

  // 순위는 가동률 높은 순(서버가 그 순서로 준다) — 정렬·필터를 바꿔도 순위 숫자는 그대로다
  const ranked = useMemo(() => {
    const rows = data?.rows ?? []
    const rated = rows.filter((r) => r.rate !== null).length
    let n = 0
    return rows.map((r) => {
      const rank = r.rate === null ? null : ++n
      return { ...r, rank, top: rank !== null && rank <= RANK_N, bottom: rank !== null && rank > rated - RANK_N }
    })
  }, [data])
  const counts = useMemo(
    () => ({
      all: ranked.length,
      top: ranked.filter((r) => r.top).length,
      bottom: ranked.filter((r) => r.bottom).length,
      up: ranked.filter((r) => r.verdict === 'up').length,
      down: ranked.filter((r) => r.verdict === 'down').length,
      hold: ranked.filter((r) => r.verdict === 'hold').length,
    }),
    [ranked],
  )
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = ranked.filter((r) => {
      if (q && !r.hospitalName.toLowerCase().includes(q) && !r.hospitalCode.toLowerCase().includes(q)) return false
      if (filter === 'top') return r.top
      if (filter === 'bottom') return r.bottom
      if (filter === 'up' || filter === 'down' || filter === 'hold') return r.verdict === filter
      return true
    })
    // 값이 없는 병원은 정렬 방향과 무관하게 아래로
    const dir = sort.desc ? -1 : 1
    return [...list].sort((a, b) => {
      const x = a[sort.key]
      const y = b[sort.key]
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
      return (x - y) * dir
    })
  }, [ranked, filter, search, sort])

  const total = data?.total
  const deviceLabel = DEVICES.find((d) => d.key === device)!.label
  const open = (r: OverviewRow) => {
    const q = new URLSearchParams({ hospital: r.hospitalCode, days: '30' })
    if (model !== 'all') q.set('model', model)
    return `/usage?${q.toString()}`
  }
  const toggleSort = (key: SortKey) => setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: true }))

  const FILTERS: { key: Filter; label: string; title?: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'top', label: `상위 ${RANK_N}`, title: `가동률 높은 순 ${RANK_N}곳` },
    { key: 'bottom', label: `하위 ${RANK_N}`, title: `가동률 낮은 순 ${RANK_N}곳` },
    { key: 'up', label: '증가', title: data ? `이전 30일보다 ${data.thresholds.trendPp}%p 이상 오른 병원` : undefined },
    { key: 'down', label: '감소', title: data ? `이전 30일보다 ${data.thresholds.trendPp}%p 이상 내린 병원` : undefined },
    { key: 'hold', label: '판정 보류', title: '집계 전 · 수량 없음 · 기기 이력 수신 중 · 유효한 날 부족' },
  ]

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <PageHeader
        title="사용량"
        description="수집 중인 전체 병원의 가동률입니다. 병원을 누르면 그 병원의 일별 사용량으로 이동합니다."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <div className="flex h-9 items-center gap-2 text-[13px] text-muted-foreground" data-testid="overview-run">
              <span aria-hidden className={`h-2 w-2 rounded-full ${data?.run ? 'bg-success' : 'bg-gray-400'}`} />
              <span>{data ? (data.run ? `집계 ${stamp(data.run.finishedAt)} · 수집 병원 ${data.rows.length}곳` : `집계 전 · 수집 병원 ${data.rows.length}곳`) : loading ? '불러오는 중' : '—'}</span>
            </div>
            <UsageCriteriaButton />
          </div>
        }
      />

      <div className="flex flex-col gap-5">
        {/* 조건 */}
        <div className="flex flex-wrap items-end gap-3">
          <Segmented label="기기" id="overview-device" options={DEVICES} value={device} onChange={(v) => go(v, model)} />
          <Segmented label="판매모델" id="overview-model" options={MODELS} value={model} onChange={(v) => go(device, v)} />
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        {data?.run && data.run.failed.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            마지막 집계에서 병원 {data.run.failed.length}곳을 계산하지 못했습니다 — 그 병원의 값은 이전 집계 그대로입니다.
          </div>
        )}

        {/* 요약 한 줄 */}
        <Card className="flex flex-wrap" data-testid="overview-total">
          <div className="flex min-w-[320px] flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-1 px-5 py-3.5">
            <span className="text-[13px] text-muted-foreground">전체 {deviceLabel} 가동률</span>
            <span className={`text-xl font-bold tabular-nums ${total?.rate == null ? 'text-muted-foreground' : ''}`}>{pct(total?.rate)}</span>
            {total?.rate != null && (
              <span className="text-xs text-muted-foreground tabular-nums" title="병원별 (최근 30일 평균 최대 동시사용 수)의 합 / 병원별 계약·공급 수량의 합">
                {Math.round(total.peakSum ?? 0).toLocaleString()} / {Math.round(total.capacitySum ?? 0).toLocaleString()}대 · 병원 {total.rated}곳
              </span>
            )}
            {total?.change != null && <span className="text-xs text-muted-foreground tabular-nums">이전 30일 대비 {signedPp(total.change)}</span>}
          </div>
          <div className="flex min-w-[320px] flex-1 flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border px-5 py-3.5 text-[13px] md:border-l md:border-t-0">
            <Count label="증가" value={total?.up} tone="up" />
            <Count label="감소" value={total?.down} tone="down" />
            <Count label="유지" value={total?.flat} />
            <Count label="판정 보류" value={total?.hold} />
          </div>
        </Card>

        {/* 병원 표 */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-b border-border px-5 py-3.5">
            <div role="group" aria-label="빠른 필터" className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
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
                      {loading ? '불러오는 중...' : ranked.length === 0 ? '아직 수집 중인 병원이 없습니다. 병원 서버에 수집 Agent를 설치하면 여기에 나타납니다.' : '조건에 맞는 병원이 없습니다.'}
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

function Count({ label, value, tone }: { label: string; value: number | undefined; tone?: 'up' | 'down' }) {
  const color = !value ? 'text-muted-foreground' : tone === 'up' ? 'text-success' : tone === 'down' ? 'text-destructive' : 'text-foreground'
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-base font-bold tabular-nums ${color}`}>{value ?? '—'}</span>
      <span className="text-xs text-muted-foreground">곳</span>
    </span>
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
      <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, row.rate))}%` }} />
      </div>
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
