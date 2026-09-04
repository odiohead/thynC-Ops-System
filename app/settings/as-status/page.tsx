'use client'

import WorkflowStatusManager from '../_components/WorkflowStatusManager'

// AS업무(AS접수) 워크플로 상태 관리 (as_work_design.md §4.3 — 단계형 8종)
export default function AsStatusSettingsPage() {
  return (
    <WorkflowStatusManager
      apiPath="/api/settings/as-status"
      title="AS업무 상태 관리"
      description="AS접수 진행 단계(접수·수거중·입고·처리중·발송)와 표시 색상, 티켓 상태 매핑을 관리합니다. (완료·취소는 티켓 종결(Closed) 매핑)"
      entityLabel="AS업무 상태"
    />
  )
}
