/**
 * 병원 AS메모 (2026-09-29) — 병원 상세 '부가정보 > AS메모' · AS접수 상세 '1.공통정보' 공용
 * GET  /api/hospitals/[code]/as-memo — { asMemo, updatedAt, updatedBy } (로그인)
 * PUT  /api/hospitals/[code]/as-memo { asMemo } — USER 이상(VIEWER 403). HTML sanitize 후 저장, 빈 값은 NULL. 감사 hospital_as_memo UPDATE
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { sanitizeRichTextHtml, isEmptyRichText } from '@/lib/richtext'

export const dynamic = 'force-dynamic'
type Params = { params: { code: string } }
const SELECT = { asMemo: true, asMemoUpdatedAt: true, asMemoUpdatedBy: { select: { id: true, name: true } } } as const
const shape = (m: { asMemo: string | null; asMemoUpdatedAt: Date | null; asMemoUpdatedBy: { id: string; name: string } | null } | null) =>
  ({ asMemo: m?.asMemo ?? null, updatedAt: m?.asMemoUpdatedAt ?? null, updatedBy: m?.asMemoUpdatedBy ?? null })

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, meta: { select: SELECT } } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json(shape(hospital.meta))
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isUserOrAbove(user.role)) return NextResponse.json({ error: 'AS메모 수정 권한이 없습니다.' }, { status: 403 })
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true, meta: { select: SELECT } } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })
  const body = await request.json().catch(() => null)
  if (!body || (body.asMemo !== null && typeof body.asMemo !== 'string')) return NextResponse.json({ error: 'asMemo는 문자열 또는 null' }, { status: 400 })
  const raw = typeof body.asMemo === 'string' ? body.asMemo : ''
  if (raw.length > 50_000) return NextResponse.json({ error: 'AS메모는 50,000자를 넘을 수 없습니다.' }, { status: 400 })
  const html = sanitizeRichTextHtml(raw.trim())
  const asMemo = isEmptyRichText(html) ? null : html
  const before = hospital.meta?.asMemo ?? null
  if (asMemo === before) return NextResponse.json(shape(hospital.meta))
  const meta = await prisma.hospitalMeta.upsert({
    where: { hospitalCode: hospital.hospitalCode },
    create: { hospitalCode: hospital.hospitalCode, asMemo, asMemoUpdatedAt: new Date(), asMemoUpdatedById: user.userId },
    update: { asMemo, asMemoUpdatedAt: new Date(), asMemoUpdatedById: user.userId },
    select: SELECT,
  })
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'hospital_as_memo', resourceId: hospital.hospitalCode, resourceLabel: `${hospital.hospitalName} AS메모`, before: { asMemo: before }, after: { asMemo } })
  return NextResponse.json(shape(meta))
}
