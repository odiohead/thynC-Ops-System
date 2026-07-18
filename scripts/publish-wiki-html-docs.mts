/**
 * HTML 산출물 문서 → 사내위키 일괄 게시 스크립트
 *
 * 지정 디렉토리의 manifest.json에 따라 위키 루트에 카테고리(블록 페이지)를 만들고,
 * 하위에 HTML 문서 페이지(pageType='html')들을 생성/갱신한다.
 * - 본문은 API와 동일하게 sanitizeHtmlDocument → contentHtml, extractPlainTextFromHtml → plainText
 * - 멱등: 같은 카테고리(루트, 같은 제목) + 같은 제목 페이지가 있으면 본문 갱신(재실행 안전)
 * - 감사로그는 스크립트 실행 특성상 생략 (작성자·수정자에 지정 계정 기록)
 *
 * manifest.json 형식:
 * {
 *   "category": "thync_1.3.0",
 *   "categoryIcon": "📦",
 *   "pages": [{ "file": "01-overview.html", "title": "시스템 개요서", "icon": "📘" }]
 * }
 *
 * 실행: npx tsx scripts/publish-wiki-html-docs.mts --dir <docs경로> [--dry-run]
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { prisma } from '../lib/prisma'
import {
  sanitizeHtmlDocument,
  extractPlainTextFromHtml,
  HTML_DOC_MAX_BYTES,
} from '../lib/wiki/htmlText'

const DRY_RUN = process.argv.includes('--dry-run')
const dirIdx = process.argv.indexOf('--dir')
const DOCS_DIR = dirIdx >= 0 ? process.argv[dirIdx + 1] : null

interface ManifestPage {
  file: string
  title: string
  icon?: string
}
interface Manifest {
  category: string
  categoryIcon?: string
  pages: ManifestPage[]
}

async function main() {
  if (!DOCS_DIR) {
    console.error('사용법: npx tsx scripts/publish-wiki-html-docs.mts --dir <docs경로> [--dry-run]')
    process.exit(1)
  }
  const manifest: Manifest = JSON.parse(readFileSync(join(DOCS_DIR, 'manifest.json'), 'utf8'))
  if (!manifest.category || !Array.isArray(manifest.pages) || manifest.pages.length === 0) {
    console.error('manifest.json에 category와 pages가 필요합니다.')
    process.exit(1)
  }

  // 작성자 계정: SUPER_ADMIN 우선
  const author = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true },
  })
  if (!author) {
    console.error('활성 SUPER_ADMIN 계정을 찾을 수 없습니다.')
    process.exit(1)
  }
  console.log(`작성자: ${author.name} (${author.email})${DRY_RUN ? ' [dry-run]' : ''}`)

  // 1) 카테고리(루트 블록 페이지) 보장 — 루트 레벨 같은 제목 재사용
  let category = await prisma.wikiPage.findFirst({
    where: { parentId: null, title: manifest.category, deletedAt: null, isTemplate: false },
    select: { id: true, title: true },
  })
  if (category) {
    console.log(`카테고리 재사용: "${category.title}" (${category.id})`)
  } else if (DRY_RUN) {
    console.log(`카테고리 생성 예정: "${manifest.category}"`)
  } else {
    const maxSort = await prisma.wikiPage.aggregate({
      where: { parentId: null, deletedAt: null },
      _max: { sortOrder: true },
    })
    category = await prisma.wikiPage.create({
      data: {
        title: manifest.category,
        icon: manifest.categoryIcon ?? null,
        parentId: null,
        contentJson: [],
        plainText: '',
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
        authorId: author.id,
        lastEditorId: author.id,
      },
      select: { id: true, title: true },
    })
    console.log(`카테고리 생성: "${category.title}" (${category.id})`)
  }

  // 2) HTML 문서 페이지 생성/갱신
  let created = 0
  let updated = 0
  for (let i = 0; i < manifest.pages.length; i++) {
    const p = manifest.pages[i]
    const raw = readFileSync(join(DOCS_DIR, p.file), 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > HTML_DOC_MAX_BYTES) {
      console.error(`  ✗ ${p.title}: 2MB 초과 — 건너뜀`)
      continue
    }
    const contentHtml = sanitizeHtmlDocument(raw)
    const plainText = extractPlainTextFromHtml(contentHtml)

    if (DRY_RUN || !category) {
      console.log(`  · ${p.title} (${p.file}, plainText ${plainText.length}자) — dry-run`)
      continue
    }

    const existing = await prisma.wikiPage.findFirst({
      where: { parentId: category.id, title: p.title, deletedAt: null },
      select: { id: true, pageType: true },
    })
    if (existing) {
      if (existing.pageType !== 'html') {
        console.error(`  ✗ ${p.title}: 동명의 블록 페이지 존재(${existing.id}) — 건너뜀`)
        continue
      }
      await prisma.wikiPage.update({
        where: { id: existing.id },
        data: {
          contentHtml,
          plainText,
          icon: p.icon ?? undefined,
          lastEditorId: author.id,
        },
      })
      updated++
      console.log(`  ↻ 갱신: ${p.title} (${existing.id})`)
    } else {
      const page = await prisma.wikiPage.create({
        data: {
          title: p.title,
          icon: p.icon ?? null,
          parentId: category.id,
          pageType: 'html',
          contentHtml,
          contentJson: [],
          plainText,
          sortOrder: i + 1,
          authorId: author.id,
          lastEditorId: author.id,
        },
        select: { id: true },
      })
      created++
      console.log(`  + 생성: ${p.title} (${page.id})`)
    }
  }

  console.log(`완료 — 생성 ${created}건, 갱신 ${updated}건 (총 ${manifest.pages.length}건)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
