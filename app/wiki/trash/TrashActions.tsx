'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '../components/ui/Toast'

export default function TrashActions({ pageId, title }: { pageId: string; title: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const restore = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/wiki/pages/${pageId}/restore`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || '복구 실패')
        return
      }
      toast.success(data.promotedToRoot ? '복구됨 (최상위로 이동)' : '복구되었습니다')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const purge = async () => {
    if (!confirm(`"${title || '제목 없음'}" 페이지를 영구 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/wiki/pages/${pageId}?permanent=1`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || '영구 삭제 실패')
        return
      }
      toast.success('영구 삭제되었습니다')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 gap-1.5">
      <button
        onClick={restore}
        disabled={busy}
        className="rounded-[6px] border border-[var(--wiki-border)] px-2.5 py-1 text-xs text-[var(--wiki-text-soft)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)] disabled:opacity-50"
      >
        복구
      </button>
      <button
        onClick={purge}
        disabled={busy}
        className="rounded-[6px] border border-red-200 px-2.5 py-1 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
      >
        영구 삭제
      </button>
    </div>
  )
}
