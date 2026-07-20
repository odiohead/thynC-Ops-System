'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface Pricing {
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
  usdKrw: number
}
interface MonthRow {
  month: string
  questions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  users: number
}
interface UserRow {
  userId: string
  name: string
  email: string
  sessions: number
  questions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  lastUsed: string
}
interface HospitalRow {
  hospitalCode: string
  hospitalName: string
  questions: number
  sessions: number
}
interface UsageData {
  from: string
  to: string
  pricing: Pricing
  monthly: MonthRow[]
  users: UserRow[]
  hospitals: HospitalRow[]
}

interface Tokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

function costUsd(t: Tokens, p: Pricing): number {
  return (
    (t.inputTokens * p.inputPerMTok +
      t.outputTokens * p.outputPerMTok +
      t.cacheReadTokens * p.cacheReadPerMTok +
      t.cacheWriteTokens * p.cacheWritePerMTok) / 1_000_000
  )
}

function fmtCost(usd: number, p: Pricing): string {
  const dollar = `$${usd.toFixed(usd >= 100 ? 0 : 2)}`
  if (p.usdKrw > 0) return `${dollar} (₩${Math.round(usd * p.usdKrw).toLocaleString()})`
  return dollar
}

const fmtTok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n))

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

export default function AiUsagePage() {
  const chart = useChartTheme()
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(`${kstToday().slice(0, 7)}-01`)
  const [to, setTo] = useState(kstToday())
  const [pricingForm, setPricingForm] = useState<Pricing | null>(null)
  const [showPricing, setShowPricing] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const fetchData = useCallback(async (f: string, t: string) => {
    setLoading(true)
    const res = await fetch(`/api/settings/ai-usage?from=${f}&to=${t}`)
    if (res.ok) {
      const d: UsageData = await res.json()
      setData(d)
      setPricingForm((prev) => prev ?? d.pricing)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData(from, to) }, [fetchData]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyPeriod = (f: string, t: string) => {
    setFrom(f)
    setTo(t)
    fetchData(f, t)
  }

  const setThisMonth = () => applyPeriod(`${kstToday().slice(0, 7)}-01`, kstToday())
  const setLastMonth = () => {
    const now = new Date(Date.now() + 9 * 3600 * 1000)
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
    applyPeriod(first.toISOString().slice(0, 10), last.toISOString().slice(0, 10))
  }
  const setAll = () => applyPeriod('2026-01-01', kstToday())

  const pricing = data?.pricing ?? null

  // KPI: 이번달 vs 전월 (monthly 시리즈에서)
  const kpi = useMemo(() => {
    if (!data || !pricing) return null
    const thisMonth = kstToday().slice(0, 7)
    const prevMonthDate = new Date(Date.now() + 9 * 3600 * 1000)
    prevMonthDate.setUTCMonth(prevMonthDate.getUTCMonth() - 1)
    const prevMonth = prevMonthDate.toISOString().slice(0, 7)
    const cur = data.monthly.find((m) => m.month === thisMonth)
    const prev = data.monthly.find((m) => m.month === prevMonth)
    const zero: MonthRow = { month: '', questions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, users: 0 }
    return { cur: cur ?? zero, prev: prev ?? zero }
  }, [data, pricing])

  const chartData = useMemo(() => {
    if (!data || !pricing) return []
    return data.monthly.map((m) => ({
      label: `${m.month.slice(2, 4)}/${m.month.slice(5, 7)}`,
      questions: m.questions,
      cost: +costUsd(m, pricing).toFixed(2),
    }))
  }, [data, pricing])

  const periodTotal = useMemo(() => {
    if (!data || !pricing) return null
    const sum = data.users.reduce(
      (acc, u) => ({
        inputTokens: acc.inputTokens + u.inputTokens,
        outputTokens: acc.outputTokens + u.outputTokens,
        cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
        cacheWriteTokens: acc.cacheWriteTokens + u.cacheWriteTokens,
        questions: acc.questions + u.questions,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, questions: 0 },
    )
    return { ...sum, cost: costUsd(sum, pricing) }
  }, [data, pricing])

  const savePricing = async () => {
    if (!pricingForm) return
    setMsg(null)
    const res = await fetch('/api/settings/ai-usage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pricingForm),
    })
    const d = await res.json().catch(() => ({}))
    if (res.ok) {
      setMsg({ type: 'ok', text: '단가가 저장되었습니다.' })
      setData((prev) => (prev ? { ...prev, pricing: d.pricing } : prev))
      setPricingForm(d.pricing)
    } else {
      setMsg({ type: 'err', text: d.error ?? '저장 실패' })
    }
  }

  const inputCls = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none'
  const cardCls = 'rounded-xl border border-gray-200 bg-white'

  if (loading && !data) return <div className="p-10 text-center text-sm text-gray-400">불러오는 중...</div>
  if (!data || !pricing) return <div className="p-10 text-center text-sm text-gray-400">데이터를 불러올 수 없습니다.</div>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">AI 어시스턴트 사용 현황</h1>
        <button onClick={() => setShowPricing((v) => !v)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
          {showPricing ? '단가 설정 닫기' : '단가 설정'}
        </button>
      </div>
      <p className="mb-4 text-xs text-gray-400">
        비용은 토큰 × 단가로 계산한 <b>추정치</b>입니다 (실제 청구는 Anthropic Console 기준). 사용량은 별도 원장에 기록되어 대화를 삭제해도 집계에 유지됩니다.
      </p>

      {msg && <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${msg.type === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>}

      {/* 단가 설정 */}
      {showPricing && pricingForm && (
        <div className={`${cardCls} mb-4 p-4`}>
          <div className="mb-2 text-sm font-semibold text-gray-800">단가 (USD / 100만 토큰) — claude-opus-4-8</div>
          <div className="flex flex-wrap items-end gap-3">
            {([
              ['inputPerMTok', '입력'],
              ['outputPerMTok', '출력'],
              ['cacheReadPerMTok', '캐시 읽기'],
              ['cacheWritePerMTok', '캐시 쓰기'],
              ['usdKrw', '환율 (₩/$, 0=미표시)'],
            ] as [keyof Pricing, string][]).map(([key, label]) => (
              <div key={key}>
                <label className="mb-1 block text-xs text-gray-500">{label}</label>
                <input
                  type="number" step="0.01" min="0"
                  value={pricingForm[key]}
                  onChange={(e) => setPricingForm((p) => (p ? { ...p, [key]: parseFloat(e.target.value) || 0 } : p))}
                  className={inputCls + ' w-28'}
                />
              </div>
            ))}
            <button onClick={savePricing} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">저장</button>
          </div>
        </div>
      )}

      {/* KPI — 이번달 */}
      {kpi && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: '이번달 질문', value: kpi.cur.questions.toLocaleString(), sub: `전월 ${kpi.prev.questions.toLocaleString()}` },
            { label: '이번달 토큰 (입력/출력)', value: `${fmtTok(kpi.cur.inputTokens + kpi.cur.cacheReadTokens + kpi.cur.cacheWriteTokens)} / ${fmtTok(kpi.cur.outputTokens)}`, sub: `캐시 읽기 ${fmtTok(kpi.cur.cacheReadTokens)}` },
            { label: '이번달 예상 비용', value: fmtCost(costUsd(kpi.cur, pricing), pricing), sub: `전월 ${fmtCost(costUsd(kpi.prev, pricing), pricing)}` },
            { label: '이번달 사용자', value: `${kpi.cur.users}명`, sub: `전월 ${kpi.prev.users}명` },
          ].map((t) => (
            <div key={t.label} className={`${cardCls} px-4 py-3`}>
              <div className="text-xs text-gray-500">{t.label}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-gray-900">{t.value}</div>
              <div className="mt-0.5 text-[11px] text-gray-400">{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* 월별 추이 — 단일 축 차트 2개 */}
      <div className={`${cardCls} mb-4 p-4`}>
        <div className="mb-3 text-sm font-semibold text-gray-800">월별 추이 (최근 12개월)</div>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">질문 수</p>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: chart.tick }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: chart.tick }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chart.tooltip} formatter={(v: unknown) => [Number(v).toLocaleString(), '질문 수']} cursor={{ fill: chart.grid, opacity: 0.4 }} />
                <Bar dataKey="questions" fill={chart.blue} opacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">예상 비용 (USD)</p>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: chart.tick }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: chart.tick }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chart.tooltip} formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, '예상 비용']} cursor={{ fill: chart.grid, opacity: 0.4 }} />
                <Bar dataKey="cost" fill={chart.emerald} opacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 기간 필터 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <span className="text-sm text-gray-400">~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        <button onClick={() => fetchData(from, to)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">조회</button>
        <div className="ml-1 flex gap-1">
          <button onClick={setThisMonth} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">이번달</button>
          <button onClick={setLastMonth} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">지난달</button>
          <button onClick={setAll} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">전체</button>
        </div>
        {periodTotal && (
          <span className="ml-auto text-xs text-gray-500">
            기간 합계: 질문 <b>{periodTotal.questions.toLocaleString()}</b> · 예상 비용 <b className="text-emerald-600">{fmtCost(periodTotal.cost, pricing)}</b>
          </span>
        )}
      </div>

      {/* 사용자별 테이블 */}
      <div className={`${cardCls} mb-4 overflow-x-auto`}>
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-3 py-2.5">사용자</th>
              <th className="px-3 py-2.5 text-right">질문</th>
              <th className="px-3 py-2.5 text-right">세션</th>
              <th className="px-3 py-2.5 text-right">입력 토큰</th>
              <th className="px-3 py-2.5 text-right">출력 토큰</th>
              <th className="px-3 py-2.5 text-right">캐시 (읽기/쓰기)</th>
              <th className="px-3 py-2.5 text-right">예상 비용</th>
              <th className="px-3 py-2.5">최근 사용</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.users.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-sm text-gray-400">해당 기간 사용 내역이 없습니다.</td></tr>
            ) : data.users.map((u) => (
              <tr key={u.userId} className="hover:bg-gray-50">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-gray-900">{u.name}</div>
                  <div className="text-xs text-gray-400">{u.email}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium">{u.questions.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{u.sessions.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{u.inputTokens.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{u.outputTokens.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-xs text-gray-400">{fmtTok(u.cacheReadTokens)} / {fmtTok(u.cacheWriteTokens)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-600">{fmtCost(costUsd(u, pricing), pricing)}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{new Date(u.lastUsed).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 병원별 Top 10 */}
      {data.hospitals.length > 0 && (
        <div className={`${cardCls} p-4`}>
          <div className="mb-2 text-sm font-semibold text-gray-800">병원 컨텍스트 사용 Top 10 <span className="ml-1 text-xs font-normal text-gray-400">(기간 내, 병원 연결 세션만)</span></div>
          <div className="flex flex-wrap gap-2">
            {data.hospitals.map((h) => (
              <span key={h.hospitalCode} className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
                <b className="text-gray-800">{h.hospitalName}</b> · 질문 {h.questions.toLocaleString()} · 세션 {h.sessions.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-400">
        이 페이지는 사용량 메타데이터(횟수·토큰·비용)만 표시하며 대화 내용은 조회하지 않습니다.
      </p>
    </div>
  )
}
