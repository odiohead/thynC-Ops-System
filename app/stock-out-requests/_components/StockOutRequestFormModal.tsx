'use client'

/**
 * 출고요청 등록·수정 모달 (stock_out_request_design.md §8)
 * 프로젝트는 읽기 전용(프로젝트 상세에서 진입 — 생성 진입점 한정, §2 파생 결정).
 * 품목은 그룹(시스템/웨어러블 디바이스)별 수량 입력 그리드 — 빈 값/0 = 미요청.
 */
import { useState, useEffect, useMemo } from 'react'

export interface StockOutItemOpt {
  id: number
  name: string
  itemGroup: 'SYSTEM' | 'WEARABLE'
  isActive: boolean
}

export interface StockOutEditTarget {
  id: number
  sorCode: string
  requestDate: string // YYYY-MM-DD
  note: string | null
  items: { itemId: number; quantity: number }[]
}

const GROUP_LABELS: Record<string, string> = { SYSTEM: '시스템', WEARABLE: '웨어러블 디바이스' }

function todayKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export default function StockOutRequestFormModal({
  open,
  onClose,
  onSaved,
  project,
  editTarget,
}: {
  open: boolean
  onClose: () => void
  /** 저장 성공 콜백 — 호출부가 목록 갱신·router.refresh 담당 */
  onSaved: () => void
  project: { projectCode: string; projectName: string; hospitalName?: string | null }
  /** 지정 시 수정 모드 (PUT), 미지정이면 등록 (POST) */
  editTarget?: StockOutEditTarget | null
}) {
  const [items, setItems] = useState<StockOutItemOpt[]>([])
  const [qty, setQty] = useState<Record<number, string>>({})
  const [requestDate, setRequestDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    fetch('/api/settings/stock-out-items')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const all: StockOutItemOpt[] = d?.items ?? []
        // 활성 품목만 노출 — 단, 수정 대상에 이미 담긴 비활성 품목은 유지
        const keep = new Set((editTarget?.items ?? []).map((l) => l.itemId))
        setItems(all.filter((i) => i.isActive || keep.has(i.id)))
      })
    if (editTarget) {
      setRequestDate(editTarget.requestDate)
      setNote(editTarget.note ?? '')
      const map: Record<number, string> = {}
      editTarget.items.forEach((l) => { map[l.itemId] = String(l.quantity) })
      setQty(map)
    } else {
      setRequestDate(todayKst())
      setNote('')
      setQty({})
    }
  }, [open, editTarget])

  const groups = useMemo(() => {
    const g: Record<string, StockOutItemOpt[]> = {}
    for (const it of items) (g[it.itemGroup] ??= []).push(it)
    return (['SYSTEM', 'WEARABLE'] as const).filter((k) => g[k]?.length).map((k) => ({ key: k, label: GROUP_LABELS[k], items: g[k] }))
  }, [items])

  const lines = useMemo(
    () =>
      items
        .map((it) => ({ itemId: it.id, quantity: parseInt(qty[it.id] ?? '') || 0 }))
        .filter((l) => l.quantity > 0),
    [items, qty]
  )
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0)

  async function submit() {
    if (!requestDate) { setError('희망 출고일을 입력하세요.'); return }
    if (lines.length === 0) { setError('출고 품목 수량을 1개 이상 입력하세요.'); return }
    setBusy(true)
    setError(null)
    const payload = { requestDate, note: note || null, items: lines }
    const res = editTarget
      ? await fetch(`/api/stock-out-requests/${editTarget.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/stock-out-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, projectCode: project.projectCode }),
        })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? '저장에 실패했습니다.'); return }
    onSaved()
    onClose()
  }

  if (!open) return null

  const label = 'text-xs font-medium text-gray-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{editTarget ? `출고요청 수정 — ${editTarget.sorCode}` : '출고요청'}</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {project.projectName}
              {project.hospitalName && <span className="ml-1.5 text-gray-400">· {project.hospitalName}</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">✕</button>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className={label}>희망 출고일 *</label>
            <input
              type="date"
              value={requestDate}
              onChange={(e) => setRequestDate(e.target.value)}
              className="mt-1 w-44 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className={label}>출고 품목별 수량 *</label>
              <span className="text-xs text-gray-400">{lines.length}종 · 총 {totalQty}개</span>
            </div>
            {items.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">등록된 출고 품목이 없습니다. 설정 &gt; 출고 품목 관리에서 추가하세요.</p>
            ) : (
              <div className="mt-1.5 space-y-3">
                {groups.map((g) => (
                  <div key={g.key} className="rounded-lg border border-gray-200">
                    <p className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600">{g.label}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5 sm:grid-cols-2">
                      {g.items.map((it) => (
                        <div key={it.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-sm text-gray-800">{it.name}</span>
                          <input
                            type="number"
                            min="0"
                            value={qty[it.id] ?? ''}
                            onChange={(e) => setQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                            placeholder="0"
                            className="w-16 shrink-0 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className={label}>비고</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="배송·수령 관련 요청사항 등"
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? '저장 중...' : editTarget ? '수정 저장' : '출고요청 생성'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
