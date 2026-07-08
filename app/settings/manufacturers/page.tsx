'use client'

import StatusCodeManager from '../_components/StatusCodeManager'

export default function ManufacturersSettingsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">제조사 관리</h1>
          <p className="mt-1 text-sm text-gray-500">자재 품목의 제조사 목록을 관리합니다. 품목 등록·수정 시 선택합니다.</p>
        </div>

        <StatusCodeManager
          endpoint="/api/settings/manufacturers"
          title="제조사"
          addPlaceholder="제조사명 (예: 삼성전자)"
          useColor={false}
        />
      </div>
    </div>
  )
}
