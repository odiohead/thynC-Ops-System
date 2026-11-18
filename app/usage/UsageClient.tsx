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
import type { UsageDaily, UsageDevice, UsageModel } from '@/lib/usage/metrics'
import UsageCriteriaButton from './UsageCriteria'
import UsageWeekly from './UsageWeekly'

const PERIODS = [30, 90] as const
/** 판매모델 보기 — 딜의 '판매모델 구분' 기준 (서버 lib/usage/metrics.ts USAGE_MODELS 와 같은 키) */
const MODELS: { key: UsageModel; label: string }[] = [
  { key: 'all', label: '합산' },
  { key: 'general', label: '일반형' },
  { key: 'usage', label: '사용량비례형' },
]
const DEVICE_SLOTS = [
  { key: 'ecg', label: '심전계' },
  { key: 'spo2', label: '산소포화도' },
  { key: 'cart', label: '카트온' },
] as const
const DOW = ['일', '월', '화', '수', '목', '금', '토']

/**
 * 일별 추이 필터 — 지표와 기기를 각각 켜고 끈다.
 * 건수 지표(측정 환자 수·최대 동시측정 수)는 병원 전체, 비율 지표(동시 가동률·일 사용률)는 켠 기기마다 한 줄씩 그린다.
 */
const TREND_METRICS = [
  { key: 'measured', label: '측정 환자 수', unit: 'count' },
  { key: 'peak', label: '최대 동시측정 수', unit: 'count' },
  { key: 'peakRate', label: '동시 가동률', unit: 'rate', dash: '6 3' },
  { key: 'useRate', label: '일 사용률', unit: 'rate', dash: '2 3' },
] as const
type TrendMetric = (typeof TREND_METRICS)[number]['key']
type RateMetric = Extract<TrendMetric, 'peakRate' | 'useRate'>
type DeviceKey = (typeof DEVICE_SLOTS)[number]['key']
const RATE_METRICS = TREND_METRICS.filter((m): m is Extract<(typeof TREND_METRICS)[number], { unit: 'rate' }> => m.unit === 'rate')
const TREND_PREF_KEY = 'usage.trend.filter'
type TrendFilter = { metrics: Record<TrendMetric, boolean>; devices: Record<DeviceKey, boolean> }
const DEFAULT_TREND: TrendFilter = {
  metrics: { measured: true, peak: true, peakRate: true, useRate: false },
  devices: { ecg: true, spo2: true, cart: true },
}
const rateKey = (device: DeviceKey, metric: RateMetric) => `${device}_${metric}`
/** 일별 추이 한 줄 — 기기별 비율은 `${기기}_${지표}` 키 (수치가 없는 날은 null) */
type TrendRow = { label: string; measured: number; peak: number; today: boolean; [rate: string]: string | number | boolean | null }

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
  const countColor: Record<'measured' | 'peak', string> = { measured: chart.blue, peak: lineColor }
  const deviceColor: Record<DeviceKey, string> = {
    ecg: chart.dark ? '#34D399' : '#047857',
    spo2: chart.dark ? '#C4B5FD' : '#6D28D9',
    cart: chart.dark ? '#F472B6' : '#BE185D',
  }
  const axis = { tick: { fontSize: 11, fill: chart.tick }, axisLine: false as const, tickLine: false as const }

  const hospital = params.get('hospital') ?? ''
  const daysParam = Number(params.get('days'))
  const days = (PERIODS as readonly number[]).includes(daysParam) ? daysParam : PERIODS[0]
  const modelParam = params.get('model')
  const model: UsageModel = MODELS.some((m) => m.key === modelParam) ? (modelParam as UsageModel) : 'all'

  const [hospitals, setHospitals] = useState<Hospital[] | null>(null)
  const [data, setData] = useState<Daily | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trendFilter, setTrendFilter] = useState<TrendFilter>(DEFAULT_TREND)

  // 켜 둔 지표·기기는 이 브라우저에 기억한다 (없거나 읽을 수 없으면 기본값)
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(TREND_PREF_KEY) ?? 'null')
      if (saved && typeof saved === 'object') {
        setTrendFilter((prev) => {
          const next: TrendFilter = { metrics: { ...prev.metrics }, devices: { ...prev.devices } }
          for (const m of TREND_METRICS) if (typeof saved.metrics?.[m.key] === 'boolean') next.metrics[m.key] = saved.metrics[m.key]
          for (const d of DEVICE_SLOTS) if (typeof saved.devices?.[d.key] === 'boolean') next.devices[d.key] = saved.devices[d.key]
          return next
        })
      }
    } catch {
      // 저장소를 쓸 수 없는 환경 — 기본값으로 둔다
    }
  }, [])
  const toggleTrend = useCallback((group: 'metrics' | 'devices', key: string) => {
    setTrendFilter((prev) => {
      const next: TrendFilter =
        group === 'metrics'
          ? { ...prev, metrics: { ...prev.metrics, [key]: !prev.metrics[key as TrendMetric] } }
          : { ...prev, devices: { ...prev.devices, [key]: !prev.devices[key as DeviceKey] } }
      try {
        window.localStorage.setItem(TREND_PREF_KEY, JSON.stringify(next))
      } catch {
        // 기억하지 못해도 화면은 그대로 동작한다
      }
      return next
    })
  }, [])

  const go = useCallback(
    (code: string, d: number, m: UsageModel = 'all') => {
      const q = new URLSearchParams()
      if (code) q.set('hospital', code)
      q.set('days', String(d))
      if (m !== 'all') q.set('model', m)
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
    if (!hospital && hospitals && hospitals.length > 0) go(hospitals[0].hospitalCode, days, model)
  }, [hospital, hospitals, days, model, go])

  useEffect(() => {
    if (!hospital) {
      setData(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    fetch(`/api/usage/daily?hospital=${encodeURIComponent(hospital)}&days=${days}&model=${model}`)
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
  }, [hospital, days, model])

  const collecting = !!data && data.receive.servers > 0
  const inList = !!hospitals?.some((h) => h.hospitalCode === hospital)

  const deviceByKey = useMemo(() => {
    const m = new Map<string, UsageDevice>()
    if (collecting) for (const dv of data!.devices) m.set(dv.key, dv)
    return m
  }, [collecting, data])
  const trend = useMemo(() => {
    if (!collecting) return []
    // 동시 가동률(%) = 그날 최대 동시사용 수 ÷ 계약·공급 수량, 일 사용률(%) = 그날 사용 횟수 ÷ 계약·공급 수량. 수량이나 수치가 없는 날은 비운다
    return data!.days.map((d, i) => {
      const row: TrendRow = { label: md(d.date), measured: d.measured, peak: d.peak, today: d.today }
      for (const slot of DEVICE_SLOTS) {
        const day = deviceByKey.get(slot.key)?.days[i]
        row[rateKey(slot.key, 'peakRate')] = !day || !day.capacity || day.peak === null ? null : (day.peak / day.capacity) * 100
        row[rateKey(slot.key, 'useRate')] = !day || !day.capacity || day.uses === null ? null : (day.uses / day.capacity) * 100
      }
      return row
    })
  }, [collecting, data, deviceByKey])
  // 계약·공급 수량이 없는 기기의 비율은 낼 수 없다
  const deviceAvailable = (key: DeviceKey) => !collecting || !!deviceByKey.get(key)?.days.some((d) => !!d.capacity)
  const anyDeviceAvailable = DEVICE_SLOTS.some((d) => deviceAvailable(d.key))
  const rateLines = RATE_METRICS.filter((m) => trendFilter.metrics[m.key]).flatMap((m) =>
    DEVICE_SLOTS.filter((d) => trendFilter.devices[d.key] && deviceAvailable(d.key)).map((d) => ({
      key: rateKey(d.key, m.key),
      name: `${d.label} ${m.label}`,
      color: deviceColor[d.key],
      dash: m.dash,
    })),
  )
  const showCount = trendFilter.metrics.measured || trendFilter.metrics.peak
  const showRate = rateLines.length > 0
  let rateMax = 100
  for (const r of trend)
    for (const l of rateLines) {
      const v = r[l.key]
      if (typeof v === 'number' && v > rateMax) rateMax = v
    }
  const rateTop = Math.ceil(rateMax / 50) * 50
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
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <div className="flex h-9 items-center gap-2 text-[13px] text-muted-foreground">
              <span aria-hidden className={`h-2 w-2 rounded-full ${collecting ? 'bg-success' : 'bg-gray-400'}`} />
              <span>{statusText}</span>
            </div>
            <UsageCriteriaButton />
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
                  onClick={() => go(hospital, p, model)}
                  className={`h-7 rounded px-3.5 text-[13px] font-medium transition-colors ${
                    p === days ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  최근 {p}일
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div id="usage-model-label" className="text-xs font-medium text-muted-foreground">
              판매모델
            </div>
            <div role="group" aria-labelledby="usage-model-label" className="flex h-9 gap-1 rounded-md border border-border bg-card p-[3px]">
              {MODELS.map((m) => {
                const available = !data || data.models.find((x) => x.key === m.key)?.available !== false
                return (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={m.key === model}
                    disabled={!available && m.key !== model}
                    title={available ? undefined : '이 병원에는 이 판매모델의 계약이나 사용이 없습니다'}
                    onClick={() => go(hospital, days, m.key)}
                    className={`h-7 rounded px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      m.key === model ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        {model !== 'all' && (
          <p className="-mt-2 text-xs text-muted-foreground">
            {MODELS.find((m) => m.key === model)?.label} 기준 — 기기는 병원 상세 ‘도입 현황’의 판매모델로 나눕니다(그 기기의 계약·공급이 한 판매모델뿐이면 그 모델, 섞였으면 기기 현황의 계약건 — 연결이 없으면 일반형, 카트온은 사용량비례형).
            측정 환자 수는 심전계·산소포화도의 판매모델로(없으면 카트온), 가동률의 분모는 그 판매모델 딜의 계약 수량(공급 수량은 일반형, 카트온은 사용량비례형)입니다.
          </p>
        )}

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
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <fieldset className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <legend className="float-left mr-2 text-[11px] font-medium text-muted-foreground">지표</legend>
                {TREND_METRICS.map((m) => {
                  const available = m.unit === 'count' || anyDeviceAvailable
                  return (
                    <label
                      key={m.key}
                      className={`flex h-7 items-center gap-1.5 text-xs ${available ? 'cursor-pointer text-foreground' : 'text-muted-foreground'}`}
                      title={available ? undefined : '계약·공급 수량이 있는 기기가 없어 비율을 낼 수 없습니다'}
                    >
                      <input
                        type="checkbox"
                        checked={trendFilter.metrics[m.key] && available}
                        disabled={!available}
                        onChange={() => toggleTrend('metrics', m.key)}
                        className="h-3.5 w-3.5"
                        style={m.unit === 'count' ? { accentColor: countColor[m.key as 'measured' | 'peak'] } : undefined}
                      />
                      <span
                        aria-hidden
                        className={m.key === 'measured' ? 'h-2.5 w-2.5 rounded-sm' : 'h-0 w-4 border-t-[3px]'}
                        style={
                          m.unit === 'count'
                            ? m.key === 'measured'
                              ? { background: countColor.measured }
                              : { borderColor: countColor.peak }
                            : { borderColor: chart.tick, borderTopStyle: m.key === 'peakRate' ? 'dashed' : 'dotted' }
                        }
                      />
                      {m.label}
                    </label>
                  )
                })}
              </fieldset>
              <fieldset className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <legend className="float-left mr-2 text-[11px] font-medium text-muted-foreground">기기</legend>
                {DEVICE_SLOTS.map((d) => {
                  const available = deviceAvailable(d.key)
                  return (
                    <label
                      key={d.key}
                      className={`flex h-7 items-center gap-1.5 text-xs ${available ? 'cursor-pointer text-foreground' : 'text-muted-foreground'}`}
                      title={available ? '가동률·사용률 선에 적용됩니다' : '계약·공급 수량이 없어 가동률을 낼 수 없습니다'}
                    >
                      <input
                        type="checkbox"
                        checked={trendFilter.devices[d.key] && available}
                        disabled={!available}
                        onChange={() => toggleTrend('devices', d.key)}
                        className="h-3.5 w-3.5"
                        style={{ accentColor: deviceColor[d.key] }}
                      />
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: deviceColor[d.key] }} />
                      {d.label}
                    </label>
                  )
                })}
              </fieldset>
            </div>
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
                      formatter={(v, name) => (/가동률|사용률/.test(String(name)) ? `${Math.round(Number(v))}%` : Number(v).toLocaleString())}
                    />
                    {trendFilter.metrics.measured && (
                      <Bar yAxisId="count" dataKey="measured" name="측정 환자 수" fill={countColor.measured} maxBarSize={22} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {trend.map((r) => (
                          <Cell key={r.label} fillOpacity={r.today ? 0.45 : 1} />
                        ))}
                      </Bar>
                    )}
                    {trendFilter.metrics.peak && (
                      <Line yAxisId="count" type="linear" dataKey="peak" name="최대 동시측정 수" stroke={countColor.peak} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    )}
                    {rateLines.map((l) => (
                      <Line
                        key={l.key}
                        yAxisId="rate"
                        type="linear"
                        dataKey={l.key}
                        name={l.name}
                        stroke={l.color}
                        strokeWidth={2}
                        strokeDasharray={l.dash}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="px-2 pt-1 text-[11px] text-muted-foreground">
                  왼쪽 축 = 건수(측정 환자 수·최대 동시측정 수, 병원 전체), 오른쪽 축 = 비율(%) — 동시 가동률 = 그날 최대 동시사용 수 ÷ 계약·공급 수량(긴 점선), 일 사용률 = 그날 사용 횟수 ÷ 계약·공급 수량(짧은 점선), 색 = 기기
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
                동시 가동률 = 최대 동시사용 수 ÷ 계약·공급 수량 · 일 사용률 = 일 사용 횟수 ÷ 계약·공급 수량 (병원 상세 ‘도입 현황’의 계약/공급)
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

        {/* 주간 통계 */}
        <UsageWeekly hospital={hospital} model={model} />
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
  const capacity = device?.capacity ?? null
  const hasCapacity = !!device?.days.some((d) => !!d.capacity)
  const rows = useMemo(() => {
    if (!device || !hasCapacity) return []
    return device.days.map((d) => ({
      label: md(d.date),
      peakRate: d.peak === null || !d.capacity ? null : (d.peak / d.capacity) * 100,
      useRate: d.uses === null || !d.capacity ? null : (d.uses / d.capacity) * 100,
    }))
  }, [device, hasCapacity])
  const top = useMemo(() => {
    let max = 100
    for (const r of rows) {
      if (r.useRate !== null && r.useRate > max) max = r.useRate
      if (r.peakRate !== null && r.peakRate > max) max = r.peakRate
    }
    return Math.ceil(max / 50) * 50
  }, [rows])
  const capacityTitle =
    device && capacity !== null
      ? [
          device.contractQty !== null ? `계약 ${device.contractQty.toLocaleString()}대` : null,
          device.supplyQty !== null ? `공급(대웅 직판) ${device.supplyQty.toLocaleString()}대` : null,
        ]
          .filter(Boolean)
          .join(' + ')
      : undefined

  return (
    <Card className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3.5">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground" title={capacityTitle}>
          {!device ? '계약 —' : capacity === null ? '계약 없음' : `${device.capacitySource === 'SUPPLY' ? '공급' : '계약'} ${capacity.toLocaleString()}대${device.capacitySource === 'BOTH' ? ' (공급 포함)' : ''}`}
        </span>
      </div>
      {device && !hasCapacity ? (
        <div className="flex h-[244px] flex-col items-center justify-center gap-1.5 px-5 text-center">
          <p className="text-sm font-semibold">계약·공급 수량이 없습니다</p>
          <p className="text-[13px] text-muted-foreground">병원 상세의 ‘도입 현황’에 이 기기의 계약 수량이나 공급 수량이 있으면 가동률이 표시됩니다.</p>
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
