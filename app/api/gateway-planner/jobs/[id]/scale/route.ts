import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { runPlacement } from '@/lib/gateway-planner/runner'
import { GwScaleCandidate } from '@/lib/gateway-planner/types'

export const dynamic = 'force-dynamic'

// 스케일 확정: AI 후보 승인(confirm) / 2점 보정(manual) / 스케일 없이(none) → 재배치 + PLACED
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = parseInt(params.id, 10)
  const job = await prisma.gatewayPlanJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!job.analysis) return NextResponse.json({ error: '분석 결과가 아직 없습니다.' }, { status: 409 })

  const body = await request.json().catch(() => ({}))
  const mode = body.mode as string
  const scaleMeta = (job.scaleMeta as { candidate?: GwScaleCandidate } | null) ?? {}

  let mPerPx: number | null
  let source: string
  if (mode === 'confirm') {
    const cand = scaleMeta.candidate?.mPerPx
    if (!cand) return NextResponse.json({ error: '승인할 스케일 후보가 없습니다.' }, { status: 400 })
    mPerPx = cand
    source = 'ai_dimension'
  } else if (mode === 'manual') {
    const { p1, p2, meters } = body
    const valid = Array.isArray(p1) && Array.isArray(p2) && p1.length === 2 && p2.length === 2 &&
      [...p1, ...p2].every((n: unknown) => typeof n === 'number') && typeof meters === 'number' && meters > 0
    if (!valid) return NextResponse.json({ error: '2점 좌표와 실제 거리(m)를 입력하세요.' }, { status: 400 })
    const distPx = Math.hypot(p1[0] - p2[0], p1[1] - p2[1])
    if (distPx < 10) return NextResponse.json({ error: '두 점이 너무 가깝습니다.' }, { status: 400 })
    mPerPx = meters / distPx
    source = 'manual_2point'
  } else if (mode === 'none') {
    mPerPx = null
    source = 'none'
  } else {
    return NextResponse.json({ error: 'mode는 confirm | manual | none 이어야 합니다.' }, { status: 400 })
  }

  await prisma.gatewayPlanJob.update({
    where: { id },
    data: {
      scaleMPerPx: mPerPx,
      scaleSource: source,
      scaleMeta: { ...scaleMeta, ...(mode === 'manual' ? { manual: { p1: body.p1, p2: body.p2, meters: body.meters } } : {}) } as object,
    },
  })
  const { count } = await runPlacement(id, mPerPx)
  await prisma.gatewayPlanJob.update({ where: { id }, data: { status: 'PLACED' } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'gateway_plan',
    resourceId: id,
    resourceLabel: `${job.title} (스케일 확정: ${source})`,
    before: { scaleMPerPx: job.scaleMPerPx, scaleSource: job.scaleSource },
    after: { scaleMPerPx: mPerPx, scaleSource: source, gatewayCount: count },
  })
  return NextResponse.json({ ok: true, mPerPx, gatewayCount: count })
}
