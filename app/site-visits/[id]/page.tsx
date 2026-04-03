'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import SiteVisitForm from '../SiteVisitForm'

interface SiteVisitFile {
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

interface SiteVisitData {
  id: number
  hospitalCode: string
  hospital: Hospital
  daewoongUserId: string | null
  assigneeId: string | null
  requestDate: string | null
  visitDate: string | null
  replyDate: string | null
  statusId: number | null
  installPlanS3Key: string | null
  floorPlanS3Key: string | null
  notes: string | null
  files: SiteVisitFile[]
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
    daewoongUserId: data.daewoongUserId ?? '',
    assigneeId: data.assigneeId ?? '',
    requestDate: data.requestDate ? data.requestDate.slice(0, 10) : '',
    visitDate: data.visitDate ? data.visitDate.slice(0, 10) : '',
    replyDate: data.replyDate ? data.replyDate.slice(0, 10) : '',
    statusId: data.statusId != null ? String(data.statusId) : '',
    installPlanS3Key: data.installPlanS3Key ?? '',
    floorPlanS3Key: data.floorPlanS3Key ?? '',
    notes: data.notes ?? '',
    files: data.files ?? [],
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">답사 상세 / 수정</h1>
          <p className="mt-1 font-mono text-sm text-gray-400">SV-{String(data.id).padStart(5, '0')}</p>
        </div>
        {data.hospital && <HospitalCard hospital={data.hospital} />}
        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <SiteVisitForm mode="edit" initialData={initialData} />
        </div>
      </div>
    </div>
  )
}
