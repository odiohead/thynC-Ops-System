// 채널톡 상담 원천 적재 — 백필 (projects/voc_channeltalk_intake_design.md §6, 2026-09-28)
// 사용: npx tsx scripts/channeltalk-voc-backfill.mts [--dry] [--since=YYYY-MM-DD] [--max-calls=N] [--reset] [--loop]
//   --dry        API 조회만 하고 DB에 쓰지 않음 (건수·페이지 확인)
//   --since      종료(closedAt) 기준 이 일자 이후 상담만 (개발 소량 적재용). 활성 상담은 항상 전량
//   --max-calls  이번 실행의 API 호출 상한 (기본 무제한). 도달 시 커서 저장 후 종료 → 재실행 또는 스케줄러가 이어감
//   --reset      백필 커서 초기화 후 처음부터 (upsert라 데이터는 안전)
//   --loop       상한 도달 시 30초 쉬고 반복해 완료까지 진행
// 서버 스케줄러(channeltalk_voc_interval)가 켜져 있으면 동시 실행하지 말 것(레이트리밋 공유). PROD는 규칙 5(명시 허락) 적용
import { prisma } from '../lib/prisma'
import { ChanneltalkClient } from '../lib/channeltalk/client'
import { runChanneltalkVocSync, resetChanneltalkBackfill, getChanneltalkBackfillState } from '../lib/channeltalk/vocSync'

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const DRY = process.argv.includes('--dry')
const RESET = process.argv.includes('--reset')
const LOOP = process.argv.includes('--loop')
const since = arg('since') ? new Date(`${arg('since')}T00:00:00+09:00`) : undefined
const maxCalls = arg('max-calls') ? Number(arg('max-calls')) : Number.POSITIVE_INFINITY // 미지정 = 무제한 (서버 틱의 200 기본값은 적용하지 않음)

if (!ChanneltalkClient.isConfigured()) { console.error('CHANNELTALK_ACCESS_KEY / CHANNELTALK_ACCESS_SECRET 미설정'); process.exit(1) }

if (DRY) {
  const client = new ChanneltalkClient()
  let n = 0, pages = 0, next: string | null = null
  const sinceMs = since?.getTime()
  for (;;) {
    const page = await client.listUserChats('closed', 'asc', next); pages++
    n += sinceMs ? page.userChats.filter((c) => typeof c.closedAt === 'number' && c.closedAt >= sinceMs).length : page.userChats.length
    if (!page.next || !page.userChats.length) break
    next = page.next
  }
  const opened = (await client.listUserChats('opened', 'asc')).userChats.length
  const snoozed = (await client.listUserChats('snoozed', 'asc')).userChats.length
  console.log(`dry-run — closed ${n}건(${pages}페이지${since ? `, since ${arg('since')}` : ''}) · opened ${opened} · snoozed ${snoozed} · 예상 호출 ≈ ${pages + 2 + n + opened + snoozed}(상담당 메시지 1회) · 이번 조회 ${client.calls}회`)
  await prisma.$disconnect(); process.exit(0)
}

if (RESET) { await resetChanneltalkBackfill(); console.log('백필 커서 초기화') }
const before = await getChanneltalkBackfillState()
if (before.done) console.log('백필 이미 완료 상태 — incremental만 수행됩니다 (--reset 으로 처음부터)')

for (;;) {
  const r = await runChanneltalkVocSync('backfill', { maxCalls, backfillSince: since, log: (l) => console.log(`  ${l}`) })
  const st = await getChanneltalkBackfillState()
  console.log(`run#${r.runId} scanned=${r.scannedChats} upserted=${r.upsertedChats} new=${r.newChats} messages=${r.fetchedMessages} calls=${r.apiCalls} rateLimited=${r.rateLimited} processed=${st.processed} done=${st.done}${r.error ? ` ERROR=${r.error}` : ''}`)
  if (r.error || st.done || !r.budgetExceeded || !LOOP) break
  await new Promise((res) => setTimeout(res, 30_000))
}
const [chats, msgs, users, managers] = await Promise.all([
  prisma.channeltalkUserChat.groupBy({ by: ['state'], _count: true }),
  prisma.channeltalkMessage.count(), prisma.channeltalkUser.count(), prisma.channeltalkManager.count(),
])
console.log('DB 현황:', chats.map((c) => `${c.state}=${c._count}`).join(' '), `· messages=${msgs} · users=${users} · managers=${managers}`)
await prisma.$disconnect()
