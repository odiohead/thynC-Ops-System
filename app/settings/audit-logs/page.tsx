'use client'

import { useState, useEffect, useCallback } from 'react'

interface AuditLog {
  id: number
  actorId: string | null
  actorEmail: string | null
  actorName: string | null
  actorRole: string | null
  action: string
  resource: string
  resourceId: string | null
  resourceLabel: string | null
  before: unknown
  after: unknown
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

interface Facets {
  resources: string[]
  actions: string[]
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-700 border-green-200',
  UPDATE: 'bg-blue-100 text-blue-700 border-blue-200',
  DELETE: 'bg-red-100 text-red-700 border-red-200',
  LOGIN: 'bg-purple-100 text-purple-700 border-purple-200',
  LOGOUT: 'bg-gray-100 text-gray-700 border-gray-200',
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-rose-100 text-rose-700',
  ADMIN: 'bg-amber-100 text-amber-700',
  USER: 'bg-sky-100 text-sky-700',
  VIEWER: 'bg-gray-100 text-gray-600',
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [facets, setFacets] = useState<Facets>({ resources: [], actions: [] })
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [resource, setResource] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [selected, setSelected] = useState<AuditLog | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(limit))
      if (search) params.set('search', search)
      if (action) params.set('action', action)
      if (resource) params.set('resource', resource)
      if (from) params.set('from', from)
      if (to) params.set('to', to)

