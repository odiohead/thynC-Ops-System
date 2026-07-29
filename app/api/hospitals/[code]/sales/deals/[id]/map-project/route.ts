import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; id: string } }

/**
 * 프로젝트 매핑 전용 액션 — 계약 완료 후 구축 프로젝트를 딜에 연결/해제.
 * PUT(전체 수정)과 달리 다른 필드를 건드리지 않는다. body: { projectCode: string | null }
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const deal = await prisma.salesDeal.findUnique({ where: { id }, select: { id: true, dealCode: true, roundNo: true, hospitalCode: true, projectCode: true } })
  if (!deal || deal.hospitalCode !== params.code) return NextResponse.json({ error: '딜을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const projectCode = typeof body.projectCode === 'string' && body.projectCode.trim() ? body.projectCode.trim() : null

  if (projectCode) {
    const project = await prisma.project.findUnique({ where: { projectCode }, select: { hospitalCode: true } })
    if (!project || project.hospitalCode !== params.code) {
      return NextResponse.json({ error: '이 병원의 프로젝트만 연결할 수 있습니다.' }, { status: 400 })
    }
  }

  try {
    const updated = await prisma.salesDeal.update({ where: { id }, data: { projectCode } })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'sales_deal_map_project',
      resourceId: id,
      resourceLabel: `${deal.dealCode} (${deal.roundNo}차): ${deal.projectCode ?? '없음'} → ${projectCode ?? '없음'}`,
      before: { projectCode: deal.projectCode },
      after: { projectCode: updated.projectCode },
    })

    return NextResponse.json({ deal: { id: updated.id, projectCode: updated.projectCode } })
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err.code === 'P2002') return NextResponse.json({ error: '해당 프로젝트는 이미 다른 딜에 연결되어 있습니다.' }, { status: 409 })
    throw e
  }
}
