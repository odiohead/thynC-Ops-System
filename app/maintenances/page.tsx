'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

interface StatusCode {
  id: number
  name: string
  color: string | null
}

interface Maintenance {
  id: number
  maintenanceCode: string | null
  hospital: { hospitalCode: string; hospitalName: string; hiraHospitalName: string; address: string | null }
  type: StatusCode | null
  status: StatusCode | null
  priority: string
  title: string
  isRemote: boolean
  reportedAt: string | null
  resolvedAt: string | null
  assignees: { user: { id: string; name: string } }[]
  visits: { startDate: string; endDate: string }[]
}

function formatDate(val: string | null): string {
  if (!val) return '-'
  return val.slice(0, 10)
}

function formatVisits(visits: { startDate: string; endDate: string }[]): string {
  if (!visits || visits.length === 0) return '-'
  const labels = visits.map((v) => {
    const s = v.startDate.slice(0, 10)
    const e = v.endDate.slice(0, 10)
    return s === e ? s : `${s}~${e.slice(5)}`
  })
  if (labels.length <= 2) return labels.join(', ')
  return `${labels.slice(0, 2).join(', ')} 외 ${labels.length - 2}건`
}

function hospitalName(m: Maintenance): string {
  return m.hospital.hospitalName || m.hospital.hiraHospitalName
}

function assigneeNames(m: Maintenance): string {
  return m.assignees?.length > 0 ? m.assignees.map((a) => a.user.name).join(', ') : ''
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

const priorityColors: Record<string, string> = {
  '긴급': 'bg-red-100 text-red-700 border-red-300',
  '높음': 'bg-amber-100 text-amber-700 border-amber-300',
  '보통': 'bg-blue-100 text-blue-700 border-blue-300',
  '낮음': 'bg-gray-100 text-gray-600 border-gray-300',
}

// 우선순위 정렬 순서 (긴급이 가장 앞)
const priorityRank: Record<string, number> = { '긴급': 0, '높음': 1, '보통': 2, '낮음': 3 }

function PriorityBadge({ priority }: { priority: string }) {
  const cls = priorityColors[priority] ?? 'bg-gray-100 text-gray-600 border-gray-300'
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {priority}
    </span>
  )
}

// ── 필터·정렬 상태 (sessionStorage 보존 — 상세 다녀와도 유지) ──
type Filters = {
  q: string
  typeId: string
  statusId: string
  priority: string
  assignee: string
  repFrom: string
  repTo: string
}
const EMPTY_FILTERS: Filters = { q: '', typeId: '', statusId: '', priority: '', assignee: '', repFrom: '', repTo: '' }

type SortKey = 'reportedAt' | 'hospital' | 'title' | 'type' | 'priority' | 'status' | 'remote' | 'assignees' | 'visits' | 'resolvedAt'
type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null

const STORE_KEY = 'maintenances:listState'

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

