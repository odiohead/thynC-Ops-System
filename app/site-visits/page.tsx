'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface StatusCode {
  id: number
  name: string
  color: string | null
}

interface SiteVisit {
  id: number
  siteVisitCode?: string | null
  hospital: { hospitalCode: string; hospitalName: string; hiraHospitalName: string; address: string | null }
  daewoongUser: { id: string; name: string } | null
  assignees: { user: { id: string; name: string } }[]
  status: StatusCode | null
  requestDate: string | null
  visitDate: string | null
  replyDate: string | null
}

function formatDate(val: string | null): string {
  if (!val) return '-'
  return val.slice(0, 10)
}

function formatCode(sv: { siteVisitCode?: string | null; id: number }): string {
  return sv.siteVisitCode ?? `SV-${String(sv.id).padStart(5, '0')}`
}

function hospitalName(sv: SiteVisit): string {
  return sv.hospital.hospitalName || sv.hospital.hiraHospitalName
}

function assigneeNames(sv: SiteVisit): string {
  return sv.assignees?.length > 0 ? sv.assignees.map((a) => a.user.name).join(', ') : ''
}

function StatusBadge({ status }: { status: { name: string; color: string | null } | null }) {
  if (!status) return <span className="text-gray-400">-</span>
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: status.color ? `${status.color}22` : '#F3F4F6',
        color: status.color ?? '#6B7280',
        border: `1px solid ${status.color ?? '#E5E7EB'}`,
      }}
    >
      {status.name}
    </span>
  )
}

// ── 필터·정렬 상태 (sessionStorage 보존 — 상세 다녀와도 유지) ──
type Filters = {
  q: string
  daewoong: string
  assignee: string
  statusId: string
  reqFrom: string; reqTo: string
  visitFrom: string; visitTo: string
  replyFrom: string; replyTo: string
}
const EMPTY_FILTERS: Filters = {
  q: '', daewoong: '', assignee: '', statusId: '',
  reqFrom: '', reqTo: '', visitFrom: '', visitTo: '', replyFrom: '', replyTo: '',
}
type SortKey = 'code' | 'hospital' | 'address' | 'daewoong' | 'assignees' | 'status' | 'requestDate' | 'visitDate' | 'replyDate'
type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null

const STORE_KEY = 'siteVisits:listState'

function loadStored(): { filters: Filters; sort: Sort } {
  if (typeof window === 'undefined') return { filters: EMPTY_FILTERS, sort: null }
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return { filters: EMPTY_FILTERS, sort: null }
    const parsed = JSON.parse(raw)
    return { filters: { ...EMPTY_FILTERS, ...(parsed.filters ?? {}) }, sort: parsed.sort ?? null }
  } catch {
    return { filters: EMPTY_FILTERS, sort: null }
  }
}

/** 날짜 문자열이 [from, to] 범위에 드는지 (빈 경계는 무제한, 값 없으면 범위 지정 시 제외) */
function inDateRange(val: string | null, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!val) return false
  const d = val.slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

