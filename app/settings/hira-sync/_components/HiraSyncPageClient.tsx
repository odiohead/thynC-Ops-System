'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type Job = {
  id: number
  startedAt: string
  endedAt: string | null
  status: string
  totalCount: number
}

type Log = {
  id: number
  type: string
  message: string
  stats: Record<string, unknown> | null
  createdAt: string
}

function fmt(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
        진행중
      </span>
    )
  }
  if (status === 'done') {
    return <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">완료</span>
  }
  return <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">오류</span>
}

function LogLine({ log }: { log: Log }) {
  switch (log.type) {
    case 'init':
      return <p className="text-gray-500">{log.message}</p>
    case 'group_start':
      return <p className="text-gray-400">{log.message}</p>
    case 'group_api_done':
      return <p className="text-gray-700">{log.message}</p>
    case 'group_db_done':
      return <p className="text-blue-600">✓ {log.message}</p>
    case 'done':
      return <p className="font-semibold text-green-600">✓ {log.message}</p>
    case 'error':
      return (log.stats as { fatal?: boolean } | null)?.fatal
        ? <p className="text-red-600">✗ {log.message}</p>
        : <p className="text-yellow-600">⚠ {log.message}</p>
    default:
      return <p className="text-gray-600">{log.message}</p>
  }
}

export default function HiraSyncPageClient({ initialJobs }: { initialJobs: Job[] }) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [selectedLogs, setSelectedLogs] = useState<Log[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const hasRunning = jobs.some((j) => j.status === 'running')

  // 목록 폴링 (진행 중인 잡이 있을 때)
  const fetchJobs = useCallback(async () => {
    const res = await fetch('/api/hira-hospitals/sync')
    if (res.ok) {
      const { jobs: data } = await res.json()
      setJobs(data)
    }
  }, [])

  useEffect(() => {
    if (!hasRunning) return
    const interval = setInterval(fetchJobs, 2000)
    return () => clearInterval(interval)
  }, [hasRunning, fetchJobs])

  // 선택된 잡 로그 조회
  const fetchLogs = useCallback(async (jobId: number) => {
    const res = await fetch(`/api/hira-hospitals/sync/${jobId}`)
    if (res.ok) {
      const { job } = await res.json()
      setSelectedLogs(job.logs)
    }
  }, [])

  useEffect(() => {
    if (!selectedJobId) return
    setLogsLoading(true)
    fetchLogs(selectedJobId).finally(() => setLogsLoading(false))

    const job = jobs.find((j) => j.id === selectedJobId)
    if (!job || job.status !== 'running') return

    const interval = setInterval(() => fetchLogs(selectedJobId), 2000)
    return () => clearInterval(interval)
  }, [selectedJobId, jobs, fetchLogs])

  // 로그 자동 스크롤
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [selectedLogs])

  async function startSync() {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/hira-hospitals/sync', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? '시작 실패')
        return
      }
      await fetchJobs()
      setSelectedJobId(json.jobId)
      setSelectedLogs([])
    } finally {
      setStarting(false)
    }
  }

  async function syncHospitals() {
    setSyncing(true)
    setSyncResult(null)
    setError(null)
    try {
      const res = await fetch('/api/hospitals/sync-from-hira', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? '동기화 실패')
      } else {
        setSyncResult(json.message)
      }
    } catch {
      setError('동기화 중 오류가 발생했습니다.')
    } finally {
      setSyncing(false)
    }
  }

  function selectJob(jobId: number) {
    if (selectedJobId === jobId) {
      setSelectedJobId(null)
      setSelectedLogs([])
    } else {
      setSelectedJobId(jobId)
      setSelectedLogs([])
    }
  }

  const selectedJob = jobs.find((j) => j.id === selectedJobId)

  return (
    <div className="space-y-6">

      {/* 연동 시작 카드 */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">데이터 연동</h2>
            <p className="mt-0.5 text-xs text-gray-400">심평원 Open API에서 병원 데이터를 가져와 갱신합니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={startSync}
              disabled={starting || hasRunning}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? '시작 중...' : hasRunning ? '연동 진행 중' : '연동 시작'}
            </button>
            <button
              onClick={syncHospitals}
              disabled={syncing || hasRunning}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? '동기화 중...' : '병원목록 동기화'}
            </button>
          </div>
        </div>
        {error && (
          <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-600">{error}</div>
        )}
        {syncResult && (
          <div className="border-b border-green-100 bg-green-50 px-6 py-3 text-sm text-green-600">{syncResult}</div>
        )}
        {hasRunning && (
          <div className="flex items-center gap-2 px-6 py-3 text-xs text-blue-600">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            백그라운드에서 연동이 진행 중입니다. 페이지를 닫아도 계속 실행됩니다.
          </div>
        )}
      </div>

      {/* 히스토리 테이블 + 로그 패널 */}
      <div className="flex gap-4">

        {/* 히스토리 목록 */}
        <div className={`overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm ${selectedJobId ? 'w-1/2' : 'w-full'}`}>
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">연동 히스토리</h2>
          </div>
          {jobs.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-gray-400">연동 기록이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['시작시간', '종료시간', '상태', '연동건수'].map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => selectJob(job.id)}
                      className={`cursor-pointer transition-colors hover:bg-gray-50 ${selectedJobId === job.id ? 'bg-indigo-50' : ''}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-gray-700">
                        {fmt(job.startedAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-gray-500">
                        {fmt(job.endedAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                        {job.status === 'running' ? '-' : job.totalCount.toLocaleString() + '건'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 로그 패널 */}
        {selectedJobId && (
          <div className="flex w-1/2 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">연동 로그</h2>
                {selectedJob && (
                  <p className="mt-0.5 text-xs text-gray-400">{fmt(selectedJob.startedAt)}</p>
                )}
              </div>
              <button
                onClick={() => { setSelectedJobId(null); setSelectedLogs([]) }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div
              ref={logRef}
              className="flex-1 overflow-y-auto px-5 py-4 font-mono text-xs space-y-1"
              style={{ maxHeight: '480px' }}
            >
              {logsLoading && selectedLogs.length === 0 ? (
                <p className="text-gray-400">로그를 불러오는 중...</p>
              ) : selectedLogs.length === 0 ? (
                <p className="text-gray-400">로그가 없습니다.</p>
              ) : (
                selectedLogs.map((log) => <LogLine key={log.id} log={log} />)
              )}
              {selectedJob?.status === 'running' && (
                <p className="animate-pulse text-gray-400">연동 진행 중...</p>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
