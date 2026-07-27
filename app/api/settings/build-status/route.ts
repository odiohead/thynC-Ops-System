import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { MAPPABLE_TICKET_STATUSES } from '@/lib/ticket-shared'

export async function GET() {
  const [buildStatuses, grouped] = await Promise.all([
    prisma.buildStatus.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.project.groupBy({ by: ['buildStatusId'], _count: { id: true } }),
  ])

  const usageMap = new Map(
    grouped
      .filter((g) => g.buildStatusId !== null)
      .map((g) => [g.buildStatusId!, g._count.id])
  )

  return NextResponse.json({
    buildStatuses: buildStatuses.map((bs) => ({
      ...bs,
      usageCount: usageMap.get(bs.id) ?? 0,
    })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { label, color, sortOrder, ticketStatus } = await request.json()

  if (!label?.trim()) {
    return NextResponse.json({ error: '상태명을 입력해주세요.' }, { status: 400 })
  }

  // 티켓 상태 매핑 필수 (ticket_status_map_design.md §6 — 라벨 문자열 매칭 폴백에 기대지 않게)
  if (!ticketStatus || !MAPPABLE_TICKET_STATUSES.includes(ticketStatus)) {
    return NextResponse.json({ error: '티켓 상태 매핑을 선택해주세요.' }, { status: 400 })
  }

  const buildStatus = await prisma.buildStatus.create({
    data: { label: label.trim(), color: color ?? null, sortOrder: sortOrder ?? 0, ticketStatus },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:build_status',
    resourceId: buildStatus.id,
    resourceLabel: buildStatus.label,
    after: buildStatus,
  })

  return NextResponse.json({ buildStatus }, { status: 201 })
}
