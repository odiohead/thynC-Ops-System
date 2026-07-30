'use client'

/**
 * 영업 대시보드 C — 인사이트 (모던 CRM 레이아웃)
 * 히어로 KPI(그라데이션·스파크라인·전월 대비 델타) + 에어리어 트렌드 + 목표 게이지 도넛 +
 * 파이프라인 진행바 + 판매모델 도넛 + 리더보드 + 활동 피드 + 지역·확장 기회.
 * 색 원칙: 카테고리 고정 순서(blue→indigo→emerald→amber→slate), 상태는 색+숫자 병기.
 */

import Link from 'next/link'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts'
import { useChartTheme } from '@/app/components/theme/useChartTheme'

export interface DashboardCData {
  hero: {
    actualSum: number
    monthActual: number
    prevActual: number
    monthCount: number
    prevCount: number
    hospitals: number
    expanded: number
    beds: number
    bedTarget: number
    activeDeals: number
    newDealsThisMonth: number
  }
  monthly: Array<{ ym: string; actual: number; count: number }>
  pipeline: Array<{ name: string; color: string | null; count: number }>
  modelDist: Array<{ name: string; count: number }>
  leaderboard: Array<{ name: string; actual: number; done: number; active: number }>
  unassignedActual: number
  regionTop: Array<{ name: string; actual: number }>
  opportunity: Array<{ hospitalCode: string; name: string; total: number; intro: number; remaining: number; penetration: number }>
  activities: Array<{ id: number; date: string; type: string; author: string | null; hospitalCode: string; hospitalName: string }>
}

const eok = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1)}억` : v > 0 ? `${Math.round(v / 1e4).toLocaleString()}만` : '0')
const won = (v: number) => `${v.toLocaleString('ko-KR')}원`
const DONUT = ['#2C5CE5', '#6366F1', '#10B981', '#F59E0B', '#94A3B8'] // 고정 순서 — 순환 금지

function Delta({ cur, prev, unit }: { cur: number; prev: number; unit: string }) {
  if (prev === 0 && cur === 0) return <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">전월 —</span>
  const up = cur >= prev
  const pct = prev > 0 ? Math.abs(Math.round(((cur - prev) / prev) * 100)) : null
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${up ? 'bg-emerald-400/20 text-emerald-100' : 'bg-rose-400/25 text-rose-100'}`}>
      {up ? '▲' : '▼'} {pct !== null ? `${pct}%` : `${cur}${unit}`} <span className="font-normal opacity-70">vs 전월</span>
    </span>
  )
}

function DeltaLight({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-[11px] font-medium text-gray-400">전월 동일</span>
  const up = cur >= prev
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
      {up ? '▲' : '▼'} {Math.abs(cur - prev)}건 <span className="font-normal text-gray-400">vs 전월</span>
    </span>
  )
}

