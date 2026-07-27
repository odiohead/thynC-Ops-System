'use client'

import WorkflowStatusManager from '../_components/WorkflowStatusManager'

export default function SiteVisitStatusSettingsPage() {
  return (
    <WorkflowStatusManager
      apiPath="/api/settings/site-visit-status"
      title="답사 상태코드 관리"
      description="답사 진행 상태와 표시 색상, 티켓 상태 매핑을 관리합니다."
      entityLabel="답사 상태"
    />
  )
}
