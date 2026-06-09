'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Version = {
  id: string
  title: string
  savedAt: string
  savedBy: { id: string; name: string }
}

export default function VersionHistoryModal({
  pageId,
  onClose,
}: {
  pageId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/wiki/pages/${pageId}/versions`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setVersions(data.versions ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : '조회 실패'))
      .finally(() => setLoading(false))
  }, [pageId])

  const restore = async (versionId: string) => {
    if (!confirm('이 버전으로 복원하시겠습니까? 현재 본문은 새 버전으로 보존됩니다.')) return
    setRestoring(versionId)
    try {
      const res = await fetch(`/api/wiki/pages/${pageId}/versions/${versionId}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || `복원 실패 (${res.status})`)
        return
      }
      router.refresh()
      onClose()
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b">
          <h2 className="text-lg font-bold">버전 히스토리</h2>
          <p className="text-xs text-gray-500 mt-1">
            본문이 수정될 때마다 직전 상태가 자동 저장됩니다.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">조회 중...</div>
          ) : error ? (
            <div className="p-4 text-sm text-red-600">에러: {error}</div>
          ) : versions.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              아직 저장된 버전이 없습니다.
            </div>
          ) : (
            <ul className="divide-y">
              {versions.map((v) => (
                <li key={v.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{v.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {v.savedBy.name} · {new Date(v.savedAt).toLocaleString('ko-KR')}
                    </div>
                  </div>
                  <button
                    onClick={() => restore(v.id)}
                    disabled={restoring === v.id}
                    className="text-xs px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-50"
                  >
                    {restoring === v.id ? '복원 중...' : '복원'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-3 border-t text-right">
          <button onClick={onClose} className="px-3 py-1 text-sm border rounded hover:bg-gray-50">
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
