import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

// VOC 분류 (VOC_TYPE) — cs_ticket_workflow_design.md §5 (자동생성 규칙의 조건 축)
// 워크플로 상태가 아니므로 ticket_status 매핑 없음

export async function GET() {
  const statusCodes = await prisma.statusCode.findMany({
    where: { category: 'VOC_TYPE' },
    orderBy: { order: 'asc' },
  })

  return NextResponse.json({ statusCodes })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, order, color } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: 'VOC 분류명을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.statusCode.findFirst({ where: { name: name.trim(), category: 'VOC_TYPE' } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 VOC 분류명입니다.' }, { status: 409 })
  }

  const statusCode = await prisma.statusCode.create({
    data: { name: name.trim(), order: order ?? 0, color: color ?? null, category: 'VOC_TYPE' },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:voc_type',
    resourceId: statusCode.id,
    resourceLabel: statusCode.name,
    after: statusCode,
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
