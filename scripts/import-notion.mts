/**
 * Notion 마크다운 익스포트 → 사내 위키 임포트 스크립트
 *
 * 사용법:
 *   npx tsx scripts/import-notion.mts <export_dir> [--dry-run] [--author-email <email>]
 *
 * 예:
 *   npx tsx scripts/import-notion.mts /tmp/thync_notion/notion_extracted --dry-run
 *   npx tsx scripts/import-notion.mts /tmp/thync_notion/notion_extracted
 *
 * 동작:
 *   1. <export_dir> 하위를 알파벳 순으로 워킹
 *   2. 각 .md 파일 → 위키 페이지 1개
 *   3. 같은 이름의 폴더가 있으면 그 페이지의 하위로 재귀
 *   4. 파일명에서 Notion ID suffix(32자 hex) 제거 → 깨끗한 제목
 *   5. 첫 H1 제목 + 직후 `---` 구분선 제거 (제목은 별도 컬럼이라)
 *   6. 이미지 라인 / 로컬 파일 링크 제거 (요청대로 파일은 안 가져옴)
 *   7. BlockNote ServerBlockNoteEditor로 마크다운 → 블록 JSON 변환
 *   8. Prisma 직접 INSERT (HTTP 안 거침)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient, Prisma } from '@prisma/client'
import { ServerBlockNoteEditor } from '@blocknote/server-util'

// ──────────────────────────────────────────────────────────
// 인자 파싱
// ──────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const authorEmailIdx = args.indexOf('--author-email')
const authorEmail =
  authorEmailIdx >= 0 ? args[authorEmailIdx + 1] : 'joon.lee@seers.co.kr'
const positional = args.filter((a, i) => {
  if (a.startsWith('--')) return false
  if (i > 0 && args[i - 1] === '--author-email') return false
  return true
})
const exportDir = positional[0]
if (!exportDir) {
  console.error('Usage: npx tsx scripts/import-notion.mts <export_dir> [--dry-run] [--author-email <email>]')
  process.exit(1)
}

// ──────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────
const NOTION_ID_REGEX = /\s+[0-9a-f]{32}(\.md)?$/i

function stripNotionId(name: string): string {
  return name.replace(NOTION_ID_REGEX, (_, ext) => ext ?? '')
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function extractTitleAndBody(md: string): { title: string | null; body: string } {
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i >= lines.length) return { title: null, body: '' }
  const first = lines[i].trim()
  if (!first.startsWith('# ')) return { title: null, body: md }
  const title = first.replace(/^#\s+/, '').trim()
  let bodyStart = i + 1
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++
  if (bodyStart < lines.length && lines[bodyStart].trim() === '---') {
    bodyStart++
    while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++
  }
  return { title, body: lines.slice(bodyStart).join('\n') }
}

const FILE_EXT_RE = /\.(pdf|pptx?|docx?|xlsx?|zip|tar|gz|7z|rar|hwp|hwpx)$/i
const IMAGE_LINE_RE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/
const IMAGE_INLINE_RE = /!\[[^\]]*\]\([^)]*\)/g
const FILE_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

function preprocessMarkdown(md: string): string {
  return md
    .split('\n')
    .filter((line) => !IMAGE_LINE_RE.test(line))
    .map((line) => line.replace(IMAGE_INLINE_RE, ''))
    .map((line) =>
      line.replace(FILE_LINK_RE, (full, text, url) => {
        // 로컬 첨부 파일 링크는 텍스트만 남김. 외부 URL은 보존.
        if (FILE_EXT_RE.test(url) || !/^https?:\/\//.test(url)) return text
        return full
      }),
    )
    .join('\n')
}

// ──────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────
const prisma = new PrismaClient()
const editor = ServerBlockNoteEditor.create()

const stats = { pagesCreated: 0, skipped: 0, errors: 0 }

async function getAuthor(): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email: authorEmail },
    select: { id: true, name: true },
  })
  if (!user) throw new Error(`작성자 사용자(${authorEmail})를 찾을 수 없습니다.`)
  console.log(`✔ 작성자: ${user.name} (${authorEmail}) [id=${user.id}]`)
  return user.id
}

async function importMarkdownFile(
  filePath: string,
  parentId: string | null,
  authorId: string,
  sortOrder: number,
  depth: number,
): Promise<string | null> {
  const fileName = filePath.split('/').pop() ?? filePath
  const baseName = stripNotionId(fileName).replace(/\.md$/, '')
  const raw = readFileSync(filePath, 'utf8')
  const { title: headingTitle, body } = extractTitleAndBody(raw)
  const title = headingTitle || baseName
  const cleanBody = preprocessMarkdown(body)

  let blocks: unknown[]
  try {
    const parsed = await editor.tryParseMarkdownToBlocks(cleanBody)
    // BlockNote가 테이블 블록 등에서 columnWidths:[undefined] 같은 값을 생성하는데
    // Prisma JSONB는 배열 내 undefined를 거부 → JSON 라운드트립으로 null/제거
    blocks = JSON.parse(JSON.stringify(parsed)) as unknown[]
  } catch (e) {
    console.error(`  ✗ [${title}] 마크다운 파싱 실패:`, (e as Error).message)
    stats.errors++
    return null
  }

  const indent = '  '.repeat(depth)
  console.log(
    `${indent}• ${title} (blocks=${(blocks as unknown[]).length}, sortOrder=${sortOrder}${parentId ? '' : ', root'})`,
  )

  if (dryRun) {
    stats.pagesCreated++
    // dry-run에서는 실제 ID 없으므로 임시값 — 자식 임포트는 fake 부모 id로 시뮬레이션
    return `dry-${stats.pagesCreated}`
  }

  const created = await prisma.wikiPage.create({
    data: {
      title,
      parentId,
      contentJson: blocks as Prisma.InputJsonValue,
      authorId,
      lastEditorId: authorId,
      sortOrder,
      isPublished: true,
    },
    select: { id: true },
  })
  stats.pagesCreated++
  return created.id
}

async function importDirectory(
  dirPath: string,
  parentId: string | null,
  authorId: string,
  depth: number,
): Promise<void> {
  const entries = readdirSync(dirPath)
  // .md 파일 + 매칭되는 디렉토리 식별
  const mdFiles = entries.filter((e) => e.endsWith('.md') && isFile(join(dirPath, e)))
  const dirs = new Set(entries.filter((e) => isDir(join(dirPath, e))))
  // 알파벳 순(파일명 기준) 정렬 — Notion이 번호 prefix 붙여놓은 경우 그 순서대로 들어옴
  mdFiles.sort((a, b) => a.localeCompare(b, 'ko'))

  let sortOrder = 0
  const consumedDirs = new Set<string>()

  for (const mdFile of mdFiles) {
    const fullPath = join(dirPath, mdFile)
    const baseName = stripNotionId(mdFile).replace(/\.md$/, '')
    // 매칭 폴더 찾기: 같은 베이스 이름의 디렉토리
    let matchedDir: string | null = null
    for (const d of dirs) {
      const dBase = stripNotionId(d)
      if (dBase === baseName) {
        matchedDir = d
        break
      }
    }

    const newId = await importMarkdownFile(fullPath, parentId, authorId, sortOrder++, depth)
    if (newId && matchedDir) {
      consumedDirs.add(matchedDir)
      await importDirectory(join(dirPath, matchedDir), newId, authorId, depth + 1)
    }
  }

  // .md 없이 단독으로 존재하는 폴더 (드물지만 가능) — 폴더 자체를 빈 페이지로
  for (const d of dirs) {
    if (consumedDirs.has(d)) continue
    const indent = '  '.repeat(depth)
    console.log(`${indent}⚠ 짝 없는 폴더 무시: ${d}`)
    stats.skipped++
  }
}

// ──────────────────────────────────────────────────────────
async function main() {
  console.log(`📂 Export dir: ${exportDir}`)
  console.log(`🧪 Dry-run: ${dryRun ? 'YES (no DB writes)' : 'NO (will write to DB)'}`)
  console.log()

  if (!isDir(exportDir)) {
    console.error(`❌ 디렉토리 아님: ${exportDir}`)
    process.exit(1)
  }

  const authorId = await getAuthor()
  console.log()

  await importDirectory(exportDir, null, authorId, 0)

  console.log()
  console.log('═══════════════════════════════════════════')
  console.log(`✅ 페이지 ${dryRun ? '미리보기' : '생성'}: ${stats.pagesCreated}`)
  console.log(`⚠ 건너뜀: ${stats.skipped}`)
  console.log(`✗ 에러: ${stats.errors}`)
  console.log('═══════════════════════════════════════════')

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
