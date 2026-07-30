'use client'

/**
 * 영업 대시보드 B — 영업 파이프라인 (활동·기회)
 * 단계 색은 설정 마스터(SALES_STAGE) 색 그대로 사용 — 엔티티 고정색 원칙.
 */

import Link from 'next/link'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, Cell, Legend } from 'recharts'
import { useChartTheme } from '@/app/components/theme/useChartTheme'

export interface DashboardBData {
  kpi: {
    activeDeals: number
    expandingHospitals: number
    newDealsThisMonth: number
    activitiesThisMonth: number
    profiledHospitals: number
    stageUnset: number
  }
  stageDist: Array<{ name: string; color: string | null; count: number }>
  lifecycle: { first: number; adopted: number; expanding: number; dropped: number }
  ownerStats: Array<{ name: string; hospitals: number; active: number; done: number; actual: number }>
  opportunity: Array<{ name: string; intro: number; remaining: number; penetration: number }>
  activityMonthly: Array<{ ym: string; count: number }>
  staleDeals: Array<{ hospitalCode: string; hospitalName: string; roundNo: number; owner: string | null; updatedAt: string; daysIdle: number }>
}

const eok = (v: number) => `${(v / 1e8).toFixed(v >= 1e9 ? 0 : 1)}억`
const won = (v: number) => `${v.toLocaleString('ko-KR')}원`

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

const LIFECYCLE_LABELS: Array<{ key: keyof DashboardBData['lifecycle']; label: string; color: string }> = [
  { key: 'first', label: '최초 도입 검토중', color: '#60a5fa' },
  { key: 'adopted', label: '도입완료', color: '#34d399' },
  { key: 'expanding', label: '추가도입 검토중', color: '#2dd4bf' },
  { key: 'dropped', label: '중단·해지', color: '#f87171' },
]

