import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const name = str(body.name)
  if (!name) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 })

  const contact = await prisma.hospitalContact.create({
    data: {
      hospitalCode: params.code,
      name,
      title: str(body.title),
      department: str(body.department),
      phone: str(body.phone),
      email: str(body.email),
      roleNote: str(body.roleNote),
      isPrimary: body.isPrimary === true,
      sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder : 0,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'sales_contact',
    resourceId: contact.id,
    resourceLabel: `${hospital.hospitalName} 키맨 ${contact.name}`,
    after: contact,
  })

  return NextResponse.json({ contact }, { status: 201 })
}
