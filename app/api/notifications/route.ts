/**
 * 내부 알림함 API (1.1 P5 — §6.3)
 *
 * GET   : 내 알림 목록 + 미읽음 수 (`?unread=1&kind=&limit=`)
 * PATCH : 읽음 처리 (`{ids?}` — 없으면 전체)
 *
 * 권한: 로그인 사용자 본인 것만. VIEWER도 참여자로 지정될 수 있어 허용한다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { NOTIFY_KIND_LABELS } from '@/lib/notify-center'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const unreadOnly = sp.get('unread') === '1'
  const kind = sp.get('kind')
  const limit = Math.min(parseInt(sp.get('limit') ?? '30') || 30, 100)

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId: user.userId,
        ...(unreadOnly ? { readAt: null } : {}),
        ...(kind ? { kind } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notification.count({ where: { userId: user.userId, readAt: null } }),
  ])

  return NextResponse.json({
    // BigInt id는 JSON 직렬화가 안 되므로 문자열로 변환
    items: items.map((n) => ({ ...n, id: String(n.id) })),
    unreadCount,
    kindLabels: NOTIFY_KIND_LABELS,
  })
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : []
  const now = new Date()

  const res = await prisma.notification.updateMany({
    where: {
      userId: user.userId, // 본인 것만 — 남의 알림을 읽음 처리할 수 없다
      readAt: null,
      ...(ids.length > 0 ? { id: { in: ids.map((x) => BigInt(x)) } } : {}),
    },
    data: { readAt: now },
  })

  return NextResponse.json({ updated: res.count })
}
