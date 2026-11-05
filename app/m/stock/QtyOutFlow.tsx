'use client'

import { useEffect, useMemo, useState } from 'react'
import { Field, MButton, MInput, MSelect, Notice, Section } from '../_components/ui'
import {
  type StockMasters, type TxDoneInfo, type OutFields,
  OutFieldsForm, emptyOutFields, validateOut, outPayloadFields, postTx, useInventoryItems, useHasComponents, ErrorNotice,
} from './shared'

/**
 * 바코드 없는 수량 품목 출고·이동 (mobile_pwa_design.md §6.8) — 인벤토리 → 품목 → 위치(가용 재고) → 수량.
 * 시리얼 품목은 스캔 화면으로, 비시리얼 LOT 품목은 PC로 안내(LOT 버킷 선택 UI는 v1 범위 밖).
 */
interface Bucket { warehouseId: number; warehouseName: string; lotNo: string; quantity: number }

export default function QtyOutFlow({ txType, masters, requesterName, onDone }: {
  txType: 'OUT' | 'MOVE'
  masters: StockMasters
  requesterName: string
  onDone: (tx: TxDoneInfo) => void
}) {
  const [inventoryId, setInventoryId] = useState<number | ''>('')
  const [itemId, setItemId] = useState<number | ''>('')
  const [warehouseId, setWarehouseId] = useState<number | ''>('')
  const [qty, setQty] = useState(1)
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [out, setOut] = useState<OutFields>(() => emptyOutFields(requesterName))
  const [toWarehouseId, setToWarehouseId] = useState<number | ''>('')
  const [moveNote, setMoveNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const { items, loading } = useInventoryItems(inventoryId || null)
  const qtyItems = useMemo(() => items.filter((i) => !i.isSerialManaged), [items])
  const item = qtyItems.find((i) => i.id === itemId) ?? null
  const inventory = masters.inventories.find((i) => i.id === inventoryId) ?? null
  const lotBlocked = !!item?.isLotManaged
  const hasComponents = useHasComponents(txType === 'OUT' ? item?.id ?? null : null)
  const label = txType === 'OUT' ? '출고' : '이동'

  useEffect(() => {
    setWarehouseId('')
    setBuckets([])
    if (!item) return
    fetch(`/api/inventory/stocks?itemId=${item.id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { buckets: [] }))
      .then((d) => setBuckets(((d.buckets ?? []) as Bucket[]).filter((b) => b.lotNo === '')))
      .catch(() => setBuckets([]))
  }, [item])

  const bucket = buckets.find((b) => b.warehouseId === warehouseId) ?? null
  const toWarehouses = masters.warehouses.filter((w) => w.inventoryId === inventoryId && w.id !== warehouseId)

  async function submit() {
    if (!item || !bucket) return
    setError('')
    if (qty <= 0 || qty > bucket.quantity) { setError(`수량은 1~${bucket.quantity} 사이로 입력하세요.`); return }
    if (txType === 'OUT') {
      const v = validateOut(out)
      if (v) { setError(v); return }
    } else if (!toWarehouseId) { setError('도착 위치를 선택하세요.'); return }
    setBusy(true)
    const toWh = toWarehouses.find((w) => w.id === toWarehouseId)
    const res = await postTx(
      {
        txType,
        itemId: item.id,
        warehouseId: bucket.warehouseId,
        quantity: qty,
        ...(txType === 'OUT'
          ? outPayloadFields(out, !!inventory?.linkHospital)
          : { toWarehouseId: Number(toWarehouseId), note: moveNote.trim() || null }),
      },
      { warehouseName: bucket.warehouseName, toWarehouseName: toWh?.name ?? null }
    )
    setBusy(false)
    if (res.ok) {
      setQty(1); setOut(emptyOutFields(requesterName)); setToWarehouseId(''); setMoveNote('')
      onDone(res.tx)
    } else setError(res.error)
  }

  return (
    <div className="space-y-4">
      <Section title={`수량 품목 ${label}`}>
        <div className="space-y-3">
          <Field label="인벤토리" required>
            <MSelect value={inventoryId} onChange={(e) => { setInventoryId(e.target.value ? Number(e.target.value) : ''); setItemId('') }}>
              <option value="">선택</option>
              {masters.inventories.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </MSelect>
          </Field>
          <Field label="품목" required hint="시리얼 품목은 스캔으로 처리합니다">
            <MSelect value={itemId} disabled={!inventoryId || loading} onChange={(e) => setItemId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">{loading ? '불러오는 중…' : qtyItems.length === 0 && inventoryId ? '수량 품목 없음' : '선택'}</option>
              {qtyItems.map((i) => <option key={i.id} value={i.id}>{i.name}{i.modelName ? ` (${i.modelName})` : ''}</option>)}
            </MSelect>
          </Field>
          {item && !lotBlocked && (
            <Field label={txType === 'MOVE' ? '출발 위치' : '위치'} required>
              <MSelect value={warehouseId} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">{buckets.length === 0 ? '재고 없음' : '선택'}</option>
                {buckets.map((b) => <option key={b.warehouseId} value={b.warehouseId}>{b.warehouseName} — 재고 {b.quantity}{item.unit}</option>)}
              </MSelect>
            </Field>
          )}
        </div>
      </Section>

      {lotBlocked && <Notice tone="warning">LOT 관리 수량 품목은 모바일에서 아직 지원하지 않습니다. PC에서 처리하세요.</Notice>}

      {item && bucket && !lotBlocked && (
        <Section title={`${label} 정보`}>
          <div className="space-y-3">
            <Field label={`수량 (${item.unit}, 최대 ${bucket.quantity})`} required>
              <div className="flex items-center gap-2">
                <MButton variant="outline" className="h-12 w-12 shrink-0 px-0 text-xl" onClick={() => setQty(Math.max(1, qty - 1))}>−</MButton>
                <MInput type="number" inputMode="numeric" min={1} max={bucket.quantity} value={qty} onChange={(e) => setQty(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} className="text-center text-lg font-semibold" />
                <MButton variant="outline" className="h-12 w-12 shrink-0 px-0 text-xl" onClick={() => setQty(Math.min(bucket.quantity, qty + 1))}>+</MButton>
              </div>
            </Field>
            {txType === 'OUT' ? (
              <>
                {hasComponents && <Notice tone="warning">세트출고 부자재가 매핑된 품목입니다. 모바일은 본품만 출고합니다.</Notice>}
                <OutFieldsForm value={out} onChange={setOut} reasons={masters.outReasons} linkHospital={!!inventory?.linkHospital} />
              </>
            ) : (
              <>
                <Field label="도착 위치" required>
                  <MSelect value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">선택</option>
                    {toWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </MSelect>
                </Field>
                <Field label="비고"><MInput value={moveNote} onChange={(e) => setMoveNote(e.target.value)} placeholder="선택 입력" /></Field>
              </>
            )}
            <ErrorNotice error={error} />
            <MButton size="lg" className="w-full" disabled={busy} onClick={() => void submit()}>
              {busy ? '처리 중…' : `${label} 처리 · ${qty}${item.unit}`}
            </MButton>
          </div>
        </Section>
      )}
    </div>
  )
}
