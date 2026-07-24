'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { TicketStatus } from '@prisma/client'
import EtcTaskForm from '../EtcTaskForm'
import TicketLogPanel from '@/app/tickets/components/TicketLogPanel'
import TicketStatusBadge from '@/app/tickets/components/TicketStatusBadge'

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
  ticketId: number | null
}

interface LinkedTicket {
  id: number
  ticketCode: string
  status: TicketStatus
}

export default function EditEtcTaskPage() {
  const params = useParams()
  const id = params.id as string

  const [data, setData] = useState<EtcTaskData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [linkedTicket, setLinkedTicket] = useState<LinkedTicket | null>(null)

  useEffect(() => {
    fetch(`/api/etc-tasks/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.etcTask) {
          setData(d.etcTask)
          // 연결된 티켓 코드·상태 조회 (숫자 id 허용)
          if (d.etcTask.ticketId) {
            fetch(`/api/tickets/${d.etcTask.ticketId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((t) => { if (t?.ticket) setLinkedTicket(t.ticket) })
          }
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

        {/* 연결된 티켓 배너 */}
        {linkedTicket && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
            <span className="font-medium">티켓:</span>
            <span className="font-mono text-xs">{linkedTicket.ticketCode}</span>
            <TicketStatusBadge status={linkedTicket.status} />
            <Link
              href={`/tickets/${linkedTicket.ticketCode}`}
              className="ml-auto shrink-0 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-700 dark:bg-transparent dark:text-blue-300 dark:hover:bg-blue-900/40"
            >
              보기 →
            </Link>
          </div>
        )}

        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <EtcTaskForm mode="edit" initialData={initialData} />
        </div>

        {/* 티켓 타임라인 — 폼(note 필드)과 별개, 진행 기록은 여기에 */}
        {data.ticketId && (
          <div className="mt-4 rounded-xl bg-white p-6 shadow-sm border border-gray-200">
            <TicketLogPanel ticketId={data.ticketId} />
          </div>
        )}
      </div>
    </div>
  )
}
