import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess, parseDateOnly } from '@/lib/sales'
import { sanitizeRichTextHtml, isEmptyRichText } from '@/lib/richtext'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const activityDate = parseDateOnly(body.activityDate)
  if (!activityDate) return NextResponse.json({ error: '활동일을 입력해주세요.' }, { status: 400 })
  const content = sanitizeRichTextHtml(typeof body.content === 'string' ? body.content : '')
  if (isEmptyRichText(content)) return NextResponse.json({ error: '내용을 입력해주세요.' }, { status: 400 })

  const activityTypeId = Number.isInteger(body.activityTypeId) ? body.activityTypeId : null
  if (activityTypeId !== null) {
    const code = await prisma.statusCode.findUnique({ where: { id: activityTypeId }, select: { category: true } })
    if (code?.category !== 'SALES_ACTIVITY_TYPE') return NextResponse.json({ error: '활동 유형이 올바르지 않습니다.' }, { status: 400 })
  }
  const dealId = Number.isInteger(body.dealId) ? body.dealId : null
  if (dealId !== null) {
    const deal = await prisma.salesDeal.findUnique({ where: { id: dealId }, select: { hospitalCode: true } })
    if (!deal || deal.hospitalCode !== params.code) return NextResponse.json({ error: '이 병원의 딜만 연결할 수 있습니다.' }, { status: 400 })
  }

  const activity = await prisma.salesActivity.create({
    data: { hospitalCode: params.code, activityDate, activityTypeId, content, authorId: user.userId, dealId },
    include: {
      activityType: { select: { id: true, name: true } },
      author: { select: { id: true, name: true } },
      deal: { select: { id: true, dealCode: true, roundNo: true } },
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'sales_activity',
    resourceId: activity.id,
    resourceLabel: `${hospital.hospitalName} 영업일지`,
    after: { id: activity.id, activityDate: activity.activityDate, activityTypeId, dealId },
  })

  return NextResponse.json({ activity }, { status: 201 })
}
