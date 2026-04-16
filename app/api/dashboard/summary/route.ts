import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ADOPTED_STATUSES = ['계약완료', '운영']

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hospitals = await prisma.hospital.findMany({
    where: { status: { in: ADOPTED_STATUSES } },
    select: { introBeds: true, status: true },
  })

  const hospitalCount = hospitals.length
  const bedCount = hospitals.reduce((sum, h) => sum + (h.introBeds ?? 0), 0)

  // 상태별 세부
  const byStatus = ADOPTED_STATUSES.map((status) => {
    const filtered = hospitals.filter((h) => h.status === status)
    return {
      status,
      hospitalCount: filtered.length,
      bedCount: filtered.reduce((sum, h) => sum + (h.introBeds ?? 0), 0),
    }
  })

  return NextResponse.json({ hospitalCount, bedCount, byStatus })
}
