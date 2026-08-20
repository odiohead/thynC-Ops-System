import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess } from '@/lib/weeklyAccess'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { isEmptyRichText, sanitizeRichTextHtml } from '@/lib/richtext'
import { NOTE_INCLUDE, toNoteDto, ymd } from '../../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 주간 특이사항 엔트리 수정·삭제
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })
  }
  const body = await request.json().catch(() => null)
  // 리치텍스트(HTML) 저장 — sanitize 후 태그 제거 기준으로 빈 내용 판정 (2026-08-20)
  const content = typeof body?.content === 'string' ? sanitizeRichTextHtml(body.content.trim()) : ''
  if (!content || isEmptyRichText(content)) {
    return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 })
  }

  const before = await prisma.weeklyWeekNote.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '특이사항을 찾을 수 없습니다.' }, { status: 404 })

  const row = await prisma.weeklyWeekNote.update({
    where: { id },
    data: { content, updatedById: user.userId },
    include: NOTE_INCLUDE,
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'weekly_week_note',
    resourceId: id,
    resourceLabel: `주간 특이사항 ${ymd(row.weekStart)}`,
    before,
    after: row,
  })

  return NextResponse.json({ note: toNoteDto(row) })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })
  }
  const before = await prisma.weeklyWeekNote.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '특이사항을 찾을 수 없습니다.' }, { status: 404 })

  await prisma.weeklyWeekNote.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'weekly_week_note',
    resourceId: id,
    resourceLabel: `주간 특이사항 ${ymd(before.weekStart)}`,
    before,
  })
  return NextResponse.json({ success: true })
}
