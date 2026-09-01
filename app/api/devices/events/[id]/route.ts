import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { cancelLastEvent, editEvent, eventLabel, type EventPatch } from '@/lib/deviceRegistry'
import { parseIdParam, parseRef, readJsonObject, registryActor, registryErrorResponse } from '@/lib/deviceRegistryRoute'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

async function eventWithSerial(id: number) {
  return prisma.hospitalDeviceEvent.findUnique({
    where: { id },
    include: {
      device: { select: { id: true, serialNo: true, deviceInfo: { select: { deviceModel: true } } } },
      hospital: { select: { hospitalName: true } },
    },
  })
}

function eventAuditLabel(ev: NonNullable<Awaited<ReturnType<typeof eventWithSerial>>>): string {
  return `${ev.hospital?.hospitalName ?? '-'} ${ev.device.deviceInfo.deviceModel} ${ev.device.serialNo} ${eventLabel(ev)}`
}

/**
 * PATCH /api/devices/events/[id] — 이벤트 인플레이스 정정 (admin, §8.2)
 * 허용 필드: occurredOn·memo·reasonCodeId(RECOVER)·ref·toWardId(REGISTER/MOVE_WARD)·fromWardId(RECOVER)
 * 그 외 필드는 서비스가 400('취소 후 재입력') — event_type·device_id·hospital_code 등은 정정 불가
 * fold 재검증 불성립 409 → 롤백
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const denied = await checkDeviceRegistryAccess(user, { admin: true })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  try {
    const eventId = parseIdParam(params.id, '이벤트 ID')
    const body = await readJsonObject(request)
    if (Object.keys(body).length === 0) return NextResponse.json({ error: '변경 사항이 없습니다' }, { status: 400 })

    // 허용 키는 타입 정규화, 그 외 키는 그대로 넘겨 서비스가 400으로 거절하게 한다(허용 목록 단일 소스 유지)
    const patch: Record<string, unknown> = { ...body }
    if ('occurredOn' in body) patch.occurredOn = typeof body.occurredOn === 'string' ? body.occurredOn.trim() : body.occurredOn
    if ('memo' in body) {
      if (body.memo !== null && typeof body.memo !== 'string') return NextResponse.json({ error: '메모는 문자열이어야 합니다' }, { status: 400 })
      patch.memo = body.memo
    }
    if ('reasonCodeId' in body) {
      const n = Number(body.reasonCodeId)
      if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: '회수 사유가 올바르지 않습니다' }, { status: 400 })
      patch.reasonCodeId = n
    }
    if ('ref' in body) patch.ref = parseRef(body.ref)
    for (const k of ['toWardId', 'fromWardId'] as const) {
      if (!(k in body)) continue
      if (body[k] === null || body[k] === '') {
        patch[k] = null
        continue
      }
      const n = Number(body[k])
      if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: '병동 ID가 올바르지 않습니다' }, { status: 400 })
      patch[k] = n
    }

    const existing = await eventWithSerial(eventId)
    if (!existing) return NextResponse.json({ error: '이벤트를 찾을 수 없습니다' }, { status: 404 })

    const r = await editEvent({ actor: registryActor(user) }, { eventId, patch: patch as EventPatch })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_device_event',
      resourceId: r.after.id,
      resourceLabel: `${eventAuditLabel(existing)} 정정`,
      before: r.before,
      after: r.after,
    })

    return NextResponse.json({ event: r.after, device: r.device })
  } catch (e) {
    return registryErrorResponse(e, `events/${params.id} PATCH`)
  }
}

/**
 * DELETE /api/devices/events/[id] — 마지막 이벤트 취소 (admin, §8.2 LIFO)
 * 교체·이관 그룹은 짝 동시 취소, 임포트 행은 배치 카운트 감소, CORRECT는 식별 컬럼 복원.
 * 이후 이벤트가 있으면 409. 물리 DELETE → 재계산 → 이벤트 0 개체 삭제. audit `before`에 삭제 이벤트 전문.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const denied = await checkDeviceRegistryAccess(user, { admin: true })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  try {
    const eventId = parseIdParam(params.id, '이벤트 ID')
    const existing = await eventWithSerial(eventId)
    if (!existing) return NextResponse.json({ error: '이벤트를 찾을 수 없습니다' }, { status: 404 })

    const r = await cancelLastEvent({ actor: registryActor(user) }, { eventId })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'DELETE',
      resource: 'hospital_device_event',
      resourceId: eventId,
      resourceLabel: `${eventAuditLabel(existing)} 취소${r.cancelledEventIds.length > 1 ? ` (+${r.cancelledEventIds.length - 1}건 짝 취소)` : ''}`,
      before: { anchorEventId: eventId, serialNo: existing.device.serialNo, events: r.cancelledEvents },
      after: {
        cancelledEventIds: r.cancelledEventIds,
        deletedDeviceIds: r.deletedDeviceIds,
        restoredDevices: r.restoredDevices,
        affectedDeviceIds: r.affectedDeviceIds,
        batchAdjustments: r.batchAdjustments,
        restored: r.restored ?? null,
      },
    })

    return NextResponse.json({
      cancelledEventIds: r.cancelledEventIds,
      deletedDeviceIds: r.deletedDeviceIds,
      restoredDevices: r.restoredDevices,
      affectedDeviceIds: r.affectedDeviceIds,
      batchAdjustments: r.batchAdjustments,
      restored: r.restored ?? null,
    })
  } catch (e) {
    return registryErrorResponse(e, `events/${params.id} DELETE`)
  }
}
