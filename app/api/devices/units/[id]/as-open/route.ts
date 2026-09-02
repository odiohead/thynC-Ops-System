import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { openDeviceAs } from '@/lib/deviceRegistry'
import {
  deviceAuditLabel,
  parseIdParam,
  parseRegistryFields,
  projectionSnapshot,
  readJsonObject,
  registryActor,
  registryErrorResponse,
} from '@/lib/deviceRegistryRoute'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * POST /api/devices/units/[id]/as-open — 'AS진행중' 표시(B-24, write)
 * body `{ occurredOn?, memo?, ref? }` — ref는 유지보수(MAINTENANCE) 코드 권장 → `as_ref_code`로 남는다. 병원 문맥은 개체에서 유도(§4.2)
 * 이미 표시됨 409 · 회수됨 409 · 타 병원 409. 교체·회수 시에는 자동 해제되므로 별도 해제 불필요.
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

    const r = await openDeviceAs({ actor: registryActor(user), ...fields }, { deviceId })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_device',
      resourceId: r.device.serialNo,
      resourceLabel: `${await deviceAuditLabel(r.device.id)} AS 접수`,
      before: { asStartedOn: null, asRefCode: null },
      after: {
        ...projectionSnapshot(r.device),
        event: { id: r.event.id, eventType: r.event.eventType, occurredOn: r.event.occurredOn, memo: r.event.memo, refType: r.event.refType, refCode: r.event.refCode, actionGroup: r.event.actionGroup },
      },
    })

    return NextResponse.json({ event: r.event, device: r.device, warnings: r.warnings }, { status: 201 })
  } catch (e) {
    return registryErrorResponse(e, `units/${params.id}/as-open`)
  }
}
