import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

type Params = { params: { id: string } }

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const fe = await prisma.fieldEngineer.findUnique({ where: { id: parseInt(params.id) } })
  if (!fe) return NextResponse.json({ error: '필드 엔지니어를 찾을 수 없습니다.' }, { status: 404 })

  await prisma.fieldEngineer.delete({ where: { id: parseInt(params.id) } })
  return new NextResponse(null, { status: 204 })
}
