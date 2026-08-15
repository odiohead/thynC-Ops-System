import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/**
 * thynC 시스템 현황 통합 조회 (2026-08-16) — 서버 현황 + EMR 연동 정보 + EMR 업체 마스터
 * 조회: 로그인 전체
 */
export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const [servers, emr, vendors] = await Promise.all([
    prisma.hospitalServer.findMany({
      where: { hospitalCode: params.code },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.hospitalEmrInfo.findUnique({
      where: { hospitalCode: params.code },
      include: { emrVendor: { select: { id: true, name: true } } },
    }),
    prisma.statusCode.findMany({
      where: { category: 'EMR_VENDOR' },
      orderBy: { order: 'asc' },
      select: { id: true, name: true },
    }),
  ])

  return NextResponse.json({ servers, emr, vendors })
}
