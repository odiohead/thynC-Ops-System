'use client'

import StatusCodeManager from '../_components/StatusCodeManager'

/**
 * 디바이스 원장 회수 사유 관리 (ADMIN 이상) — StatusCode DEVICE_RECOVERY_REASON (D5)
 * 시스템 의미(value: DEFECT·LOST·RETURN·DISPOSE·TRANSFER)가 있는 행은 로직이 결합돼 있어 삭제 불가(이름·순서만 수정).
 * 이벤트·개체가 참조 중인 사유도 삭제 불가.
 */
export default function DeviceRecoveryReasonSettingsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <StatusCodeManager
        endpoint="/api/settings/device-recovery-reason"
        title="기기 회수 사유 관리"
        description="디바이스 원장에서 기기를 회수할 때 선택하는 사유입니다. value가 있는 행은 삭제 불가 — 시스템 의미(불량·분실·반납·현장 폐기·타 병원 이관)가 연결된 사유라 이름·순서만 수정할 수 있고, 회수 이력에서 사용 중인 사유도 삭제할 수 없습니다."
        addPlaceholder="예: 업그레이드 교체"
        useColor={false}
      />
    </div>
  )
}
