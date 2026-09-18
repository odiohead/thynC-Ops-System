import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess, isSalesOwnerCandidate } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

const intOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v))
  return Number.isInteger(n) && n >= 0 ? n : null
}
const strOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** 영업 프로필 upsert — 단계·담당·전체 병상/병동·다음 액션·메모 */
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const before = await prisma.hospitalSalesProfile.findUnique({ where: { hospitalCode: params.code } })
  const body = await request.json()
  const stageId = intOrNull(body.stageId)
  const ownerId = strOrNull(body.ownerId)
  const totalBeds = intOrNull(body.totalBeds)
  const totalWards = intOrNull(body.totalWards)

  if (stageId !== null) {
    const stage = await prisma.statusCode.findUnique({ where: { id: stageId }, select: { category: true } })
    if (stage?.category !== 'SALES_STAGE') return NextResponse.json({ error: '영업 단계 값이 올바르지 않습니다.' }, { status: 400 })
  }
  if (ownerId !== null && ownerId !== before?.ownerId) {
    // 새로 지정하는 담당은 SALES_MANAGER 역할 보유 활성 계정만 (2026-09-18). 기존 담당 유지(변경 없음)는 역할이 빠져도 통과
    if (!(await isSalesOwnerCandidate(ownerId))) return NextResponse.json({ error: '담당 영업은 영업담당(SALES_MANAGER) 역할이 부여된 활성 계정만 지정할 수 있습니다.' }, { status: 400 })
  }

  const data = {
    stageId,
    ownerId,
    totalBeds,
    totalWards,
    salesMemo: typeof body.salesMemo === 'string' && body.salesMemo.trim() ? body.salesMemo : null,
  }

  const profile = await prisma.hospitalSalesProfile.upsert({
    where: { hospitalCode: params.code },
    create: { hospitalCode: params.code, ...data },
    update: data,
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: before ? 'UPDATE' : 'CREATE',
    resource: 'sales_profile',
    resourceId: profile.id,
    resourceLabel: `${hospital.hospitalName} 영업 프로필`,
    before,
    after: profile,
  })

  return NextResponse.json({ profile })
}
