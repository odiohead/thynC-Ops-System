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
import { AS_INTAKE_MODES, AS_SHEET_MODES, CHANNELTALK_AS_INTAKE_KEY, CHANNELTALK_AS_INTAKE_CUTOVER_KEY, CHANNELTALK_AS_SHEET_MODE_KEY } from '@/lib/channeltalk/asIntakeShared'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  const settingRows = await prisma.appSetting.findMany({ where: { key: { in: [CHANNELTALK_VOC_PROMOTE_KEY, CHANNELTALK_VOC_CUTOVER_KEY, CHANNELTALK_VOC_RESCAN_HOURS_KEY, CHANNELTALK_VOC_LAST_RESCAN_KEY, CHANNELTALK_AS_INTAKE_KEY, CHANNELTALK_AS_INTAKE_CUTOVER_KEY, CHANNELTALK_AS_SHEET_MODE_KEY] } } })
  const setting = Object.fromEntries(settingRows.map((r) => [r.key, r.value]))
  const [asPending, asLinked] = await Promise.all([prisma.asIntakeLink.count({ where: { state: 'PENDING' } }), prisma.asIntakeLink.count({ where: { state: 'LINKED' } })])
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
    asIntake: setting[CHANNELTALK_AS_INTAKE_KEY] ?? 'off',
    asIntakeCutover: setting[CHANNELTALK_AS_INTAKE_CUTOVER_KEY] ?? '',
    sheetMode: setting[CHANNELTALK_AS_SHEET_MODE_KEY] ?? 'create',
    runs,
    stats: {
      vocLinked, asPending, asLinked,
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
  const current = async (key: string) => (await prisma.appSetting.findUnique({ where: { key } }))?.value ?? ''
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  // 컷오버 없이 ON 저장 금지 (2026-09-29 소급 생성 사건 재발 방지 — VOC·AS 공통)
  if (body.cutover !== undefined) {
    const v = String(body.cutover ?? '').trim()
    if (v && !isDate(v)) return NextResponse.json({ error: 'cutover는 YYYY-MM-DD 형식' }, { status: 400 })
  }
  const promoteOn = body.promote !== undefined ? body.promote === true || body.promote === 'on' : (await current(CHANNELTALK_VOC_PROMOTE_KEY)) === 'on'
  const vocCutover = body.cutover !== undefined ? String(body.cutover ?? '').trim() : await current(CHANNELTALK_VOC_CUTOVER_KEY)
  if (promoteOn && !isDate(vocCutover)) return NextResponse.json({ error: 'VOC 자동 승격을 켜려면 컷오버 일자가 필요합니다.' }, { status: 400 })
  if (body.promote !== undefined) await upsert(CHANNELTALK_VOC_PROMOTE_KEY, promoteOn ? 'on' : 'off')
  if (body.cutover !== undefined) await upsert(CHANNELTALK_VOC_CUTOVER_KEY, vocCutover)
  // AS 인입 (as_channeltalk_intake_design.md §4.1)
  if (body.asIntake !== undefined && !(AS_INTAKE_MODES as readonly string[]).includes(String(body.asIntake))) return NextResponse.json({ error: `asIntake는 ${AS_INTAKE_MODES.join(', ')} 중 하나` }, { status: 400 })
  if (body.asIntakeCutover !== undefined && String(body.asIntakeCutover).trim() && !isDate(String(body.asIntakeCutover).trim())) return NextResponse.json({ error: 'asIntakeCutover는 YYYY-MM-DD 형식' }, { status: 400 })
  const asMode = body.asIntake !== undefined ? String(body.asIntake) : await current(CHANNELTALK_AS_INTAKE_KEY)
  const asCutover = body.asIntakeCutover !== undefined ? String(body.asIntakeCutover).trim() : await current(CHANNELTALK_AS_INTAKE_CUTOVER_KEY)
  if (asMode === 'on' && !isDate(asCutover)) return NextResponse.json({ error: 'AS 인입을 켜려면 컷오버 일자가 필요합니다.' }, { status: 400 })
  if (body.asIntake !== undefined) await upsert(CHANNELTALK_AS_INTAKE_KEY, asMode)
  if (body.asIntakeCutover !== undefined) await upsert(CHANNELTALK_AS_INTAKE_CUTOVER_KEY, asCutover)
  if (body.sheetMode !== undefined) {
    if (!(AS_SHEET_MODES as readonly string[]).includes(String(body.sheetMode))) return NextResponse.json({ error: `sheetMode는 ${AS_SHEET_MODES.join(', ')} 중 하나` }, { status: 400 })
    await upsert(CHANNELTALK_AS_SHEET_MODE_KEY, String(body.sheetMode))
  }
  if (body.rescanHours !== undefined) {
    const v = String(body.rescanHours)
    if (v !== 'off' && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 168)) return NextResponse.json({ error: 'rescanHours는 1~168 또는 off' }, { status: 400 })
    await upsert(CHANNELTALK_VOC_RESCAN_HOURS_KEY, v)
  }
  startChanneltalkVocScheduler(interval)
  return NextResponse.json({ interval, message: '설정이 저장되었습니다.' })
}
