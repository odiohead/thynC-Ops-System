'use client'

import { useState } from 'react'

// 개체(시리얼 단품) 태그·메모 편집 모달 — PATCH /api/inventory/units/[id]
interface UnitLite {
  id: number
  serialNo: string
  tags: string[]
  memo: string | null
}

export default function UnitEditModal({ unit, onClose, onSaved }: {
  unit: UnitLite
  onClose: () => void
  onSaved: () => void
}) {
  const [tags, setTags] = useState((unit.tags ?? []).join(', '))
  const [memo, setMemo] = useState(unit.memo ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/units/${unit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          memo,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '저장 실패')
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900">개체 편집</h3>
          <p className="mt-0.5 font-mono text-xs text-gray-500">{unit.serialNo}</p>
        </div>
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">태그 (쉼표 구분, 최대 10개)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="예: DEMO, 각인, 평가1차"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">메모</label>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
            {busy ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
