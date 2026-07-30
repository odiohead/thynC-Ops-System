'use client'

/**
 * 영업 대시보드 A — 도입 실적 (경영 요약)
 * 계약완료 딜 기준. 축 금액은 억 단위 표기(툴팁은 원 단위 풀 자릿수).
 */

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { useChartTheme } from '@/app/components/theme/useChartTheme'

export interface DashboardAData {
  kpi: {
    hospitals: number
    expanded: number
    wards: number
    beds: number
    bedTarget: number
    actualSum: number
    saleSum: number
    activeDeals: number
  }
  monthly: Array<{ ym: string; count: number; actual: number }>
  modelDist: Array<{ name: string; count: number }>
  typeDist: Array<{ name: string; count: number }>
  regionTop: Array<{ name: string; actual: number }>
  settleDist: Array<{ name: string; count: number }>
  taxDist: Array<{ name: string; count: number }>
}

const won = (v: number) => `${v.toLocaleString('ko-KR')}원`
const eok = (v: number) => `${(v / 1e8).toFixed(v >= 1e9 ? 0 : 1)}억`

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

export default function SalesDashboardA({ data }: { data: DashboardAData }) {
  const chart = useChartTheme()
  const { kpi } = data
  const targetRate = kpi.bedTarget > 0 ? Math.round((kpi.beds / kpi.bedTarget) * 1000) / 10 : 0

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
        <Kpi label="누적 도입 병상" value={`${kpi.beds.toLocaleString()}병상`} />
        <Kpi label="목표 달성도" value={`${targetRate}%`} sub={`목표 ${kpi.bedTarget.toLocaleString()}병상`} />
        <Kpi label="누적 실판매액" value={eok(kpi.actualSum)} sub={won(kpi.actualSum)} />
        <Kpi label="누적 판매 (제품+공사)" value={eok(kpi.saleSum)} sub={won(kpi.saleSum)} />
        <Kpi label="영업중 딜" value={`${kpi.activeDeals}건`} />
      </div>

      {/* 월별 추이 — 한 축 원칙: 금액·건수를 별도 차트로 */}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="월별 실판매액" note="계약일 기준 · 최근 24개월">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} tickFormatter={(v: number) => eok(v)} width={48} />
              <Tooltip contentStyle={chart.tooltip} formatter={(v) => [won(Number(v)), '실판매액']} />
              <Bar dataKey="actual" fill={chart.blue} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="월별 계약 건수" note="계약일 기준 · 최근 24개월">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
              <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${v}건`, '계약']} />
              <Bar dataKey="count" fill={chart.emerald} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card title="판매모델별 계약" note="병원 판매모델 · 딜 수">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.modelDist} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: chart.tick }} tickLine={false} axisLine={false} width={92} />
              <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${v}건`, '계약']} />
              <Bar dataKey="count" fill={chart.blue} radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: 'right', fontSize: 11, fill: chart.tick }} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="종별 도입 병원" note="병원 수">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.typeDist} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: chart.tick }} tickLine={false} axisLine={false} width={92} />
              <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${v}곳`, '병원']} />
              <Bar dataKey="count" fill={chart.indigo} radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: 'right', fontSize: 11, fill: chart.tick }} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="지역별 실판매액 Top 10">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.regionTop} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} tickFormatter={(v: number) => eok(v)} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: chart.tick }} tickLine={false} axisLine={false} width={64} />
              <Tooltip contentStyle={chart.tooltip} formatter={(v) => [won(Number(v)), '실판매액']} />
              <Bar dataKey="actual" fill={chart.blue} radius={[0, 4, 4, 0]} maxBarSize={14}>
                {data.regionTop.map((r) => <Cell key={r.name} fill={chart.blue} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
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
