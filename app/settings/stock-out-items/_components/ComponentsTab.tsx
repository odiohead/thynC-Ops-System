'use client'

/**
 * 출고 품목 관리 — '구성 안내' 탭 (projects/stock_out_v2_design.md §14)
 * 주 품목(예: 대웅제약재고 thynC 시스템 XX) 1개당 부자재(예: 운영팀재고) 포함 수량을 편집. 출고요청 팝업의 '포함 n' 배지 소스.
 * 인벤토리 제한 없음·재고 처리와 무관(안내 전용). ADMIN만 편집.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'

interface ItemRef { id: number; itemCode: string; name: string; modelName: string | null; isActive: boolean; inventory: { id: number; name: string } }
interface ParentGroup { parent: ItemRef; children: { item: ItemRef; quantity: number; sortOrder: number }[] }
interface PickItem { id: number; name: string; modelName: string | null; inventoryName: string }

export default function ComponentsTab({ canEdit, allItems, onChanged }: {
  canEdit: boolean
  /** 선택 후보 — 설정 GET의 인벤토리별 활성 품목 */
  allItems: PickItem[]
  onChanged?: () => void
}) {
  const [parents, setParents] = useState<ParentGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newParent, setNewParent] = useState('')
  const [newChild, setNewChild] = useState('')
  const [newQty, setNewQty] = useState('1')
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/stock-out-components')
    if (res.ok) {
      const d = await res.json()
      const list: ParentGroup[] = d.parents ?? []
      setParents(list)
      setSelected((cur) => (cur && list.some((p) => p.parent.id === cur) ? cur : list[0]?.parent.id ?? null))
    } else setError('구성을 불러오지 못했습니다.')
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  function flash(msg: string) { setError(msg); setTimeout(() => setError(null), 5000) }
  const current = parents.find((p) => p.parent.id === selected) ?? null
  const parentIds = useMemo(() => new Set(parents.map((p) => p.parent.id)), [parents])
  const childIdsAll = useMemo(() => new Set(parents.flatMap((p) => p.children.map((c) => c.item.id))), [parents])
  const pickLabel = (it: PickItem) => `${it.inventoryName} / ${it.name}${it.modelName && it.modelName !== it.name ? ` (${it.modelName})` : ''}`

  async function upsert(parentItemId: number, childItemId: number, quantity: number) {
    setBusy(true); setError(null)
    const res = await fetch('/api/settings/stock-out-components', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentItemId, childItemId, quantity }) })
    setBusy(false)
    if (!res.ok) { flash((await res.json().catch(() => ({}))).error ?? '저장에 실패했습니다.'); return false }
    await load(); onChanged?.()
    return true
  }
  async function remove(parentItemId: number, childItemId?: number) {
    const q = new URLSearchParams({ parentItemId: String(parentItemId) }); if (childItemId !== undefined) q.set('childItemId', String(childItemId))
    setBusy(true); setError(null)
    const res = await fetch(`/api/settings/stock-out-components?${q}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { flash((await res.json().catch(() => ({}))).error ?? '삭제에 실패했습니다.'); return }
    await load(); onChanged?.()
  }

  /** 주 품목 추가 = 첫 구성품과 함께 등록 (행 없는 주 품목은 존재하지 않음) */
  async function addParent() {
    const pid = Number(newParent); if (!pid) return
    setSelected(pid)
    setNewParent('')
    if (!parentIds.has(pid)) setParents((prev) => [...prev, { parent: { ...(allItems.find((i) => i.id === pid) as PickItem), itemCode: '', isActive: true, inventory: { id: 0, name: allItems.find((i) => i.id === pid)?.inventoryName ?? '' } } as ItemRef, children: [] }])
  }
  async function addChild() {
    if (!current) return
    const cid = Number(newChild); const qty = parseInt(newQty) || 0
    if (!cid) { flash('구성품 품목을 선택하세요.'); return }
    if (qty <= 0) { flash('포함 수량은 1 이상이어야 합니다.'); return }
    if (await upsert(current.parent.id, cid, qty)) { setNewChild(''); setNewQty('1') }
  }
  async function saveQty(childId: number) {
    if (!current) return
    const q = parseInt(qtyDraft[childId] ?? ''); const cur = current.children.find((c) => c.item.id === childId)
    if (!cur || !Number.isInteger(q) || q <= 0 || q === cur.quantity) { setQtyDraft((d) => { const n = { ...d }; delete n[childId]; return n }); return }
    if (await upsert(current.parent.id, childId, q)) setQtyDraft((d) => { const n = { ...d }; delete n[childId]; return n })
  }

  const input = 'rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'
  const parentCandidates = allItems.filter((i) => !parentIds.has(i.id) && !childIdsAll.has(i.id))
  const childCandidates = current ? allItems.filter((i) => i.id !== current.parent.id && !parentIds.has(i.id) && !current.children.some((c) => c.item.id === i.id)) : []

  return (
    <div className="mt-4">
      <p className="text-sm text-gray-500">주 품목 1개에 포함되는 구성품과 수량입니다. 출고요청 팝업에서 주 품목 수량을 적으면 구성품 행에 <span className="rounded bg-amber-50 px-1 text-[11px] font-medium text-amber-700">포함 n</span>으로 안내됩니다. 재고 처리와는 무관합니다.</p>
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {loading ? (
        <p className="py-12 text-center text-sm text-gray-400">불러오는 중...</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[18rem_1fr]">
          {/* 주 품목 목록 */}
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">주 품목 <span className="font-normal text-gray-400">{parents.length}</span></div>
            <ul className="divide-y divide-gray-100">
              {parents.map((p) => (
                <li key={p.parent.id}>
                  <button type="button" onClick={() => setSelected(p.parent.id)} className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${selected === p.parent.id ? 'bg-blue-50 text-blue-800' : 'text-gray-800'}`}>
                    <span className="min-w-0 truncate">{p.parent.name}<span className="ml-1 text-[11px] text-gray-400">{p.parent.inventory.name}</span></span>
                    <span className="ml-2 shrink-0 text-xs text-gray-400">{p.children.length}종</span>
                  </button>
                </li>
              ))}
              {parents.length === 0 && <li className="px-3 py-6 text-center text-xs text-gray-400">등록된 구성이 없습니다</li>}
            </ul>
            {canEdit && (
              <div className="border-t border-gray-200 p-2">
                <div className="flex gap-1.5">
                  <select value={newParent} onChange={(e) => setNewParent(e.target.value)} className={`${input} min-w-0 flex-1`}>
                    <option value="">+ 주 품목 추가…</option>
                    {parentCandidates.map((i) => <option key={i.id} value={i.id}>{pickLabel(i)}</option>)}
                  </select>
                  <button type="button" onClick={() => void addParent()} disabled={!newParent || busy} className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50">추가</button>
                </div>
              </div>
            )}
          </section>

          {/* 선택 주 품목의 구성품 */}
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {!current ? (
              <p className="py-12 text-center text-sm text-gray-400">왼쪽에서 주 품목을 선택하거나 추가하세요.</p>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-gray-800">{current.parent.name} <span className="ml-1 font-normal text-gray-400">{current.parent.inventory.name}{current.parent.modelName && current.parent.modelName !== current.parent.name ? ` · ${current.parent.modelName}` : ''}</span></h3>
                  {canEdit && current.children.length > 0 && (
                    <button type="button" disabled={busy} onClick={() => { if (confirm(`'${current.parent.name}'의 구성 ${current.children.length}행을 모두 삭제할까요?`)) void remove(current.parent.id) }} className="rounded-md border border-red-200 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50">구성 전체 삭제</button>
                  )}
                </div>
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead><tr>
                    {['인벤토리', '구성품', '모델', '1개당 포함 수량', ''].map((h, i) => <th key={i} className={`whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {current.children.map((c) => (
                      <tr key={c.item.id} className={c.item.isActive ? '' : 'text-gray-400'}>
                        <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500">{c.item.inventory.name}</td>
                        <td className="px-3 py-1.5">{c.item.name}{!c.item.isActive && <span className="ml-1 text-[11px]">(비활성)</span>}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-500">{c.item.modelName ?? '-'}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {canEdit ? (
                            <input type="number" min="1" value={qtyDraft[c.item.id] ?? String(c.quantity)} disabled={busy}
                              onChange={(e) => setQtyDraft((d) => ({ ...d, [c.item.id]: e.target.value }))}
                              onBlur={() => void saveQty(c.item.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              className={`${input} w-20 text-right`} />
                          ) : c.quantity}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {canEdit && <button type="button" disabled={busy} onClick={() => void remove(current.parent.id, c.item.id)} className="text-xs text-red-400 hover:text-red-600">삭제</button>}
                        </td>
                      </tr>
                    ))}
                    {current.children.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-gray-400">구성품이 없습니다. 아래에서 추가하세요. (구성품이 하나도 없으면 주 품목도 목록에서 사라집니다)</td></tr>}
                  </tbody>
                </table>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 p-3">
                    <select value={newChild} onChange={(e) => setNewChild(e.target.value)} className={`${input} min-w-0 flex-1`}>
                      <option value="">구성품 품목 선택…</option>
                      {childCandidates.map((i) => <option key={i.id} value={i.id}>{pickLabel(i)}</option>)}
                    </select>
                    <input type="number" min="1" value={newQty} onChange={(e) => setNewQty(e.target.value)} className={`${input} w-20 text-right`} placeholder="수량" />
                    <button type="button" onClick={() => void addChild()} disabled={busy || !newChild} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">+ 구성품 추가</button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
