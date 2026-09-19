// 합포장 태그 백필 (2026-09-19) — 같은 수거 송장번호(영숫자 정규화)를 가진 접수가 2건 이상이면 전부 combined_pack=true.
// 사용: npx tsx scripts/backfill-as-combined-pack.mts [--apply]   (기본 dry-run). 멱등 — 이미 켜진 건 건드리지 않음. PROD는 규칙 5(명시 허락) 적용
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
const APPLY = process.argv.includes('--apply')
const groups = await prisma.$queryRaw<{ k: string; codes: string[]; ids: number[]; off: number }[]>(Prisma.sql`
  SELECT k, array_agg(as_code ORDER BY as_code) AS codes, array_agg(id) AS ids, count(*) FILTER (WHERE NOT combined_pack)::int AS off
  FROM (SELECT id, as_code, combined_pack, upper(regexp_replace(pickup_tracking_no, '[^0-9A-Za-z]', '', 'g')) AS k FROM as_receipts WHERE pickup_tracking_no IS NOT NULL) x
  WHERE k <> '' GROUP BY k HAVING count(*) > 1 ORDER BY count(*) DESC, k`)
for (const g of groups) console.log(`${g.k.padEnd(18)} ${g.codes.join(', ')}${g.off ? '' : '  (이미 켜짐)'}`)
const ids = groups.flatMap((g) => g.ids)
console.log(`그룹 ${groups.length} · 대상 접수 ${ids.length} · 켤 접수 ${groups.reduce((n, g) => n + g.off, 0)}`)
if (APPLY && ids.length) {
  const r = await prisma.asReceipt.updateMany({ where: { id: { in: ids }, combinedPack: false }, data: { combinedPack: true } })
  console.log(`--apply: ${r.count}건 combined_pack=true`)
} else console.log('dry-run — --apply 로 실행')
await prisma.$disconnect()
