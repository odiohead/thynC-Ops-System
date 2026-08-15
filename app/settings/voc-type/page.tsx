import StatusCodeManager from '@/app/settings/_components/StatusCodeManager'

// VOC 분류 관리 (VOC_TYPE) — cs_ticket_workflow_design.md §5
export default function VocTypeSettingsPage() {
  return (
    <StatusCodeManager
      endpoint="/api/settings/voc-type"
      title="VOC 분류 관리"
      description="VOC 접수의 분류를 관리합니다. 분류는 티켓 자동생성 규칙의 조건 축으로도 사용됩니다."
      addPlaceholder="예: 불만"
    />
  )
}
