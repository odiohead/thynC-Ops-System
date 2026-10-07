import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { autoApplyDiscount } from '@/lib/parking'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// POST { carId, carNo, entryDate? } → 자동 계산 결과를 순차 등록 (무료 먼저 → 903 유료)
// entryDate = 검색에 쓴 입차일. 사이트 기본 영업일과 다른 입차건(전날·며칠 전 입차)은 이 값이 없으면 차량을 못 찾는다 (2026-10-07)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const carId = String(body.carId || '').trim()
  const carNo = String(body.carNo || '').trim()
  const entryDate = body.entryDate ? String(body.entryDate).trim() : undefined
  if (!carId || !carNo) {
    return NextResponse.json({ error: '차량 정보가 누락되었습니다.' }, { status: 400 })
  }

  try {
    const result = await autoApplyDiscount(carId, carNo, entryDate)
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
          entryDate: entryDate ?? null,
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
    if (!result.ok) {
      // 실패 사유는 DB에 남지 않으므로 서버 로그에 기록 (조사용, 2026-10-07)
      console.warn(`[parking] auto-apply 실패 ${carNo}(${carId}, 입차일 ${entryDate ?? '-'}) by ${user.name ?? user.email}: ${result.message}`, result.results.map((r) => `${r.label}:${r.name}=${r.applied ? 'ok' : r.message}`).join(' | '))
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (e) {
    console.error(`[parking] auto-apply 예외 ${carNo}(${carId}, 입차일 ${entryDate ?? '-'}):`, e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, message: (e instanceof Error ? e.message : '') || '자동 등록 실패' }, { status: 502 })
  }
}
