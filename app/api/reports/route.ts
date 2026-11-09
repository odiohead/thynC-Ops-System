import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { REPORT_KIND_HOSPITAL, startHospitalReport } from '@/lib/report/runner'

export const dynamic = 'force-dynamic'

// 레포트 — 생성 이력 목록 / 병원 운영 이력 보고서 생성 (최고관리자 — projects/hospital_report_design.md §10·§11)

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const take = Math.min(Math.max(Number(request.nextUrl.searchParams.get('take')) || 20, 1), 200)
  const [runs, total] = await Promise.all([
    prisma.reportRun.findMany({
      where: { kind: REPORT_KIND_HOSPITAL },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, status: true, aiError: true, model: true, effort: true, createdAt: true, finishedAt: true,
        hospital: { select: { hospitalCode: true, hospitalName: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.reportRun.count({ where: { kind: REPORT_KIND_HOSPITAL } }),
  ])
  return NextResponse.json({ runs, total })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => null)
  const hospitalCode = typeof body?.hospitalCode === 'string' ? body.hospitalCode.trim() : ''
  if (!hospitalCode) return NextResponse.json({ error: '병원을 선택하세요.' }, { status: 400 })
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })
  const docNumber = typeof body?.docNumber === 'string' ? body.docNumber.slice(0, 50) : null

  const run = await startHospitalReport({ hospitalCode, userId: user.userId, docNumber })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'CREATE', resource: 'report', resourceId: run.id,
    resourceLabel: `고객 운영 이력 레포트 — ${hospital.hospitalName ?? hospitalCode}`, after: { hospitalCode, model: run.model, effort: run.effort },
  })
  return NextResponse.json({ id: run.id }, { status: 201 })
}
