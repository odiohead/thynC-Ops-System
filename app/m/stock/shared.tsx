'use client'

import { useEffect, useState } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { Field, MButton, MInput, MSelect, Notice, Section, localDate } from '../_components/ui'

/** 모바일 자재 입출고 공용 — 마스터 로드·공통 입력·전표 제출·완료 화면 (mobile_pwa_design.md §6) */

export type TxType = 'IN' | 'OUT' | 'MOVE'
export const TX_LABEL: Record<TxType, string> = { IN: '입고', OUT: '출고', MOVE: '이동' }

export interface Inventory { id: number; name: string; linkHospital: boolean; isActive: boolean }
export interface Warehouse { id: number; name: string; isActive: boolean; inventoryId: number }
export interface Reason { id: number; name: string; value: string | null }
export interface Item {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  unit: string
  isSerialManaged: boolean
  isLotManaged: boolean
  udiDi: string | null
  isActive: boolean
  inventoryId: number
}

export interface StockMasters {
  inventories: Inventory[]
  warehouses: Warehouse[]
  inReasons: Reason[]
  outReasons: Reason[]
  loaded: boolean
}

/** 인벤토리·위치·입출고 유형 — 화면 진입 시 1회 */
export function useStockMasters(): StockMasters {
  const [m, setM] = useState<StockMasters>({ inventories: [], warehouses: [], inReasons: [], outReasons: [], loaded: false })
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 응답 키별로 아래에서 좁힌다
    const j = (url: string): Promise<Record<string, any>> => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {}))
    Promise.all([
      j('/api/settings/inventories'),
      j('/api/settings/warehouses?activeOnly=true'),
      j('/api/settings/stock-in-type'),
      j('/api/settings/stock-out-type'),
    ]).then(([inv, wh, inR, outR]) => {
      setM({
        inventories: ((inv.inventories ?? []) as Inventory[]).filter((i) => i.isActive),
        warehouses: (wh.warehouses ?? []) as Warehouse[],
        inReasons: (inR.statusCodes ?? []) as Reason[],
        outReasons: (outR.statusCodes ?? []) as Reason[],
        loaded: true,
      })
    }).catch(() => setM((p) => ({ ...p, loaded: true })))
  }, [])
  return m
}

