'use client'

/**
 * 출고요청 등록·수정 모달 (stock_out_request_design.md §8 · v2 stock_out_v2_design.md §7)
 * 프로젝트는 읽기 전용(프로젝트 상세에서 진입 — 생성 진입점 한정, §2 파생 결정).
 * 품목 = 자재관리 품목 중 해당 업무(이번 범위: 구축 BUILD)에 노출된 것 — 인벤토리 → 분류 순 섹션(품목명만, 모델명 미표시 — 2026-11-01), 빈 값/0 = 미요청.
 * 구성 안내 (2026-11-01): 주 품목(thynC 시스템 XX) 수량을 적으면 그 구성에 포함된 부자재(운영팀재고) 행의 수량 입력란 왼쪽에 '포함 n'을 표시
 * (재고 처리와 무관한 안내 — 사용자가 추가로 적는 수량만 요청됨).
 */
import { useState, useEffect, useMemo } from 'react'
import { STOCK_OUT_PURPOSE_LABELS, type StockOutPurpose } from '@/lib/stockOutShared'

export interface StockOutItemOpt {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  categoryName: string | null
  stockTotal: number
  inventoryId: number
  inventoryName: string
  components?: { childItemId: number; childName: string; quantity: number }[]
}

export interface StockOutEditTarget {
  id: number
  sorCode: string
  requestDate: string // YYYY-MM-DD
  note: string | null
  purpose: StockOutPurpose
  /** 이미 담긴 라인 — 노출 해제된 품목도 폼에 유지하기 위해 표시용 정보 동반 */
  items: { inventoryItemId: number; quantity: number; name?: string; modelName?: string | null; inventoryId?: number; inventoryName?: string; categoryName?: string | null }[]
}

function todayKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export default function StockOutRequestFormModal({
  open,
  onClose,
  onSaved,
  project,
  editTarget,
  purpose = 'BUILD',
}: {
  open: boolean
  onClose: () => void
  /** 저장 성공 콜백 — 호출부가 목록 갱신·router.refresh 담당 */
  onSaved: () => void
  project: { projectCode: string; projectName: string; hospitalName?: string | null }
  /** 지정 시 수정 모드 (PUT), 미지정이면 등록 (POST) */
  editTarget?: StockOutEditTarget | null
  /** 업무 구분 — 이번 범위는 프로젝트 팝업 = 구축 */
  purpose?: StockOutPurpose
}) {
  const effPurpose = editTarget?.purpose ?? purpose
  const [items, setItems] = useState<StockOutItemOpt[]>([])
  const [loaded, setLoaded] = useState(false)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [requestDate, setRequestDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoaded(false)
    fetch(`/api/settings/stock-out-items?purpose=${effPurpose}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: StockOutItemOpt[] = []
        for (const g of (d?.inventories ?? []) as { id: number; name: string; items: Omit<StockOutItemOpt, 'inventoryId' | 'inventoryName'>[] }[]) {
          for (const it of g.items) list.push({ ...it, inventoryId: g.id, inventoryName: g.name })
        }
        // 수정 대상에 이미 담긴 품목이 노출 해제됐어도 유지 (현행 비활성 품목 처리와 동일)
        for (const l of editTarget?.items ?? []) {
          if (!list.some((x) => x.id === l.inventoryItemId)) {
            list.push({ id: l.inventoryItemId, itemCode: '', name: l.name ?? `품목 #${l.inventoryItemId}`, modelName: l.modelName ?? null, categoryName: l.categoryName ?? null, stockTotal: 0, inventoryId: l.inventoryId ?? 0, inventoryName: l.inventoryName ?? '(노출 해제됨)' })
          }
        }
        setItems(list)
        setLoaded(true)
      })
    if (editTarget) {
      setRequestDate(editTarget.requestDate)
      setNote(editTarget.note ?? '')
      const map: Record<number, string> = {}
      editTarget.items.forEach((l) => { map[l.inventoryItemId] = String(l.quantity) })
      setQty(map)
    } else {
      setRequestDate(todayKst())
      setNote('')
      setQty({})
    }
  }, [open, editTarget, effPurpose])

  /** 인벤토리 → 분류 순 섹션 */
  const sections = useMemo(() => {
    const byInv = new Map<number, { name: string; cats: Map<string, StockOutItemOpt[]> }>()
    for (const it of items) {
      const inv = byInv.get(it.inventoryId) ?? { name: it.inventoryName, cats: new Map() }
      const key = it.categoryName ?? '기타'
      inv.cats.set(key, [...(inv.cats.get(key) ?? []), it])
      byInv.set(it.inventoryId, inv)
    }
    return Array.from(byInv.entries()).map(([id, v]) => ({ id, name: v.name, cats: Array.from(v.cats.entries()).map(([cat, list]) => ({ cat, list })) }))
  }, [items])

  const lines = useMemo(
    () => items.map((it) => ({ inventoryItemId: it.id, quantity: parseInt(qty[it.id] ?? '') || 0 })).filter((l) => l.quantity > 0),
    [items, qty]
  )
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0)

  /** 구성 포함 수량 — childId → { total, sources[] } (주 품목 입력 수량 × 구성 수량 합) */
  const included = useMemo(() => {
    const map = new Map<number, { total: number; sources: { name: string; qty: number }[] }>()
    for (const it of items) {
      const n = parseInt(qty[it.id] ?? '') || 0
      if (n <= 0 || !it.components?.length) continue
      for (const c of it.components) {
        const cur = map.get(c.childItemId) ?? { total: 0, sources: [] }
        cur.total += n * c.quantity
        cur.sources.push({ name: it.name, qty: n * c.quantity })
        map.set(c.childItemId, cur)
      }
    }
    return map
  }, [items, qty])

  async function submit() {
    if (!requestDate) { setError('희망 출고일을 입력하세요.'); return }
    if (lines.length === 0) { setError('출고 품목 수량을 1개 이상 입력하세요.'); return }
    setBusy(true)
    setError(null)
    const payload = { requestDate, note: note || null, items: lines }
    const res = editTarget
      ? await fetch(`/api/stock-out-requests/${editTarget.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/stock-out-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, projectCode: project.projectCode, purpose: effPurpose }) })
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
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{editTarget ? `출고요청 수정 — ${editTarget.sorCode}` : '출고요청'} <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">{STOCK_OUT_PURPOSE_LABELS[effPurpose]}</span></h2>
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
            <input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} className="mt-1 w-44 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className={label}>출고 품목별 수량 *</label>
              <span className="text-xs text-gray-400">{lines.length}종 · 총 {totalQty}개</span>
            </div>
            {!loaded ? (
              <p className="mt-2 text-sm text-gray-400">품목을 불러오는 중…</p>
            ) : items.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">{`'${STOCK_OUT_PURPOSE_LABELS[effPurpose]}' 출고에 노출된 품목이 없습니다. 설정 > 출고 품목 관리에서 지정하세요.`}</p>
            ) : (
              <div className="mt-1.5 space-y-3">
                {sections.map((inv) => (
                  <div key={inv.id} className="rounded-lg border border-gray-200">
                    <p className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">{inv.name}</p>
                    {inv.cats.map((c) => (
                      <div key={c.cat} className="border-b border-gray-100 px-3 py-2 last:border-b-0">
                        <p className="mb-1 text-[11px] font-medium text-gray-400">{c.cat}</p>
                        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                          {c.list.map((it) => (
                            <div key={it.id} className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-sm text-gray-800" title={it.name}>{it.name}</span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {included.get(it.id) && (
                                  <span
                                    className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
                                    title={included.get(it.id)!.sources.map((s) => `${s.name} → ${s.qty}`).join('\n')}
                                  >
                                    포함 {included.get(it.id)!.total}
                                  </span>
                                )}
                                <input
                                  type="number" min="0"
                                  value={qty[it.id] ?? ''}
                                  onChange={(e) => setQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                                  placeholder="0"
                                  className="w-16 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className={label}>비고</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="배송·수령 관련 요청사항 등" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
            <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? '저장 중...' : editTarget ? '수정 저장' : '출고요청 생성'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
