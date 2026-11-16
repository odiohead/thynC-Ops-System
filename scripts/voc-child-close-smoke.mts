/**
 * VOC 하위 티켓 종결 후 재판정 스모크 (2026-11-16) — resolveVocsAfterChildrenClosed
 * DEV 전용 — 표본 VOC 1건의 status_changed_at을 잠깐 바꿨다가 되돌리고, 마지막에 실제로 재판정을 실행한다(dev2의 밀린 건 정리).
 * usage: npx tsx scripts/voc-child-close-smoke.mts
 */
import { prisma } from '../lib/prisma'
import { resolveVocsAfterChildrenClosed } from '../lib/channeltalk/vocPromote'
import { CHANNELTALK_BOT_EMAIL } from '../lib/channeltalk/shared'

if (process.cwd().includes('thynC-Ops-PROD')) throw new Error('DEV 전용')
let pass = 0, fail = 0
const ok = (name: string, cond: boolean, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`) }
const bot = await prisma.user.findUnique({ where: { email: CHANNELTALK_BOT_EMAIL }, select: { id: true } })
if (!bot) throw new Error('채널톡 봇 계정 없음')

/** 독립 SQL — 미종결(접수·처리중)·상담 전부 종료·하위 티켓 있음·전부 종결 */
const stuck = () => prisma.$queryRaw<{ id: number; voc_code: string }[]>`
  SELECT v.id, v.voc_code FROM voc_receipts v LEFT JOIN status_codes s ON s.id = v.status_id
  WHERE (s.id IS NULL OR s.ticket_status IN ('OPEN', 'IN_PROGRESS'))
    AND EXISTS (SELECT 1 FROM voc_channeltalk_chats l WHERE l.voc_id = v.id)
    AND NOT EXISTS (SELECT 1 FROM voc_channeltalk_chats l JOIN channeltalk_user_chats c ON c.id = l.chat_id WHERE l.voc_id = v.id AND c.state <> 'closed')
    AND EXISTS (SELECT 1 FROM tickets t WHERE t.parent_id = v.ticket_id)
    AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.parent_id = v.ticket_id AND t.status NOT IN ('RESOLVED', 'CLOSED'))
  ORDER BY v.id`
const waiting = async () => (await prisma.$queryRaw<{ n: number }[]>`
  SELECT count(*)::int n FROM voc_receipts v JOIN status_codes s ON s.id = v.status_id
  WHERE s.ticket_status IN ('OPEN', 'IN_PROGRESS') AND v.source = 'CHANNELTALK'
    AND EXISTS (SELECT 1 FROM tickets t WHERE t.parent_id = v.ticket_id AND t.status NOT IN ('RESOLVED', 'CLOSED'))`)[0].n
const counts = async () => ({
  notif: await prisma.notificationLog.count(), clocks: await prisma.ticketSlaClock.count(), vocs: await prisma.vocReceipt.count(),
  held: await prisma.vocReceipt.count({ where: { status: { ticketStatus: { in: ['PENDING', 'CLOSED'] } } } }),
})

const before = await stuck()
const waitingBefore = await waiting()
const c0 = await counts()
console.log(`밀린 VOC(상담·하위 티켓 모두 끝났는데 미종결) ${before.length}건 · 하위 티켓 진행 중이라 대기 ${waitingBefore}건`)
ok('표본 확보(밀린 VOC 2건 이상)', before.length >= 2)

// 1) 보호 조건 — 하위 티켓 종결 뒤 사람이 상태를 바꾼 VOC는 건드리지 않는다
const guard = before[0]
const orig = await prisma.vocReceipt.findUnique({ where: { id: guard.id }, select: { statusChangedAt: true, statusId: true } })
await prisma.vocReceipt.update({ where: { id: guard.id }, data: { statusChangedAt: new Date() } })
const logs: string[] = []
const n1 = await resolveVocsAfterChildrenClosed(bot.id, (l) => logs.push(l))
const afterGuard = await prisma.vocReceipt.findUnique({ where: { id: guard.id }, select: { statusId: true } })
ok(`하위 티켓 종결 뒤 상태를 바꾼 VOC는 유지 (${guard.voc_code})`, afterGuard?.statusId === orig?.statusId)
ok('나머지는 전부 회신완료', n1 === before.length - 1, `${n1}/${before.length - 1}`)
const mid = await stuck()
ok('밀린 VOC는 보호 표본 1건만 남음', mid.length === 1 && mid[0].id === guard.id, `${mid.length}건`)

// 2) 결과 정합성 — VOC 회신완료 ↔ 티켓 RESOLVED, 완료일 기록
const doneIds = before.filter((b) => b.id !== guard.id).map((b) => b.id)
const done = await prisma.vocReceipt.findMany({ where: { id: { in: doneIds } }, select: { resolvedAt: true, status: { select: { ticketStatus: true } }, ticket: { select: { status: true, resolvedAt: true } } } })
ok('VOC 상태 회신완료(RESOLVED 매핑)', done.every((d) => d.status?.ticketStatus === 'RESOLVED'))
ok('연결 티켓 RESOLVED · 완료 시각 기록', done.every((d) => d.ticket?.status === 'RESOLVED' && !!d.ticket.resolvedAt && !!d.resolvedAt))
ok('로그 건수 = 처리 건수', logs.filter((l) => l.startsWith('VOC 회신완료(하위 티켓 종결)')).length === n1)

// 3) 보호 표본 원복 후 재실행 → 그 1건도 처리, 다시 돌리면 0 (멱등)
await prisma.vocReceipt.update({ where: { id: guard.id }, data: { statusChangedAt: orig?.statusChangedAt ?? null } })
const n2 = await resolveVocsAfterChildrenClosed(bot.id, () => {})
ok('보호 표본 원복 후 재실행 → 1건 처리', n2 === 1, `${n2}`)
const n3 = await resolveVocsAfterChildrenClosed(bot.id, () => {})
ok('재실행 0건(멱등)', n3 === 0 && (await stuck()).length === 0)

// 4) 건드리면 안 되는 것
ok('하위 티켓 진행 중인 VOC는 그대로 대기', (await waiting()) === waitingBefore, `${waitingBefore}건`)
const c1 = await counts()
ok('알림 로그·SLA 시계·VOC 수 불변', c1.notif === c0.notif && c1.clocks === c0.clocks && c1.vocs === c0.vocs)
ok('보류·종결 VOC 수 불변(사람이 정한 상태 불간섭)', c1.held === c0.held)

console.log(`\n${pass}/${pass + fail} 통과 — dev2 밀린 VOC ${before.length}건 회신완료 처리됨`)
await prisma.$disconnect()
process.exit(fail ? 1 : 0)
