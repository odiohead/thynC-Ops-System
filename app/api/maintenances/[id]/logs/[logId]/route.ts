import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove, JWTPayload } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { sanitizeRichTextHtml, isEmptyRichText } from '@/lib/richtext'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string; logId: string } }

const logInclude = {
  author: { select: { id: true, name: true } },
} as const

/** 본인 작성 또는 ADMIN 이상만 수정/삭제 가능. 이관분(author NULL)은 ADMIN 이상만. */
function canModify(user: JWTPayload, authorId: string | null): boolean {
  return isAdminOrAbove(user.role) || (authorId !== null && authorId === user.userId)
}

async function findLog(params: Params['params']) {
  const maintenanceId = parseInt(params.id)
  const logId = parseInt(params.logId)
  if (isNaN(maintenanceId) || isNaN(logId)) return null
  const log = await prisma.maintenanceLog.findUnique({ where: { id: logId }, include: logInclude })
  if (!log || log.maintenanceId !== maintenanceId) return null
  return log
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const log = await findLog(params)
  if (!log) return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 })
  if (!canModify(user, log.authorId)) {
    return NextResponse.json({ error: '본인이 작성한 기록만 수정할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json()
  const content = sanitizeRichTextHtml(typeof body.content === 'string' ? body.content : '')
  if (isEmptyRichText(content)) return NextResponse.json({ error: '기록 내용을 입력하세요.' }, { status: 400 })

  const updated = await prisma.maintenanceLog.update({
    where: { id: log.id },
    data: { content },
    include: logInclude,
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'maintenance_log',
    resourceId: log.id,
    before: log,
    after: updated,
  })

  return NextResponse.json({ log: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const log = await findLog(params)
  if (!log) return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 })
  if (!canModify(user, log.authorId)) {
    return NextResponse.json({ error: '본인이 작성한 기록만 삭제할 수 있습니다.' }, { status: 403 })
  }

  await prisma.maintenanceLog.delete({ where: { id: log.id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'maintenance_log',
    resourceId: log.id,
    before: log,
  })

  return NextResponse.json({ ok: true })
}
