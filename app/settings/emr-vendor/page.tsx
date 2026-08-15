import StatusCodeManager from '@/app/settings/_components/StatusCodeManager'

// EMR 업체 관리 (EMR_VENDOR) — 병원 상세 thynC 시스템 현황의 EMR 연동 정보에서 선택 (2026-08-16)
export default function EmrVendorSettingsPage() {
  return (
    <StatusCodeManager
      endpoint="/api/settings/emr-vendor"
      title="EMR 업체 관리"
      description="병원 EMR 연동 정보에서 선택하는 EMR 업체 리스트를 관리합니다. 사용 중인 업체는 삭제할 수 없습니다."
      addPlaceholder="예: 이지케어텍"
      useColor={false}
    />
  )
}
