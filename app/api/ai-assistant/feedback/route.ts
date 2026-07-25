import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { checkAiAccess } from '@/lib/ai/access'

export const dynamic = 'force-dynamic'

/**
 * AI 어시스턴트 답변 피드백 (v3 G2)
 * POST: 답변 1건당 1개(messageId UNIQUE, 재전송 시 갱신)
 * GET : 집계 — ADMIN 이상. 벡터DB 도입 판단(설계문서 §6)의 근거 데이터
 */

const VERDICTS = ['good', 'bad']
const REASONS = ['wrong', 'not_found', 'outdated', 'inappropriate']

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = await checkAiAccess(authUser)
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  const body = await request.json().catch(() => null)
  const messageId = typeof body?.messageId === 'string' ? body.messageId : ''
  const verdict = typeof body?.verdict === 'string' ? body.verdict : ''
  const reason = typeof body?.reason === 'string' && body.reason ? body.reason : null
  const comment = typeof body?.comment === 'string' && body.comment.trim() ? body.comment.trim().slice(0, 1000) : null

  if (!messageId || !VERDICTS.includes(verdict)) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  if (reason && !REASONS.includes(reason)) {
    return NextResponse.json({ error: '알 수 없는 사유입니다.' }, { status: 400 })
  }

  // 본인 세션의 메시지에만 피드백 가능
  const message = await prisma.aiChatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, sessionId: true, session: { select: { userId: true } } },
  })
  if (!message) return NextResponse.json({ error: '메시지를 찾을 수 없습니다.' }, { status: 404 })
  if (message.session.userId !== authUser.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const data = {
    sessionId: message.sessionId,
    userId: authUser.userId,
    userName: authUser.name,
    verdict,
    reason: verdict === 'bad' ? reason : null,
    comment: verdict === 'bad' ? comment : null,
  }
  const saved = await prisma.aiFeedback.upsert({
    where: { messageId },
    update: data,
    create: { messageId, ...data },
    select: { verdict: true, reason: true },
  })
  return NextResponse.json({ feedback: saved })
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000)
  const rows = await prisma.aiFeedback.groupBy({
    by: ['verdict', 'reason'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  })

  const total = rows.reduce((s, r) => s + r._count._all, 0)
  const good = rows.filter((r) => r.verdict === 'good').reduce((s, r) => s + r._count._all, 0)
  const byReason: Record<string, number> = {}
  for (const r of rows) {
    if (r.verdict === 'bad') byReason[r.reason ?? 'unspecified'] = r._count._all
  }
  const bad = total - good
  const notFound = byReason.not_found ?? 0

  return NextResponse.json({
    periodDays: 90,
    total,
    good,
    bad,
    byReason,
    // 설계문서 §6 벡터DB 도입 기준: "못 찾음" 비율 15% 초과가 2개월 연속
    notFoundRate: total > 0 ? Math.round((notFound / total) * 1000) / 10 : 0,
  })
}
