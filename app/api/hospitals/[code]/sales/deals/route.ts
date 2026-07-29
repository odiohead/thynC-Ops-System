import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess, nextDealCode } from '@/lib/sales'
import { parseDealBody, validateDealCodes } from './shared'

const auditSafe = (d: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]))

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const data = parseDealBody(body)
  const codeError = await validateDealCodes(data)
  if (codeError) return NextResponse.json({ error: codeError }, { status: 400 })

  // 신규 딜 기본 상태 = '영업중' (수기 입력 원본 — 계약 전 파이프라인 시작점)
  if (data.statusId === null) {
    const def = await prisma.statusCode.findFirst({ where: { category: 'SALES_DEAL_STATUS', name: '영업중' }, select: { id: true } })
    if (def) data.statusId = def.id
  }

  // 차수: 미지정 시 다음 차수 자동
  let roundNo = Number.isInteger(body.roundNo) && body.roundNo > 0 ? body.roundNo : null
  if (roundNo === null) {
    const max = await prisma.salesDeal.aggregate({ where: { hospitalCode: params.code }, _max: { roundNo: true } })
    roundNo = (max._max.roundNo ?? 0) + 1
  }

  // 프로젝트 연결 검증 (같은 병원 프로젝트만)
  if (data.projectCode) {
    const project = await prisma.project.findUnique({ where: { projectCode: data.projectCode }, select: { hospitalCode: true } })
    if (!project || project.hospitalCode !== params.code) return NextResponse.json({ error: '이 병원의 프로젝트만 연결할 수 있습니다.' }, { status: 400 })
  }

  try {
    const dealCode = await nextDealCode()
    const deal = await prisma.salesDeal.create({
      data: { ...data, dealCode, hospitalCode: params.code, roundNo: roundNo as number },
    })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'CREATE',
      resource: 'sales_deal',
      resourceId: deal.id,
      resourceLabel: `${hospital.hospitalName} ${deal.roundNo}차 딜 (${deal.dealCode})`,
      after: auditSafe(deal as unknown as Record<string, unknown>),
    })

    return NextResponse.json({ deal: { id: deal.id, dealCode: deal.dealCode, roundNo: deal.roundNo } }, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string; meta?: { target?: string[] } }
    if (err.code === 'P2002') {
      const target = err.meta?.target ?? []
      if (target.includes('round_no')) return NextResponse.json({ error: `이미 ${roundNo}차 딜이 있습니다. 다른 차수를 지정해주세요.` }, { status: 409 })
      if (target.includes('project_code')) return NextResponse.json({ error: '해당 프로젝트에 이미 연결된 딜이 있습니다.' }, { status: 409 })
      return NextResponse.json({ error: '딜 코드 발번이 충돌했습니다. 다시 시도해주세요.' }, { status: 409 })
    }
    throw e
  }
}
