import { cookies } from 'next/headers'
import { isAdminOrAbove, verifyToken } from '@/lib/auth'
import { canAccessUsage } from '@/lib/usage/access'
import AgentsClient from './AgentsClient'

export const dynamic = 'force-dynamic'

/**
 * 사용량 — 에이전트 관리 (projects/usage_agent_enroll_design.md)
 * 수집 병원 등록(병원 목록에서 선택 + 서버 대수), 병원별 서버의 수집 상태, 병원 서버에서 실행하는 설치 명령.
 * 열람: 사용량과 같은 게이트 (ADMIN 이상 또는 usage.view + SEERS 소속). 변경: ADMIN 이상.
 */
export default async function UsageAgentsPage() {
  const token = cookies().get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  if (!user || !(await canAccessUsage(user))) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          사용량은 ADMIN 이상 또는 사용량 조회 권한 보유자 + 씨어스(SEERS) 소속만 열람할 수 있습니다.
        </div>
      </div>
    )
  }
  return <AgentsClient canManage={isAdminOrAbove(user.role)} />
}