export default function MaintenancesPage() {
  const router = useRouter()
  const [maintenances, setMaintenances] = useState<Maintenance[]>([])
  const [loading, setLoading] = useState(true)
  const [types, setTypes] = useState<StatusCode[]>([])
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
    Promise.all([
      fetch('/api/settings/maintenance-type').then((r) => r.json()),
      fetch('/api/settings/maintenance-status').then((r) => r.json()),
    ]).then(([tData, sData]) => {
      setTypes(tData.statusCodes ?? [])
      setStatuses(sData.statusCodes ?? [])
    })
    // 전체 1회 로드 후 필터·정렬은 클라이언트에서 처리 (기본 정렬 = 접수일 최신순)
    fetch('/api/maintenances')
      .then((r) => (r.ok ? r.json() : { maintenances: [] }))
      .then((data) => setMaintenances(data.maintenances ?? []))
      .finally(() => setLoading(false))
  }, [])

  // 담당자 옵션은 실제 데이터에서 추출
  const assigneeOptions = useMemo(
    () => Array.from(new Set(maintenances.flatMap((m) => m.assignees?.map((a) => a.user.name) ?? []))).sort(),
    [maintenances],
  )

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return maintenances.filter((m) => {
      if (q && !hospitalName(m).toLowerCase().includes(q)) return false
      if (filters.typeId && String(m.type?.id ?? '') !== filters.typeId) return false
      if (filters.statusId && String(m.status?.id ?? '') !== filters.statusId) return false
      if (filters.priority && m.priority !== filters.priority) return false
      if (filters.assignee && !m.assignees?.some((a) => a.user.name === filters.assignee)) return false
      if (!inDateRange(m.reportedAt, filters.repFrom, filters.repTo)) return false
      return true
    })
  }, [maintenances, filters])

  const sorted = useMemo(() => {
    if (!sort) return filtered // 기본 = 접수일 최신순 (서버 정렬)
    const val = (m: Maintenance): string | number => {
      switch (sort.key) {
        case 'reportedAt': return m.reportedAt ?? ''
        case 'hospital': return hospitalName(m)
        case 'title': return m.title ?? ''
        case 'type': return m.type?.name ?? ''
        case 'priority': return priorityRank[m.priority] ?? 9
        case 'status': return m.status?.name ?? ''
        case 'remote': return m.isRemote ? 0 : 1
        case 'assignees': return assigneeNames(m)
        case 'visits': return m.visits?.[0]?.startDate ?? ''
        case 'resolvedAt': return m.resolvedAt ?? ''
      }
    }
    return [...filtered].sort((a, b) => {
      const av = val(a); const bv = val(b)
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av
      }
      const as = String(av); const bs = String(bv)
      // 빈 값은 방향과 무관하게 항상 뒤로
      if (!as && !bs) return 0
      if (!as) return 1
      if (!bs) return -1
      const cmp = as.localeCompare(bs, 'ko')
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
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))

  // cls: table-fixed 폭 배분 + 좁은 화면 숨김 (가로스크롤 방지 — 병원명·제목이 남은 폭을 나눠 가짐)
  const COLS: { key: SortKey; label: string; cls: string }[] = [
    { key: 'reportedAt', label: '접수일', cls: 'w-[5.5rem]' },
    { key: 'hospital', label: '병원명', cls: 'w-[22%]' },
    { key: 'title', label: '제목', cls: '' },
    { key: 'type', label: '장애유형', cls: 'w-[5.5rem]' },
    { key: 'priority', label: '우선순위', cls: 'w-16' },
    { key: 'status', label: '상태', cls: 'w-[5.5rem]' },
    { key: 'remote', label: '원격', cls: 'hidden w-12 lg:table-cell' },
    { key: 'assignees', label: '담당자', cls: 'w-24' },
    { key: 'visits', label: '방문일', cls: 'w-[6.5rem]' },
    { key: 'resolvedAt', label: '완료일', cls: 'hidden w-[5.5rem] xl:table-cell' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">유지보수</h1>
            <p className="mt-1 text-sm text-gray-500">총 {sorted.length.toLocaleString()}건{hasFilter ? ` (전체 ${maintenances.length.toLocaleString()}건)` : ''}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/maintenances/new')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            + 유지보수 등록
          </button>
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
                value={filters.typeId}
                onChange={(e) => set({ typeId: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">장애유형 전체</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select
                value={filters.statusId}
                onChange={(e) => set({ statusId: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">상태 전체</option>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select
                value={filters.priority}
                onChange={(e) => set({ priority: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">우선순위 전체</option>
                {['긴급', '높음', '보통', '낮음'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select
                value={filters.assignee}
                onChange={(e) => set({ assignee: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">담당자 전체</option>
                {assigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1">
              <span className="shrink-0 text-xs font-medium text-gray-500">접수일</span>
              <input
                type="date"
                value={filters.repFrom}
                onChange={(e) => set({ repFrom: e.target.value })}
                className="rounded-md border border-gray-300 px-1.5 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
              />
              <span className="text-xs text-gray-400">~</span>
              <input
                type="date"
                value={filters.repTo}
                onChange={(e) => set({ repTo: e.target.value })}
                className="rounded-md border border-gray-300 px-1.5 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
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
              {hasFilter ? '조건에 맞는 유지보수가 없습니다.' : '등록된 유지보수가 없습니다.'}
            </div>
          ) : (
            sorted.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => router.push(`/maintenances/${m.id}`)}
                className="block w-full rounded-xl border border-border bg-card p-4 text-left shadow-xs transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {hospitalName(m)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <PriorityBadge priority={m.priority} />
                    <StatusBadge status={m.status} />
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{m.title}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>접수일 <span className="text-foreground">{formatDate(m.reportedAt)}</span></span>
                  {m.type && (
                    <span className="inline-flex items-center gap-1">유형 <StatusBadge status={m.type} /></span>
                  )}
                  {m.isRemote && (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">원격</span>
                  )}
                  <span>담당자 <span className="text-foreground">{assigneeNames(m) || '-'}</span></span>
                  <span>방문일 <span className="text-foreground">{formatVisits(m.visits)}</span></span>
                  <span>완료일 <span className="text-foreground">{formatDate(m.resolvedAt)}</span></span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* 테이블 — table-fixed로 화면 폭 내 고정(가로스크롤 없음), 좁은 화면은 원격/완료일 숨김 */}
        <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:block">
          <table className="w-full table-fixed divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {COLS.map((col) => (
                  <th key={col.key} className={`px-2.5 py-3 text-left ${col.cls}`}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium uppercase tracking-wider transition-colors ${
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
                  <td colSpan={10} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-sm text-gray-400">
                    {hasFilter ? '조건에 맞는 유지보수가 없습니다.' : '등록된 유지보수가 없습니다.'}
                  </td>
                </tr>
              ) : (
                sorted.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/maintenances/${m.id}`)}>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-xs text-gray-700">{formatDate(m.reportedAt)}</td>
                    <td className="truncate px-2.5 py-2.5" title={hospitalName(m)}>
                      <span className="text-sm font-medium text-blue-600">
                        {hospitalName(m)}
                      </span>
                    </td>
                    <td className="truncate px-2.5 py-2.5 text-sm text-gray-700" title={m.title}>{m.title}</td>
                    <td className="truncate px-2.5 py-2.5" title={m.type?.name ?? ''}>
                      <StatusBadge status={m.type} />
                    </td>
                    <td className="px-2.5 py-2.5">
                      <PriorityBadge priority={m.priority} />
                    </td>
                    <td className="truncate px-2.5 py-2.5" title={m.status?.name ?? ''}>
                      <StatusBadge status={m.status} />
                    </td>
                    <td className="hidden px-2.5 py-2.5 text-sm text-gray-700 lg:table-cell">
                      {m.isRemote ? (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">원격</span>
                      ) : '-'}
                    </td>
                    <td className="truncate px-2.5 py-2.5 text-xs text-gray-700" title={assigneeNames(m)}>
                      {assigneeNames(m) || '-'}
                    </td>
                    <td className="truncate px-2.5 py-2.5 text-xs text-gray-700" title={formatVisits(m.visits)}>{formatVisits(m.visits)}</td>
                    <td className="hidden whitespace-nowrap px-2.5 py-2.5 text-xs text-gray-700 xl:table-cell">{formatDate(m.resolvedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
