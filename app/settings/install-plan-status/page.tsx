'use client'

import WorkflowStatusManager from '../_components/WorkflowStatusManager'

export default function InstallPlanStatusSettingsPage() {
  return (
    <WorkflowStatusManager
      apiPath="/api/settings/install-plan-status"
      title="설치계획 상태 관리"
      description="설치계획(가안) 진행 상태와 표시 색상, 티켓 상태 매핑을 관리합니다."
      entityLabel="설치계획 상태"
    />
  )
}
