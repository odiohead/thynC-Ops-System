import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { updateAsShipInfo, AsServiceError } from '@/lib/asReceiptService'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * AS접수 발송정보 갱신 (2026-09-11 — 기기군 단위 발송방법·송장·발송일 일괄 기입/정정)
 * POST { itemIds: number[], shipMethod?, shipTrackingNo?, shippedAt? } — 발송 라인(수리반환·교체)만
 * 권한: USER 이상 전원 (라인 처리와 동일). 종결 접수도 송장 정정 허용(시트 R·V·W 역기입 원천)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()
  let result
  try {
    result = await updateAsShipInfo(id, {
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.map(Number) : [],
      shipMethod: body.shipMethod === undefined ? undefined : body.shipMethod || null,
      shipTrackingNo: body.shipTrackingNo === undefined ? undefined : typeof body.shipTrackingNo === 'string' ? body.shipTrackingNo : null,
      shippedAt: typeof body.shippedAt === 'string' ? body.shippedAt : null,
    })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true } })
  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id,
    resourceLabel: `${asReceipt?.asCode ?? id} 발송정보 갱신`,
    after: { itemIds: body.itemIds, shipMethod: body.shipMethod, shipTrackingNo: body.shipTrackingNo, shippedAt: body.shippedAt, updated: result.updated },
  })

  return NextResponse.json({ success: true, updated: result.updated })
}
