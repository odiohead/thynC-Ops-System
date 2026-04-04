'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import DaewoongSelectModal from '@/app/components/DaewoongSelectModal'

interface AssignedUser {
  id: string
  name: string
  email: string
  phone: string
}

interface Assignment {
  assignedUser: AssignedUser
}

export default function DaewoongStaffTab({ hospitalCode, isAdmin }: { hospitalCode: string; isAdmin?: boolean }) {
  const router = useRouter()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/hospitals/${hospitalCode}/daewoong-staff`)
    const data = await res.json()
    setAssignments(data.assignments ?? [])
    setLoading(false)
  }, [hospitalCode])

  useEffect(() => { load() }, [load])

  async function handleRemove(userId: string) {
    if (!confirm('담당자 배정을 해제하시겠습니까?')) return
    await fetch(`/api/hospitals/${hospitalCode}/daewoong-staff/${userId}`, { method: 'DELETE' })
    router.refresh()
    load()
  }

  async function handleSelectComplete(selected: { id: string; name: string; email: string }[]) {
    const currentIds = new Set(assignments.map((a) => a.assignedUser.id))
    const selectedIds = new Set(selected.map((u) => u.id))

    // 신규 추가
    const toAdd = selected.filter((u) => !currentIds.has(u.id))
    // 해제
    const toRemove = assignments.filter((a) => !selectedIds.has(a.assignedUser.id))

    await Promise.all([
      ...toAdd.map((u) =>
        fetch(`/api/hospitals/${hospitalCode}/daewoong-staff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: u.id }),
        })
      ),
      ...toRemove.map((a) =>
        fetch(`/api/hospitals/${hospitalCode}/daewoong-staff/${a.assignedUser.id}`, { method: 'DELETE' })
      ),
    ])

    router.refresh()
    load()
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm relative">
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">대웅 담당자 ({assignments.length})</h2>
        {isAdmin && (
          <button
            onClick={() => setShowModal(true)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
          >
            담당자 추가
          </button>
        )}
      </div>

      <div className="px-6 py-4">
        {loading ? (
          <p className="py-4 text-center text-sm text-gray-400">불러오는 중...</p>
        ) : assignments.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">배정된 담당자가 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {assignments.map(({ assignedUser }) => (
              <span
                key={assignedUser.id}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700"
              >
                {assignedUser.name}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleRemove(assignedUser.id)}
                    className="ml-0.5 text-blue-400 hover:text-blue-600"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <DaewoongSelectModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSelect={handleSelectComplete}
        currentAssigneeIds={assignments.map((a) => a.assignedUser.id)}
      />
    </div>
  )
}
