import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { sanitizeRichTextHtml, isEmptyRichText } from '@/lib/richtext'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string; logId: string } }

// 코멘트 수정/삭제 — 본인 또는 ADMIN 이상. 시스템 이벤트는 불변.
async function loadCommentLog(params: Params['params']) {
  const id = parseInt(params.id)
  const logId = parseInt(params.logId)
  if (isNaN(id) || isNaN(logId)) return { error: '잘못된 ID입니다.', status: 400 as const }

  const log = await prisma.ticketLog.findUnique({ where: { id: logId } })
  if (!log || log.ticketId !== id) return { error: '기록을 찾을 수 없습니다.', status: 404 as const }
  if (log.logType !== 'comment') return { error: '시스템 이벤트는 수정/삭제할 수 없습니다.', status: 400 as const }
  return { log }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const loaded = await loadCommentLog(params)
  if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { log } = loaded

  if (log.authorId !== user.userId && !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '본인 코멘트만 수정할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json()
  const content = sanitizeRichTextHtml(typeof body.content === 'string' ? body.content : '')
  if (isEmptyRichText(content)) return NextResponse.json({ error: '코멘트 내용을 입력하세요.' }, { status: 400 })

  const updated = await prisma.ticketLog.update({
    where: { id: log.id },
    data: { contentHtml: content },
    include: { author: { select: { id: true, name: true } } },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'ticket_log',
    resourceId: log.id,
    resourceLabel: `티켓 코멘트 수정`,
    before: log,
    after: updated,
  })

  return NextResponse.json({ log: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const loaded = await loadCommentLog(params)
  if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { log } = loaded

  if (log.authorId !== user.userId && !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '본인 코멘트만 삭제할 수 있습니다.' }, { status: 403 })
  }

  await prisma.ticketLog.delete({ where: { id: log.id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'ticket_log',
    resourceId: log.id,
    resourceLabel: `티켓 코멘트 삭제`,
    before: log,
  })

  return NextResponse.json({ ok: true })
}
