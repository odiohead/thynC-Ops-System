import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { recoverDevice } from '@/lib/deviceRegistry'
import {
  deviceAuditLabel,
  optionalInt,
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
 * POST /api/devices/units/[id]/recover — 회수 (write)
 * body `{ reasonCodeId, occurredOn?, memo?, ref? }` — 병원 문맥은 개체에서 유도(§4.2)
 * 사유 없음 400 · 이미 회수 409 · 소급 불성립 409
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
    const reasonCodeId = optionalInt(body.reasonCodeId, '회수 사유')
    if (reasonCodeId === undefined) return NextResponse.json({ error: '회수 사유를 선택하세요' }, { status: 400 })

    const r = await recoverDevice({ actor: registryActor(user), ...fields }, { deviceId, reasonCodeId })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_device',
      resourceId: r.device.serialNo,
      resourceLabel: `${await deviceAuditLabel(r.device.id)} 회수(${r.reason.name})`,
      before: { status: 'ACTIVE', hospitalCode: r.event.hospitalCode, wardId: r.fromWardId },
      after: {
        ...projectionSnapshot(r.device),
        event: { id: r.event.id, eventType: r.event.eventType, occurredOn: r.event.occurredOn, reasonCodeId: r.reason.id, reason: r.reason.name, memo: r.event.memo, refType: r.event.refType, refCode: r.event.refCode, actionGroup: r.event.actionGroup },
      },
    })

    return NextResponse.json(
      { event: r.event, device: r.device, fromWardId: r.fromWardId, reason: r.reason, warnings: r.warnings },
      { status: 201 }
    )
  } catch (e) {
    return registryErrorResponse(e, `units/${params.id}/recover`)
  }
}
