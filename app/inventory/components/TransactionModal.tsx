'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface ModalItem {
  id: number
  itemCode: string
  name: string
  unit: string
  isSerialManaged: boolean
  isLotManaged: boolean
}
export interface ModalInventory {
  id: number
  name: string
  linkHospital: boolean
}
interface Warehouse { id: number; name: string; isActive: boolean; inventoryId: number }
interface Reason { id: number; name: string; value: string | null }
interface Bucket { warehouseId: number; warehouseName: string; quantity: number }
interface Unit { id: number; serialNo: string }
interface Hospital { hospitalCode: string; hospitalName: string }
interface Work { workType: string; refCode: string; label: string }
interface Component { childItemId: number; quantity: number; item: { id: number; itemCode: string; name: string; unit: string; isSerialManaged: boolean; isActive: boolean } }
interface PickItem { id: number; itemCode: string; name: string; modelName: string | null; unit: string; isSerialManaged: boolean; isLotManaged: boolean }

export type TxType = 'IN' | 'OUT' | 'MOVE'

const TYPE_LABEL: Record<TxType, string> = { IN: '입고', OUT: '출고', MOVE: '이동' }

/**
 * 입고/출고/이동 전표 모달 — 인벤토리 고정(품목·위치 전부 해당 인벤토리 스코프).
 * item 미지정 시 모달 안에서 이 인벤토리의 품목을 검색·선택 (인벤토리 카드 섹션의 입고/출고 버튼용).
 */
