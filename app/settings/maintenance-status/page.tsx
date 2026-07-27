'use client'

import WorkflowStatusManager from '../_components/WorkflowStatusManager'

export default function MaintenanceStatusSettingsPage() {
  return (
    <WorkflowStatusManager
      apiPath="/api/settings/maintenance-status"
      title="유지보수 상태 관리"
      description="유지보수 진행 상태와 표시 색상, 티켓 상태 매핑을 관리합니다."
      entityLabel="유지보수 상태"
    />
  )
}
