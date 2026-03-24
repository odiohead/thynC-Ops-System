'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Staff {
  id: string
  name: string
  email: string
  phoneNumber: string | null
  branchInfo: string | null
  _count: { assignments: number }
}

const EMPTY_FORM = { name: '', email: '', phoneNumber: '', branchInfo: '', etc: '' }

export default function DaewoongStaffPage() {
  const router = useRouter()
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const res = await fetch('/api/daewoong-staff')
    const data = await res.json()
    setStaff(data.staff)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/daewoong-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setShowModal(false)
        setForm(EMPTY_FORM)
        router.refresh()
        load()
      } else {
        const data = await res.json()
        setError(data.error ?? '등록에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">대웅제약 직원 관리</h1>
            <p className="mt-1 text-sm text-gray-500">총 {staff.length}명</p>
          </div>
          <button
            onClick={() => { setShowModal(true); setError('') }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            직원 등록
          </button>
        </div>

        {/* 테이블 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['직원 ID', '이름', '이메일', '전화번호', '사업소', '담당 병원'].map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr><td colSpan={6} className="py-16 text-center text-sm text-gray-400">불러오는 중...</td></tr>
                ) : staff.length === 0 ? (
                  <tr><td colSpan={6} className="py-16 text-center text-sm text-gray-400">등록된 직원이 없습니다.</td></tr>
                ) : (
                  staff.map(s => (
                    <tr
                      key={s.id}
                      onClick={() => router.push(`/daewoong-staff/${s.id}`)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{s.id}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.email}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{s.phoneNumber ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{s.branchInfo ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{s._count.assignments}개</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 등록 모달 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">직원 등록</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">이름 *</label>
                <input required value={form.name} onChange={e => set('name', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">이메일 *</label>
                <input required type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">전화번호</label>
                <input value={form.phoneNumber} onChange={e => set('phoneNumber', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">사업소명</label>
                <input value={form.branchInfo} onChange={e => set('branchInfo', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">기타 메모</label>
                <textarea value={form.etc} onChange={e => set('etc', e.target.value)} rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  취소
                </button>
                <button type="submit" disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving ? '등록 중...' : '등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
