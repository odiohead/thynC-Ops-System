'use client'

/**
 * AS 대시보드 (projects/as_dashboard_design.md, 2026-11-11) — AS업무 목록 우측 상단 [대시보드]로 진입
 * 탭 4개 = 질문 4개: 현황(지금 쌓인 것) · 기간 분석(들어오고 나간 양·소요일) · 병원별(어디서 많이·한도) · 기기·품질(어떤 기기가 왜)
 * 공통 필터: 기간(프리셋·직접 지정) · 구분 · 기기군 · 병원 — 병원을 고르면 4개 탭 전체가 그 병원 기준이 된다. '현황'만 기간을 쓰지 않는다.
 * 필터·탭은 URL에 동기화(공유·뒤로가기). 지표 정의는 lib/asDashboard.ts 단일 소스, 화면은 받은 숫자를 그리기만 한다.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import DateRangeFilter from '@/app/components/ui/DateRangeFilter'
import HospitalSearchInput from '@/app/components/HospitalSearchInput'
import type { AsDashNow, AsDashPeriod, AsDashHospitals, AsDashQuality, AsDashGranularity, AsDashSection } from '@/lib/asDashboard'
import { Segmented, type DashQuery, type RangeKey } from './_components/parts'
import NowTab from './_components/NowTab'
import PeriodTab from './_components/PeriodTab'
import HospitalsTab from './_components/HospitalsTab'
import QualityTab from './_components/QualityTab'

const TABS: { key: AsDashSection; label: string; question: string }[] = [
  { key: 'now', label: '현황', question: '지금 무엇이 얼마나 쌓여 있고 어디에 막혀 있나 — 조회 시점 기준(기간 미적용)' },
  { key: 'period', label: '기간 분석', question: '얼마나 들어오고 나갔나, 어떻게 처리됐고 얼마나 걸렸나' },
  { key: 'hospitals', label: '병원별', question: '어느 병원에서 많이 발생하나, 분실·라이트 한도는 괜찮은가' },
  { key: 'quality', label: '기기·품질', question: '어떤 기기가 얼마나 고장나고, 고친 뒤에도 다시 들어오나' },
]
const RANGE_PRESETS: { key: Exclude<RangeKey, 'custom'>; label: string }[] = [
  { key: '7d', label: '7일' }, { key: '30d', label: '30일' }, { key: '90d', label: '90일' },
  { key: 'month', label: '이번 달' }, { key: 'lastMonth', label: '지난 달' }, { key: 'year', label: '올해' }, { key: 'all', label: '전체' },
]
const DEFAULT_RANGE: RangeKey = '30d'

const pad = (n: number) => String(n).padStart(2, '0')
const todayKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const isYmd = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
/** 프리셋 → [from, to]. 'all'은 서버가 가장 오래된 접수일로 풀어 준다(from='all') */
function rangeOf(key: Exclude<RangeKey, 'custom'>): [string, string] {
  const t = todayKst()
  const [y, m] = t.split('-').map(Number)
  switch (key) {
    case '7d': return [addDays(t, -6), t]
    case '30d': return [addDays(t, -29), t]
    case '90d': return [addDays(t, -89), t]
    case 'month': return [`${y}-${pad(m)}-01`, t]
    case 'lastMonth': { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(new Date(py, pm, 0).getDate())}`] }
    case 'year': return [`${y}-01-01`, t]
    case 'all': return ['all', t]
  }
}

interface ApiResult<T> { section: AsDashSection; generatedAt: string; filter: { from: string; to: string; hospitalCode: string | null; hospitalName: string | null }; data: T }
type AnyData = AsDashNow | AsDashPeriod | AsDashHospitals | AsDashQuality

function AsDashboardInner() {
  const sp = useSearchParams()
  const [tab, setTab] = useState<AsDashSection>(() => (TABS.some((t) => t.key === sp.get('tab')) ? (sp.get('tab') as AsDashSection) : 'now'))
  const [query, setQuery] = useState<DashQuery>(() => {
    const rk = sp.get('range')
    const from = sp.get('from'); const to = sp.get('to')
    const preset = RANGE_PRESETS.find((p) => p.key === rk)?.key
    const custom = !preset && isYmd(from) && isYmd(to)
    const key: RangeKey = custom ? 'custom' : preset ?? DEFAULT_RANGE
    const [f, t] = custom ? [from as string, to as string] : rangeOf(key as Exclude<RangeKey, 'custom'>)
    const category = sp.get('category'); const group = sp.get('group')
    const hospital = sp.get('hospital')
    return {
      rangeKey: key, from: f, to: t,
      category: category === 'FAULT' || category === 'LOST' ? category : '',
      group: group === 'ECG' || group === 'SPO2' ? group : '',
      hospital: hospital ? { hospitalCode: hospital, hospitalName: sp.get('hname') ?? hospital } : null,
    }
  })
  const [granularity, setGranularity] = useState<AsDashGranularity | null>(null)
  const [results, setResults] = useState<Partial<Record<AsDashSection, ApiResult<AnyData>>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadSeq, setReloadSeq] = useState(0)
  const cache = useRef(new Map<string, ApiResult<AnyData>>())
  const seq = useRef(0)

  // 섹션별 요청 쿼리 — '현황'은 기간과 무관하므로 키에서 뺀다(기간만 바꿀 때 다시 부르지 않게)
  const apiQs = useCallback((section: AsDashSection) => {
    const p = new URLSearchParams({ section })
    if (section !== 'now') { p.set('from', query.from); p.set('to', query.to) }
    if (query.category) p.set('category', query.category)
    if (query.group) p.set('group', query.group)
    if (query.hospital) p.set('hospital', query.hospital.hospitalCode)
    if (section === 'period' && granularity) p.set('granularity', granularity)
    return p.toString()
  }, [query, granularity])

  useEffect(() => {
    const qs = apiQs(tab)
    const hit = cache.current.get(qs)
    if (hit) { setResults((r) => ({ ...r, [tab]: hit })); setError(null); setLoading(false); return }
    const my = ++seq.current
    setLoading(true)
    fetch(`/api/as-receipts/dashboard?${qs}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (my !== seq.current) return // 더 새로운 요청이 나감
        if (!res.ok) { setError(body.error ?? '지표를 불러오지 못했습니다.'); return }
        cache.current.set(qs, body)
        setResults((r) => ({ ...r, [tab]: body }))
        setError(null)
        // URL로 들어온 병원 코드는 이름을 서버 응답으로 채운다(없는 코드면 필터 해제)
        const f = (body as ApiResult<AnyData>).filter
        setQuery((cur) => {
          if (!cur.hospital) return cur
          if (!f.hospitalCode) return { ...cur, hospital: null }
          return f.hospitalName && f.hospitalName !== cur.hospital.hospitalName ? { ...cur, hospital: { hospitalCode: f.hospitalCode, hospitalName: f.hospitalName } } : cur
        })
      })
      .catch(() => { if (my === seq.current) setError('지표를 불러오지 못했습니다.') })
      .finally(() => { if (my === seq.current) setLoading(false) })
  }, [tab, apiQs, reloadSeq])

  // 필터·탭 → URL (공유·새로고침·뒤로가기 복원)
  useEffect(() => {
    const p = new URLSearchParams()
    if (tab !== 'now') p.set('tab', tab)
    if (query.rangeKey === 'custom') { p.set('from', query.from); p.set('to', query.to) } else if (query.rangeKey !== DEFAULT_RANGE) p.set('range', query.rangeKey)
    if (query.category) p.set('category', query.category)
    if (query.group) p.set('group', query.group)
    if (query.hospital) { p.set('hospital', query.hospital.hospitalCode); p.set('hname', query.hospital.hospitalName) }
    const qs = p.toString()
    window.history.replaceState(null, '', qs ? `/as-receipts/dashboard?${qs}` : '/as-receipts/dashboard')
  }, [tab, query])

  const setPreset = (key: Exclude<RangeKey, 'custom'>) => { const [from, to] = rangeOf(key); setGranularity(null); setQuery((c) => ({ ...c, rangeKey: key, from, to })) }
  const setCustom = (from: string, to: string) => {
    if (!from && !to) { setPreset(DEFAULT_RANGE as Exclude<RangeKey, 'custom'>); return }
    const t = to || todayKst()
    setGranularity(null)
    setQuery((c) => ({ ...c, rangeKey: 'custom', from: from || t, to: t }))
  }
  const pickHospital = useCallback((h: { hospitalCode: string; hospitalName: string }) => { setQuery((c) => ({ ...c, hospital: h })); setTab('hospitals'); window.scrollTo({ top: 0 }) }, [])
  const clearHospital = useCallback(() => setQuery((c) => ({ ...c, hospital: null })), [])
  const refresh = () => { cache.current.clear(); setReloadSeq((n) => n + 1) }
  const hasFilter = query.rangeKey !== DEFAULT_RANGE || !!query.category || !!query.group || !!query.hospital
  const reset = () => { const [from, to] = rangeOf(DEFAULT_RANGE as Exclude<RangeKey, 'custom'>); setGranularity(null); setQuery({ rangeKey: DEFAULT_RANGE, from, to, category: '', group: '', hospital: null }) }

  const result = results[tab]
  const stale = !!result && cache.current.get(apiQs(tab)) !== result // 필터를 바꿔 새 응답을 기다리는 중 — 이전 화면을 흐리게 유지
  const activeTab = TABS.find((t) => t.key === tab)!
  // 서버가 풀어 준 실제 기간('전체' 프리셋의 시작일 등) — 목록 링크에 쓴다
  const linkQuery = useMemo<DashQuery>(() => (result && tab !== 'now' ? { ...query, from: result.filter.from, to: result.filter.to } : query.from === 'all' ? { ...query, from: '2000-01-01' } : query), [query, result, tab])
  const periodOff = tab === 'now'
  const rangeText = result && tab !== 'now' ? `${result.filter.from} ~ ${result.filter.to}` : query.from === 'all' ? `전체 ~ ${query.to}` : `${query.from} ~ ${query.to}`

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">AS 대시보드</h1>
          <p className="mt-0.5 text-sm text-gray-500">기기 수리·교체(AS) 접수의 진행 현황과 기간·병원·기기별 통계</p>
        </div>
        <div className="flex items-center gap-2">
          {result && <span className="hidden text-xs text-gray-400 sm:inline">집계 {new Date(result.generatedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}</span>}
          <button type="button" onClick={refresh} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">새로고침</button>
          <Link href="/as-receipts" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">← AS업무</Link>
        </div>
      </div>

      {/* 필터 한 줄 — 기간 · 구분 · 기기군 · 병원 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
        <div className={`flex flex-wrap items-center gap-1.5 ${periodOff ? 'opacity-40' : ''}`} title={periodOff ? "'현황' 탭은 조회 시점 기준이라 기간을 쓰지 않습니다 — 다른 탭에서 적용됩니다" : undefined}>
          <span className="text-xs text-gray-500">기간</span>
          {RANGE_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPreset(p.key)} aria-pressed={query.rangeKey === p.key}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${query.rangeKey === p.key ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
              {p.label}
            </button>
          ))}
          <DateRangeFilter label="직접 지정" from={query.rangeKey === 'custom' ? query.from : ''} to={query.rangeKey === 'custom' ? query.to : ''} onChange={setCustom} />
          <span className="text-xs tabular-nums text-gray-500">{rangeText}</span>
        </div>
        <Segmented label="구분" value={query.category} onChange={(v) => setQuery((c) => ({ ...c, category: v }))} options={[{ value: '', label: '전체' }, { value: 'FAULT', label: '고장' }, { value: 'LOST', label: '분실' }]} />
        <Segmented label="기기군" value={query.group} onChange={(v) => setQuery((c) => ({ ...c, group: v }))} options={[{ value: '', label: '전체' }, { value: 'ECG', label: '심전계' }, { value: 'SPO2', label: '산소포화도' }]} />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">병원</span>
          <div className="w-56 [&>div]:mt-0"><HospitalSearchInput value={query.hospital} onChange={(h) => setQuery((c) => ({ ...c, hospital: h }))} /></div>
        </div>
        {hasFilter && <button type="button" onClick={reset} className="text-xs text-blue-600 hover:underline">필터 초기화</button>}
      </div>

      {/* 탭 = 질문 */}
      <div className="mb-1 flex items-end gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-current={t.key === tab ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${t.key === tab ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>{activeTab.question}</span>
        {query.hospital && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{query.hospital.hospitalName}만 보는 중</span>}
        {loading && <span className="text-gray-400">불러오는 중…</span>}
      </p>

      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!result && !error && <p className="py-16 text-center text-sm text-gray-400">지표를 불러오는 중…</p>}
      {result && (
        <div className={stale && loading ? 'pointer-events-none opacity-50' : ''}>
          {tab === 'now' && <NowTab data={result.data as AsDashNow} q={linkQuery} onPickHospital={pickHospital} />}
          {tab === 'period' && <PeriodTab data={result.data as AsDashPeriod} q={linkQuery} onGranularity={setGranularity} />}
          {tab === 'hospitals' && <HospitalsTab data={result.data as AsDashHospitals} q={linkQuery} onPickHospital={pickHospital} onClearHospital={clearHospital} />}
          {tab === 'quality' && <QualityTab data={result.data as AsDashQuality} q={linkQuery} onPickHospital={pickHospital} />}
        </div>
      )}
      <p className="mt-4 text-[11px] text-gray-400">취소 접수·라인취소는 물량 집계에서 제외 · 접수 = 접수일, 완료 = 완료일, 발송 = 기기 발송일 기준 · 한도·미완료·배치 기기는 기간과 무관한 현재 값 · 주간 보고용 금~목 집계는 <Link href="/voc/dashboard" className="underline hover:text-gray-600">VOC·AS 주간 대시보드</Link></p>
    </div>
  )
}

// useSearchParams 사용 컴포넌트는 Suspense 경계 필요 (Next.js App Router)
export default function AsDashboardPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6"><p className="text-sm text-gray-500">지표를 불러오는 중…</p></div>}>
      <AsDashboardInner />
    </Suspense>
  )
}
