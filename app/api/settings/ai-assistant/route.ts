import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import {
  AI_CACHE_TTLS,
  AI_CHAT_MODEL,
  AI_EFFORTS,
  AI_SETTINGS_KEY,
  AI_SUMMARIZE_MODEL,
  DEFAULT_AI_SETTINGS,
  getAiSettings,
  sanitizeAiSettings,
} from '@/lib/ai/settings'

export const dynamic = 'force-dynamic'

// AI 어시스턴트 런타임 설정 (ADMIN 이상)
// 모델 ID는 코드 고정이라 읽기 전용으로만 내려주고, 조절 가능한 것은 effort·캐시 TTL 뿐이다.

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({
    settings: await getAiSettings(),
    defaults: DEFAULT_AI_SETTINGS,
    options: { efforts: AI_EFFORTS, cacheTtls: AI_CACHE_TTLS },
    models: { chat: AI_CHAT_MODEL, summarize: AI_SUMMARIZE_MODEL },
  })
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })

  const before = await getAiSettings()
  const settings = sanitizeAiSettings(body)
  await prisma.appSetting.upsert({
    where: { key: AI_SETTINGS_KEY },
    update: { value: JSON.stringify(settings) },
    create: { key: AI_SETTINGS_KEY, value: JSON.stringify(settings) },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:ai-assistant',
    resourceId: AI_SETTINGS_KEY,
    resourceLabel: 'AI 어시스턴트 설정',
    before,
    after: settings,
  })
  return NextResponse.json({ settings })
}
