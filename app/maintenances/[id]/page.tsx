'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import MaintenanceForm from '../MaintenanceForm'
import ReassignHospitalButton from '@/app/components/ReassignHospitalButton'

interface MaintenanceFile {
  id: number
  fileCategory: string
  fileName: string
  s3Key: string
}

interface Hospital {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName: string
  sidoName: string | null
  sigunguName: string | null
  address: string | null
  status: string
}

interface MaintenanceData {
  id: number
  maintenanceCode: string | null
  hospitalCode: string
  hospital: Hospital
  typeId: number | null
  statusId: number | null
  priority: string
  title: string
  reporterName: string | null
  isRemote: boolean
  reportedAt: string | null
  resolvedAt: string | null
  symptoms: string | null
  cause: string | null
  resolution: string | null
  notes: string | null
  assignees: { user: { id: string; name: string; email: string } }[]
  files: MaintenanceFile[]
  visits: { id: number; startDate: string; endDate: string }[]
}

const labelClass = 'text-xs font-medium uppercase tracking-wider text-gray-400'

function HospitalCard({ hospital }: { hospital: Hospital }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm mb-4">
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">병원 기본정보</h2>
        <Link href={`/hospitals/${hospital.hospitalCode}`} className="text-xs text-blue-600 hover:underline">
          병원 상세 →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-3">
        <div>
          <p className={labelClass}>병원명</p>
          <p className="mt-1 text-sm text-gray-900">{hospital.hospitalName}</p>
          {hospital.hiraHospitalName && hospital.hiraHospitalName !== hospital.hospitalName && (
            <p className="mt-0.5 text-xs text-gray-400">{hospital.hiraHospitalName}</p>
          )}
        </div>
        <div>
          <p className={labelClass}>지역</p>
          <p className="mt-1 text-sm text-gray-900">
            {[hospital.sidoName, hospital.sigunguName].filter(Boolean).join(' ') || '-'}
          </p>
        </div>
        <div>
          <p className={labelClass}>상태</p>
          <p className="mt-1 text-sm text-gray-900">{hospital.status || '-'}</p>
        </div>
        <div className="sm:col-span-3">
          <p className={labelClass}>주소</p>
          <p className="mt-1 text-sm text-gray-900">{hospital.address || '-'}</p>
        </div>
      </div>
    </div>
  )
}

export default function EditMaintenancePage() {
  const params = useParams()
  const id = params.id as string

  const [data, setData] = useState<MaintenanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/maintenances/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.maintenance) {
          setData(d.maintenance)
        } else {
          setError('유지보수를 찾을 수 없습니다.')
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
    typeId: data.typeId != null ? String(data.typeId) : '',
    statusId: data.statusId != null ? String(data.statusId) : '',
    priority: data.priority,
    title: data.title,
    reporterName: data.reporterName ?? '',
    isRemote: data.isRemote,
    reportedAt: data.reportedAt ? data.reportedAt.slice(0, 10) : '',
    resolvedAt: data.resolvedAt ? data.resolvedAt.slice(0, 10) : '',
    symptoms: data.symptoms ?? '',
    cause: data.cause ?? '',
    resolution: data.resolution ?? '',
    notes: data.notes ?? '',
    assignees: data.assignees ?? [],
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
          <h1 className="text-2xl font-bold text-gray-900">유지보수 상세 / 수정</h1>
          <p className="mt-1 font-mono text-sm text-gray-400">{data.maintenanceCode ?? `MNT-${String(data.id).padStart(4, '0')}`}</p>
        </div>
        {data.hospital && <HospitalCard hospital={data.hospital} />}
        {data.maintenanceCode && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-gray-400">병원이 잘못 지정되었나요?</span>
            <ReassignHospitalButton
              type="MAINTENANCE"
              code={data.maintenanceCode}
              currentHospitalCode={data.hospitalCode}
              currentHospitalName={data.hospital?.hospitalName}
            />
          </div>
        )}
        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <MaintenanceForm mode="edit" initialData={initialData} />
        </div>
      </div>
    </div>
  )
}
