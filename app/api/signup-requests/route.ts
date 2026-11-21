import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * 가입 신청 목록 (2026-11-13) — ADMIN 이상.
 * GET ?status=PENDING(기본)|DONE → { requests, pendingCount }. DONE = 승인·반려 최근 30건
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const done = req.nextUrl.searchParams.get('status') === 'DONE'
  const [requests, pendingCount] = await Promise.all([
    prisma.signupRequest.findMany({
      where: done ? { status: { in: ['APPROVED', 'REJECTED'] } } : { status: 'PENDING' },
      select: {
        id: true, email: true, name: true, phone: true, memo: true, status: true, rejectReason: true, createdAt: true, reviewedAt: true,
        organization: { select: { id: true, name: true, code: true } },
        reviewedBy: { select: { name: true } },
        user: { select: { id: true, role: true } },
      },
      orderBy: done ? { reviewedAt: 'desc' } : { createdAt: 'asc' },
      take: done ? 30 : 300,
    }),
    prisma.signupRequest.count({ where: { status: 'PENDING' } }),
  ])
  return NextResponse.json({ requests, pendingCount })
}
