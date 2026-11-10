'use client'

/**
 * 분실기기 되찾음 모달 (2026-11-10 — projects/as_lost_found_design.md §3.5)
 * 정책: 교체기기 발송 후 되찾으면 되찾은 기기를 병원이 계속 쓰고 **교체기기는 회수**(2대 사용 없음). 분기 선택 없음.
 * 서버 `POST /api/as-receipts/[id]/found` — 라인 REPLACE → FOUND, 교체기기 RECOVER(반납)·되찾은 기기 재배치, 분실 한도 −1.
 */
import { useState } from 'react'

export interface FoundTarget {
  id: number
  serialNo: string
  newSerialNo: string | null
  wardName: string | null
  /** 교체기기 배치 병동(원장) — 기본 복귀 병동 */
  placementWard: string | null
}

export default function AsFoundModal({ open, onClose, receipt, item, onDone }: {
  open: boolean
  onClose: () => void
  receipt: { id: number; asCode: string }
  item: FoundTarget | null
  onDone: (result: { serialNo: string; newSerialNo: string | null; warnings: string[] }) => void
}) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const [foundAt, setFoundAt] = useState(today)
  const [ward, setWard] = useState<string | null>(null)
  const [tracking, setTracking] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open || !item) return null
  const wardValue = ward ?? item.placementWard ?? item.wardName ?? ''

  async function submit() {
    if (!item || busy) return
    const summary = `${item.serialNo} → 사용중 복귀${wardValue ? ` (${wardValue})` : ''}\n교체기기 ${item.newSerialNo ?? '-'} → 회수(반납)\n분실 제공 수량 −1대\n\n${receipt.asCode}의 이 라인은 '되찾음'으로 종결되고 되돌릴 수 없습니다. 계속할까요?`
    if (!confirm(summary)) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/as-receipts/${receipt.id}/found`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: item.id, foundAt, wardName: wardValue || null, recallTrackingNo: tracking.trim() || null, memo: memo.trim() || null }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? d.message ?? '되찾음 처리에 실패했습니다.'); return }
    onDone({ serialNo: d.serialNo, newSerialNo: d.newSerialNo ?? null, warnings: d.warnings ?? [] })
  }

  const label = 'text-xs font-medium text-gray-500'
  const inputCls = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="as-found-modal">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900">분실기기 되찾음 — <span className="font-mono">{item.serialNo}</span></h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">✕</button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-gray-500">
          되찾은 기기는 병원에서 계속 사용하고, 교체로 보낸 기기 <span className="font-mono text-gray-700">{item.newSerialNo ?? '-'}</span>는 회수(반납)합니다. 교체 제공이 무효가 되어 분실 제공 수량에서 1대 빠집니다.
        </p>
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>되찾은 날</label>
              <input type="date" value={foundAt} max={today} onChange={(e) => setFoundAt(e.target.value)} className={inputCls} data-testid="found-date" />
            </div>
            <div>
              <label className={label}>복귀 병동</label>
              <input value={wardValue} onChange={(e) => setWard(e.target.value)} placeholder="병동명" className={inputCls} data-testid="found-ward" />
            </div>
          </div>
          <div>
            <label className={label}>교체기기 회수 송장 <span className="font-normal text-gray-400">(선택)</span></label>
            <input value={tracking} maxLength={50} onChange={(e) => setTracking(e.target.value)} placeholder="회수 택배 송장번호" className={inputCls} data-testid="found-tracking" />
          </div>
          <div>
            <label className={label}>메모 <span className="font-normal text-gray-400">(선택 — 접수 비고에 기록)</span></label>
            <input value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} placeholder="예: 병동 창고에서 발견" className={inputCls} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
          <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-teal-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50" data-testid="found-submit">{busy ? '처리 중…' : '되찾음 처리'}</button>
        </div>
      </div>
    </div>
  )
}
