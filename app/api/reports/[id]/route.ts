import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { aiStateOf, reportDocOf, settleStale } from '@/lib/report/runner'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const found = await prisma.reportRun.findUnique({ where: { id: params.id } }).catch(() => null)
  if (!found) return NextResponse.json({ error: '보고서를 찾을 수 없습니다.' }, { status: 404 })
  const run = await settleStale(found)
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: run.hospitalCode }, select: { hospitalName: true } })
  return NextResponse.json({
    id: run.id,
    status: run.status,
    aiState: aiStateOf(run),
    error: run.error,
    aiError: run.aiError,
    model: run.model,
    effort: run.effort,
    docNumber: run.docNumber,
    hospitalCode: run.hospitalCode,
    hospitalName: hospital?.hospitalName ?? run.hospitalCode,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    tokens: { input: run.inputTokens, output: run.outputTokens },
    doc: await reportDocOf(run),
  })
}

/** 문서번호 수정 (D1) */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => null)
  if (typeof body?.docNumber !== 'string') return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  const before = await prisma.reportRun.findUnique({ where: { id: params.id }, select: { docNumber: true } }).catch(() => null)
  if (!before) return NextResponse.json({ error: '보고서를 찾을 수 없습니다.' }, { status: 404 })
  const docNumber = body.docNumber.trim().slice(0, 50) || null
  await prisma.reportRun.update({ where: { id: params.id }, data: { docNumber } })
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'report', resourceId: params.id, resourceLabel: '보고서 문서번호', before, after: { docNumber } })
  return NextResponse.json({ docNumber })
}
