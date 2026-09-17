import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { undoDeviceRepaired, ymd } from '@/lib/deviceRegistry'
import { deviceAuditLabel, parseIdParam, parseRegistryFields, readJsonObject, registryActor, registryErrorResponse } from '@/lib/deviceRegistryRoute'
import { todayKst } from '@/lib/deviceRegistryShared'
import { syncAsLinesForUnitState, unitStateAudit, unitStateResponse } from '../_unitState'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * POST /api/devices/units/[id]/repair-undo — 드로어 [수리완료 해제] (write USER+, 병원 문맥 무관 — 2026-09-17 §6.2·§7.1)
 * body `{ occurredOn?, memo?, ref? }` — REPAIRED → AS_WAITING **CORRECT**(B-27, memo 기본 '수리완료 해제'). 수리완료 상태가 아니면 409.
 * **라인 동기화**(같은 tx): 그 기기의 `canMarkAsLineRepaired` 라인 repaired_at/by 전부 NULL + 접수 비고 이력. audit '{라벨} 수리완료 해제'
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
        const r = await undoDeviceRepaired({ actor, ...fields }, { deviceId }, { client: tx })
        const on = (r.event ? ymd(r.event.occurredOn) : null) ?? fields.occurredOn ?? todayKst()
        const lines = await syncAsLinesForUnitState(tx, { deviceId, serialNo: r.unit.serialNo, mode: 'undo', actor: lineActor, on })
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
      resourceLabel: `${await deviceAuditLabel(r.unit.id)} 수리완료 해제`,
      before: audit.before,
      after: { ...audit.after, lines },
    })

    return NextResponse.json(unitStateResponse(r, { lines }), { status: 201 })
  } catch (e) {
    return registryErrorResponse(e, `units/${params.id}/repair-undo`)
  }
}
