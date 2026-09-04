import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { matchSerials, matchWarning } from '@/lib/asReceiptService'

export const dynamic = 'force-dynamic'

/**
 * AS접수 등록 폼 — 시리얼 원장 매칭 미리보기 (as_work_design.md §8)
 * POST { hospitalCode, serials: string[] } → { results: [{serialNo, state, modelName, wardName, hospitalName, asOpen, warning}] }
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const hospitalCode = typeof body.hospitalCode === 'string' ? body.hospitalCode.trim() : ''
  if (!hospitalCode) return NextResponse.json({ error: '병원을 선택하세요.' }, { status: 400 })
  const serials = Array.isArray(body.serials) ? body.serials.map(String).filter(Boolean).slice(0, 200) : []
  if (!serials.length) return NextResponse.json({ error: '시리얼을 입력하세요.' }, { status: 400 })

  const matches = await matchSerials(prisma, hospitalCode, serials)
  return NextResponse.json({ results: matches.map((m) => ({ ...m, warning: matchWarning(m) })) })
}
