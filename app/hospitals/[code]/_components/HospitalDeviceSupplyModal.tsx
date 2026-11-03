'use client'

/**
 * 비계약 공급 수량(대웅 직판) 입력 모달 — 병원 상세 '도입 현황' 카드의 공급 관리 기기 행 연필(✎)에서 연다.
 * (projects/third_party_supply_design.md §5.2) 저장·삭제 후 router.refresh()로 서버 컴포넌트 카드가 재계산된다.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'

export interface SupplyEditTarget {
  deviceInfoId: number
  deviceName: string
  deviceModel: string
  supplier: string
  current: { quantity: number; checkedOn: string | null; note: string | null } | null
}

function todayKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export default function HospitalDeviceSupplyModal({ hospitalCode, target }: { hospitalCode: string; target: SupplyEditTarget }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [checkedOn, setCheckedOn] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/hospitals/${encodeURIComponent(hospitalCode)}/device-supplies/${target.deviceInfoId}`

  function show() {
    setQuantity(target.current ? String(target.current.quantity) : '')
    setCheckedOn(target.current?.checkedOn ?? todayKst())
    setNote(target.current?.note ?? '')
    setError(null)
    setOpen(true)
  }

  async function save() {
    const q = Number(quantity)
    if (!Number.isInteger(q) || q < 0) { setError('수량은 0 이상의 정수로 입력하세요.'); return }
    setBusy(true); setError(null)
    const res = await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: q, checkedOn: checkedOn || null, note }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? '저장에 실패했습니다.'); return }
    setOpen(false)
    router.refresh()
  }

  async function remove() {
    if (!target.current) return
    if (!confirm(`${target.deviceName} 공급 수량 행을 삭제할까요? (파악 안 됨 상태로 돌아갑니다)`)) return
    setBusy(true); setError(null)
    const res = await fetch(base, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? '삭제에 실패했습니다.'); return }
    setOpen(false)
    router.refresh()
  }

  const input = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none'
  const label = 'mb-1 block text-xs font-medium text-gray-500'

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="ml-1.5 inline-flex items-center rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
        title={target.current ? '공급 수량 수정' : '공급 수량 입력'}
        aria-label={`${target.deviceName} 공급 수량 ${target.current ? '수정' : '입력'}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-800">공급 수량 — {target.deviceName} <span className="ml-1 font-mono text-xs font-normal text-gray-400">{target.deviceModel}</span></h3>
            <p className="mt-1 text-xs text-gray-500">우리가 계약하지 않고 {target.supplier}이 병원에 직접 판 수량입니다. 도입 현황 &lsquo;계약/공급&rsquo; 열의 기대치로 쓰여 원장 배치 수와 비교됩니다.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className={label}>수량 (대) <span className="text-red-500">*</span></label>
                <input type="number" min={0} className={input} value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
              </div>
              <div>
                <label className={label}>파악일</label>
                <input type="date" className={input} value={checkedOn} onChange={(e) => setCheckedOn(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className={label}>비고</label>
                <input className={input} placeholder="예: 2차 추가분 포함, 대웅 ○○○ 자료" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">0 = 확인했는데 없음 · 행 삭제 = 파악 안 됨</p>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex items-center justify-between gap-2">
              <div>
                {target.current && (
                  <button type="button" onClick={remove} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">행 삭제</button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
                <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? '저장 중…' : '저장'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
