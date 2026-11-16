/**
 * 채널톡 후속 연결(AUTO_FOLLOWUP) 분리 보정 (2026-11-16 — projects/voc_channeltalk_promotion_design.md §8)
 *
 * 배경: AS 인입이 채널톡 상담으로 바뀐 2026-10-28 이후, AS 하위 티켓 때문에 '접수'로 남은 VOC가 같은 고객의 새 상담을
 *       14일간 후속으로 흡수 → 별개 문의가 VOC 1건에 묶여 VOC 건수·분류 집계가 줄었다. 승격 규칙은 같은 날 수정(응대 중인 상담이 있을 때만 후속).
 *       이 스크립트는 이미 묶인 상담을 새 규칙 기준으로 개별 VOC로 되돌린다.
 *
 * 대상: link_reason = AUTO_FOLLOWUP · 연결 시각 ≥ --since(기본 2026-10-28 KST) · 연결 당시 같은 VOC에 담당자가 응대 중인 상담이 없던 것
 *       (응대 중 = 그 시각에 열려 있고(opened_at ≤ 연결 시각) 아직 안 닫힌(closed_at 없음 또는 연결 시각 이후) 다른 상담). 있던 건은 정상 후속이라 유지.
 * 처리(상담 첫 발화 순):
 *   1) 그 상담으로 새 VOC 생성 — 접수시각 = 고객 첫 발화, 코드 = 원래 연결된 달 기준, 연결 행은 지우지 않고 새 VOC로 갱신(AUTO_TAG), 알림·SLA 없음
 *   2) VOC·티켓 created_at = 원래 연결 시각(그때 만들어졌어야 할 시각)
 *   3) 그 상담에서 만들어진 AS 접수(as_intake_links)와 분할 자식을 새 VOC로 이동 — as_receipts.voc_id + AS 티켓 Master
 *      (원 VOC에 남는 다른 상담도 같은 접수에 연결돼 있으면 이동하지 않음)
 *   4) 새 VOC 상태 판정(상담 종료 + 하위 티켓 종결이면 회신완료 — 시각은 상담 종료·하위 티켓 종결 중 늦은 쪽)
 *   5) 원 VOC 분류·상태 재판정(남은 상담 기준)
 * 멱등 — 처리된 연결은 AUTO_TAG가 되어 재실행 시 대상 0.
 * usage: npx tsx scripts/fix-voc-followup-split.mts [--apply] [--since=YYYY-MM-DD]   (기본 dry-run)
 * PROD는 DB 쓰기 — CLAUDE.md 규칙 5(명시 허락). 수정된 승격 규칙이 배포된 뒤 실행할 것(그 전에 돌리면 새 상담이 다시 묶인다)
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { promoteChat, syncVocStatusFromChat, syncVocTypesFromChats } from '../lib/channeltalk/vocPromote'
import { createVocCodeAllocator } from '../lib/vocImport'
import { addTicketEvent } from '../lib/ticket'
import { CHANNELTALK_BOT_EMAIL } from '../lib/channeltalk/shared'

const APPLY = process.argv.includes('--apply')
const sinceArg = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1] ?? '2026-10-28'
if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) throw new Error('--since=YYYY-MM-DD')
const since = new Date(`${sinceArg}T00:00:00+09:00`)
const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
const dateOnly = (d: Date) => new Date(kstDay(d)) // KST 일자 (DATE 컬럼)
/** 금~목 주의 금요일 (대시보드 주 단위) */
const friOf = (d: Date) => { const day = new Date(kstDay(d)); const back = (day.getUTCDay() + 2) % 7; return new Date(day.getTime() - back * 86400_000).toISOString().slice(0, 10) }

const bot = await prisma.user.findUnique({ where: { email: CHANNELTALK_BOT_EMAIL }, select: { id: true } })
if (!bot) throw new Error('채널톡 봇 계정 없음')

// ── 대상 식별 ──
const links = await prisma.vocChanneltalkChat.findMany({
  where: { linkReason: 'AUTO_FOLLOWUP', linkedAt: { gte: since } },
  select: {
    id: true, vocId: true, chatId: true, linkedAt: true,
    chat: { select: { id: true, state: true, closedAt: true, firstUserMessageAt: true } },
    voc: { select: { id: true, vocCode: true, ticketId: true, ticket: { select: { id: true, ticketCode: true } },
      channeltalkChats: { select: { chatId: true, linkedAt: true, chat: { select: { openedAt: true, closedAt: true } } } } } },
  },
})
const hadActiveSibling = (l: (typeof links)[number]) => l.voc.channeltalkChats.some((s) =>
  s.chatId !== l.chatId && s.linkedAt <= l.linkedAt && s.chat.openedAt && s.chat.openedAt <= l.linkedAt && (!s.chat.closedAt || s.chat.closedAt > l.linkedAt))
