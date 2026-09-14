/**
 * thynC 위키 실시간 동시편집(Yjs) 협업 서버 — Hocuspocus 기반.
 *
 * Next.js 앱(thync)과 별개의 독립 프로세스. WebSocket으로 편집 변경(update)·커서(awareness)를
 * 중계하고, Y.Doc을 wiki.wiki_page_ydoc(진실의 원천)에 영속화한다.
 * 저장 시점마다 Y.Doc → BlockNote 블록으로 변환해 wiki_pages.content_json/plain_text(검색·렌더 스냅샷)와
 * 백링크(wiki_page_links)·버전 스냅샷(wiki_versions)·최근 수정자를 동기화한다 (materialize.ts).
 *
 * 모듈 경계: 위키 전용 독립 서비스. 메인 Next 앱은 이 서버를 import 하지 않는다.
 * 실행: esbuild 번들(dist/index.mjs, `npm run build:collab`). PM2 프로세스 thync-collab(-prod).
 * 배포: 소스(이 파일·materialize.ts·lib/wiki/wikiSchema.tsx·lib/wiki/blockText.ts) 변경 시
 *       `npm run build:collab` 후 `pm2 restart thync-collab-prod` 필수 (CLAUDE.md PROD 반영 절차).
 */
import 'dotenv/config'
import { Hocuspocus } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { PrismaClient } from '@prisma/client'
import { jwtVerify } from 'jose'
import * as Y from 'yjs'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { wikiSchema } from '../lib/wiki/wikiSchema'
import { materializePage, type CollabUser } from './materialize'

const prisma = new PrismaClient()
const secret = new TextEncoder().encode(process.env.JWT_SECRET!)
const PORT = Number(process.env.COLLAB_PORT || 1234)

/** lib/wiki/access.ts와 동일 정책 — 위키는 SEERS 소속 OR wiki.access 권한 (메인 lib은 next 의존이라 여기서 자체 구현) */
const WIKI_ALLOWED_ORG_CODES = ['SEERS']

// 클라이언트와 동일한 스키마로 Y.Doc ↔ 블록 변환 (불일치 시 변환 손상)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blockEditor = ServerBlockNoteEditor.create({ schema: wikiSchema } as any)

type JWTUser = { userId: string; name: string; email: string | null; role: string }

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

async function verifyUser(token?: string): Promise<JWTUser | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = payload as any
    if (!p?.userId) return null
    return { userId: p.userId, name: p.name ?? '', email: p.email ?? null, role: p.role ?? 'VIEWER' }
  } catch {
    return null
  }
}

/** DB 실시간 소속·활성·권한 판정 — JWT는 최대 7일(유지 시 365일) stale 이므로 여기서 다시 본다 */
async function checkWikiAccess(jwtUser: JWTUser): Promise<{ role: string } | null> {
  const row = await prisma.user.findUnique({
    where: { id: jwtUser.userId },
    select: { isActive: true, role: true, organization: { select: { code: true } } },
  })
  if (!row || !row.isActive) return null
  const code = row.organization?.code
  if (code && WIKI_ALLOWED_ORG_CODES.includes(code)) return { role: row.role }
  if (row.role === 'SUPER_ADMIN') return { role: row.role }
  // RBAC Lite 가산 — wiki.access 권한 (lib/appRoles.hasPermission과 같은 판정, 캐시 없음)
  const grants = await prisma.appUserRole.findMany({
    where: { userId: jwtUser.userId, role: { isActive: true } },
    select: { role: { select: { permissions: { select: { permKey: true } } } } },
  })
  const allowed = grants.some((g) => g.role.permissions.some((p) => p.permKey === 'wiki.access'))
  return allowed ? { role: row.role } : null
}

const server = new Hocuspocus({
  name: 'thync-wiki-collab',
  port: PORT,

  // ── 인증·권한 ─────────────────────────────────────────────
  // httpOnly 쿠키(auth-token)를 WS 업그레이드 헤더에서 읽어 JWT 검증 → DB에서 활성·소속(SEERS OR wiki.access) 재확인.
  // VIEWER(DB 등급 기준)는 읽기 전용, 삭제/없는 페이지는 연결 거부.
  async onConnect({ documentName, requestHeaders, connection }) {
    const token = parseCookies(requestHeaders.cookie)['auth-token']
    const jwtUser = await verifyUser(token)
    if (!jwtUser) throw new Error('Unauthorized')

    // DB 조회 실패(일시 연결 오류 등)는 평문 Error로 바꿔 던진다 — Prisma 오류 객체를 그대로 던지면
    // Hocuspocus가 그 `code`('P1001' 같은 문자열)로 소켓을 닫으려다 TypeError를 낸다.
    let access: { role: string } | null
    let page: { deletedAt: Date | null } | null
    try {
      access = await checkWikiAccess(jwtUser)
      page = await prisma.wikiPage.findUnique({
        where: { id: documentName },
        select: { deletedAt: true },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n').filter(Boolean)[0] : String(e)
      console.error(`[collab] onConnect DB 조회 실패: ${documentName} — ${(msg ?? '').slice(0, 200)}`)
      throw new Error('Forbidden')
    }
    if (!access) throw new Error('Forbidden')
    if (!page || page.deletedAt) throw new Error('Document not found')

    const user: CollabUser = { ...jwtUser, role: access.role }
    if (user.role === 'VIEWER') connection.readOnly = true
    return { user }
  },

  extensions: [
    new Database({
      // 문서 로드: 저장된 Y.Doc 있으면 반환, 없으면 기존 content_json으로 1회 시딩
      async fetch({ documentName }) {
        const row = await prisma.wikiPageYdoc.findUnique({ where: { pageId: documentName } })
        if (row) return new Uint8Array(row.state)

        const page = await prisma.wikiPage.findUnique({
          where: { id: documentName },
          select: { contentJson: true },
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const blocks = Array.isArray(page?.contentJson) ? (page!.contentJson as any[]) : []
        if (!blocks.length) return null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ydoc = blockEditor.blocksToYDoc(blocks as any, 'prosemirror')
        return Y.encodeStateAsUpdate(ydoc)
      },

      // 문서 저장(디바운스 2s/최대 10s): Y.Doc 바이너리 + 스냅샷·백링크·버전·최근 수정자 동기화.
      // context는 디바운스 창 안에서 마지막으로 update를 보낸 접속의 것 → 저장자는 "마지막 입력자".
      async store({ documentName, state, document, context }) {
        const buf = Buffer.from(state)
        await prisma.wikiPageYdoc.upsert({
          where: { pageId: documentName },
          create: { pageId: documentName, state: buf },
          update: { state: buf, updatedAt: new Date() },
        })

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const user = ((context as any)?.user ?? null) as CollabUser | null
          await materializePage({
            prisma,
            blockEditor,
            pageId: documentName,
            doc: document as unknown as Y.Doc,
            user,
            mode: 'store',
          })
        } catch (e) {
          // 블록 덤프 금지 — 페이지 id + 메시지 1줄만 (이전엔 실패마다 본문 전체를 찍어 로그가 29MB까지 자랐다)
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[collab] 스냅샷 동기화 실패: ${documentName} — ${msg.split('\n')[0].slice(0, 300)}`)
        }
      },
    }),
  ],
})

server.listen()
console.log(`[collab] thynC wiki collab server listening on :${PORT}`)
