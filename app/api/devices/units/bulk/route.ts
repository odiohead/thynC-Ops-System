import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { BULK_MAX, RegistryError, bulkDeviceAction, hospitalNames, uniqInts } from '@/lib/deviceRegistry'
import { optionalInt, parseRegistryFields, readJsonObject, registryActor, registryErrorResponse } from '@/lib/deviceRegistryRoute'

export const dynamic = 'force-dynamic'

const ACTION_LABEL: Record<'MOVE_WARD' | 'RECOVER', string> = { MOVE_WARD: '일괄 병동 이동', RECOVER: '일괄 회수' }

/**
 * 병원 문맥 유도 — body.hospitalCode가 없으면 선택 개체의 ACTIVE 병원에서 유도(§4.2 "개체에서 유도").
 * 병원이 2곳 이상 섞이면 409, ACTIVE 개체가 없으면 409 (세부 검증·skipped는 서비스가 담당)
 */
async function deriveBulkHospital(ids: number[]): Promise<string> {
  // ids = 공개 device id(유닛 id) — 배치 행은 device_id로 찾는다
  const rows = await prisma.hospitalDevice.findMany({
    where: { deviceId: { in: ids } },
    select: { deviceId: true, status: true, hospitalCode: true },
  })
  if (rows.length !== ids.length) throw new RegistryError(404, `기기 ${ids.length - rows.length}건을 찾을 수 없습니다`)
  const codes = Array.from(new Set(rows.filter((r) => r.status === 'ACTIVE' && r.hospitalCode).map((r) => r.hospitalCode as string)))
  if (codes.length === 0) throw new RegistryError(409, '선택한 기기 중 배치 중(ACTIVE)인 기기가 없습니다')
  if (codes.length > 1) throw new RegistryError(409, `선택에 서로 다른 병원의 기기가 섞여 있습니다 (${codes.length}곳) — 한 병원의 기기만 선택하세요`)
  return codes[0]
}

/**
 * POST /api/devices/units/bulk — 일괄 이동/회수 (write, 단일 tx)
 * body `{ action: 'MOVE_WARD'|'RECOVER', deviceIds[], toWardId?|toWardName?, reasonCodeId?, occurredOn?, memo?, ref?, hospitalCode? }`
 * 같은 병원 ACTIVE만 — 타 병원·RECOVERED가 섞이면 전체 409, 이미 대상 병동인 개체는 `skipped[]`
 * audit: `hospital_device_event` 1행(action_group, eventIds·시리얼 ≤50) — §8.3
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const denied = await checkDeviceRegistryAccess(user, { write: true })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  try {
    const body = await readJsonObject(request)
    const action = body.action
    if (action !== 'MOVE_WARD' && action !== 'RECOVER') return NextResponse.json({ error: '일괄 액션은 MOVE_WARD 또는 RECOVER만 가능합니다' }, { status: 400 })
    if (!Array.isArray(body.deviceIds)) return NextResponse.json({ error: 'deviceIds 배열이 필요합니다' }, { status: 400 })
    const deviceIds = uniqInts(body.deviceIds)
    if (deviceIds.length === 0) return NextResponse.json({ error: '대상 기기를 선택하세요' }, { status: 400 })
    if (deviceIds.length > BULK_MAX) return NextResponse.json({ error: `일괄 처리는 최대 ${BULK_MAX}대까지 가능합니다` }, { status: 400 })

    const fields = parseRegistryFields(body)
    const toWardId = optionalInt(body.toWardId, '병동 ID')
    const toWardName = typeof body.toWardName === 'string' && body.toWardName.trim() ? body.toWardName.trim() : undefined
    const reasonCodeId = optionalInt(body.reasonCodeId, '회수 사유')
    if (action === 'MOVE_WARD' && toWardId === undefined && !toWardName) return NextResponse.json({ error: '이동할 병동을 지정하세요' }, { status: 400 })
    if (action === 'RECOVER' && reasonCodeId === undefined) return NextResponse.json({ error: '회수 사유를 선택하세요' }, { status: 400 })

    const hospitalCode =
      typeof body.hospitalCode === 'string' && body.hospitalCode.trim() ? body.hospitalCode.trim() : await deriveBulkHospital(deviceIds)

    const r = await bulkDeviceAction(
      { hospitalCode, actor: registryActor(user), ...fields },
      { action, deviceIds, toWardId, toWardName, reasonCodeId }
    )

    const serials = await prisma.deviceUnit.findMany({ where: { id: { in: r.affectedDeviceIds.slice(0, 50) } }, select: { serialNo: true } })
    const hospName = (await hospitalNames(prisma, [hospitalCode])).get(hospitalCode) ?? hospitalCode
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'CREATE',
      resource: 'hospital_device_event',
      resourceId: r.actionGroup,
      resourceLabel: `${hospName} ${ACTION_LABEL[action]} ${r.affectedDeviceIds.length}대`,
      after: {
        action,
        hospitalCode,
        occurredOn: r.events[0]?.occurredOn ?? fields.occurredOn ?? null,
        toWardId: action === 'MOVE_WARD' ? (r.events[0]?.toWardId ?? null) : undefined,
        reasonCodeId: action === 'RECOVER' ? (r.events[0]?.reasonCodeId ?? null) : undefined,
        memo: fields.memo ?? null,
        ref: fields.ref ?? null,
        eventIds: r.eventIds,
        deviceCount: r.affectedDeviceIds.length,
        serials: serials.map((s) => s.serialNo),
        serialsTruncated: r.affectedDeviceIds.length > 50,
        skipped: r.skipped,
      },
    })

    return NextResponse.json(
      {
        actionGroup: r.actionGroup,
        hospitalCode,
        events: r.events,
        eventIds: r.eventIds,
        affectedDeviceIds: r.affectedDeviceIds,
        skipped: r.skipped,
        warnings: r.warnings,
      },
      { status: 201 }
    )
  } catch (e) {
    return registryErrorResponse(e, 'units/bulk')
  }
}