/** 인벤토리의 활성 품목 */
export function useInventoryItems(inventoryId: number | null) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!inventoryId) { setItems([]); return }
    setLoading(true)
    fetch(`/api/inventory/items?inventoryId=${inventoryId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(((d.items ?? []) as Item[]).filter((i) => i.isActive)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [inventoryId])
  return { items, loading }
}

/** 출고 시 세트출고 부자재 매핑 여부 (v1은 모바일에서 동시 출고하지 않음 — 결정 D-2) */
export function useHasComponents(itemId: number | null) {
  const [has, setHas] = useState(false)
  useEffect(() => {
    if (!itemId) { setHas(false); return }
    fetch(`/api/inventory/items/${itemId}/components`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { components: [] }))
      .then((d) => setHas(Array.isArray(d.components) && d.components.length > 0))
      .catch(() => setHas(false))
  }, [itemId])
  return has
}

export interface TxPayload {
  txType: TxType
  reasonId?: number | null
  itemId: number
  warehouseId: number
  toWarehouseId?: number | null
  quantity: number
  destination?: string | null
  requester?: string | null
  hospitalCode?: string | null
  note?: string | null
  txDate?: string | null
  serials?: string[]
  lotBySerial?: Record<string, string | null>
  lotNo?: string | null
  allowUnknownReturn?: boolean
}

export interface TxDoneInfo { id: number; txCode: string; txType: TxType; itemName: string; quantity: number; warehouseName: string; toWarehouseName?: string | null }

export type PostTxResult =
  | { ok: true; tx: TxDoneInfo }
  | { ok: false; error: string; unknownSerials?: string[] }

/** 기존 POST /api/inventory/transactions 그대로 — 서버가 권한·개체 상태·위치·동시성을 다시 검증.
 *  응답 전표에는 품목만 포함되므로 위치명은 화면이 알고 있는 값(names)으로 채운다 */
export async function postTx(p: TxPayload, names: { warehouseName: string; toWarehouseName?: string | null }): Promise<PostTxResult> {
  try {
    const res = await fetch('/api/inventory/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitIds: [], components: [], ...p }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.transaction) {
      const t = data.transaction
      return {
        ok: true,
        tx: { id: t.id, txCode: t.txCode, txType: t.txType, itemName: t.item?.name ?? '', quantity: t.quantity, warehouseName: names.warehouseName, toWarehouseName: names.toWarehouseName ?? null },
      }
    }
    if (res.status === 409 && data.code === 'UNKNOWN_RETURN_SERIALS' && Array.isArray(data.unknownSerials)) {
      return { ok: false, error: data.error ?? '출고 이력이 없는 시리얼이 있습니다.', unknownSerials: data.unknownSerials }
    }
    return { ok: false, error: data.error ?? `처리에 실패했습니다. (${res.status})` }
  } catch {
    return { ok: false, error: '네트워크 오류로 처리하지 못했습니다. 다시 시도하세요.' }
  }
}

/** 출고 공통 입력 — 유형·요청자·출고처·병원(병원 연결 인벤토리만)·입출고일·비고 */
export interface OutFields { reasonId: number | ''; requester: string; destination: string; hospital: { hospitalCode: string; hospitalName: string } | null; txDate: string; note: string }
export const emptyOutFields = (requester = ''): OutFields => ({ reasonId: '', requester, destination: '', hospital: null, txDate: localDate(0), note: '' })

export function OutFieldsForm({ value, onChange, reasons, linkHospital }: { value: OutFields; onChange: (v: OutFields) => void; reasons: Reason[]; linkHospital: boolean }) {
  const set = (patch: Partial<OutFields>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-3">
      <Field label="출고 유형" required>
        <MSelect value={value.reasonId} onChange={(e) => set({ reasonId: e.target.value ? Number(e.target.value) : '' })}>
          <option value="">선택</option>
          {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </MSelect>
      </Field>
      <Field label="요청자" required>
        <MInput value={value.requester} onChange={(e) => set({ requester: e.target.value })} />
      </Field>
      {linkHospital && <HospitalPicker value={value.hospital} onChange={(h) => set({ hospital: h })} />}
      <Field label="출고처">
        <MInput value={value.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="선택 입력" />
      </Field>
      <Field label="출고일">
        <MInput type="date" value={value.txDate} max={localDate(0)} onChange={(e) => set({ txDate: e.target.value })} />
      </Field>
      <Field label="비고">
        <MInput value={value.note} onChange={(e) => set({ note: e.target.value })} placeholder="선택 입력" />
      </Field>
    </div>
  )
}

function HospitalPicker({ value, onChange }: { value: { hospitalCode: string; hospitalName: string } | null; onChange: (h: { hospitalCode: string; hospitalName: string } | null) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ hospitalCode: string; hospitalName: string }[]>([])
  useEffect(() => {
    if (value || q.trim().length < 2) { setResults([]); return }
    const t = setTimeout(() => {
      fetch(`/api/hospitals?search=${encodeURIComponent(q.trim())}&limit=20`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { hospitals: [] }))
        .then((d) => setResults(d.hospitals ?? []))
        .catch(() => setResults([]))
    }, 250)
    return () => clearTimeout(t)
  }, [q, value])
  return (
    <Field label="병원" hint="출고 개체에 설치 병원이 기록됩니다">
      {value ? (
        <div className="flex h-12 items-center justify-between rounded-xl border border-primary/40 bg-primary-subtle px-3.5">
          <span className="truncate text-base">{value.hospitalName}</span>
          <button type="button" onClick={() => onChange(null)} className="shrink-0 text-sm text-primary">변경</button>
        </div>
      ) : (
        <div className="space-y-1">
          <MInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="병원명 검색 (선택)" />
          {results.length > 0 && (
            <ul className="max-h-56 overflow-y-auto rounded-xl border border-border bg-card">
              {results.map((h) => (
                <li key={h.hospitalCode}>
                  <button type="button" onClick={() => { onChange(h); setQ('') }} className="block w-full border-b border-border px-3.5 py-3 text-left text-sm last:border-0 active:bg-accent">
                    {h.hospitalName} <span className="text-xs text-muted-foreground">{h.hospitalCode}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  )
}

export function validateOut(f: OutFields): string | null {
  if (!f.reasonId) return '출고 유형을 선택하세요.'
  if (!f.requester.trim()) return '요청자를 입력하세요.'
  return null
}

export function outPayloadFields(f: OutFields, linkHospital: boolean): Pick<TxPayload, 'reasonId' | 'requester' | 'destination' | 'hospitalCode' | 'txDate' | 'note'> {
  return {
    reasonId: f.reasonId || null,
    requester: f.requester.trim() || null,
    destination: f.destination.trim() || null,
    hospitalCode: linkHospital ? f.hospital?.hospitalCode ?? null : null,
    txDate: f.txDate || null,
    note: f.note.trim() || null,
  }
}

/** 처리 완료 화면 */
export function TxDone({ tx, onNew }: { tx: TxDoneInfo; onNew: () => void }) {
  return (
    <div className="space-y-4">
      <Section>
        <div className="flex flex-col items-center gap-2 py-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-subtle text-success"><Check size={30} strokeWidth={3} /></span>
          <p className="text-lg font-bold">{TX_LABEL[tx.txType]} 완료</p>
          <p className="font-mono text-sm text-muted-foreground">{tx.txCode}</p>
        </div>
        <dl className="mt-2 grid grid-cols-[4.5rem_1fr] gap-y-1 border-t border-border pt-3 text-sm">
          <dt className="text-muted-foreground">품목</dt><dd>{tx.itemName}</dd>
          <dt className="text-muted-foreground">수량</dt><dd>{tx.quantity}</dd>
          <dt className="text-muted-foreground">{tx.txType === 'MOVE' ? '출발' : '위치'}</dt><dd>{tx.warehouseName}</dd>
          {tx.toWarehouseName && (<><dt className="text-muted-foreground">도착</dt><dd>{tx.toWarehouseName}</dd></>)}
        </dl>
      </Section>
      <MButton size="lg" className="w-full" onClick={onNew}>새 전표</MButton>
      <a href={`/inventory/transactions/${tx.id}`} className="flex items-center justify-center gap-1 text-sm text-primary">
        PC 화면에서 전표 보기 <ExternalLink size={14} />
      </a>
    </div>
  )
}

export function ErrorNotice({ error }: { error: string }) {
  return error ? <Notice tone="error">{error}</Notice> : null
}
