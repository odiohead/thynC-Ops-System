import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { sanitizeUrl } from '@/lib/hospitalSystem'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; id: string } }

// 병원 서버 수정/삭제 (thynC 시스템 현황 — 2026-08-16). 쓰기: USER 이상
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.hospitalServer.findUnique({ where: { id } })
  if (!before || before.hospitalCode !== params.code) {
    return NextResponse.json({ error: '서버를 찾을 수 없습니다.' }, { status: 404 })
  }

  const body = await request.json()
  const data: { name?: string; wardInfo?: string | null; monitoringUrl?: string | null; remoteUrl?: string | null } = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: '서버 이름을 입력하세요.' }, { status: 400 })
    data.name = name
  }
  if (body.wardInfo !== undefined) data.wardInfo = typeof body.wardInfo === 'string' && body.wardInfo.trim() ? body.wardInfo.trim() : null
  const mon = sanitizeUrl(body.monitoringUrl)
  if (mon !== undefined) data.monitoringUrl = mon
  const rem = sanitizeUrl(body.remoteUrl)
  if (rem !== undefined) data.remoteUrl = rem

  const server = await prisma.hospitalServer.update({ where: { id }, data })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'hospital_server',
    resourceId: id,
    resourceLabel: `${params.code} 서버 ${server.name}`,
    before,
    after: server,
  })

  return NextResponse.json({ server })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.hospitalServer.findUnique({ where: { id } })
  if (!before || before.hospitalCode !== params.code) {
    return NextResponse.json({ error: '서버를 찾을 수 없습니다.' }, { status: 404 })
  }

  await prisma.hospitalServer.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'hospital_server',
    resourceId: id,
    resourceLabel: `${params.code} 서버 ${before.name}`,
    before,
  })

  return NextResponse.json({ success: true })
}
