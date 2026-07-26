import { prisma } from '../prisma'

/**
 * 위키 청크 인덱스 생성 (v3 W1)
 *
 * 검색·반환 단위를 문서에서 헤딩 청크로 내린다. 68,772자짜리 API 규격서에서
 * 필요한 200자를 찾으려고 6,000자씩 선형으로 읽던 구조를 대체한다.
 *
 * 새 파서 의존성을 들이지 않고 기존 `htmlText.ts`와 같은 정규식 방식을 쓴다.
 * 표는 `셀 | 셀` 한 줄로 보존한다 — 평문 추출에서 표가 문장으로 뭉개져
 * "알람 4단계 표"류 질문의 답을 못 찾던 문제의 직접 해법이다.
 */

/** 목표 청크 길이 (문자) */
const TARGET_CHARS = 1200
/** 이 길이를 넘으면 줄 경계로 2차 분할 */
const MAX_CHARS = 2000
/** 이 길이 미만이면 다음 청크와 병합 (헤딩만 있고 본문이 짧은 절 방지) */
const MIN_CHARS = 200

export interface WikiChunkInput {
  ordinal: number
  headingPath: string
  text: string
  charStart: number
  charEnd: number
}

/** HTML 조각 → 평문. 표 구조(행/열)를 줄과 파이프로 보존한다 */
function htmlFragmentToText(html: string): string {
  let t = html
  t = t.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
  t = t.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
  t = t.replace(/<!--[\s\S]*?-->/g, ' ')
  // 표: 셀 경계는 ' | ', 행 경계는 개행으로 — 구조를 잃지 않게
  t = t.replace(/<\/(td|th)>/gi, ' | ')
  t = t.replace(/<\/(tr|table|thead|tbody)>/gi, '\n')
  // 블록 요소 경계도 개행 (줄 단위 2차 분할의 기준이 된다)
  t = t.replace(/<\/(p|div|li|ul|ol|h[1-6]|pre|blockquote|section|article)>/gi, '\n')
  t = t.replace(/<br\s*\/?>/gi, '\n')
  t = t.replace(/<[^>]+>/g, ' ')
  t = t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&middot;/gi, '·')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = parseInt(code, 10)
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : ' '
    })
  // 줄 단위 정리 (개행은 살리고 그 외 공백만 압축)
  return t
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/\s*\|\s*$/, '').trim())
    .filter(Boolean)
    .join('\n')
}

/** 비교용 정규화 — 공백·구두점 차이를 무시 */
const norm = (s: string) => s.replace(/[\s·:—\-.]/g, '').toLowerCase()

/**
 * 헤딩 스택 → "문서 제목 > 상위 > 하위" 경로
 * HTML 산출물은 대개 문서 제목과 같은 h1을 다시 갖고 있어 그대로 이으면 제목이 중복된다.
 * 문서 제목과 사실상 같은 헤딩은 경로에서 뺀다 (토큰 낭비 + 랭킹 노이즈 방지).
 */
function pathOf(docTitle: string, stack: { level: number; title: string }[]): string {
  const d = norm(docTitle)
  const parts = stack
    .map((s) => s.title)
    .filter((t) => {
      const n = norm(t)
      return n.length > 0 && n !== d && !d.includes(n)
    })
  return [docTitle, ...parts].join(' > ')
}

type RawSection = { headingPath: string; text: string }

/** 길이 초과 섹션을 줄 경계로 분할 — 표 한 줄은 쪼개지 않는다 */
function splitOversized(section: RawSection): RawSection[] {
  if (section.text.length <= MAX_CHARS) return [section]
  const out: RawSection[] = []
  let buf: string[] = []
  let len = 0
  for (const line of section.text.split('\n')) {
    if (len > 0 && len + line.length > TARGET_CHARS) {
      out.push({ headingPath: section.headingPath, text: buf.join('\n') })
      buf = []
      len = 0
    }
    buf.push(line)
    len += line.length + 1
  }
  if (buf.length > 0) out.push({ headingPath: section.headingPath, text: buf.join('\n') })
  return out
}

/** 너무 짧은 섹션을 뒤 섹션과 병합 (같은 상위 경로일 때만) */
function mergeTiny(sections: RawSection[]): RawSection[] {
  const out: RawSection[] = []
  for (const s of sections) {
    const prev = out[out.length - 1]
    if (prev && prev.text.length < MIN_CHARS && prev.text.length + s.text.length <= MAX_CHARS) {
      prev.text = `${prev.text}\n${s.text}`
      // 경로는 더 짧은(상위) 쪽을 유지해 대표성을 잃지 않게
      if (s.headingPath.length < prev.headingPath.length) prev.headingPath = s.headingPath
      continue
    }
    out.push({ ...s })
  }
  return out
}

function finalize(sections: RawSection[]): WikiChunkInput[] {
  const merged = mergeTiny(sections.flatMap(splitOversized)).filter((s) => s.text.trim().length > 0)
  let cursor = 0
  return merged.map((s, i) => {
    const start = cursor
    cursor += s.text.length + 1
    return {
      ordinal: i,
      headingPath: s.headingPath,
      text: s.text,
      charStart: start,
      charEnd: cursor - 1,
    }
  })
}

