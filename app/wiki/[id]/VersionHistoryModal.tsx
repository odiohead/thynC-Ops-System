'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '../components/ui/Toast'

type Version = {
  id: string
  title: string
  savedAt: string
  savedBy: { id: string; name: string }
}

export type RestorePayload = { blocks: unknown[]; title: string }

export default function VersionHistoryModal({
  pageId,
  onClose,
  canRestoreLive,
  onRestoreLive,
}: {
  pageId: string
  onClose: () => void
  /**
   * 협업 세션이 연결돼 있어 클라이언트에서 본문을 적용할 수 있는가.
   * 협업 페이지는 서버가 content_json을 고쳐도 Y.Doc이 되돌리므로(2026-09-12 A-4) 연결 전에는 복원을 막는다.
   */
  canRestoreLive: boolean
  /** 서버가 `mode: 'client'`로 응답했을 때 라이브 에디터에 블록을 적용. 성공 여부 반환 */
  onRestoreLive: (payload: RestorePayload) => Promise<boolean>
}) {
  const router = useRouter()
  const toast = useToast()
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
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || `복원 실패 (${res.status})`)
        return
      }
      if (data.mode === 'client') {
        const applied = await onRestoreLive({
          blocks: Array.isArray(data.blocks) ? (data.blocks as unknown[]) : [],
          title: data.title ?? '',
        })
        if (!applied) {
          toast.error('본문 적용에 실패했습니다. 협업 연결 상태를 확인한 뒤 다시 시도하세요.')
          return
        }
      }
      toast.success('복원되었습니다')
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
            본문을 편집하는 동안 2분 간격으로 직전 상태가 자동 저장됩니다(동시 편집 시 마지막 입력자 기준).
            복원하면 현재 본문은 새 버전으로 보존됩니다.
          </p>
          {!canRestoreLive && (
            <p className="mt-1 text-xs text-amber-700">
              실시간 협업에 연결된 상태에서만 복원할 수 있습니다. 연결을 확인한 뒤 다시 열어주세요.
            </p>
          )}
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
                    disabled={restoring === v.id || !canRestoreLive}
                    title={canRestoreLive ? undefined : '협업 연결 후 복원 가능'}
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
