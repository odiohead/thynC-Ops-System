'use client'

import { useMemo, useRef, useState } from 'react'
import { ScanLine, Trash2, AlertTriangle } from 'lucide-react'
import BarcodeScanner, { type ScanFeedback } from '../_components/BarcodeScanner'
import Modal from '@/app/components/ui/Modal'
import { Field, MButton, MInput, MSelect, Notice, Section, localDate } from '../_components/ui'
import { lookupCode } from '../_components/stockApi'
import { type StockMasters, type TxDoneInfo, postTx, useInventoryItems, ErrorNotice } from './shared'

/**
 * 입고 — "품목 먼저" (mobile_pwa_design.md §6.6). 신규 시리얼은 DB에 없어 스캔만으로 품목을 알 수 없다.
 * 유형(구매·회수·기타) → 인벤토리·품목·위치 → 연속 스캔. GS1 라벨의 LOT(AI 10)은 시리얼마다 자동, 없으면 공통 LOT.
 * 회수: 같은 품목의 출고 개체를 복귀. 출고 이력이 없는 시리얼은 담고 제출 시 서버 409 → 확인 후 신규 등록(데스크톱과 동일 계약).
 * 수량 품목: 수량만 입력. 비시리얼 LOT 품목은 v1 범위 밖(PC 처리, §6.8).
 */
interface Line { serial: string; lot: string | null; unknownReturn: boolean; gtinMismatch: boolean }

const RETURN = 'RETURN'

