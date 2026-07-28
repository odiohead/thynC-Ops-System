import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; id: string } }

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

async function guard(request: NextRequest, params: Params['params']) {
  const user = await getAuthUser(request)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const denial = await checkSalesAccess(user)
  if (denial) return { error: NextResponse.json({ error: denial.error }, { status: denial.status }) }
  const id = parseInt(params.id)
  if (isNaN(id)) return { error: NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 }) }
  const contact = await prisma.hospitalContact.findUnique({ where: { id } })
  if (!contact || contact.hospitalCode !== params.code) return { error: NextResponse.json({ error: '담당자를 찾을 수 없습니다.' }, { status: 404 }) }
  return { user, id, contact }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error

  const body = await request.json()
  const name = str(body.name)
  if (!name) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 })

  const contact = await prisma.hospitalContact.update({
    where: { id: g.id },
    data: {
      name,
      title: str(body.title),
      department: str(body.department),
      phone: str(body.phone),
      email: str(body.email),
      roleNote: str(body.roleNote),
      isPrimary: body.isPrimary === true,
      isActive: body.isActive !== false,
      sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder : g.contact.sortOrder,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'UPDATE',
    resource: 'sales_contact',
    resourceId: g.id,
    resourceLabel: `키맨 ${contact.name}`,
    before: g.contact,
    after: contact,
  })

  return NextResponse.json({ contact })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error

  await prisma.hospitalContact.delete({ where: { id: g.id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'DELETE',
    resource: 'sales_contact',
    resourceId: g.id,
    resourceLabel: `키맨 ${g.contact.name}`,
    before: g.contact,
  })

  return NextResponse.json({ ok: true })
}
