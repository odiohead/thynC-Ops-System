'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import TransactionModal, { ModalItem } from '../../components/TransactionModal'
import UnitEditModal from '../../components/UnitEditModal'

interface Item {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  spec: string | null
  unit: string
  isSerialManaged: boolean
  isLotManaged: boolean
  refPrice: number | null
  memo: string | null
  isActive: boolean
  inventoryId: number
  inventory: { id: number; name: string; linkHospital: boolean } | null
  category: { id: number; name: string } | null
  categoryPath: string
  manufacturer: { id: number; name: string } | null
  deviceInfo: { deviceName: string; deviceModel: string } | null
  stocks: { warehouseId: number; lotNo: string; quantity: number; warehouse: { name: string } }[]
  components: { childItemId: number; quantity: number; child: { id: number; itemCode: string; name: string; unit: string; isSerialManaged: boolean } }[]
  usedIn: { parentItemId: number; quantity: number; parent: { id: number; itemCode: string; name: string } }[]
}
interface Warehouse { id: number; name: string; isActive: boolean; inventoryId: number }
interface Tx {
  id: number; txCode: string; txType: string; quantity: number
  reasonCode: { name: string } | null
  destination: string | null
  canceledAt: string | null; createdAt: string
  warehouse: { name: string } | null; toWarehouse: { name: string } | null
  inventory: { name: string } | null; toInventory: { name: string } | null
  hospital: { hospitalName: string } | null; actor: { name: string } | null
  parentTx: { txCode: string } | null
}
interface Unit {
  id: number; serialNo: string; lotNo: string | null; status: string; memo: string | null; tags: string[]
  warehouse: { name: string } | null; hospital: { hospitalName: string } | null
}
interface CandidateItem { id: number; itemCode: string; name: string; isSerialManaged: boolean }

const TYPE_LABEL: Record<string, string> = { IN: '입고', OUT: '출고', MOVE: '이동', TRANSFER: '이관(구)' }
const UNIT_STATUS: Record<string, { label: string; cls: string }> = {
  IN_STOCK: { label: '재고', cls: 'bg-green-50 text-green-700' },
  OUT: { label: '출고', cls: 'bg-blue-50 text-blue-700' },
  DISPOSED: { label: '폐기', cls: 'bg-gray-100 text-gray-500' },
}

