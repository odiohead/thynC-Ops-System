import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { USAGE_PERIODS, getUsageDaily } from '@/lib/usage/metrics'
import { HOSPITAL_CODE_RE, usageError, usageGate } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * 병원의 일별 사용량 — ?hospital=<병원코드>&days=30|90
 * 측정 환자 수·최대 동시측정 수 + 기기 종류별(심전계·산소포화도·카트온) 사용 횟수·최대 동시사용·등록 기기 수
 */
export async function GET(req: NextRequest) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  const hospital = req.nextUrl.searchParams.get('hospital') ?? ''
  if (!HOSPITAL_CODE_RE.test(hospital)) return NextResponse.json({ error: '병원 코드가 올바르지 않습니다.' }, { status: 400 })
  const daysParam = Number(req.nextUrl.searchParams.get('days') ?? USAGE_PERIODS[0])
  const days = (USAGE_PERIODS as readonly number[]).includes(daysParam) ? daysParam : USAGE_PERIODS[0]
  try {
    const [daily, row] = await Promise.all([
      getUsageDaily(hospital, days),
      prisma.hospital.findUnique({ where: { hospitalCode: hospital }, select: { hospitalName: true } }),
    ])
    return NextResponse.json({ ...daily, hospitalName: row?.hospitalName ?? hospital })
  } catch (e) {
    return usageError(e)
  }
}
