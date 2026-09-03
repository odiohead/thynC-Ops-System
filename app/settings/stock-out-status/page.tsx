'use client'

import WorkflowStatusManager from '../_components/WorkflowStatusManager'

// 출고업무(출고요청) 워크플로 상태 관리 (stock_out_request_design.md §5)
export default function StockOutStatusSettingsPage() {
  return (
    <WorkflowStatusManager
      apiPath="/api/settings/stock-out-status"
      title="출고업무 상태 관리"
      description="출고요청 진행 상태와 표시 색상, 티켓 상태 매핑을 관리합니다. (완료·취소는 티켓 종결(Closed) 매핑)"
      entityLabel="출고업무 상태"
    />
  )
}