/** 품목 마스터 상세 — 기준정보·부자재 구성·재고 요약·이력 (품목은 인벤토리에 귀속) */
export default function ItemDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [item, setItem] = useState<Item | null>(null)
  const [total, setTotal] = useState(0)
  const [txs, setTxs] = useState<Tx[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [canManage, setCanManage] = useState(false)
  const [editUnit, setEditUnit] = useState<Unit | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [tab, setTab] = useState<'history' | 'units'>('history')
  const [modalOpen, setModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 부자재 추가 폼
  const [addingComp, setAddingComp] = useState(false)
  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [compChildId, setCompChildId] = useState<number | null>(null)
  const [compQty, setCompQty] = useState('1')
  const [compBusy, setCompBusy] = useState(false)

  const fetchAll = useCallback(async () => {
    const [iRes, tRes] = await Promise.all([
      fetch(`/api/inventory/items/${id}`),
      fetch(`/api/inventory/transactions?itemId=${id}&limit=100`),
    ])
    if (iRes.ok) { const d = await iRes.json(); setItem(d.item); setTotal(d.total) }
    if (tRes.ok) setTxs((await tRes.json()).data)
    setLoading(false)
  }, [id])

  const fetchUnits = useCallback(async () => {
    const res = await fetch(`/api/inventory/units?itemId=${id}`)
    if (res.ok) setUnits((await res.json()).units)
  }, [id])

  useEffect(() => {
    fetch('/api/settings/warehouses').then(async (r) => { if (r.ok) setWarehouses((await r.json()).warehouses) })
    fetch('/api/inventory/can-manage').then(async (r) => { if (r.ok) setCanManage((await r.json()).canManage) })
    fetch('/api/auth/me').then(async (r) => { if (r.ok) { const d = await r.json(); setIsAdmin(d.role === 'SUPER_ADMIN' || d.role === 'ADMIN') } })
  }, [])
  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { if (item?.isSerialManaged) fetchUnits() }, [item?.isSerialManaged, fetchUnits])

  async function openAddComp() {
    if (!item) return
    setAddingComp(true)
    setCompChildId(null)
    setCompQty('1')
    // 부자재 후보는 같은 인벤토리의 품목만
    const res = await fetch(`/api/inventory/items?inventoryId=${item.inventoryId}`)
    if (res.ok) {
      const all: CandidateItem[] = (await res.json()).items
      setCandidates(all.filter((c) => c.id !== Number(id)))
    }
  }

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  async function addComponent() {
    if (!compChildId) return
    setCompBusy(true)
    const res = await fetch(`/api/inventory/items/${id}/components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childItemId: compChildId, quantity: parseInt(compQty) || 1 }),
    })
    setCompBusy(false)
    if (res.ok) { setAddingComp(false); fetchAll() }
    else showError((await res.json()).error ?? '부자재 추가 실패')
  }

  async function updateComponentQty(childItemId: number, qty: number) {
    if (!Number.isFinite(qty) || qty <= 0) return
    const res = await fetch(`/api/inventory/items/${id}/components`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childItemId, quantity: qty }),
    })
    if (res.ok) fetchAll()
    else showError((await res.json()).error ?? '수량 변경 실패')
  }

  async function removeComponent(childItemId: number, name: string) {
    if (!confirm(`부자재 '${name}' 매핑을 해제하시겠습니까?`)) return
    const res = await fetch(`/api/inventory/items/${id}/components?childItemId=${childItemId}`, { method: 'DELETE' })
    if (res.ok) fetchAll()
    else showError((await res.json()).error ?? '해제 실패')
  }

  if (loading) return <div className="p-8 text-sm text-gray-500">불러오는 중...</div>
  if (!item) return <div className="p-8 text-sm text-gray-500">품목을 찾을 수 없습니다. <Link href="/inventory" className="text-blue-600">목록으로</Link></div>

  const inventory = item.inventory
  const modalItem: ModalItem = { id: item.id, itemCode: item.itemCode, name: item.name, unit: item.unit, isSerialManaged: item.isSerialManaged, isLotManaged: item.isLotManaged }
  // LOT 버킷을 위치 단위로 합산 + (비시리얼 LOT 품목) LOT별 잔량
  const whAgg = (() => {
    const m = new Map<number, { name: string; qty: number }>()
    for (const s of item.stocks) {
      if (s.quantity <= 0) continue
      const cur = m.get(s.warehouseId)
      if (cur) cur.qty += s.quantity
      else m.set(s.warehouseId, { name: s.warehouse.name, qty: s.quantity })
    }
    return Array.from(m.entries()).map(([id, v]) => ({ warehouseId: id, ...v }))
  })()
  const lotStocks = item.isLotManaged && !item.isSerialManaged
    ? item.stocks.filter((s) => s.quantity > 0).sort((a, b) => a.lotNo.localeCompare(b.lotNo))
    : []

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/inventory" className="hover:text-blue-600">자재 현황</Link>
        <span>/</span>
        <span className="text-gray-400">품목 마스터</span>
        <span>/</span>
        <span className="font-mono text-xs">{item.itemCode}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          {inventory && (
            <div className="mb-1">
              <span className="inline-flex items-center rounded-lg bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-700">{inventory.name}</span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            {item.name}
            {item.isSerialManaged && <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">시리얼</span>}
            {item.components.length > 0 && <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">주자재</span>}
            {item.usedIn.length > 0 && <span className="text-xs font-medium text-sky-600 bg-sky-50 px-2 py-0.5 rounded">부자재</span>}
            {!item.isActive && <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">비활성</span>}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
            {item.modelName && <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">{item.modelName}</span>}
            {item.categoryPath && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{item.categoryPath}</span>}
            {item.manufacturer && <span className="text-xs">{item.manufacturer.name}</span>}
            {item.spec && <span>{item.spec}</span>}
            {inventory && <Link href={`/inventory/${inventory.id}/items/${item.id}`} className="text-xs text-blue-600 hover:underline">인벤토리 자재 상세 →</Link>}
          </div>
        </div>
        {canManage && inventory && (
          <button onClick={() => setModalOpen(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">입출고</button>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-500">총재고 ({inventory?.name ?? '-'})</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{total.toLocaleString()}<span className="text-sm font-normal text-gray-400 ml-1">{item.unit}</span></div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {whAgg.length === 0 ? (
              <span className="text-xs text-gray-300">재고 없음</span>
            ) : whAgg.map((s) => (
              <span key={s.warehouseId} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{s.name} {s.qty.toLocaleString()}</span>
            ))}
          </div>
          {lotStocks.length > 0 && (
            <div className="mt-2 border-t border-gray-100 pt-1.5">
              <div className="mb-1 text-[11px] font-medium text-teal-600">LOT별 잔량</div>
              <div className="flex flex-wrap gap-1">
                {lotStocks.map((s) => (
                  <span key={`${s.lotNo}|${s.warehouseId}`} className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-xs text-teal-700">
                    {s.lotNo || '(LOT 없음)'} · {s.warehouse.name} {s.quantity.toLocaleString()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-500">참고단가</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{item.refPrice != null ? item.refPrice.toLocaleString() + '원' : '-'}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-500">연결 장비</div>
          <div className="mt-1 text-sm font-medium text-gray-900">{item.deviceInfo ? `${item.deviceInfo.deviceModel}` : '-'}</div>
        </div>
      </div>

      {item.memo && <div className="rounded-xl border border-gray-200 bg-white p-4 mb-6 text-sm text-gray-600">{item.memo}</div>}

      {/* 주자재-부자재 구성 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-gray-900">부자재 구성 {item.components.length > 0 && <span className="text-xs font-normal text-gray-400">({item.components.length}종)</span>}</div>
          {isAdmin && item.usedIn.length === 0 && !addingComp && (
            <button onClick={openAddComp} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">+ 부자재 추가</button>
          )}
        </div>

        {item.usedIn.length > 0 ? (
          <div className="text-sm text-gray-600">
            이 품목은 아래 주자재의 <b className="text-sky-600">부자재</b>입니다:
            <div className="mt-1.5 flex flex-wrap gap-2">
              {item.usedIn.map((u) => (
                <Link key={u.parentItemId} href={`/inventory/items/${u.parent.id}`} className="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-1 text-xs text-sky-700 hover:bg-sky-100">
                  {u.parent.name} <span className="text-sky-400">(1개당 {u.quantity}{item.unit})</span>
                </Link>
              ))}
            </div>
          </div>
        ) : item.components.length === 0 && !addingComp ? (
          <div className="text-sm text-gray-400">매핑된 부자재가 없습니다.{isAdmin && ' 이 품목을 주자재로 쓰려면 같은 인벤토리의 품목을 부자재로 추가하세요.'}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2">부자재 품목</th>
                <th className="py-2 text-right">구성 수량 (주자재 1개당)</th>
                {isAdmin && <th className="py-2 text-right">관리</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {item.components.map((c) => (
                <tr key={c.childItemId}>
                  <td className="py-2">
                    <Link href={`/inventory/items/${c.child.id}`} className="font-medium text-gray-900 hover:text-blue-600">{c.child.name}</Link>
                    <span className="ml-1 font-mono text-xs text-gray-400">{c.child.itemCode}</span>
                    {c.child.isSerialManaged && <span className="ml-1 text-xs text-indigo-500">S/N</span>}
                  </td>
                  <td className="py-2 text-right">
                    {isAdmin ? (
                      <input type="number" min={1} defaultValue={c.quantity}
                        onBlur={(e) => { const v = parseInt(e.target.value); if (v !== c.quantity) updateComponentQty(c.childItemId, v) }}
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-sm text-right" />
                    ) : (
                      <span className="tabular-nums">{c.quantity}</span>
                    )}
                    <span className="ml-1 text-xs text-gray-400">{c.child.unit}</span>
                  </td>
                  {isAdmin && (
                    <td className="py-2 text-right">
                      <button onClick={() => removeComponent(c.childItemId, c.child.name)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50">해제</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {addingComp && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            <select value={compChildId ?? ''} onChange={(e) => setCompChildId(e.target.value ? parseInt(e.target.value) : null)}
              className="flex-1 min-w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">부자재 품목 선택 (같은 인벤토리)</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.itemCode}){c.isSerialManaged ? ' — S/N' : ''}</option>)}
            </select>
            <input type="number" min={1} value={compQty} onChange={(e) => setCompQty(e.target.value)} className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="수량" />
            <button onClick={addComponent} disabled={compBusy || !compChildId} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">추가</button>
            <button onClick={() => setAddingComp(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">취소</button>
          </div>
        )}
      </div>

      {/* 탭 */}
      <div className="mb-3 flex border-b border-gray-200">
        <button onClick={() => setTab('history')} className={`px-4 py-2 text-sm font-medium ${tab === 'history' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>입출고 이력</button>
        {item.isSerialManaged && <button onClick={() => setTab('units')} className={`px-4 py-2 text-sm font-medium ${tab === 'units' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>개체 목록 ({units.length})</button>}
      </div>

      {tab === 'history' ? (
        <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2">전표</th><th className="px-3 py-2">일시</th><th className="px-3 py-2">유형</th><th className="px-3 py-2">입출고 유형</th><th className="px-3 py-2 text-right">수량</th><th className="px-3 py-2">위치</th><th className="px-3 py-2">출고처/병원</th><th className="px-3 py-2">처리자</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {txs.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-sm text-gray-400">이력 없음</td></tr>
              ) : txs.map((tx) => (
                <tr key={tx.id} className={tx.canceledAt ? 'opacity-50 line-through' : ''}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">
                    {tx.txCode}
                    {tx.parentTx && <span className="block text-[10px] text-emerald-600">└ 세트</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{new Date(tx.createdAt).toLocaleDateString('ko-KR')}</td>
                  <td className="px-3 py-2">
                    {TYPE_LABEL[tx.txType] ?? tx.txType}
                    {tx.txType === 'TRANSFER' && tx.inventory && tx.toInventory && (
                      <span className="block text-[10px] text-purple-600">{tx.inventory.name} → {tx.toInventory.name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{tx.txType === 'MOVE' ? '이동' : tx.txType === 'TRANSFER' ? '이관(구)' : (tx.reasonCode?.name ?? '-')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{tx.quantity.toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-600">{tx.warehouse?.name}{tx.toWarehouse && ` → ${tx.toWarehouse.name}`}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{tx.destination ?? tx.hospital?.hospitalName ?? '-'}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{tx.actor?.name ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2">시리얼</th><th className="px-3 py-2">LOT</th><th className="px-3 py-2">태그</th><th className="px-3 py-2">상태</th><th className="px-3 py-2">위치</th><th className="px-3 py-2">설치처</th><th className="px-3 py-2">메모</th>{canManage && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {units.length === 0 ? (
                <tr><td colSpan={canManage ? 8 : 7} className="py-8 text-center text-sm text-gray-400">개체 없음</td></tr>
              ) : units.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 font-mono text-gray-900">{u.serialNo}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{u.lotNo ?? '-'}</td>
                  <td className="px-3 py-2">
                    {(u.tags ?? []).length === 0 ? <span className="text-xs text-gray-300">-</span> : (
                      <div className="flex flex-wrap gap-1">
                        {u.tags.map((t) => <span key={t} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">#{t}</span>)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2"><span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${UNIT_STATUS[u.status]?.cls ?? ''}`}>{UNIT_STATUS[u.status]?.label ?? u.status}</span></td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{u.status === 'IN_STOCK' ? (u.warehouse?.name ?? '-') : '-'}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{u.status === 'OUT' ? (u.hospital?.hospitalName ?? '출고됨') : '-'}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{u.memo ?? '-'}</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setEditUnit(u)} className="text-xs text-blue-500 hover:underline">편집</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && inventory && (
        <TransactionModal item={modalItem} inventory={inventory} warehouses={warehouses}
          onClose={() => setModalOpen(false)} onDone={() => { setModalOpen(false); fetchAll(); if (item.isSerialManaged) fetchUnits() }} />
      )}
      {editUnit && (
        <UnitEditModal unit={editUnit} onClose={() => setEditUnit(null)} onSaved={fetchUnits} />
      )}
    </div>
  )
}
