import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Ctx = { params: { id: string } }

/**
 * PATCH /api/wiki/pages/[id]/ai-exclude
 * 위키 페이지를 AI 어시스턴트 검색에서 제외/해제 (ADMIN 이상).
 * 제외는 하위 페이지 전체에 cascade 적용된다(조회 시 계층 계산 — lib/wiki/aiExclusion).
 * body: { excluded: boolean }
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: 'AI 검색 제외 설정은 관리자만 변경할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const excluded = (body as { excluded?: unknown }).excluded
  if (typeof excluded !== 'boolean') {
    return NextResponse.json({ error: 'excluded(boolean)가 필요합니다.' }, { status: 400 })
  }

  const existing = await prisma.wikiPage.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, aiExcluded: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.wikiPage.update({
    where: { id: params.id },
    data: { aiExcluded: excluded },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'UPDATE',
    resource: 'wiki_page',
    resourceId: existing.id,
    resourceLabel: existing.title,
    before: { aiExcluded: existing.aiExcluded },
    after: { aiExcluded: excluded },
  })

  return NextResponse.json({ id: existing.id, aiExcluded: excluded })
}
