import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess, parseDateOnly } from '@/lib/sales'
import { sanitizeRichTextHtml, isEmptyRichText } from '@/lib/richtext'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; id: string } }

async function guard(request: NextRequest, params: Params['params']) {
  const user = await getAuthUser(request)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const denial = await checkSalesAccess(user, { write: true })
  if (denial) return { error: NextResponse.json({ error: denial.error }, { status: denial.status }) }
  const id = parseInt(params.id)
  if (isNaN(id)) return { error: NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 }) }
  const activity = await prisma.salesActivity.findUnique({ where: { id } })
  if (!activity || activity.hospitalCode !== params.code) return { error: NextResponse.json({ error: '영업일지를 찾을 수 없습니다.' }, { status: 404 }) }
  // 수정·삭제는 작성자 본인 또는 SUPER_ADMIN (유지보수 처리기록 선례)
  if (activity.authorId !== user.userId && !isSuperAdmin(user.role)) {
    return { error: NextResponse.json({ error: '작성자만 수정·삭제할 수 있습니다.' }, { status: 403 }) }
  }
  return { user, id, activity }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error

  const body = await request.json()
  const activityDate = parseDateOnly(body.activityDate) ?? g.activity.activityDate
  const content = sanitizeRichTextHtml(typeof body.content === 'string' ? body.content : '')
  if (isEmptyRichText(content)) return NextResponse.json({ error: '내용을 입력해주세요.' }, { status: 400 })
  const activityTypeId = Number.isInteger(body.activityTypeId) ? body.activityTypeId : null

  const activity = await prisma.salesActivity.update({
    where: { id: g.id },
    data: { activityDate, content, activityTypeId },
    include: {
      activityType: { select: { id: true, name: true } },
      author: { select: { id: true, name: true } },
      deal: { select: { id: true, dealCode: true, roundNo: true } },
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'UPDATE',
    resource: 'sales_activity',
    resourceId: g.id,
    resourceLabel: `${params.code} 영업일지`,
    before: { activityDate: g.activity.activityDate, activityTypeId: g.activity.activityTypeId },
    after: { activityDate, activityTypeId },
  })

  return NextResponse.json({ activity })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error

  await prisma.salesActivity.delete({ where: { id: g.id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'DELETE',
    resource: 'sales_activity',
    resourceId: g.id,
    resourceLabel: `${params.code} 영업일지`,
    before: { activityDate: g.activity.activityDate, content: g.activity.content },
  })

  return NextResponse.json({ ok: true })
}
