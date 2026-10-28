'use client'

/**
 * VOC·AS 주간 대시보드 (projects/voc_dashboard_design.md §4, 2026-10-28 개정)
 * 금~목 주 · ① VOC Volume(건수·분류·병원 TOP10·팀/담당자) ② AS(고장/분실 분리 — 대수·단계·처리 결과·누적·수리출하·병원 TOP10 건수/배치 기기 대비)
 * 처리시간 SLA 지표는 사용자 결정으로 제외. 분류 집계는 복수 분류 각 1 계상.
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { ComposedChart, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import type { VocDashboard, AsCategoryStat, HospitalAsRow } from '@/lib/vocDashboard'

const MAJOR_COLORS: Record<string, string> = {
  AS: '#2C5CE5', 오류SW: '#F97316', 오류HW: '#84CC16', EMR: '#EAB308', 사용: '#EC4899', 운영: '#06B6D4', 개선: '#38BDF8', 타사: '#8B5CF6',
}
const TEAM_COLORS = ['#2C5CE5', '#06B6D4', '#EC4899', '#F97316', '#84CC16', '#8B5CF6', '#EAB308', '#94A3B8', '#64748B', '#A3A3A3', '#737373']

function fmtDays(d: number | null | undefined) { return d === null || d === undefined ? '—' : `${Math.round(d * 10) / 10}일` }
function delta(cur: number, prev: number) {
  const d = cur - prev
  if (!prev && !cur) return { text: '—', cls: 'text-gray-400' }
  const pct = prev ? ` (${d >= 0 ? '+' : ''}${Math.round((d / prev) * 100)}%)` : ''
  return { text: `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)}${pct}`, cls: d > 0 ? 'text-red-600' : d < 0 ? 'text-blue-600' : 'text-gray-400' }
}
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—')

function VocDashboardInner() {
  const chart = useChartTheme()
  const router = useRouter()
  const sp = useSearchParams()
  const weekParam = sp.get('week')
  const [data, setData] = useState<VocDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const q = new URLSearchParams()
    if (weekParam) q.set('week', weekParam)
    const res = await fetch(`/api/voc-receipts/dashboard?${q}`)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '지표를 불러오지 못했습니다.'); setLoading(false); return }
    setData(await res.json()); setError(null); setLoading(false)
  }, [weekParam])
  useEffect(() => { void load() }, [load])

  const goWeek = (start: string | null) => { if (start) router.push(`/voc/dashboard?week=${start}`) }
  const axisProps = { tick: { fontSize: 10, fill: chart.tick }, axisLine: false as const, tickLine: false as const }
  const tooltipProps = { contentStyle: chart.tooltip }

  if (error) return <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6"><p className="text-sm text-red-500">{error}</p></div>
  if (!data) return <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6"><p className="text-sm text-gray-500">지표를 불러오는 중…</p></div>

  const { week, volume, teams, as } = data
  const vocDelta = delta(volume.count, volume.prevCount)
  const teamsShown = teams.teams.slice(0, 6)

  const kpi = (label: string, value: string, sub?: { text: string; cls?: string }, title?: string, danger?: boolean) => (
    <div key={label} className={`rounded-xl border bg-white p-3 sm:p-4 ${danger ? 'border-red-300' : 'border-gray-200'}`} title={title}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold sm:text-2xl ${danger ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${sub.cls ?? 'text-gray-400'}`}>{sub.text}</p>}
    </div>
  )

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 print:max-w-none">
      {/* 헤더 + 주 선택기 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">VOC·AS 주간 대시보드</h1>
          <p className="mt-0.5 text-sm text-gray-500">금~목 주(표기는 목요일의 ISO 주) · 분류 집계는 복수 분류 각 1 계상(중복 포함) · 병원 TOP10은 주 종료일 기준 최근 {as.windowDays}일</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button type="button" onClick={() => goWeek(week.prevStart)} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50">◀</button>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-900">{week.iso} <span className="font-normal text-gray-500">({week.label})</span></p>
            {week.inProgress && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">진행 중인 주</span>}
          </div>
          <button type="button" disabled={!week.nextStart} onClick={() => goWeek(week.nextStart)} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">▶</button>
          {weekParam && <button type="button" onClick={() => router.push('/voc/dashboard')} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">지난주</button>}
          <button type="button" onClick={() => window.print()} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">인쇄</button>
          <Link href="/voc" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">← VOC 접수</Link>
        </div>
      </div>
      {loading && <p className="mb-2 text-xs text-gray-400">갱신 중…</p>}

      {/* ── ① VOC ── */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">VOC — 얼마나 들어왔고 무엇이 늘었나</h2>
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {kpi('주간 VOC', `${volume.count}건`, { text: `전주 ${volume.prevCount}건 ${vocDelta.text}`, cls: vocDelta.cls }, '접수 시각(고객 첫 발화) 기준')}
          {kpi('일평균', `${volume.perDay}건`, { text: '영업일 5일 기준' })}
          {kpi('상담 담당', `${teams.chatTotal}건`, { text: teams.current.slice(0, 3).map((t) => `${t.team.replace(/^팀\//, '')} ${t.count}`).join(' · ') || '—' }, '주간 VOC 연결 상담(담당자 발신 제외)의 채널톡 팀 태그 상위 3')}
          {kpi('미해결 VOC', `${volume.backlog.total}건`, { text: `7일 경과 ${volume.backlog.over7d}건 · ${volume.backlog.byStatus.map((s) => `${s.name} ${s.count}`).join(' · ') || '없음'}`, cls: volume.backlog.over7d ? 'text-red-600' : undefined }, '조회 시점 기준(회신완료·종결 제외)', volume.backlog.over7d > 0)}
        </div>
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card title="8주 추이 — 대분류 (분류 기준, 중복 포함)" className="lg:col-span-3">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={volume.byMajorWeekly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip {...tooltipProps} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {volume.majors.map((m) => <Bar key={m} dataKey={m} stackId="a" fill={MAJOR_COLORS[m] ?? '#94A3B8'} />)}
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card title={`중분류 TOP 10 — ${week.iso}`} className="lg:col-span-2">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">분류</th><th className="py-1 text-right">건수</th><th className="py-1 text-right">전주 대비</th></tr></thead>
              <tbody>
                {volume.topMinor.map((t) => { const d = delta(t.count, t.prev); return (
                  <tr key={t.name} className="border-t border-gray-100">
                    <td className="py-1 text-gray-800">{t.name}</td>
                    <td className="py-1 text-right font-medium text-gray-900">{t.count}</td>
                    <td className={`py-1 text-right text-xs ${d.cls}`}>{d.text}</td>
                  </tr>
                ) })}
                {volume.topMinor.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-xs text-gray-400">데이터 없음</td></tr>}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-gray-400">분류 합계 {volume.typedCount}건 / VOC {volume.count}건 (한 상담에 여러 분류 가능)</p>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card title={`병원 TOP 10 — 최근 ${as.windowDays}일 VOC 건수`} className="lg:col-span-2">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">병원</th><th className="py-1 pr-4 text-right">건수</th><th className="py-1 pl-2">주요 분류</th></tr></thead>
              <tbody>
                {volume.topHospitals4w.map((h) => (
                  <tr key={h.hospitalCode} className="border-t border-gray-100">
                    <td className="py-1"><Link href={`/voc?hospital=${h.hospitalCode}`} className="text-blue-600 hover:underline">{h.name}</Link></td>
                    <td className="py-1 pr-4 text-right font-medium text-gray-900">{h.count}</td>
                    <td className="py-1 pl-2 text-xs text-gray-600">{h.topType ?? '—'}</td>
                  </tr>
                ))}
                {volume.topHospitals4w.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-xs text-gray-400">데이터 없음</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title="8주 추이 — 팀 태그 (채널톡, 복수 태그 중복 포함)" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={teams.weekly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip {...tooltipProps} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {teamsShown.map((t, i) => <Line key={t} type="monotone" dataKey={t} name={t.replace(/^팀\//, '')} stroke={TEAM_COLORS[i]} strokeWidth={2} dot={{ r: 2 }} />)}
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card title={`담당자별 상담 — ${week.iso}`}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">담당자</th><th className="py-1 text-right">상담</th><th className="py-1 text-right">비중</th></tr></thead>
              <tbody>
                {teams.assignees.map((a) => (
                  <tr key={a.name} className="border-t border-gray-100"><td className="py-1 text-gray-800">{a.name}</td><td className="py-1 text-right text-gray-900">{a.count}</td><td className="py-1 text-right text-xs text-gray-500">{pct(a.count, teams.chatTotal)}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* ── ② AS ── */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">AS — 고장 / 분실 <Link href="/as-receipts" className="ml-1 text-xs font-normal text-blue-600 hover:underline print:hidden">AS업무 →</Link></h2>
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CategoryCard title="고장 접수" stat={as.fault} weekIso={week.iso} extra={[
            { label: '선교체 요청', value: `${as.preReplace}건`, title: '이번 주 고장 접수 중 선교체 요청' },
            { label: '수리출하 소요', value: fmtDays(as.shipDays.median), sub: `p90 ${fmtDays(as.shipDays.p90)} · 평균 ${fmtDays(as.shipDays.avg)} · ${as.shipDays.n}대`, title: '이번 주 발송(수리반환·교체) 라인의 접수일→발송일, 달력일 중앙값' },
          ]} />
          <CategoryCard title="분실 접수" stat={as.lost} weekIso={week.iso} extra={[]} />
        </div>
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="8주 추이 — 고장 기기 대수 (기기군) · 접수 건수">
            <AsTrend data={as.weekly} prefix="fault" chart={chart} axisProps={axisProps} tooltipProps={tooltipProps} />
          </Card>
          <Card title="8주 추이 — 분실 기기 대수 (기기군) · 접수 건수">
            <AsTrend data={as.weekly} prefix="lost" chart={chart} axisProps={axisProps} tooltipProps={tooltipProps} />
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <HospitalTable title={`병원 TOP 10 — 최근 ${as.windowDays}일 AS 접수 대수`} rows={as.topHospitalsByDevices} mode="devices" />
          <HospitalTable title={`병원 TOP 10 — 배치 기기 대비 AS 접수율 (최근 ${as.windowDays}일, 배치 ${as.ratioMinDeployed}대 이상)`} rows={as.topHospitalsByRatio} mode="ratio" />
        </div>
      </section>

      <p className="text-[11px] text-gray-400">집계 시각 {new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 미해결·미완료·배치 기기 수는 조회 시점 기준, 나머지는 선택 주(또는 최근 {as.windowDays}일) 기준 · 취소 접수·취소 라인 제외</p>
    </div>
  )
}

/** 고장/분실 카테고리 카드 — 주간 건수·대수·기기군·전주 대비 / 미완료 단계 / 최근 4주 처리 결과 / 누적 */
function CategoryCard({ title, stat, weekIso, extra }: { title: string; stat: AsCategoryStat; weekIso: string; extra: { label: string; value: string; sub?: string; title?: string }[] }) {
  const dr = delta(stat.receipts, stat.prevReceipts)
  const dd = delta(stat.devices, stat.prevDevices)
  const cells: { label: string; value: string; sub?: string; cls?: string; title?: string }[] = [
    { label: `접수 (${weekIso})`, value: `${stat.receipts}건`, sub: `전주 ${stat.prevReceipts}건 ${dr.text}`, cls: dr.cls },
    { label: '기기 대수', value: `${stat.devices}대`, sub: `${stat.byGroup.filter((g) => g.count).map((g) => `${g.group} ${g.count}`).join(' · ') || '—'} · 전주 ${stat.prevDevices}대 ${dd.text}`, cls: dd.cls },
    { label: '미완료', value: `${stat.open}건`, sub: `7일 경과 ${stat.openOver7d}건`, cls: stat.openOver7d ? 'text-red-600' : undefined, title: '조회 시점 기준(완료·취소 제외)' },
    { label: 'VOC 연계', value: pct(stat.vocLinked, stat.receipts), sub: `${stat.vocLinked}/${stat.receipts}건 — 채널톡 인입 전환(10/28~) 효과`, title: '이번 주 접수 중 VOC 마스터가 연결된 비율' },
    ...extra,
  ]
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg bg-gray-50 px-3 py-2" title={c.title}>
            <p className="text-[11px] text-gray-500">{c.label}</p>
            <p className="text-lg font-bold text-gray-900">{c.value}</p>
            {c.sub && <p className={`text-[11px] ${c.cls ?? 'text-gray-400'}`}>{c.sub}</p>}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
        <div>
          <p className="mb-1 font-medium text-gray-600">미완료 단계 (조회 시점)</p>
          {stat.stages.length ? stat.stages.map((s) => <p key={s.name} className="flex justify-between text-gray-700"><span>{s.name}</span><span className="font-medium">{s.count}</span></p>) : <p className="text-gray-400">없음</p>}
        </div>
        <div>
          <p className="mb-1 font-medium text-gray-600">처리 결과 (최근 4주 접수 라인)</p>
          {stat.outcomes4w.length ? stat.outcomes4w.map((o) => <p key={o.outcome} className="flex justify-between text-gray-700"><span>{o.outcome}</span><span className="font-medium">{o.count}</span></p>) : <p className="text-gray-400">없음</p>}
        </div>
        <div>
          <p className="mb-1 font-medium text-gray-600">누적 접수 대수 / 배치 기기</p>
          {stat.cumulative.map((c) => <p key={c.group} className="flex justify-between gap-2 text-gray-700" title="전 기간 접수 라인(취소 제외) / 현재 병원 배치(ACTIVE) 기기"><span className="whitespace-nowrap">{c.group}</span><span className="whitespace-nowrap font-medium">{c.devices.toLocaleString()} / {c.deployed.toLocaleString()} ({pct(c.devices, c.deployed)})</span></p>)}
        </div>
      </div>
    </div>
  )
}

function AsTrend({ data, prefix, chart, axisProps, tooltipProps }: { data: VocDashboard['as']['weekly']; prefix: 'fault' | 'lost'; chart: ReturnType<typeof useChartTheme>; axisProps: object; tooltipProps: object }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={chart.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis yAxisId="l" allowDecimals={false} {...axisProps} />
        <YAxis yAxisId="r" orientation="right" allowDecimals={false} {...axisProps} />
        <Tooltip {...tooltipProps} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="l" dataKey={`${prefix}심전계`} name="심전계(대)" stackId="a" fill={chart.amber} />
        <Bar yAxisId="l" dataKey={`${prefix}산소포화도`} name="산소포화도(대)" stackId="a" fill={chart.blue} />
        <Bar yAxisId="l" dataKey={`${prefix}기타`} name="기타(대)" stackId="a" fill="#94A3B8" />
        <Line yAxisId="r" type="monotone" dataKey={`${prefix}Receipts`} name="접수(건)" stroke={chart.emerald} strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function HospitalTable({ title, rows, mode }: { title: string; rows: HospitalAsRow[]; mode: 'devices' | 'ratio' }) {
  return (
    <Card title={title}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500">
          <th className="py-1">병원</th><th className="py-1 text-right">접수</th><th className="py-1 text-right">고장(대)</th><th className="py-1 text-right">분실(대)</th><th className="py-1 text-right">배치 기기</th><th className="py-1 text-right">{mode === 'ratio' ? '접수율' : '비율'}</th>
        </tr></thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.hospitalCode} className="border-t border-gray-100">
              <td className="py-1"><Link href={`/as-receipts?hospital=${h.hospitalCode}`} className="text-blue-600 hover:underline">{h.name}</Link></td>
              <td className="py-1 text-right text-gray-700">{h.receipts}</td>
              <td className="py-1 text-right font-medium text-gray-900">{h.faultDevices}</td>
              <td className="py-1 text-right text-gray-700">{h.lostDevices}</td>
              <td className="py-1 text-right text-gray-500">{h.deployed.toLocaleString()}</td>
              <td className={`py-1 text-right ${mode === 'ratio' ? 'font-medium text-gray-900' : 'text-gray-500'}`}>{h.ratio === null ? '—' : `${h.ratio}%`}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-xs text-gray-400">데이터 없음</td></tr>}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-gray-400">비율 = (고장+분실 대수) / 현재 배치(ACTIVE) 기기 수 · 기기 원장 기준</p>
    </Card>
  )
}

// useSearchParams 사용 컴포넌트는 Suspense 경계 필요 (Next.js App Router)
export default function VocDashboardPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6"><p className="text-sm text-gray-500">지표를 불러오는 중…</p></div>}>
      <VocDashboardInner />
    </Suspense>
  )
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 ${className}`}>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">{title}</h3>
      {children}
    </div>
  )
}
