'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface ModalItem {
  id: number
  itemCode: string
  name: string
  unit: string
  isSerialManaged: boolean
}
interface Warehouse { id: number; name: string; isActive: boolean }
interface Inventory { id: number; name: string; isTransferLocked: boolean; linkHospital: boolean; isActive: boolean }
interface Reason { id: number; name: string; value: string | null }
interface Bucket { warehouseId: number; warehouseName: string; inventoryId: number; inventoryName: string; isTransferLocked: boolean; quantity: number }
interface Unit { id: number; serialNo: string }
interface Hospital { hospitalCode: string; hospitalName: string }
interface Work { workType: string; refCode: string; label: string }
interface Component { childItemId: number; quantity: number; item: { id: number; itemCode: string; name: string; unit: string; isSerialManaged: boolean; isActive: boolean } }

type TxType = 'IN' | 'OUT' | 'MOVE' | 'TRANSFER'

const TYPE_LABEL: Record<TxType, string> = { IN: '입고', OUT: '출고', MOVE: '이동', TRANSFER: '이관' }

export default function TransactionModal({
  item, warehouses, defaultInventoryId, fixedInventoryId, onClose, onDone,
}: {
  item: ModalItem
  warehouses: Warehouse[]
  defaultInventoryId?: number | null // 현재 인벤토리 탭 — 모달 기본값 (변경 가능)
  fixedInventoryId?: number | null // 인벤토리 자재 상세 — 인벤토리 고정 (변경 불가)
  onClose: () => void
  onDone: () => void
}) {
  const fixed = fixedInventoryId != null
  const preferredInventoryId = fixedInventoryId ?? defaultInventoryId ?? null
  const activeWarehouses = warehouses.filter((w) => w.isActive)
  const [txType, setTxType] = useState<TxType>('IN')
  const [warehouseId, setWarehouseId] = useState<number | null>(activeWarehouses[0]?.id ?? null)
  const [toWarehouseId, setToWarehouseId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [serialsText, setSerialsText] = useState('') // IN 신규/회수 + OUT·MOVE·TRANSFER 시리얼 입력(스캔)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 인벤토리 — IN은 마스터에서 선택(탭 기본값), OUT/MOVE/TRANSFER는 재고 있는 인벤토리 중 선택
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [inventoryId, setInventoryId] = useState<number | null>(null)
  const [toInventoryId, setToInventoryId] = useState<number | null>(null)
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const autoWarehousePicked = useRef(false) // 재고 있는 창고 1회 자동 선택

  // 이관: 일자(기본 오늘)·단가(참고용)
  const [transferDate, setTransferDate] = useState(() => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10))
  const [transferPrice, setTransferPrice] = useState('')

  // 입고/출고 유형 (설정에서 관리)
  const [inReasons, setInReasons] = useState<Reason[]>([])
  const [outReasons, setOutReasons] = useState<Reason[]>([])
  const [reasonId, setReasonId] = useState<number | null>(null)

  // 시리얼 OUT/MOVE/TRANSFER — 가용 개체 목록 (참고용 표시·클릭 추가)
  const [units, setUnits] = useState<Unit[]>([])
  const [showAvail, setShowAvail] = useState(false)

  // 출고: 출고처·병원·업무 연결
  const [destination, setDestination] = useState('')
  const [hospital, setHospital] = useState<Hospital | null>(null)
  const [hospitalSearch, setHospitalSearch] = useState('')
  const [hospitalResults, setHospitalResults] = useState<Hospital[]>([])
  const [works, setWorks] = useState<Work[]>([])
  const [selectedWork, setSelectedWork] = useState<string>('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 출고: 부자재 세트출고
  const [components, setComponents] = useState<Component[]>([])
  const [setOut, setSetOut] = useState(false)
  const [compChecked, setCompChecked] = useState<Set<number>>(new Set())
  const [compQty, setCompQty] = useState<Record<number, string>>({})

  const serial = item.isSerialManaged
  const needSerialInput = serial && txType !== 'IN' // 출고·이동·이관 — 시리얼 입력/스캔
  const needBucketPick = txType !== 'IN' // 기존 재고(위치×인벤토리)에서 선택

  const activeInventories = inventories.filter((i) => i.isActive)
  const reasons = txType === 'IN' ? inReasons : txType === 'OUT' ? outReasons : []
  const currentReason = reasons.find((r) => r.id === reasonId)
  const sourceInventory = inventories.find((i) => i.id === inventoryId)
  const canLinkHospital = txType === 'OUT' && !!sourceInventory?.linkHospital // 병원 연결은 대웅제약재고 출고만

  const serialLines = serialsText.split('\n').map((s) => s.trim()).filter(Boolean)

  // 마스터 로드 — 인벤토리·입출고 유형·부자재 매핑
  useEffect(() => {
    fetch('/api/settings/inventories').then(async (r) => {
      if (!r.ok) return
      const list: Inventory[] = (await r.json()).inventories ?? []
      setInventories(list)
      const preferred = list.find((i) => i.isActive && i.id === preferredInventoryId) ?? (fixed ? null : list.find((i) => i.isActive))
      if (preferred) setInventoryId((prev) => prev ?? preferred.id)
    })
    fetch('/api/settings/stock-in-type').then(async (r) => {
      if (!r.ok) return
      const list: Reason[] = (await r.json()).statusCodes ?? []
      setInReasons(list)
      if (list.length) setReasonId((prev) => prev ?? list[0].id)
    })
    fetch('/api/settings/stock-out-type').then(async (r) => { if (r.ok) setOutReasons((await r.json()).statusCodes ?? []) })
    fetch(`/api/inventory/items/${item.id}/components`).then(async (r) => {
      if (r.ok) setComponents(((await r.json()).components ?? []) as Component[])
    })
  }, [item.id, preferredInventoryId, fixed])

  function switchType(t: TxType) {
    setTxType(t)
    setReasonId(t === 'IN' ? (inReasons[0]?.id ?? null) : t === 'OUT' ? (outReasons[0]?.id ?? null) : null)
    setError(null)
    setSerialsText('')
    setToInventoryId(null)
    setToWarehouseId(null)
    if (t !== 'IN') setInventoryId(null) // 버킷 로드 후 우선 인벤토리로 재선택
    else if (fixed) setInventoryId(preferredInventoryId)
    else setInventoryId(activeInventories.find((i) => i.id === preferredInventoryId)?.id ?? activeInventories[0]?.id ?? null)
    if (t !== 'OUT') { setHospital(null); setWorks([]); setSelectedWork(''); setDestination(''); setSetOut(false) }
  }

  // OUT/MOVE/TRANSFER: 출발 위치의 재고 버킷(인벤토리) 로드 — 고정/탭 인벤토리 우선 선택.
  // 현재 위치에 재고가 없으면 재고 있는 위치로 1회 자동 전환 (모달 열자마자 입력 가능하도록)
  const loadBuckets = useCallback(async () => {
    if (!needBucketPick || !warehouseId) { setBuckets([]); return }
    const res = await fetch(`/api/inventory/stocks?itemId=${item.id}${fixed ? `&inventoryId=${fixedInventoryId}` : ''}`)
    if (res.ok) {
      const all: Bucket[] = (await res.json()).buckets
      const here = all.filter((b) => b.warehouseId === warehouseId)
      if (here.length === 0 && all.length > 0 && !autoWarehousePicked.current) {
        autoWarehousePicked.current = true
        const target = all.find((b) => b.inventoryId === preferredInventoryId) ?? all[0]
        setWarehouseId(target.warehouseId) // 재고 있는 위치로 전환 → loadBuckets 재실행
        return
      }
      setBuckets(here)
      const preferred = here.find((b) => b.inventoryId === preferredInventoryId) ?? (here.length === 1 ? here[0] : null)
      setInventoryId(preferred ? preferred.inventoryId : null)
    }
  }, [needBucketPick, warehouseId, item.id, preferredInventoryId, fixed, fixedInventoryId])
  useEffect(() => { loadBuckets() }, [loadBuckets])

  // 시리얼 OUT/MOVE/TRANSFER: 선택 버킷의 IN_STOCK 개체 로드 (가용 목록 표시용)
  const loadUnits = useCallback(async () => {
    if (!needSerialInput || !warehouseId || !inventoryId) { setUnits([]); return }
    const res = await fetch(`/api/inventory/units?itemId=${item.id}&warehouseId=${warehouseId}&status=IN_STOCK&inventoryId=${inventoryId}`)
    if (res.ok) setUnits((await res.json()).units)
  }, [needSerialInput, warehouseId, inventoryId, item.id])
  useEffect(() => { loadUnits() }, [loadUnits])

  // 인벤토리 변경 시 병원 연결 불가면 해제
  useEffect(() => {
    if (!canLinkHospital && hospital) { setHospital(null); setWorks([]); setSelectedWork('') }
  }, [canLinkHospital, hospital])

  // 병원 검색
  useEffect(() => {
    if (!canLinkHospital) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!hospitalSearch.trim()) { setHospitalResults([]); return }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/hospitals?search=${encodeURIComponent(hospitalSearch)}&limit=20`)
      if (res.ok) setHospitalResults((await res.json()).hospitals ?? [])
    }, 300)
  }, [hospitalSearch, canLinkHospital])

  async function pickHospital(h: Hospital) {
    setHospital(h)
    setHospitalResults([])
    setHospitalSearch('')
    setSelectedWork('')
    const res = await fetch(`/api/inventory/hospital-works?hospitalCode=${encodeURIComponent(h.hospitalCode)}`)
    if (res.ok) setWorks((await res.json()).works)
  }

  /** 가용 목록 클릭 → 시리얼 입력란에 추가/제거 */
  function toggleSerialLine(serialNo: string) {
    const lines = new Set(serialLines)
    if (lines.has(serialNo)) lines.delete(serialNo)
    else lines.add(serialNo)
    setSerialsText(Array.from(lines).join('\n'))
  }

  const selectedBucket = buckets.find((b) => b.inventoryId === inventoryId)

  const effectiveQty = serial ? serialLines.length : parseInt(quantity) || 0

  const normalComponents = components.filter((c) => !c.item.isSerialManaged && c.item.isActive)
  const serialComponents = components.filter((c) => c.item.isSerialManaged && c.item.isActive)

  // 세트출고 켤 때 부자재 기본 수량 = 주자재 수량 × 구성 수량
  function toggleSetOut(on: boolean) {
    setSetOut(on)
    if (on) {
      const qty: Record<number, string> = {}
      const checked = new Set<number>()
      for (const c of normalComponents) {
        qty[c.childItemId] = String(c.quantity * Math.max(1, effectiveQty))
        checked.add(c.childItemId)
      }
      setCompQty(qty)
      setCompChecked(checked)
    }
  }

  async function submit() {
    setError(null)
    if (!warehouseId) { setError('위치를 선택하세요.'); return }
    if (txType === 'MOVE' && !toWarehouseId) { setError('도착 위치를 선택하세요.'); return }
    if (!inventoryId) { setError('인벤토리를 선택하세요.'); return }
    if ((txType === 'IN' || txType === 'OUT') && !reasonId) { setError(`${TYPE_LABEL[txType]} 유형을 선택하세요.`); return }
    if (txType === 'TRANSFER' && !toInventoryId) { setError('도착 인벤토리를 선택하세요.'); return }
    if (txType === 'TRANSFER' && !transferDate) { setError('이관일자를 입력하세요.'); return }
    if (effectiveQty <= 0) { setError(serial ? '시리얼을 입력하세요.' : '수량을 입력하세요.'); return }

    const compPayload = txType === 'OUT' && setOut
      ? normalComponents
          .filter((c) => compChecked.has(c.childItemId))
          .map((c) => ({ itemId: c.childItemId, quantity: parseInt(compQty[c.childItemId] ?? '0') || 0 }))
          .filter((c) => c.quantity > 0)
      : []

    const work = works.find((w) => w.refCode === selectedWork)
    const payload = {
      txType,
      reasonId,
      itemId: item.id,
      warehouseId,
      toWarehouseId: txType === 'MOVE' ? toWarehouseId : txType === 'TRANSFER' ? (toWarehouseId ?? null) : null,
      inventoryId,
      toInventoryId: txType === 'TRANSFER' ? toInventoryId : null,
      quantity: effectiveQty,
      transferDate: txType === 'TRANSFER' ? transferDate : null,
      transferPrice: txType === 'TRANSFER' && transferPrice.trim() ? parseInt(transferPrice) : null,
      destination: txType === 'OUT' ? destination.trim() || null : null,
      hospitalCode: canLinkHospital ? hospital?.hospitalCode ?? null : null,
      workType: canLinkHospital ? work?.workType ?? null : null,
      refCode: canLinkHospital ? work?.refCode ?? null : null,
      note,
      serials: serial ? serialLines : [], // IN=신규/회수, OUT·MOVE·TRANSFER=대상 개체 지정 (서버에서 버킷 검증)
      unitIds: [],
      components: compPayload,
    }
    setBusy(true)
    const res = await fetch('/api/inventory/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await res.json()
    setBusy(false)
    if (res.ok) onDone()
    else setError(data.error ?? '처리에 실패했습니다.')
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-semibold text-gray-900">재고 입출고</h2>
            <p className="text-xs text-gray-500 mt-0.5">{item.itemCode} · {item.name}{serial && <span className="ml-1 text-indigo-600">(시리얼)</span>}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* 유형 토글 */}
          <div className="flex gap-2">
            {(['IN', 'OUT', 'MOVE', 'TRANSFER'] as TxType[]).map((t) => (
              <button key={t} onClick={() => switchType(t)}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${txType === t ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(txType === 'IN' || txType === 'OUT') && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{TYPE_LABEL[txType]} 유형</label>
                <select value={reasonId ?? ''} onChange={(e) => setReasonId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                  {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}
            <div className={txType === 'MOVE' || txType === 'TRANSFER' ? 'col-span-2' : ''}>
              <label className="block text-xs font-medium text-gray-700 mb-1">{txType === 'MOVE' ? '출발 위치' : '위치'}</label>
              <select value={warehouseId ?? ''} onChange={(e) => setWarehouseId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>

          {txType === 'MOVE' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">도착 위치</label>
              <select value={toWarehouseId ?? ''} onChange={(e) => setToWarehouseId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                <option value="">선택하세요</option>
                {activeWarehouses.filter((w) => w.id !== warehouseId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}

          {/* 인벤토리 — 고정 모드(인벤토리 자재 상세)에서는 변경 불가 */}
          {txType === 'IN' ? (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">인벤토리 <span className="text-red-500">*</span>{fixed && <span className="ml-1 text-gray-400">(고정)</span>}</label>
              <select value={inventoryId ?? ''} disabled={fixed} onChange={(e) => setInventoryId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls + ' disabled:bg-gray-50 disabled:text-gray-500'}>
                {activeInventories.filter((i) => !fixed || i.id === fixedInventoryId).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              {currentReason?.value === 'RETURN' && (
                <p className="mt-1 text-xs text-amber-600">회수는 출고 당시의 인벤토리와 동일해야 합니다. (인벤토리 전환 불가)</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">인벤토리 (재고 구분) <span className="text-red-500">*</span>{fixed && <span className="ml-1 text-gray-400">(고정)</span>}</label>
              <select value={inventoryId ?? ''} disabled={fixed} onChange={(e) => setInventoryId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls + ' disabled:bg-gray-50 disabled:text-gray-500'}>
                <option value="">선택하세요</option>
                {buckets.map((b) => (
                  <option key={b.inventoryId} value={b.inventoryId}>
                    {b.inventoryName} (재고 {b.quantity})
                  </option>
                ))}
              </select>
              {buckets.length === 0 && <p className="mt-1 text-xs text-gray-400">해당 위치에 {fixed ? '이 인벤토리의 ' : ''}재고가 없습니다.</p>}
            </div>
          )}

          {/* 이관: 도착 인벤토리 (+선택적 도착 위치) */}
          {txType === 'TRANSFER' && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              {sourceInventory?.isTransferLocked ? (
                <p className="text-xs text-red-600">&apos;{sourceInventory.name}&apos;은(는) 다른 인벤토리로 이관할 수 없습니다.</p>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">도착 인벤토리 <span className="text-red-500">*</span></label>
                    <select value={toInventoryId ?? ''} onChange={(e) => setToInventoryId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                      <option value="">선택하세요</option>
                      {activeInventories.filter((i) => i.id !== inventoryId && !i.isTransferLocked).map((i) => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">도착 위치 (선택 — 미지정 시 현재 위치 유지)</label>
                    <select value={toWarehouseId ?? ''} onChange={(e) => setToWarehouseId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                      <option value="">현재 위치 유지</option>
                      {activeWarehouses.filter((w) => w.id !== warehouseId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">이관일자 <span className="text-red-500">*</span></label>
                      <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">이관 단가 (원 — 참고용, 선택)</label>
                      <input type="number" min={0} value={transferPrice} onChange={(e) => setTransferPrice(e.target.value)} className={inputCls} placeholder="예: 150000" />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">이관 잠금 인벤토리(예: 평가용재고)는 출발·도착 모두 선택할 수 없습니다. 단가는 재판매(대웅제약→판매용) 참고 기록용입니다.</p>
                </>
              )}
            </div>
          )}

          {/* 수량 or 시리얼 */}
          {!serial ? (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                수량 ({item.unit})
                {selectedBucket && needBucketPick && <span className="ml-1 text-gray-400">— 가용 {selectedBucket.quantity}</span>}
              </label>
              <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
            </div>
          ) : txType === 'IN' ? (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">시리얼 입력 · 바코드 스캔 (줄바꿈으로 여러 개) · <b>{effectiveQty}개</b></label>
              <textarea value={serialsText} onChange={(e) => setSerialsText(e.target.value)} rows={5} placeholder={'SN001\nSN002\nSN003\n(바코드 리더기로 연속 스캔 가능)'} className={inputCls + ' font-mono'} />
              {currentReason?.value === 'RETURN' && <p className="mt-1 text-xs text-amber-600">회수: 이미 출고된 개체의 시리얼을 입력하세요.</p>}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {TYPE_LABEL[txType]} 대상 시리얼 — 직접 입력 · 바코드 스캔 (줄바꿈으로 여러 개) · <b>{effectiveQty}개</b>
                {inventoryId && <span className="ml-1 text-gray-400">/ 가용 {units.length}개</span>}
              </label>
              <textarea value={serialsText} onChange={(e) => setSerialsText(e.target.value)} rows={5}
                placeholder={'SN001\nSN002\n(바코드 리더기로 연속 스캔하거나 붙여넣기)'} className={inputCls + ' font-mono'} disabled={!inventoryId} />
              <p className="mt-1 text-xs text-gray-400">대량 처리: 시리얼을 줄 단위로 붙여넣거나 바코드 리더기로 연속 스캔하세요. 존재하지 않거나 해당 위치·인벤토리 재고가 아닌 시리얼은 확정 시 거부됩니다.</p>
              {inventoryId && units.length > 0 && (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowAvail((v) => !v)} className="text-xs text-blue-600 hover:underline">
                    {showAvail ? '▲ 가용 개체 목록 접기' : `▼ 가용 개체 목록에서 선택 (${units.length}개)`}
                  </button>
                  {showAvail && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                      {units.slice(0, 200).map((u) => {
                        const picked = serialLines.includes(u.serialNo)
                        return (
                          <button key={u.id} type="button" onClick={() => toggleSerialLine(u.serialNo)}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-gray-50 ${picked ? 'bg-blue-50' : ''}`}>
                            <span className={`h-3.5 w-3.5 shrink-0 rounded border ${picked ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`} />
                            <span className="font-mono text-gray-900">{u.serialNo}</span>
                          </button>
                        )
                      })}
                      {units.length > 200 && <div className="px-3 py-1.5 text-xs text-gray-400">외 {units.length - 200}개 — 시리얼 직접 입력/스캔을 사용하세요.</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 출고: 부자재 세트출고 */}
          {txType === 'OUT' && components.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                <input type="checkbox" checked={setOut} onChange={(e) => toggleSetOut(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                부자재 함께 출고 (세트출고)
              </label>
              {setOut && (
                <div className="space-y-1.5">
                  {normalComponents.map((c) => (
                    <div key={c.childItemId} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={compChecked.has(c.childItemId)}
                        onChange={(e) => setCompChecked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(c.childItemId); else n.delete(c.childItemId); return n })}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="flex-1 text-gray-800">{c.item.name} <span className="text-xs text-gray-400">(구성 {c.quantity}{c.item.unit}/개)</span></span>
                      <input type="number" min={1} value={compQty[c.childItemId] ?? ''} disabled={!compChecked.has(c.childItemId)}
                        onChange={(e) => setCompQty((prev) => ({ ...prev, [c.childItemId]: e.target.value }))}
                        className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm text-right disabled:bg-gray-50 disabled:text-gray-400" />
                      <span className="text-xs text-gray-400 w-8">{c.item.unit}</span>
                    </div>
                  ))}
                  {serialComponents.length > 0 && (
                    <p className="text-xs text-amber-600">시리얼 관리 부자재({serialComponents.map((c) => c.item.name).join(', ')})는 세트출고에서 제외됩니다 — 개별 출고하세요.</p>
                  )}
                  <p className="text-xs text-gray-400">부자재는 주자재와 같은 위치·인벤토리 재고에서 차감됩니다. (수량 = 출고수량 × 구성수량, 수정 가능)</p>
                </div>
              )}
            </div>
          )}

          {/* 출고: 출고처 (+대웅제약재고만 병원·업무 연결) */}
          {txType === 'OUT' && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">출고처 (자유 입력)</label>
                <input value={destination} onChange={(e) => setDestination(e.target.value)} className={inputCls} placeholder="예: 대웅제약 영업부, ○○업체 등" />
              </div>
              {canLinkHospital ? (
                <>
                  <label className="block text-xs font-medium text-gray-700">병원 연결 (선택)</label>
                  {hospital ? (
                    <div className="flex items-center justify-between rounded bg-blue-50 px-3 py-2 text-sm">
                      <span className="text-blue-800">{hospital.hospitalName}</span>
                      <button onClick={() => { setHospital(null); setWorks([]); setSelectedWork('') }} className="text-xs text-blue-600 hover:underline">해제</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input value={hospitalSearch} onChange={(e) => setHospitalSearch(e.target.value)} placeholder="병원명 검색" className={inputCls} />
                      {hospitalResults.length > 0 && (
                        <div className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                          {hospitalResults.map((h) => (
                            <button key={h.hospitalCode} onClick={() => pickHospital(h)} className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50">{h.hospitalName}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {hospital && works.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">업무 연결 (선택)</label>
                      <select value={selectedWork} onChange={(e) => setSelectedWork(e.target.value)} className={inputCls}>
                        <option value="">연결 안 함</option>
                        {works.map((w) => <option key={`${w.workType}-${w.refCode}`} value={w.refCode}>{w.label}</option>)}
                      </select>
                    </div>
                  )}
                </>
              ) : (
                inventoryId != null && <p className="text-xs text-gray-400">병원 연결은 병원 연결 허용 인벤토리(대웅제약재고) 출고에서만 가능합니다.</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="선택" />
          </div>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4 sticky bottom-0 bg-white">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">취소</button>
          <button onClick={submit} disabled={busy || effectiveQty <= 0} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? '처리 중...' : `${TYPE_LABEL[txType]} 확정`}
          </button>
        </div>
      </div>
    </div>
  )
}
