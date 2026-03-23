'use client'

import SiteVisitForm from '../SiteVisitForm'

export default function NewSiteVisitPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">답사 등록</h1>
        </div>
        <SiteVisitForm mode="create" />
      </div>
    </div>
  )
}
