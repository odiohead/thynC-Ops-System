import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess } from '@/lib/sales'

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
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const stageId = intOrNull(body.stageId)
  const ownerId = strOrNull(body.ownerId)
  const totalBeds = intOrNull(body.totalBeds)
  const totalWards = intOrNull(body.totalWards)

  if (stageId !== null) {
    const stage = await prisma.statusCode.findUnique({ where: { id: stageId }, select: { category: true } })
    if (stage?.category !== 'SALES_STAGE') return NextResponse.json({ error: '영업 단계 값이 올바르지 않습니다.' }, { status: 400 })
  }
  if (ownerId !== null) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { isActive: true } })
    if (!owner || !owner.isActive) return NextResponse.json({ error: '담당 영업 값이 올바르지 않습니다.' }, { status: 400 })
  }

  const data = {
    stageId,
    ownerId,
    totalBeds,
    totalWards,
    salesMemo: typeof body.salesMemo === 'string' && body.salesMemo.trim() ? body.salesMemo : null,
  }

  const before = await prisma.hospitalSalesProfile.findUnique({ where: { hospitalCode: params.code } })
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
