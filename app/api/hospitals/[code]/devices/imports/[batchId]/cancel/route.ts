import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { cancelImportBatch } from '@/lib/deviceRegistry'
import { errorResponse, guardHospitalRoute, registryActor } from '../../../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; batchId: string } }

/**
 * POST /api/hospitals/[code]/devices/imports/[batchId]/cancel — 임포트 배치 취소 (§8.2, admin)
 * 배치 밖 상태 이벤트가 있는 기기가 있으면 409, 이미 취소 409. 이벤트→개체 DELETE(재등록 개체는 RECOVERED 복원, 이관 쌍은 원 병원 ACTIVE 복원)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code, { admin: true })
  if (!g.ok) return g.response
  const { user, hospital } = g

  const batchId = Number(params.batchId)
  if (!Number.isInteger(batchId) || batchId <= 0) return NextResponse.json({ error: '잘못된 배치 ID입니다.' }, { status: 400 })
  const before = await prisma.hospitalDeviceImportBatch.findUnique({ where: { id: batchId } })
  if (!before || before.hospitalCode !== hospital.hospitalCode) return NextResponse.json({ error: '임포트 배치를 찾을 수 없습니다.' }, { status: 404 })

  try {
    const r = await cancelImportBatch({ hospitalCode: hospital.hospitalCode, actor: registryActor(user) }, { batchId })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'DELETE',
      resource: 'hospital_device_import',
      resourceId: batchId,
      resourceLabel: `${hospital.hospitalName} 기기 임포트 #${batchId} 취소 — 이벤트 ${r.summary.eventCount}건 · 개체 ${r.summary.serials.length}대`,
      before: {
        batch: {
          id: before.id,
          hospitalCode: before.hospitalCode,
          sourceKind: before.sourceKind,
          mode: before.mode,
          fileName: before.fileName,
          occurredOn: before.occurredOn,
          rowCount: before.rowCount,
          registeredCount: before.registeredCount,
          reregisteredCount: before.reregisteredCount,
          skippedCount: before.skippedCount,
          transferredCount: before.transferredCount,
          createdById: before.createdById,
          createdAt: before.createdAt,
        },
        serials: r.summary.serials,
        eventIds: r.cancelledEvents.map((e) => e.id),
      },
      after: { batchId, cancelledAt: r.batch.cancelledAt, summary: r.summary },
    })

    return NextResponse.json({ batch: r.batch, summary: r.summary })
  } catch (e) {
    return errorResponse(e, '임포트 배치 취소 중 오류가 발생했습니다.')
  }
}
