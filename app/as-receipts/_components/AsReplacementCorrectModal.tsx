'use client'

/**
 * 교체기 정정 모달 (2026-11-23 — projects/as_replacement_correct_design.md)
 * 교체로 확정한 라인의 교체 발송기기를 잘못 적었을 때 맞는 시리얼로 고친다.
 * 서버 `POST /api/as-receipts/[id]/correct-replacement` — 잘못된 교체의 기기현황 기록을 취소하고 맞는 교체기로 다시 기록한다.
 */
import { useEffect, useState } from 'react'

export interface ReplacementTarget {
  id: number
  serialNo: string
  newSerialNo: string | null
}

export default function AsReplacementCorrectModal({ open, onClose, receipt, item, onDone }: {
  open: boolean
  onClose: () => void
  receipt: { id: number; asCode: string }
  item: ReplacementTarget | null
  onDone: (result: { serialNo: string; previousNewSerialNo: string | null; newSerialNo: string; registryChanged: boolean; warnings: string[] }) => void
}) {
  const [serial, setSerial] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 다른 라인으로 다시 열면 입력을 비운다
  useEffect(() => { setSerial(''); setReason(''); setError(null) }, [item?.id, open])
  if (!open || !item) return null
  const next = serial.trim().toUpperCase()

  async function submit() {
    if (!item || busy) return
    if (!next) { setError('맞는 교체 발송기기 시리얼을 입력하세요.'); return }
    if (!confirm(`${item.serialNo}의 교체기를 ${item.newSerialNo ?? '-'} → ${next}(으)로 정정합니다.\n\n기기현황에서 ${item.newSerialNo ?? '-'}의 교체 기록을 취소하고 ${next}을(를) 병원에 배치합니다. 계속할까요?`)) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/as-receipts/${receipt.id}/correct-replacement`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: item.id, serial: next, reason: reason.trim() || null }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? d.message ?? '교체기 정정에 실패했습니다.'); return }
    onDone({ serialNo: d.serialNo, previousNewSerialNo: d.previousNewSerialNo ?? null, newSerialNo: d.newSerialNo, registryChanged: !!d.registryChanged, warnings: d.warnings ?? [] })
  }

  const label = 'text-xs font-medium text-gray-500'
  const inputCls = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="as-replacement-modal">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900">교체기 정정 — <span className="font-mono">{item.serialNo}</span></h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">✕</button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-gray-500">
          교체 발송기기 시리얼을 잘못 적었을 때 고칩니다. 지금 적힌 <span className="font-mono text-gray-700">{item.newSerialNo ?? '-'}</span>의 교체 기록을 기기현황에서 취소하고, 맞는 교체기를 병원에 배치합니다.
          발송일·발송방법과 접수 상태는 그대로입니다.
        </p>
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-testid="replacement-error">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className={label}>맞는 교체 발송기기 시리얼</label>
            <input value={serial} autoFocus maxLength={40} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} placeholder="실제로 보낸 기기의 시리얼" className={`${inputCls} font-mono`} data-testid="replacement-serial" />
          </div>
          <div>
            <label className={label}>사유 <span className="font-normal text-gray-400">(선택 — 접수 비고에 기록)</span></label>
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="예: 교체기 시리얼 오입력" className={inputCls} data-testid="replacement-reason" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
          <button type="button" onClick={submit} disabled={busy || !next} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" data-testid="replacement-submit">{busy ? '처리 중…' : '정정'}</button>
        </div>
      </div>
    </div>
  )
}
