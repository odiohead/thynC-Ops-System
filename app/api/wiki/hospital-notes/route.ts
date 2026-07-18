import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { extractPlainTextFromBlocks } from '@/lib/wiki/blockText'
import {
  HOSPITAL_NOTE_REF_TYPE,
  HOSPITAL_NOTE_PAGE_ICON,
  ensureHospitalNoteRoot,
  findHospitalNotePage,
} from '@/lib/wiki/hospitalNote'

/**
 * 병원 노트 조회/생성/상담이력 append (function_ai_assistant.html §6.3)
 * - GET  ?hospitalCode= : 해당 병원의 노트 페이지(본문 포함) 또는 null
 * - POST { hospitalCode }               : 노트 페이지 생성 (USER+, 병원당 1개 멱등)
 * - POST { hospitalCode, appendMd, consultationType?, consultedBy? } :
 *     상담 정제 마크다운을 노트 하단에 append (노트 없으면 자동 생성)
 *
 * ⚠️ 협업(Y.Doc) 정합성: append는 content_json 직접 갱신 방식.
 *    노트가 협업 세션으로 열려 있는 동안의 append는 다음 협업 저장에 덮일 수 있음(설계서 리스크 명시).
 */

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hospitalCode = new URL(request.url).searchParams.get('hospitalCode')
  if (!hospitalCode) {
    return NextResponse.json({ error: 'hospitalCode is required' }, { status: 400 })
  }
  const page = await findHospitalNotePage(hospitalCode)
  return NextResponse.json({ page })
}

async function getOrCreateNotePage(hospitalCode: string, userId: string, hospitalName: string) {
  const existing = await findHospitalNotePage(hospitalCode)
  if (existing) return { id: existing.id, created: false }

  const rootId = await ensureHospitalNoteRoot(userId)
  const result = await prisma.$transaction(async (tx) => {
    const dup = await tx.wikiPageReference.findFirst({
      where: { refType: HOSPITAL_NOTE_REF_TYPE, refCode: hospitalCode, page: { deletedAt: null } },
      select: { pageId: true },
    })
    if (dup) return { id: dup.pageId, created: false }
    const page = await tx.wikiPage.create({
      data: {
        title: hospitalName,
        icon: HOSPITAL_NOTE_PAGE_ICON,
        parentId: rootId,
        contentJson: [],
        plainText: '',
        authorId: userId,
        lastEditorId: userId,
        references: {
          create: { refType: HOSPITAL_NOTE_REF_TYPE, refCode: hospitalCode, createdById: userId },
        },
      },
      select: { id: true },
    })
    return { id: page.id, created: true }
  })
  return result
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { hospitalCode, appendMd, consultationType } = body as {
    hospitalCode?: string
    appendMd?: string
    consultationType?: string
  }
  if (!hospitalCode) {
    return NextResponse.json({ error: 'hospitalCode is required' }, { status: 400 })
  }

  const hospital = await prisma.hospital.findUnique({
    where: { hospitalCode },
    select: { hospitalCode: true, hospitalName: true },
  })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const note = await getOrCreateNotePage(hospitalCode, authUser.userId, hospital.hospitalName)

  if (note.created) {
    await logAudit({
      req: request,
      actor: auditActorFromJWT(authUser),
      action: 'CREATE',
      resource: 'wiki_page',
      resourceId: note.id,
      resourceLabel: `${hospital.hospitalName} (병원 노트)`,
      after: { hospitalCode },
    })
  }

  // ── append 없는 호출 = 생성만 ──
  if (!appendMd || !appendMd.trim()) {
    return NextResponse.json({ id: note.id, existed: !note.created }, { status: note.created ? 201 : 200 })
  }

  // ── 상담이력 append ──
  const todayKst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const heading = `${todayKst} 상담 (${authUser.name})${consultationType ? ` — ${consultationType}` : ''}`

  // server-util은 빌드 페이지 수집과 충돌해 런타임 동적 로드 (실패 시 문단 폴백)
  let bodyBlocks: unknown[]
  try {
    const { ServerBlockNoteEditor } = await import('@blocknote/server-util')
    const editor = ServerBlockNoteEditor.create()
    bodyBlocks = await editor.tryParseMarkdownToBlocks(appendMd)
  } catch (e) {
    console.error('[hospital-notes] markdown→blocks 변환 실패, 문단 폴백 사용:', e)
    bodyBlocks = appendMd.split(/\n{2,}/).map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p, styles: {} }],
    }))
  }
  const appendBlocks: unknown[] = [
    { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: heading, styles: {} }] },
    ...bodyBlocks,
  ]

  const page = await prisma.wikiPage.findUnique({
    where: { id: note.id },
    select: { contentJson: true, title: true },
  })
  const current = Array.isArray(page?.contentJson) ? (page!.contentJson as unknown[]) : []
  const nextContent = [...current, ...appendBlocks]

  await prisma.$transaction(async (tx) => {
    // 직전 상태 버전 스냅샷 (append 이력 추적)
    await tx.wikiVersion.create({
      data: {
        pageId: note.id,
        title: page?.title ?? hospital.hospitalName,
        contentJson: (page?.contentJson ?? []) as Prisma.InputJsonValue,
        savedById: authUser.userId,
      },
    })
    await tx.wikiPage.update({
      where: { id: note.id },
      data: {
        contentJson: nextContent as Prisma.InputJsonValue,
        plainText: extractPlainTextFromBlocks(nextContent),
        lastEditorId: authUser.userId,
      },
    })
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'UPDATE',
    resource: 'wiki_page',
    resourceId: note.id,
    resourceLabel: `${hospital.hospitalName} (병원 노트 — 상담이력 추가)`,
    after: { hospitalCode, appended: heading },
  })

  return NextResponse.json({ id: note.id, appended: true })
}
