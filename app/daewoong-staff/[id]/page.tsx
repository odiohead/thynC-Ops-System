'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface Staff {
  id: string
  name: string
  email: string
  phoneNumber: string | null
  branchInfo: string | null
  etc: string | null
  assignments: { hospital: { hospitalCode: string; name: string } }[]
}

interface Hospital {
  id: number
  hospitalCode: string
  name: string
}

export default function DaewoongStaffDetailPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [staff, setStaff] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phoneNumber: '', branchInfo: '', etc: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // 병원 배정 관련
  const [hospitals, setHospitals] = useState<Hospital[]>([])
  const [hospitalSearch, setHospitalSearch] = useState('')
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/daewoong-staff/${id}`)
    if (!res.ok) { router.push('/daewoong-staff'); return }
    const data = await res.json()
    setStaff(data.staff)
    setForm({
      name: data.staff.name,
      email: data.staff.email,
      phoneNumber: data.staff.phoneNumber ?? '',
      branchInfo: data.staff.branchInfo ?? '',
      etc: data.staff.etc ?? '',
    })
    setLoading(false)
  }, [id, router])

  useEffect(() => { load() }, [load])

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      const res = await fetch(`/api/daewoong-staff/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) { setEditing(false); load() }
      else { const d = await res.json(); setFormError(d.error ?? '저장 실패') }
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirm('직원을 삭제하시겠습니까? 담당 병원 배정도 모두 해제됩니다.')) return
    await fetch(`/api/daewoong-staff/${id}`, { method: 'DELETE' })
    router.push('/daewoong-staff')
  }

  async function handleRemoveAssignment(hospitalCode: string) {
    if (!confirm('담당 병원 배정을 해제하시겠습니까?')) return
    await fetch(`/api/hospitals/${hospitalCode}/daewoong-staff/${id}`, { method: 'DELETE' })
    load()
  }

  async function loadHospitals() {
    const res = await fetch(`/api/hospitals?search=${encodeURIComponent(hospitalSearch)}`)
    const data = await res.json()
    setHospitals(data.hospitals)
  }

  async function handleAssign(hospitalCode: string) {
    setAssignLoading(true)
    setAssignError('')
    try {
      const res = await fetch(`/api/hospitals/${hospitalCode}/daewoong-staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: id }),
      })
      if (res.ok) { setShowAssignModal(false); setHospitalSearch(''); load() }
      else { const d = await res.json(); setAssignError(d.error ?? '배정 실패') }
    } finally { setAssignLoading(false) }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-gray-400">불러오는 중...</p></div>
  if (!staff) return null

  const assignedCodes = new Set(staff.assignments.map(a => a.hospital.hospitalCode))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/daewoong-staff"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors">
              ← 목록으로
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{staff.name}</h1>
              <p className="mt-0.5 font-mono text-sm text-gray-400">{staff.id}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {!editing && (
              <button onClick={() => setEditing(true)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors">
                수정
              </button>
            )}
            <button onClick={handleDelete}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
              삭제
            </button>
          </div>
        </div>

        {/* 기본 정보 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">기본 정보</h2>
          </div>
          {editing ? (
            <form onSubmit={handleSave} className="space-y-4 px-6 py-5">
              {[
                { label: '이름 *', field: 'name', required: true },
                { label: '이메일 *', field: 'email', required: true },
                { label: '전화번호', field: 'phoneNumber', required: false },
                { label: '사업소명', field: 'branchInfo', required: false },
              ].map(({ label, field, required }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input required={required} value={form[field as keyof typeof form]} onChange={e => set(field, e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">기타 메모</label>
                <textarea value={form.etc} onChange={e => set('etc', e.target.value)} rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
                <button type="submit" disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          ) : (
            <dl className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-2">
              {[
                { label: '직원 ID', value: <span className="font-mono">{staff.id}</span> },
                { label: '이름', value: staff.name },
                { label: '이메일', value: staff.email },
                { label: '전화번호', value: staff.phoneNumber },
                { label: '사업소명', value: staff.branchInfo },
                { label: '기타 메모', value: staff.etc },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</dt>
                  <dd className="mt-1 text-sm text-gray-900">{value ?? <span className="text-gray-400">-</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* 담당 병원 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">담당 병원 ({staff.assignments.length})</h2>
            <button
              onClick={() => { setShowAssignModal(true); setAssignError(''); setHospitals([]); setHospitalSearch('') }}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors">
              병원 배정
            </button>
          </div>
          <div className="divide-y divide-gray-200">
            {staff.assignments.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">배정된 병원이 없습니다.</p>
            ) : (
              staff.assignments.map(({ hospital }) => (
                <div key={hospital.hospitalCode} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <span className="font-mono text-xs text-gray-400">{hospital.hospitalCode}</span>
                    <span className="ml-3 text-sm text-gray-900">{hospital.name}</span>
                  </div>
                  <button onClick={() => handleRemoveAssignment(hospital.hospitalCode)}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors">
                    해제
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 병원 배정 모달 */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">병원 배정</h2>
            <div className="flex gap-2 mb-3">
              <input
                value={hospitalSearch}
                onChange={e => setHospitalSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), loadHospitals())}
                placeholder="병원명 검색..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button onClick={loadHospitals}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
                검색
              </button>
            </div>
            {assignError && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{assignError}</p>}
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200">
              {hospitals.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">병원을 검색하세요.</p>
              ) : (
                hospitals.map(h => {
                  const assigned = assignedCodes.has(h.hospitalCode)
                  return (
                    <div key={h.hospitalCode} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <span className="font-mono text-xs text-gray-400">{h.hospitalCode}</span>
                        <span className="ml-2 text-sm text-gray-900">{h.name}</span>
                      </div>
                      <button
                        disabled={assigned || assignLoading}
                        onClick={() => handleAssign(h.hospitalCode)}
                        className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
                          assigned ? 'bg-gray-100 text-gray-400 cursor-default' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        }`}>
                        {assigned ? '배정됨' : '배정'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setShowAssignModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
