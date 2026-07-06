import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** Slack 알림 발송 이력 조회 (ADMIN 이상) */
export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? ''
  const eventType = searchParams.get('eventType') ?? ''
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50') || 50, 200)

  const logs = await prisma.notificationLog.findMany({
    where: {
      ...(status && ['sent', 'failed', 'skipped'].includes(status) ? { status } : {}),
      ...(eventType && ['task_created', 'task_status_changed', 'delayed'].includes(eventType) ? { eventType } : {}),
    },
    orderBy: { id: 'desc' },
    take: limit,
    select: {
      id: true,
      eventType: true,
      taskType: true,
      refCode: true,
      targetType: true,
      targetId: true,
      status: true,
      error: true,
      payload: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ logs })
}
