/**
 * 채널톡 상담 원천 적재 설정 (voc_channeltalk_intake_design.md §5.1) — ADMIN 이상
 * GET: 주기·활성 주기·키 설정 여부·백필 상태·최근 실행 로그·DB 현황 / PUT: 주기 저장 + 스케줄러 재시작
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ChanneltalkClient } from '@/lib/channeltalk/client'
import { getChanneltalkBackfillState, isChanneltalkVocSyncRunning } from '@/lib/channeltalk/vocSync'
import { startChanneltalkVocScheduler, getChanneltalkVocInterval } from '@/lib/channeltalk-voc-scheduler'
import { CHANNELTALK_VOC_INTERVAL_KEY, CHANNELTALK_VOC_INTERVALS, CHANNELTALK_VOC_MAX_CALLS_KEY } from '@/lib/channeltalk/shared'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  const [intervalRow, maxCallsRow, backfill, runs, byState, messages, users, lastSynced] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: CHANNELTALK_VOC_INTERVAL_KEY } }),
    prisma.appSetting.findUnique({ where: { key: CHANNELTALK_VOC_MAX_CALLS_KEY } }),
    getChanneltalkBackfillState(),
    prisma.channeltalkSyncRun.findMany({ orderBy: { id: 'desc' }, take: 10 }),
    prisma.channeltalkUserChat.groupBy({ by: ['state'], _count: { _all: true } }),
    prisma.channeltalkMessage.count(),
    prisma.channeltalkUser.count(),
    prisma.channeltalkUserChat.aggregate({ _max: { lastSyncedAt: true } }),
  ])
  return NextResponse.json({
    interval: intervalRow?.value || 'off',
    activeInterval: getChanneltalkVocInterval(),
    maxCalls: Number(maxCallsRow?.value) || 200,
    configured: ChanneltalkClient.isConfigured(),
    running: isChanneltalkVocSyncRunning(),
    backfill,
    runs,
    stats: {
      chats: Object.fromEntries(byState.map((r) => [r.state, r._count._all])),
      messages, users,
      lastSyncedAt: lastSynced._max.lastSyncedAt,
    },
  })
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const interval = String(body.interval ?? '')
  if (!(CHANNELTALK_VOC_INTERVALS as readonly string[]).includes(interval)) {
    return NextResponse.json({ error: `interval은 ${CHANNELTALK_VOC_INTERVALS.join(', ')} 중 하나여야 합니다.` }, { status: 400 })
  }
  await prisma.appSetting.upsert({ where: { key: CHANNELTALK_VOC_INTERVAL_KEY }, update: { value: interval }, create: { key: CHANNELTALK_VOC_INTERVAL_KEY, value: interval } })
  if (body.maxCalls !== undefined) {
    const n = Number(body.maxCalls)
    if (!Number.isInteger(n) || n < 10 || n > 5000) return NextResponse.json({ error: 'maxCalls는 10~5000 정수' }, { status: 400 })
    await prisma.appSetting.upsert({ where: { key: CHANNELTALK_VOC_MAX_CALLS_KEY }, update: { value: String(n) }, create: { key: CHANNELTALK_VOC_MAX_CALLS_KEY, value: String(n) } })
  }
  startChanneltalkVocScheduler(interval)
  return NextResponse.json({ interval, message: '설정이 저장되었습니다.' })
}
