'use client'

/**
 * VOC 주간 대시보드 (projects/voc_dashboard_design.md §4)
 * 메인 축 2개(Volume · Responsiveness) + AS 섹션, 팀/담당자·반복 병원은 토글(2차 진입).
 * 응답 시간은 중앙값·p90 표기(평균은 툴팁). 분류 집계는 복수 분류 각 1 계상.
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import type { VocDashboard, Dist } from '@/lib/vocDashboard'

const MAJOR_COLORS: Record<string, string> = {
  AS: '#2C5CE5', 오류SW: '#F97316', 오류HW: '#84CC16', EMR: '#EAB308', 사용: '#EC4899', 운영: '#06B6D4', 개선: '#38BDF8', 타사: '#8B5CF6',
}
const TEAM_COLORS = ['#2C5CE5', '#06B6D4', '#EC4899', '#F97316', '#84CC16', '#8B5CF6', '#EAB308', '#94A3B8', '#64748B', '#A3A3A3', '#737373']

/** 초 → 사람이 읽는 시간 (12분 · 1.3시간 · 2.1일) */
function fmtSec(s: number | null | undefined) {
  if (s === null || s === undefined || Number.isNaN(s)) return '—'
  if (s < 3600) return `${Math.round(s / 60)}분`
  if (s < 86400) return `${(s / 3600).toFixed(1)}시간`
  return `${(s / 86400).toFixed(1)}일`
}
function fmtDays(d: number | null | undefined) { return d === null || d === undefined ? '—' : `${Math.round(d * 10) / 10}일` }
function delta(cur: number, prev: number) {
  const d = cur - prev
  if (!prev && !cur) return { text: '—', cls: 'text-gray-400' }
  const pct = prev ? ` (${d >= 0 ? '+' : ''}${Math.round((d / prev) * 100)}%)` : ''
  return { text: `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)}${pct}`, cls: d > 0 ? 'text-red-600' : d < 0 ? 'text-blue-600' : 'text-gray-400' }
}
/** 시간 지표의 전주比 — 줄면 좋은 것(파랑), 늘면 빨강 */
function deltaSec(cur: number | null, prev: number | null) {
  if (cur === null || prev === null) return { text: '전주 —', cls: 'text-gray-400' }
  const d = cur - prev
  return { text: `전주 ${fmtSec(prev)} ${d > 0 ? '▲' : d < 0 ? '▼' : '='}`, cls: d > 0 ? 'text-red-600' : d < 0 ? 'text-blue-600' : 'text-gray-400' }
}
function distTitle(d: Dist, unit: 'sec' | 'day' = 'sec') {
  const f = unit === 'sec' ? fmtSec : fmtDays
  return `중앙값 ${f(d.median)} · p90 ${f(d.p90)} · 평균 ${f(d.avg)} · n=${d.n}`
}

