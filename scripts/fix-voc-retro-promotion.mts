// 채널톡 → VOC 소급 승격 보정 (2026-09-29, PROD 컷오버 공란 상태로 자동 승격 ON → 과거 상담 1,774건 일괄 생성)
// 사용: npx tsx scripts/fix-voc-retro-promotion.mts [--apply] [--set-cutover=YYYY-MM-DD]   (기본 dry-run)
//  대상 = source CHANNELTALK · auto_created · 티켓 생성시각 − VOC 접수시각 > 24h (소급 생성분. 실시간 승격분은 제외)
//  A. 역순 후속 연결(상담 첫 발화 < VOC 접수시각 — 전체 자동 VOC 대상) 해제 → 그 상담을 독립 VOC로 재생성(silent·noFollowup·skipEval)
//  B. 티켓 created_at·status_changed_at = VOC receivedAt(고객 첫 발화) / 연결 상담 전부 종료면 VOC '종결'(CLOSED)·resolved_at = 상담 종료일,
//     티켓 CLOSED·resolved_at·closed_at·status_changed_at = 상담 종료시각(+status_change 이벤트 via retro_fix) — 자동 종결 배치 미경유. 상담 열려 있으면 created_at만
//  C. --set-cutover 지정 시 AppSetting channeltalk_voc_cutover 기록
// Slack 알림 없음(직접 UPDATE·silent). 멱등 — 재실행 시 이미 보정된 건은 변경 0. PROD는 규칙 5(명시 허락) 적용
import { prisma } from '../lib/prisma'
import { promoteChat } from '../lib/channeltalk/vocPromote'
import { addTicketEvent } from '../lib/ticket'
import { CHANNELTALK_BOT_EMAIL, CHANNELTALK_VOC_CUTOVER_KEY } from '../lib/channeltalk/shared'

const APPLY = process.argv.includes('--apply')
const cutoverArg = process.argv.find((a) => a.startsWith('--set-cutover='))?.split('=')[1]
const DAY = 86400_000
const dateOnly = (d: Date) => new Date(new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)) // KST 일자 (DATE 컬럼)

