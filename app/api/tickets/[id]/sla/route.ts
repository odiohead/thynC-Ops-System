/**
 * 티켓 SLA 시계 조회 (1.1 P6 — 상세 SLA 패널용)
 * 시계는 파생 데이터라 읽기 전용. 티켓을 볼 수 있는 사용자면 조회 가능.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = params.id
  const ticket = /^\d+$/.test(raw)
    ? await prisma.ticket.findUnique({ where: { id: parseInt(raw) }, select: { id: true } })
    : await prisma.ticket.findUnique({ where: { ticketCode: raw }, select: { id: true } })
  if (!ticket) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })

  const clocks = await prisma.ticketSlaClock.findMany({
    where: { ticketId: ticket.id, state: { not: 'CANCELED' } },
    orderBy: [{ state: 'asc' }, { dueAt: 'asc' }],
    select: {
      metric: true, statusScope: true, state: true, thresholdMin: true,
      startedAt: true, dueAt: true, pausedMs: true, satisfiedAt: true, breachedAt: true,
      policy: { select: { name: true } },
    },
  })

  return NextResponse.json({
    clocks: clocks.map((c) => ({
      ...c,
      pausedMs: String(c.pausedMs), // BigInt → 문자열 (JSON 직렬화)
      policyName: c.policy?.name ?? null,
      policy: undefined,
    })),
  })
}
