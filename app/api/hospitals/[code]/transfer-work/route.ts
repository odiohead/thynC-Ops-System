import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { auditActorFromJWT } from '@/lib/audit'
import { transferAllWorkItems } from '@/lib/workItemReassign'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/**
 * 병원의 모든 업무(프로젝트/답사/설치계획/유지보수/상담)를 다른 병원으로 일괄 이전.
 * 병원을 통째로 잘못 만든 경우 정리용. 권한: SUPER_ADMIN.
 * body: { toHospitalCode, updateProjectNames? }
 */
export async function POST(request: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isSuperAdmin(authUser.role)) {
    return NextResponse.json({ error: '일괄 이전은 최고 관리자만 가능합니다.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { toHospitalCode, updateProjectNames } = body as {
    toHospitalCode?: string
    updateProjectNames?: boolean
  }
  if (!toHospitalCode) {
    return NextResponse.json({ error: 'toHospitalCode가 필요합니다.' }, { status: 400 })
  }

  const result = await transferAllWorkItems({
    fromHospitalCode: params.code,
    toHospitalCode,
    updateProjectNames: !!updateProjectNames,
    req: request,
    actor: auditActorFromJWT(authUser),
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, moved: result.moved })
}
