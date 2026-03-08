import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') return null
  return payload
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { isActive } = await req.json()

  const user = await prisma.user.update({
    where: { id: params.id },
    data: { isActive },
    select: { id: true, email: true, name: true, phone: true, role: true, isActive: true, createdAt: true },
  })

  return NextResponse.json(user)
}
