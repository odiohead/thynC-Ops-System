/**
 * 채널톡 후속 연결 규칙 스모크 (2026-11-16) — findOpenVocForCustomer: 응대 중인 상담(opened·snoozed)이 남은 미종결 VOC만 후속 대상.
 * DEV 전용 — 상담 1건의 state를 잠깐 바꿨다가 되돌린다. usage: npx tsx scripts/voc-followup-rule-smoke.mts
 */
import { prisma } from '../lib/prisma'
import { findOpenVocForCustomer } from '../lib/channeltalk/vocPromote'

if (process.cwd().includes('thynC-Ops-PROD')) throw new Error('DEV 전용')
let pass = 0, fail = 0
const ok = (name: string, cond: boolean, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`) }
const since = new Date('2026-10-01T00:00:00+09:00')

// 미종결 VOC(채널톡)와 그 고객
const open = await prisma.vocReceipt.findMany({
  where: { source: 'CHANNELTALK', receivedAt: { gte: since }, status: { ticketStatus: { notIn: ['RESOLVED', 'CLOSED'] } }, channeltalkChats: { some: { chat: { userId: { not: null } } } } },
  select: { id: true, vocCode: true, channeltalkChats: { select: { chat: { select: { id: true, userId: true, state: true } } } } },
})
const ACTIVE = ['opened', 'snoozed']
const hasActive = (v: (typeof open)[number]) => v.channeltalkChats.some((l) => ACTIVE.includes(l.chat.state))
const users = new Map<string, (typeof open)[number][]>()
for (const v of open) for (const l of v.channeltalkChats) if (l.chat.userId) users.set(l.chat.userId, [...(users.get(l.chat.userId) ?? []), v])
console.log(`미종결 채널톡 VOC ${open.length}건 · 고객 ${users.size}명 (응대 중 상담 보유 VOC ${open.filter(hasActive).length})`)

// 1) 전 고객 — 결과는 null이거나 '응대 중 상담이 있는 VOC'여야 한다
let nullCnt = 0, activeCnt = 0, wrong = 0
for (const [userId, vocs] of users) {
  const got = await findOpenVocForCustomer(userId, since)
  const expectActive = vocs.some(hasActive)
  if (got === null) { nullCnt++; if (expectActive) wrong++ }
  else { activeCnt++; const v = open.find((x) => x.id === got); if (!v || !hasActive(v)) wrong++ }
}
ok('전 고객: 후속 대상은 응대 중 상담이 있는 VOC뿐', wrong === 0, `대상 없음 ${nullCnt} · 대상 있음 ${activeCnt} · 불일치 ${wrong}`)
ok('상담이 모두 끝난 미종결 VOC만 가진 고객은 대상 없음(종전에는 전부 흡수)', nullCnt > 0, `${nullCnt}명`)

// 2) 상담 상태를 바꿔 가며 — 상담이 모두 closed인 미종결 VOC 1건
const sample = open.find((v) => v.channeltalkChats.length === 1 && v.channeltalkChats[0].chat.state === 'closed' && users.get(v.channeltalkChats[0].chat.userId!)!.every((x) => !hasActive(x)))
if (!sample) { ok('표본 VOC 확보', false) } else {
  const chat = sample.channeltalkChats[0].chat
  const set = (state: string) => prisma.channeltalkUserChat.update({ where: { id: chat.id }, data: { state } })
  try {
    ok(`closed → 대상 없음 (${sample.vocCode})`, (await findOpenVocForCustomer(chat.userId, since)) === null)
    await set('opened'); ok('opened(진행중) → 그 VOC가 후속 대상', (await findOpenVocForCustomer(chat.userId, since)) === sample.id)
    await set('snoozed'); ok('snoozed(보류) → 그 VOC가 후속 대상', (await findOpenVocForCustomer(chat.userId, since)) === sample.id)
    await set('initial'); ok('initial(봇만 응대) → 대상 없음', (await findOpenVocForCustomer(chat.userId, since)) === null)
    await set('opened'); ok('14일 창 밖(since 이후 접수 아님) → 대상 없음', (await findOpenVocForCustomer(chat.userId, new Date())) === null)
  } finally { await set('closed') }
  const back = await prisma.channeltalkUserChat.findUnique({ where: { id: chat.id }, select: { state: true } })
  ok('표본 상담 상태 원복', back?.state === 'closed')
}
ok('고객 없는 상담(userId null) → 대상 없음', (await findOpenVocForCustomer(null, since)) === null)

console.log(`\n${pass}/${pass + fail} 통과`)
await prisma.$disconnect()
process.exit(fail ? 1 : 0)
