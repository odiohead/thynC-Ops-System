/**
 * 채널·라우팅 규칙 수정·삭제 (1.1 P3)
 *
 * PUT/DELETE `?kind=channel|route` — 하나의 라우트에서 두 리소스를 다룬다(설정 화면이 한 탭이므로).
 * 채널 삭제 시 그 채널을 쓰는 규칙은 cascade로 함께 삭제된다(발송 대상 없는 규칙을 남기지 않는다).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { NOTIFY_ROUTE_EVENTS, MENTION_MODES, DEFAULT_DIGEST_OPTS } from '@/lib/notify-routes'
import { SLA_METRICS } from '@/lib/sla'
import { TICKET_STATUSES, TICKET_SEVERITIES } from '@/lib/slaSettings'

function kindOf(request: NextRequest): 'channel' | 'route' | null {
  const k = new URL(request.url).searchParams.get('kind')
  return k === 'channel' || k === 'route' ? k : null
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  const kind = kindOf(request)
  if (isNaN(id) || !kind) return NextResponse.json({ error: 'kind(channel|route)와 ID가 필요합니다.' }, { status: 400 })

  const body = await request.json()

  if (kind === 'channel') {
    const before = await prisma.notifyChannel.findUnique({ where: { id } })
    if (!before) return NextResponse.json({ error: '채널을 찾을 수 없습니다.' }, { status: 404 })
    const updated = await prisma.notifyChannel.update({
      where: { id },
      data: {
        ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
        ...(typeof body.slackChannelId === 'string' && body.slackChannelId.trim() ? { slackChannelId: body.slackChannelId.trim() } : {}),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
        ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
        ...(Number.isFinite(body.sortOrder) ? { sortOrder: Math.floor(body.sortOrder) } : {}),
      },
    })
    await logAudit({
      req: request, actor: auditActorFromJWT(user), action: 'UPDATE',
      resource: 'setting:notify-channel', resourceId: id, resourceLabel: updated.name, before, after: updated,
    })
    return NextResponse.json({ channel: updated })
  }

  // route
  const before = await prisma.notifyRoute.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '규칙을 찾을 수 없습니다.' }, { status: 404 })

  const arr = (v: unknown, fb: string[]): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fb)
  const nums = (v: unknown, fb: number[]): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : fb)

  const eventType = typeof body.eventType === 'string' && (NOTIFY_ROUTE_EVENTS as readonly string[]).includes(body.eventType)
    ? body.eventType
    : before.eventType

  const digestHour =
    body.digestHour === null
      ? null
      : typeof body.digestHour === 'number' && body.digestHour >= 0 && body.digestHour <= 23
        ? Math.floor(body.digestHour)
        : before.digestHour

  if (eventType === 'DAILY_DIGEST' && digestHour == null) {
    return NextResponse.json({ error: '일일 요약 규칙은 발송 시각(0~23시, KST)이 필요합니다.' }, { status: 400 })
  }

  const updated = await prisma.notifyRoute.update({
    where: { id },
    data: {
      ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
      eventType,
      ...(Number.isFinite(body.channelId) ? { channelId: Math.floor(body.channelId) } : {}),
      refTypes: arr(body.refTypes, before.refTypes),
      queueIds: nums(body.queueIds, before.queueIds),
      ctiIds: nums(body.ctiIds, before.ctiIds),
      severities: arr(body.severities, before.severities).filter((x) => TICKET_SEVERITIES.includes(x)),
      statusTo: arr(body.statusTo, before.statusTo).filter((x) => TICKET_STATUSES.includes(x)),
      metrics: arr(body.metrics, before.metrics).filter((x) => (SLA_METRICS as readonly string[]).includes(x)),
      ...((MENTION_MODES as readonly string[]).includes(body.mentionMode) ? { mentionMode: body.mentionMode } : {}),
      digestHour: eventType === 'DAILY_DIGEST' ? digestHour : null,
      digestOpts: eventType === 'DAILY_DIGEST' ? (body.digestOpts ?? before.digestOpts ?? DEFAULT_DIGEST_OPTS) : null,
      ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
      ...(Number.isFinite(body.sortOrder) ? { sortOrder: Math.floor(body.sortOrder) } : {}),
    },
    include: { channel: { select: { id: true, name: true, isActive: true } } },
  })

  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE',
    resource: 'setting:notify-route', resourceId: id, resourceLabel: updated.name, before, after: updated,
  })
  return NextResponse.json({ route: updated })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  const kind = kindOf(request)
  if (isNaN(id) || !kind) return NextResponse.json({ error: 'kind(channel|route)와 ID가 필요합니다.' }, { status: 400 })

  if (kind === 'channel') {
    const before = await prisma.notifyChannel.findUnique({ where: { id }, include: { _count: { select: { routes: true } } } })
    if (!before) return NextResponse.json({ error: '채널을 찾을 수 없습니다.' }, { status: 404 })
    await prisma.notifyChannel.delete({ where: { id } }) // 규칙은 cascade
    await logAudit({
      req: request, actor: auditActorFromJWT(user), action: 'DELETE',
      resource: 'setting:notify-channel', resourceId: id,
      resourceLabel: `${before.name} (규칙 ${before._count.routes}건 동반 삭제)`, before,
    })
    return NextResponse.json({ ok: true, deletedRoutes: before._count.routes })
  }

  const before = await prisma.notifyRoute.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '규칙을 찾을 수 없습니다.' }, { status: 404 })
  await prisma.notifyRoute.delete({ where: { id } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'DELETE',
    resource: 'setting:notify-route', resourceId: id, resourceLabel: before.name, before,
  })
  return NextResponse.json({ ok: true })
}
