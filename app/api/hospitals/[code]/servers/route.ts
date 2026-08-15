import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { sanitizeUrl } from '@/lib/hospitalSystem'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

// 병원 서버 현황 등록 (thynC 시스템 현황 — 2026-08-16). 쓰기: USER 이상
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: '서버 이름을 입력하세요.' }, { status: 400 })

  const last = await prisma.hospitalServer.findFirst({
    where: { hospitalCode: params.code },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })

  const server = await prisma.hospitalServer.create({
    data: {
      hospitalCode: params.code,
      name,
      wardInfo: typeof body.wardInfo === 'string' && body.wardInfo.trim() ? body.wardInfo.trim() : null,
      monitoringUrl: sanitizeUrl(body.monitoringUrl) ?? null,
      remoteUrl: sanitizeUrl(body.remoteUrl) ?? null,
      sortOrder: (last?.sortOrder ?? 0) + 10,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'hospital_server',
    resourceId: server.id,
    resourceLabel: `${hospital.hospitalName} 서버 ${name}`,
    after: server,
  })

  return NextResponse.json({ server }, { status: 201 })
}
