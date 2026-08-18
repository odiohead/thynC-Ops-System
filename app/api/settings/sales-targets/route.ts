import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { checkSalesAccess } from '@/lib/sales'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import {
  SALES_TARGET_TYPE_ORDER,
  getSalesTargetSettings,
  parseSalesTargetYear,
  salesTargetKey,
  sanitizeSalesTargets,
  sanitizeTotalColor,
  sanitizeTypeColors,
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
  const settings = await getSalesTargetSettings(year)
  return NextResponse.json({ year, ...settings, types: SALES_TARGET_TYPE_ORDER })
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
  const before = await getSalesTargetSettings(year)
  const totalColor = sanitizeTotalColor(body?.totalColor) ?? before.totalColor
  const typeColors = body?.typeColors === undefined ? before.typeColors : sanitizeTypeColors(body.typeColors)
  const settings = { targets, totalColor, typeColors }

  const key = salesTargetKey(year)
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(settings) },
    create: { key, value: JSON.stringify(settings) },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:sales-targets',
    resourceId: key,
    resourceLabel: `${year}년 종별 목표 병상수`,
    before,
    after: settings,
  })
  return NextResponse.json({ year, ...settings })
}
