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
import { CHANNELTALK_VOC_INTERVAL_KEY, CHANNELTALK_VOC_INTERVALS, CHANNELTALK_VOC_MAX_CALLS_KEY, CHANNELTALK_VOC_PROMOTE_KEY, CHANNELTALK_VOC_CUTOVER_KEY, CHANNELTALK_VOC_RESCAN_HOURS_KEY, CHANNELTALK_VOC_LAST_RESCAN_KEY } from '@/lib/channeltalk/shared'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  const settingRows = await prisma.appSetting.findMany({ where: { key: { in: [CHANNELTALK_VOC_PROMOTE_KEY, CHANNELTALK_VOC_CUTOVER_KEY, CHANNELTALK_VOC_RESCAN_HOURS_KEY, CHANNELTALK_VOC_LAST_RESCAN_KEY] } } })
  const setting = Object.fromEntries(settingRows.map((r) => [r.key, r.value]))
  const [intervalRow, maxCallsRow, backfill, runs, byState, messages, users, lastSynced, vocLinked] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: CHANNELTALK_VOC_INTERVAL_KEY } }),
    prisma.appSetting.findUnique({ where: { key: CHANNELTALK_VOC_MAX_CALLS_KEY } }),
    getChanneltalkBackfillState(),
    prisma.channeltalkSyncRun.findMany({ orderBy: { id: 'desc' }, take: 10 }),
    prisma.channeltalkUserChat.groupBy({ by: ['state'], _count: { _all: true } }),
    prisma.channeltalkMessage.count(),
    prisma.channeltalkUser.count(),
    prisma.channeltalkUserChat.aggregate({ _max: { lastSyncedAt: true } }),
    prisma.vocChanneltalkChat.count(),
  ])
  return NextResponse.json({
    interval: intervalRow?.value || 'off',
    activeInterval: getChanneltalkVocInterval(),
    maxCalls: Number(maxCallsRow?.value) || 200,
    configured: ChanneltalkClient.isConfigured(),
    running: isChanneltalkVocSyncRunning(),
    backfill,
    promote: setting[CHANNELTALK_VOC_PROMOTE_KEY] === 'on',
    cutover: setting[CHANNELTALK_VOC_CUTOVER_KEY] ?? '',
    rescanHours: setting[CHANNELTALK_VOC_RESCAN_HOURS_KEY] ?? '24',
    lastRescanAt: setting[CHANNELTALK_VOC_LAST_RESCAN_KEY] ?? null,
    runs,
    stats: {
      vocLinked,
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
  const upsert = (key: string, value: string) => prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  if (body.promote !== undefined) await upsert(CHANNELTALK_VOC_PROMOTE_KEY, body.promote === true || body.promote === 'on' ? 'on' : 'off')
  if (body.cutover !== undefined) {
    const v = String(body.cutover ?? '').trim()
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return NextResponse.json({ error: 'cutover는 YYYY-MM-DD 형식' }, { status: 400 })
    await upsert(CHANNELTALK_VOC_CUTOVER_KEY, v)
  }
  if (body.rescanHours !== undefined) {
    const v = String(body.rescanHours)
    if (v !== 'off' && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 168)) return NextResponse.json({ error: 'rescanHours는 1~168 또는 off' }, { status: 400 })
    await upsert(CHANNELTALK_VOC_RESCAN_HOURS_KEY, v)
  }
  startChanneltalkVocScheduler(interval)
  return NextResponse.json({ interval, message: '설정이 저장되었습니다.' })
}
