'use client'

import StatusCodeManager from '../_components/StatusCodeManager'

/**
 * 디바이스 원장 기기 용도 관리 (ADMIN 이상) — StatusCode DEVICE_USAGE_TYPE (2026-09-01 결정)
 * 용도는 웨어러블 유닛의 속성(위치가 아님): 판매용(SALE) / 평가용(EVAL), 미지정 = NULL. 평가용은 계약 대조에서 제외된다.
 * 시스템 의미(value)가 있는 행은 삭제 불가(이름·순서만 수정). 유닛이 참조 중인 용도도 삭제 불가.
 */
export default function DeviceUsageTypeSettingsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <StatusCodeManager
        endpoint="/api/settings/device-usage-type"
        title="기기 용도 관리"
        description="기기 현황에서 기기(시리얼)에 붙는 용도입니다 — 판매용(SALE) / 평가용(EVAL), 지정하지 않으면 미지정. 평가용 기기는 계약 수량 대조(배치 중 − 계약)에서 제외됩니다. value가 있는 행은 시스템 의미가 연결된 용도라 이름·순서만 수정할 수 있고, 기기가 사용 중인 용도도 삭제할 수 없습니다. '대웅제약재고'는 판매용 창고이지 별도 용도가 아닙니다."
        addPlaceholder="예: 전시용"
        useColor={false}
      />
    </div>
  )
}
