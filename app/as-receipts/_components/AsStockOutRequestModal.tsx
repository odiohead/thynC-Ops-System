'use client'

/**
 * 분실 AS → 출고요청 모달 (2026-11-10 — projects/as_lost_stock_out_link_design.md §4.1)
 * 대상 라인 체크리스트(기기군 카드에서 고른 라인은 미리 체크 — 다른 기기군 라인도 여기서 함께 담아 **한 번의 출고요청**으로) + 희망 출고일·수령지·수취인·비고(접수 정보 프리필)
 * → POST /api/as-receipts/[id]/stock-out-request
 * 생성되는 출고업무: 판매용 · 분실기기 제공 · 납품처 = 접수 병원. 라인은 출고 완료까지 잠긴다.
 */
import { useState } from 'react'

export interface AsStockOutLine { id: number; serialNo: string; deviceGroup: string; wardName: string | null }

export default function AsStockOutRequestModal({ open, onClose, receipt, candidates, initialSelected, onDone }: {
  open: boolean
  onClose: () => void
  receipt: { id: number; asCode: string; hospitalName: string | null; destInfo: string | null; reporterName: string | null }
  /** 출고요청에 담을 수 있는 라인 전부(미종결·미잠금·정상 시리얼) — 기기군 무관 */
  candidates: AsStockOutLine[]
  /** 카드에서 미리 고른 라인 id */
  initialSelected: number[]
  onDone: (r: { sorCode: string; requestId: number; itemCount: number }) => void
}) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(initialSelected))
  const items = candidates.filter((c) => picked.has(c.id))
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const [requestDate, setRequestDate] = useState(today)
  const [shipAddress, setShipAddress] = useState<string | null>(null)
  const [recipient, setRecipient] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) return null
  const groups = Array.from(items.reduce((m, i) => m.set(i.deviceGroup, (m.get(i.deviceGroup) ?? 0) + 1), new Map<string, number>()))
  const addr = shipAddress ?? receipt.destInfo ?? ''
  const rcpt = recipient ?? receipt.reporterName ?? ''
  const noteVal = note ?? `AS ${receipt.asCode} 분실기기 제공 ${items.length}대 (${items.map((i) => i.serialNo).join(', ')})`

  async function submit() {
    if (busy) return
    if (!items.length) { setError('출고요청할 기기를 1대 이상 선택하세요.'); return }
    if (!requestDate) { setError('희망 출고일을 입력하세요.'); return }
    if (!addr.trim()) { setError('수령지를 입력하세요.'); return }
    if (!rcpt.trim()) { setError('수취인을 입력하세요.'); return }
    if (!confirm(`${receipt.asCode}의 ${items.length}대를 출고요청합니다.\n${groups.map(([g, n]) => `· ${g} ${n}대`).join('\n')}\n\n출고업무 티켓(판매용 · 분실기기 제공)이 생성되고, 출고가 완료되면 라인이 자동으로 교체 확정됩니다. 그동안 이 라인들은 잠깁니다. 계속할까요?`)) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/as-receipts/${receipt.id}/stock-out-request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: items.map((i) => i.id), requestDate, shipAddress: addr.trim(), recipient: rcpt.trim(), note: noteVal.trim() || null }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? d.message ?? '출고요청 생성에 실패했습니다.'); return }
    onDone({ sorCode: d.sorCode, requestId: d.requestId, itemCount: d.itemCount })
  }

  const label = 'text-xs font-medium text-gray-500'
  const inputCls = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="as-stock-out-modal">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900">출고요청 — {receipt.asCode}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">✕</button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-gray-500">판매용 재고 · 목적 &lsquo;분실기기 제공&rsquo; · 납품처 {receipt.hospitalName ?? '접수 병원'}으로 출고업무 티켓을 만듭니다. 센서류는 자재담당자가 출고 시 추가하고, 출고가 완료되면 교체기 시리얼이 이 접수에 자동 기입됩니다.</p>
        <div className="mb-3 rounded-md border border-teal-200 bg-teal-50/50 px-3 py-2 text-sm text-teal-900" data-testid="as-stock-out-summary">
          <span className="font-medium">{items.length}대</span>{groups.length ? ` — ${groups.map(([g, n]) => `${g} ${n}대`).join(' · ')}` : ' — 기기를 선택하세요'}
        </div>
        <div className="mb-3 max-h-48 overflow-y-auto rounded-md border border-gray-200" data-testid="as-stock-out-candidates">
          {Array.from(candidates.reduce((m, c) => m.set(c.deviceGroup, [...(m.get(c.deviceGroup) ?? []), c]), new Map<string, AsStockOutLine[]>())).map(([g, list]) => (
            <div key={g} className="border-b border-gray-100 last:border-b-0">
              <p className="bg-gray-50 px-3 py-1 text-[11px] font-medium text-gray-500">{g} {list.length}대</p>
              {list.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50" data-testid={`so-req-line-${c.serialNo}`}>
                  <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n })} className="rounded border-gray-300" />
                  <span className="font-mono text-gray-800">{c.serialNo}</span>
                  {c.wardName && <span className="text-xs text-gray-400">{c.wardName}</span>}
                </label>
              ))}
            </div>
          ))}
        </div>
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>희망 출고일 *</label>
              <input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} className={inputCls} data-testid="so-req-date" />
            </div>
            <div>
              <label className={label}>수취인 *</label>
              <input value={rcpt} maxLength={100} onChange={(e) => setRecipient(e.target.value)} placeholder="이름 / 연락처" className={inputCls} data-testid="so-req-recipient" />
            </div>
          </div>
          <div>
            <label className={label}>수령지 *</label>
            <textarea rows={2} value={addr} maxLength={500} onChange={(e) => setShipAddress(e.target.value)} placeholder="받을 주소" className={inputCls} data-testid="so-req-address" />
          </div>
          <div>
            <label className={label}>비고</label>
            <textarea rows={2} value={noteVal} maxLength={2000} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
          <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-teal-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50" data-testid="so-req-submit">{busy ? '생성 중…' : '출고요청 생성'}</button>
        </div>
      </div>
    </div>
  )
}
