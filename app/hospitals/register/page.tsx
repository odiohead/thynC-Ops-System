'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import HiraSearchModal, { HiraHospital } from '../_components/HiraSearchModal'

const INTRO_TYPE_OPTIONS = ['구축형', '구독형', '사용량비례형']

interface StatusCode {
  id: number
  name: string
}

export default function RegisterPage() {
  const router = useRouter()

  const [hospitalName, setHospitalName] = useState('')
  const [status, setStatus] = useState('')
  const [introTypes, setIntroTypes] = useState<string[]>([])
  const [introBeds, setIntroBeds] = useState('')
  const [statusCodes, setStatusCodes] = useState<StatusCode[]>([])

  const [selectedHira, setSelectedHira] = useState<HiraHospital | null>(null)
  const [showModal, setShowModal] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/status')
      .then((r) => r.json())
      .then((d) => {
        const codes: StatusCode[] = d.statusCodes ?? []
        setStatusCodes(codes)
        if (codes.length > 0) setStatus(codes[0].name)
      })
  }, [])

  function toggleIntroType(t: string) {
    setIntroTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }

  function handleSelectHira(h: HiraHospital) {
    setSelectedHira(h)
    if (!hospitalName) setHospitalName(h.name)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/hospitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalName,
          status,
          hiraId: selectedHira?.hiraId ?? null,
          introType: introTypes.length > 0 ? introTypes.join(',') : null,
          introBeds: introBeds !== '' ? Number(introBeds) : null,
        }),
      })
      if (res.ok) {
        const { hospital } = await res.json()
        router.push(`/hospitals/${hospital.hospitalCode}`)
      } else {
        const json = await res.json()
        setError(json.error ?? '등록에 실패했습니다.')
      }
    } catch {
      setError('등록 중 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/hospitals"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
          >
            ← 목록으로
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">병원 등록</h1>
            <p className="mt-0.5 text-sm text-gray-500">병원명과 상태는 필수 항목입니다.</p>
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
                  placeholder="병원명 입력"
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400">상태 *</label>
                <select
                  required
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">선택</option>
                  {statusCodes.map((sc) => (
                    <option key={sc.id} value={sc.name}>{sc.name}</option>
                  ))}
                </select>
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
            </div>
          </div>

          {/* 심평원 정보 조회 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">심평원 정보 조회</h2>
                <p className="mt-0.5 text-xs text-gray-400">선택사항 — 나중에 수정 화면에서도 연결할 수 있습니다.</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedHira && (
                  <button
                    type="button"
                    onClick={() => setSelectedHira(null)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    연결 해제
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowModal(true)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  {selectedHira ? '병원 변경' : '병원 검색'}
                </button>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-4 border-t border-gray-100 px-6 py-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">심평원 병원명</dt>
                <dd className="mt-1 text-sm text-gray-900">{selectedHira?.name ?? <span className="text-gray-400">-</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">종별</dt>
                <dd className="mt-1 text-sm text-gray-900">{selectedHira?.typeName ?? <span className="text-gray-400">-</span>}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">주소</dt>
                <dd className="mt-1 text-sm text-gray-900">{selectedHira?.address ?? <span className="text-gray-400">-</span>}</dd>
              </div>
            </dl>
          </div>

          {/* 버튼 */}
          <div className="flex justify-end gap-3 pb-4">
            <Link
              href="/hospitals"
              className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              취소
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '등록 중...' : '등록'}
            </button>
          </div>

        </form>
      </div>

      <HiraSearchModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSelect={handleSelectHira}
      />
    </div>
  )
}
