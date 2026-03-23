'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import SiteVisitForm from '../SiteVisitForm'

interface SiteVisitData {
  id: number
  hospitalCode: string
  daewoongStaffId: string | null
  assigneeId: string | null
  requestDate: string | null
  visitDate: string | null
  replyDate: string | null
  statusId: number | null
  installPlanUrl: string | null
  installPlanFileId: string | null
  floorPlanUrl: string | null
  floorPlanFileId: string | null
  notes: string | null
}

export default function EditSiteVisitPage() {
  const params = useParams()
  const id = params.id as string

  const [data, setData] = useState<SiteVisitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/site-visits/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.siteVisit) {
          setData(d.siteVisit)
        } else {
          setError('답사를 찾을 수 없습니다.')
        }
        setLoading(false)
      })
      .catch(() => {
        setError('데이터를 불러오는 중 오류가 발생했습니다.')
        setLoading(false)
      })
  }, [id])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">불러오는 중...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-red-500">{error ?? '오류가 발생했습니다.'}</p>
      </div>
    )
  }

  const initialData = {
    id: data.id,
    hospitalCode: data.hospitalCode,
    daewoongStaffId: data.daewoongStaffId ?? '',
    assigneeId: data.assigneeId ?? '',
    requestDate: data.requestDate ? data.requestDate.slice(0, 10) : '',
    visitDate: data.visitDate ? data.visitDate.slice(0, 10) : '',
    replyDate: data.replyDate ? data.replyDate.slice(0, 10) : '',
    statusId: data.statusId != null ? String(data.statusId) : '',
    installPlanUrl: data.installPlanUrl ?? '',
    installPlanFileId: data.installPlanFileId ?? '',
    floorPlanUrl: data.floorPlanUrl ?? '',
    floorPlanFileId: data.floorPlanFileId ?? '',
    notes: data.notes ?? '',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">답사 상세 / 수정</h1>
        </div>
        <SiteVisitForm mode="edit" initialData={initialData} />
      </div>
    </div>
  )
}
