import { prisma } from '@/lib/prisma'
import type { JWTPayload } from '@/lib/auth'

/**
 * AI 어시스턴트 접근 권한 (서버 강제)
 *
 * nav 메뉴의 `allowed_org_codes`는 UI 게이트일 뿐 API를 막지 못한다.
 * 어시스턴트는 도구 12종으로 전사 병원·계약·프로젝트·유지보수를 열람하므로
 * 라우트 진입 시점에 서버에서 소속을 직접 검사한다.
 *
 * 소속·활성 여부는 JWT(발급 후 최대 7일 경과 가능)가 아니라 **DB 실시간 조회**로 판정한다.
 * 계정 정책 변경이 토큰 만료를 기다리지 않고 즉시 반영되어야 하기 때문
 * (차량예약 `vehicleReservationBlocked` 선례와 동일한 이유).
 */

/** 어시스턴트 사용 가능 소속 — 자사 전용 (2026-07-25 확정) */
export const AI_ALLOWED_ORG_CODES: readonly string[] = ['SEERS']

export type AiAccessDenial = { status: number; error: string }

/** 통과면 null, 차단이면 응답에 쓸 상태코드·메시지 */
export async function checkAiAccess(user: JWTPayload): Promise<AiAccessDenial | null> {
  if (user.role === 'VIEWER') {
    return { status: 403, error: 'VIEWER는 어시스턴트를 사용할 수 없습니다.' }
  }

  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { isActive: true, organization: { select: { code: true } } },
  })
  if (!row) return { status: 403, error: '계정을 찾을 수 없습니다.' }
  if (!row.isActive) return { status: 403, error: '비활성 계정입니다.' }

  const code = row.organization?.code
  if (!code || !AI_ALLOWED_ORG_CODES.includes(code)) {
    return { status: 403, error: '소속 정책에 따라 AI 어시스턴트를 사용할 수 없습니다.' }
  }
  return null
}
