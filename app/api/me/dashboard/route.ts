/**
 * 개인 대시보드 데이터 (1.1 P6 — §7.2)
 *
 * 첫 화면 My Work 블록이 쓰는 **1콜** 엔드포인트.
 * 기존 대시보드가 이미 5콜을 쓰므로 개인 영역에서 콜을 더 늘리지 않는다.
 *
 * 반환: 내 티켓 상태별 카운트 / SLA 위험(초과·임박) / 내 그룹 미배정 수 / 최근 알림
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { findSlaRisk } from '@/lib/sla'
import { TicketStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

const OPEN_STATUSES: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING']

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [byStatus, myQueues, risk, notifications, unreadCount] = await Promise.all([
    // 내가 담당(owner)인 열린 티켓 상태별
    prisma.ticket.groupBy({
      by: ['status'],
      where: { ownerId: user.userId, status: { in: OPEN_STATUSES } },
      _count: { _all: true },
    }),
    // 내가 멤버인 Assignment Group
    prisma.ticketQueueMember.findMany({ where: { userId: user.userId }, select: { queueId: true } }),
    // SLA 위험 — 내 티켓만
    findSlaRisk({ ownerId: user.userId, includeWarning: true }),
    prisma.notification.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, kind: true, title: true, link: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId: user.userId, readAt: null } }),
  ])

  const queueIds = myQueues.map((q) => q.queueId)
  // 내 그룹의 미배정 티켓 — 그룹 멤버가 아니면 0 (멤버십이 없으면 "내 큐"라는 개념이 성립하지 않는다)
  const unassignedInMyQueues =
    queueIds.length > 0
      ? await prisma.ticket.count({
          where: { queueId: { in: queueIds }, ownerId: null, status: { in: OPEN_STATUSES } },
        })
      : 0

  const counts = { open: 0, assigned: 0, inProgress: 0, pending: 0, total: 0 }
  for (const row of byStatus) {
    const n = row._count._all
    counts.total += n
    if (row.status === 'OPEN') counts.open = n
    else if (row.status === 'ASSIGNED') counts.assigned = n
    else if (row.status === 'IN_PROGRESS') counts.inProgress = n
    else if (row.status === 'PENDING') counts.pending = n
  }

  const overdue = risk.filter((r) => r.kind === 'overdue')
  const warning = risk.filter((r) => r.kind === 'warning')

  return NextResponse.json({
    // 개인 블록 노출 여부 판단용 — 담당 티켓도 그룹 멤버십도 없으면 화면에서 숨긴다
    hasWork: counts.total > 0 || queueIds.length > 0 || risk.length > 0,
    myTickets: counts,
    slaRisk: {
      overdueCount: overdue.length,
      warningCount: warning.length,
      items: [...overdue, ...warning].slice(0, 5).map((r) => ({
        ticketCode: r.ticketCode,
        title: r.title,
        hospitalName: r.hospitalName,
        severity: r.severity,
        kind: r.kind,
        label: r.label,
        link: `/tickets/${r.ticketCode}`,
      })),
    },
    unassignedInMyQueues,
    myQueueCount: queueIds.length,
    notifications: notifications.map((n) => ({ ...n, id: String(n.id) })),
    unreadCount,
  })
}
