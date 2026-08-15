import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// VOC 접수 채널 (VOC_CHANNEL) 조회 전용 — 관리 화면은 없음 (시드 값, 필요 시 후속)
export async function GET() {
  const statusCodes = await prisma.statusCode.findMany({
    where: { category: 'VOC_CHANNEL' },
    orderBy: { order: 'asc' },
    select: { id: true, name: true, color: true, order: true },
  })
  return NextResponse.json({ statusCodes })
}