function VocDashboardInner() {
  const chart = useChartTheme()
  const router = useRouter()
  const sp = useSearchParams()
  const weekParam = sp.get('week')
  const [repeat, setRepeat] = useState(5)
  const [data, setData] = useState<VocDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showTeams, setShowTeams] = useState(false)
  const [showRepeat, setShowRepeat] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const q = new URLSearchParams()
    if (weekParam) q.set('week', weekParam)
    q.set('repeat', String(repeat))
    const res = await fetch(`/api/voc-receipts/dashboard?${q}`)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '지표를 불러오지 못했습니다.'); setLoading(false); return }
    setData(await res.json()); setError(null); setLoading(false)
  }, [weekParam, repeat])
  useEffect(() => { void load() }, [load])

  const goWeek = (iso: string | null) => { if (iso) router.push(`/voc/dashboard?week=${iso}`) }
  const axisProps = { tick: { fontSize: 10, fill: chart.tick }, axisLine: false as const, tickLine: false as const }
  const tooltipProps = { contentStyle: chart.tooltip }

  if (error) return <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6"><p className="text-sm text-red-500">{error}</p></div>
  if (!data) return <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6"><p className="text-sm text-gray-500">지표를 불러오는 중…</p></div>

  const { week, volume, responsiveness: r, as, teams, repeatHospitals } = data
  const vocDelta = delta(volume.count, volume.prevCount)
  const asDelta = delta(as.count, as.prevCount)
  const humanPct = r.total ? Math.round((r.human / r.total) * 100) : null
  const within24Pct = r.total ? Math.round((r.within24h / r.total) * 100) : null
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
          <h1 className="text-xl font-bold text-gray-900">VOC 주간 대시보드</h1>
          <p className="mt-0.5 text-sm text-gray-500">월~일 ISO 주 · 응답 시간은 중앙값/p90 · 분류 집계는 복수 분류 각 1 계상(중복 포함)</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button type="button" onClick={() => goWeek(week.prevIso)} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50">◀</button>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-900">{week.iso} <span className="font-normal text-gray-500">({week.label})</span></p>
            {week.inProgress && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">진행 중인 주</span>}
          </div>
          <button type="button" disabled={!week.nextIso} onClick={() => goWeek(week.nextIso)} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">▶</button>
          {weekParam && <button type="button" onClick={() => router.push('/voc/dashboard')} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">지난주</button>}
          <button type="button" onClick={() => window.print()} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">인쇄</button>
          <Link href="/voc" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">← VOC 접수</Link>
        </div>
      </div>
      {loading && <p className="mb-2 text-xs text-gray-400">갱신 중…</p>}

      {/* ── 축 1 · Volume ── */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Volume — 얼마나 들어왔고 무엇이 늘었나</h2>
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {kpi('주간 VOC', `${volume.count}건`, { text: `전주 ${volume.prevCount}건 ${vocDelta.text}`, cls: vocDelta.cls }, '접수 시각(고객 첫 발화) 기준')}
          {kpi('일평균', `${volume.perDay}건`, { text: '영업일 5일 기준' })}
          {kpi('AS 접수', `${as.count}건`, { text: `고장 ${as.fault} · 분실 ${as.lost} · 전주 ${as.prevCount}건 ${asDelta.text}`, cls: asDelta.cls }, '접수일 기준, 취소 제외')}
          {kpi('미해결 VOC', `${r.backlog.total}건`, { text: `7일 경과 ${r.backlog.over7d}건 · ${r.backlog.byStatus.map((s) => `${s.name} ${s.count}`).join(' · ') || '없음'}`, cls: r.backlog.over7d ? 'text-red-600' : undefined }, '조회 시점 기준(회신완료·종결 제외)', r.backlog.over7d > 0)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
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
      </section>

      {/* ── 축 2 · Responsiveness ── */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Responsiveness — 얼마나 빨리 대응·해결했나 <span className="font-normal text-gray-400">(VOC 연결 채널톡 상담 {r.total}건, 담당자 발신 제외)</span></h2>
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {kpi('1차 대응 (사람)', fmtSec(r.firstResp.median), { text: `p90 ${fmtSec(r.firstResp.p90)} · ${deltaSec(r.firstResp.median, r.prevFirstResp.median).text}`, cls: deltaSec(r.firstResp.median, r.prevFirstResp.median).cls }, `고객 첫 발화 → 담당자 첫 답변(봇 제외). ${distTitle(r.firstResp)}`)}
          {kpi('상담 종료까지', fmtSec(r.close.median), { text: `p90 ${fmtSec(r.close.p90)} · ${deltaSec(r.close.median, r.prevClose.median).text}`, cls: deltaSec(r.close.median, r.prevClose.median).cls }, `고객 첫 발화 → 상담 종료. ${distTitle(r.close)}`)}
          {kpi('24h 내 종료', within24Pct === null ? '—' : `${within24Pct}%`, { text: `${r.within24h}/${r.total}건 (미종료 ${r.total - r.closed}건 포함)` })}
          {kpi('사람 개입률', humanPct === null ? '—' : `${humanPct}%`, { text: `${r.human}/${r.total}건 · 나머지는 ALF 단독 처리` }, '사람 담당자 답변이 있는 상담 비율')}
        </div>
        <Card title="8주 추이 — 1차 대응·종료 중앙값">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={r.weekly.map((w) => ({ ...w, first: w.medianFirst === null ? null : Math.round(w.medianFirst / 60), close: w.medianClose === null ? null : Math.round((w.medianClose / 3600) * 10) / 10 }))} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis yAxisId="l" {...axisProps} unit="분" />
              <YAxis yAxisId="r" orientation="right" {...axisProps} unit="h" />
              <Tooltip {...tooltipProps} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="l" type="monotone" dataKey="first" name="1차 대응 중앙값(분)" stroke={chart.blue} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line yAxisId="r" type="monotone" dataKey="close" name="종료 중앙값(시간)" stroke={chart.emerald} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </section>

      {/* ── AS ── */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">AS — VOC가 수리로 얼마나 이어졌나 <Link href="/as-receipts" className="ml-1 text-xs font-normal text-blue-600 hover:underline print:hidden">AS업무 →</Link></h2>
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {kpi('기기 대수', `${as.byGroup.reduce((a, g) => a + g.count, 0)}대`, { text: as.byGroup.filter((g) => g.count).map((g) => `${g.group} ${g.count}`).join(' · ') || '없음' }, '주간 접수 라인 수(취소 라인 제외)')}
          {kpi('수리출하 소요', fmtDays(as.shipDays.median), { text: `p90 ${fmtDays(as.shipDays.p90)} · 평균 ${fmtDays(as.shipDays.avg)} · ${as.shipDays.n}대` }, `이번 주 발송(수리반환·교체) 라인의 접수일→발송일, 달력일. ${distTitle(as.shipDays, 'day')}`)}
          {kpi('미완료 AS', `${as.backlog.open}건`, { text: `접수 후 7일 경과 ${as.backlog.over7d}건`, cls: as.backlog.over7d ? 'text-red-600' : undefined }, '조회 시점 기준(완료·취소 제외)')}
          {kpi('VOC 연계율', as.vocLinked.pct === null ? '—' : `${as.vocLinked.pct}%`, { text: `${as.vocLinked.n}/${as.vocLinked.total}건 — 채널톡 인입 전환(10/28~) 효과 추적` })}
        </div>
        <Card title="8주 추이 — AS 접수 (고장·분실)">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={as.weekly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip {...tooltipProps} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="fault" name="고장" stackId="a" fill={chart.blue} />
              <Bar dataKey="lost" name="분실" stackId="a" fill={chart.amber} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </section>

      {/* ── 2차: 팀·담당자 ── */}
      <section className="mb-4">
        <button type="button" onClick={() => setShowTeams((v) => !v)} className="mb-2 text-sm font-semibold text-gray-700 hover:text-gray-900 print:hidden">{showTeams ? '▾' : '▸'} 팀·담당자별 (채널톡 팀 태그 · 상담 담당자)</button>
        {showTeams && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <Card title="8주 추이 — 팀 태그 (복수 태그 중복 포함)" className="lg:col-span-3">
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
            <Card title={`담당자별 — ${week.iso}`} className="lg:col-span-2">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">담당자</th><th className="py-1 text-right">상담</th><th className="py-1 text-right">1차 대응 중앙값</th></tr></thead>
                <tbody>
                  {teams.assignees.map((a) => (
                    <tr key={a.name} className="border-t border-gray-100"><td className="py-1 text-gray-800">{a.name}</td><td className="py-1 text-right text-gray-900">{a.count}</td><td className="py-1 text-right text-gray-700">{fmtSec(a.medianFirst)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-gray-400">팀 점유: {teams.current.slice(0, 4).map((t) => `${t.team.replace(/^팀\//, '')} ${t.count}`).join(' · ')}</p>
            </Card>
          </div>
        )}
      </section>

      {/* ── 2차: 반복 발생 병원 ── */}
      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setShowRepeat((v) => !v)} className="text-sm font-semibold text-gray-700 hover:text-gray-900 print:hidden">{showRepeat ? '▾' : '▸'} 반복 발생 병원 <span className="font-normal text-gray-400">(최근 {repeatHospitals.windowWeeks}주 {repeatHospitals.threshold}건 이상 · {repeatHospitals.rows.length}곳)</span></button>
          {showRepeat && (
            <select value={repeat} onChange={(e) => setRepeat(parseInt(e.target.value))} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 print:hidden">
              {[3, 5, 10].map((n) => <option key={n} value={n}>{n}건 이상</option>)}
            </select>
          )}
        </div>
        {showRepeat && (
          <Card title="구조적 문제 신호 — 같은 병원에서 반복되는 VOC">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">병원</th><th className="py-1 pr-4 text-right">건수</th><th className="py-1 pl-4">주요 분류</th><th className="py-1">마지막 접수</th></tr></thead>
              <tbody>
                {repeatHospitals.rows.map((h) => (
                  <tr key={h.hospitalCode} className="border-t border-gray-100">
                    <td className="py-1"><Link href={`/voc?hospital=${h.hospitalCode}`} className="text-blue-600 hover:underline">{h.name}</Link></td>
                    <td className="py-1 pr-4 text-right font-medium text-gray-900">{h.count}</td>
                    <td className="py-1 pl-4 text-gray-700">{h.topType ?? '—'}</td>
                    <td className="py-1 text-gray-500">{new Date(h.lastAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })}</td>
                  </tr>
                ))}
                {repeatHospitals.rows.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-xs text-gray-400">해당 병원 없음</td></tr>}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <p className="text-[11px] text-gray-400">집계 시각 {new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 미해결·미완료는 조회 시점 기준, 나머지는 선택 주 기준</p>
    </div>
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
