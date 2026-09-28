/**
 * 채널톡 상담 원천 적재 — 클라이언트 안전 상수·라벨 (projects/voc_channeltalk_intake_design.md)
 * 서버 전용 코드(prisma·fetch)는 vocSync.ts / client.ts 에만 둔다.
 */

export const CHANNELTALK_VOC_INTERVAL_KEY = 'channeltalk_voc_interval' // off / 1m / 5m / 10m (기본 off)
export const CHANNELTALK_VOC_BACKFILL_KEY = 'channeltalk_voc_backfill' // JSON BackfillState
export const CHANNELTALK_VOC_MAX_CALLS_KEY = 'channeltalk_voc_max_calls' // 틱당 API 호출 상한 (기본 200)

export const CHANNELTALK_VOC_INTERVALS = ['off', '1m', '5m', '10m'] as const
export type ChanneltalkVocInterval = (typeof CHANNELTALK_VOC_INTERVALS)[number]

export const CHANNELTALK_CHAT_STATES = ['opened', 'snoozed', 'closed'] as const
export type ChanneltalkChatState = (typeof CHANNELTALK_CHAT_STATES)[number]

export const CHANNELTALK_STATE_LABEL: Record<ChanneltalkChatState, string> = {
  opened: '진행중',
  snoozed: '보류',
  closed: '종료',
}

export const CHANNELTALK_PERSON_LABEL: Record<string, string> = {
  user: '고객',
  manager: '담당자',
  bot: '봇',
}

export const CHANNELTALK_HOSPITAL_MATCH_LABEL: Record<string, string> = {
  opscode: 'OpsCode 일치',
  name: '병원명 매칭',
  none: '미매칭',
}

export type ChanneltalkSyncMode = 'incremental' | 'backfill' | 'manual'

/** 백필 진행 상태 (AppSetting JSON) */
export interface BackfillState {
  /** closed 상담 asc 순회 커서 (다음 페이지 since) — null이면 처음부터 */
  since: string | null
  /** closed 순회 완료 여부 — true면 스케줄러는 incremental만 수행 */
  done: boolean
  /** 누적 처리 상담 수 */
  processed: number
  startedAt: string | null
  finishedAt: string | null
}

export const EMPTY_BACKFILL: BackfillState = { since: null, done: false, processed: 0, startedAt: null, finishedAt: null }

/** 채널톡 데스크 상담 딥링크 */
export function channeltalkDeskChatUrl(channelId: string | null | undefined, chatId: string) {
  return channelId ? `https://desk.channel.io/#/channels/${channelId}/user_chats/${chatId}` : `https://desk.channel.io/`
}
