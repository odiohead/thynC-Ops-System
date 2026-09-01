import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { editImportBatchDate } from '@/lib/deviceRegistry'
import { BadRequest, errorResponse, guardHospitalRoute, optString, readJsonObject, registryActor } from '../../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; batchId: string } }

/**
 * PATCH /api/hospitals/[code]/devices/imports/[batchId] — 배치 업무일자 일괄 정정 (§8.2, admin)
 * body `{ occurredOn }` → 배치 이벤트 전체 occurred_on UPDATE + 개체별 fold 재검증(불성립 409)
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code, { admin: true })
  if (!g.ok) return g.response
  const { user, hospital } = g

  const batchId = Number(params.batchId)
  if (!Number.isInteger(batchId) || batchId <= 0) return NextResponse.json({ error: '잘못된 배치 ID입니다.' }, { status: 400 })
  const before = await prisma.hospitalDeviceImportBatch.findUnique({ where: { id: batchId } })
  if (!before || before.hospitalCode !== hospital.hospitalCode) return NextResponse.json({ error: '임포트 배치를 찾을 수 없습니다.' }, { status: 404 })

  try {
    const body = await readJsonObject(request)
    if (!body) return NextResponse.json({ error: '요청 본문(JSON)이 올바르지 않습니다.' }, { status: 400 })
    const occurredOn = optString(body.occurredOn)
    if (!occurredOn) throw new BadRequest('업무일자(occurredOn)를 입력하세요.')

    const r = await editImportBatchDate({ hospitalCode: hospital.hospitalCode, actor: registryActor(user) }, { batchId, occurredOn })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_device_import',
      resourceId: batchId,
      resourceLabel: `${hospital.hospitalName} 기기 임포트 #${batchId} 업무일자 ${r.before} → ${r.after}`,
      before: { batchId, occurredOn: r.before },
      after: { batchId, occurredOn: r.after, eventCount: r.eventCount, deviceCount: r.deviceCount },
    })

    return NextResponse.json({ batch: r.batch, before: r.before, after: r.after, eventCount: r.eventCount, deviceCount: r.deviceCount })
  } catch (e) {
    return errorResponse(e, '배치 업무일자 정정 중 오류가 발생했습니다.')
  }
}
