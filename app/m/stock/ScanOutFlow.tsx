'use client'

import { useMemo, useRef, useState } from 'react'
import { ScanLine, Trash2, Package } from 'lucide-react'
import BarcodeScanner, { type ScanFeedback } from '../_components/BarcodeScanner'
import UnitCard from '../_components/UnitCard'
import Modal from '@/app/components/ui/Modal'
import { Field, MButton, MSelect, MInput, Notice, Section } from '../_components/ui'
import { lookupCode, unitWhere, type LookupUnit } from '../_components/stockApi'
import {
  type StockMasters, type TxDoneInfo, type OutFields,
  OutFieldsForm, emptyOutFields, validateOut, outPayloadFields, postTx, useHasComponents, ErrorNotice,
} from './shared'

/**
 * 시리얼 품목 출고·이동 — "스캔 먼저" (mobile_pwa_design.md §6.4·§6.5)
 * 첫 스캔이 전표 문맥(품목·인벤토리·출발 위치)을 정하고, 이후 스캔은 같은 품목·같은 위치의 재고 개체만 담는다(1전표 1품목, D-3).
 * 전표 요청에는 스캔 원문이 아니라 조회로 확인한 개체의 저장 시리얼을 보낸다.
 */
interface Ctx {
  itemId: number
  itemName: string
  modelName: string | null
  inventoryId: number
  inventoryName: string
  linkHospital: boolean
  warehouseId: number
  warehouseName: string
}

