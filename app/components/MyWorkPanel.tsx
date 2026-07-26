'use client'

/**
 * 첫 화면 개인화 블록 — My Work (1.1 P6 — §7.1)
 *
 * 기존 전사 KPI 위에 "나의 일"을 얹는다. SLA 초과를 시스템 안에서 인지하는 1차 경로(R9).
 * 담당 티켓도 그룹 멤버십도 없는 계정(대웅·무관 계정)에는 **블록 자체를 렌더하지 않는다** —
 * 0건 카드만 나열하면 소음이 된다.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface MeDashboard {
  hasWork: boolean
  myTickets: { open: number; assigned: number; inProgress: number; pending: number; total: number }
  slaRisk: {
    overdueCount: number
    warningCount: number
    items: { ticketCode: string; title: string; hospitalName: string | null; severity: string; kind: string; label: string; link: string }[]
  }
  unassignedInMyQueues: number
  myQueueCount: number
  notifications: { id: string; kind: string; title: string; link: string; readAt: string | null; createdAt: string }[]
  unreadCount: number
}

const KIND_ICON: Record<string, string> = {
  TICKET_ASSIGNED: '🎫', TICKET_UNASSIGNED_IN_MY_QUEUE: '📥', TICKET_STATUS_CHANGED: '🔄',
  TICKET_COMMENT: '💬', SLA_WARNING: '⏳', SLA_BREACH: '⏰',
}

function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(1, m)}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

function Tile({ label, value, href, accent }: { label: string; value: number; href: string; accent?: 'red' | 'amber' }) {
  const color =
    accent === 'red' ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
    : accent === 'amber' ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
    : 'border-border bg-card'
  const num = accent === 'red' ? 'text-red-600 dark:text-red-400' : accent === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
  return (
    <Link href={href} className={`block rounded-xl border p-3 transition-shadow hover:shadow-md ${color}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-bold sm:text-2xl ${num}`}>{value}</p>
    </Link>
  )
}

export default function MyWorkPanel() {
  const [data, setData] = useState<MeDashboard | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/me/dashboard', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded || !data || !data.hasWork) return null

  const { myTickets, slaRisk } = data

  return (
    <section className="mb-5 rounded-2xl border border-border bg-card/60 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">내 업무</h2>
        <Link href="/tickets" className="text-xs text-blue-500 hover:underline">My Tickets →</Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile label="내 티켓" value={myTickets.total} href="/tickets" />
        <Tile label="SLA 초과" value={slaRisk.overdueCount} href="/tickets?sla=overdue" accent={slaRisk.overdueCount > 0 ? 'red' : undefined} />
        <Tile label="SLA 임박" value={slaRisk.warningCount} href="/tickets?sla=warning" accent={slaRisk.warningCount > 0 ? 'amber' : undefined} />
        <Tile label="내 그룹 미배정" value={data.unassignedInMyQueues} href="/tickets?unassigned=true" />
      </div>

      {slaRisk.items.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-foreground">⚠ SLA 위험</span>
            <span className="ml-1 text-xs text-muted-foreground">기한을 넘겼거나 임박한 내 티켓</span>
          </div>
          <ul className="divide-y divide-border">
            {slaRisk.items.map((r) => (
              <li key={`${r.ticketCode}-${r.label}`}>
                <Link href={r.link} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 hover:bg-accent">
                  <span className="font-mono text-xs text-blue-600">{r.ticketCode}</span>
                  <span className="text-xs text-muted-foreground">{r.severity}</span>
                  <span className={`text-xs font-medium ${r.kind === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>{r.label}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {[r.hospitalName, r.title].filter(Boolean).join(' — ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.notifications.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-foreground">
              🔔 최근 알림 {data.unreadCount > 0 && <span className="text-blue-600">({data.unreadCount} 미읽음)</span>}
            </span>
            <Link href="/notifications" className="text-xs text-blue-500 hover:underline">알림함 →</Link>
          </div>
          <ul className="divide-y divide-border">
            {data.notifications.map((n) => (
              <li key={n.id}>
                <Link href={n.link} className={`flex items-center gap-2 px-3 py-2 hover:bg-accent ${n.readAt ? '' : 'bg-blue-50/40 dark:bg-blue-900/10'}`}>
                  <span className="shrink-0 text-sm">{KIND_ICON[n.kind] ?? '🔔'}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">{n.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{relTime(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