export default function SiteVisitsPage() {
  const router = useRouter()
  const [siteVisits, setSiteVisits] = useState<SiteVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [statuses, setStatuses] = useState<StatusCode[]>([])

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<Sort>(null)
  const [restored, setRestored] = useState(false)

  // 저장된 필터·정렬 복원 (SSR 하이드레이션 불일치 방지를 위해 mount 이후 수행)
  useEffect(() => {
    const s = loadStored()
    setFilters(s.filters)
    setSort(s.sort)
    setRestored(true)
  }, [])

  // 필터·정렬 상태 보존 (복원 완료 후에만 — 복원 전 빈 값으로 덮어쓰기 방지)
  useEffect(() => {
    if (!restored) return
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ filters, sort })) } catch { /* 무시 */ }
  }, [filters, sort, restored])

  useEffect(() => {
    fetch('/api/settings/site-visit-status')
      .then((r) => r.json())
      .then((data) => setStatuses(data.statusCodes ?? []))
    // 전체 로드 후 필터·정렬은 클라이언트에서 처리 (기본 정렬 = 서버의 상태 우선순위 정렬)
    fetch('/api/site-visits?limit=10000')
      .then((r) => (r.ok ? r.json() : { siteVisits: [] }))
      .then((data) => setSiteVisits(data.siteVisits ?? []))
      .finally(() => setLoading(false))
  }, [])

  // 담당자 select 옵션은 실제 데이터에서 추출
  const daewoongOptions = useMemo(
    () => Array.from(new Set(siteVisits.map((sv) => sv.daewoongUser?.name).filter(Boolean) as string[])).sort(),
    [siteVisits],
  )
  const assigneeOptions = useMemo(
    () => Array.from(new Set(siteVisits.flatMap((sv) => sv.assignees?.map((a) => a.user.name) ?? []))).sort(),
    [siteVisits],
  )

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return siteVisits.filter((sv) => {
      if (q && !hospitalName(sv).toLowerCase().includes(q)) return false
      if (filters.daewoong && sv.daewoongUser?.name !== filters.daewoong) return false
      if (filters.assignee && !sv.assignees?.some((a) => a.user.name === filters.assignee)) return false
      if (filters.statusId && String(sv.status?.id ?? '') !== filters.statusId) return false
      if (!inDateRange(sv.requestDate, filters.reqFrom, filters.reqTo)) return false
      if (!inDateRange(sv.visitDate, filters.visitFrom, filters.visitTo)) return false
      if (!inDateRange(sv.replyDate, filters.replyFrom, filters.replyTo)) return false
      return true
    })
  }, [siteVisits, filters])

  const sorted = useMemo(() => {
    if (!sort) return filtered // 기본 = 서버 정렬(상태 우선순위 + 요청일)
    const val = (sv: SiteVisit): string => {
      switch (sort.key) {
        case 'code': return formatCode(sv)
        case 'hospital': return hospitalName(sv)
        case 'address': return sv.hospital.address ?? ''
        case 'daewoong': return sv.daewoongUser?.name ?? ''
        case 'assignees': return assigneeNames(sv)
        case 'status': return sv.status?.name ?? ''
        case 'requestDate': return sv.requestDate ?? ''
        case 'visitDate': return sv.visitDate ?? ''
        case 'replyDate': return sv.replyDate ?? ''
      }
    }
    return [...filtered].sort((a, b) => {
      const av = val(a); const bv = val(b)
      // 빈 값은 방향과 무관하게 항상 뒤로
      if (!av && !bv) return 0
      if (!av) return 1
      if (!bv) return -1
      const cmp = av.localeCompare(bv, 'ko')
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sort])

  // 헤더 클릭: asc → desc → 기본 정렬 해제
  function toggleSort(key: SortKey) {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: 'asc' }
      if (cur.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  const hasFilter = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  const COLS: { key: SortKey; label: string }[] = [
    { key: 'code', label: '코드' },
    { key: 'hospital', label: '병원명' },
    { key: 'address', label: '주소' },
    { key: 'daewoong', label: '대웅 담당자' },
    { key: 'assignees', label: '담당자' },
    { key: 'status', label: '상태' },
    { key: 'requestDate', label: '요청일' },
    { key: 'visitDate', label: '답사 날짜' },
    { key: 'replyDate', label: '회신 날짜' },
  ]

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))

  const dateRange = (label: string, fromKey: keyof Filters, toKey: keyof Filters) => (
    <div className="flex items-center gap-1">
      <span className="shrink-0 text-xs font-medium text-gray-500">{label}</span>
      <input
        type="date"
        value={filters[fromKey]}
        onChange={(e) => set({ [fromKey]: e.target.value } as Partial<Filters>)}
        className="rounded-md border border-gray-300 px-1.5 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
      />
      <span className="text-xs text-gray-400">~</span>
      <input
        type="date"
        value={filters[toKey]}
        onChange={(e) => set({ [toKey]: e.target.value } as Partial<Filters>)}
        className="rounded-md border border-gray-300 px-1.5 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
      />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-full px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">답사 관리</h1>
            <p className="mt-1 text-sm text-gray-500">총 {sorted.length.toLocaleString()}건{hasFilter ? ` (전체 ${siteVisits.length.toLocaleString()}건)` : ''}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push('/site-visit-queue')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              메일 확인
            </button>
            <button
              type="button"
              onClick={() => router.push('/site-visits/new')}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 답사 등록
            </button>
          </div>
        </div>

        {/* 필터 */}
        <div className="mb-4 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <input
              type="text"
              placeholder="병원명 검색..."
              value={filters.q}
              onChange={(e) => set({ q: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-52"
            />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
              <select
                value={filters.daewoong}
                onChange={(e) => set({ daewoong: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">대웅 담당자 전체</option>
                {daewoongOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select
                value={filters.assignee}
                onChange={(e) => set({ assignee: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">담당자 전체</option>
                {assigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select
                value={filters.statusId}
                onChange={(e) => set({ statusId: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">상태 전체</option>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {dateRange('요청일', 'reqFrom', 'reqTo')}
            {dateRange('답사', 'visitFrom', 'visitTo')}
            {dateRange('회신', 'replyFrom', 'replyTo')}
            {hasFilter && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100"
              >
                필터 초기화
              </button>
            )}
          </div>
        </div>

        {/* 모바일 카드 리스트 */}
        <div className="space-y-2.5 md:hidden">
          {loading ? (
            <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">불러오는 중...</div>
          ) : sorted.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
              {hasFilter ? '조건에 맞는 답사가 없습니다.' : '등록된 답사가 없습니다.'}
            </div>
          ) : (
            sorted.map((sv) => (
              <Link
                key={sv.id}
                href={`/site-visits/${sv.id}`}
                className="block w-full rounded-xl border border-border bg-card p-4 text-left shadow-xs transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {hospitalName(sv)}
                  </span>
                  <span className="shrink-0">
                    <StatusBadge status={sv.status} />
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{sv.hospital.address || '-'}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>코드 <span className="text-foreground">{formatCode(sv)}</span></span>
                  <span>대웅 <span className="text-foreground">{sv.daewoongUser?.name ?? '-'}</span></span>
                  <span>담당자 <span className="text-foreground">{assigneeNames(sv) || '-'}</span></span>
                  <span>요청일 <span className="text-foreground">{formatDate(sv.requestDate)}</span></span>
                  <span>답사 <span className="text-foreground">{formatDate(sv.visitDate)}</span></span>
                  <span>회신 <span className="text-foreground">{formatDate(sv.replyDate)}</span></span>
                </div>
              </Link>
            ))
          )}
        </div>

        {/* 테이블 (데스크탑) — 전체 폭 사용, 한 화면 표시 */}
        <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:block">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {COLS.map((col) => (
                    <th key={col.key} className="whitespace-nowrap px-3 py-3 text-left">
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={`inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider transition-colors ${
                          sort?.key === col.key ? 'text-blue-600' : 'text-gray-500 hover:text-gray-800'
                        }`}
                        title="클릭하여 정렬 (오름차순 → 내림차순 → 기본)"
                      >
                        {col.label}
                        <span className="text-[10px]">
                          {sort?.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-sm text-gray-400">
                      {hasFilter ? '조건에 맞는 답사가 없습니다.' : '등록된 답사가 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  sorted.map((sv) => (
                    <tr key={sv.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-400">
                        {formatCode(sv)}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/site-visits/${sv.id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {hospitalName(sv)}
                        </Link>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-3 text-sm text-gray-500">
                        {sv.hospital.address || '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-700">
                        {sv.daewoongUser?.name ?? '-'}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">
                        {assigneeNames(sv) || '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <StatusBadge status={sv.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-700">{formatDate(sv.requestDate)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-700">{formatDate(sv.visitDate)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-700">{formatDate(sv.replyDate)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
