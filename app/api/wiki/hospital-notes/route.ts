import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import {
  HOSPITAL_NOTE_REF_TYPE,
  HOSPITAL_NOTE_PAGE_ICON,
  ensureHospitalNoteRoot,
  findHospitalNotePage,
} from '@/lib/wiki/hospitalNote'

/**
 * 병원 노트 조회/생성 (function_ai_assistant.html §6.3)
 * - GET  ?hospitalCode= : 해당 병원의 노트 페이지(본문 포함) 또는 null
 * - POST { hospitalCode } : 노트 페이지 생성 (USER+, 병원당 1개 멱등)
 *
 * 병원 노트는 **담당자가 직접 쓰는 병원 특이사항 메모**다. 편집은 협업 서버(Y.Doc)가 담당한다.
 *
 * ⚠️ 상담이력 append는 2026-07-26에 폐지되었다.
 *    상담이력의 원본은 `consultations` 테이블이며 병원 상세 '상담이력' 카드에서 조회한다.
 *    구 방식(마크다운 append)은 ① 협업 Y.Doc과 content_json 이중 기록이라 노트가 열려 있으면
 *    덮여 사라졌고 ② 작성자·유형이 헤딩 문자열이라 구조화 조회가 불가능했으며
 *    ③ 청크 인덱스가 갱신되지 않아 AI 검색에 잡히지 않았다.
 *    설계·근거: consultation_history_design.md
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
  const { hospitalCode } = body as { hospitalCode?: string }
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

  return NextResponse.json(
    { id: note.id, existed: !note.created },
    { status: note.created ? 201 : 200 },
  )
}
