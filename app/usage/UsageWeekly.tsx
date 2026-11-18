'use client'

/**
 * 사용량 화면 — 주간 통계 (일별 화면 아래)
 * 최근 12주(월~일). 주간 신규 측정 수(그 주에 시작한 측정)·전주 대비, 최대 동시측정 수 평균·최고, 기기 종류별 동시 가동률 평균·최고.
 * 이번 주는 진행 중 — 막대를 흐리게, 전주 대비는 내지 않는다. 정의는 lib/usage/metrics.ts aggregateWeeks.
 */
import { useEffect, useState } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Badge from '@/app/components/ui/Badge'
import { Card } from '@/app/components/ui/Card'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import type { UsageModel, UsageWeekly as Weekly } from '@/lib/usage/metrics'

const md = (date: string) => date.slice(5)
const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString())
const fixed1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(1))
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`)
const change = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}%`)

export default function UsageWeekly({ hospital, model }: { hospital: string; model: UsageModel }) {
  const chart = useChartTheme()
  const orange = chart.dark ? '#FB923C' : '#C2410C'
  const deviceColor: Record<string, string> = {
    ecg: chart.dark ? '#34D399' : '#047857',
    spo2: chart.dark ? '#C4B5FD' : '#6D28D9',
    cart: chart.dark ? '#F472B6' : '#BE185D',
  }
  const axis = { tick: { fontSize: 11, fill: chart.tick }, axisLine: false as const, tickLine: false as const }

  const [data, setData] = useState<Weekly | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hospital) {
      setData(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    fetch(`/api/usage/weekly?hospital=${encodeURIComponent(hospital)}&model=${model}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) {
          setError(body.error ?? '주간 통계를 불러오지 못했습니다.')
          setData(null)
        } else {
          setData(body as Weekly)
        }
      })
      .catch(() => {
        if (alive) setError('주간 통계를 불러오지 못했습니다.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [hospital, model])

  const collecting = !!data && data.receive.servers > 0
  // 계약·공급 수량이 있는 기기만 가동률을 보여 준다
  const devices = collecting ? data!.capacities.filter((c) => c.capacity !== null) : []
  const weeks = collecting ? data!.weeks : []
  const rows = weeks.map((w) => {
    const r: Record<string, string | number | boolean | null> = { label: md(w.weekStart), started: w.started, peakAvg: w.peakAvg, current: w.current }
    for (const d of w.devices) r[`${d.key}Rate`] = d.peakRateAvg
    return r
  })
  let rateMax = 100
  for (const w of weeks) for (const d of w.devices) if (d.peakRateAvg !== null && d.peakRateAvg > rateMax) rateMax = d.peakRateAvg
  const rateTop = Math.ceil(rateMax / 50) * 50
  const tableRows = [...weeks].reverse()

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">주간 통계</h2>
          <p className="text-xs text-muted-foreground">최근 12주 · 월~일 · 이번 주는 진행 중</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: chart.blue }} />
            주간 신규 측정 수
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0 w-4 border-t-[3px]" style={{ borderColor: orange }} />
            최대 동시측정 평균
          </span>
          {devices.map((d) => (
            <span key={d.key} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0 w-4 border-t-[3px] border-dashed" style={{ borderColor: deviceColor[d.key] }} />
              {d.label} 동시 가동률 평균
            </span>
          ))}
        </div>
      </div>

      {error && <div className="mx-5 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <div className="px-3 pb-3 pt-5 sm:px-5">
        {collecting ? (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={rows} margin={{ top: 4, right: devices.length > 0 ? -8 : 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" {...axis} />
                <YAxis yAxisId="count" allowDecimals={false} {...axis} />
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  {...axis}
                  hide={devices.length === 0}
                  domain={[0, rateTop]}
                  ticks={[0, rateTop / 2, rateTop]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={chart.tooltip}
                  cursor={{ fill: chart.grid, opacity: 0.5 }}
                  labelFormatter={(l) => `${l} 주`}
                  formatter={(v, name) =>
                    String(name).includes('가동률') ? `${Math.round(Number(v))}%` : String(name).includes('평균') ? Number(v).toFixed(1) : Number(v).toLocaleString()
                  }
                />
                <Bar yAxisId="count" dataKey="started" name="주간 신규 측정 수" fill={chart.blue} maxBarSize={28} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={String(r.label)} fillOpacity={r.current ? 0.45 : 1} />
                  ))}
                </Bar>
                <Line yAxisId="count" type="linear" dataKey="peakAvg" name="최대 동시측정 평균" stroke={orange} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                {devices.map((d) => (
                  <Line
                    key={d.key}
                    yAxisId="rate"
                    type="linear"
                    dataKey={`${d.key}Rate`}
                    name={`${d.label} 동시 가동률 평균`}
                    stroke={deviceColor[d.key]}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
            <p className="px-2 pt-1 text-[11px] text-muted-foreground">
              주간 신규 측정 수 = 그 주(월~일)에 시작한 측정 수(전주에 시작해 이어진 측정은 세지 않음) · 평균 = 그 주 일별 값의 평균(오늘 제외) · 최고 = 그 주 일별 최고 · 막대 아래 날짜 = 그 주 월요일
            </p>
          </>
        ) : (
          <div className="flex h-[240px] items-center justify-center border-b border-border text-sm text-muted-foreground">
            {loading ? '불러오는 중...' : '수신된 데이터가 없습니다'}
          </div>
        )}
      </div>

      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" rowSpan={2} className="whitespace-nowrap px-5 py-2.5 text-left align-bottom text-xs font-medium text-muted-foreground">
                주 (월~일)
              </th>
              <th scope="col" rowSpan={2} className="whitespace-nowrap px-3.5 py-2.5 text-right align-bottom text-xs font-medium text-muted-foreground">
                신규 측정 수
              </th>
              <th scope="col" rowSpan={2} className="whitespace-nowrap px-3.5 py-2.5 text-right align-bottom text-xs font-medium text-muted-foreground">
                전주 대비
              </th>
              <th scope="colgroup" colSpan={2} className="whitespace-nowrap border-l border-border px-3.5 pt-2 text-center text-xs font-semibold text-foreground">
                최대 동시측정 수
              </th>
              {devices.map((d) => (
                <th key={d.key} scope="colgroup" colSpan={2} className="whitespace-nowrap border-l border-border px-3.5 pt-2 text-center text-xs font-semibold text-foreground">
                  {d.label} 동시 가동률
                </th>
              ))}
            </tr>
            <tr>
              {[null, ...devices].map((d, i) => (
                <SubHeader key={d?.key ?? `peak-${i}`} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tableRows.length === 0 && (
              <tr>
                <td colSpan={5 + devices.length * 2} className="px-5 py-2.5 text-muted-foreground">
                  —
                </td>
              </tr>
            )}
            {tableRows.map((w) => (
              <tr key={w.weekStart} className="transition-colors hover:bg-accent/50">
                <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">
                  {md(w.weekStart)} ~ {md(w.weekEnd)}
                  {w.current && (
                    <Badge variant="warning" className="ml-2">
                      진행 중
                    </Badge>
                  )}
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums">{num(w.started)}</td>
                <td
                  className={`px-3.5 py-2.5 text-right tabular-nums ${
                    w.startedChange === null ? 'text-muted-foreground' : w.startedChange > 0 ? 'text-success' : w.startedChange < 0 ? 'text-destructive' : ''
                  }`}
                >
                  {change(w.startedChange)}
                </td>
                <td className="border-l border-border px-3.5 py-2.5 text-right tabular-nums">{fixed1(w.peakAvg)}</td>
                <td className="px-3.5 py-2.5 text-right tabular-nums">{num(w.peakMax)}</td>
                {devices.map((d) => {
                  const x = w.devices.find((y) => y.key === d.key)
                  const muted = x?.peakRateAvg == null && x?.peakRateMax == null ? 'text-muted-foreground' : ''
                  return (
                    <RateCells key={d.key} avg={x?.peakRateAvg ?? null} max={x?.peakRateMax ?? null} className={muted} />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function SubHeader() {
  return (
    <>
      <th scope="col" className="whitespace-nowrap border-l border-border px-3.5 py-2 text-right text-xs font-medium text-muted-foreground">
        평균
      </th>
      <th scope="col" className="whitespace-nowrap px-3.5 py-2 text-right text-xs font-medium text-muted-foreground">
        최고
      </th>
    </>
  )
}

function RateCells({ avg, max, className }: { avg: number | null; max: number | null; className: string }) {
  return (
    <>
      <td className={`border-l border-border px-3.5 py-2.5 text-right tabular-nums ${className}`}>{pct(avg)}</td>
      <td className={`px-3.5 py-2.5 text-right tabular-nums ${className}`}>{pct(max)}</td>
    </>
  )
}