export default function TransactionModal({
  inventory, warehouses, item: fixedItem, defaultTxType, onClose, onDone,
}: {
  inventory: ModalInventory
  warehouses: Warehouse[] // 이 인벤토리의 위치 목록
  item?: ModalItem | null // 지정 시 품목 고정 (품목 상세에서 열 때)
  defaultTxType?: TxType
  onClose: () => void
  onDone: () => void
}) {
  const activeWarehouses = warehouses.filter((w) => w.isActive && w.inventoryId === inventory.id)
  const [txType, setTxType] = useState<TxType>(defaultTxType ?? 'IN')
  const [warehouseId, setWarehouseId] = useState<number | null>(activeWarehouses[0]?.id ?? null)
  const [toWarehouseId, setToWarehouseId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [serialsText, setSerialsText] = useState('') // IN 신규/회수 + OUT·MOVE 시리얼 입력(스캔)
  const [requester, setRequester] = useState('') // 요청자 — OUT 필수, IN 선택
  const [lotNo, setLotNo] = useState('') // LOT 관리 품목 신규 입고 — 전표당 1개(전체 시리얼 동일 적용)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 품목 — 고정(상세에서 진입) 또는 모달 내 선택(카드 섹션 버튼)
  const [item, setItem] = useState<ModalItem | null>(fixedItem ?? null)
  const [pickList, setPickList] = useState<PickItem[]>([])
  const [pickSearch, setPickSearch] = useState('')

  const [buckets, setBuckets] = useState<Bucket[]>([])
  const autoWarehousePicked = useRef(false) // 재고 있는 창고 1회 자동 선택

  // 입고/출고 유형 (설정에서 관리)
  const [inReasons, setInReasons] = useState<Reason[]>([])
  const [outReasons, setOutReasons] = useState<Reason[]>([])
  const [reasonId, setReasonId] = useState<number | null>(null)

  // 시리얼 OUT/MOVE — 가용 개체 목록 (참고용 표시·클릭 추가)
  const [units, setUnits] = useState<Unit[]>([])
  const [showAvail, setShowAvail] = useState(false)

  // 출고: 출고처·병원·업무 연결 (병원 연결은 linkHospital 인벤토리만)
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

  const serial = item?.isSerialManaged ?? false
  const needSerialInput = serial && txType !== 'IN' // 출고·이동 — 시리얼 입력/스캔
  const needBucketPick = txType !== 'IN' // 기존 재고 위치에서 선택

  const reasons = txType === 'IN' ? inReasons : txType === 'OUT' ? outReasons : []
  const currentReason = reasons.find((r) => r.id === reasonId)
  const canLinkHospital = txType === 'OUT' && inventory.linkHospital

  const serialLines = serialsText.split('\n').map((s) => s.trim()).filter(Boolean)
  const isReturnIn = txType === 'IN' && currentReason?.value === 'RETURN'
  const needLotInput = !!item?.isLotManaged && serial && txType === 'IN' && !isReturnIn // 시리얼+LOT: 신규 입고 필수
  const optionalLotInput = !!item?.isLotManaged && !serial && txType !== 'MOVE' // 비시리얼+LOT: 전표 단위 선택 기록

  // 마스터 로드 — 입출고 유형 + (품목 미고정 시) 이 인벤토리의 품목 목록
  useEffect(() => {
    fetch('/api/settings/stock-in-type').then(async (r) => {
      if (r.ok) setInReasons((await r.json()).statusCodes ?? [])
    })
    fetch('/api/settings/stock-out-type').then(async (r) => { if (r.ok) setOutReasons((await r.json()).statusCodes ?? []) })
    if (!fixedItem) {
      fetch(`/api/inventory/items?inventoryId=${inventory.id}`).then(async (r) => {
        if (r.ok) setPickList(((await r.json()).items ?? []) as PickItem[])
      })
    }
  }, [inventory.id, fixedItem])

  // 부자재 매핑 로드 — 선택 품목 기준
  useEffect(() => {
    if (!item) { setComponents([]); return }
    fetch(`/api/inventory/items/${item.id}/components`).then(async (r) => {
      if (r.ok) setComponents(((await r.json()).components ?? []) as Component[])
    })
  }, [item])

  // 유형(사유) 정합성 보장 — 현재 탭의 목록에 없는 reasonId면 첫 항목으로 교정
  // (출고 탭으로 바로 열렸을 때 입고 유형이 시드되어 400 나던 버그 방지)
  useEffect(() => {
    if (txType === 'MOVE') return
    const list = txType === 'IN' ? inReasons : outReasons
    if (!list.length) return
    if (!list.some((r) => r.id === reasonId)) setReasonId(list[0].id)
  }, [txType, inReasons, outReasons, reasonId])

  function switchType(t: TxType) {
    setTxType(t)
    setReasonId(t === 'IN' ? (inReasons[0]?.id ?? null) : t === 'OUT' ? (outReasons[0]?.id ?? null) : null)
    setError(null)
    setSerialsText('')
    setToWarehouseId(null)
    autoWarehousePicked.current = false
    if (t !== 'OUT') { setHospital(null); setWorks([]); setSelectedWork(''); setDestination(''); setSetOut(false) }
  }

  function pickItem(id: number | null) {
    const p = pickList.find((x) => x.id === id)
    setItem(p ? { id: p.id, itemCode: p.itemCode, name: p.name, unit: p.unit, isSerialManaged: p.isSerialManaged, isLotManaged: p.isLotManaged } : null)
    setLotNo('')
    setSerialsText('')
    setSetOut(false)
    setError(null)
    autoWarehousePicked.current = false
  }

  // OUT/MOVE: 품목의 위치별 재고 로드 — 현재 위치에 재고가 없으면 재고 있는 위치로 1회 자동 전환
  const loadBuckets = useCallback(async () => {
    if (!needBucketPick || !item) { setBuckets([]); return }
    const res = await fetch(`/api/inventory/stocks?itemId=${item.id}`)
    if (res.ok) {
      const all: Bucket[] = (await res.json()).buckets
      setBuckets(all)
      if (warehouseId && !all.some((b) => b.warehouseId === warehouseId) && all.length > 0 && !autoWarehousePicked.current) {
        autoWarehousePicked.current = true
        setWarehouseId(all[0].warehouseId)
      }
    }
  }, [needBucketPick, item, warehouseId])
  useEffect(() => { loadBuckets() }, [loadBuckets])

  // 시리얼 OUT/MOVE: 선택 위치의 IN_STOCK 개체 로드 (가용 목록 표시용)
  const loadUnits = useCallback(async () => {
    if (!needSerialInput || !warehouseId || !item) { setUnits([]); return }
    const res = await fetch(`/api/inventory/units?itemId=${item.id}&warehouseId=${warehouseId}&status=IN_STOCK`)
    if (res.ok) setUnits((await res.json()).units)
  }, [needSerialInput, warehouseId, item])
  useEffect(() => { loadUnits() }, [loadUnits])

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

  const selectedBucket = buckets.find((b) => b.warehouseId === warehouseId)

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

  const filteredPickList = pickSearch.trim()
    ? pickList.filter((p) => {
        const q = pickSearch.trim().toLowerCase()
        return p.name.toLowerCase().includes(q) || p.itemCode.toLowerCase().includes(q) || (p.modelName ?? '').toLowerCase().includes(q)
      })
    : pickList

  async function submit() {
    setError(null)
    if (!item) { setError('품목을 선택하세요.'); return }
    if (!warehouseId) { setError('위치를 선택하세요.'); return }
    if (txType === 'MOVE' && !toWarehouseId) { setError('도착 위치를 선택하세요.'); return }
    if ((txType === 'IN' || txType === 'OUT') && !reasonId) { setError(`${TYPE_LABEL[txType]} 유형을 선택하세요.`); return }
    if (effectiveQty <= 0) { setError(serial ? '시리얼을 입력하세요.' : '수량을 입력하세요.'); return }
    if (txType === 'OUT' && !requester.trim()) { setError('출고 요청자를 입력하세요. (내부 처리는 "자체 처리" 등으로 기입)'); return }
    if (needLotInput && !lotNo.trim()) { setError('LOT 관리 품목입니다. LOT 번호를 입력하세요.'); return }

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
      toWarehouseId: txType === 'MOVE' ? toWarehouseId : null,
      quantity: effectiveQty,
      destination: txType === 'OUT' ? destination.trim() || null : null,
      requester: txType === 'MOVE' ? null : requester.trim() || null,
      hospitalCode: canLinkHospital ? hospital?.hospitalCode ?? null : null,
      workType: canLinkHospital ? work?.workType ?? null : null,
      refCode: canLinkHospital ? work?.refCode ?? null : null,
      note,
      serials: serial ? serialLines : [], // IN=신규/회수, OUT·MOVE=대상 개체 지정 (서버에서 위치 검증)
      lotBySerial: needLotInput ? Object.fromEntries(serialLines.map((sn) => [sn, lotNo.trim()])) : undefined,
      lotNo: needLotInput || optionalLotInput ? lotNo.trim() || null : null,
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
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              재고 입출고
              <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{inventory.name}</span>
            </h2>
            {item ? (
              <p className="text-xs text-gray-500 mt-0.5">{item.itemCode} · {item.name}{serial && <span className="ml-1 text-indigo-600">(시리얼)</span>}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">품목을 선택하세요</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* 유형 토글 */}
          <div className="flex gap-2">
            {(['IN', 'OUT', 'MOVE'] as TxType[]).map((t) => (
              <button key={t} onClick={() => switchType(t)}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${txType === t ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          {/* 품목 선택 (고정 아닐 때) */}
          {!fixedItem && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">품목 <span className="text-red-500">*</span></label>
              <input value={pickSearch} onChange={(e) => setPickSearch(e.target.value)} placeholder="품목명·모델명·코드 검색" className={inputCls + ' mb-1.5'} />
              <select value={item?.id ?? ''} onChange={(e) => pickItem(e.target.value ? parseInt(e.target.value) : null)} className={inputCls} size={filteredPickList.length > 6 ? 6 : undefined}>
                <option value="">선택하세요 ({filteredPickList.length}개)</option>
                {filteredPickList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.modelName ? ` [${p.modelName}]` : ''} ({p.itemCode}){p.isSerialManaged ? ' — S/N' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {(txType === 'IN' || txType === 'OUT') && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{TYPE_LABEL[txType]} 유형</label>
                <select value={reasonId ?? ''} onChange={(e) => setReasonId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                  {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}
            <div className={txType === 'MOVE' ? 'col-span-2' : ''}>
              <label className="block text-xs font-medium text-gray-700 mb-1">{txType === 'MOVE' ? '출발 위치' : '위치'}</label>
              {txType === 'IN' ? (
                <select value={warehouseId ?? ''} onChange={(e) => setWarehouseId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                  {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              ) : (
                <select value={warehouseId ?? ''} onChange={(e) => setWarehouseId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                  <option value="">선택하세요</option>
                  {activeWarehouses.map((w) => {
                    const b = buckets.find((x) => x.warehouseId === w.id)
                    return <option key={w.id} value={w.id}>{w.name}{b ? ` (재고 ${b.quantity})` : ' (재고 없음)'}</option>
                  })}
                </select>
              )}
              {needBucketPick && item && buckets.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">이 인벤토리에 재고가 없습니다.</p>
              )}
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

          {/* 요청자 — OUT 필수, IN 선택 */}
          {txType !== 'MOVE' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                요청자 {txType === 'OUT' ? <span className="text-red-500">*</span> : <span className="text-gray-400">(선택)</span>}
              </label>
              <input value={requester} onChange={(e) => setRequester(e.target.value)} className={inputCls}
                placeholder={txType === 'OUT' ? '예: 대웅 홍길동, ○○병원 김간호사, 자체 처리' : '요청자가 있으면 입력'} />
            </div>
          )}

          {/* 수량 or 시리얼 */}
          {!item ? null : !serial ? (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                수량 ({item.unit})
                {selectedBucket && needBucketPick && <span className="ml-1 text-gray-400">— 가용 {selectedBucket.quantity}</span>}
              </label>
              <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
              {optionalLotInput && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">LOT 번호 <span className="font-normal text-gray-400">(선택 — 이 전표에 기록)</span></label>
                  <input value={lotNo} onChange={(e) => setLotNo(e.target.value)} className={inputCls + ' font-mono'} placeholder="예: MP26010601" />
                </div>
              )}
            </div>
          ) : txType === 'IN' ? (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">시리얼 입력 · 바코드 스캔 (줄바꿈으로 여러 개) · <b>{effectiveQty}개</b></label>
              <textarea value={serialsText} onChange={(e) => setSerialsText(e.target.value)} rows={5} placeholder={'SN001\nSN002\nSN003\n(바코드 리더기로 연속 스캔 가능)'} className={inputCls + ' font-mono'} />
              {currentReason?.value === 'RETURN' && <p className="mt-1 text-xs text-amber-600">회수: 이 인벤토리에서 출고된 개체의 시리얼을 입력하세요.</p>}
              {needLotInput && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">LOT 번호 <span className="text-red-500">*</span> <span className="font-normal text-gray-400">— 이 전표의 모든 시리얼에 동일 적용</span></label>
                  <input value={lotNo} onChange={(e) => setLotNo(e.target.value)} className={inputCls + ' font-mono'} placeholder="예: LOT2607-01" />
                  <p className="mt-1 text-xs text-gray-400">LOT이 다른 개체는 전표를 나눠 입고하거나 Excel 일괄 입출고(행별 LOT)를 사용하세요.</p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {TYPE_LABEL[txType]} 대상 시리얼 — 직접 입력 · 바코드 스캔 (줄바꿈으로 여러 개) · <b>{effectiveQty}개</b>
                {warehouseId && <span className="ml-1 text-gray-400">/ 가용 {units.length}개</span>}
              </label>
              <textarea value={serialsText} onChange={(e) => setSerialsText(e.target.value)} rows={5}
                placeholder={'SN001\nSN002\n(바코드 리더기로 연속 스캔하거나 붙여넣기)'} className={inputCls + ' font-mono'} disabled={!warehouseId} />
              <p className="mt-1 text-xs text-gray-400">대량 처리: 시리얼을 줄 단위로 붙여넣거나 바코드 리더기로 연속 스캔하세요. 존재하지 않거나 해당 위치 재고가 아닌 시리얼은 확정 시 거부됩니다.</p>
              {warehouseId && units.length > 0 && (
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
          {item && txType === 'OUT' && components.length > 0 && (
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
                  <p className="text-xs text-gray-400">부자재는 주자재와 같은 위치 재고에서 차감됩니다. (수량 = 출고수량 × 구성수량, 수정 가능)</p>
                </div>
              )}
            </div>
          )}

          {/* 출고: 출고처 (+병원 연결 허용 인벤토리만 병원·업무 연결) */}
          {item && txType === 'OUT' && (
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
                <p className="text-xs text-gray-400">병원 연결은 병원 연결 허용 인벤토리(대웅제약재고) 출고에서만 가능합니다.</p>
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
          <button onClick={submit} disabled={busy || !item || effectiveQty <= 0} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? '처리 중...' : `${TYPE_LABEL[txType]} 확정`}
          </button>
        </div>
      </div>
    </div>
  )
}
