import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// AI 어시스턴트 사용 현황 집계 (ADMIN 이상) — ai_usage_logs(사용량 원장, 답변 1건=1행) 기반.
// 원장은 대화(세션/메시지) 삭제와 무관하게 보존되므로 대화를 지워도 집계가 유지된다.
// 계정 삭제 시에도 원장의 이름·이메일 스냅샷으로 집계 표시 (살아있는 계정은 users 조인 최신값 우선).
// 비용은 저장하지 않고 토큰 × 단가(AppSetting)를 클라이언트에서 계산 (실청구는 Anthropic Console 기준의 추정치).

const PRICING_KEY = 'ai_usage_pricing'

export interface AiUsagePricing {
  inputPerMTok: number // USD / 1M tokens
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
  usdKrw: number // 원화 환산 환율 (0이면 원화 표시 안 함)
}

const DEFAULT_PRICING: AiUsagePricing = {
  inputPerMTok: 5,
  outputPerMTok: 25,
  cacheReadPerMTok: 0.5,
  cacheWritePerMTok: 6.25,
  usdKrw: 0,
}

const num = (v: unknown, def: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) && n >= 0 ? n : def
}

function sanitizePricing(input: unknown): AiUsagePricing {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return {
    inputPerMTok: num(o.inputPerMTok, DEFAULT_PRICING.inputPerMTok),
    outputPerMTok: num(o.outputPerMTok, DEFAULT_PRICING.outputPerMTok),
    cacheReadPerMTok: num(o.cacheReadPerMTok, DEFAULT_PRICING.cacheReadPerMTok),
    cacheWritePerMTok: num(o.cacheWritePerMTok, DEFAULT_PRICING.cacheWritePerMTok),
    usdKrw: num(o.usdKrw, DEFAULT_PRICING.usdKrw),
  }
}

async function loadPricing(): Promise<AiUsagePricing> {
  const row = await prisma.appSetting.findUnique({ where: { key: PRICING_KEY } })
  if (!row?.value) return { ...DEFAULT_PRICING }
  try {
    return sanitizePricing(JSON.parse(row.value))
  } catch {
    return { ...DEFAULT_PRICING }
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  // 기간 필터 (KST 날짜) — 기본: 이번달 1일 ~ 오늘
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000)
  const defaultFrom = `${kstNow.toISOString().slice(0, 7)}-01`
  const defaultTo = kstNow.toISOString().slice(0, 10)
  const from = DATE_RE.test(searchParams.get('from') ?? '') ? searchParams.get('from')! : defaultFrom
  const to = DATE_RE.test(searchParams.get('to') ?? '') ? searchParams.get('to')! : defaultTo

  // KST 날짜 → UTC 경계
  const fromUtc = new Date(`${from}T00:00:00+09:00`)
  const toUtc = new Date(new Date(`${to}T00:00:00+09:00`).getTime() + 24 * 3600 * 1000)

  // 월별 추이 (최근 12개월, 기간 필터와 무관)
  const monthly = await prisma.$queryRaw<
    { month: string; questions: bigint; input_tokens: bigint; output_tokens: bigint; cache_read: bigint; cache_write: bigint; users: bigint }[]
  >`
    SELECT to_char(l.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS month,
           count(*) AS questions,
           COALESCE(sum(l.input_tokens), 0)::bigint AS input_tokens,
           COALESCE(sum(l.output_tokens), 0)::bigint AS output_tokens,
           COALESCE(sum(l.cache_read_tokens), 0)::bigint AS cache_read,
           COALESCE(sum(l.cache_write_tokens), 0)::bigint AS cache_write,
           count(DISTINCT COALESCE(l.user_id, l.user_email)) AS users
    FROM ai_usage_logs l
    WHERE l.created_at >= now() - interval '12 months'
    GROUP BY 1
    ORDER BY 1
  `

  // 사용자별 (기간 필터) — 계정 삭제 시 원장 스냅샷(user_name/user_email)으로 표시
  const users = await prisma.$queryRaw<
    { user_id: string; name: string; email: string; sessions: bigint; questions: bigint; input_tokens: bigint; output_tokens: bigint; cache_read: bigint; cache_write: bigint; last_used: Date }[]
  >`
    SELECT COALESCE(l.user_id, l.user_email) AS user_id,
           max(COALESCE(u.name, l.user_name)) AS name,
           max(COALESCE(u.email, l.user_email)) AS email,
           count(DISTINCT l.session_id) AS sessions,
           count(*) AS questions,
           COALESCE(sum(l.input_tokens), 0)::bigint AS input_tokens,
           COALESCE(sum(l.output_tokens), 0)::bigint AS output_tokens,
           COALESCE(sum(l.cache_read_tokens), 0)::bigint AS cache_read,
           COALESCE(sum(l.cache_write_tokens), 0)::bigint AS cache_write,
           max(l.created_at) AS last_used
    FROM ai_usage_logs l
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.created_at >= ${fromUtc} AND l.created_at < ${toUtc}
    GROUP BY COALESCE(l.user_id, l.user_email)
    ORDER BY (COALESCE(sum(l.output_tokens), 0)) DESC
  `

  // 병원별 Top 10 (기간 필터, 병원 컨텍스트가 있는 사용만)
  const hospitals = await prisma.$queryRaw<
    { hospital_code: string; hospital_name: string; questions: bigint; sessions: bigint }[]
  >`
    SELECT l.hospital_code, h.hospital_name,
           count(*) AS questions,
           count(DISTINCT l.session_id) AS sessions
    FROM ai_usage_logs l
    JOIN hospitals h ON h.hospital_code = l.hospital_code
    WHERE l.hospital_code IS NOT NULL
      AND l.created_at >= ${fromUtc} AND l.created_at < ${toUtc}
    GROUP BY l.hospital_code, h.hospital_name
    ORDER BY 3 DESC
    LIMIT 10
  `

  const toNum = (v: bigint) => Number(v)
  return NextResponse.json({
    from,
    to,
    pricing: await loadPricing(),
    monthly: monthly.map((r) => ({
      month: r.month,
      questions: toNum(r.questions),
      inputTokens: toNum(r.input_tokens),
      outputTokens: toNum(r.output_tokens),
      cacheReadTokens: toNum(r.cache_read),
      cacheWriteTokens: toNum(r.cache_write),
      users: toNum(r.users),
    })),
    users: users.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      sessions: toNum(r.sessions),
      questions: toNum(r.questions),
      inputTokens: toNum(r.input_tokens),
      outputTokens: toNum(r.output_tokens),
      cacheReadTokens: toNum(r.cache_read),
      cacheWriteTokens: toNum(r.cache_write),
      lastUsed: r.last_used,
    })),
    hospitals: hospitals.map((r) => ({
      hospitalCode: r.hospital_code,
      hospitalName: r.hospital_name,
      questions: toNum(r.questions),
      sessions: toNum(r.sessions),
    })),
  })
}

// 단가 저장 (ADMIN 이상)
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const before = await loadPricing()
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  const pricing = sanitizePricing(body)
  await prisma.appSetting.upsert({
    where: { key: PRICING_KEY },
    update: { value: JSON.stringify(pricing) },
    create: { key: PRICING_KEY, value: JSON.stringify(pricing) },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:ai-usage',
    resourceId: PRICING_KEY,
    resourceLabel: 'AI 사용 단가',
    before,
    after: pricing,
  })
  return NextResponse.json({ pricing })
}
