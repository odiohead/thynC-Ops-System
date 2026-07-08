'use client'

import StatusCodeManager from '../_components/StatusCodeManager'

/**
 * 입출고 유형 관리 (ADMIN 이상) — 입고 유형(STOCK_IN_TYPE)·출고 유형(STOCK_OUT_TYPE).
 * 전표 등록 시 선택하는 유형 목록. 시스템 동작이 연결된 유형(회수·폐기·불량)은 삭제 불가.
 */
export default function StockReasonsSettingsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">입출고 유형 관리</h1>
        <p className="mt-1 text-sm text-gray-500">
          자재 입고/출고 전표에서 선택하는 유형을 관리합니다. 전표에서 사용 중이거나 시스템 동작이 연결된 유형
          (회수(반품)·폐기·불량)은 삭제할 수 없습니다.
        </p>
      </div>

      <StatusCodeManager
        endpoint="/api/settings/stock-in-type"
        title="입고 유형"
        description="예: 구매, 회수(반품), 기타 — 회수(반품)는 출고된 시리얼 개체를 재고로 복귀시킵니다."
        addPlaceholder="예: 증정 입고"
        useColor={false}
      />

      <StatusCodeManager
        endpoint="/api/settings/stock-out-type"
        title="출고 유형"
        description="예: 설치, 판매, 폐기, 불량, 기타 — 폐기·불량은 시리얼 개체를 폐기 상태로 만듭니다."
        addPlaceholder="예: 대여 출고"
        useColor={false}
      />
    </div>
  )
}