/** HTML 문서 페이지 청킹 — h1~h4 경계 기준 */
export function chunkHtmlDocument(html: string, docTitle: string): WikiChunkInput[] {
  const stack: { level: number; title: string }[] = []
  const sections: RawSection[] = []
  const re = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi

  let lastIndex = 0
  let currentPath = docTitle
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    // 직전 헤딩 이후 ~ 이번 헤딩 전까지가 이전 절의 본문
    const body = htmlFragmentToText(html.slice(lastIndex, m.index))
    if (body) sections.push({ headingPath: currentPath, text: body })

    const level = parseInt(m[1], 10)
    const title = htmlFragmentToText(m[2]).replace(/\n/g, ' ').trim()
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
    if (title) stack.push({ level, title })
    currentPath = pathOf(docTitle, stack)
    lastIndex = re.lastIndex
  }
  const tail = htmlFragmentToText(html.slice(lastIndex))
  if (tail) sections.push({ headingPath: currentPath, text: tail })

  return finalize(sections)
}

type BlockNode = { type?: string; props?: { level?: number }; content?: unknown; children?: unknown }

/** BlockNote 블록 배열에서 한 블록의 텍스트 추출 */
function blockText(node: BlockNode): string {
  const parts: string[] = []
  const walk = (c: unknown) => {
    if (Array.isArray(c)) return c.forEach(walk)
    if (c && typeof c === 'object') {
      const o = c as { text?: unknown; content?: unknown }
      if (typeof o.text === 'string') parts.push(o.text)
      if (o.content) walk(o.content)
    }
  }
  walk(node.content)
  return parts.join('').trim()
}

/** BlockNote 페이지 청킹 — heading 블록 경계 기준 */
export function chunkBlockDocument(contentJson: unknown, docTitle: string): WikiChunkInput[] {
  if (!Array.isArray(contentJson)) return []
  const stack: { level: number; title: string }[] = []
  const sections: RawSection[] = []
  let currentPath = docTitle
  let buf: string[] = []

  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) sections.push({ headingPath: currentPath, text })
    buf = []
  }

  const walkBlocks = (blocks: unknown[]) => {
    for (const raw of blocks) {
      const node = (raw ?? {}) as BlockNode
      if (node.type === 'heading') {
        flush()
        const level = Math.min(Math.max(node.props?.level ?? 1, 1), 4)
        const title = blockText(node)
        while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
        if (title) stack.push({ level, title })
        currentPath = pathOf(docTitle, stack)
      } else {
        const t = blockText(node)
        if (t) buf.push(t)
      }
      if (Array.isArray(node.children) && node.children.length > 0) walkBlocks(node.children)
    }
  }
  walkBlocks(contentJson)
  flush()

  return finalize(sections)
}

/** 페이지 형태에 따라 적절한 청킹기 선택 */
export function buildChunks(page: {
  title: string
  pageType: string
  contentHtml: string | null
  contentJson: unknown
}): WikiChunkInput[] {
  if (page.pageType === 'html') {
    return page.contentHtml ? chunkHtmlDocument(page.contentHtml, page.title) : []
  }
  return chunkBlockDocument(page.contentJson, page.title)
}

/**
 * 한 페이지의 청크를 재생성한다 (전량 교체).
 * 본문 저장 시 plainText 재계산과 같은 지점에서 호출한다.
 * 실패해도 저장 자체를 막지 않는다 — 청크는 검색 가속 인덱스이지 원본이 아니다.
 */
export async function rebuildPageChunks(pageId: string): Promise<number> {
  try {
    const page = await prisma.wikiPage.findUnique({
      where: { id: pageId },
      select: { title: true, pageType: true, contentHtml: true, contentJson: true, deletedAt: true },
    })
    if (!page || page.deletedAt) {
      await prisma.wikiChunk.deleteMany({ where: { pageId } })
      return 0
    }
    const chunks = buildChunks(page)
    await prisma.$transaction([
      prisma.wikiChunk.deleteMany({ where: { pageId } }),
      ...(chunks.length > 0
        ? [prisma.wikiChunk.createMany({ data: chunks.map((c) => ({ pageId, ...c })) })]
        : []),
      // 동기화 시각 표시 — 청크가 0개여도 표시해야 스케줄러가 같은 페이지를 매 주기 재시도하지 않는다.
      // ⚠️ raw SQL 필수: prisma.wikiPage.update를 쓰면 @updatedAt이 함께 올라
      //    updated_at > chunks_synced_at 조건이 영원히 참이 되어 무한 재생성에 빠진다.
      // ⚠️ timezone('UTC', now()) 필수: updated_at은 Prisma가 UTC를 naive timestamp로 넣는데,
      //    JS Date를 파라미터로 넘기면 드라이버가 서버 로컬시각으로 써서 KST 서버에서 9시간 앞선다.
      //    그러면 chunks_synced_at > updated_at이 계속 참이 되어 이후 편집이 9시간 동안 감지되지 않는다.
      prisma.$executeRaw`UPDATE "wiki"."wiki_pages" SET "chunks_synced_at" = timezone('UTC', now()) WHERE "id" = ${pageId}`,
    ])
    return chunks.length
  } catch (e) {
    console.error(`[wiki-chunk] 청크 재생성 실패 (page=${pageId}):`, e)
    return 0
  }
}
