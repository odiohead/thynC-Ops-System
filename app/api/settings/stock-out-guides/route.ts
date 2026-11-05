/**
 * 출고요청 입력 가이드 (projects/stock_out_sales_request_design.md §5) — 모바일 출고요청 폼의 항목 제목 아래 안내 문구
 * GET : 로그인 전원 — 항목별 문구(빈 값이면 기본 문구) + 저장된 원본
 * PUT : ADMIN 이상 — { guides: { [key]: string } } 저장 (app_settings JSON). 빈 문자열 = 기본 문구 사용
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { STOCK_OUT_GUIDE_FIELDS, STOCK_OUT_GUIDE_SETTING_KEY, type StockOutGuides } from '@/lib/stockOutShared'

export const dynamic = 'force-dynamic'

async function loadSaved(): Promise<StockOutGuides> {
  const row = await prisma.appSetting.findUnique({ where: { key: STOCK_OUT_GUIDE_SETTING_KEY } })
  if (!row?.value) return {}
  try {
    const parsed = JSON.parse(row.value)
    return parsed && typeof parsed === 'object' ? (parsed as StockOutGuides) : {}
  } catch {
    return {}
  }
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const saved = await loadSaved()
  const guides: Record<string, string> = {}
  for (const f of STOCK_OUT_GUIDE_FIELDS) guides[f.key] = saved[f.key]?.trim() || f.fallback
  return NextResponse.json({ guides, saved })
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const input = (body?.guides ?? {}) as Record<string, unknown>
  const next: StockOutGuides = {}
  for (const f of STOCK_OUT_GUIDE_FIELDS) {
    const v = input[f.key]
    if (typeof v === 'string' && v.trim()) next[f.key] = v.trim().slice(0, 300)
  }

  const before = await loadSaved()
  await prisma.appSetting.upsert({
    where: { key: STOCK_OUT_GUIDE_SETTING_KEY },
    create: { key: STOCK_OUT_GUIDE_SETTING_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:stock_out_request_guides',
    resourceLabel: '출고요청 입력 가이드',
    before,
    after: next,
  })

  return NextResponse.json({ saved: next })
}