export default function InFlow({ masters, requesterName, onDone }: { masters: StockMasters; requesterName: string; onDone: (tx: TxDoneInfo) => void }) {
  const [reasonId, setReasonId] = useState<number | ''>('')
  const [inventoryId, setInventoryId] = useState<number | ''>('')
  const [itemId, setItemId] = useState<number | ''>('')
  const [warehouseId, setWarehouseId] = useState<number | ''>('')
  const { items, loading: itemsLoading } = useInventoryItems(inventoryId || null)

  const [lines, setLines] = useState<Line[]>([])
  const linesRef = useRef<Line[]>([])
  linesRef.current = lines
  const [qty, setQty] = useState(1)
  const [commonLot, setCommonLot] = useState('')
  const [requester, setRequester] = useState(requesterName)
  const [destination, setDestination] = useState('')
  const [txDate, setTxDate] = useState(localDate(0))
  const [note, setNote] = useState('')

  const [scanOpen, setScanOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unknownConfirm, setUnknownConfirm] = useState<string[] | null>(null)

  const reason = masters.inReasons.find((r) => r.id === reasonId)
  const isReturn = reason?.value === RETURN
  const item = items.find((i) => i.id === itemId) ?? null
  const inventory = masters.inventories.find((i) => i.id === inventoryId) ?? null
  const warehouses = useMemo(() => masters.warehouses.filter((w) => w.inventoryId === inventoryId), [masters.warehouses, inventoryId])
  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? null
  const ready = !!reason && !!item && !!warehouse
  const lotBlocked = !!item && !item.isSerialManaged && item.isLotManaged

  // 문맥(유형·품목·위치)이 바뀌면 담은 목록은 무효
  function changeCtx(fn: () => void) {
    if (linesRef.current.length > 0 && !window.confirm('담은 시리얼이 비워집니다. 계속할까요?')) return
    fn()
    setLines([])
    setError('')
  }

  async function onDetect(raw: string): Promise<ScanFeedback> {
    if (!item) return { tone: 'error', message: '품목을 먼저 선택하세요' }
    const r = await lookupCode(raw)
    const p = r.parsed
    if (p.serialCandidates.length === 0) {
      return { tone: 'error', message: p.gtin ? '시리얼이 없는 라벨입니다 (GTIN만 있음)' : '인식한 값에 시리얼이 없습니다' }
    }
    const existing = r.units.find((u) => u.item.id === item.id)
    // 같은 품목에 개체가 있으면 저장된 시리얼 표기를 그대로 쓴다(서버 대조는 정확 일치)
    const serial = existing?.serialNo ?? p.serialCandidates[0]
    if (linesRef.current.some((l) => l.serial.toUpperCase() === serial.toUpperCase())) return { tone: 'warn', message: `이미 담김 — ${serial}` }

    let unknownReturn = false
    if (isReturn) {
      if (existing?.status === 'IN_STOCK') return { tone: 'error', message: `이미 재고에 있습니다 — ${serial} (${existing.warehouse?.name ?? ''})` }
      if (!existing) unknownReturn = true
    } else if (existing) {
      return { tone: 'error', message: `이미 등록된 시리얼 — ${serial}` }
    }
    const gtinMismatch = !!(p.gtin && item.udiDi && p.gtin !== item.udiDi)
    const line: Line = { serial, lot: p.lot ?? null, unknownReturn, gtinMismatch }
    const next = [line, ...linesRef.current]
    linesRef.current = next
    setLines(next)
    if (gtinMismatch) return { tone: 'warn', message: `UDI 불일치 — 다른 품목 라벨일 수 있습니다 (${serial})` }
    if (unknownReturn) return { tone: 'warn', message: `출고 이력 없음 — ${serial} (제출 시 확인)` }
    return { tone: 'ok', message: `${serial}${line.lot ? ` · LOT ${line.lot}` : ''} — ${next.length}개` }
  }

  async function submit(allowUnknownReturn = false) {
    if (!ready || !item || !warehouse) return
    setError('')
    const serial = item.isSerialManaged
    const quantity = serial ? lines.length : qty
    if (quantity <= 0) { setError(serial ? '시리얼을 스캔하세요.' : '수량을 입력하세요.'); return }
    let lotBySerial: Record<string, string | null> | undefined
    if (serial && item.isLotManaged) {
      lotBySerial = Object.fromEntries(lines.map((l) => [l.serial, l.lot ?? (commonLot.trim() || null)]))
      // 신규 입고는 LOT 필수 (회수의 기존 개체는 LOT 불필요 — 서버가 미등록분만 사용)
      const needLot = lines.filter((l) => (!isReturn || l.unknownReturn) && !lotBySerial![l.serial])
      if (needLot.length > 0) { setError(`LOT 관리 품목입니다. LOT가 없는 시리얼 ${needLot.length}개 — 공통 LOT를 입력하세요.`); return }
    }
    setBusy(true)
    const res = await postTx(
      {
        txType: 'IN',
        reasonId: reason!.id,
        itemId: item.id,
        warehouseId: warehouse.id,
        quantity,
        serials: serial ? lines.map((l) => l.serial) : [],
        lotBySerial,
        requester: requester.trim() || null,
        destination: destination.trim() || null,
        txDate: txDate || null,
        note: note.trim() || null,
        allowUnknownReturn,
      },
      { warehouseName: warehouse.name }
    )
    setBusy(false)
    if (res.ok) {
      setLines([]); setQty(1); setCommonLot(''); setNote(''); setUnknownConfirm(null)
      onDone(res.tx)
      return
    }
    if (res.unknownSerials) { setUnknownConfirm(res.unknownSerials); return }
    setError(res.error)
  }

  return (
    <div className="space-y-4">
      <Section title="입고 대상">
        <div className="space-y-3">
          <Field label="입고 유형" required>
            <MSelect value={reasonId} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ''; changeCtx(() => setReasonId(v)) }}>
              <option value="">선택</option>
              {masters.inReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </MSelect>
          </Field>
          <Field label="인벤토리" required>
            <MSelect value={inventoryId} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ''; changeCtx(() => { setInventoryId(v); setItemId(''); setWarehouseId('') }) }}>
              <option value="">선택</option>
              {masters.inventories.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </MSelect>
          </Field>
          <Field label="품목" required>
            <MSelect value={itemId} disabled={!inventoryId || itemsLoading} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ''; changeCtx(() => setItemId(v)) }}>
              <option value="">{itemsLoading ? '불러오는 중…' : '선택'}</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.modelName ? ` (${i.modelName})` : ''}{i.isSerialManaged ? ' · 시리얼' : ''}</option>)}
            </MSelect>
          </Field>
          <Field label="입고 위치" required>
            <MSelect value={warehouseId} disabled={!inventoryId} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">선택</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </MSelect>
          </Field>
        </div>
      </Section>

      {lotBlocked && <Notice tone="warning">수량 품목 중 LOT 관리 품목은 모바일에서 아직 지원하지 않습니다. PC에서 처리하세요.</Notice>}

      {ready && item && !lotBlocked && (
        <>
          {item.isSerialManaged ? (
            <>
              <div className="flex items-center justify-between px-1">
                <p className="text-sm font-semibold">스캔한 시리얼 <span className="text-primary">{lines.length}</span>개</p>
                {lines.length > 0 && <button type="button" onClick={() => setScanOpen(true)} className="flex items-center gap-1 text-sm font-semibold text-primary"><ScanLine size={16} /> 계속 스캔</button>}
              </div>
              {lines.length === 0 ? (
                <MButton size="lg" className="w-full" onClick={() => setScanOpen(true)}><ScanLine size={22} /> 스캔 시작</MButton>
              ) : (
                <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                  {lines.map((l) => (
                    <li key={l.serial} className="flex items-center justify-between gap-2 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm font-semibold">{l.serial}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {l.lot ? `LOT ${l.lot}` : item.isLotManaged ? (commonLot ? `LOT ${commonLot} (공통)` : 'LOT 없음') : ''}
                          {l.unknownReturn && <span className="ml-1 text-warning">· 출고 이력 없음</span>}
                          {l.gtinMismatch && <span className="ml-1 text-warning">· UDI 불일치</span>}
                        </span>
                      </span>
                      <button type="button" onClick={() => setLines(lines.filter((x) => x.serial !== l.serial))} aria-label="빼기" className="shrink-0 rounded-lg p-2 text-muted-foreground active:bg-accent"><Trash2 size={18} /></button>
                    </li>
                  ))}
                </ul>
              )}
              {item.isLotManaged && (
                <Field label="공통 LOT" hint="바코드에 LOT가 없는 시리얼에 적용됩니다">
                  <MInput value={commonLot} onChange={(e) => setCommonLot(e.target.value)} autoCapitalize="characters" className="font-mono" />
                </Field>
              )}
            </>
          ) : (
            <Section>
              <Field label={`수량 (${item.unit})`} required>
                <div className="flex items-center gap-2">
                  <MButton variant="outline" className="h-12 w-12 shrink-0 px-0 text-xl" onClick={() => setQty(Math.max(1, qty - 1))}>−</MButton>
                  <MInput type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} className="text-center text-lg font-semibold" />
                  <MButton variant="outline" className="h-12 w-12 shrink-0 px-0 text-xl" onClick={() => setQty(qty + 1)}>+</MButton>
                </div>
              </Field>
            </Section>
          )}

          <Section title="입고 정보">
            <div className="space-y-3">
              <Field label="요청자"><MInput value={requester} onChange={(e) => setRequester(e.target.value)} /></Field>
              <Field label="발송처"><MInput value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="선택 입력" /></Field>
              <Field label="입고일"><MInput type="date" value={txDate} max={localDate(0)} onChange={(e) => setTxDate(e.target.value)} /></Field>
              <Field label="비고"><MInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="선택 입력" /></Field>
              <ErrorNotice error={error} />
              <MButton size="lg" className="w-full" disabled={busy || (item.isSerialManaged ? lines.length === 0 : qty <= 0)} onClick={() => void submit()}>
                {busy ? '처리 중…' : `입고 처리 · ${item.isSerialManaged ? lines.length : qty}${item.isSerialManaged ? '개' : item.unit}`}
              </MButton>
            </div>
          </Section>
        </>
      )}

      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetect={onDetect}
        title={`입고 · ${item?.name ?? ''}`}
        counter={`${lines.length}개`}
        footer={lines[0] && <p className="truncate text-center font-mono text-xs text-white/60">최근: {lines.slice(0, 3).map((l) => l.serial).join(' · ')}</p>}
      />

      <Modal open={!!unknownConfirm} onClose={() => !busy && setUnknownConfirm(null)} title="출고 이력이 없는 시리얼">
        {unknownConfirm && (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
              <span>{inventory?.name} · {item?.name}에 출고 기록이 없는 시리얼 {unknownConfirm.length}개가 있습니다. 자재관리 도입 전에 출고된 기기라면 신규 개체로 등록해 입고합니다.</span>
            </p>
            <ul className="max-h-40 overflow-y-auto rounded-xl bg-muted p-3 font-mono text-sm">
              {unknownConfirm.map((s) => <li key={s}>{s}</li>)}
            </ul>
            <p className="text-xs text-muted-foreground">오타라면 취소하고 해당 시리얼을 목록에서 빼세요.</p>
            <div className="flex gap-2">
              <MButton variant="outline" className="flex-1" disabled={busy} onClick={() => setUnknownConfirm(null)}>취소</MButton>
              <MButton className="flex-1" disabled={busy} onClick={() => void submit(true)}>{busy ? '처리 중…' : '신규 등록하고 입고'}</MButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
