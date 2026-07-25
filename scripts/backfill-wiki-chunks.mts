/**
 * 위키 청크 인덱스 백필 (v3 W1)
 *
 * 실행: npx tsx scripts/backfill-wiki-chunks.mts
 *       npx tsx scripts/backfill-wiki-chunks.mts --dry   (생성 결과만 출력, DB 미변경)
 *
 * 재실행 안전: 페이지별로 기존 청크를 전량 교체한다.
 * 삭제(deleted_at)된 페이지는 청크를 비운다.
 */
import { prisma } from '@/lib/prisma'
import { buildChunks, rebuildPageChunks } from '@/lib/wiki/chunk'

async function main() {
  const dry = process.argv.includes('--dry')
  const pages = await prisma.wikiPage.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, pageType: true, contentHtml: true, contentJson: true },
    orderBy: { updatedAt: 'desc' },
  })

  let totalChunks = 0
  let emptyPages = 0
  const oversized: string[] = []

  for (const page of pages) {
    const chunks = buildChunks(page)
    totalChunks += chunks.length
    if (chunks.length === 0) emptyPages++
    const max = chunks.reduce((m, c) => Math.max(m, c.text.length), 0)
    if (max > 2500) oversized.push(`${page.title} (최대 ${max}자)`)

    if (!dry) await rebuildPageChunks(page.id)
    if (chunks.length >= 10) {
      console.log(`  ${page.title}: ${chunks.length}청크 (최대 ${max}자)`)
    }
  }

  console.log('─'.repeat(60))
  console.log(`페이지 ${pages.length}개 → 청크 ${totalChunks}개 (평균 ${(totalChunks / pages.length).toFixed(1)})`)
  console.log(`본문 없는 페이지: ${emptyPages}개`)
  if (oversized.length > 0) {
    console.log(`분할 상한 초과(표 등 원자 단위 보존): ${oversized.length}건`)
    oversized.slice(0, 5).forEach((s) => console.log(`  - ${s}`))
  }
  if (dry) console.log('\n(--dry: DB 변경 없음)')
  else console.log(`DB 반영 완료: wiki.wiki_chunks ${await prisma.wikiChunk.count()}행`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
