import { prisma } from '@/lib/prisma'

/**
 * AI 어시스턴트 런타임 설정 (AppSetting `ai_assistant_settings`, JSON 단일 키)
 *
 * 모델 ID는 코드 상수로 고정한다(설정으로 열면 오타 하나로 전 요청이 404).
 * 런타임에 조절이 필요한 것은 비용·품질 트레이드오프 축인 effort와 캐시 TTL 뿐이다.
 */

/** 채팅 본체 — 에이전트 루프 (도구 사용·다단 추론) */
export const AI_CHAT_MODEL = 'claude-opus-5'
/** 상담 정리 — 단발 요약 작업 */
export const AI_SUMMARIZE_MODEL = 'claude-sonnet-5'

export const AI_SETTINGS_KEY = 'ai_assistant_settings'

/** SDK 0.88 output_config.effort 지원 값. opus-5는 xhigh도 있으나 SDK 타입에 없어 미노출 */
export const AI_EFFORTS = ['low', 'medium', 'high', 'max'] as const
export type AiEffort = (typeof AI_EFFORTS)[number]

export const AI_CACHE_TTLS = ['5m', '1h'] as const
export type AiCacheTtl = (typeof AI_CACHE_TTLS)[number]

export interface AiAssistantSettings {
  /** 사고 깊이·전체 토큰 지출 제어. 기본 medium (미지정 시 API 기본값은 high) */
  effort: AiEffort
  /** 프롬프트 캐시 수명. 5m=쓰기 1.25배, 1h=쓰기 2배 */
  cacheTtl: AiCacheTtl
}

export const DEFAULT_AI_SETTINGS: AiAssistantSettings = {
  effort: 'medium',
  cacheTtl: '5m',
}

export function sanitizeAiSettings(input: unknown): AiAssistantSettings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const effort = AI_EFFORTS.includes(o.effort as AiEffort)
    ? (o.effort as AiEffort)
    : DEFAULT_AI_SETTINGS.effort
  const cacheTtl = AI_CACHE_TTLS.includes(o.cacheTtl as AiCacheTtl)
    ? (o.cacheTtl as AiCacheTtl)
    : DEFAULT_AI_SETTINGS.cacheTtl
  return { effort, cacheTtl }
}

/** 설정 조회 — 조회 실패는 기본값으로 폴백 (설정 때문에 채팅이 죽지 않게) */
export async function getAiSettings(): Promise<AiAssistantSettings> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: AI_SETTINGS_KEY } })
    if (!row?.value) return DEFAULT_AI_SETTINGS
    return sanitizeAiSettings(JSON.parse(row.value))
  } catch (e) {
    console.error('[ai-settings] 설정 조회 실패, 기본값 사용:', e)
    return DEFAULT_AI_SETTINGS
  }
}
