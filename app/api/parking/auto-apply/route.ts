import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { autoApplyDiscount } from '@/lib/parking'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// POST { carId, carNo } → 자동 계산 결과를 순차 등록 (무료 먼저 → 903 유료)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const carId = String(body.carId || '').trim()
  const carNo = String(body.carNo || '').trim()
  if (!carId || !carNo) {
    return NextResponse.json({ error: '차량 정보가 누락되었습니다.' }, { status: 400 })
  }

  try {
    const result = await autoApplyDiscount(carId, carNo)
    // 감사 로그 — 1건이라도 실제 등록된 경우만 기록 (부분 실패 포함, 2026-09-29)
    const applied = result.results.filter((r) => r.applied)
    if (applied.length > 0) {
      const { plan } = result
      await logAudit({
        req: request,
        actor: auditActorFromJWT(user),
        action: 'CREATE',
        resource: 'parking_discount',
        resourceId: carId,
        resourceLabel: `${carNo} · 자동 ${applied.length}건 (무료 ${applied.filter((r) => r.price === 0).length}·유료 ${applied.filter((r) => r.price > 0).length})`,
        after: {
          mode: 'auto',
          carNo,
          carId,
          ok: result.ok,
          message: result.message,
          plan: {
            elapsedMin: plan.elapsedMin,
            targetMin: plan.targetMin,
            chargeableMin: plan.chargeableMin,
            alreadyMin: plan.alreadyMin,
            addMin: plan.addMin,
            totalCost: plan.totalCost,
            freeBlocked: plan.freeBlocked,
          },
          steps: result.results.map((r) => ({ account: r.userId, label: r.label, discountType: r.discountType, name: r.name, minutes: r.minutes, price: r.price, applied: r.applied, message: r.message })),
        },
      })
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e instanceof Error ? e.message : '') || '자동 등록 실패' }, { status: 502 })
  }
}
