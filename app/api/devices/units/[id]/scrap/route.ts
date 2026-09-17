import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { scrapDevice, ymd } from '@/lib/deviceRegistry'
import { deviceAuditLabel, parseIdParam, parseRegistryFields, readJsonObject, registryActor, registryErrorResponse } from '@/lib/deviceRegistryRoute'
import { todayKst } from '@/lib/deviceRegistryShared'
import { syncAsLinesForUnitState, unitStateAudit, unitStateResponse } from '../_unitState'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * POST /api/devices/units/[id]/scrap — 드로어 [폐기] (write USER+ — A-5 'AS 업무 권한과 동일', 병원 문맥 무관 — 2026-09-17 §6.2·§7.1·§8.1)
 * body `{ memo(필수), occurredOn?, ref? }` — **memo 없으면 400**(오폐기 완화책 — 되돌림은 admin CORRECT·LIFO 취소 경로).
 * 배치 ACTIVE 409 '배치 중 기기는 먼저 회수하세요'(I-3) · 분실 409 · 이미 폐기면 `changed:false` → SCRAPPED·위치 없음(SCRAP).
 * **라인 동기화**(같은 tx): 그 기기의 `canMarkAsLineRepaired` 라인 repaired_at/by 전부 NULL + 대상 접수 비고 `[폐기 …] memo`. audit '{라벨} 폐기'
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
    const memo = typeof fields.memo === 'string' ? fields.memo.trim() : ''
    if (!memo) return NextResponse.json({ error: '폐기 사유(메모)를 입력하세요 — 폐기는 되돌리기 어려워 사유가 필수입니다' }, { status: 400 })
    const actor = registryActor(user)
    const lineActor = { userId: user.userId, name: user.name }

    const { r, lines } = await prisma.$transaction(
      async (tx) => {
        const r = await scrapDevice({ actor, ...fields, memo }, { deviceId, memo }, { client: tx })
        const on = (r.event ? ymd(r.event.occurredOn) : null) ?? fields.occurredOn ?? todayKst()
        const lines = await syncAsLinesForUnitState(tx, { deviceId, serialNo: r.unit.serialNo, mode: 'scrap', actor: lineActor, on, memo })
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
      resourceLabel: `${await deviceAuditLabel(r.unit.id)} 폐기`,
      before: audit.before,
      after: { ...audit.after, memo, lines },
    })

    return NextResponse.json(unitStateResponse(r, { lines }), { status: 201 })
  } catch (e) {
    return registryErrorResponse(e, `units/${params.id}/scrap`)
  }
}
