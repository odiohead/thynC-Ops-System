/**
 * 기존 위키 페이지의 content_json → plain_text 백필 (1회 실행).
 * Phase 7 검색 도입 시 50개 임포트된 페이지 + 1개 테스트 페이지에 텍스트 인덱스 세팅.
 */
import { PrismaClient } from '@prisma/client'
import { extractPlainTextFromBlocks } from '../lib/wiki/blockText.js'

const prisma = new PrismaClient()
const pages = await prisma.wikiPage.findMany({ select: { id: true, contentJson: true } })
console.log(`총 ${pages.length}개 페이지 백필 시작`)
let updated = 0
for (const p of pages) {
  const text = extractPlainTextFromBlocks(p.contentJson)
  await prisma.wikiPage.update({ where: { id: p.id }, data: { plainText: text } })
  updated++
  if (updated % 10 === 0) console.log(`  ${updated}/${pages.length}`)
}
console.log(`✅ ${updated}개 페이지 plain_text 백필 완료`)
await prisma.$disconnect()
