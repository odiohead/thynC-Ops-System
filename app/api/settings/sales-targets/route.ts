import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { checkSalesAccess } from '@/lib/sales'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import {
  SALES_TARGET_TYPE_ORDER,
  getSalesBedTargets,
  parseSalesTargetYear,
  salesTargetKey,
  sanitizeSalesTargets,
} from '@/lib/salesTargets'

export const dynamic = 'force-dynamic'

/**
 * 영업 연도별 종별 목표 병상수 (영업 대시보드 '목표현황' 탭)
 * 열람: 영업 접근 게이트 공통 / 수정: ADMIN 이상 (2026-08-18 사용자 결정)
 */

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const year = parseSalesTargetYear(request.nextUrl.searchParams.get('year')) ?? 2026
  return NextResponse.json({ year, targets: await getSalesBedTargets(year), types: SALES_TARGET_TYPE_ORDER })
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '목표 설정은 ADMIN 이상만 가능합니다.' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  const year = parseSalesTargetYear(body?.year) ?? 2026
  const targets = sanitizeSalesTargets(body?.targets)
  if (!targets) return NextResponse.json({ error: '잘못된 목표 값입니다. (종별별 0 이상 정수)' }, { status: 400 })

  const key = salesTargetKey(year)
  const before = await getSalesBedTargets(year)
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(targets) },
    create: { key, value: JSON.stringify(targets) },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:sales-targets',
    resourceId: key,
    resourceLabel: `${year}년 종별 목표 병상수`,
    before,
    after: targets,
  })
  return NextResponse.json({ year, targets })
}