const bot = await prisma.user.findUnique({ where: { email: CHANNELTALK_BOT_EMAIL }, select: { id: true } })
if (!bot) throw new Error('채널톡 봇 계정 없음')
const [closedStatus, statusMap] = await Promise.all([
  prisma.statusCode.findFirst({ where: { category: 'VOC_STATUS', ticketStatus: 'CLOSED' }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
  prisma.statusCode.findMany({ where: { category: 'VOC_STATUS' }, select: { id: true, ticketStatus: true } }),
])
if (!closedStatus) throw new Error("VOC_STATUS에 CLOSED 매핑 상태('종결')가 없습니다")
const ticketStatusOf = new Map(statusMap.map((s) => [s.id, s.ticketStatus]))

const SELECT = {
  id: true, vocCode: true, receivedAt: true, resolvedAt: true, statusId: true, ticketId: true,
  ticket: { select: { id: true, status: true, createdAt: true, resolvedAt: true, closedAt: true, ownerId: true } },
  channeltalkChats: { select: { id: true, linkReason: true, chat: { select: { id: true, state: true, closedAt: true, firstUserMessageAt: true } } } },
} as const

// ── 대상 식별 ──
const all = await prisma.vocReceipt.findMany({ where: { source: 'CHANNELTALK', autoCreated: true, ticketId: { not: null } }, select: SELECT, orderBy: { id: 'asc' } })
const retro = all.filter((v) => v.ticket && v.ticket.createdAt.getTime() - v.receivedAt.getTime() > DAY)
console.log(`자동 VOC ${all.length}건 중 소급 생성(티켓−접수 > 24h) ${retro.length}건`)

// ── A. 역순 후속 연결 ──
// 역순 후속은 실시간 VOC(진행 중 상담)에 과거 상담이 붙은 형태가 대부분 → 소급분이 아닌 전체 자동 VOC에서 탐색
const reversed = all.flatMap((v) => v.channeltalkChats.filter((l) => l.linkReason === 'AUTO_FOLLOWUP' && l.chat.firstUserMessageAt && l.chat.firstUserMessageAt < v.receivedAt).map((l) => ({ voc: v, link: l })))
console.log(`A. 역순 후속 연결 ${reversed.length}건 → 해제 후 독립 VOC 재생성`)
const recreated: number[] = []
if (APPLY) {
  for (const { voc, link } of reversed.sort((a, b) => a.link.chat.firstUserMessageAt!.getTime() - b.link.chat.firstUserMessageAt!.getTime())) {
    await prisma.vocChanneltalkChat.delete({ where: { id: link.id } })
    const r = await promoteChat(link.chat.id, { actorId: bot.id, skipEval: true, noFollowup: true, silent: true })
    recreated.push(r.vocId)
    console.log(`  ${voc.vocCode} ← 상담 ${link.chat.id} 해제 → ${r.vocCode} 신규`)
  }
}

// ── B. 시각·상태 보정 ──
const targets = APPLY
  ? await prisma.vocReceipt.findMany({ where: { OR: [{ id: { in: retro.map((v) => v.id) } }, { id: { in: recreated } }] }, select: SELECT, orderBy: { id: 'asc' } })
  : retro
let fixCreated = 0, fixClosed = 0, keepOpen = 0, unchanged = 0
for (const v of targets) {
  const t = v.ticket!
  const allClosed = v.channeltalkChats.length > 0 && v.channeltalkChats.every((l) => l.chat.state === 'closed' && l.chat.closedAt)
  const closedAt = allClosed ? new Date(Math.max(...v.channeltalkChats.map((l) => l.chat.closedAt!.getTime()))) : null
  const needCreated = Math.abs(t.createdAt.getTime() - v.receivedAt.getTime()) > 1000
  const curTicketStatus = ticketStatusOf.get(v.statusId ?? -1) ?? null
  const needClose = allClosed && closedAt && (curTicketStatus === 'RESOLVED' || curTicketStatus === 'OPEN' || curTicketStatus === 'IN_PROGRESS' || t.status !== 'CLOSED' || Math.abs((t.closedAt?.getTime() ?? 0) - closedAt.getTime()) > 1000)
  if (!needCreated && !needClose) { unchanged++; continue }
  if (needCreated) fixCreated++
  if (needClose) fixClosed++; else if (!allClosed) keepOpen++
  if (!APPLY) continue
  await prisma.$transaction(async (tx) => {
    const ticketData: Record<string, unknown> = {}
    if (needCreated) { ticketData.createdAt = v.receivedAt; if (!needClose) ticketData.statusChangedAt = v.receivedAt }
    if (needClose && closedAt) {
      await tx.vocReceipt.update({ where: { id: v.id }, data: { statusId: closedStatus.id, statusChangedAt: closedAt, resolvedAt: dateOnly(closedAt) } })
      Object.assign(ticketData, { status: 'CLOSED', statusChangedAt: closedAt, resolvedAt: closedAt, closedAt, pendingReasonId: null, pendingNote: null })
      if (t.status !== 'CLOSED') await addTicketEvent(tx, t.id, 'status_change', bot.id, { from: t.status, to: 'CLOSED', via: 'retro_fix', chatClosedAt: closedAt.toISOString() })
    }
    await tx.ticket.update({ where: { id: t.id }, data: ticketData })
  })
}
console.log(`B. 티켓 생성시각 보정 ${fixCreated} · 종결 처리 ${fixClosed} · 상담 진행 중(상태 유지) ${keepOpen} · 변경 없음 ${unchanged}`)

// ── C. 컷오버 ──
if (cutoverArg) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoverArg)) throw new Error('--set-cutover=YYYY-MM-DD')
  if (APPLY) await prisma.appSetting.upsert({ where: { key: CHANNELTALK_VOC_CUTOVER_KEY }, update: { value: cutoverArg }, create: { key: CHANNELTALK_VOC_CUTOVER_KEY, value: cutoverArg } })
  console.log(`C. 컷오버 ${cutoverArg} ${APPLY ? '기록' : '(dry)'}`)
}

if (APPLY) {
  const [byStatus, tk, links] = await Promise.all([
    prisma.$queryRaw<{ name: string; n: number }[]>`select s.name, count(*)::int n from voc_receipts v join status_codes s on s.id=v.status_id where v.source='CHANNELTALK' group by 1 order by 2 desc`,
    prisma.$queryRaw<{ status: string; n: number; today: number }[]>`select status, count(*)::int n, count(*) filter (where created_at::date = (now() at time zone 'Asia/Seoul')::date)::int today from tickets where ref_type='VOC' group by 1`,
    prisma.$queryRaw<{ r: string; n: number }[]>`select link_reason r, count(*)::int n from voc_channeltalk_chats group by 1`,
  ])
  console.log('결과 — VOC 상태:', byStatus.map((x) => `${x.name} ${x.n}`).join(' · '), '| 티켓:', tk.map((x) => `${x.status} ${x.n}(오늘생성 ${x.today})`).join(' · '), '| 연결:', links.map((x) => `${x.r} ${x.n}`).join(' · '))
} else console.log('dry-run — --apply 로 실행')
await prisma.$disconnect()
