'use client'

import WorkflowStatusManager from '../_components/WorkflowStatusManager'

export default function EtcTaskStatusSettingsPage() {
  return (
    <WorkflowStatusManager
      apiPath="/api/settings/etc-task-status"
      title="기타업무 상태 관리"
      description="기타업무 진행 상태와 표시 색상, 티켓 상태 매핑을 관리합니다."
      entityLabel="기타업무 상태"
    />
  )
}