export default function SalesDashboardB({ data }: { data: DashboardBData }) {
  const chart = useChartTheme()
  const { kpi } = data
  const maxActual = Math.max(1, ...data.ownerStats.map((o) => o.actual))

  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-gray-900">영업 파이프라인 대시보드</h2>
        <span className="text-xs text-gray-400">영업 단계·기회·활동 중심 (실적 요약은 대시보드 A)</span>
      </div>

      {/* KPI */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="영업중 딜" value={`${kpi.activeDeals}건`} />
        <Kpi label="추가도입 검토 병원" value={`${kpi.expandingHospitals}곳`} sub="도입완료 + 신규 차수 진행" />
        <Kpi label="이번 달 신규 딜" value={`${kpi.newDealsThisMonth}건`} />
        <Kpi label="이번 달 영업 활동" value={`${kpi.activitiesThisMonth}건`} />
        <Kpi label="영업 프로필 병원" value={`${kpi.profiledHospitals}곳`} sub={`단계 미지정 ${kpi.stageUnset}곳`} />
        <Kpi label="라이프사이클" value={`${data.lifecycle.adopted + data.lifecycle.expanding}곳 도입`} sub={`검토 ${data.lifecycle.first} · 중단 ${data.lifecycle.dropped}`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* 영업 단계 파이프라인 — 마스터 순서·색 */}
        <Card title="영업 단계 파이프라인" note="프로필 보유 병원 기준 · 색 = 설정 마스터">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.stageDist} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: chart.tick }} tickLine={false} axisLine={false} width={96} />
              <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${v}곳`, '병원']} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: 'right', fontSize: 11, fill: chart.tick }}>
                {data.stageDist.map((s) => <Cell key={s.name} fill={s.color || '#94a3b8'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* 라이프사이클 분포 */}
        <Card title="병원 도입 라이프사이클" note="딜 보유 병원 기준">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={LIFECYCLE_LABELS.map((l) => ({ label: l.label, count: data.lifecycle[l.key], color: l.color }))} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: chart.tick }} tickLine={false} axisLine={false} width={116} />
              <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${v}곳`, '병원']} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: 'right', fontSize: 11, fill: chart.tick }}>
                {LIFECYCLE_LABELS.map((l) => <Cell key={l.key} fill={l.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* 담당자별 성과 */}
        <Card title="담당자별 성과" note="병원·딜·누적 실판매액">
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-3">담당</th>
                <th className="py-1.5 pr-3 text-right">병원</th>
                <th className="py-1.5 pr-3 text-right">영업중</th>
                <th className="py-1.5 pr-3 text-right">계약완료</th>
                <th className="py-1.5 pr-3 text-right">누적 실판매액</th>
                <th className="w-1/3 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.ownerStats.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-sm text-gray-400">담당 영업이 지정된 병원이 없습니다 (병원 상세 &gt; 영업 정보 &gt; 개요에서 지정)</td></tr>
              )}
              {data.ownerStats.map((o) => (
                <tr key={o.name} className="text-[13px] text-gray-800">
                  <td className="py-1.5 pr-3 font-medium">{o.name}</td>
                  <td className="py-1.5 pr-3 text-right">{o.hospitals}</td>
                  <td className="py-1.5 pr-3 text-right">{o.active}</td>
                  <td className="py-1.5 pr-3 text-right">{o.done}</td>
                  <td className="py-1.5 pr-3 text-right font-medium" title={won(o.actual)}>{o.actual > 0 ? eok(o.actual) : '—'}</td>
                  <td className="py-1.5">
                    <div className="h-3 rounded" style={{ width: `${Math.max(2, (o.actual / maxActual) * 100)}%`, backgroundColor: chart.blue }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* 확장 기회 */}
        <Card title="확장 기회 Top 10" note="잔여 병상(전체−도입) 큰 순 · 전체 병상 입력 병원만">
          {data.opportunity.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">전체 병상수가 입력된 병원이 없습니다 (개요 탭에서 입력)</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.opportunity} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} width={132} />
                <Tooltip contentStyle={chart.tooltip} formatter={(v, key) => [`${Number(v).toLocaleString()}병상`, key === 'intro' ? '도입' : '잔여']} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === 'intro' ? '도입 병상' : '잔여 병상')} />
                <Bar dataKey="intro" stackId="beds" fill={chart.blue} maxBarSize={14} />
                <Bar dataKey="remaining" stackId="beds" fill={chart.dark ? '#475569' : '#cbd5e1'} radius={[0, 4, 4, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* 월별 영업 활동 */}
        <Card title="월별 영업 활동" note="활동 기록 기준 · 최근 12개월">
          {data.activityMonthly.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">영업 활동 기록이 없습니다 (병원 상세 &gt; 영업 활동 탭에서 작성)</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.activityMonthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="ym" tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: chart.tick }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
                <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${v}건`, '활동']} />
                <Line type="monotone" dataKey="count" stroke={chart.indigo} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* 방치 딜 */}
        <Card title="오래 멈춘 영업중 딜 Top 10" note="최종 수정 오래된 순 — 팔로업 대상">
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-3">병원 · 차수</th>
                <th className="py-1.5 pr-3">담당</th>
                <th className="py-1.5 pr-3 text-right">최종 수정</th>
                <th className="py-1.5 text-right">경과</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.staleDeals.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-sm text-gray-400">영업중 딜이 없습니다</td></tr>
              )}
              {data.staleDeals.map((d) => (
                <tr key={`${d.hospitalCode}-${d.roundNo}`} className="text-[13px] text-gray-800">
                  <td className="py-1.5 pr-3">
                    <Link href={`/hospitals/${d.hospitalCode}`} className="font-medium text-blue-600 hover:underline">{d.hospitalName}</Link>
                    <span className="ml-1 text-xs text-gray-400">{d.roundNo}차</span>
                  </td>
                  <td className="py-1.5 pr-3">{d.owner ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right">{d.updatedAt}</td>
                  <td className={`py-1.5 text-right font-medium ${d.daysIdle >= 30 ? 'text-red-500' : 'text-gray-700'}`}>{d.daysIdle}일</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}
