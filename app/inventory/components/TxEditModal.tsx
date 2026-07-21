'use client'

import { useState, useEffect, useRef } from 'react'

interface Reason { id: number; name: string; value: string | null }

interface EditableTx {
  id: number
  txCode: string
  txType: 'IN' | 'OUT' | 'MOVE' | 'TRANSFER'
  reasonCode: { id: number; name: string; value?: string | null } | null
  quantity: number
  requester: string | null
  destination: string | null
  lotNo: string | null
  note: string | null
  txDate: string
  item: { unit: string; isSerialManaged: boolean }
  childTxs: { id: number }[]
}

/**
 * 전표 메타 정보 수정 모달 (ADMIN + 재고 담당자).
 * 수량은 비시리얼 품목만 수정 가능(변경분 재고 자동 반영) — 시리얼 품목·세트출고 부모는 취소 후 재등록.
 * 품목·위치·시리얼 개체는 수정 불가 — 유형(같은 동작 부류)·요청자·출고처·비고만.
 */
export default function TxEditModal({ tx, onClose, onDone }: { tx: EditableTx; onClose: () => void; onDone: () => void }) {
  const [reasons, setReasons] = useState<Reason[]>([])
  const [reasonId, setReasonId] = useState<number | null>(tx.reasonCode?.id ?? null)
  const backdropDown = useRef(false) // 모달 안 드래그 후 배경에서 마우스를 놓아도 닫히지 않도록
  const [quantity, setQuantity] = useState(String(tx.quantity))
  const [requester, setRequester] = useState(tx.requester ?? '')
  const [destination, setDestination] = useState(tx.destination ?? '')
  const [lotNo, setLotNo] = useState(tx.lotNo ?? '')
  const [txDate, setTxDate] = useState(tx.txDate?.slice(0, 10) ?? '')
  const [note, setNote] = useState(tx.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasReason = tx.txType === 'IN' || tx.txType === 'OUT'
  const currentValue = tx.reasonCode?.value ?? null
  // 수량 수정 — 비시리얼 품목만, 세트출고 부모는 서버에서도 거부 (자식 정합)
  const canEditQty = !tx.item.isSerialManaged && tx.txType !== 'TRANSFER' && tx.childTxs.length === 0

  useEffect(() => {
    if (!hasReason) return
    const url = tx.txType === 'IN' ? '/api/settings/stock-in-type' : '/api/settings/stock-out-type'
    fetch(url).then(async (r) => { if (r.ok) setReasons((await r.json()).statusCodes ?? []) })
  }, [hasReason, tx.txType])

  // 같은 시스템 동작 부류(일반↔일반, 회수↔회수, 폐기↔폐기)만 선택 가능
  const selectableReasons = reasons.filter((r) => (r.value ?? null) === currentValue)

  async function save() {
    if (tx.txType === 'OUT' && !requester.trim()) { setError('출고 전표의 요청자는 비울 수 없습니다.'); return }
    if (canEditQty) {
      const q = Math.trunc(Number(quantity))
      if (!Number.isFinite(q) || q <= 0) { setError('수량은 1 이상의 정수여야 합니다.'); return }
    }
    setBusy(true); setError(null)
    const payload: Record<string, unknown> = { requester: requester.trim(), note, lotNo: lotNo.trim() }
    if (canEditQty) payload.quantity = Math.trunc(Number(quantity))
    if (txDate) payload.txDate = txDate
    if (hasReason && reasonId) payload.reasonId = reasonId
    if (tx.txType === 'OUT') payload.destination = destination
    const res = await fetch(`/api/inventory/transactions/${tx.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    if (res.ok) onDone()
    else setError((await res.json()).error ?? '수정 실패')
    setBusy(false)
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => { backdropDown.current = e.target === e.currentTarget }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropDown.current) onClose(); backdropDown.current = false }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-900">전표 수정 <span className="ml-1 font-mono text-xs font-normal text-gray-400">{tx.txCode}</span></h2>
          <p className="mt-1 text-xs text-gray-400">
            {canEditQty
              ? '수량 변경분은 재고에 즉시 반영됩니다. 품목·위치는 수정할 수 없습니다 — 취소 후 재등록하세요.'
              : '수량·품목·위치·시리얼은 수정할 수 없습니다 — 잘못 입력된 전표는 취소 후 재등록하세요.'}
          </p>
        </div>

        <div className="space-y-3">
          {hasReason && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">{tx.txType === 'IN' ? '입고' : '출고'} 유형</label>
              <select value={reasonId ?? ''} onChange={(e) => setReasonId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                {selectableReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {selectableReasons.length <= 1 && (
                <p className="mt-1 text-xs text-gray-400">회수·폐기 등 시스템 동작이 다른 유형으로는 변경할 수 없습니다.</p>
              )}
            </div>
          )}
          <div className={`grid gap-3 ${canEditQty ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {canEditQty && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">수량 <span className="font-normal text-gray-400">({tx.item.unit})</span></label>
                <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">요청자 {tx.txType === 'OUT' && <span className="text-red-500">*</span>}</label>
              <input value={requester} onChange={(e) => setRequester(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">입출고일</label>
              <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} className={inputCls} />
            </div>
          </div>
          {tx.txType === 'OUT' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">출고처</label>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} className={inputCls} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">LOT <span className="font-normal text-gray-400">(전표 표기 — 개체 LOT은 변경 안 됨)</span></label>
            <input value={lotNo} onChange={(e) => setLotNo(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">비고</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </div>
        </div>

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">취소</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
