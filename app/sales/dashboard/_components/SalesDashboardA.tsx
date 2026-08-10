'use client'

/**
 * 영업 대시보드 A — 도입 실적 (경영 요약)
 * 계약완료 딜 기준. 축 금액은 억 단위 표기(툴팁은 원 단위 풀 자릿수).
 */

import { useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area, LabelList } from 'recharts'
import { useChartTheme } from '@/app/components/theme/useChartTheme'

export interface DashboardAData {
  kpi: {
    hospitals: number
    expanded: number
    wards: number
    beds: number
    devices: number
    dwTotalSum: number
    actualSum: number
    saleSum: number
    activeDeals: number
  }
  monthly: Array<{ ym: string; count: number; hosp: number; beds: number; cumHosp: number; cumBeds: number }>
  allDeals: DealListRow[]
  typeDist: Array<{ name: string; count: number; total: number; beds: number; totalBeds: number }>
  settleDist: Array<{ name: string; count: number }>
  taxDist: Array<{ name: string; count: number }>
}

export interface DealListRow {
  name: string
  type: string
  model: string | null
  devices: number | null
  date: string
  sido: string | null
}

const won = (v: number) => `${v.toLocaleString('ko-KR')}원`
const eok = (v: number) => `${(v / 1e8).toFixed(v >= 1e9 ? 0 : 1)}억`

const pad2 = (n: number) => String(n).padStart(2, '0')
const dstr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

/** 월/주 계약내역 리스트 카드 — ◀▶로 기간 이동 (KST 로컬 기준, offset 0 = 이번달/이번주) */
function DealListCard({ title, mode, deals }: { title: string; mode: 'month' | 'week'; deals: DealListRow[] }) {
  const [offset, setOffset] = useState(0)
  const th = 'whitespace-nowrap px-2 py-1.5 text-left text-[11px] font-medium text-gray-400'
  const td = 'whitespace-nowrap px-2 py-1.5 text-[12px] text-gray-700'

  const now = new Date()
  let from: string, to: string, label: string
  if (mode === 'month') {
    const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    from = dstr(base)
    to = dstr(new Date(base.getFullYear(), base.getMonth() + 1, 0))
    label = `${base.getFullYear()}.${pad2(base.getMonth() + 1)}`
  } else {
    const dow = (now.getDay() + 6) % 7 // 월요일 시작
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + offset * 7)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
    from = dstr(start)
    to = dstr(end)
    label = `${pad2(start.getMonth() + 1)}.${pad2(start.getDate())}~${pad2(end.getMonth() + 1)}.${pad2(end.getDate())}`
  }
  const rows = deals.filter((r) => r.date >= from && r.date <= to)
  const navBtn = 'rounded-md border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-100'

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{title} <span className="ml-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{rows.length}건</span></h3>
        <span className="inline-flex items-center gap-1">
          <button className={navBtn} onClick={() => setOffset(offset - 1)} aria-label={mode === 'month' ? '지난달' : '지난주'}>◀</button>
          <span className="min-w-[92px] text-center text-[11px] font-medium tabular-nums text-gray-600">
            {label}{offset === 0 && <span className="ml-1 text-blue-600">{mode === 'month' ? '이번달' : '이번주'}</span>}
          </span>
          <button className={navBtn} onClick={() => setOffset(offset + 1)} aria-label={mode === 'month' ? '다음달' : '다음주'}>▶</button>
        </span>
      </div>
      <div className="mt-2 max-h-[200px] overflow-auto">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">계약 내역이 없습니다.</p>
        ) : (
          <table className="min-w-full">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th className={th}>병원명</th>
                <th className={th}>병원종</th>
                <th className={th}>판매모델</th>
                <th className={`${th} text-right`}>도입병상 수</th>
                <th className={th}>계약일</th>
                <th className={th}>지역</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className={`${td} max-w-[140px] truncate font-medium text-gray-900`} title={r.name}>{r.name}</td>
                  <td className={td}>{r.type}</td>
                  <td className={td}>{r.model ?? '—'}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.devices?.toLocaleString() ?? '—'}</td>
                  <td className={`${td} tabular-nums`}>{r.date}</td>
                  <td className={td}>{r.sido ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}

