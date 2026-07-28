'use client'

import StatusCodeManager from '../_components/StatusCodeManager'

/**
 * 영업 코드 관리 (ADMIN 이상) — 영업/CRM 딜·영업일지에서 쓰는 StatusCode 카테고리 7종.
 * 딜·일지에서 사용 중인 값은 삭제 불가(409).
 */
export default function SalesCodesSettingsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">영업 코드 관리</h1>
        <p className="mt-1 text-sm text-gray-500">
          병원 영업 정보(딜·영업일지)에서 선택하는 분류 값을 관리합니다. 사용 중인 값은 삭제할 수 없습니다.
        </p>
      </div>

      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_MODEL_HOSPITAL" title="병원 판매모델" description="병원 관점 판매모델 — 예: 구축형, 구독형, 분납형, 사용량비례형" addPlaceholder="예: 렌탈형" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_MODEL_SEERS" title="씨어스 판매방식" description="씨어스 관점 판매방식 — 예: 구축형, 구독형" addPlaceholder="예: 위탁운영형" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_PRICE_TYPE" title="판매가 유형" description="딜 판매가 산정 기준 — 예: 기존판매가, 권장판매가, 최소판매가" addPlaceholder="예: 프로모션가" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_SETTLEMENT" title="정산 상태" description="딜 정산 진행 상태 — 예: 미정산, 진행중, 완료" addPlaceholder="예: 부분정산" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_TAX_INVOICE" title="세금계산서 발행" description="예: 미발행, 완료, 씨어스 계약" addPlaceholder="예: 분할발행" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_REVENUE_RECOG" title="매출 인식" description="예: 수금시작, 입금완료, 수금완료" addPlaceholder="예: 부분수금" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_ACTIVITY_TYPE" title="영업 활동 유형" description="영업일지 활동 분류 — 예: 방문, 전화, 메일, 데모/시연" addPlaceholder="예: 세미나" useColor={false} />
    </div>
  )
}
