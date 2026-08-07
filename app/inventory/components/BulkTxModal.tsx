'use client'

import { useState, useEffect, useMemo } from 'react'

interface Inventory { id: number; name: string; isActive: boolean }
interface Warehouse { id: number; name: string; inventoryId: number; isActive: boolean }
interface Reason { id: number; name: string; value: string | null }
interface Item { id: number; itemCode: string; name: string; unit: string; isSerialManaged: boolean; isLotManaged: boolean }
interface Bucket { warehouseId: number; warehouseName: string; lotNo: string; quantity: number } // LOT 재고 차원 — 위치×LOT 단위

interface Line {
  key: number
  itemId: number | ''
  warehouseId: number | ''
  quantity: string
  serialsText: string
  lotNo: string // IN — 신규 LOT 수동 입력
  lotSel: string | null // OUT 비시리얼 LOT — 보유 LOT 버킷 선택 (''=LOT 없음, null=미선택)
}

let keySeq = 1
const newLine = (): Line => ({ key: keySeq++, itemId: '', warehouseId: '', quantity: '', serialsText: '', lotNo: '', lotSel: null })

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const inputCls = 'rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function BulkTxModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [inReasons, setInReasons] = useState<Reason[]>([])
  const [outReasons, setOutReasons] = useState<Reason[]>([])
  const [items, setItems] = useState<Item[]>([])

  const [inventoryId, setInventoryId] = useState<number | ''>('')
  const [txType, setTxType] = useState<'IN' | 'OUT'>('IN')
  const [reasonId, setReasonId] = useState<number | ''>('')
  const [requester, setRequester] = useState('')
  const [destination, setDestination] = useState('')
  const [txDate, setTxDate] = useState(todayLocal())
  const [lines, setLines] = useState<Line[]>([newLine()])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/inventories').then(async (r) => { if (r.ok) setInventories((await r.json()).inventories) })
    fetch('/api/settings/warehouses').then(async (r) => { if (r.ok) setWarehouses((await r.json()).warehouses) })
    fetch('/api/settings/stock-in-type').then(async (r) => { if (r.ok) setInReasons((await r.json()).statusCodes ?? []) })
    fetch('/api/settings/stock-out-type').then(async (r) => { if (r.ok) setOutReasons((await r.json()).statusCodes ?? []) })
  }, [])

  // 인벤토리 변경 → 품목 로드 + 줄 초기화
  useEffect(() => {
    if (inventoryId === '') { setItems([]); return }
    fetch(`/api/inventory/items?inventoryId=${inventoryId}`).then(async (r) => {
      if (r.ok) setItems((await r.json()).items ?? [])
    })
    setLines([newLine()])
  }, [inventoryId])

  // 유형 전환 시 유형(reason) 초기화
  useEffect(() => { setReasonId('') }, [txType])

  const reasons = txType === 'IN' ? inReasons : outReasons
  const invWarehouses = useMemo(
    () => warehouses.filter((w) => w.inventoryId === inventoryId && w.isActive),
    [warehouses, inventoryId],
  )
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  // OUT 비시리얼 LOT 품목 — 보유 LOT 버킷 캐시 (단품목 모달의 LOT 선택과 동일 소스: /api/inventory/stocks)
  const [bucketsByItem, setBucketsByItem] = useState<Record<number, Bucket[]>>({})
  useEffect(() => { setBucketsByItem({}) }, [inventoryId])
  useEffect(() => {
    if (txType !== 'OUT') return
    const need = Array.from(new Set(
      lines
        .map((l) => (l.itemId !== '' ? itemMap.get(l.itemId) : undefined))
        .filter((it): it is Item => !!it && it.isLotManaged && !it.isSerialManaged)
        .map((it) => it.id),
    )).filter((id) => bucketsByItem[id] === undefined)
    for (const id of need) {
      setBucketsByItem((m) => ({ ...m, [id]: [] })) // 중복 요청 방지 선점
      fetch(`/api/inventory/stocks?itemId=${id}`).then(async (r) => {
        if (r.ok) {
          const buckets: Bucket[] = (await r.json()).buckets ?? []
          setBucketsByItem((m) => ({ ...m, [id]: buckets }))
        }
      })
    }
  }, [txType, lines, itemMap, bucketsByItem])

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  // 줄별 LOT 수동 입력 필요 여부: LOT 품목 입고 (비시리얼=재고 버킷, 시리얼=개체 LOT)
  function needsLotInput(item: Item | undefined): boolean {
    if (!item || !item.isLotManaged) return false
    return txType === 'IN'
  }

  // 줄별 LOT 선택 필요 여부: 비시리얼 LOT 품목 출고 — 보유 LOT 버킷에서 선택
  function needsLotPick(item: Item | undefined): boolean {
    return !!item && item.isLotManaged && !item.isSerialManaged && txType === 'OUT'
  }

  async function submit() {
    setError(null)
    if (inventoryId === '') return setError('인벤토리를 선택하세요.')
    if (reasonId === '') return setError(`${txType === 'IN' ? '입고' : '출고'} 유형을 선택하세요.`)
    if (txType === 'OUT' && !requester.trim()) return setError('출고 요청자를 입력하세요.')

    const payloadLines = []
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.itemId === '') continue // 빈 줄 건너뜀
      if (l.warehouseId === '') return setError(`${i + 1}번째 줄: 위치를 선택하세요.`)
      const item = itemMap.get(l.itemId)
      const serials = l.serialsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      if (item?.isSerialManaged) {
        if (serials.length === 0) return setError(`${i + 1}번째 줄(${item.name}): 시리얼번호를 입력하세요.`)
      } else {
        const q = Number(l.quantity)
        if (!q || q <= 0) return setError(`${i + 1}번째 줄(${item?.name ?? ''}): 수량을 입력하세요.`)
      }
      if (needsLotInput(item) && !l.lotNo.trim()) return setError(`${i + 1}번째 줄(${item?.name}): LOT를 입력하세요.`)
      if (needsLotPick(item) && l.lotSel === null) return setError(`${i + 1}번째 줄(${item?.name}): 출고할 LOT를 선택하세요.`)

      const line: Record<string, unknown> = { itemId: l.itemId, warehouseId: l.warehouseId }
      if (item?.isSerialManaged) {
        line.serials = serials
        if (needsLotInput(item)) line.lotBySerial = Object.fromEntries(serials.map((s) => [s, l.lotNo.trim()]))
      } else {
        line.quantity = Number(l.quantity)
        if (needsLotInput(item)) line.lotNo = l.lotNo.trim()
        if (needsLotPick(item)) line.lotNo = l.lotSel // ''=LOT 없음 버킷
      }
      payloadLines.push(line)
    }
    if (payloadLines.length === 0) return setError('품목을 1개 이상 입력하세요.')

    setSubmitting(true)
    try {
      const res = await fetch('/api/inventory/transactions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txType,
          inventoryId,
          reasonId,
          requester: requester.trim() || null,
          destination: destination.trim() || null,
          txDate,
          lines: payloadLines,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '처리 실패'); return }
      onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-4xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900">다품목 일괄 입출고</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* 공통 헤더 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-500">인벤토리</span>
              <select value={inventoryId} onChange={(e) => setInventoryId(e.target.value ? Number(e.target.value) : '')} className={inputCls}>
                <option value="">선택</option>
                {inventories.filter((i) => i.isActive).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-500">유형</span>
              <div className="flex gap-1">
                {(['IN', 'OUT'] as const).map((t) => (
                  <button key={t} onClick={() => setTxType(t)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-sm font-medium ${txType === t ? (t === 'IN' ? 'border-green-400 bg-green-50 text-green-700' : 'border-red-400 bg-red-50 text-red-700') : 'border-gray-300 text-gray-500'}`}>
                    {t === 'IN' ? '입고' : '출고'}
                  </button>
                ))}
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-500">{txType === 'IN' ? '입고' : '출고'} 유형</span>
              <select value={reasonId} onChange={(e) => setReasonId(e.target.value ? Number(e.target.value) : '')} className={inputCls}>
                <option value="">선택</option>
                {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-500">입출고일</span>
              <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} className={inputCls} />
            </label>
            {txType === 'OUT' && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500">요청자 *</span>
                <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="요청자" className={inputCls} />
              </label>
            )}
            {/* 상대처 — IN=발송처 / OUT=출고처 (입출고대장 발송처·입고처정보 소스) */}
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">{txType === 'IN' ? '발송처' : '출고처'}</span>
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={txType === 'IN' ? '예: 평택본사(판매용) (선택)' : '출고처 (선택)'}
                className={inputCls}
              />
            </label>
          </div>

          {/* 품목 줄 */}
          {inventoryId === '' ? (
            <p className="rounded-lg bg-gray-50 py-6 text-center text-sm text-gray-400">인벤토리를 먼저 선택하세요.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">품목 ({lines.filter((l) => l.itemId !== '').length})</span>
                <button onClick={() => setLines((ls) => [...ls, newLine()])} className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">+ 줄 추가</button>
              </div>
              {lines.map((l, idx) => {
                const item = l.itemId !== '' ? itemMap.get(l.itemId) : undefined
                const isSerial = !!item?.isSerialManaged
                const serialCount = l.serialsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).length
                return (
                  <div key={l.key} className="rounded-lg border border-gray-200 p-2.5">
                    <div className="flex flex-wrap items-start gap-2">
                      <span className="pt-2 text-xs text-gray-400">{idx + 1}</span>
                      <select value={l.itemId} onChange={(e) => updateLine(l.key, { itemId: e.target.value ? Number(e.target.value) : '', quantity: '', serialsText: '', lotNo: '', lotSel: null })} className={`${inputCls} min-w-0 flex-1`}>
                        <option value="">품목 선택</option>
                        {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.itemCode})</option>)}
                      </select>
                      <select value={l.warehouseId} onChange={(e) => updateLine(l.key, { warehouseId: e.target.value ? Number(e.target.value) : '', lotSel: null })} className={`${inputCls} w-32`}>
                        <option value="">위치</option>
                        {invWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      {!isSerial && (
                        <input type="number" min={1} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} placeholder="수량" className={`${inputCls} w-20 text-right`} />
                      )}
                      {item && needsLotInput(item) && (
                        <input value={l.lotNo} onChange={(e) => updateLine(l.key, { lotNo: e.target.value })} placeholder="LOT" className={`${inputCls} w-28 font-mono`} />
                      )}
                      {item && needsLotPick(item) && (() => {
                        // 보유 LOT 버킷 선택 — 단품목 출고 모달과 동일 동작 (위치 선택 후 활성화)
                        const lotBuckets = (bucketsByItem[item.id] ?? []).filter((b) => b.warehouseId === l.warehouseId && b.quantity > 0)
                        return (
                          <select
                            value={l.lotSel === null ? '' : `L:${l.lotSel}`}
                            onChange={(e) => updateLine(l.key, { lotSel: e.target.value ? e.target.value.slice(2) : null })}
                            disabled={l.warehouseId === ''}
                            className={`${inputCls} w-44 font-mono`}
                            title={l.warehouseId === '' ? '위치를 먼저 선택하세요' : undefined}
                          >
                            <option value="">{l.warehouseId === '' ? '위치 먼저 선택' : lotBuckets.length === 0 ? '이 위치에 재고 없음' : `LOT 선택 (${lotBuckets.length}개)`}</option>
                            {lotBuckets.map((b) => (
                              <option key={b.lotNo || '(none)'} value={`L:${b.lotNo}`}>{b.lotNo || '(LOT 없음)'} — 재고 {b.quantity.toLocaleString()}</option>
                            ))}
                          </select>
                        )
                      })()}
                      <button onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} className="pt-1.5 text-gray-300 hover:text-red-500" title="줄 삭제">✕</button>
                    </div>
                    {isSerial && (
                      <div className="mt-2 pl-5">
                        <textarea value={l.serialsText} onChange={(e) => updateLine(l.key, { serialsText: e.target.value })} rows={2}
                          placeholder="시리얼번호 (줄바꿈/쉼표로 구분, 스캔 입력)" className={`${inputCls} w-full font-mono`} />
                        <span className="text-[11px] text-gray-400">{serialCount}개 · {txType === 'IN' ? '신규 입고' : '출고 대상'}{needsLotInput(item) && ' · LOT는 이 줄 전체 공통'}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
          <button onClick={submit} disabled={submitting || inventoryId === ''} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {submitting ? '처리 중…' : `${txType === 'IN' ? '입고' : '출고'} 등록`}
          </button>
        </div>
      </div>
    </div>
  )
}
