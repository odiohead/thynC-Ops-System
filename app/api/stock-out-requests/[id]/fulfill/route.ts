import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { canManageStock } from '@/lib/inventory'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { previewFulfillment, executeFulfillment, FulfillError, type FulfillInput } from '@/lib/stockOutFulfill'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 출고요청 처리 (stock_out_request_design.md §13.3 — 자재담당자 전용)
 * ?preview=true — 검증·라인 판정만. 본 실행은 전량 일치·단일 트랜잭션(WMS 차감 + 기기현황 등록 + 상태 완료).
 * 기기 상품유형(2026-11-18) — 기기현황 등록은 요청 유형(구축(일반)/구축(라이트))을 따른다. 유형 없는 옛 요청이고 병원 계약이 일반·라이트 혼합이면 본문 `productType`('일반'|'라이트') 필수.
 * 미리보기 응답에는 임시 저장분 `draft`·`draftAt`이 함께 내려간다(저장은 PUT …/fulfill-draft).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageStock(user))) {
    return NextResponse.json({ error: '재고 처리 권한이 없습니다. (재고 담당자 또는 관리자만 가능)' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = (await request.json()) as FulfillInput
  const isPreview = request.nextUrl.searchParams.get('preview') === 'true'

  try {
    if (isPreview) {
      const preview = await previewFulfillment(id, body)
      // 임시 저장분(2026-11-18) — 화면이 열릴 때 입력 내용을 되살리는 데 쓴다. 저장한 사람·시각 포함
      const saved = await prisma.stockOutRequest.findUnique({ where: { id }, select: { fulfillDraft: true, fulfillDraftAt: true } })
      return NextResponse.json({ preview, draft: saved?.fulfillDraft ?? null, draftAt: saved?.fulfillDraftAt ?? null })
    }

    const result = await executeFulfillment(id, body, { userId: user.userId, name: user.name })

    const after = await prisma.stockOutRequest.findUnique({
      where: { id },
      select: { sorCode: true, ticketId: true, project: { select: { projectName: true } } },
    })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'stock_out_request',
      resourceId: after?.sorCode ?? id,
      resourceLabel: `${after?.sorCode ?? id} 출고 처리 (전표 ${result.txCodes.length}건, 기기 등록 ${result.registered}대)`,
      after: { txCodes: result.txCodes, registered: result.registered, skipped: result.registrySkipped },
    })

    if (after?.ticketId) {
      syncTicketClocksSafe(after.ticketId)
      notifyTicketChanged({ ticketId: after.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
    }

    return NextResponse.json({ result })
  } catch (e) {
    if (e instanceof FulfillError) {
      return NextResponse.json({ error: e.message, ...(e.payload ?? {}) }, { status: e.status })
    }
    console.error('stock-out fulfill error:', e)
    return NextResponse.json({ error: '출고 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
