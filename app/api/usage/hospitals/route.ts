import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { listUsageHospitals } from '@/lib/usage/metrics'
import { usageError, usageGate } from '../_shared'

export const dynamic = 'force-dynamic'

/** 사용량 데이터가 들어오는 병원 목록 (병원 서버에 수집 Agent가 설치된 병원) */
export async function GET(req: NextRequest) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  try {
    const list = await listUsageHospitals()
    const names = await prisma.hospital.findMany({
      where: { hospitalCode: { in: list.map((h) => h.hospitalCode) } },
      select: { hospitalCode: true, hospitalName: true },
    })
    const nameOf = new Map(names.map((n) => [n.hospitalCode, n.hospitalName]))
    const hospitals = list
      .map((h) => ({ ...h, hospitalName: nameOf.get(h.hospitalCode) ?? h.hospitalCode }))
      .sort((a, b) => a.hospitalName.localeCompare(b.hospitalName, 'ko'))
    return NextResponse.json({ hospitals })
  } catch (e) {
    return usageError(e)
  }
}