const kept = links.filter(hadActiveSibling)
const targets = links.filter((l) => !hadActiveSibling(l))
  .sort((a, b) => (a.chat.firstUserMessageAt ?? a.linkedAt).getTime() - (b.chat.firstUserMessageAt ?? b.linkedAt).getTime())
const targetChatIds = new Set(targets.map((t) => t.chatId))

console.log(`mode=${APPLY ? 'APPLY' : 'DRY-RUN'} · 기준 ${sinceArg} 이후 후속 연결 ${links.length}건 → 분리 대상 ${targets.length} · 정상 후속(유지) ${kept.length}`)
const byWeek = new Map<string, number>()
for (const t of targets) { const k = friOf(t.chat.firstUserMessageAt ?? t.linkedAt); byWeek.set(k, (byWeek.get(k) ?? 0) + 1) }
console.log('  접수 주(금~목)별 새 VOC:', Array.from(byWeek.entries()).sort().map(([k, n]) => `${k} +${n}`).join(' · ') || '-')
console.log(`  영향 받는 원 VOC ${new Set(targets.map((t) => t.vocId)).size}건`)
for (const k of kept) console.log(`  유지: ${k.voc.vocCode} ← 상담 ${k.chatId} (연결 당시 응대 중인 상담 있음)`)

/** 이 상담에서 만들어진 AS 접수 중 원 VOC에 묶여 있고, 원 VOC에 남는 다른 상담과는 무관한 것 (+ 분할 자식) */
async function receiptsToMove(chatId: string, oldVocId: number) {
  const direct = await prisma.asIntakeLink.findMany({ where: { chatId, receiptId: { not: null } }, select: { receiptId: true } })
  const ids: number[] = []
  for (const d of direct) {
    const r = await prisma.asReceipt.findUnique({ where: { id: d.receiptId! }, select: { vocId: true } })
    if (r?.vocId !== oldVocId) continue
    const staying = await prisma.asIntakeLink.count({ where: { receiptId: d.receiptId!, chatId: { notIn: Array.from(targetChatIds) }, chat: { vocLink: { vocId: oldVocId } } } })
    if (staying === 0) ids.push(d.receiptId!)
  }
  for (let frontier = ids.slice(); frontier.length;) {
    const kids = await prisma.asReceipt.findMany({ where: { splitFromId: { in: frontier }, vocId: oldVocId, id: { notIn: ids } }, select: { id: true } })
    frontier = kids.map((k) => k.id)
    ids.push(...frontier)
  }
  return ids
}

if (!APPLY) {
  let move = 0
  for (const t of targets) move += (await receiptsToMove(t.chatId, t.vocId)).length
  console.log(`  새 VOC로 옮길 AS 접수 약 ${move}건`)
  console.log('dry-run — --apply 로 실행')
  await prisma.$disconnect()
  process.exit(0)
}

// ── 적용 ──
const allocator = createVocCodeAllocator()
let created = 0, movedReceipts = 0, resolvedNew = 0
const errors: string[] = []
const touchedOld = new Set<number>()

