'use client'

/**
 * 사용량 화면 (클라이언트) — 디자인: Claude 디자인 캔버스 '사용량 화면 시안'
 * 위에서 아래로: 제목·수신 상태 → 병원·기간 → 요약 한 줄 → 일별 추이 → 기기별 가동률 → 일자별 표
 * 데이터가 없어도 같은 구조가 그대로 보인다(값은 —).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bar, CartesianGrid, Cell, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageHeader from '@/app/components/ui/PageHeader'
import Badge from '@/app/components/ui/Badge'
import { Card } from '@/app/components/ui/Card'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import type { UsageDaily, UsageDevice } from '@/lib/usage/metrics'

const PERIODS = [30, 90] as const
const DEVICE_SLOTS = [
  { key: 'ecg', label: '심전계' },
  { key: 'spo2', label: '산소포화도' },
  { key: 'cart', label: '카트온' },
] as const
const DOW = ['일', '월', '화', '수', '목', '금', '토']

/** 일별 추이에서 켜고 끌 수 있는 지표. 가동률은 동시 가동률(최대 동시사용 ÷ 등록 기기) 기준 */
const TREND_SERIES = [
  { key: 'measured', label: '측정 환자 수', unit: 'count' },
  { key: 'peak', label: '최대 동시측정 수', unit: 'count' },
  { key: 'ecgRate', label: '심전계 가동률', unit: 'rate', device: 'ecg' },
  { key: 'spo2Rate', label: '산소포화도 가동률', unit: 'rate', device: 'spo2' },
] as const
type TrendKey = (typeof TREND_SERIES)[number]['key']
const TREND_PREF_KEY = 'usage.trend.series'
const ALL_TREND_ON: Record<TrendKey, boolean> = { measured: true, peak: true, ecgRate: true, spo2Rate: true }

type Hospital = { hospitalCode: string; hospitalName: string; servers: number; lastSuccessAt: string | null }
type Daily = UsageDaily & { hospitalName: string }

const md = (date: string) => date.slice(5)
const dow = (date: string) => DOW[new Date(`${date}T00:00:00Z`).getUTCDay()]
const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString())
const fixed1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(1))
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Math.round(v)))

function receivedAt(iso: string | null): string {
  if (!iso) return '수신 기록 없음'
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16)
}

