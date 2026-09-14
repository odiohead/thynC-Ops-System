/**
 * Y.Doc → 스냅샷(content_json/plain_text)·백링크·버전·최근 수정자 동기화 — 협업 서버 store()와
 * 1회성 재동기화 스크립트(resync.mts)가 공유하는 단일 구현.
 *
 * 2026-09-12 검토(projects/wiki_next_gen_review.md) A-1~A-3 반영:
 * - A-1: BlockNote 표 블록의 columnWidths에 undefined가 들어와 Prisma가 거부하던 문제 → JSON 왕복으로 정규화
 *        (REST PUT 경로는 클라이언트 JSON.stringify가 같은 일을 해 주고 있었다. scripts/import-notion.mts:143 선례)
 * - A-2: 협업 편집도 wiki_versions에 스냅샷 (REST와 같은 2분 throttle + 직전 버전과 내용 상이 시)
 * - A-3: 협업 편집도 last_editor_id 갱신 + 버전 스냅샷 시점에 감사로그 1건 (store()마다 남기면 소음)
 * 내용이 바뀌지 않은 store(표를 열기만 함, 서식 없는 재저장)는 아무것도 갱신하지 않는다 —
 * 그래야 최근 수정자·수정일이 열람자로 오염되지 않는다.
 *
 * 모듈 경계: lib/wiki/* 와 prisma만 사용. 메인 앱 코드(lib/auth, lib/audit 등)는 import 하지 않는다
 * (next/server 타입 의존 때문에 번들 불가).
 */
import type { PrismaClient, Prisma } from '@prisma/client'
import type * as Y from 'yjs'
import type { ServerBlockNoteEditor } from '@blocknote/server-util'
import { extractPlainTextFromBlocks, extractPageLinks } from '../lib/wiki/blockText'

export type CollabUser = { userId: string; name: string; email?: string | null; role: string }

/** REST PUT 경로와 동일 — 자동저장으로 버전이 폭증하지 않도록 마지막 스냅샷이 이 시간 이상 지났을 때만 */
export const VERSION_INTERVAL_MS = 2 * 60 * 1000

export type MaterializeResult = {
  changed: boolean
  versioned: boolean
  plainTextLength: number
  /** 재동기화 보고용 — 이전 스냅샷 plain_text 길이 */
  previousPlainTextLength: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = { yDocToBlocks: (doc: Y.Doc, fragment: string) => any }

/**
 * 키 순서에 무관한 정규 직렬화 — Postgres jsonb는 객체 키를 재정렬해 돌려주므로(길이순→사전순)
 * DB에서 읽은 content_json과 방금 변환한 블록을 JSON.stringify로 비교하면 내용이 같아도 항상 다르게 나온다.
 * (재동기화 dry-run에서 83페이지 전부 '변경'으로 잡혀 발견)
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k])
    return out
  }
  return v
}

export async function materializePage(opts: {
  prisma: PrismaClient
  blockEditor: ServerBlockNoteEditor<any, any, any> | AnyEditor // eslint-disable-line @typescript-eslint/no-explicit-any
  pageId: string
  doc: Y.Doc
  /** store(): 마지막 update를 보낸 접속의 사용자. 재동기화·DirectConnection에서는 null */
  user?: CollabUser | null
  /** 'store' = 협업 저장(버전·최근 수정자·감사 포함) / 'resync' = 스냅샷만 */
  mode: 'store' | 'resync'
  /** true면 DB에 쓰지 않고 판정만 */
  dryRun?: boolean
}): Promise<MaterializeResult | null> {
  const { prisma, blockEditor, pageId, doc, mode, dryRun } = opts
  const user = mode === 'store' ? (opts.user ?? null) : null

  // A-1: undefined(표 columnWidths 등)를 JSON 규격으로 정규화 — 배열 안은 null, 객체 키는 제거
  const rawBlocks = blockEditor.yDocToBlocks(doc, 'prosemirror')
  const blocks = JSON.parse(JSON.stringify(rawBlocks)) as unknown[]
  const plainText = extractPlainTextFromBlocks(blocks)
  const targets = extractPageLinks(blocks).filter((t) => t !== pageId)

  const existing = await prisma.wikiPage.findUnique({
    where: { id: pageId },
    select: { title: true, contentJson: true, plainText: true, updatedAt: true, deletedAt: true },
  })
  if (!existing) return null

  const previousPlainTextLength = existing.plainText.length
  const changed = canonicalJson(existing.contentJson) !== canonicalJson(blocks)
  if (!changed) {
    return { changed: false, versioned: false, plainTextLength: plainText.length, previousPlainTextLength }
  }
  if (dryRun) {
    return { changed: true, versioned: false, plainTextLength: plainText.length, previousPlainTextLength }
  }

  let versioned = false
  await prisma.$transaction(async (tx) => {
    // A-2: 직전 상태 스냅샷 (협업 편집자 있을 때만, 직전 본문이 비어 있지 않고, 2분 throttle, 직전 버전과 내용 상이)
    if (user) {
      const prevBlocks = existing.contentJson
      const prevNonEmpty = Array.isArray(prevBlocks) && prevBlocks.length > 0 && existing.plainText.trim().length > 0
      if (prevNonEmpty) {
        const lastVersion = await tx.wikiVersion.findFirst({
          where: { pageId },
          orderBy: { savedAt: 'desc' },
          select: { savedAt: true, contentJson: true },
        })
        const intervalOk =
          !lastVersion || existing.updatedAt.getTime() - lastVersion.savedAt.getTime() > VERSION_INTERVAL_MS
        const differsFromLast =
          !lastVersion || canonicalJson(lastVersion.contentJson) !== canonicalJson(prevBlocks)
        if (intervalOk && differsFromLast) {
          await tx.wikiVersion.create({
            data: {
              pageId,
              title: existing.title,
              contentJson: prevBlocks as Prisma.InputJsonValue,
              savedById: user.userId,
            },
          })
          versioned = true
        }
      }
    }

    await tx.wikiPage.update({
      where: { id: pageId },
      data: {
        contentJson: blocks as unknown as Prisma.InputJsonValue,
        plainText,
        // A-3: 협업 편집자를 최근 수정자로 (내용이 실제로 바뀐 저장에서만)
        ...(user ? { lastEditorId: user.userId } : {}),
      },
    })

    await tx.wikiPageLink.deleteMany({ where: { sourcePageId: pageId } })
    if (targets.length) {
      const existingTargets = await tx.wikiPage.findMany({
        where: { id: { in: targets } },
        select: { id: true },
      })
      if (existingTargets.length) {
        await tx.wikiPageLink.createMany({
          data: existingTargets.map((e) => ({ sourcePageId: pageId, targetPageId: e.id })),
          skipDuplicates: true,
        })
      }
    }

    // A-3: 감사로그는 버전 스냅샷이 실제 생성된 시점에 1건만 (디바운스 창마다 남기면 공용 audit_logs가 위키 소음으로 찬다)
    if (user && versioned) {
      await tx.auditLog.create({
        data: {
          actorId: user.userId,
          actorEmail: user.email ?? null,
          actorName: user.name || '시스템',
          actorRole: user.role,
          action: 'UPDATE',
          resource: 'wiki_page',
          resourceId: pageId,
          resourceLabel: existing.title,
          after: { contentChanged: true, via: 'collab', versionSnapshot: true } as Prisma.InputJsonValue,
        },
      })
    }
  })

  return { changed: true, versioned, plainTextLength: plainText.length, previousPlainTextLength }
}
