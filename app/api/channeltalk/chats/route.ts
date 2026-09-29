/**
 * 채널톡 상담 원본 목록 (voc_channeltalk_intake_design.md §5.2) — 로그인 사용자(VOC 접수 목록과 같은 게이트)
 * ?voc=linked|eligible|excluded|none(미연결 전체) · state=opened|snoozed|closed|active · from/to(firstAskedAt, KST) · tag · hospital(코드) · match=opscode|name|none · q(첫 질문·고객명·병원명) · page/pageSize
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { evaluateChat, readCutover } from '@/lib/channeltalk/vocPromote'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const where: Prisma.ChanneltalkUserChatWhereInput = {}
  const state = sp.get('state')
  if (state === 'active') where.state = { in: ['opened', 'snoozed'] }
  else if (state) where.state = state
  const from = sp.get('from'); const to = sp.get('to')
  if (from || to) where.firstAskedAt = { ...(from ? { gte: new Date(`${from}T00:00:00+09:00`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999+09:00`) } : {}) }
  const tag = sp.get('tag'); if (tag) where.tags = { has: tag }
  const hospital = sp.get('hospital'); if (hospital) where.hospitalCode = hospital
  const match = sp.get('match'); if (match) where.hospitalMatchSource = match
  const voc = sp.get('voc')
  if (voc === 'linked') where.vocLink = { isNot: null }
  else if (voc === 'excluded') where.vocExcludedAt = { not: null }
  else if (voc === 'none') { where.vocLink = { is: null }; where.vocExcludedAt = null }
  else if (voc === 'eligible') { where.vocLink = { is: null }; where.vocExcludedAt = null; where.firstUserMessageAt = { not: null }; where.managerInitiated = false }
  const q = sp.get('q')?.trim()
  if (q) where.OR = [
    { firstAskText: { contains: q, mode: 'insensitive' } },
    { name: { contains: q, mode: 'insensitive' } },
    { user: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { hospitalNameRaw: { contains: q, mode: 'insensitive' } }] } },
    { hospital: { hospitalName: { contains: q, mode: 'insensitive' } } },
  ]
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 30))

  const [rows, total, tags, managers, summary] = await Promise.all([
    prisma.channeltalkUserChat.findMany({
      where, orderBy: [{ firstAskedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, channelId: true, state: true, assigneeId: true, tags: true, name: true, contactMediumType: true, firstAskText: true,
        firstAskedAt: true, closedAt: true, messageCount: true, hospitalCode: true, hospitalMatchSource: true, hospitalMatchNote: true,
        firstUserMessageAt: true, managerInitiated: true, vocExcludedAt: true, vocLink: { select: { vocId: true, linkReason: true, voc: { select: { vocCode: true } } } },
        user: { select: { id: true, name: true, hospitalNameRaw: true, opsCode: true } },
        hospital: { select: { hospitalCode: true, hospitalName: true } },
      },
    }),
    prisma.channeltalkUserChat.count({ where }),
    prisma.$queryRaw<{ tag: string; n: number }[]>`SELECT t AS tag, count(*)::int AS n FROM channeltalk_user_chats, unnest(tags) t GROUP BY t ORDER BY n DESC, t`,
    prisma.channeltalkManager.findMany({ select: { id: true, name: true } }),
    prisma.$queryRaw<{ active: number; today: number; last_synced: Date | null }[]>`
      SELECT count(*) FILTER (WHERE state IN ('opened','snoozed'))::int AS active,
             count(*) FILTER (WHERE first_asked_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')::int AS today,
             max(last_synced_at) AS last_synced
      FROM channeltalk_user_chats`,
  ])
  const managerName = Object.fromEntries(managers.map((m) => [m.id, m.name ?? m.id]))
  const cutover = await readCutover()
  return NextResponse.json({
    cutover: cutover ? cutover.toISOString() : null,
    chats: rows.map((r) => ({
      ...r,
      assigneeName: r.assigneeId ? managerName[r.assigneeId] ?? r.assigneeId : null,
      vocSkipReason: evaluateChat(r, cutover), // null = 자동 승격 대상
    })),
    total, page, pageSize, tags, summary: summary[0] ?? { active: 0, today: 0, last_synced: null },
  })
}
