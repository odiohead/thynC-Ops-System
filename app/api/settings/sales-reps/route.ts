import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { officeId, name, phone } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '담당자명을 입력해주세요.' }, { status: 400 })

  const oid = Number.isInteger(officeId) ? officeId : null
  if (oid !== null) {
    const office = await prisma.salesOffice.findUnique({ where: { id: oid } })
    if (!office) return NextResponse.json({ error: '사무소를 찾을 수 없습니다.' }, { status: 400 })
  }

  const rep = await prisma.salesRep.create({
    data: {
      officeId: oid,
      name: name.trim(),
      phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:sales_rep',
    resourceId: rep.id,
    resourceLabel: rep.name,
    after: rep,
  })

  return NextResponse.json({ rep }, { status: 201 })
}