export default function ScanOutFlow({ txType, masters, requesterName, onDone }: {
  txType: 'OUT' | 'MOVE'
  masters: StockMasters
  requesterName: string
  onDone: (tx: TxDoneInfo) => void
}) {
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [lines, setLines] = useState<LookupUnit[]>([])
  const linesRef = useRef<LookupUnit[]>([])
  linesRef.current = lines
  const ctxRef = useRef<Ctx | null>(null)
  ctxRef.current = ctx

  const [scanOpen, setScanOpen] = useState(false)
  const [choice, setChoice] = useState<LookupUnit[] | null>(null) // 첫 스캔이 여러 재고 개체에 걸릴 때
  const [step, setStep] = useState<'scan' | 'confirm'>('scan')
  const [out, setOut] = useState<OutFields>(() => emptyOutFields(requesterName))
  const [toWarehouseId, setToWarehouseId] = useState<number | ''>('')
  const [moveNote, setMoveNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasComponents = useHasComponents(txType === 'OUT' ? ctx?.itemId ?? null : null)

  const label = txType === 'OUT' ? '출고' : '이동'
  const toWarehouses = useMemo(
    () => (ctx ? masters.warehouses.filter((w) => w.inventoryId === ctx.inventoryId && w.id !== ctx.warehouseId) : []),
    [ctx, masters.warehouses]
  )

  function ctxOf(u: LookupUnit): Ctx {
    return {
      itemId: u.item.id, itemName: u.item.name, modelName: u.item.modelName,
      inventoryId: u.inventory.id, inventoryName: u.inventory.name, linkHospital: u.inventory.linkHospital,
      warehouseId: u.warehouse!.id, warehouseName: u.warehouse!.name,
    }
  }

  function add(u: LookupUnit) {
    const next = [u, ...linesRef.current]
    linesRef.current = next
    setLines(next)
  }

  async function onDetect(raw: string): Promise<ScanFeedback> {
    const r = await lookupCode(raw)
    const serial = r.parsed.serialCandidates[0]
    if (!serial) {
      return { tone: 'error', message: r.parsed.gtin ? '시리얼이 없는 라벨입니다 (GTIN만 있음)' : '인식한 값에 시리얼이 없습니다' }
    }
    if (r.units.length === 0) return { tone: 'error', message: `미등록 시리얼 — ${serial}` }

    const c = ctxRef.current
    if (!c) {
      const inStock = r.units.filter((u) => u.status === 'IN_STOCK' && u.warehouse && u.item.isActive)
      if (inStock.length === 0) {
        if (r.units.some((u) => u.status === 'IN_STOCK')) return { tone: 'error', message: '비활성 품목의 재고입니다 — PC에서 확인하세요' }
        const u = r.units[0]
        return { tone: 'error', message: `재고가 아닙니다 — ${u.status === 'OUT' ? `출고됨 (${unitWhere(u)})` : '폐기'}` }
      }
      if (inStock.length > 1) {
        setChoice(inStock)
        setScanOpen(false)
        return { tone: 'warn', message: '같은 시리얼 재고가 여러 곳 — 선택하세요' }
      }
      const u = inStock[0]
      const nc = ctxOf(u)
      ctxRef.current = nc
      setCtx(nc)
      add(u)
      return { tone: 'ok', message: `${u.item.name} · ${u.warehouse!.name} — 1개` }
    }

    const same = r.units.find((u) => u.item.id === c.itemId)
    if (!same) {
      return { tone: 'error', message: `다른 품목입니다 (${r.units[0].item.name}) — 이 전표를 먼저 처리하세요` }
    }
    if (linesRef.current.some((l) => l.id === same.id)) return { tone: 'warn', message: `이미 담김 — ${same.serialNo}` }
    if (same.status !== 'IN_STOCK') return { tone: 'error', message: `재고가 아닙니다 — ${same.status === 'OUT' ? `출고됨 (${unitWhere(same)})` : '폐기'}` }
    if (same.warehouse?.id !== c.warehouseId) return { tone: 'error', message: `다른 위치(${same.warehouse?.name ?? '-'})의 개체입니다` }
    add(same)
    return { tone: 'ok', message: `${same.serialNo} — ${linesRef.current.length}개` }
  }

  function pickChoice(u: LookupUnit) {
    const nc = ctxOf(u)
    ctxRef.current = nc
    setCtx(nc)
    add(u)
    setChoice(null)
    setScanOpen(true)
  }

  function remove(id: number) {
    const next = lines.filter((l) => l.id !== id)
    setLines(next)
    if (next.length === 0) { setCtx(null); setStep('scan') }
  }

  function reset() {
    setLines([]); setCtx(null); setStep('scan'); setError(''); setOut(emptyOutFields(requesterName)); setToWarehouseId(''); setMoveNote('')
  }

  async function submit() {
    if (!ctx || lines.length === 0) return
    setError('')
    if (txType === 'OUT') {
      const v = validateOut(out)
      if (v) { setError(v); return }
    } else if (!toWarehouseId) {
      setError('도착 위치를 선택하세요.'); return
    }
    setBusy(true)
    const toWh = toWarehouses.find((w) => w.id === toWarehouseId)
    const res = await postTx(
      {
        txType,
        itemId: ctx.itemId,
        warehouseId: ctx.warehouseId,
        quantity: lines.length,
        serials: lines.map((l) => l.serialNo),
        ...(txType === 'OUT'
          ? outPayloadFields(out, ctx.linkHospital)
          : { toWarehouseId: Number(toWarehouseId), note: moveNote.trim() || null }),
      },
      { warehouseName: ctx.warehouseName, toWarehouseName: toWh?.name ?? null }
    )
    setBusy(false)
    if (res.ok) { reset(); onDone(res.tx) } else setError(res.error)
  }

  return (
    <div className="space-y-4">
      {!ctx ? (
        <Section>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-subtle text-primary"><ScanLine size={30} /></span>
            <p className="text-sm text-muted-foreground">{label}할 기기의 바코드를 스캔하세요.<br />첫 스캔으로 품목과 위치가 정해집니다.</p>
          </div>
          <MButton size="lg" className="w-full" onClick={() => setScanOpen(true)}><ScanLine size={22} /> 스캔 시작</MButton>
        </Section>
      ) : (
        <>
          <Section
            title={<span className="flex items-center gap-1.5"><Package size={16} className="text-primary" /> {ctx.itemName}</span>}
            right={<button type="button" onClick={() => { if (window.confirm('담은 목록을 비우고 처음부터 할까요?')) reset() }} className="text-sm text-muted-foreground">초기화</button>}
          >
            <dl className="grid grid-cols-[4.5rem_1fr] gap-y-0.5 text-sm">
              <dt className="text-muted-foreground">인벤토리</dt><dd>{ctx.inventoryName}</dd>
              <dt className="text-muted-foreground">{txType === 'MOVE' ? '출발' : '위치'}</dt><dd>{ctx.warehouseName}</dd>
              {ctx.modelName && (<><dt className="text-muted-foreground">모델</dt><dd>{ctx.modelName}</dd></>)}
            </dl>
          </Section>

          {step === 'scan' && (
            <>
              <div className="flex items-center justify-between px-1">
                <p className="text-sm font-semibold">담은 개체 <span className="text-primary">{lines.length}</span>개</p>
                <button type="button" onClick={() => setScanOpen(true)} className="flex items-center gap-1 text-sm font-semibold text-primary"><ScanLine size={16} /> 계속 스캔</button>
              </div>
              <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm font-semibold">{l.serialNo}</span>
                      {l.lotNo && <span className="block truncate text-xs text-muted-foreground">LOT {l.lotNo}</span>}
                    </span>
                    <button type="button" onClick={() => remove(l.id)} aria-label="빼기" className="shrink-0 rounded-lg p-2 text-muted-foreground active:bg-accent"><Trash2 size={18} /></button>
                  </li>
                ))}
              </ul>
              <MButton size="lg" className="w-full" onClick={() => setStep('confirm')}>다음 · {label} 정보 입력</MButton>
            </>
          )}

          {step === 'confirm' && (
            <Section title={`${label} 정보 · ${lines.length}개`} right={<button type="button" onClick={() => setStep('scan')} className="text-sm text-primary">목록으로</button>}>
              {txType === 'OUT' ? (
                <>
                  {hasComponents && (
                    <Notice tone="warning" className="mb-3">이 품목은 세트출고 부자재가 매핑되어 있습니다. 모바일은 본품만 출고합니다. 부자재 동시 출고는 PC에서 처리하세요.</Notice>
                  )}
                  <Notice className="mb-3">프로젝트 출고는 <b>출고업무(출고요청) 처리</b>가 정식 경로입니다(기기현황 자동 등록). 여기서는 일반 재고 출고 전표만 만듭니다.</Notice>
                  <OutFieldsForm value={out} onChange={setOut} reasons={masters.outReasons} linkHospital={ctx.linkHospital} />
                </>
              ) : (
                <div className="space-y-3">
                  <Field label="도착 위치" required>
                    <MSelect value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value ? Number(e.target.value) : '')}>
                      <option value="">선택</option>
                      {toWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </MSelect>
                  </Field>
                  <Field label="비고"><MInput value={moveNote} onChange={(e) => setMoveNote(e.target.value)} placeholder="선택 입력" /></Field>
                </div>
              )}
              <div className="mt-4 space-y-3">
                <ErrorNotice error={error} />
                <MButton size="lg" className="w-full" disabled={busy} onClick={() => void submit()}>
                  {busy ? '처리 중…' : `${label} 처리 · ${lines.length}개`}
                </MButton>
              </div>
            </Section>
          )}
        </>
      )}

      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetect={onDetect}
        title={ctx ? `${label} · ${ctx.itemName}` : `${label} 스캔`}
        counter={`${lines.length}개`}
        footer={lines[0] && <p className="truncate text-center font-mono text-xs text-white/60">최근: {lines.slice(0, 3).map((l) => l.serialNo).join(' · ')}</p>}
      />

      <Modal open={!!choice} onClose={() => setChoice(null)} title="어느 재고에서 처리할까요?">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">같은 시리얼이 여러 품목의 재고에 있습니다.</p>
          {choice?.map((u) => <UnitCard key={u.id} unit={u} onClick={() => pickChoice(u)} />)}
        </div>
      </Modal>
    </div>
  )
}
