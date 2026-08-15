'use client'

import WorkflowStatusManager from '../_components/WorkflowStatusManager'

// VOC 워크플로 상태 관리 (cs_ticket_workflow_design.md §5)
export default function VocStatusSettingsPage() {
  return (
    <WorkflowStatusManager
      apiPath="/api/settings/voc-status"
      title="VOC 상태 관리"
      description="VOC 접수 진행 상태와 표시 색상, 티켓 상태 매핑을 관리합니다."
      entityLabel="VOC 상태"
    />
  )
}
