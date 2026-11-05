'use client'

/**
 * 출고 품목 노출 설정 (projects/stock_out_v2_design.md §7 — ADMIN 이상 쓰기)
 * 품목 소스 = 자재관리 품목(인벤토리×품목 행). 업무 탭(구축/유지보수/사업업무 + 영업 유형 평가용/판매용/오산영업소 — 2026-11-05)마다 전체 활성 품목을 보여 주고
 * 행별 '노출' 체크로 그 업무의 출고요청 폼에 보일지 정한다. 체크 = "이 업무는 이 인벤토리에서 이 품목을 출고".
 */
import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { STOCK_OUT_PURPOSES, STOCK_OUT_PURPOSE_LABELS, isStockOutPurpose, isStockOutSalesType, type StockOutPurpose } from '@/lib/stockOutShared'
import ComponentsTab from './_components/ComponentsTab'
import GuidesTab from './_components/GuidesTab'

const COMPONENTS_TAB = 'COMPONENTS' as const
const GUIDES_TAB = 'GUIDES' as const
type Tab = StockOutPurpose | typeof COMPONENTS_TAB | typeof GUIDES_TAB

interface ItemRow {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  categoryName: string | null
  isSerialManaged: boolean
  isLotManaged: boolean
  stockTotal: number
  purposes: string[]
}
interface InventoryGroup { id: number; name: string; items: ItemRow[] }

function StockOutItemsSettingsInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const tabParam = sp.get('tab')
  const tab: Tab = tabParam === COMPONENTS_TAB ? COMPONENTS_TAB : tabParam === GUIDES_TAB ? GUIDES_TAB : isStockOutPurpose(tabParam) ? tabParam : 'BUILD'
  const purposeTab: StockOutPurpose = tab === COMPONENTS_TAB || tab === GUIDES_TAB ? 'BUILD' : tab

  const [groups, setGroups] = useState<InventoryGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/stock-out-items')
    if (res.ok) setGroups((await res.json()).inventories ?? [])
    else setError('품목을 불러오지 못했습니다.')
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setCanEdit(d.role === 'ADMIN' || d.role === 'SUPER_ADMIN')).catch(() => {})
  }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of STOCK_OUT_PURPOSES) c[p] = 0
    for (const g of groups) for (const it of g.items) for (const p of it.purposes) c[p] = (c[p] ?? 0) + 1
    return c
  }, [groups])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return groups
    return groups
      .map((g) => ({ ...g, items: g.items.filter((it) => [it.name, it.modelName ?? '', it.itemCode, it.categoryName ?? ''].some((v) => v.toLowerCase().includes(needle))) }))
      .filter((g) => g.items.length > 0)
  }, [groups, q])

  function flash(msg: string) { setError(msg); setTimeout(() => setError(null), 5000) }

  /** 체크 토글 — 낙관적 갱신, 실패 시 되돌림 */
  async function toggle(itemId: number, enabled: boolean) {
    if (!canEdit) return
    const apply = (on: boolean) => setGroups((prev) => prev.map((g) => ({
      ...g,
      items: g.items.map((it) => it.id !== itemId ? it : { ...it, purposes: on ? Array.from(new Set([...it.purposes, purposeTab])) : it.purposes.filter((p) => p !== purposeTab) }),
    })))
    apply(enabled)
    setBusyIds((s) => new Set(s).add(itemId))
    const res = await fetch(`/api/settings/stock-out-items/${itemId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: purposeTab, enabled }),
    })
    setBusyIds((s) => { const n = new Set(s); n.delete(itemId); return n })
    if (!res.ok) { apply(!enabled); flash((await res.json().catch(() => ({}))).error ?? '저장에 실패했습니다.'); return }
    router.refresh()
  }

  /** 인벤토리 섹션 전체 선택/해제 — 순차 호출(실패 행만 되돌림) */
  async function toggleAll(g: InventoryGroup, enabled: boolean) {
    const targets = g.items.filter((it) => it.purposes.includes(purposeTab) !== enabled)
    for (const it of targets) await toggle(it.id, enabled)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-bold text-gray-900">출고 품목 관리</h1>
      <p className="mt-0.5 text-sm text-gray-500">
        자재관리 품목(인벤토리별) 중 각 업무의 출고요청에 노출할 품목을 체크합니다. 체크한 인벤토리에서 출고 처리됩니다.
        {!canEdit && <span className="ml-1 text-gray-400">(변경은 관리자만)</span>}
      </p>

      {/* 업무 탭 */}
      <div className="mt-4 flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200" role="tablist">
        {STOCK_OUT_PURPOSES.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={tab === p}
            onClick={() => router.push(`/settings/stock-out-items?tab=${p}`)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === p ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {STOCK_OUT_PURPOSE_LABELS[p]}
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${tab === p ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{counts[p] ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={tab === COMPONENTS_TAB}
          onClick={() => router.push(`/settings/stock-out-items?tab=${COMPONENTS_TAB}`)}
          className={`-mb-px ml-2 border-b-2 px-4 py-2 text-sm font-medium ${tab === COMPONENTS_TAB ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          구성 안내
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === GUIDES_TAB}
          onClick={() => router.push(`/settings/stock-out-items?tab=${GUIDES_TAB}`)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === GUIDES_TAB ? 'border-violet-500 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          입력 가이드
        </button>
        <div className="ml-auto pb-1.5">
          {tab !== COMPONENTS_TAB && tab !== GUIDES_TAB && <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목·모델·분류 검색" className="w-52 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />}
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {isStockOutSalesType(tab) && (
        <p className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-800">
          출고요청(모바일 앱·PC 출고업무) &lsquo;{STOCK_OUT_PURPOSE_LABELS[tab]}&rsquo; 유형에 보일 품목을 체크합니다. 체크한 품목의 인벤토리에서 출고됩니다
          (예: {STOCK_OUT_PURPOSE_LABELS[tab]} 재고 품목 + thynC운영팀재고의 배터리·에바폼).
        </p>
      )}

      {tab === GUIDES_TAB ? (
        <GuidesTab canEdit={canEdit} />
      ) : tab === COMPONENTS_TAB ? (
        <ComponentsTab canEdit={canEdit} allItems={groups.flatMap((g) => g.items.map((it) => ({ id: it.id, name: it.name, modelName: it.modelName, inventoryName: g.name })))} />
      ) : loading ? (
        <p className="py-12 text-center text-sm text-gray-400">불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">표시할 자재관리 품목이 없습니다.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {filtered.map((g) => {
            const checked = g.items.filter((it) => it.purposes.includes(purposeTab)).length
            return (
              <section key={g.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
                  <h2 className="text-sm font-semibold text-gray-800">{g.name} <span className="ml-1 font-normal text-gray-400">{checked} / {g.items.length} 노출</span></h2>
                  {canEdit && (
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => void toggleAll(g, true)} className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100">전체 선택</button>
                      <button type="button" onClick={() => void toggleAll(g, false)} className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100">전체 해제</button>
                    </div>
                  )}
                </div>
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead className="bg-white">
                    <tr>
                      {['노출', '품목코드', '품목명', '모델', '분류', '관리', '현재고'].map((h, i) => (
                        <th key={h} className={`whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 ${i === 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {g.items.map((it) => {
                      const on = it.purposes.includes(purposeTab)
                      return (
                        <tr key={it.id} className={on ? 'bg-blue-50/40' : ''}>
                          <td className="px-3 py-1.5">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!canEdit || busyIds.has(it.id)}
                              onChange={(e) => void toggle(it.id, e.target.checked)}
                              aria-label={`${g.name} ${it.name} ${STOCK_OUT_PURPOSE_LABELS[purposeTab]} 노출`}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600"
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-500">{it.itemCode}</td>
                          <td className="px-3 py-1.5 text-gray-900">{it.name}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-600">{it.modelName ?? '-'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500">{it.categoryName ?? '-'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500">{it.isSerialManaged ? '시리얼' : it.isLotManaged ? 'LOT' : '수량'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs text-gray-600">{it.stockTotal.toLocaleString()}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

// useSearchParams 사용 컴포넌트는 Suspense 경계 필요 (Next.js App Router — 프리렌더 오류 방지)
export default function StockOutItemsSettingsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-4 py-6 sm:px-6"><p className="text-sm text-gray-400">불러오는 중...</p></div>}>
      <StockOutItemsSettingsInner />
    </Suspense>
  )
}
