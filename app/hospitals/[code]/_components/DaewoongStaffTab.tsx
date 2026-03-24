'use client'

import { useState, useEffect, useCallback } from 'react'

interface AssignedUser {
  id: string
  name: string
  email: string
  phone: string
}

interface Assignment {
  assignedUser: AssignedUser
}

interface DaewoongUser {
  id: string
  name: string
  email: string
  phone: string
}

export default function DaewoongStaffTab({ hospitalCode }: { hospitalCode: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [allUsers, setAllUsers] = useState<DaewoongUser[]>([])
  const [assignError, setAssignError] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/hospitals/${hospitalCode}/daewoong-staff`)
    const data = await res.json()
    setAssignments(data.assignments ?? [])
    setLoading(false)
  }, [hospitalCode])

  useEffect(() => { load() }, [load])

  async function loadAllUsers() {
    const res = await fetch('/api/users?organization=DAEWOONG')
    const data = await res.json()
    setAllUsers(Array.isArray(data) ? data : [])
  }

  async function handleAssign(userId: string) {
    setAssignLoading(true)
    setAssignError('')
    try {
      const res = await fetch(`/api/hospitals/${hospitalCode}/daewoong-staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (res.ok) { setShowModal(false); load() }
      else { const d = await res.json(); setAssignError(d.error ?? '배정 실패') }
    } finally { setAssignLoading(false) }
  }

  async function handleRemove(userId: string) {
    if (!confirm('담당자 배정을 해제하시겠습니까?')) return
    await fetch(`/api/hospitals/${hospitalCode}/daewoong-staff/${userId}`, { method: 'DELETE' })
    load()
  }

  const assignedIds = new Set(assignments.map(a => a.assignedUser.id))

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">대웅 담당자 ({assignments.length})</h2>
        <button
          onClick={() => { setShowModal(true); setAssignError(''); loadAllUsers() }}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        >
          담당자 배정
        </button>
      </div>

      <div className="divide-y divide-gray-200">
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">불러오는 중...</p>
        ) : assignments.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">배정된 담당자가 없습니다.</p>
        ) : (
          assignments.map(({ assignedUser }) => (
            <div key={assignedUser.id} className="flex items-center justify-between px-6 py-3">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">{assignedUser.name}</p>
                  <p className="text-xs text-gray-400">{assignedUser.email}</p>
                </div>
                {assignedUser.phone && (
                  <span className="text-xs text-gray-500">{assignedUser.phone}</span>
                )}
              </div>
              <button onClick={() => handleRemove(assignedUser.id)}
                className="text-xs text-red-500 hover:text-red-700 transition-colors">
                해제
              </button>
            </div>
          ))
        )}
      </div>

      {/* 배정 모달 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">담당자 배정 (대웅제약 소속)</h2>
            {assignError && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{assignError}</p>}
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200">
              {allUsers.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">대웅제약 소속 직원이 없습니다.</p>
              ) : (
                allUsers.map(u => {
                  const assigned = assignedIds.has(u.id)
                  return (
                    <div key={u.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <span className="text-sm font-medium text-gray-900">{u.name}</span>
                        <span className="ml-2 text-xs text-gray-400">{u.email}</span>
                        {u.phone && <span className="ml-2 text-xs text-gray-400">{u.phone}</span>}
                      </div>
                      <button
                        disabled={assigned || assignLoading}
                        onClick={() => handleAssign(u.id)}
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
              <button onClick={() => setShowModal(false)}
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
