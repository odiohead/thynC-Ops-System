/**
 * thynC 위키 실시간 동시편집(Yjs) 협업 서버 — Hocuspocus 기반.
 *
 * Next.js 앱(thync)과 별개의 독립 프로세스. WebSocket으로 편집 변경(update)·커서(awareness)를
 * 중계하고, Y.Doc을 wiki.wiki_page_ydoc(진실의 원천)에 영속화한다.
 * 저장 시점마다 Y.Doc → BlockNote 블록으로 변환해 wiki_pages.content_json/plain_text(검색·렌더 스냅샷)와
 * 백링크(wiki_page_links)를 동기화한다.
 *
 * 모듈 경계: 위키 전용 독립 서비스. 메인 Next 앱은 이 서버를 import 하지 않는다.
 * 실행: tsx(ESM). PM2 프로세스 thync-collab.
 */
import 'dotenv/config'
import { Hocuspocus } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { PrismaClient, type Prisma } from '@prisma/client'
import { jwtVerify } from 'jose'
import * as Y from 'yjs'
import { ServerBlockNoteEditor } from '@blocknote/server-util'
import { wikiSchema } from '../lib/wiki/wikiSchema'
import { extractPlainTextFromBlocks, extractPageLinks } from '../lib/wiki/blockText'

const prisma = new PrismaClient()
const secret = new TextEncoder().encode(process.env.JWT_SECRET!)
const PORT = Number(process.env.COLLAB_PORT || 1234)

// 클라이언트와 동일한 스키마로 Y.Doc ↔ 블록 변환 (불일치 시 변환 손상)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blockEditor = ServerBlockNoteEditor.create({ schema: wikiSchema } as any)

type JWTUser = { userId: string; name: string; role: string }

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
    return { userId: p.userId, name: p.name ?? '', role: p.role ?? 'VIEWER' }
  } catch {
    return null
  }
}

const server = new Hocuspocus({
  name: 'thync-wiki-collab',
  port: PORT,

  // ── 인증·권한 ─────────────────────────────────────────────
  // httpOnly 쿠키(auth-token)를 WS 업그레이드 헤더에서 읽어 JWT 검증.
  // VIEWER는 읽기 전용, 삭제/템플릿/없는 페이지는 연결 거부.
  async onConnect({ documentName, requestHeaders, connection }) {
    const token = parseCookies(requestHeaders.cookie)['auth-token']
    const user = await verifyUser(token)
    if (!user) throw new Error('Unauthorized')

    const page = await prisma.wikiPage.findUnique({
      where: { id: documentName },
      select: { deletedAt: true },
    })
    if (!page || page.deletedAt) throw new Error('Document not found')

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

      // 문서 저장(디바운스): Y.Doc 바이너리 + 검색/렌더 스냅샷 + 백링크 동기화
      async store({ documentName, state, document }) {
        const buf = Buffer.from(state)
        await prisma.wikiPageYdoc.upsert({
          where: { pageId: documentName },
          create: { pageId: documentName, state: buf },
          update: { state: buf, updatedAt: new Date() },
        })

        try {
          const blocks = blockEditor.yDocToBlocks(document as unknown as Y.Doc, 'prosemirror')
          const plainText = extractPlainTextFromBlocks(blocks)
          const targets = extractPageLinks(blocks).filter((t) => t !== documentName)

          await prisma.$transaction(async (tx) => {
            await tx.wikiPage.update({
              where: { id: documentName },
              data: {
                contentJson: blocks as unknown as Prisma.InputJsonValue,
                plainText,
              },
            })
            await tx.wikiPageLink.deleteMany({ where: { sourcePageId: documentName } })
            if (targets.length) {
              const existing = await tx.wikiPage.findMany({
                where: { id: { in: targets } },
                select: { id: true },
              })
              if (existing.length) {
                await tx.wikiPageLink.createMany({
                  data: existing.map((e) => ({ sourcePageId: documentName, targetPageId: e.id })),
                  skipDuplicates: true,
                })
              }
            }
          })
        } catch (e) {
          console.error('[collab] 스냅샷 동기화 실패:', documentName, e)
        }
      },
    }),
  ],
})

server.listen()
console.log(`[collab] thynC wiki collab server listening on :${PORT}`)
