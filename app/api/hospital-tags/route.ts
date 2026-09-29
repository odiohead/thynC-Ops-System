/** GET /api/hospital-tags — 병원 태그 마스터(활성) 목록. 로그인 사용자 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const tags = await prisma.hospitalTag.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, key: true, name: true, description: true, effectNote: true, color: true, isSystem: true, sortOrder: true },
  })
  return NextResponse.json({ tags })
}
