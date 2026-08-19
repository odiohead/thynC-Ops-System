import { prisma } from '@/lib/prisma'
import { isUserOrAbove, type JWTPayload } from '@/lib/auth'

/**
 * 주간업무 관리 접근 권한 (서버 강제) — projects/weekly_ops_design.md §8
 *
 * 조회: 로그인 + SEERS 소속 전원 (사업본부 내부 리뷰 자료 — 고객사 소속 계정 차단)
 * 쓰기: 위 + USER 등급 이상 (VIEWER 읽기 전용 원칙)
 * 소속·활성 여부는 JWT가 아니라 DB 실시간 조회로 판정 (checkSalesAccess 선례 — JWT는 최대 7일 stale).
 * nav 미등록·URL 직접 진입 페이지이므로 이 게이트가 접근 제어의 단일 소스다.
 */

export const WEEKLY_ALLOWED_ORG_CODES: readonly string[] = ['SEERS']

export type WeeklyAccessDenial = { status: number; error: string }

/** 통과면 null, 차단이면 응답에 쓸 상태코드·메시지 */
export async function checkWeeklyAccess(user: JWTPayload, opts?: { write?: boolean }): Promise<WeeklyAccessDenial | null> {
  if (opts?.write && !isUserOrAbove(user.role)) {
    return { status: 403, error: '주간업무 편집은 USER 등급 이상만 가능합니다 (VIEWER는 조회 전용).' }
  }
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { isActive: true, organization: { select: { code: true } } },
  })
  if (!row) return { status: 403, error: '계정을 찾을 수 없습니다.' }
  if (!row.isActive) return { status: 403, error: '비활성 계정입니다.' }
  const code = row.organization?.code
  if (!code || !WEEKLY_ALLOWED_ORG_CODES.includes(code)) {
    return { status: 403, error: '소속 정책에 따라 주간업무 관리에 접근할 수 없습니다.' }
  }
  return null
}
