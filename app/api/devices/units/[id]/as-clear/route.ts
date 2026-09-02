import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { clearDeviceAs } from '@/lib/deviceRegistry'
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
 * POST /api/devices/units/[id]/as-clear — 'AS진행중' 표시 수동 해제(B-24, write)
 * body `{ occurredOn?, memo?, ref? }` — 병원 문맥은 개체에서 유도. 표시 없음 409 · 회수됨 409 · 타 병원 409.
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

    const r = await clearDeviceAs({ actor: registryActor(user), ...fields }, { deviceId })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_device',
      resourceId: r.device.serialNo,
      resourceLabel: `${await deviceAuditLabel(r.device.id)} AS 해제`,
      after: {
        ...projectionSnapshot(r.device),
        event: { id: r.event.id, eventType: r.event.eventType, occurredOn: r.event.occurredOn, memo: r.event.memo, refType: r.event.refType, refCode: r.event.refCode, actionGroup: r.event.actionGroup },
      },
    })

    return NextResponse.json({ event: r.event, device: r.device, warnings: r.warnings }, { status: 201 })
  } catch (e) {
    return registryErrorResponse(e, `units/${params.id}/as-clear`)
  }
}
