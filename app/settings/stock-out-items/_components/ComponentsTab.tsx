'use client'

/**
 * 출고 품목 관리 — '구성' 탭 (projects/stock_out_v2_design.md §14 — 2026-11-12 개편)
 * 시스템(thynC시스템 XX) × 구성품 종류 표에서 **수량만** 수정한다. 구성품 종류와 시스템 목록은 고정(추가·삭제 없음 — 종류 등록은 시드 스크립트).
 * 수량 0 = 그 시스템에 미포함. 출고요청 팝업의 '시스템 구성품' 합계와 출고 처리의 구성품 출고 수량이 이 값에서 나온다. ADMIN만 편집.
 */
import { useState, useEffect, useCallback } from 'react'

interface Kind { itemId: number; itemCode: string; name: string; modelName: string | null; inventoryName: string; sourceItemCode: string; sourceInventoryName: string }
interface ParentRow { parent: { id: number; itemCode: string; name: string; inventory: { id: number; name: string } }; quantities: Record<number, number> }

export default function ComponentsTab({ canEdit, onChanged }: { canEdit: boolean; onChanged?: () => void }) {
  const [kinds, setKinds] = useState<Kind[]>([])
  const [parents, setParents] = useState<ParentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 입력 중인 값 — `${parentId}:${kindId}` → 문자열 (저장되면 지움)
  const [draft, setDraft] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/stock-out-components', { cache: 'no-store' })
    if (res.ok) {
      const d = await res.json()
      setKinds(d.kinds ?? [])
      setParents(d.parents ?? [])
    } else setError('구성을 불러오지 못했습니다.')
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  function flash(msg: string) { setError(msg); setTimeout(() => setError(null), 5000) }
  const clearDraft = (key: string) => setDraft((d) => { const n = { ...d }; delete n[key]; return n })

  async function save(parentId: number, kindId: number) {
    const key = `${parentId}:${kindId}`
    const raw = draft[key]
    if (raw === undefined) return
    const cur = parents.find((p) => p.parent.id === parentId)?.quantities[kindId] ?? 0
    const q = raw.trim() === '' ? 0 : Number(raw)
    if (!Number.isInteger(q) || q < 0) { flash('수량은 0 이상의 정수로 입력하세요. (0 = 미포함)'); clearDraft(key); return }
    if (q === cur) { clearDraft(key); return }
    setBusy(true); setError(null)
    const res = await fetch('/api/settings/stock-out-components', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentItemId: parentId, childItemId: kindId, quantity: q }) })
    setBusy(false)
    if (!res.ok) { flash((await res.json().catch(() => ({}))).error ?? '저장에 실패했습니다.'); clearDraft(key); return }
    setParents((prev) => prev.map((p) => (p.parent.id === parentId ? { ...p, quantities: { ...p.quantities, [kindId]: q } } : p)))
    clearDraft(key)
    onChanged?.()
  }

  const th = 'whitespace-nowrap px-3 py-2 text-xs font-medium text-gray-500'
  return (
    <div className="mt-4">
      <p className="text-sm text-gray-500">
        시스템 1개에 포함되는 구성품 수량입니다. <b className="font-medium text-gray-700">구성품 종류는 고정</b>이고 여기서는 수량만 바꿉니다(0 = 미포함).
        출고요청 팝업은 입력한 시스템 수량으로 구성품 합계를 계산해 보여 주고, 출고 처리에서는 그 합계만큼 대웅제약재고의 구성품을 출고합니다(신청자가 적은 미출고분은 thynC운영팀재고로 편입).
      </p>
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {loading ? (
        <p className="py-12 text-center text-sm text-gray-400">불러오는 중...</p>
      ) : kinds.length === 0 ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">등록된 구성품 종류가 없습니다. <code className="font-mono text-xs">scripts/seed-stock-out-component-kinds.sql</code>을 실행하면 현재 구성 설정의 구성품을 대웅제약재고에 복제하고 종류로 등록합니다.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm" data-testid="so-components-matrix">
            <thead className="bg-gray-50">
              <tr>
                <th className={`${th} text-left`}>시스템</th>
                {kinds.map((k) => (
                  <th key={k.itemId} className={`${th} text-right`} title={`${k.inventoryName} ${k.itemCode} — 미출고분 편입: ${k.sourceInventoryName} ${k.sourceItemCode}`}>
                    {k.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {parents.map((p) => (
                <tr key={p.parent.id}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{p.parent.name} <span className="ml-1 text-xs font-normal text-gray-400">{p.parent.inventory.name}</span></td>
                  {kinds.map((k) => {
                    const key = `${p.parent.id}:${k.itemId}`
                    const cur = p.quantities[k.itemId] ?? 0
                    return (
                      <td key={k.itemId} className="px-3 py-1.5 text-right">
                        {canEdit ? (
                          <input
                            type="number" min="0"
                            value={draft[key] ?? String(cur)}
                            disabled={busy}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                            onBlur={() => void save(p.parent.id, k.itemId)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            aria-label={`${p.parent.name} ${k.name} 수량`}
                            className={`w-16 rounded-md border px-2 py-1 text-right text-sm ${cur === 0 && draft[key] === undefined ? 'border-gray-200 text-gray-400' : 'border-gray-300 text-gray-900'}`}
                          />
                        ) : (
                          <span className={cur === 0 ? 'text-gray-300' : 'font-medium text-gray-900'}>{cur}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && kinds.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">칸을 벗어나거나 Enter를 누르면 저장됩니다. 구성품 품목은 대웅제약재고에 등록된 품목이며, 재고는 자재관리에서 입고해야 출고 처리가 됩니다.</p>
      )}
    </div>
  )
}
