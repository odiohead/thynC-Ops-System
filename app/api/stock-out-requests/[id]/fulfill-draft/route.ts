import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { canManageStock } from '@/lib/inventory'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const MAX_DRAFT_BYTES = 200_000 // 품목 수십 종 × 시리얼 수백 줄이어도 수십 KB — 비정상 크기만 차단

/**
 * 출고 처리 입력 내용 임시 저장 (2026-11-18 — 자재담당자 전용)
 * 처리 화면(FulfillCard)의 입력 상태(품목별 시리얼·LOT·기록, 확인 여부, 계약 선택, 출고일 등)를 요청 행에 JSON으로 둔다.
 * 화면을 닫았다가 다시 열거나 다른 PC·브라우저에서 열어도 이어서 작업할 수 있게 하기 위함. 재고·기기현황에는 아무 영향이 없다(출고 실행 전).
 * 조회는 처리 미리보기(POST …/fulfill?preview=true) 응답의 `draft`로 내려간다. 출고 실행에 성공하면 서버가 비운다.
 * 마지막에 저장한 내용이 남는다(동시 편집 병합 없음) — 저장한 사람·시각을 함께 기록해 화면에 보여 준다.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageStock(user))) {
    return NextResponse.json({ error: '재고 처리 권한이 없습니다. (재고 담당자 또는 관리자만 가능)' }, { status: 403 })
  }
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = (await request.json().catch(() => null)) as { draft?: unknown } | null
  const draft = body?.draft
  if (draft !== null && (typeof draft !== 'object' || Array.isArray(draft))) {
    return NextResponse.json({ error: '저장할 내용이 올바르지 않습니다.' }, { status: 400 })
  }
  if (draft && JSON.stringify(draft).length > MAX_DRAFT_BYTES) {
    return NextResponse.json({ error: '저장할 내용이 너무 큽니다.' }, { status: 413 })
  }

  const req = await prisma.stockOutRequest.findUnique({ where: { id }, select: { id: true, fulfilledAt: true } })
  if (!req) return NextResponse.json({ error: '출고요청을 찾을 수 없습니다.' }, { status: 404 })
  if (req.fulfilledAt) return NextResponse.json({ error: '이미 출고 처리된 요청입니다.' }, { status: 409 })

  const now = new Date()
  await prisma.stockOutRequest.update({
    where: { id },
    data: draft
      ? { fulfillDraft: { ...(draft as Record<string, unknown>), savedById: user.userId, savedByName: user.name }, fulfillDraftAt: now }
      : { fulfillDraft: Prisma.DbNull, fulfillDraftAt: null },
  })
  return NextResponse.json({ ok: true, savedAt: draft ? now.toISOString() : null, savedByName: draft ? user.name : null })
}
