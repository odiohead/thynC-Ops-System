'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface Hospital {
  id: number
  hospitalCode: string
  name: string
  type: string
  status: string
  sidoCode: string | null
  sidoName: string | null
  sigunguCode: string | null
  sigunguName: string | null
  eupmyeondong: string | null
  postalCode: string | null
  address: string | null
  coordinateX: string | null
  coordinateY: string | null
}

interface StatusCode {
  id: number
  name: string
}

export default function HospitalEditPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [hospital, setHospital] = useState<Hospital | null>(null)
  const [statusCodes, setStatusCodes] = useState<StatusCode[]>([])
  const [form, setForm] = useState<Omit<Hospital, 'id' | 'hospitalCode'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/hospitals/${id}`)
      .then((r) => r.json())
      .then(({ hospital, statusCodes }) => {
        setHospital(hospital)
        setStatusCodes(statusCodes)
        setForm({
          name: hospital.name,
          type: hospital.type,
          status: hospital.status,
          sidoCode: hospital.sidoCode ?? '',
          sidoName: hospital.sidoName ?? '',
          sigunguCode: hospital.sigunguCode ?? '',
          sigunguName: hospital.sigunguName ?? '',
          eupmyeondong: hospital.eupmyeondong ?? '',
          postalCode: hospital.postalCode ?? '',
          address: hospital.address ?? '',
          coordinateX: hospital.coordinateX ?? '',
          coordinateY: hospital.coordinateY ?? '',
        })
        setLoading(false)
      })
      .catch(() => {
        setError('데이터를 불러오는 데 실패했습니다.')
        setLoading(false)
      })
  }, [id])

  function set(field: string, value: string) {
    setForm((prev) => prev ? { ...prev, [field]: value } : prev)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/hospitals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        router.refresh()
        router.push(`/hospitals/${id}`)
        router.refresh()
      } else {
        const json = await res.json()
        setError(json.error ?? '저장에 실패했습니다.')
      }
    } catch {
      setError('저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-400">불러오는 중...</p>
      </div>
    )
  }

  if (error && !form) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center gap-4">
          <Link
            href={`/hospitals/${id}`}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
          >
            ← 상세로
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">병원 수정</h1>
            <p className="mt-0.5 font-mono text-sm text-gray-400">{hospital?.hospitalCode}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* 기본 정보 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">기본 정보</h2>
            </div>
            <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">병원명 *</label>
                <input
                  type="text"
                  required
                  value={form?.name ?? ''}
                  onChange={(e) => set('name', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">종별 *</label>
                <input
                  type="text"
                  required
                  value={form?.type ?? ''}
                  onChange={(e) => set('type', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">상태 *</label>
                <select
                  required
                  value={form?.status ?? ''}
                  onChange={(e) => set('status', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {statusCodes.length === 0 ? (
                    <option value={form?.status}>{form?.status}</option>
                  ) : (
                    statusCodes.map((sc) => (
                      <option key={sc.id} value={sc.name}>{sc.name}</option>
                    ))
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* 위치 정보 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">위치 정보</h2>
            </div>
            <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">시도코드</label>
                <input
                  type="text"
                  value={form?.sidoCode ?? ''}
                  onChange={(e) => set('sidoCode', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">시도명</label>
                <input
                  type="text"
                  value={form?.sidoName ?? ''}
                  onChange={(e) => set('sidoName', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">시군구코드</label>
                <input
                  type="text"
                  value={form?.sigunguCode ?? ''}
                  onChange={(e) => set('sigunguCode', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">시군구명</label>
                <input
                  type="text"
                  value={form?.sigunguName ?? ''}
                  onChange={(e) => set('sigunguName', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">읍면동</label>
                <input
                  type="text"
                  value={form?.eupmyeondong ?? ''}
                  onChange={(e) => set('eupmyeondong', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">우편번호</label>
                <input
                  type="text"
                  value={form?.postalCode ?? ''}
                  onChange={(e) => set('postalCode', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">주소</label>
                <input
                  type="text"
                  value={form?.address ?? ''}
                  onChange={(e) => set('address', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* 좌표 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">좌표</h2>
            </div>
            <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">X 좌표</label>
                <input
                  type="text"
                  value={form?.coordinateX ?? ''}
                  onChange={(e) => set('coordinateX', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">Y 좌표</label>
                <input
                  type="text"
                  value={form?.coordinateY ?? ''}
                  onChange={(e) => set('coordinateY', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* 버튼 */}
          <div className="flex justify-end gap-3 pb-4">
            <Link
              href={`/hospitals/${id}`}
              className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              취소
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}
