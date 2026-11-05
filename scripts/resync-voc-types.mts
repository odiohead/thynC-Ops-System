/**
 * VOC 분류 재동기화 1회성/재실행 가능 (2026-11-05) — 채널톡 연결 VOC 전부에 syncVocTypesFromChats 적용.
 * 대표 분류는 vocTypeManual=false 건만 상담 첫 태그로 추종, 복수 분류는 태그 합집합으로 맞춘다. 멱등.
 * usage: npx tsx scripts/resync-voc-types.mts [--apply]   (기본 dry-run: 변경 예정 건수만 — 대표 변경 후보 수를 SQL로 산출)
 */
import { prisma } from '../lib/prisma'
import { syncVocTypesFromChats } from '../lib/channeltalk/vocPromote'

const apply = process.argv.includes('--apply')
const ids = await prisma.vocReceipt.findMany({ where: { channeltalkChats: { some: {} } }, select: { id: true }, orderBy: { id: 'asc' } })
console.log(`대상 VOC(채널톡 연결): ${ids.length}건, mode=${apply ? 'APPLY' : 'DRY-RUN'}`)
if (!apply) {
  const rows = await prisma.$queryRaw<{ rep_follow: bigint; manual: bigint }[]>`
    with v as (
      select r.id, r.voc_type_id, r.voc_type_manual,
        (select sc.id from voc_channeltalk_chats l join channeltalk_user_chats c on c.id=l.chat_id, unnest(c.tags) t
           join status_codes sc on sc.category='VOC_TYPE' and sc.value = replace(t, ',', '-')
          where l.voc_id=r.id and t ~ '^[a-h]_' order by l.linked_at, array_position(c.tags, t) limit 1) first_id
      from voc_receipts r where exists (select 1 from voc_channeltalk_chats l where l.voc_id=r.id))
    select count(*) filter (where not voc_type_manual and first_id is not null and first_id is distinct from voc_type_id) rep_follow,
           count(*) filter (where voc_type_manual) manual from v`
  console.log(`대표 분류 변경 예정(자동 추종): ${rows[0].rep_follow}건 · 수동 지정(보존): ${rows[0].manual}건`)
  await prisma.$disconnect(); process.exit(0)
}
let changed = 0, touched = 0
for (const { id } of ids) {
  const n = await syncVocTypesFromChats(id)
  if (n > 0) { touched++; changed += n }
}
console.log(`완료: VOC ${touched}건 변경 (분류 행 추가/제거/대표 변경 합계 ${changed})`)
await prisma.$disconnect()
