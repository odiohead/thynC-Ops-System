import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { moveDeviceLocation, type LocationTarget } from '@/lib/deviceRegistry'
import { deviceAuditLabel, parseIdParam, parseRegistryFields, readJsonObject, registryActor, registryErrorResponse } from '@/lib/deviceRegistryRoute'
import { DEVICE_SITE_VALUES, isDeviceSiteValue } from '@/lib/deviceRegistryShared'
import { locationSnapshotText } from '@/app/devices/_components/deviceDisplay'
import { unitStateAudit, unitStateResponse } from '../_unitState'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * POST /api/devices/units/[id]/location — 드로어 [위치 이동]·[병원 반환] (write USER+, 병원 문맥 무관 — 2026-09-17 §6.2·§7.1)
 * body `{ to: 'REFRESH_CENTER' | 'HUB' | 'HOSPITAL', occurredOn?, memo?, ref? }` → SITE_MOVE(condition 유지)
 * - 배치 RECOVERED/없음: 현재 위치 무관, 목적지 거점만(HOSPITAL 409)
 * - 배치 ACTIVE: `to='HOSPITAL'`(배치 병원 반환)만·condition IN_USE만 — AS_WAITING/REPAIRED는 409 '미종결 입고 라인 — AS 상세에서 확정하세요', 거점 이동은 409 '먼저 회수'
 * - 같은 위치면 `changed:false`(이벤트 없음). 분실·폐기 409. audit '{라벨} 위치 이동'(또는 '병원 반환')
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
    const toRaw = typeof body.to === 'string' ? body.to.trim().toUpperCase() : ''
    if (toRaw !== 'HOSPITAL' && !isDeviceSiteValue(toRaw)) {
      return NextResponse.json({ error: `이동할 위치를 선택하세요 (${DEVICE_SITE_VALUES.join(' | ')} | HOSPITAL)` }, { status: 400 })
    }
    const to = toRaw as LocationTarget

    const r = await moveDeviceLocation({ actor: registryActor(user), ...fields }, { deviceId, to })

    const audit = unitStateAudit(r)
    const what = to === 'HOSPITAL' ? '병원 반환' : '위치 이동'
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_device',
      resourceId: r.unit.serialNo,
      resourceLabel: `${await deviceAuditLabel(r.unit.id)} ${what} ${locationSnapshotText(r.before.location)} → ${locationSnapshotText(r.after.location)}`,
      before: audit.before,
      after: { ...audit.after, to },
    })

    return NextResponse.json(unitStateResponse(r), { status: 201 })
  } catch (e) {
    return registryErrorResponse(e, `units/${params.id}/location`)
  }
}
