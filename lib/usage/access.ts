/**
 * 사용량 화면 접근 게이트 — (USER 이상 또는 usage.view 권한) + 활성 계정 + SEERS 소속
 * 2026-11-24 ADMIN 이상 → USER 이상으로 넓힘(사용자 요청). VIEWER는 usage.view 권한이 있을 때만.
 * 병원별 사용량은 사내 정보라 SEERS 소속 요건은 그대로다(권한으로 대체되지 않는다).
 * nav 허용 역할은 메뉴 노출만 제어하며, 실제 접근은 이 게이트가 단일 소스다.
 */
import { prisma } from '@/lib/prisma'
import { isUserOrAbove, type JWTPayload } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'

export const USAGE_ALLOWED_ORG_CODES = ['SEERS']

export type UsageAccessDenial = { status: number; error: string }

export async function checkUsageAccess(user: JWTPayload): Promise<UsageAccessDenial | null> {
  if (!isUserOrAbove(user.role) && !(await hasPermission(user, 'usage.view'))) {
    return { status: 403, error: '사용량은 USER 이상 또는 사용량 조회 권한 보유자만 열람할 수 있습니다.' }
  }
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { isActive: true, organization: { select: { code: true } } },
  })
  if (!row) return { status: 403, error: '계정을 찾을 수 없습니다.' }
  if (!row.isActive) return { status: 403, error: '비활성 계정입니다.' }
  const code = row.organization?.code
  if (!code || !USAGE_ALLOWED_ORG_CODES.includes(code)) {
    return { status: 403, error: '소속 정책에 따라 사용량을 열람할 수 없습니다.' }
  }
  return null
}

export async function canAccessUsage(user: JWTPayload | null): Promise<boolean> {
  if (!user) return false
  return (await checkUsageAccess(user)) === null
}
