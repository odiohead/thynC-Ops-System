'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import EtcTaskForm from '../EtcTaskForm'

interface EtcTaskFile {
  id: number
  fileCategory: string
  fileName: string
  s3Key: string
}

interface EtcTaskData {
  id: number
  etcTaskCode: string | null
  statusId: number | null
  priority: string
  title: string
  reportedAt: string | null
  resolvedAt: string | null
  note: string | null
  assignees: { user: { id: string; name: string; email: string } }[]
  hospitals: { hospital: { hospitalCode: string; hospitalName: string; hiraHospitalName: string } }[]
  files: EtcTaskFile[]
  visits: { id: number; startDate: string; endDate: string }[]
}

export default function EditEtcTaskPage() {
  const params = useParams()
  const id = params.id as string

  const [data, setData] = useState<EtcTaskData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/etc-tasks/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.etcTask) {
          setData(d.etcTask)
        } else {
          setError('기타업무를 찾을 수 없습니다.')
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
    statusId: data.statusId != null ? String(data.statusId) : '',
    priority: data.priority,
    title: data.title,
    reportedAt: data.reportedAt ? data.reportedAt.slice(0, 10) : '',
    resolvedAt: data.resolvedAt ? data.resolvedAt.slice(0, 10) : '',
    note: data.note ?? '',
    assignees: data.assignees ?? [],
    hospitals: data.hospitals ?? [],
    files: data.files ?? [],
    visits: (data.visits ?? []).map((v) => ({
      startDate: v.startDate.slice(0, 10),
      endDate: v.endDate.slice(0, 10),
    })),
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">기타업무 상세 / 수정</h1>
          <p className="mt-1 font-mono text-sm text-gray-400">{data.etcTaskCode ?? `ETC-${String(data.id).padStart(4, '0')}`}</p>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <EtcTaskForm mode="edit" initialData={initialData} />
        </div>
      </div>
    </div>
  )
}
