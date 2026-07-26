import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { DOMAIN_META, type DomainRefType } from '@/lib/ticketCtiRules'

export const dynamic = 'force-dynamic'

// CTI 트리 전체 (level 1~3, parent_id 계층)
export async function GET() {
  const [nodes, rules] = await Promise.all([
    prisma.ticketCti.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        defaultQueue: { select: { id: true, name: true } },
        _count: { select: { tickets: true, children: true } },
      },
    }),
    // 자동생성 규칙 사용처 — 트리가 어디에 쓰이는지 화면에 드러낸다 (ticket_cti_rule_design.md §7)
    prisma.ticketDomainCtiRule.findMany({ select: { ctiId: true, refType: true } }),
  ])

  const usage = new Map<number, string[]>()
  for (const r of rules) {
    const labels = usage.get(r.ctiId) ?? []
    const label = DOMAIN_META[r.refType as DomainRefType]?.label ?? r.refType
    if (!labels.includes(label)) labels.push(label)
    usage.set(r.ctiId, labels)
  }

  return NextResponse.json({
    nodes: nodes.map((n) => ({ ...n, ruleUsage: usage.get(n.id) ?? [] })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: '분류명을 입력하세요.' }, { status: 400 })

  const parentId = typeof body.parentId === 'number' ? body.parentId : null
  let level = 1
  if (parentId) {
    const parent = await prisma.ticketCti.findUnique({ where: { id: parentId } })
    if (!parent) return NextResponse.json({ error: '상위 분류를 찾을 수 없습니다.' }, { status: 400 })
    if (parent.level >= 3) return NextResponse.json({ error: 'CTI는 3단계(Category/Type/Item)까지만 가능합니다.' }, { status: 400 })
    level = parent.level + 1
  }

  const dup = await prisma.ticketCti.findFirst({ where: { parentId, name } })
  if (dup) return NextResponse.json({ error: '같은 상위 아래 동일한 분류명이 있습니다.' }, { status: 409 })

  let defaultQueueId: number | null = null
  if (typeof body.defaultQueueId === 'number') {
    const queue = await prisma.ticketQueue.findUnique({ where: { id: body.defaultQueueId } })
    if (!queue) return NextResponse.json({ error: '기본 Assignment Group을 찾을 수 없습니다.' }, { status: 400 })
    defaultQueueId = queue.id
  }

  const node = await prisma.ticketCti.create({
    data: {
      name,
      parentId,
      level,
      defaultQueueId,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:ticket_cti',
    resourceId: node.id,
    resourceLabel: `L${node.level} ${node.name}`,
    after: node,
  })

  return NextResponse.json({ node }, { status: 201 })
}
