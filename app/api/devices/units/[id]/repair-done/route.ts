import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { markDeviceRepaired, ymd } from '@/lib/deviceRegistry'
import { deviceAuditLabel, parseIdParam, parseRegistryFields, readJsonObject, registryActor, registryErrorResponse } from '@/lib/deviceRegistryRoute'
import { todayKst } from '@/lib/deviceRegistryShared'
import { syncAsLinesForUnitState, unitStateAudit, unitStateResponse } from '../_unitState'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * POST /api/devices/units/[id]/repair-done — 드로어 [수리완료] (write USER+, 병원 문맥 무관 — 2026-09-17 §6.2·§7.1)
 * body `{ occurredOn?, memo?, ref? }` — AS_WAITING/미확인 → REPAIRED(REPAIR_DONE, 위치 유지). 이미 REPAIRED면 `changed:false`(이벤트 없음).
 * 사용중 409 '사용중 기기는 수리완료 처리할 수 없습니다' · 출고 전/분실/폐기 409 · 타 병원 ACTIVE 409(conflict).
 * **라인 동기화**(같은 tx): 그 기기의 `canMarkAsLineRepaired` 라인 중 `repaired_at IS NULL`에 repaired_at/by 기록 + 접수 비고 이력.
 * 드로어 경로의 이벤트는 ref 없음(호출부가 보내지 않는 한). audit `hospital_device` '{라벨} 수리 완료'
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const denied = await checkDeviceRegistryAccess(user, { write: true })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  try {
    const deviceId = parseIdParam(params.id, '기기 ID')
    const body = await readJsonObject(request)
    const fields = parseRegistryFields(body)
    const actor = registryActor(user)
    const lineActor = { userId: user.userId, name: user.name }

    const { r, lines } = await prisma.$transaction(
      async (tx) => {
        const r = await markDeviceRepaired({ actor, ...fields }, { deviceId }, { client: tx })
        const on = (r.event ? ymd(r.event.occurredOn) : null) ?? fields.occurredOn ?? todayKst()
        const lines = await syncAsLinesForUnitState(tx, { deviceId, serialNo: r.unit.serialNo, mode: 'done', actor: lineActor, on })
        return { r, lines }
      },
      { timeout: 30_000, maxWait: 10_000 }
    )

    const audit = unitStateAudit(r)
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_device',
      resourceId: r.unit.serialNo,
      resourceLabel: `${await deviceAuditLabel(r.unit.id)} 수리 완료`,
      before: audit.before,
      after: { ...audit.after, lines },
    })

    return NextResponse.json(unitStateResponse(r, { lines }), { status: 201 })
  } catch (e) {
    return registryErrorResponse(e, `units/${params.id}/repair-done`)
  }
}
