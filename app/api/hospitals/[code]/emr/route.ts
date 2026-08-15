import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { isEmrLinkStatus, sanitizeChoices, EMR_DATA_SCOPES, EMR_LINK_METHODS } from '@/lib/hospitalSystem'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/**
 * 병원 EMR 연동 정보 upsert (thynC 시스템 현황 — 2026-08-16). 쓰기: USER 이상
 * 1:1 — 없으면 생성, 있으면 갱신. 선택지 화이트리스트는 lib/hospitalSystem.ts 단일 소스
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()

  if (!isEmrLinkStatus(body.linkStatus)) {
    return NextResponse.json({ error: '연동상태가 올바르지 않습니다.' }, { status: 400 })
  }

  let emrVendorId: number | null = null
  if (body.emrVendorId !== undefined && body.emrVendorId !== null && body.emrVendorId !== '') {
    const n = Number(body.emrVendorId)
    if (!Number.isInteger(n)) return NextResponse.json({ error: 'EMR 업체가 올바르지 않습니다.' }, { status: 400 })
    const vendor = await prisma.statusCode.findFirst({ where: { id: n, category: 'EMR_VENDOR' }, select: { id: true } })
    if (!vendor) return NextResponse.json({ error: 'EMR 업체가 올바르지 않습니다.' }, { status: 400 })
    emrVendorId = vendor.id
  }

  const data = {
    linkStatus: body.linkStatus,
    emrVendorId,
    dataScopes: sanitizeChoices(body.dataScopes, EMR_DATA_SCOPES),
    linkMethods: sanitizeChoices(body.linkMethods, EMR_LINK_METHODS),
    memo: typeof body.memo === 'string' && body.memo.trim() ? body.memo.trim() : null,
  }

  const before = await prisma.hospitalEmrInfo.findUnique({ where: { hospitalCode: params.code } })

  const emr = await prisma.hospitalEmrInfo.upsert({
    where: { hospitalCode: params.code },
    create: { hospitalCode: params.code, ...data },
    update: data,
    include: { emrVendor: { select: { id: true, name: true } } },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: before ? 'UPDATE' : 'CREATE',
    resource: 'hospital_emr_info',
    resourceId: params.code,
    resourceLabel: `${hospital.hospitalName} EMR 연동 정보`,
    before,
    after: emr,
  })

  return NextResponse.json({ emr })
}
