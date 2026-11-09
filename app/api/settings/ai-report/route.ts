import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import {
  AI_EFFORTS,
  AI_REPORT_MODELS,
  AI_REPORT_SETTINGS_KEY,
  DEFAULT_AI_REPORT_SETTINGS,
  getAiReportSettings,
  sanitizeAiReportSettings,
} from '@/lib/ai/settings'

export const dynamic = 'force-dynamic'

// 레포트 전용 AI 설정 (최고관리자 — 레포트 메뉴와 같은 권한). 어시스턴트 설정과 분리 (projects/hospital_report_design.md §7.1)

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({
    settings: await getAiReportSettings(),
    defaults: DEFAULT_AI_REPORT_SETTINGS,
    options: { models: AI_REPORT_MODELS, efforts: AI_EFFORTS },
  })
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  const before = await getAiReportSettings()
  const settings = sanitizeAiReportSettings(body)
  await prisma.appSetting.upsert({
    where: { key: AI_REPORT_SETTINGS_KEY },
    update: { value: JSON.stringify(settings) },
    create: { key: AI_REPORT_SETTINGS_KEY, value: JSON.stringify(settings) },
  })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'setting:ai-report', resourceId: AI_REPORT_SETTINGS_KEY,
    resourceLabel: '레포트 AI 설정', before, after: settings,
  })
  return NextResponse.json({ settings })
}
