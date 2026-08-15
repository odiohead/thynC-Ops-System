import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

// EMR 업체 마스터 (EMR_VENDOR) — 병원 상세 thynC 시스템 현황의 EMR 연동 정보에서 선택 (2026-08-16)
// 워크플로 상태가 아니므로 ticket_status 매핑 없음

export async function GET() {
  const statusCodes = await prisma.statusCode.findMany({
    where: { category: 'EMR_VENDOR' },
    orderBy: { order: 'asc' },
  })

  return NextResponse.json({ statusCodes })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, order, color } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: 'EMR 업체명을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.statusCode.findFirst({ where: { name: name.trim(), category: 'EMR_VENDOR' } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 EMR 업체명입니다.' }, { status: 409 })
  }

  const statusCode = await prisma.statusCode.create({
    data: { name: name.trim(), order: order ?? 0, color: color ?? null, category: 'EMR_VENDOR' },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:emr_vendor',
    resourceId: statusCode.id,
    resourceLabel: statusCode.name,
    after: statusCode,
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
