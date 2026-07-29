'use client'

import StatusCodeManager from '../_components/StatusCodeManager'

/**
 * 영업 코드 관리 (ADMIN 이상) — 영업/CRM v3 StatusCode 카테고리 3종.
 * 프로필·딜·영업 활동에서 사용 중인 값은 삭제 불가(409).
 */
export default function SalesCodesSettingsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">영업 코드 관리</h1>
        <p className="mt-1 text-sm text-gray-500">
          병원 영업 정보(단계·딜·영업 활동)에서 선택하는 분류 값을 관리합니다. 사용 중인 값은 삭제할 수 없습니다.
        </p>
      </div>

      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_STAGE" title="영업 단계" description="병원 영업 파이프라인 단계 — 예: 리드, 접촉·상담, 제안·견적, 계약 진행, 도입·운영중, 확장 협의, 보류·중단" addPlaceholder="예: 재계약 협의" useColor={true} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_DEAL_STATUS" title="딜(계약 건) 상태" description="계약 이력 개별 건의 상태 — 예: 협의중, 계약완료, 해지·중단" addPlaceholder="예: 검토중" useColor={true} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_MODEL" title="판매모델" description="차수(딜) 단위 판매모델 — 병원/씨어스 관점 공용 마스터. 예: 구축형, 구독형, 분납형, 사용량비례형" addPlaceholder="예: 렌탈형" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_TAX_INVOICE" title="세금계산서 발행" description="차수별 세금계산서 발행 상태 — 예: 미발행, 발행완료, 씨어스 계약" addPlaceholder="예: 분할발행" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_SETTLEMENT" title="정산 상태" description="차수별 정산 진행 상태 — 예: 미정산, 진행중, 완료" addPlaceholder="예: 부분정산" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/SALES_ACTIVITY_TYPE" title="영업 활동 유형" description="영업 활동 기록 분류 — 예: 방문, 전화, 메일, 데모/시연" addPlaceholder="예: 세미나" useColor={false} />
      <StatusCodeManager endpoint="/api/settings/sales-codes/PERSON_GROUP" title="직군 (인적정보)" description="병원 인적정보의 직군 분류 — 예: 의사, 간호, 의공, 전산, 구매, 원무" addPlaceholder="예: 행정" useColor={false} />
    </div>
  )
}
