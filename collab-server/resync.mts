/**
 * 위키 Y.Doc → 스냅샷 1회성 재동기화 (2026-09-12 검토 A-1 후속).
 *
 * 협업 서버 store()가 표 포함 페이지에서 계속 실패해(columnWidths undefined) content_json/plain_text/백링크가
 * 낡은 페이지를 진실의 원천(wiki_page_ydoc)에서 다시 materialize 한다. 버전·최근 수정자·감사는 건드리지 않는다
 * (mode 'resync'). 갱신된 페이지는 updated_at이 올라가 청크 스케줄러가 다음 주기에 재색인한다.
 *
 * 실행 (esbuild 번들 필요 — wikiSchema는 tsx 직접 로드가 안 됨):
 *   npm run build:collab && node collab-server/dist/resync.mjs [--dry] [--page <id> ...]
 * 협업 서버가 떠 있어도 안전 — 메모리에 열린 문서는 같은 상태(≤10초 디바운스분 제외)이며
 * 다음 store()가 같은 내용을 다시 쓸 뿐이다. PROD에서는 DB 쓰기이므로 명시 허락 후 실행(CLAUDE.md 규칙 5).
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import * as Y from 'yjs'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { wikiSchema } from '../lib/wiki/wikiSchema'
import { materializePage } from './materialize'

const prisma = new PrismaClient()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blockEditor = ServerBlockNoteEditor.create({ schema: wikiSchema } as any)

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const pageIds: string[] = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--page' && args[i + 1]) pageIds.push(args[++i])
}

async function main() {
  const rows = await prisma.wikiPageYdoc.findMany({
    where: pageIds.length ? { pageId: { in: pageIds } } : undefined,
    select: { pageId: true, state: true, page: { select: { title: true, deletedAt: true } } },
    orderBy: { updatedAt: 'asc' },
  })
  console.log(`[resync] 대상 Y.Doc ${rows.length}건${dryRun ? ' (dry-run)' : ''}`)

  let changed = 0
  let failed = 0
  for (const row of rows) {
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, new Uint8Array(row.state))
      const r = await materializePage({ prisma, blockEditor, pageId: row.pageId, doc, mode: 'resync', dryRun })
      if (!r) {
        console.log(`  - ${row.pageId.slice(0, 8)} 페이지 없음 (skip)`)
        continue
      }
      if (r.changed) {
        changed++
        console.log(
          `  * ${row.pageId.slice(0, 8)} ${row.page.deletedAt ? '[휴지통] ' : ''}${row.page.title} — plain_text ${r.previousPlainTextLength} → ${r.plainTextLength}자${dryRun ? ' (예정)' : ' 갱신'}`,
        )
      }
    } catch (e) {
      failed++
      console.error(`  ! ${row.pageId.slice(0, 8)} ${row.page.title} 실패: ${(e as Error).message?.slice(0, 200)}`)
    } finally {
      doc.destroy()
    }
  }
  console.log(`[resync] 완료 — 갱신 ${changed}건 / 변화 없음 ${rows.length - changed - failed}건 / 실패 ${failed}건`)
}

main()
  .catch((e) => {
    console.error('[resync] 실패:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
