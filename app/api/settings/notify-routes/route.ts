/**
 * Slack 채널·라우팅 규칙 설정 API (1.1 P3 — §5.1·§5.5 탭②)
 *
 * GET  : 채널·규칙 목록 + 편집 마스터(이벤트 종류·멘션 모드·Assignment Group·CTI·상태·Sev·metric)
 * POST : `{ kind: 'channel' | 'route' | 'test', ... }` — 채널 추가 / 규칙 추가 / 채널 연결 테스트 발송
 *
 * 권한: ADMIN 이상
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { dispatchToChannel } from '@/lib/notify'
import { NOTIFY_ROUTE_EVENTS, MENTION_MODES, DEFAULT_DIGEST_OPTS } from '@/lib/notify-routes'
import { SLA_METRICS } from '@/lib/sla'
import { TICKET_STATUSES, TICKET_SEVERITIES } from '@/lib/slaSettings'

/** 규칙 입력 정규화 — 배열 축은 빈 배열 = 전체 */
function routeData(body: Record<string, unknown>) {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [])
  const mention = (MENTION_MODES as readonly string[]).includes(body.mentionMode as string) ? (body.mentionMode as string) : 'none'
  const hourRaw = body.digestHour
  const digestHour =
    typeof hourRaw === 'number' && Number.isFinite(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? Math.floor(hourRaw) : null

  return {
    refTypes: arr(body.refTypes),
    queueIds: nums(body.queueIds),
    ctiIds: nums(body.ctiIds),
    severities: arr(body.severities).filter((x) => TICKET_SEVERITIES.includes(x)),
    statusTo: arr(body.statusTo).filter((x) => TICKET_STATUSES.includes(x)),
    metrics: arr(body.metrics).filter((x) => (SLA_METRICS as readonly string[]).includes(x)),
    mentionMode: mention,
    digestHour,
    digestOpts: (body.digestOpts ?? undefined) as object | undefined,
    isActive: body.isActive !== false,
    sortOrder: Number.isFinite(body.sortOrder) ? Math.floor(body.sortOrder as number) : 50,
  }
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [channels, routes, queues, ctiNodes] = await Promise.all([
    prisma.notifyChannel.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { routes: true } } },
    }),
    prisma.notifyRoute.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { channel: { select: { id: true, name: true, isActive: true } } },
    }),
    prisma.ticketQueue.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.ticketCti.findMany({ select: { id: true, parentId: true, level: true, name: true }, orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }] }),
  ])

  return NextResponse.json({
    channels,
    routes,
    masters: {
      events: NOTIFY_ROUTE_EVENTS,
      mentionModes: MENTION_MODES,
      metrics: SLA_METRICS,
      statuses: TICKET_STATUSES,
      severities: TICKET_SEVERITIES,
      queues,
      ctiNodes,
      defaultDigestOpts: DEFAULT_DIGEST_OPTS,
    },
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()

  // ── 채널 연결 테스트 발송 — 잘못된 채널에 업무 정보가 새는 사고를 등록 시점에 막는다
  if (body.kind === 'test') {
    const id = parseInt(String(body.channelId))
    const ch = await prisma.notifyChannel.findUnique({ where: { id } })
    if (!ch) return NextResponse.json({ error: '채널을 찾을 수 없습니다.' }, { status: 404 })
    await dispatchToChannel({
      intendedChannel: ch.slackChannelId,
      channelName: ch.name,
      eventType: 'task_created',
      text: `:white_check_mark: 연결 테스트 — *${ch.name}* 채널로 알림이 도착했습니다. (${user.name})`,
    })
    return NextResponse.json({ ok: true, note: 'test/off 모드에서는 실제 채널 대신 테스트 채널로 라우팅되거나 미발송됩니다.' })
  }

  // ── 채널 추가
  if (body.kind === 'channel') {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const slackChannelId = typeof body.slackChannelId === 'string' ? body.slackChannelId.trim() : ''
    if (!name) return NextResponse.json({ error: '채널 표시명을 입력하세요.' }, { status: 400 })
    if (!slackChannelId) return NextResponse.json({ error: 'Slack 채널 ID를 입력하세요. (예: C09XXXXXXXX)' }, { status: 400 })
    const dup = await prisma.notifyChannel.findUnique({ where: { name } })
    if (dup) return NextResponse.json({ error: '이미 존재하는 채널 표시명입니다.' }, { status: 409 })

    const created = await prisma.notifyChannel.create({
      data: {
        name,
        slackChannelId,
        description: typeof body.description === 'string' ? body.description : null,
        sortOrder: Number.isFinite(body.sortOrder) ? Math.floor(body.sortOrder) : 50,
        isActive: body.isActive !== false,
      },
    })
    await logAudit({
      req: request, actor: auditActorFromJWT(user), action: 'CREATE',
      resource: 'setting:notify-channel', resourceId: created.id, resourceLabel: created.name, after: created,
    })
    return NextResponse.json({ channel: created }, { status: 201 })
  }

  // ── 규칙 추가
  if (body.kind === 'route') {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const eventType = String(body.eventType ?? '')
    const channelId = parseInt(String(body.channelId))
    if (!name) return NextResponse.json({ error: '규칙 이름을 입력하세요.' }, { status: 400 })
    if (!(NOTIFY_ROUTE_EVENTS as readonly string[]).includes(eventType)) {
      return NextResponse.json({ error: `알 수 없는 이벤트: ${eventType}` }, { status: 400 })
    }
    const ch = await prisma.notifyChannel.findUnique({ where: { id: channelId } })
    if (!ch) return NextResponse.json({ error: '채널을 선택하세요.' }, { status: 400 })

    const data = routeData(body)
    // 다이제스트 규칙은 발송 시각이 없으면 아무 일도 일어나지 않는다 → 입구에서 막는다
    if (eventType === 'DAILY_DIGEST' && data.digestHour == null) {
      return NextResponse.json({ error: '일일 요약 규칙은 발송 시각(0~23시, KST)을 지정해야 합니다.' }, { status: 400 })
    }
    if (eventType !== 'DAILY_DIGEST' && data.digestHour != null) {
      return NextResponse.json({ error: '발송 시각은 일일 요약(DAILY_DIGEST) 규칙에만 지정할 수 있습니다.' }, { status: 400 })
    }

    const created = await prisma.notifyRoute.create({
      data: {
        name, eventType, channelId,
        ...data,
        // Prisma JSON 컬럼은 null을 별도 타입으로 다뤄 undefined(미설정)로 넘긴다
        digestOpts: eventType === 'DAILY_DIGEST' ? ((data.digestOpts ?? DEFAULT_DIGEST_OPTS) as object) : undefined,
      },
      include: { channel: { select: { id: true, name: true, isActive: true } } },
    })
    await logAudit({
      req: request, actor: auditActorFromJWT(user), action: 'CREATE',
      resource: 'setting:notify-route', resourceId: created.id,
      resourceLabel: `${created.name} (${eventType} → ${ch.name})`, after: created,
    })
    return NextResponse.json({ route: created }, { status: 201 })
  }

  return NextResponse.json({ error: 'kind는 channel | route | test 중 하나여야 합니다.' }, { status: 400 })
}
