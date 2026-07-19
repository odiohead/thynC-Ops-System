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

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const logs = await prisma.maintenanceLog.findMany({
    where: { maintenanceId: id },
    include: logInclude,
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ logs })
}

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const maintenance = await prisma.maintenance.findUnique({ where: { id }, select: { id: true, maintenanceCode: true, title: true } })
  if (!maintenance) return NextResponse.json({ error: '유지보수를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const content = sanitizeRichTextHtml(typeof body.content === 'string' ? body.content : '')
  if (isEmptyRichText(content)) return NextResponse.json({ error: '기록 내용을 입력하세요.' }, { status: 400 })

  const log = await prisma.maintenanceLog.create({
    data: { maintenanceId: id, authorId: user.userId, content },
    include: logInclude,
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'maintenance_log',
    resourceId: log.id,
    resourceLabel: `${maintenance.maintenanceCode ?? maintenance.id} 처리 기록`,
    after: log,
  })

  return NextResponse.json({ log }, { status: 201 })
}