for (const t of targets) {
  try {
    // 1) 새 VOC (코드 충돌 시 번호를 올려 재시도 — 실행 중 앱이 같은 달 코드를 발번할 수 있다)
    let r: Awaited<ReturnType<typeof promoteChat>> | null = null
    for (let attempt = 0; !r; attempt++) {
      const code = await allocator.allocate(t.linkedAt)
      try {
        r = await promoteChat(t.chatId, { actorId: bot.id, skipEval: true, noFollowup: true, silent: true, moveLink: true, vocCode: code, skipStatusSync: true })
      } catch (e) {
        if (attempt < 5 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') { allocator.bump(code); continue }
        throw e
      }
    }
    created++
    touchedOld.add(t.vocId)
    const nv = await prisma.vocReceipt.findUnique({ where: { id: r.vocId }, select: { id: true, ticketId: true, ticket: { select: { id: true, ticketCode: true } } } })
    const newTicket = nv!.ticket!

    // 2) 생성 시각 = 원래 연결 시각
    await prisma.$transaction([
      prisma.vocReceipt.update({ where: { id: r.vocId }, data: { createdAt: t.linkedAt, statusChangedAt: t.linkedAt } }),
      prisma.ticket.update({ where: { id: newTicket.id }, data: { createdAt: t.linkedAt, statusChangedAt: t.linkedAt } }),
    ])

    // 3) AS 접수 이동
    const receiptIds = await receiptsToMove(t.chatId, t.vocId)
    const movedCodes: string[] = []
    for (const rid of receiptIds) {
      await prisma.$transaction(async (tx) => {
        const rec = await tx.asReceipt.update({ where: { id: rid }, data: { vocId: r!.vocId }, select: { asCode: true, ticket: { select: { id: true, ticketCode: true, parentId: true } } } })
        movedCodes.push(rec.asCode)
        if (rec.ticket && t.voc.ticket && rec.ticket.parentId === t.voc.ticket.id) {
          await tx.ticket.update({ where: { id: rec.ticket.id }, data: { parentId: newTicket.id } })
          await addTicketEvent(tx, rec.ticket.id, 'link', bot.id, { event: 'parent_set', parentId: newTicket.id, parentCode: newTicket.ticketCode, via: 'voc_followup_split', fromParentCode: t.voc.ticket.ticketCode })
          await addTicketEvent(tx, t.voc.ticket.id, 'link', bot.id, { event: 'child_removed', childId: rec.ticket.id, childCode: rec.ticket.ticketCode, via: 'voc_followup_split' })
          await addTicketEvent(tx, newTicket.id, 'link', bot.id, { event: 'child_added', childId: rec.ticket.id, childCode: rec.ticket.ticketCode, via: 'voc_followup_split' })
        }
      })
      movedReceipts++
    }

    // 4) 새 VOC 상태 — 회신완료가 되면 시각을 상담 종료·하위 티켓 종결 중 늦은 쪽으로
    if (t.chat.state === 'closed' && (await syncVocStatusFromChat(r.vocId, bot.id)) === 'resolved') {
      const kids = await prisma.ticket.findMany({ where: { parentId: newTicket.id }, select: { resolvedAt: true, closedAt: true } })
      const times = [t.linkedAt, t.chat.closedAt, ...kids.map((k) => k.resolvedAt ?? k.closedAt)].filter((d): d is Date => !!d).map((d) => d.getTime())
      const ts = new Date(Math.max(...times))
      await prisma.$transaction([
        prisma.vocReceipt.update({ where: { id: r.vocId }, data: { statusChangedAt: ts, resolvedAt: dateOnly(ts) } }),
        prisma.ticket.update({ where: { id: newTicket.id }, data: { statusChangedAt: ts, resolvedAt: ts } }),
      ])
      resolvedNew++
    }
    console.log(`  ${t.voc.vocCode} ← 상담 ${t.chatId} 분리 → ${r.vocCode}${movedCodes.length ? ` (AS ${movedCodes.join(', ')})` : ''}`)
  } catch (e) {
    const msg = `상담 ${t.chatId} (${t.voc.vocCode}): ${e instanceof Error ? e.message : String(e)}`
    errors.push(msg); console.error(`  실패 — ${msg}`)
  }
}

// 5) 원 VOC 재판정
let resolvedOld = 0
for (const vocId of Array.from(touchedOld)) {
  try {
    await syncVocTypesFromChats(vocId)
    if ((await syncVocStatusFromChat(vocId, bot.id)) === 'resolved') resolvedOld++
  } catch (e) {
    const msg = `원 VOC ${vocId} 재판정: ${e instanceof Error ? e.message : String(e)}`
    errors.push(msg); console.error(`  실패 — ${msg}`)
  }
}

console.log(`결과 — 새 VOC ${created}(그중 회신완료 ${resolvedNew}) · AS 접수 이동 ${movedReceipts} · 원 VOC ${touchedOld.size}건 재판정(회신완료 전환 ${resolvedOld}) · 오류 ${errors.length}`)
const remain = await prisma.vocChanneltalkChat.count({ where: { linkReason: 'AUTO_FOLLOWUP', linkedAt: { gte: since } } })
console.log(`남은 후속 연결(${sinceArg} 이후): ${remain}건`)
await prisma.$disconnect()
process.exit(errors.length ? 1 : 0)
