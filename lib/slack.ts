/**
 * Slack Web API 저수준 어댑터 (function_notification.md Phase 1)
 *
 * - 의존성 0: 전역 fetch 직접 사용 (SDK 미설치)
 * - best-effort: 모든 함수는 실패해도 throw하지 않고 결과/ null 반환 (googleCalendar.ts 패턴)
 * - 토큰(SLACK_BOT_TOKEN) 미설정 시 자동 스킵
 * - 정책(설정 게이트·dedup·로그)은 상위 lib/notify.ts 담당. 이 파일은 전송·모드 라우팅만.
 */

const SLACK_API = 'https://slack.com/api'

export type SlackMode = 'off' | 'test' | 'live'

export interface SlackResult {
  ok: boolean
  error?: string
  ts?: string
  channel?: string
  skipped?: boolean // 토큰 미설정 등으로 전송 자체를 안 함
}

export interface SlackMessage {
  text: string // 알림·폴백 텍스트 (blocks 사용 시에도 필수)
  blocks?: unknown[] // Block Kit
}

/**
 * 발송 모드. `SLACK_NOTIFY_MODE` = off | test | live.
 * 이중 안전장치: production이 아니면 live를 test로 강등해 실 담당자 오발송 차단.
 */
export function getSlackMode(): SlackMode {
  const raw = (process.env.SLACK_NOTIFY_MODE || 'off').toLowerCase()
  let mode: SlackMode = raw === 'live' ? 'live' : raw === 'test' ? 'test' : 'off'

  if (mode === 'live' && process.env.NODE_ENV !== 'production') {
    console.warn('[slack] 비-production 환경에서 live 모드 감지 → test로 강등')
    mode = 'test'
  }
  return mode
}

/**
 * 의도한 채널을 실제 발송 채널로 변환.
 * - off  → null (미발송)
 * - test → SLACK_CHANNEL_TEST (모든 메시지를 테스트 채널로)
 * - live → 의도한 채널 그대로
 */
export function resolveTargetChannel(intended: string): string | null {
  const mode = getSlackMode()
  if (mode === 'off') return null
  if (mode === 'test') return process.env.SLACK_CHANNEL_TEST || null
  return intended || null
}

/** 채널(또는 DM용 user ID)에 메시지 발송 */
export async function slackPostMessage(channel: string, message: SlackMessage): Promise<SlackResult> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    console.warn('[slack] SLACK_BOT_TOKEN 미설정 — 발송 스킵')
    return { ok: false, skipped: true, error: 'no_token' }
  }
  if (!channel) {
    return { ok: false, skipped: true, error: 'no_channel' }
  }

  try {
    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel,
        text: message.text,
        ...(message.blocks ? { blocks: message.blocks } : {}),
      }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string; ts?: string; channel?: string }
    if (!data.ok) {
      console.error(`[slack] chat.postMessage 실패: ${data.error}`)
    }
    return { ok: data.ok, error: data.error, ts: data.ts, channel: data.channel }
  } catch (err) {
    console.error('[slack] chat.postMessage 예외:', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 이메일로 Slack user ID 조회 (담당자 DM 매핑용, Phase 4).
 * 실패(이메일 불일치·미가입 등) 시 null — 에러 아님.
 */
export async function slackLookupUserByEmail(email: string): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token || !email) return null

  try {
    const res = await fetch(`${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json()) as { ok: boolean; user?: { id: string }; error?: string }
    if (!data.ok) {
      console.warn(`[slack] users.lookupByEmail 실패(${email}): ${data.error}`)
      return null
    }
    return data.user?.id ?? null
  } catch (err) {
    console.error('[slack] users.lookupByEmail 예외:', err)
    return null
  }
}
