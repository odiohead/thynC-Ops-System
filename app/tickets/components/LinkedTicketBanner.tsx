'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { TicketStatus } from '@prisma/client'
import TicketStatusBadge from './TicketStatusBadge'

interface LinkedTicket {
  id: number
  ticketCode: string
  status: TicketStatus
}

/** 도메인 상세 화면 상단의 연결 티켓 배너 — ticketId로 자체 조회 (숫자 id 허용 GET) */
export default function LinkedTicketBanner({ ticketId }: { ticketId: number }) {
  const [ticket, setTicket] = useState<LinkedTicket | null>(null)

  useEffect(() => {
    fetch(`/api/tickets/${ticketId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ticket) setTicket(d.ticket) })
  }, [ticketId])

  if (!ticket) return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
      <span className="font-medium">티켓:</span>
      <span className="font-mono text-xs">{ticket.ticketCode}</span>
      <TicketStatusBadge status={ticket.status} />
      <Link
        href={`/tickets/${ticket.ticketCode}`}
        className="ml-auto shrink-0 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-700 dark:bg-transparent dark:text-blue-300 dark:hover:bg-blue-900/40"
      >
        보기 →
      </Link>
    </div>
  )
}