      const res = await fetch(`/api/settings/audit-logs?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '감사 로그를 불러올 수 없습니다.')
      }
      const data = await res.json()
      setLogs(data.logs)
      setFacets(data.facets)
      setTotal(data.total)
      setTotalPages(data.totalPages)
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [page, limit, search, action, resource, from, to])

  useEffect(() => {
    load()
  }, [load])

  function applyFilters(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    load()
  }

  function resetFilters() {
    setSearch('')
    setAction('')
    setResource('')
    setFrom('')
    setTo('')
    setPage(1)
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">감사 로그</h1>
        <p className="text-sm text-gray-500 mt-1">
          모든 데이터 변경 및 인증 이벤트의 기록입니다. 누가 언제 무엇을 했는지 확인할 수 있습니다.
        </p>
      </div>

      <form
        onSubmit={applyFilters}
        className="mb-4 grid grid-cols-1 md:grid-cols-6 gap-2 rounded-lg border border-gray-200 bg-white p-3"
      >
        <input
          type="text"
          placeholder="검색 (사용자/대상)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:col-span-2 px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">전체 액션</option>
          {facets.actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={resource}
          onChange={(e) => setResource(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">전체 대상</option>
          {facets.resources.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
        <div className="md:col-span-6 flex gap-2 justify-end">
          <button
            type="button"
            onClick={resetFilters}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            초기화
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            검색
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            총 <span className="font-semibold text-gray-900">{total.toLocaleString()}</span>건
            {loading && <span className="ml-2 text-xs text-gray-400">불러오는 중...</span>}
          </div>
          <select
            value={limit}
            onChange={(e) => {
              setLimit(parseInt(e.target.value))
              setPage(1)
            }}
            className="px-2 py-1 border border-gray-300 rounded text-xs"
          >
            <option value="20">20개</option>
            <option value="50">50개</option>
            <option value="100">100개</option>
            <option value="200">200개</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs text-gray-600">
                <th className="px-3 py-2 font-medium whitespace-nowrap">시간</th>
                <th className="px-3 py-2 font-medium">사용자</th>
                <th className="px-3 py-2 font-medium">액션</th>
                <th className="px-3 py-2 font-medium">대상</th>
                <th className="px-3 py-2 font-medium">대상 코드/ID</th>
                <th className="px-3 py-2 font-medium">대상명</th>
                <th className="px-3 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-400 text-sm">
                    조건에 맞는 로그가 없습니다.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelected(log)}
                    className="hover:bg-blue-50 cursor-pointer"
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 font-mono">
                      {formatTime(log.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <span className="font-medium">{log.actorName ?? '시스템'}</span>
                        {log.actorEmail && (
                          <span className="text-xs text-gray-500">{log.actorEmail}</span>
                        )}
                        {log.actorRole && (
                          <span
                            className={`inline-block w-fit mt-0.5 px-1.5 py-0.5 text-[10px] rounded ${
                              ROLE_COLORS[log.actorRole] ?? 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {log.actorRole}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded border ${
                          ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                        }`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 font-mono">{log.resource}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 font-mono">
                      {log.resourceId ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-800">
                      {log.resourceLabel ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                      {log.ipAddress ?? '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-gray-200 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {page} / {totalPages} 페이지
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ‹‹
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ‹
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ›
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="px-2 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ››
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && <DetailModal log={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function DetailModal({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">감사 로그 상세 #{log.id}</div>
            <div className="font-semibold mt-0.5">
              <span
                className={`inline-block px-2 py-0.5 text-xs rounded border mr-2 ${
                  ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                }`}
              >
                {log.action}
              </span>
              {log.resource}
              {log.resourceId && <span className="text-gray-500"> / {log.resourceId}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500">시간</div>
              <div className="font-mono">{formatTime(log.createdAt)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">사용자</div>
              <div>
                {log.actorName ?? '시스템'}
                {log.actorEmail && (
                  <span className="text-gray-500 ml-2 text-xs">({log.actorEmail})</span>
                )}
                {log.actorRole && (
                  <span
                    className={`inline-block ml-2 px-1.5 py-0.5 text-[10px] rounded ${
                      ROLE_COLORS[log.actorRole] ?? 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {log.actorRole}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">대상명</div>
              <div>{log.resourceLabel ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">IP / User-Agent</div>
              <div className="font-mono text-xs">
                {log.ipAddress ?? '-'}
                {log.userAgent && (
                  <div className="text-[10px] text-gray-400 mt-0.5 truncate" title={log.userAgent}>
                    {log.userAgent}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DiffPanel before={log.before} after={log.after} />
        </div>
      </div>
    </div>
  )
}

function DiffPanel({ before, after }: { before: unknown; after: unknown }) {
  const beforeObj = (before && typeof before === 'object' ? before : null) as Record<string, unknown> | null
  const afterObj = (after && typeof after === 'object' ? after : null) as Record<string, unknown> | null

  const allKeys = Array.from(
    new Set([...(beforeObj ? Object.keys(beforeObj) : []), ...(afterObj ? Object.keys(afterObj) : [])])
  ).sort()

  if (allKeys.length === 0) {
    return (
      <div className="text-xs text-gray-400 italic">
        before/after 데이터가 없는 액션입니다.
      </div>
    )
  }

  function fmtValue(v: unknown): string {
    if (v === null || v === undefined) return '–'
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }

  return (
    <div>
      <div className="text-xs font-medium text-gray-700 mb-2">변경 내역 (before → after)</div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left">
              <th className="px-3 py-1.5 font-medium text-gray-600 w-1/4">필드</th>
              <th className="px-3 py-1.5 font-medium text-gray-600 w-3/8">Before</th>
              <th className="px-3 py-1.5 font-medium text-gray-600 w-3/8">After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {allKeys.map((k) => {
              const bVal = beforeObj?.[k]
              const aVal = afterObj?.[k]
              const bStr = fmtValue(bVal)
              const aStr = fmtValue(aVal)
              const changed = bStr !== aStr
              return (
                <tr key={k} className={changed ? 'bg-yellow-50' : ''}>
                  <td className="px-3 py-1.5 font-mono text-gray-700">{k}</td>
                  <td className="px-3 py-1.5 font-mono break-all text-red-600">{bStr}</td>
                  <td className="px-3 py-1.5 font-mono break-all text-green-700">{aStr}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
