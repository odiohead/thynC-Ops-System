'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import RichTextEditor from '@/app/components/RichTextEditor'

interface Hospital {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName: string
}

interface UserOption {
  id: string
  name: string
}

interface InstallPlanData {
  id: number
  hospitalCode: string | null
  hospital: Hospital | null
  requestDate: string | null
  writeStatus: string
  replyStatus: string
  authorId: string | null
  author: UserOption | null
  replyDate: string | null
  note: string | null
}

interface Props {
  initialData?: InstallPlanData
  mode: 'new' | 'edit'
  initialHospitalCode?: string
  initialHospital?: Hospital | null
}

const STATUS_OPTIONS = ['-', '미완료', '완료']

export default function InstallPlanForm({ initialData, mode, initialHospitalCode, initialHospital }: Props) {
  const router = useRouter()

  const [hospitalCode, setHospitalCode] = useState(initialData?.hospitalCode ?? initialHospitalCode ?? '')
  const [hospital, setHospital] = useState<Hospital | null>(initialData?.hospital ?? initialHospital ?? null)
  const [requestDate, setRequestDate] = useState(initialData?.requestDate?.slice(0, 10) ?? '')
  const [writeStatus, setWriteStatus] = useState(initialData?.writeStatus ?? '-')
  const [replyStatus, setReplyStatus] = useState(initialData?.replyStatus ?? '-')
  const [authorId, setAuthorId] = useState(initialData?.authorId ?? '')
  const [replyDate, setReplyDate] = useState(initialData?.replyDate?.slice(0, 10) ?? '')
  const [note, setNote] = useState(initialData?.note ?? '')

  const [users, setUsers] = useState<UserOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 병원 검색 모달
  const [hospitalModalOpen, setHospitalModalOpen] = useState(false)
  const [hospitalSearch, setHospitalSearch] = useState('')
  const [hospitalResults, setHospitalResults] = useState<Hospital[]>([])
  const [hospitalSearching, setHospitalSearching] = useState(false)

  useEffect(() => {
    fetch('/api/users?organization=SEERS')
      .then((r) => r.json())
      .then((data) => setUsers(Array.isArray(data) ? data : []))
  }, [])

  async function searchHospitals() {
    if (!hospitalSearch.trim()) return
    setHospitalSearching(true)
    try {
      const res = await fetch(`/api/hospitals?search=${encodeURIComponent(hospitalSearch)}&limit=20`)
      const data = await res.json()
      setHospitalResults(data.hospitals ?? [])
    } finally {
      setHospitalSearching(false)
    }
  }

  function selectHospital(h: Hospital) {
    setHospital(h)
    setHospitalCode(h.hospitalCode)
    setHospitalModalOpen(false)
    setHospitalSearch('')
    setHospitalResults([])
  }

  function clearHospital() {
    setHospital(null)
    setHospitalCode('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const body = {
      hospitalCode: hospitalCode || null,
      requestDate: requestDate || null,
      writeStatus,
      replyStatus,
      authorId: authorId || null,
      replyDate: replyDate || null,
      note: note || null,
    }

    const url = mode === 'new' ? '/api/install-plans' : `/api/install-plans/${initialData!.id}`
    const method = mode === 'new' ? 'POST' : 'PUT'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? '저장에 실패했습니다.')
      setSaving(false)
      return
    }

    router.refresh()
    router.push('/install-plans')
  }

  const labelClass = 'block text-sm font-medium text-gray-700'
  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const selectClass = inputClass

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* 병원 매핑 */}
        <div>
          <label className={labelClass}>병원 (선택사항)</label>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 bg-gray-50 min-h-[38px]">
              {hospital
                ? (hospital.hospitalName || hospital.hiraHospitalName)
                : <span className="text-gray-400">병원 미매핑</span>}
            </div>
            <button
              type="button"
              onClick={() => setHospitalModalOpen(true)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {hospital ? '변경' : '병원 선택'}
            </button>
            {hospital && (
              <button
                type="button"
                onClick={clearHospital}
                className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                해제
              </button>
            )}
          </div>
        </div>

        {/* 요청일 */}
        <div>
          <label className={labelClass}>요청일</label>
          <input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} className={inputClass} />
        </div>

        {/* 작성완료여부 + 회신여부 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>작성완료여부</label>
            <select value={writeStatus} onChange={(e) => setWriteStatus(e.target.value)} className={selectClass}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>회신여부</label>
            <select value={replyStatus} onChange={(e) => setReplyStatus(e.target.value)} className={selectClass}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* 작성자 */}
        <div>
          <label className={labelClass}>작성자 (씨어스)</label>
          <select value={authorId} onChange={(e) => setAuthorId(e.target.value)} className={selectClass}>
            <option value="">선택 안함</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        {/* 회신일 */}
        <div>
          <label className={labelClass}>회신일</label>
          <input type="date" value={replyDate} onChange={(e) => setReplyDate(e.target.value)} className={inputClass} />
        </div>

        {/* 비고 */}
        <div>
          <label className={labelClass}>비고</label>
          <div className="mt-1">
            <RichTextEditor value={note} onChange={setNote} placeholder="비고를 입력하세요..." />
          </div>
        </div>

        {/* 버튼 */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push('/install-plans')}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? '저장 중...' : mode === 'new' ? '등록' : '수정'}
          </button>
        </div>
      </form>

      {/* 병원 검색 모달 */}
      {hospitalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">병원 검색</h2>
              <button
                type="button"
                onClick={() => { setHospitalModalOpen(false); setHospitalSearch(''); setHospitalResults([]) }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>
            <div className="p-5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={hospitalSearch}
                  onChange={(e) => setHospitalSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchHospitals())}
                  placeholder="병원명 검색..."
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={searchHospitals}
                  disabled={hospitalSearching}
                  className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
                >
                  검색
                </button>
              </div>
              <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-gray-100">
                {hospitalResults.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">
                    {hospitalSearching ? '검색 중...' : '검색 결과가 없습니다.'}
                  </p>
                ) : (
                  hospitalResults.map((h) => (
                    <button
                      key={h.hospitalCode}
                      type="button"
                      onClick={() => selectHospital(h)}
                      className="flex w-full flex-col px-2 py-2.5 text-left hover:bg-blue-50"
                    >
                      <span className="text-sm font-medium text-gray-900">{h.hospitalName || h.hiraHospitalName}</span>
                      <span className="text-xs text-gray-400">{h.hospitalCode}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
