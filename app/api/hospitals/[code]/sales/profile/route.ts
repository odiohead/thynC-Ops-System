import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/** 영업 프로필 upsert */
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const totalBeds = body.totalBeds === null || body.totalBeds === '' || body.totalBeds === undefined ? null : parseInt(body.totalBeds)
  const totalWards = body.totalWards === null || body.totalWards === '' || body.totalWards === undefined ? null : parseInt(body.totalWards)
  if (totalBeds !== null && (isNaN(totalBeds) || totalBeds < 0)) return NextResponse.json({ error: '전체 병상수가 올바르지 않습니다.' }, { status: 400 })
  if (totalWards !== null && (isNaN(totalWards) || totalWards < 0)) return NextResponse.json({ error: '전체 병동수가 올바르지 않습니다.' }, { status: 400 })

  const data = {
    totalBeds,
    totalWards,
    grade: typeof body.grade === 'string' && body.grade.trim() ? body.grade.trim() : null,
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
