import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess, syncHospitalIntroTypesFromDeals } from '@/lib/sales'
import { parseDealBody, validateDealCodes } from '../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; id: string } }

async function guard(request: NextRequest, params: Params['params']) {
  const user = await getAuthUser(request)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const denial = await checkSalesAccess(user, { write: true })
  if (denial) return { error: NextResponse.json({ error: denial.error }, { status: denial.status }) }
  const id = parseInt(params.id)
  if (isNaN(id)) return { error: NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 }) }
  const deal = await prisma.salesDeal.findUnique({ where: { id } })
  if (!deal || deal.hospitalCode !== params.code) return { error: NextResponse.json({ error: '딜을 찾을 수 없습니다.' }, { status: 404 }) }
  return { user, id, deal }
}

const auditSafe = (d: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]))

export async function PUT(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error

  const body = await request.json()
  const data = parseDealBody(body)
  const codeError = await validateDealCodes(data)
  if (codeError) return NextResponse.json({ error: codeError }, { status: 400 })

  const roundNo = Number.isInteger(body.roundNo) && body.roundNo > 0 ? body.roundNo : g.deal.roundNo

  if (data.projectCode) {
    const project = await prisma.project.findUnique({ where: { projectCode: data.projectCode }, select: { hospitalCode: true } })
    if (!project || project.hospitalCode !== params.code) return NextResponse.json({ error: '이 병원의 프로젝트만 연결할 수 있습니다.' }, { status: 400 })
  }

  // 기기 수량 (딜 상세 폼) — devices 배열이 온 경우에만 전체 교체 (병원 상세 계약 이력 모달 등 미전송 PUT은 기존 값 보존)
  let devices: Array<{ deviceInfoId: number; quantity: number }> | null = null
  if (Array.isArray(body.devices)) {
    devices = (body.devices as Array<{ deviceId?: unknown; quantity?: unknown }>)
      .map((d) => ({ deviceInfoId: Number(d.deviceId), quantity: Number(d.quantity) }))
      .filter((d) => Number.isInteger(d.deviceInfoId) && Number.isInteger(d.quantity) && d.quantity > 0)
    if (devices.length > 0) {
      const found = await prisma.deviceInfo.count({ where: { id: { in: devices.map((d) => d.deviceInfoId) } } })
      if (found !== devices.length) return NextResponse.json({ error: '기기 목록에 없는 항목이 있습니다.' }, { status: 400 })
    }
  }

  try {
    const deal = await prisma.salesDeal.update({ where: { id: g.id }, data: { ...data, roundNo } })

    // 도입형태 자동 동기화 (딜 판매모델 → INTRO_TYPE) — 실패해도 딜 수정은 유지
    await syncHospitalIntroTypesFromDeals(params.code).catch((e) => console.error('[deals] intro-type sync 실패:', e))

    if (devices !== null) {
      await prisma.$transaction([
        prisma.salesDealDevice.deleteMany({ where: { dealId: g.id } }),
        prisma.salesDealDevice.createMany({ data: devices.map((d) => ({ dealId: g.id, ...d })) }),
      ])
    }

    await logAudit({
      req: request,
      actor: auditActorFromJWT(g.user),
      action: 'UPDATE',
      resource: 'sales_deal',
      resourceId: g.id,
      resourceLabel: `${deal.dealCode} (${deal.roundNo}차)`,
      before: auditSafe(g.deal as unknown as Record<string, unknown>),
      after: { ...auditSafe(deal as unknown as Record<string, unknown>), ...(devices !== null ? { devices } : {}) },
    })

    return NextResponse.json({ deal: { id: deal.id, dealCode: deal.dealCode, roundNo: deal.roundNo } })
  } catch (e: unknown) {
    const err = e as { code?: string; meta?: { target?: string[] } }
    if (err.code === 'P2002') {
      const target = err.meta?.target ?? []
      if (target.includes('round_no')) return NextResponse.json({ error: `이미 ${roundNo}차 딜이 있습니다.` }, { status: 409 })
      if (target.includes('project_code')) return NextResponse.json({ error: '해당 프로젝트에 이미 연결된 딜이 있습니다.' }, { status: 409 })
    }
    throw e
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error

  await prisma.salesDeal.delete({ where: { id: g.id } })

  // 도입형태 자동 동기화 — 남은 딜 기준 재계산 (매핑 근거 없으면 현행 유지)
  await syncHospitalIntroTypesFromDeals(params.code).catch((e) => console.error('[deals] intro-type sync 실패:', e))

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'DELETE',
    resource: 'sales_deal',
    resourceId: g.id,
    resourceLabel: `${g.deal.dealCode} (${g.deal.roundNo}차)`,
    before: auditSafe(g.deal as unknown as Record<string, unknown>),
  })

  return NextResponse.json({ ok: true })
}
