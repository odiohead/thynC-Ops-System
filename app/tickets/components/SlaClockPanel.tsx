'use client'

/**
 * 티켓 상세 SLA 시계 패널 (1.1 P6 — §7.3)
 *
 * "왜 이 티켓이 SLA 위반인지"를 담당자가 알 수 있어야 한다.
 * metric별 기한·잔여/초과·정지 누적을 그대로 보여준다.
 */

import { useEffect, useState } from 'react'

interface Clock {
  metric: string
  statusScope: string | null
  state: string
  thresholdMin: number
  startedAt: string
  dueAt: string
  pausedMs: string
  satisfiedAt: string | null
  breachedAt: string | null
  policyName: string | null
}

const METRIC_LABELS: Record<string, string> = {
  ASSIGN: '배정까지', FIRST_RESPONSE: '첫 응답', RESOLVE: '해결까지',
  UPDATE_STALE: '무응답', DWELL: '상태 체류', DOMAIN_DUE: '도메인 기한',
}
const STATE_STYLE: Record<string, string> = {
  RUNNING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  PAUSED: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  MET: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  BREACHED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  CANCELED: 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
}
const STATE_LABELS: Record<string, string> = {
  RUNNING: '진행 중', PAUSED: '정지(대기)', MET: '달성', BREACHED: '초과', CANCELED: '해제',
}

function dur(min: number): string {
  const m = Math.abs(Math.floor(min))
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간`
  return `${Math.floor(h / 24)}일`
}
function fmt(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function SlaClockPanel({ ticketId }: { ticketId: number }) {
  const [clocks, setClocks] = useState<Clock[] | null>(null)

  useEffect(() => {
    fetch(`/api/tickets/${ticketId}/sla`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setClocks(d?.clocks ?? []))
      .catch(() => setClocks([]))
  }, [ticketId])

  if (!clocks || clocks.length === 0) return null
  const now = Date.now()

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3.5 sm:px-6 sm:py-4">
        <h2 className="text-sm font-semibold text-gray-700">SLA</h2>
        <span className="text-xs text-gray-400">대기(PENDING) 상태에서는 시계가 멈춥니다</span>
      </div>
      <div className="divide-y divide-gray-100">
        {clocks.map((c) => {
          const diffMin = (new Date(c.dueAt).getTime() - now) / 60000
          const paused = Number(c.pausedMs) > 0
          return (
            <div key={`${c.metric}-${c.statusScope ?? ''}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-6">
              <span className="min-w-[6rem] font-medium text-gray-800">
                {METRIC_LABELS[c.metric] ?? c.metric}{c.statusScope ? `(${c.statusScope})` : ''}
              </span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[c.state] ?? ''}`}>
                {STATE_LABELS[c.state] ?? c.state}
              </span>
              <span className="text-xs text-gray-500">목표 {dur(c.thresholdMin)}</span>
              <span className="text-xs text-gray-500">기한 {fmt(c.dueAt)}</span>
              {c.state === 'RUNNING' && (
                <span className={`text-xs font-medium ${diffMin < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                  {diffMin < 0 ? `${dur(diffMin)} 초과` : `${dur(diffMin)} 남음`}
                </span>
              )}
              {c.state === 'BREACHED' && <span className="text-xs font-medium text-red-600">{dur(diffMin)} 초과</span>}
              {c.state === 'MET' && <span className="text-xs text-green-600">달성 {fmt(c.satisfiedAt)}</span>}
              {paused && <span className="text-xs text-gray-400">정지 누적 {dur(Number(c.pausedMs) / 60000)}</span>}
              {c.policyName && <span className="ml-auto text-[11px] text-gray-400">{c.policyName}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
