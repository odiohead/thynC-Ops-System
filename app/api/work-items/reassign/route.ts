import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { auditActorFromJWT } from '@/lib/audit'
import {
  reassignWorkItemHospital,
  type WorkItemType,
} from '@/lib/workItemReassign'

export const dynamic = 'force-dynamic'

const VALID_TYPES: WorkItemType[] = ['PROJECT', 'SITE_VISIT', 'INSTALL_PLAN', 'MAINTENANCE']

/**
 * 업무(프로젝트/답사/설치계획/유지보수)를 다른 병원으로 재지정(매핑 정정).
 * 권한: ADMIN 이상.
 * body: { type, code, newHospitalCode, updateProjectName? }
 */
export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '병원 재지정 권한이 없습니다.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { type, code, newHospitalCode, updateProjectName } = body as {
    type?: string
    code?: string
    newHospitalCode?: string
    updateProjectName?: boolean
  }

  if (!type || !VALID_TYPES.includes(type as WorkItemType)) {
    return NextResponse.json({ error: '업무 유형이 올바르지 않습니다.' }, { status: 400 })
  }
  if (!code || !newHospitalCode) {
    return NextResponse.json({ error: 'code와 newHospitalCode가 필요합니다.' }, { status: 400 })
  }

  const result = await reassignWorkItemHospital({
    type: type as WorkItemType,
    code,
    newHospitalCode,
    updateProjectName: !!updateProjectName,
    req: request,
    actor: auditActorFromJWT(authUser),
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({
    ok: true,
    oldHospitalCode: result.oldHospitalCode,
    newHospitalCode: result.newHospitalCode,
    newProjectName: result.newProjectName ?? null,
  })
}