function Panel({ title, sub, children, className = '' }: { title: string; sub?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${className}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold text-gray-800">{title}</h3>
        {sub && <span className="text-[11px] text-gray-400">{sub}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

/** 이니셜 아바타 — 담당자 리더보드용 */
function Avatar({ name, rank }: { name: string; rank: number }) {
  const ring = rank === 0 ? 'ring-amber-400' : rank === 1 ? 'ring-slate-300' : rank === 2 ? 'ring-orange-300' : 'ring-transparent'
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-[13px] font-bold text-white ring-2 ring-offset-1 ${ring}`}>
      {name.slice(0, 1)}
    </span>
  )
}

export default function SalesDashboardC({ data }: { data: DashboardCData }) {
  const chart = useChartTheme()
  const h = data.hero
  const goalPct = Math.min(100, Math.round((h.beds / h.bedTarget) * 1000) / 10)
  const pipeMax = Math.max(1, ...data.pipeline.map((p) => p.count))
  const modelTotal = data.modelDist.reduce((a, m) => a + m.count, 0)
  const regionMax = Math.max(1, ...data.regionTop.map((r) => r.actual))
  const leadMax = Math.max(1, ...data.leaderboard.map((l) => l.actual))

  return (
    <div className="bg-gray-50/60 p-6" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">Sales Insight</h2>
          <p className="mt-0.5 text-xs text-gray-400">계약완료 실적 · 파이프라인 · 활동을 한 화면에서</p>
        </div>
        <span className="text-[11px] text-gray-400">기준: 계약완료 딜 · 오늘</span>
      </div>

      {/* ── 히어로 KPI ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* 누적 실판매액 — 다크 그라데이션 + 스파크라인 */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-indigo-800 p-5 text-white shadow-lg">
          <p className="text-[12px] font-medium text-blue-100">누적 실판매액</p>
          <p className="mt-1 text-[28px] font-bold leading-tight">{eok(h.actualSum)}<span className="ml-1 text-sm font-medium text-blue-200">원</span></p>
          <div className="mt-2 flex items-center gap-2">
            <Delta cur={h.monthActual} prev={h.prevActual} unit="원" />
            <span className="text-[11px] text-blue-200">이번 달 {eok(h.monthActual)}원</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-14 opacity-70">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.monthly} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="sparkC" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="actual" stroke="#ffffff" strokeWidth={1.5} fill="url(#sparkC)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 목표 달성도 — 게이지 도넛 */}
        <div className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="relative h-24 w-24 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[{ v: goalPct }, { v: Math.max(0, 100 - goalPct) }]}
                  dataKey="v" startAngle={90} endAngle={-270}
                  innerRadius={34} outerRadius={45} strokeWidth={0} isAnimationActive={false}
                >
                  <Cell fill={chart.blue} />
                  <Cell fill={chart.dark ? '#334155' : '#EEF2F7'} />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold text-gray-900">{goalPct}%</span>
            </div>
          </div>
          <div>
            <p className="text-[12px] font-medium text-gray-500">병상 목표 달성도</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{h.beds.toLocaleString()}<span className="text-sm font-medium text-gray-400"> / {h.bedTarget.toLocaleString()}병상</span></p>
            <p className="mt-1 text-[11px] text-gray-400">계약완료 도입 병상 누적</p>
          </div>
        </div>

        {/* 도입 병원 */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-[12px] font-medium text-gray-500">도입 병원</p>
          <p className="mt-1 text-[28px] font-bold leading-tight text-gray-900">{h.hospitals.toLocaleString()}<span className="ml-1 text-sm font-medium text-gray-400">곳</span></p>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-600">확장 {h.expanded}곳</span>
            <span className="text-[11px] text-gray-400">2차 이상 도입</span>
          </div>
        </div>

        {/* 영업 파이프라인 */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-[12px] font-medium text-gray-500">진행 중 영업</p>
          <p className="mt-1 text-[28px] font-bold leading-tight text-gray-900">{h.activeDeals}<span className="ml-1 text-sm font-medium text-gray-400">건</span></p>
          <div className="mt-2"><DeltaLight cur={h.newDealsThisMonth} prev={0} /> <span className="text-[11px] text-gray-400">이번 달 신규 {h.newDealsThisMonth}건</span></div>
        </div>
      </div>

      {/* ── 트렌드 + 파이프라인 ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="매출 트렌드" sub="월별 실판매액 · 최근 12개월" className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="trendC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chart.blue} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={chart.blue} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} tickFormatter={(v: number) => eok(v)} width={52} />
              <Tooltip
                contentStyle={chart.tooltip}
                formatter={(v, key) => (key === 'actual' ? [won(Number(v)), '실판매액'] : [`${v}건`, '계약'])}
              />
              <Area type="monotone" dataKey="actual" stroke={chart.blue} strokeWidth={2.5} fill="url(#trendC)" dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="영업 단계 파이프라인" sub="프로필 보유 병원">
          <ul className="space-y-3">
            {data.pipeline.map((p) => (
              <li key={p.name}>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color || '#94a3b8' }} />
                    {p.name}
                  </span>
                  <span className="font-semibold text-gray-900">{p.count}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(p.count / pipeMax) * 100}%`, backgroundColor: p.color || '#94a3b8' }} />
                </div>
              </li>
            ))}
            {data.pipeline.every((p) => p.count === 0) && (
              <li className="py-2 text-center text-xs text-gray-400">영업 단계가 지정된 병원이 없습니다 — 개요 탭에서 단계를 지정하세요</li>
            )}
          </ul>
        </Panel>
      </div>

      {/* ── 도넛 + 리더보드 + 활동 피드 ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="판매모델 구성" sub="계약완료 딜">
          <div className="flex items-center gap-4">
            <div className="relative h-36 w-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.modelDist} dataKey="count" nameKey="name" innerRadius={44} outerRadius={62} paddingAngle={2} strokeWidth={0}>
                    {data.modelDist.map((m, i) => <Cell key={m.name} fill={DONUT[i % DONUT.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={chart.tooltip} formatter={(v, name) => [`${v}건`, String(name)]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-gray-900">{modelTotal}</span>
                <span className="text-[10px] text-gray-400">계약</span>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-2">
              {data.modelDist.map((m, i) => (
                <li key={m.name} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-gray-600">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: DONUT[i % DONUT.length] }} />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <span className="shrink-0 font-semibold text-gray-900">{m.count} <span className="font-normal text-gray-400">({Math.round((m.count / modelTotal) * 100)}%)</span></span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="담당자 리더보드" sub="누적 실판매액 Top 5">
          {data.leaderboard.length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-400">담당 영업이 지정된 병원이 없습니다 — 개요 탭에서 지정하세요</p>
          ) : (
            <ul className="space-y-3.5">
              {data.leaderboard.map((l, i) => (
                <li key={l.name} className="flex items-center gap-3">
                  <Avatar name={l.name} rank={i} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between">
                      <span className="truncate text-[13px] font-semibold text-gray-800">{l.name}</span>
                      <span className="text-[13px] font-bold text-gray-900" title={won(l.actual)}>{eok(l.actual)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${(l.actual / leadMax) * 100}%` }} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-400">계약 {l.done}건 · 영업중 {l.active}건</p>
                  </div>
                </li>
              ))}
              {data.unassignedActual > 0 && (
                <li className="border-t border-gray-100 pt-2 text-[11px] text-gray-400">담당 미지정 실적 {eok(data.unassignedActual)}원 — 병원 프로필에서 담당을 지정하면 반영됩니다</li>
              )}
            </ul>
          )}
        </Panel>

        <Panel title="최근 영업 활동" sub="최신 8건">
          {data.activities.length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-400">활동 기록이 없습니다 — 병원 상세 &gt; 영업 활동 탭에서 작성하세요</p>
          ) : (
            <ul className="space-y-0">
              {data.activities.map((a, i) => (
                <li key={a.id} className="relative flex gap-3 pb-3.5">
                  {i < data.activities.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-gray-100" />}
                  <span className="relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-400 ring-4 ring-indigo-50" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-gray-800">
                      <Link href={`/hospitals/${a.hospitalCode}`} className="font-semibold text-gray-900 hover:text-blue-600 hover:underline">{a.hospitalName}</Link>
                      <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{a.type}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400">{a.date}{a.author ? ` · ${a.author}` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── 지역 + 확장 기회 ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="지역별 실판매액" sub="Top 8">
          <ul className="space-y-2.5">
            {data.regionTop.map((r) => (
              <li key={r.name} className="flex items-center gap-3">
                <span className="w-10 shrink-0 text-[12px] font-medium text-gray-600">{r.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600" style={{ width: `${(r.actual / regionMax) * 100}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right text-[12px] font-semibold text-gray-900" title={won(r.actual)}>{eok(r.actual)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="확장 기회" sub="잔여 병상 큰 순 Top 5 · 전체 병상 입력 병원">
          {data.opportunity.length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-400">전체 병상수가 입력된 병원이 없습니다 — 개요 탭에서 입력하면 침투율 기반 기회가 표시됩니다</p>
          ) : (
            <ul className="space-y-3">
              {data.opportunity.map((o) => (
                <li key={o.hospitalCode} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between">
                      <Link href={`/hospitals/${o.hospitalCode}`} className="truncate text-[13px] font-semibold text-gray-800 hover:text-blue-600 hover:underline">{o.name}</Link>
                      <span className="shrink-0 text-[11px] text-gray-400">잔여 <b className="text-gray-900">{o.remaining.toLocaleString()}</b>병상</span>
                    </div>
                    <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-gray-100" title={`도입 ${o.intro.toLocaleString()} / 전체 ${o.total.toLocaleString()}병상`}>
                      <div className="h-full bg-blue-500" style={{ width: `${o.penetration}%` }} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-400">침투율 {o.penetration}% · 도입 {o.intro.toLocaleString()} / 전체 {o.total.toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
