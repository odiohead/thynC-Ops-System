/**
 * 프로젝트 이슈노트(Tiptap HTML) → 위키 페이지 일괄 이관 스크립트
 *
 * projects.issue_note에 내용이 있는 프로젝트마다 위키 '프로젝트 이슈노트' 카테고리 하위에
 * 페이지를 생성하고 WikiPageReference(refType='project_issue')로 1:1 연결한다.
 * - HTML → BlockNote 블록 변환은 @blocknote/server-util (협업 서버와 동일한 wikiSchema)
 * - 이미 이슈노트 페이지가 있는 프로젝트는 스킵 (멱등 — 재실행 안전)
 * - projects.issue_note 컬럼은 백업용으로 보존 (삭제·수정하지 않음)
 *
 * 실행: npx tsx scripts/migrate-issue-notes-to-wiki.mts [--dry-run]
 */
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { extractPlainTextFromBlocks } from '../lib/wiki/blockText'
import {
  PROJECT_ISSUE_REF_TYPE,
  ISSUE_PAGE_ICON,
  ensureIssueNoteRoot,
} from '../lib/wiki/projectIssueNote'

const DRY_RUN = process.argv.includes('--dry-run')

/** HTML에 실제 내용이 있는지 — 태그 제거 후 텍스트가 있거나 이미지/링크 포함 */
function hasMeaningfulContent(html: string): boolean {
  if (/<(img|a|table)\b/i.test(html)) return true
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0
}

async function main() {
  console.log(`── 이슈노트 → 위키 이관 ${DRY_RUN ? '(dry-run)' : ''} ──`)

  // 이관 페이지의 작성자로 쓸 관리자 계정
  const actor = await prisma.user.findFirst({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isActive: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }], // ADMIN < SUPER_ADMIN 알파벳순이지만 둘 다 허용
    select: { id: true, name: true, email: true },
  })
  if (!actor) throw new Error('활성 관리자 계정이 없습니다 — 이관 페이지 작성자로 필요')
  console.log(`작성자: ${actor.name} (${actor.email})`)

  const projects = await prisma.project.findMany({
    where: { issueNote: { not: null } },
    select: { projectCode: true, projectName: true, issueNote: true },
    orderBy: { projectCode: 'asc' },
  })

  // 레거시 Tiptap HTML은 표준 블록(문단·헤딩·리스트·링크 등)만 생성하므로 기본 스키마로 충분.
  // (wikiSchema 커스텀 블록은 HTML 파싱 결과에 등장하지 않고, 기본 블록 JSON은 위키 스키마와 호환)
  const editor = ServerBlockNoteEditor.create()

  let migrated = 0
  let skippedEmpty = 0
  let skippedExisting = 0

  const rootId = DRY_RUN ? '(dry-run)' : await ensureIssueNoteRoot(actor.id)
  if (!DRY_RUN) console.log(`루트 카테고리 페이지: ${rootId}`)

  for (const p of projects) {
    const html = p.issueNote ?? ''
    if (!hasMeaningfulContent(html)) {
      skippedEmpty++
      continue
    }

    const existing = await prisma.wikiPageReference.findFirst({
      where: {
        refType: PROJECT_ISSUE_REF_TYPE,
        refCode: p.projectCode,
        page: { deletedAt: null },
      },
      select: { pageId: true },
    })
    if (existing) {
      console.log(`  [스킵-기존] ${p.projectCode} ${p.projectName} → ${existing.pageId}`)
      skippedExisting++
      continue
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks = (await editor.tryParseHTMLToBlocks(html)) as any[]
    const plainText = extractPlainTextFromBlocks(blocks)

    if (DRY_RUN) {
      console.log(
        `  [대상] ${p.projectCode} ${p.projectName} — 블록 ${blocks.length}개, 텍스트 ${plainText.length}자`,
      )
      migrated++
      continue
    }

    const page = await prisma.wikiPage.create({
      data: {
        title: p.projectName,
        icon: ISSUE_PAGE_ICON,
        parentId: rootId,
        contentJson: blocks as unknown as Prisma.InputJsonValue,
        plainText,
        authorId: actor.id,
        lastEditorId: actor.id,
        references: {
          create: {
            refType: PROJECT_ISSUE_REF_TYPE,
            refCode: p.projectCode,
            createdById: actor.id,
          },
        },
      },
      select: { id: true },
    })
    console.log(`  [이관] ${p.projectCode} ${p.projectName} → ${page.id} (블록 ${blocks.length}개)`)
    migrated++
  }

  console.log('── 결과 ──')
  console.log(`이관: ${migrated}건 / 빈 내용 스킵: ${skippedEmpty}건 / 기존 페이지 스킵: ${skippedExisting}건`)
  console.log('※ projects.issue_note 컬럼은 백업용으로 보존됨')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