export default function UsageClient() {
  const router = useRouter()
  const params = useSearchParams()
  const chart = useChartTheme()
  const lineColor = chart.dark ? '#FB923C' : '#C2410C' // 흰 바탕에서도 구분되는 진한 주황
  const trendColor: Record<TrendKey, string> = {
    measured: chart.blue,
    peak: lineColor,
    ecgRate: chart.dark ? '#34D399' : '#047857',
    spo2Rate: chart.dark ? '#C4B5FD' : '#6D28D9',
  }
  const axis = { tick: { fontSize: 11, fill: chart.tick }, axisLine: false as const, tickLine: false as const }

  const hospital = params.get('hospital') ?? ''
  const daysParam = Number(params.get('days'))
  const days = (PERIODS as readonly number[]).includes(daysParam) ? daysParam : PERIODS[0]

  const [hospitals, setHospitals] = useState<Hospital[] | null>(null)
  const [data, setData] = useState<Daily | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trendOn, setTrendOn] = useState<Record<TrendKey, boolean>>(ALL_TREND_ON)

  // 켜 둔 지표는 이 브라우저에 기억한다 (없거나 읽을 수 없으면 전부 켠 상태)
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(TREND_PREF_KEY) ?? 'null')
      if (saved && typeof saved === 'object') {
        setTrendOn((prev) => {
          const next = { ...prev }
          for (const s of TREND_SERIES) if (typeof saved[s.key] === 'boolean') next[s.key] = saved[s.key]
          return next
        })
      }
    } catch {
      // 저장소를 쓸 수 없는 환경 — 기본값으로 둔다
    }
  }, [])
  const toggleTrend = useCallback((key: TrendKey) => {
    setTrendOn((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        window.localStorage.setItem(TREND_PREF_KEY, JSON.stringify(next))
      } catch {
        // 기억하지 못해도 화면은 그대로 동작한다
      }
      return next
    })
  }, [])

  const go = useCallback(
    (code: string, d: number) => {
      const q = new URLSearchParams()
      if (code) q.set('hospital', code)
      q.set('days', String(d))
      router.replace(`/usage?${q.toString()}`, { scroll: false })
    },
    [router],
  )

  useEffect(() => {
    let alive = true
    fetch('/api/usage/hospitals')
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) setError(body.error ?? '병원 목록을 불러오지 못했습니다.')
        setHospitals(res.ok ? (body.hospitals as Hospital[]) : [])
      })
      .catch(() => {
        if (alive) {
          setError('병원 목록을 불러오지 못했습니다.')
          setHospitals([])
        }
      })
    return () => {
      alive = false
    }
  }, [])

  // 병원을 고르지 않고 들어오면 목록의 첫 병원을 연다
  useEffect(() => {
    if (!hospital && hospitals && hospitals.length > 0) go(hospitals[0].hospitalCode, days)
  }, [hospital, hospitals, days, go])

  useEffect(() => {
    if (!hospital) {
      setData(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    fetch(`/api/usage/daily?hospital=${encodeURIComponent(hospital)}&days=${days}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) {
          setError(body.error ?? '사용량을 불러오지 못했습니다.')
          setData(null)
        } else {
          setData(body as Daily)
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
  }, [hospital, days])

  const collecting = !!data && data.receive.servers > 0
  const inList = !!hospitals?.some((h) => h.hospitalCode === hospital)

  const deviceByKey = useMemo(() => {
    const m = new Map<string, UsageDevice>()
    if (collecting) for (const dv of data!.devices) m.set(dv.key, dv)
    return m
  }, [collecting, data])
  const trend = useMemo(() => {
    if (!collecting) return []
    // 동시 가동률(%) = 그날 최대 동시사용 수 ÷ 등록 기기 수. 등록 기기가 없거나 수치가 없는 날은 비운다
    const rate = (key: string, i: number) => {
      const dv = deviceByKey.get(key)
      const peak = dv?.days[i]?.peak
      return !dv || dv.registered === 0 || peak === null || peak === undefined ? null : (peak / dv.registered) * 100
    }
    return data!.days.map((d, i) => ({
      label: md(d.date),
      measured: d.measured,
      peak: d.peak,
      ecgRate: rate('ecg', i),
      spo2Rate: rate('spo2', i),
      today: d.today,
    }))
  }, [collecting, data, deviceByKey])
  // 등록 기기가 없는 종류의 가동률은 낼 수 없다
  const trendAvailable = (s: (typeof TREND_SERIES)[number]) =>
    !('device' in s) || !collecting || (deviceByKey.get(s.device)?.registered ?? 0) > 0
  const showCount = trendOn.measured || trendOn.peak
  const showRate = (trendOn.ecgRate && trendAvailable(TREND_SERIES[2])) || (trendOn.spo2Rate && trendAvailable(TREND_SERIES[3]))
  const rateTop = useMemo(() => {
    let max = 100
    for (const r of trend) for (const v of [r.ecgRate, r.spo2Rate]) if (v !== null && v > max) max = v
    return Math.ceil(max / 50) * 50
  }, [trend])
  const tableRows = useMemo(() => (collecting ? [...data!.days].reverse() : []), [collecting, data])

  const statusText = !hospital
    ? '수신된 데이터 없음'
    : collecting
      ? `마지막 수신 ${receivedAt(data!.receive.lastSuccessAt)} · 서버 ${data!.receive.servers}대`
      : loading
        ? '불러오는 중'
        : '수신된 데이터 없음'

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <PageHeader
        title="사용량"
        description="병원 서버에서 수집한 측정 기록으로 계산합니다. 환자 수는 측정 건수 기준입니다."
        actions={
          <div className="flex h-9 items-center gap-2 text-[13px] text-muted-foreground">
            <span aria-hidden className={`h-2 w-2 rounded-full ${collecting ? 'bg-success' : 'bg-gray-400'}`} />
            <span>{statusText}</span>
          </div>
        }
      />

      <div className="flex flex-col gap-5">
        {/* 조건 */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="usage-hospital" className="text-xs font-medium text-muted-foreground">
              병원
            </label>
            <select
              id="usage-hospital"
              value={hospital}
              onChange={(e) => go(e.target.value, days)}
              disabled={!hospitals || hospitals.length === 0}
              className="h-9 min-w-[260px] rounded-md border border-border bg-card px-3 text-sm text-foreground disabled:text-muted-foreground"
            >
              {(!hospitals || hospitals.length === 0) && <option value="">{hospitals ? '수집 중인 병원 없음' : '불러오는 중...'}</option>}
              {hospital && hospitals && hospitals.length > 0 && !inList && <option value={hospital}>{hospital} (수집 전)</option>}
              {hospitals?.map((h) => (
                <option key={h.hospitalCode} value={h.hospitalCode}>
                  {h.hospitalName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <div id="usage-period-label" className="text-xs font-medium text-muted-foreground">
              기간
            </div>
            <div role="group" aria-labelledby="usage-period-label" className="flex h-9 gap-1 rounded-md border border-border bg-card p-[3px]">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={p === days}
                  onClick={() => go(hospital, p)}
                  className={`h-7 rounded px-3.5 text-[13px] font-medium transition-colors ${
                    p === days ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  최근 {p}일
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

        {/* 요약 한 줄 */}
        <Card className="flex flex-wrap">
          <SummaryCell label="기간 평균 측정 환자 수" value={collecting ? fixed1(data!.summary.avgMeasured) : '—'} hint="오늘 제외" />
          <SummaryCell
            label="최대 동시측정 최고"
            value={collecting ? num(data!.summary.maxPeak) : '—'}
            hint={collecting && data!.summary.maxPeakDate ? md(data!.summary.maxPeakDate) : undefined}
            divided
          />
          <SummaryCell
            label="오늘 측정 환자 수"
            value={collecting ? num(data!.summary.todayMeasured) : '—'}
            badge={collecting ? '진행 중' : undefined}
            divided
          />
        </Card>

        {/* 일별 추이 */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">일별 추이</h2>
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <legend className="sr-only">표시할 지표</legend>
              {TREND_SERIES.map((s) => {
                const available = trendAvailable(s)
                return (
                  <label
                    key={s.key}
                    className={`flex h-7 items-center gap-1.5 text-xs ${available ? 'cursor-pointer text-foreground' : 'text-muted-foreground'}`}
                    title={available ? undefined : '등록된 기기가 없어 가동률을 낼 수 없습니다'}
                  >
                    <input
                      type="checkbox"
                      checked={trendOn[s.key] && available}
                      disabled={!available}
                      onChange={() => toggleTrend(s.key)}
                      className="h-3.5 w-3.5"
                      style={{ accentColor: trendColor[s.key] }}
                    />
                    <span
                      aria-hidden
                      className={s.key === 'measured' ? 'h-2.5 w-2.5 rounded-sm' : 'h-0 w-4 border-t-[3px]'}
                      style={
                        s.key === 'measured'
                          ? { background: trendColor[s.key] }
                          : { borderColor: trendColor[s.key], borderTopStyle: s.unit === 'rate' ? 'dashed' : 'solid' }
                      }
                    />
                    {s.label}
                  </label>
                )
              })}
            </fieldset>
          </div>
          <div className="px-3 pb-3 pt-5 sm:px-5">
            {collecting ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={trend} margin={{ top: 4, right: showRate ? -8 : 8, left: showCount ? -18 : 8, bottom: 0 }}>
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="label" {...axis} minTickGap={24} />
                    <YAxis yAxisId="count" allowDecimals={false} {...axis} hide={!showCount} />
                    <YAxis
                      yAxisId="rate"
                      orientation="right"
                      {...axis}
                      hide={!showRate}
                      domain={[0, rateTop]}
                      ticks={[0, rateTop / 2, rateTop]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={chart.tooltip}
                      cursor={{ fill: chart.grid, opacity: 0.5 }}
                      formatter={(v, name) => (String(name).includes('가동률') ? `${Math.round(Number(v))}%` : Number(v).toLocaleString())}
                    />
                    {trendOn.measured && (
                      <Bar yAxisId="count" dataKey="measured" name="측정 환자 수" fill={trendColor.measured} maxBarSize={22} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {trend.map((r) => (
                          <Cell key={r.label} fillOpacity={r.today ? 0.45 : 1} />
                        ))}
                      </Bar>
                    )}
                    {trendOn.peak && (
                      <Line yAxisId="count" type="linear" dataKey="peak" name="최대 동시측정 수" stroke={trendColor.peak} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    )}
                    {trendOn.ecgRate && trendAvailable(TREND_SERIES[2]) && (
                      <Line yAxisId="rate" type="linear" dataKey="ecgRate" name="심전계 가동률" stroke={trendColor.ecgRate} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} isAnimationActive={false} />
                    )}
                    {trendOn.spo2Rate && trendAvailable(TREND_SERIES[3]) && (
                      <Line yAxisId="rate" type="linear" dataKey="spo2Rate" name="산소포화도 가동률" stroke={trendColor.spo2Rate} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} isAnimationActive={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="px-2 pt-1 text-[11px] text-muted-foreground">
                  왼쪽 축 = 건수(측정 환자 수·최대 동시측정 수), 오른쪽 축 = 가동률(%, 그날 최대 동시사용 수 ÷ 등록 기기 수)
                </p>
              </>
            ) : (
              <EmptyPlot height={280} loading={loading} />
            )}
          </div>
        </Card>

        {/* 기기별 가동률 */}
        <section aria-labelledby="usage-device-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="usage-device-title" className="text-[15px] font-semibold">
                기기별 가동률
              </h2>
              <p className="text-xs text-muted-foreground">
                동시 가동률 = 최대 동시사용 수 ÷ 등록 기기 수 · 일 사용률 = 일 사용 횟수 ÷ 등록 기기 수
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-[3px] w-3.5 rounded-sm" style={{ background: chart.blue }} />
                동시 가동률
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-[3px] w-3.5 rounded-sm" style={{ background: lineColor }} />
                일 사용률
              </span>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {DEVICE_SLOTS.map((slot) => (
              <DevicePanel
                key={slot.key}
                label={slot.label}
                device={deviceByKey.get(slot.key) ?? null}
                blue={chart.blue}
                orange={lineColor}
                grid={chart.grid}
                tooltip={chart.tooltip}
                axis={axis}
              />
            ))}
          </div>
          {collecting && data!.deviceDataFrom && data!.deviceDataFrom > data!.range.from && (
            <p className="text-xs text-muted-foreground">
              기기별 수치는 {data!.deviceDataFrom}부터 표시됩니다. 그 전의 측정은 병원 서버의 보관 기한이 지나 기기 정보가 남아 있지 않습니다.
            </p>
          )}
        </section>

        {/* 일자별 표 */}
        <Card>
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold">일자별</h2>
          </div>
          <div className="max-h-[452px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th scope="col" rowSpan={2} className="whitespace-nowrap px-5 py-2.5 text-left align-bottom text-xs font-medium text-muted-foreground">
                    일자
                  </th>
                  <th scope="col" rowSpan={2} className="whitespace-nowrap px-3.5 py-2.5 text-right align-bottom text-xs font-medium text-muted-foreground">
                    측정 환자 수
                  </th>
                  <th scope="col" rowSpan={2} className="whitespace-nowrap px-3.5 py-2.5 text-right align-bottom text-xs font-medium text-muted-foreground">
                    최대 동시측정 수
                  </th>
                  {DEVICE_SLOTS.map((slot) => (
                    <th key={slot.key} scope="colgroup" colSpan={2} className="whitespace-nowrap border-l border-border px-3.5 pt-2 text-center text-xs font-semibold text-foreground">
                      {slot.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {DEVICE_SLOTS.map((slot) => (
                    <DeviceSubHeader key={slot.key} />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tableRows.length === 0 && (
                  <tr>
                    <td className="px-5 py-2.5 text-muted-foreground">—</td>
                    {Array.from({ length: 8 }, (_, i) => (
                      <td key={i} className={`px-3.5 py-2.5 text-right text-muted-foreground ${i >= 2 && i % 2 === 0 ? 'border-l border-border' : ''}`}>
                        —
                      </td>
                    ))}
                  </tr>
                )}
                {tableRows.map((r, idx) => {
                  const i = data!.days.length - 1 - idx
                  return (
                    <tr key={r.date} className="transition-colors hover:bg-accent/50">
                      <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">
                        {r.date} <span className="text-muted-foreground">({dow(r.date)})</span>
                        {r.today && (
                          <Badge variant="warning" className="ml-2">
                            진행 중
                          </Badge>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-right tabular-nums">{num(r.measured)}</td>
                      <td className="px-3.5 py-2.5 text-right tabular-nums">{num(r.peak)}</td>
                      {DEVICE_SLOTS.map((slot) => {
                        const d = deviceByKey.get(slot.key)?.days[i]
                        const muted = !d || d.uses === null ? 'text-muted-foreground' : ''
                        return (
                          <DeviceCells key={slot.key} uses={d?.uses ?? null} peak={d?.peak ?? null} className={muted} />
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

function SummaryCell({ label, value, hint, badge, divided }: { label: string; value: string; hint?: string; badge?: string; divided?: boolean }) {
  return (
    <div className={`flex min-w-[240px] flex-1 items-baseline gap-2.5 px-5 py-3.5 ${divided ? 'border-t border-border md:border-l md:border-t-0' : ''}`}>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${value === '—' ? 'text-muted-foreground' : ''}`}>{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      {badge && <Badge variant="warning">{badge}</Badge>}
    </div>
  )
}

function EmptyPlot({ height, loading }: { height: number; loading: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 border-b border-border px-4 text-center" style={{ height }}>
      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : (
        <>
          <p className="text-sm font-semibold">아직 수신된 데이터가 없습니다</p>
          <p className="text-[13px] text-muted-foreground">병원 서버에 수집 Agent를 설치하면 첫 실행 뒤부터 표시됩니다.</p>
        </>
      )}
    </div>
  )
}

function DeviceSubHeader() {
  return (
    <>
      <th scope="col" className="whitespace-nowrap border-l border-border px-3.5 py-2 text-right text-xs font-medium text-muted-foreground">
        사용 횟수
      </th>
      <th scope="col" className="whitespace-nowrap px-3.5 py-2 text-right text-xs font-medium text-muted-foreground">
        최대 동시
      </th>
    </>
  )
}

function DeviceCells({ uses, peak, className }: { uses: number | null; peak: number | null; className: string }) {
  return (
    <>
      <td className={`border-l border-border px-3.5 py-2.5 text-right tabular-nums ${className}`}>{num(uses)}</td>
      <td className={`px-3.5 py-2.5 text-right tabular-nums ${className}`}>{num(peak)}</td>
    </>
  )
}

type AxisProps = { tick: { fontSize: number; fill: string }; axisLine: false; tickLine: false }

function DevicePanel({
  label,
  device,
  blue,
  orange,
  grid,
  tooltip,
  axis,
}: {
  label: string
  device: UsageDevice | null
  blue: string
  orange: string
  grid: string
  tooltip: CSSProperties
  axis: AxisProps
}) {
  const registered = device?.registered ?? 0
  const rows = useMemo(() => {
    if (!device || registered === 0) return []
    return device.days.map((d) => ({
      label: md(d.date),
      peakRate: d.peak === null ? null : (d.peak / registered) * 100,
      useRate: d.uses === null ? null : (d.uses / registered) * 100,
    }))
  }, [device, registered])
  const top = useMemo(() => {
    let max = 100
    for (const r of rows) {
      if (r.useRate !== null && r.useRate > max) max = r.useRate
      if (r.peakRate !== null && r.peakRate > max) max = r.peakRate
    }
    return Math.ceil(max / 50) * 50
  }, [rows])

  return (
    <Card className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3.5">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground">등록 {device ? `${registered}대` : '—'}</span>
      </div>
      {device && registered === 0 ? (
        <div className="flex h-[244px] flex-col items-center justify-center gap-1.5 px-5 text-center">
          <p className="text-sm font-semibold">등록된 기기가 없습니다</p>
          <p className="text-[13px] text-muted-foreground">병원 서버에 이 종류의 기기가 등록되면 표시됩니다.</p>
        </div>
      ) : (
        <>
          <div className="flex border-b border-border">
            <div className="flex flex-1 flex-col gap-0.5 px-5 py-3">
              <span className="text-xs text-muted-foreground">동시 가동률 평균</span>
              <RateValue value={device ? device.avgPeakRate : null} />
            </div>
            <div className="flex flex-1 flex-col gap-0.5 border-l border-border px-5 py-3">
              <span className="text-xs text-muted-foreground">일 사용률 평균</span>
              <RateValue value={device ? device.avgUseRate : null} />
            </div>
          </div>
          <div className="px-2 pb-2 pt-4">
            {device ? (
              <ResponsiveContainer width="100%" height={164}>
                <LineChart data={rows} margin={{ top: 4, right: 10, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={grid} vertical={false} />
                  <XAxis dataKey="label" {...axis} minTickGap={32} />
                  <YAxis {...axis} domain={[0, top]} ticks={[0, top / 2, top]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={tooltip} formatter={(v) => `${Math.round(Number(v))}%`} />
                  <Line type="linear" dataKey="peakRate" name="동시 가동률" stroke={blue} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line type="linear" dataKey="useRate" name="일 사용률" stroke={orange} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 164 }} />
            )}
          </div>
        </>
      )}
    </Card>
  )
}

function RateValue({ value }: { value: number | null }) {
  return (
    <span className={`text-xl font-bold tabular-nums ${value === null ? 'text-muted-foreground' : ''}`}>
      {pct(value)}
      {value !== null && <span className="text-[13px] font-medium text-muted-foreground">%</span>}
    </span>
  )
}
