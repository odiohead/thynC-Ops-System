import { NextRequest, NextResponse } from 'next/server'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { replaceDevice, type RegistryCtx, type ReplaceInput } from '@/lib/deviceRegistry'
import { todayKst } from '@/lib/deviceRegistryShared'
import { BadRequest, errorResponse, guardHospitalRoute, optPositiveInt, optString, parseRef, readJsonObject, registryActor } from '../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/**
 * POST /api/hospitals/[code]/devices/replace — 교체(RECOVER + REGISTER 쌍, §7.0 교체 계약 (1)~(6)) (§7.1, write)
 * body `{ oldDeviceId?|oldSerial, oldDeviceInfoId?, oldWardId?|oldWardName?, oldUsageTypeId?, newSerial, newDeviceInfoId?, newUsageTypeId?(생략 시 구 기기 용도 승계), productType?(구 기기 소급 등록 시에만 — 그 외 구 배치 값 상속, B-22), toWardId?|toWardName?, reasonCodeId?, occurredOn, memo?, ref?, newConflict? }`
 * 201 `{ actionGroup, backfilled?, recovered?, transferRecovered?, registered, movedNew?, linkedRecoverEventId?, eventIds[1..4], oldDevice, newDevice, warnings, wms }`
 */
export async function POST(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code, { write: true })
  if (!g.ok) return g.response
  const { user, hospital } = g

  try {
    const body = await readJsonObject(request)
    if (!body) return NextResponse.json({ error: '요청 본문(JSON)이 올바르지 않습니다.' }, { status: 400 })

    const newSerial = optString(body.newSerial)
    if (!newSerial) throw new BadRequest('신 기기 시리얼(newSerial)을 입력하세요.')
    const oldDeviceId = optPositiveInt(body.oldDeviceId, '구 기기(oldDeviceId)')
    const oldSerial = optString(body.oldSerial)
    if (oldDeviceId == null && !oldSerial) throw new BadRequest('구 기기(oldDeviceId 또는 oldSerial)를 지정하세요.')
    const newConflictRaw = optString(body.newConflict)
    if (newConflictRaw && newConflictRaw !== 'TRANSFER') throw new BadRequest('newConflict는 TRANSFER만 허용합니다.')

    const input: ReplaceInput = {
      oldDeviceId,
      oldSerial,
      oldDeviceInfoId: optPositiveInt(body.oldDeviceInfoId, '구 기기 모델(oldDeviceInfoId)'),
      oldWardId: optPositiveInt(body.oldWardId, '구 기기 병동(oldWardId)'),
      oldWardName: optString(body.oldWardName),
      newSerial,
      newDeviceInfoId: optPositiveInt(body.newDeviceInfoId, '신 기기 모델(newDeviceInfoId)'),
      toWardId: optPositiveInt(body.toWardId, '병동(toWardId)'),
      toWardName: optString(body.toWardName),
      reasonCodeId: optPositiveInt(body.reasonCodeId, '회수 사유(reasonCodeId)'),
      newConflict: newConflictRaw === 'TRANSFER' ? 'TRANSFER' : null,
      oldUsageTypeId: optPositiveInt(body.oldUsageTypeId, '구 기기 용도(oldUsageTypeId)'),
      newUsageTypeId: optPositiveInt(body.newUsageTypeId, '신 기기 용도(newUsageTypeId)'),
      ...(body.productType !== undefined && body.productType !== null && body.productType !== '' ? { productType: optString(body.productType) } : {}),
      ...(body.dealCode !== undefined && body.dealCode !== null && body.dealCode !== '' ? { dealCode: optString(body.dealCode) } : {}),
    }
    const occurredOn = optString(body.occurredOn)
    const memo = optString(body.memo)
    const ref = parseRef(body.ref)
    const ctx: RegistryCtx = { hospitalCode: hospital.hospitalCode, actor: registryActor(user), occurredOn, memo, ref, source: 'MANUAL' }

    const r = await replaceDevice(ctx, input)

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'CREATE',
      resource: 'hospital_device_event',
      resourceId: r.actionGroup,
      resourceLabel: `${hospital.hospitalName} 기기 교체 ${r.oldDevice.serialNo} → ${r.newDevice.serialNo}`,
      after: {
        hospitalCode: hospital.hospitalCode,
        action: 'REPLACE',
        oldDeviceId: r.oldDevice.id,
        oldSerial: r.oldDevice.serialNo,
        newDeviceId: r.newDevice.id,
        newSerial: r.newDevice.serialNo,
        eventIds: r.eventIds,
        backfilled: r.backfillEvent?.id ?? null,
        recovered: r.recoverEvent?.id ?? null,
        transferRecovered: r.transferRecoverEvent?.id ?? null,
        registered: r.registerEvent?.id ?? null,
        movedNew: r.movedNewEvent?.id ?? null,
        linkedRecoverEventId: r.linkedRecoverEventId,
        reasonCodeId: r.recoverEvent?.reasonCodeId ?? input.reasonCodeId ?? null,
        toWardId: r.newDevice.wardId,
        newUsageTypeId: r.newDevice.usageTypeId,
        productType: r.productType,
        dealCode: r.dealCode,
        occurredOn: occurredOn ?? todayKst(),
        ref,
        memo,
      },
    })

    return NextResponse.json(
      {
        actionGroup: r.actionGroup,
        backfilled: r.backfillEvent,
        recovered: r.recoverEvent,
        transferRecovered: r.transferRecoverEvent,
        registered: r.registerEvent,
        movedNew: r.movedNewEvent,
        linkedRecoverEventId: r.linkedRecoverEventId,
        eventIds: r.eventIds,
        oldDevice: r.oldDevice,
        newDevice: r.newDevice,
        productType: r.productType,
        dealCode: r.dealCode,
        warnings: r.warnings,
        wms: r.wms,
      },
      { status: 201 }
    )
  } catch (e) {
    return errorResponse(e, '기기 교체 중 오류가 발생했습니다.')
  }
}
