'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import HiraSearchModal, { HiraHospital } from '../../_components/HiraSearchModal'

const INTRO_TYPE_OPTIONS = ['구축형', '구독형', '사용량비례형']

interface Hospital {
  id: number
  hospitalCode: string
  hiraId: string | null
  hiraHospitalName: string
  hospitalName: string
  type: string
  status: string
  address: string | null
  introType: string | null
  introBeds: number | null
  contractDate: string | null
}

interface StatusCode {
  id: number
  name: string
}

// pendingHira: undefined = 변경 없음, null = 연결 해제, HiraHospital = 새 연결
type PendingHira = HiraHospital | null | undefined

export default function HospitalEditPage() {
  const router = useRouter()
  const { code } = useParams<{ code: string }>()

  const [hospital, setHospital] = useState<Hospital | null>(null)
  const [statusCodes, setStatusCodes] = useState<StatusCode[]>([])
  const [hospitalName, setHospitalName] = useState('')
  const [status, setStatus] = useState('')
  const [introTypes, setIntroTypes] = useState<string[]>([])
  const [introBeds, setIntroBeds] = useState('')
  const [contractDate, setContractDate] = useState('')

  const [pendingHira, setPendingHira] = useState<PendingHira>(undefined)
  const [showModal, setShowModal] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/hospitals/${code}`)
      .then((r) => r.json())
      .then(({ hospital, statusCodes }) => {
        setHospital(hospital)
        setStatusCodes(statusCodes)
        setHospitalName(hospital.hospitalName)
        setStatus(hospital.status)
        setIntroTypes(hospital.introType ? hospital.introType.split(',') : [])
        setIntroBeds(hospital.introBeds != null ? String(hospital.introBeds) : '')
        setContractDate(hospital.contractDate ? hospital.contractDate.slice(0, 10) : '')
        setLoading(false)
      })
      .catch(() => {
        setError('데이터를 불러오는 데 실패했습니다.')
        setLoading(false)
      })
  }, [code])

  function toggleIntroType(t: string) {
    setIntroTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }

  // 현재 표시할 HIRA 정보
  const displayHira = pendingHira !== undefined
    ? pendingHira  // 변경 예정값 표시
    : {            // 원본 데이터 표시
        name: hospital?.hiraHospitalName ?? '',
        typeName: hospital?.type ?? '',
        address: hospital?.address ?? '',
      }

  const hasHiraLink = pendingHira !== undefined
    ? pendingHira !== null
    : !!hospital?.hiraId

  const hiraChanged = pendingHira !== undefined

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        hospitalName,
        status,
        introType: introTypes.length > 0 ? introTypes.join(',') : null,
        introBeds: introBeds !== '' ? Number(introBeds) : null,
        contractDate: contractDate || null,
      }

      if (hiraChanged) {
        body.changeHira = true
        body.hiraId = pendingHira ? pendingHira.hiraId : null
      }

      const res = await fetch(`/api/hospitals/${code}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        router.refresh()
        router.push(`/hospitals/${code}`)
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

  if (error && !hospital) {
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
            href={`/hospitals/${code}`}
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
                  value={hospitalName}
                  onChange={(e) => setHospitalName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">계약일</label>
                <input
                  type="date"
                  value={contractDate}
                  onChange={(e) => setContractDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* thynC 도입현황 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">thynC 도입현황</h2>
            </div>
            <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">상태 *</label>
                <select
                  required
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {statusCodes.length === 0 ? (
                    <option value={status}>{status}</option>
                  ) : (
                    statusCodes.map((sc) => (
                      <option key={sc.id} value={sc.name}>{sc.name}</option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">도입 병상 수</label>
                <input
                  type="number"
                  min="0"
                  value={introBeds}
                  onChange={(e) => setIntroBeds(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="숫자 입력"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">도입형태</label>
                <div className="mt-2 flex flex-wrap gap-4">
                  {INTRO_TYPE_OPTIONS.map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={introTypes.includes(t)}
                        onChange={() => toggleIntroType(t)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 심평원 정보 조회 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">심평원 정보 조회</h2>
                {hiraChanged && (
                  <p className="mt-0.5 text-xs font-medium text-amber-600">
                    {pendingHira === null ? '저장 시 연결이 해제됩니다.' : '저장 시 새 병원으로 연결됩니다.'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {hasHiraLink && (
                  <button
                    type="button"
                    onClick={() => setPendingHira(null)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                  >
                    연결 해제
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowModal(true)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  {hasHiraLink ? '병원 변경' : '병원 연결'}
                </button>
                {hiraChanged && (
                  <button
                    type="button"
                    onClick={() => setPendingHira(undefined)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    되돌리기
                  </button>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-4 border-t border-gray-100 px-6 py-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">심평원 병원명</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {displayHira && 'name' in displayHira && displayHira.name
                    ? displayHira.name
                    : <span className="text-gray-400">-</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">종별</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {displayHira && 'typeName' in displayHira && displayHira.typeName
                    ? displayHira.typeName
                    : (displayHira && 'type' in displayHira && (displayHira as { type?: string }).type)
                      || <span className="text-gray-400">-</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">주소</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {displayHira && 'address' in displayHira && displayHira.address
                    ? displayHira.address
                    : <span className="text-gray-400">-</span>}
                </dd>
              </div>
            </dl>
          </div>

          {/* 버튼 */}
          <div className="flex justify-end gap-3 pb-4">
            <Link
              href={`/hospitals/${code}`}
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

      <HiraSearchModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSelect={(h) => setPendingHira(h)}
        allowRegistered
      />
    </div>
  )
}
