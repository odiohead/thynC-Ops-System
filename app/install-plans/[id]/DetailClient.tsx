'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import InstallPlanForm from '../InstallPlanForm'

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
  initialData: InstallPlanData
  canAdmin: boolean
}

export default function InstallPlanDetailClient({ initialData, canAdmin }: Props) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const res = await fetch(`/api/install-plans/${initialData.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      router.push('/install-plans')
    } else {
      setDeleting(false)
      setShowConfirm(false)
      alert('삭제에 실패했습니다.')
    }
  }

  return (
    <>
      <InstallPlanForm initialData={initialData} mode="edit" />

      {canAdmin && (
        <div className="mt-6 border-t border-gray-200 pt-6">
          {!showConfirm ? (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              삭제
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-700">정말 삭제하시겠습니까?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? '삭제 중...' : '확인'}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
