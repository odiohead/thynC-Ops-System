/**
 * 알림 라우팅 규칙 입력 검증 헬퍼 (2026-11-09 — projects/stock_out_notify_subtype_design.md)
 * 규칙 생성(POST)·수정(PUT) API 공용. route.ts는 HTTP 핸들러 외 export가 불가해 lib로 분리.
 */
import { prisma } from '@/lib/prisma'
import { NOTIFY_EVENT_MAP } from '@/lib/notify-events'
import { PERSONAL_QUEUE_NAME } from '@/lib/ticket-shared'

/** 도메인 세부 유형 조건 정제 — 카탈로그 축(subTypeAxis)에 있는 코드만, 축 없는 이벤트는 빈 배열 (2026-11-09) */
export function cleanSubTypes(eventType: string, v: unknown): string[] {
  const axis = NOTIFY_EVENT_MAP[eventType]?.subTypeAxis
  if (!axis || !Array.isArray(v)) return []
  const allowed = new Set(axis.options.map((o) => o.code))
  return v.filter((x): x is string => typeof x === 'string' && allowed.has(x))
}

/** 멘션 '지정 Assignment Group 멤버' 검증 — 활성 그룹이어야 하고 '개인 업무'는 불가. 반환: 오류 문구 | null (2026-11-09) */
export async function validateMentionQueue(mentionMode: unknown, mentionQueueId: unknown): Promise<{ error: string } | { id: number | null }> {
  if (mentionMode !== 'named_queue') return { id: null }
  const id = typeof mentionQueueId === 'number' && Number.isFinite(mentionQueueId) ? Math.floor(mentionQueueId) : parseInt(String(mentionQueueId ?? ''))
  if (!Number.isFinite(id)) return { error: "멘션 '지정 Assignment Group 멤버'는 태그할 그룹을 선택해야 합니다." }
  const q = await prisma.ticketQueue.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } })
  if (!q || !q.isActive) return { error: '선택한 Assignment Group이 없거나 비활성입니다.' }
  if (q.name === PERSONAL_QUEUE_NAME) return { error: "'개인 업무' 그룹은 멘션 대상으로 지정할 수 없습니다." }
  return { id: q.id }
}
