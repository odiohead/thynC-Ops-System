import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Ctx = { params: { id: string } }

/**
 * 휴지통에서 페이지 복구. 페이지 + (함께 삭제됐던) 하위 전체를 복원.
 * 부모가 삭제 상태/없음이면 최상위로 승격.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const page = await prisma.wikiPage.findUnique({ where: { id: params.id } })
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 하위(삭제 상태 포함) 전체 수집
  const all = await prisma.wikiPage.findMany({ select: { id: true, parentId: true } })
  const childrenOf = new Map<string, string[]>()
  for (const p of all) {
    if (p.parentId) {
      const arr = childrenOf.get(p.parentId) ?? []
      arr.push(p.id)
      childrenOf.set(p.parentId, arr)
    }
  }
  const ids: string[] = [params.id]
  const queue = [params.id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const k of childrenOf.get(cur) ?? []) {
      ids.push(k)
      queue.push(k)
    }
  }

  // 부모가 삭제 상태이거나 없으면 루트로 승격
  let promoteToRoot = false
  if (page.parentId) {
    const parent = await prisma.wikiPage.findUnique({
      where: { id: page.parentId },
      select: { deletedAt: true },
    })
    if (!parent || parent.deletedAt) promoteToRoot = true
  }

  await prisma.$transaction([
    prisma.wikiPage.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
    ...(promoteToRoot
      ? [prisma.wikiPage.update({ where: { id: params.id }, data: { parentId: null } })]
      : []),
  ])

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'UPDATE',
    resource: 'wiki_page',
    resourceId: page.id,
    resourceLabel: page.title,
    after: { restored: true },
  })

  return NextResponse.json({ id: page.id, promotedToRoot: promoteToRoot })
}
