import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { sanitizeRichTextHtml, isEmptyRichText } from '@/lib/richtext'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const logInclude = {
  author: { select: { id: true, name: true } },
} as const

// 타임라인 전체 (코멘트 + 시스템 이벤트, 시간순)
export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const logs = await prisma.ticketLog.findMany({
    where: { ticketId: id },
    include: logInclude,
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ logs })
}

// 코멘트 작성 (correspondence)
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true, ticketCode: true } })
  if (!ticket) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const content = sanitizeRichTextHtml(typeof body.content === 'string' ? body.content : '')
  if (isEmptyRichText(content)) return NextResponse.json({ error: '코멘트 내용을 입력하세요.' }, { status: 400 })

  const log = await prisma.ticketLog.create({
    data: { ticketId: id, logType: 'comment', authorId: user.userId, contentHtml: content },
    include: logInclude,
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'ticket_log',
    resourceId: log.id,
    resourceLabel: `${ticket.ticketCode} 코멘트`,
    after: log,
  })

  return NextResponse.json({ log }, { status: 201 })
}
