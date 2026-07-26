/**
 * 내부 알림함 · 개인 대시보드 스모크 (1.1 P5·P6 게이트 — §9)
 *
 * 검증:
 *  - emit: 수신자 정리(중복·본인 제외·비활성 제외) / dedup / 개인 설정(inApp=false) 반영
 *  - 수신자 산출: owner+참여자, owner 없으면 그룹 멤버 폴백
 *  - Slack과 독립(모드 off여도 적재)
 * 테스트 데이터는 전부 삭제한다.
 *
 *   npx tsx scripts/notify-center-smoke.mts
 */

import { PrismaClient } from '@prisma/client'
import { emitNotification, ticketRecipients, NOTIFY_KIND_DEFAULTS } from '../lib/notify-center'

const prisma = new PrismaClient()
const TAG = '___notify_center_smoke'

let pass = 0
let fail = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function main() {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, take: 3 })
  if (users.length < 3) throw new Error('활성 사용자 3명 이상 필요')
  const [owner, participant, actor] = users

  const queue = await prisma.ticketQueue.create({ data: { name: TAG, isActive: false } })
  const cti = await prisma.ticketCti.findFirst({ where: { level: 3 }, select: { id: true } })
  const ticket = await prisma.ticket.create({
    data: {
      ticketCode: `TK-NCSMOKE-${Date.now()}`, title: `${TAG} 임시`, queueId: queue.id, ctiId: cti?.id ?? null,
      severity: 'SEV3', status: 'OPEN', ownerId: owner.id,
      participants: { create: [{ userId: participant.id }] },
    },
  })
  await prisma.ticketQueueMember.create({ data: { queueId: queue.id, userId: actor.id } })

  const cleanup = async () => {
    await prisma.notification.deleteMany({ where: { ticketId: ticket.id } })
    await prisma.notificationPref.deleteMany({ where: { userId: participant.id, kind: 'TICKET_COMMENT' } })
    await prisma.ticket.delete({ where: { id: ticket.id } })
    await prisma.ticketQueueMember.deleteMany({ where: { queueId: queue.id } })
    await prisma.ticketQueue.delete({ where: { id: queue.id } })
  }

  try {
    console.log('1. 수신자 산출')
    const recips = await ticketRecipients(ticket.id)
    check('owner + 참여자', recips.includes(owner.id) && recips.includes(participant.id), recips.join(','))
    check('owner 있으면 그룹 멤버는 미포함', !recips.includes(actor.id))

    await prisma.ticket.update({ where: { id: ticket.id }, data: { ownerId: null } })
    const recipsNoOwner = await ticketRecipients(ticket.id)
    check('owner 없으면 그룹 멤버 폴백', recipsNoOwner.includes(actor.id), recipsNoOwner.join(','))
    await prisma.ticket.update({ where: { id: ticket.id }, data: { ownerId: owner.id } })

    console.log('\n2. emit — 본인 제외·중복 제거')
    const n1 = await emitNotification({
      kind: 'TICKET_STATUS_CHANGED',
      userIds: [owner.id, participant.id, actor.id, owner.id, null],
      title: `${TAG} 상태 변경`, link: `/tickets/${ticket.ticketCode}`,
      ticketId: ticket.id, actorId: actor.id, actorName: actor.name,
      dedupKey: `smoke-status:${ticket.id}`,
    })
    check('수신자 2명(본인 actor 제외·중복 제거)', n1 === 2, `${n1}건`)

    console.log('\n3. dedup')
    const n2 = await emitNotification({
      kind: 'TICKET_STATUS_CHANGED',
      userIds: [owner.id, participant.id],
      title: `${TAG} 상태 변경(재시도)`, link: `/tickets/${ticket.ticketCode}`,
      ticketId: ticket.id, actorId: actor.id,
      dedupKey: `smoke-status:${ticket.id}`,
    })
    check('같은 dedupKey 재적재 0건', n2 === 0, `${n2}건`)

    console.log('\n4. 개인 수신 설정')
    await prisma.notificationPref.create({ data: { userId: participant.id, kind: 'TICKET_COMMENT', inApp: false } })
    const n3 = await emitNotification({
      kind: 'TICKET_COMMENT',
      userIds: [owner.id, participant.id],
      title: `${TAG} 코멘트`, link: `/tickets/${ticket.ticketCode}`,
      ticketId: ticket.id, actorId: actor.id,
    })
    check('inApp=false 사용자는 제외(1명만 적재)', n3 === 1, `${n3}건`)
    check('기본값 정의 존재(전 kind)', Object.keys(NOTIFY_KIND_DEFAULTS).length === 6)

    console.log('\n5. 적재 내용')
    const rows = await prisma.notification.findMany({ where: { ticketId: ticket.id }, orderBy: { id: 'asc' } })
    check('알림 3건 적재', rows.length === 3, `${rows.length}건`)
    check('미읽음으로 생성', rows.every((r) => r.readAt === null))
    check('링크·actor 스냅샷 보존', rows[0].link.startsWith('/tickets/') && rows[0].actorName === actor.name)

    console.log('\n6. 읽음 처리')
    const upd = await prisma.notification.updateMany({ where: { userId: owner.id, ticketId: ticket.id, readAt: null }, data: { readAt: new Date() } })
    check('읽음 처리 반영', upd.count >= 1, `${upd.count}건`)
    const unread = await prisma.notification.count({ where: { userId: owner.id, ticketId: ticket.id, readAt: null } })
    check('owner 미읽음 0', unread === 0)
  } finally {
    console.log('\n[정리]')
    await cleanup()
    const residue = await prisma.notification.count({ where: { ticketId: ticket.id } })
    const residueQ = await prisma.ticketQueue.count({ where: { name: TAG } })
    check('테스트 데이터 잔여 0', residue === 0 && residueQ === 0, `noti=${residue} queue=${residueQ}`)
  }

  console.log(`\n[notify-center-smoke] 결과: ${pass} 통과 / ${fail} 실패`)
  if (fail > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