function Card({ title, children, note }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {note && <span className="text-[11px] text-gray-400">{note}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

/** 상태 구성 미니 바 — 정산·세금계산서 (건수 라벨 병기, 색만으로 구분하지 않음) */
function StatusBar({ items, colors }: { items: Array<{ name: string; count: number }>; colors: Record<string, string> }) {
  const total = items.reduce((a, i) => a + i.count, 0)
  if (total === 0) return <p className="text-sm text-gray-400">데이터 없음</p>
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded" style={{ gap: 2 }}>
        {items.map((i) => (
          <div key={i.name} style={{ width: `${(i.count / total) * 100}%`, backgroundColor: colors[i.name] ?? '#94a3b8' }} title={`${i.name} ${i.count}건`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {items.map((i) => (
          <span key={i.name} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors[i.name] ?? '#94a3b8' }} />
            {i.name} <b className="text-gray-900">{i.count}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

/** 누적+월별 트렌드 카드 — 상단 누적 히어로 숫자, 누적 그라데이션 에어리어(끝점 강조), 하단 월별 막대(값 라벨 상시) */
function TrendCard({ title, unit, cum, rows, color, gradId, chart }: {
  title: string; unit: string; cum: number; color: string; gradId: string
  rows: Array<{ ym: string; v: number; cum: number }>
  chart: ReturnType<typeof useChartTheme>
}) {
  const thisMonth = rows.length > 0 ? rows[rows.length - 1].v : 0
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="text-[11px] text-gray-400">최근 12개월</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-gray-900">{cum.toLocaleString()}<span className="ml-0.5 text-sm font-medium text-gray-500">{unit}</span></span>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">누적 · 이번달 +{thisMonth.toLocaleString()}</span>
      </div>
      <ResponsiveContainer width="100%" height={104}>
        <AreaChart data={rows} margin={{ top: 14, right: 34, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="ym" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${Number(v).toLocaleString()}${unit}`, '누적']} />
          <Area type="monotone" dataKey="cum" stroke={color} strokeWidth={2.5} fill={`url(#${gradId})`} dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={96}>
        <BarChart data={rows} margin={{ top: 14, right: 8, left: 8, bottom: 0 }}>
          <XAxis dataKey="ym" tick={{ fontSize: 9, fill: chart.tick }} tickLine={false} axisLine={false} interval={0} />
          <YAxis hide />
          <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${Number(v).toLocaleString()}${unit}`, '월별']} />
          <Bar dataKey="v" fill={color} radius={[3, 3, 0, 0]} maxBarSize={16}>
            <LabelList dataKey="v" position="top" fontSize={9} fill={chart.tick} formatter={(v: unknown) => (Number(v) > 0 ? Number(v).toLocaleString() : '')} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-right text-[10px] text-gray-400">위 = 누적 · 아래 = 월별</p>
    </div>
  )
}

export default function SalesDashboardA({ data }: { data: DashboardAData }) {
  const chart = useChartTheme()
  const { kpi } = data

  const statusColors: Record<string, string> = {
    완료: chart.emerald, 발행완료: chart.emerald,
    진행중: chart.amber,
    미정산: chart.dark ? '#64748b' : '#94a3b8', 미발행: chart.dark ? '#64748b' : '#94a3b8',
    '씨어스 계약': chart.indigo,
    미지정: chart.dark ? '#475569' : '#cbd5e1',
  }

  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-gray-900">도입 실적 대시보드</h2>
        <span className="text-xs text-gray-400">계약완료 딜 기준 · 진행중(영업중) 딜 {kpi.activeDeals}건 별도</span>
      </div>

      {/* KPI */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="도입 병원" value={`${kpi.hospitals.toLocaleString()}곳`} sub={`확장(2차+) ${kpi.expanded}곳`} />
        <Kpi label="누적 도입 병동" value={`${kpi.wards.toLocaleString()}병동`} />
        <Kpi label="누적 도입 병상" value={`${kpi.devices.toLocaleString()}병상`} sub={`대웅 디바이스 수량 기준 · 게이트웨이 환경 병상 ${kpi.beds.toLocaleString()}`} />
        <Kpi label="대웅제약 매출액" value={eok(kpi.dwTotalSum)} sub={won(kpi.dwTotalSum)} />
        <Kpi label="누적 실판매액" value={eok(kpi.actualSum)} sub={won(kpi.actualSum)} />
        <Kpi label="누적 판매 (제품+공사)" value={eok(kpi.saleSum)} sub={won(kpi.saleSum)} />
        <Kpi label="영업중 딜" value={`${kpi.activeDeals}건`} />
      </div>

      {/* 월별 추이 — 3등분: 계약 건수 / 도입 병원(누적+월별) / 도입 병상(누적+월별) */}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card title="월별 계약 건수" note="계약일 기준 · 최근 24개월">
          <ResponsiveContainer width="100%" height={244}>
            <BarChart data={data.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
              <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${v}건`, '계약']} />
              <Bar dataKey="count" fill={chart.emerald} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <TrendCard title="도입 병원 수" unit="곳" color={chart.blue} gradId="gradHosp" chart={chart}
          cum={kpi.hospitals} rows={data.monthly.slice(-12).map((m) => ({ ym: m.ym, v: m.hosp, cum: m.cumHosp }))} />
        <TrendCard title="도입 병상 수 (대웅 디바이스)" unit="병상" color={chart.amber} gradId="gradBeds" chart={chart}
          cum={kpi.devices} rows={data.monthly.slice(-12).map((m) => ({ ym: m.ym, v: m.beds, cum: m.cumBeds }))} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <DealListCard title="월 계약내역" mode="month" deals={data.allDeals} />
        <DealListCard title="주 계약내역" mode="week" deals={data.allDeals} />
        <Card title="종별 도입 병원" note="도입 수 / 종별 전체 병원 수 · 병상: 도입 병상(딜) / 종별 전체 병상(심평원) · 종별 위계 순">
          <div className="space-y-2">
            {data.typeDist.length === 0 && <p className="text-sm text-gray-400">데이터 없음</p>}
            {data.typeDist.map((t, i) => {
              const colors = [chart.indigo, chart.blue, '#0ea5e9', chart.emerald, chart.amber, '#64748b']
              const c = colors[i % colors.length]
              const pct = t.total > 0 ? (t.count / t.total) * 100 : 0
              const bedPct = t.totalBeds > 0 ? (t.beds / t.totalBeds) * 100 : 0
              return (
                <div key={t.name} className="relative overflow-hidden rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/40">
                  {/* 침투율 배경 게이지 */}
                  <div className="absolute inset-y-0 left-0 opacity-15" style={{ width: `${Math.max(pct, 1.5)}%`, backgroundColor: c }} />
                  <div className="relative flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-gray-700">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c }} />
                      {t.name}
                    </span>
                    <span className="text-[12px] tabular-nums text-gray-500">
                      <b className="text-[15px] font-bold" style={{ color: c }}>{t.count.toLocaleString()}</b>
                      <span className="mx-1 text-gray-400">/</span>{t.total.toLocaleString()}곳
                      <span className="ml-2 rounded-full bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 shadow-sm dark:bg-gray-900">{Math.round(pct * 10) / 10}%</span>
                    </span>
                  </div>
                  <div className="relative mt-1 flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">병상</span>
                    <span className="text-[11px] tabular-nums text-gray-500">
                      <b className="font-semibold" style={{ color: c }}>{t.beds.toLocaleString()}</b>
                      <span className="mx-1 text-gray-400">/</span>
                      {t.totalBeds > 0 ? `${t.totalBeds.toLocaleString()}병상` : '-'}
                      <span className="ml-2 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 shadow-sm dark:bg-gray-900">
                        {t.totalBeds > 0 ? `${Math.round(bedPct * 10) / 10}%` : '-%'}
                      </span>
                    </span>
                  </div>
                  {t.totalBeds > 0 && (
                    <div className="relative mt-1 h-1 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-700/50">
                      <div className="h-full rounded-full opacity-70" style={{ width: `${Math.max(Math.min(bedPct, 100), 0.5)}%`, backgroundColor: c }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="정산 현황" note="계약완료 딜 기준">
          <StatusBar items={data.settleDist} colors={statusColors} />
        </Card>
        <Card title="세금계산서 발행 현황" note="계약완료 딜 기준">
          <StatusBar items={data.taxDist} colors={statusColors} />
        </Card>
      </div>
    </div>
  )
}
