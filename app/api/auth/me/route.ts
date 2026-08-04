import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getUserPermissions } from '@/lib/appRoles'
import { PERM_KEYS } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      vehicleReservationBlocked: true,
      createdAt: true,
      organization: { select: { id: true, name: true, code: true } },
      department: { select: { id: true, name: true } },
    },
  })

  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RBAC Lite — 유효 권한 키 목록 (메뉴 노출·클라이언트 UI 게이트 공용, 보안은 각 API 체크가 담당)
  // SUPER_ADMIN은 전권 등급이므로 카탈로그 전체를 반환
  const permissions =
    user.role === 'SUPER_ADMIN' ? [...PERM_KEYS] : Array.from(await getUserPermissions(user.id))

  return NextResponse.json({ ...user, permissions })
}
