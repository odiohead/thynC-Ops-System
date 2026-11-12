'use client'

/**
 * 출고 처리 카드 (stock_out_request_design.md §13.4 · v2 stock_out_v2_design.md §5·§7 — 자재담당자 전용)
 * v2: 출고유형 선택 없음 — 인벤토리는 요청 라인의 자재관리 품목이 결정(인벤토리별 전표 분리, 전표 유형 자동).
 * 열리면 바로 미리보기 → 품목별 입력 후 **[확인]**(라인 단위 검증·잠금) → 전 품목 확인 완료 시 [출고 실행] (전량 일치·all-or-nothing).
 * **AS 모드 (2026-11-10 — projects/as_lost_stock_out_link_design.md §5.2)**: 분실 AS 연동 요청(`preview.asLink`)이면 품목 라인 대신
 *  ① 본체 — 접수 기기(심전계·산소포화도)마다 출고 시리얼 1개 → [본체 확인]  ② 센서류·부자재(선택) — 판매용 노출 품목에서 추가·LOT/수량 → [확인]
 *  [출고 실행]이 재고 차감 + AS 라인 교체 확정(교체기 기입·원장)까지 한 번에 처리한다.
 * **인벤토리별 카드 + 시스템 구성품 (2026-11-12 — stock_out_v2_design.md §13)**: 일반 모드는 품목을 인벤토리별 카드(대웅제약재고 / thynC운영팀재고 …)로 나눠 보여 준다.
 *  시스템이 든 요청은 대웅제약재고 카드 아래 '시스템 구성품' — 구성품마다 **출고**(합계 − 미출고, 기존 라인 입력 그대로)와 **미출고**(신청자가 적은 수량 → thynC운영팀재고 편입) 칸을 따로 둔다.
 *  미출고 수량이 0인 구성품은 미출고 칸이 없고, 전량 미출고면 출고 칸이 없다. 편입 위치(창고)는 구성품 섹션에서 한 번 고른다.
 */
import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'

interface Bucket { warehouseId: number; warehouseName: string; lotNo: string; quantity: number }
interface PreviewLine {
  inventoryItemId: number
  name: string
  modelName: string | null
  inventoryId: number
  inventoryName: string
  categoryName: string | null
  quantity: number
  mode: 'serial' | 'lot' | 'qty' | 'missing'
  registry: boolean
  buckets: Bucket[]
  stockTotal: number
  status: 'ok' | 'warning' | 'error' | 'pending'
  messages: string[]
  /** 시스템 구성품 출고분 (가상 라인) */
  component?: boolean
}
interface HoldPreview {
  itemId: number; name: string; modelName: string | null; inventoryName: string
  quantity: number; shipQuantity: number; mode: 'serial' | 'qty' | 'unsupported'; stockTotal: number
  targetItemName: string | null; targetInventoryName: string | null
  status: 'ok' | 'error' | 'pending'; messages: string[]
}
interface AsLinePreview { asItemId: number; lostSerialNo: string; deviceGroup: string; deviceName: string | null; wardName: string | null; serial: string | null; itemName: string | null; status: 'ok' | 'error' | 'pending'; messages: string[] }
interface ExtraCatalogItem { inventoryItemId: number; name: string; modelName: string | null; inventoryName: string; categoryName: string | null; mode: 'serial' | 'lot' | 'qty'; buckets: Bucket[]; stockTotal: number }
interface Preview {
  inventories: { id: number; name: string; reasonName: string; usageInput: string }[]
  lines: PreviewLine[]
  holds?: HoldPreview[]
  holdTarget?: { inventoryId: number; inventoryName: string; warehouses: { id: number; name: string }[]; warehouseId: number | null } | null
  components?: { itemId: number; name: string; quantity: number; unshippedQuantity: number; inventoryId: number }[]
  errors: string[]
  ok: boolean
  /** 분실 AS 연동 (AS 모드) */
  asLink?: { receipt: { id: number; asCode: string; hospitalName: string | null }; lines: AsLinePreview[] } | null
  extraCatalog?: ExtraCatalogItem[]
  asBodyItemIds?: number[]
}
interface ExtraRow { inventoryItemId: number; quantity: string }

interface LotRow { bucketKey: string; quantity: string } // bucketKey = `${warehouseId}|${lotNo}`

function todayKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

/** 클라이언트 선제 검증 — [확인] 전 즉시 피드백 (서버 preview가 최종 판정) */
function localSerialCheck(text: string, quantity: number): { serials: string[]; errors: string[] } {
  const serials = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const errors: string[] = []
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const s of serials) {
    if (seen.has(s)) dups.add(s)
    seen.add(s)
  }
  if (dups.size > 0) errors.push(`중복 시리얼: ${Array.from(dups).join(', ')}`)
  if (serials.length !== quantity) errors.push(`요청 수량 ${quantity}개 대비 ${serials.length}개 입력됨`)
  return { serials, errors }
}

const STATUS_TONE: Record<PreviewLine['status'], string> = {
  ok: 'text-green-600',
  warning: 'text-amber-600',
  error: 'text-red-600',
  pending: 'text-gray-400',
}

export default function FulfillCard({ requestId, onDone }: { requestId: number; onDone: () => void }) {
  const [txDate, setTxDate] = useState(todayKst())
  const [serialText, setSerialText] = useState<Record<number, string>>({})
  const [lotRows, setLotRows] = useState<Record<number, LotRow[]>>({})
  const [noteText, setNoteText] = useState<Record<number, string>>({})
  const [localErr, setLocalErr] = useState<Record<number, string[]>>({})
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // AS 모드 (2026-11-10)
  const [asSerials, setAsSerials] = useState<Record<number, string>>({}) // asItemId → 출고 시리얼
  const [bodyConfirmed, setBodyConfirmed] = useState(false)
  const [extras, setExtras] = useState<ExtraRow[]>([]) // 센서류·부자재 추가 라인
  const [extraPick, setExtraPick] = useState('')
  const asMode = !!preview?.asLink
  // 시스템 구성품 미출고분 (2026-11-12) — 구성품 itemId 기준
  const [holdSerialText, setHoldSerialText] = useState<Record<number, string>>({})
  const [holdNoteText, setHoldNoteText] = useState<Record<number, string>>({})
  const [holdErr, setHoldErr] = useState<Record<number, string[]>>({})
  const [holdConfirmed, setHoldConfirmed] = useState<Set<number>>(new Set())
  const [holdWarehouseId, setHoldWarehouseId] = useState<number | null>(null)

  const buildLines = useCallback((p: Preview | null) => {
    if (!p) return []
    return p.lines.map((l) => ({
      inventoryItemId: l.inventoryItemId,
      serials: l.mode === 'serial' ? (serialText[l.inventoryItemId] ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined,
      lots: l.mode === 'lot'
        ? (lotRows[l.inventoryItemId] ?? []).filter((r) => r.bucketKey && r.quantity !== '').map((r) => {
            const [wh, ...lot] = r.bucketKey.split('|')
            return { warehouseId: Number(wh), lotNo: lot.join('|'), quantity: parseInt(r.quantity) || 0 }
          })
        : undefined,
      serialsNote: l.mode !== 'serial' ? (noteText[l.inventoryItemId] ?? '').trim() || null : undefined,
    }))
  }, [serialText, lotRows, noteText])

  /** 시스템 구성품 미출고분 본문 */
  const buildHolds = useCallback((p: Preview | null) => (p?.holds ?? []).map((h) => ({
    itemId: h.itemId,
    serials: h.mode === 'serial' ? (holdSerialText[h.itemId] ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined,
    serialsNote: h.mode !== 'serial' ? (holdNoteText[h.itemId] ?? '').trim() || null : undefined,
  })), [holdSerialText, holdNoteText])

  /** AS 모드 본문 — 접수 라인별 시리얼 + 센서류 라인 (일반 모드는 lines) */
  const buildAsBody = useCallback(() => ({
    txDate,
    asLines: Object.entries(asSerials).filter(([, v]) => v.trim()).map(([k, v]) => ({ asItemId: Number(k), serial: v.trim().toUpperCase() })),
    extraLines: extras.filter((e) => e.inventoryItemId && e.quantity !== '').map((e) => ({
      inventoryItemId: e.inventoryItemId, quantity: parseInt(e.quantity) || 0,
      serials: (serialText[e.inventoryItemId] ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      lots: (lotRows[e.inventoryItemId] ?? []).filter((r) => r.bucketKey && r.quantity !== '').map((r) => { const [wh, ...lot] = r.bucketKey.split('|'); return { warehouseId: Number(wh), lotNo: lot.join('|'), quantity: parseInt(r.quantity) || 0 } }),
      serialsNote: (noteText[e.inventoryItemId] ?? '').trim() || null,
    })),
  }), [txDate, asSerials, extras, serialText, lotRows, noteText])

  const callPreview = useCallback(async (withLines: boolean, base: Preview | null) => {
    setBusy(true)
    setError(null)
    const body = base?.asLink ? buildAsBody() : { txDate, lines: withLines ? buildLines(base) : [], holds: withLines ? buildHolds(base) : [], holdWarehouseId }
    const res = await fetch(`/api/stock-out-requests/${requestId}/fulfill?preview=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? '검증에 실패했습니다.'); return null }
    setPreview(d.preview)
    return d.preview as Preview
  }, [requestId, txDate, buildLines, buildHolds, holdWarehouseId, buildAsBody])

  // 카드가 열리면 바로 미리보기 (v2 — 출고유형 선택 단계 없음)
  useEffect(() => { void callPreview(false, null) }, [requestId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 품목별 [확인] — 라인 단위 검증 후 잠금 */
  async function confirmLine(l: PreviewLine) {
    if (l.mode === 'serial') {
      const { errors } = localSerialCheck(serialText[l.inventoryItemId] ?? '', l.quantity)
      if (errors.length > 0) { setLocalErr((p) => ({ ...p, [l.inventoryItemId]: errors })); return }
    }
    setLocalErr((p) => ({ ...p, [l.inventoryItemId]: [] }))
    const p = await callPreview(true, preview)
    if (!p) return
    const after = p.lines.find((x) => x.inventoryItemId === l.inventoryItemId)
    if (after && (after.status === 'ok' || after.status === 'warning')) {
      setConfirmed((prev) => new Set(prev).add(l.inventoryItemId))
    }
  }

  function unlockLine(id: number) {
    setConfirmed((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  /** 미출고분 [확인] — 시리얼 품목은 개수·중복 선검사 후 서버 판정 */
  async function confirmHold(h: HoldPreview) {
    if (h.mode === 'serial') {
      const { errors } = localSerialCheck(holdSerialText[h.itemId] ?? '', h.quantity)
      if (errors.length > 0) { setHoldErr((p) => ({ ...p, [h.itemId]: errors.map((e) => e.replace('요청 수량', '미출고 수량')) })); return }
    }
    setHoldErr((p) => ({ ...p, [h.itemId]: [] }))
    const p = await callPreview(true, preview)
    const after = p?.holds?.find((x) => x.itemId === h.itemId)
    if (after?.status === 'ok') setHoldConfirmed((prev) => new Set(prev).add(h.itemId))
  }
  function unlockHold(id: number) {
    setHoldConfirmed((prev) => { const n = new Set(prev); n.delete(id); return n })
  }

  async function execute() {
    if (!preview) return
    const holdNote = (preview.holds?.length ?? 0) > 0 ? `\n시스템 구성품 미출고분 ${preview.holds!.reduce((a, h) => a + h.quantity, 0)}개는 ${preview.holdTarget?.inventoryName ?? '편입 대상 인벤토리'}(${preview.holdTarget?.warehouses.find((w) => w.id === (holdWarehouseId ?? preview.holdTarget?.warehouseId))?.name ?? '-'})로 편입됩니다.` : ''
    if (!confirm(preview.asLink ? `출고를 실행합니다.\n재고 차감 + 분실 AS ${preview.asLink.receipt.asCode} 라인 교체 확정(교체기 시리얼 기입·분실 기기 회수·새 기기 병원 배치) + 요청 완료가 한 번에 진행됩니다.` : `출고를 실행합니다. 재고 차감·기기현황 등록·요청 완료 처리가 한 번에 진행됩니다.${holdNote}`)) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/stock-out-requests/${requestId}/fulfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preview.asLink ? buildAsBody() : { txDate, lines: buildLines(preview), holds: buildHolds(preview), holdWarehouseId }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(d.error ?? '출고 처리에 실패했습니다.')
      if (d.preview) { setPreview(d.preview); setConfirmed(new Set()); setHoldConfirmed(new Set()) }
      return
    }
    onDone()
  }

  /** AS 모드 — [본체 확인]: 시리얼 전부 입력 후 서버 판정, 전부 ok면 잠금 */
  async function confirmBody() {
    if (!preview?.asLink) return
    const missing = preview.asLink.lines.filter((l) => !(asSerials[l.asItemId] ?? '').trim())
    if (missing.length) { setError(`출고 시리얼을 입력하지 않은 기기가 ${missing.length}대 있습니다: ${missing.map((l) => l.lostSerialNo).join(', ')}`); return }
    const p = await callPreview(true, preview)
    if (p?.asLink && p.asLink.lines.every((l) => l.status === 'ok')) setBodyConfirmed(true)
  }
  /** AS 모드 — 센서류 라인 [확인] (가상 라인 판정) */
  async function confirmExtra(id: number) {
    const p = await callPreview(true, preview)
    const after = p?.lines.find((x) => x.inventoryItemId === id)
    if (after && (after.status === 'ok' || after.status === 'warning')) setConfirmed((prev) => new Set(prev).add(id))
  }
  const extraLineOf = (id: number) => preview?.lines.find((l) => l.inventoryItemId === id) ?? null
  const catalogOf = (id: number) => preview?.extraCatalog?.find((c) => c.inventoryItemId === id) ?? null
  const extrasConfirmed = extras.every((e) => confirmed.has(e.inventoryItemId))
  const holdsAll = preview?.holds ?? []
  const allConfirmed = asMode ? bodyConfirmed && extrasConfirmed : !!preview && preview.lines.length > 0 && preview.lines.every((l) => confirmed.has(l.inventoryItemId)) && holdsAll.every((h) => holdConfirmed.has(h.itemId))
  const ready = allConfirmed && !!preview?.ok
  const label = 'text-xs font-medium text-gray-500'
  const input = 'rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'

  /** 품목 라인 1개 — 일반 품목·시스템 구성품 출고분 공용. partLabel(구성품 출고분)이 있으면 품목명 대신 '출고 n개'로 표시 */
  const renderLine = (l: PreviewLine, partLabel?: string) => {
    const id = l.inventoryItemId
    const isConfirmed = confirmed.has(id)
    const lErrs = localErr[id] ?? []
    const serialCnt = (serialText[id] ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length
    return (
      <div key={id} data-testid={`fulfill-line-${id}`} className={`rounded-lg border p-3 ${
        isConfirmed ? 'border-green-300 bg-green-50/40' : l.status === 'error' ? 'border-red-300 bg-red-50/40' : 'border-gray-200'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {partLabel ? (
            <p className="text-sm font-medium text-gray-800">
              <span className="rounded bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-800">{partLabel}</span>
              <span className="ml-1.5">{l.quantity}개</span>
              <span className="ml-1.5 text-xs font-normal text-gray-400">{l.inventoryName} 재고에서 차감</span>
            </p>
          ) : (
            <p className="text-sm font-medium text-gray-800">
              {l.name}
              {l.modelName && l.modelName !== l.name && <span className="ml-1 font-mono text-xs text-gray-400">{l.modelName}</span>}
              <span className="ml-1.5 text-xs text-gray-400">요청 {l.quantity}개 · {l.inventoryName}</span>
              {l.registry && <span className="ml-1.5 rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-medium text-teal-700">기기현황 등록</span>}
            </p>
          )}
          <div className="flex items-center gap-2">
            {isConfirmed ? (
              <>
                <span className="text-xs font-medium text-green-600">✓ 확인됨</span>
                <button type="button" onClick={() => unlockLine(id)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50">수정</button>
              </>
            ) : l.mode !== 'missing' ? (
              <button type="button" onClick={() => void confirmLine(l)} disabled={busy} className="rounded-md bg-gray-800 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">확인</button>
            ) : null}
          </div>
        </div>

        {l.mode === 'serial' && (
          <div className="mt-2">
            <div className="flex items-baseline justify-between">
              <p className={label}>시리얼 스캔/입력 (줄 단위)</p>
              <span className={`text-xs ${serialCnt === l.quantity ? 'text-green-600' : 'text-gray-400'}`}>{serialCnt} / {l.quantity}</span>
            </div>
            <textarea
              value={serialText[id] ?? ''}
              onChange={(e) => { setSerialText((p) => ({ ...p, [id]: e.target.value })); unlockLine(id) }}
              disabled={isConfirmed}
              rows={Math.min(6, Math.max(2, l.quantity))}
              placeholder={'시리얼을 한 줄에 하나씩'}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
        )}

        {l.mode === 'lot' && (
          <div className="mt-2 space-y-1.5">
            <p className={label}>LOT별 수량 (합 = {l.quantity})</p>
            {(lotRows[id] ?? [{ bucketKey: '', quantity: '' }]).map((row, ri) => {
              const cur = l.buckets.find((b) => `${b.warehouseId}|${b.lotNo}` === row.bucketKey)
              const multiWh = new Set(l.buckets.map((b) => b.warehouseId)).size > 1
              return (
                <div key={ri} className="flex items-center gap-2">
                  <select
                    value={row.bucketKey}
                    disabled={isConfirmed}
                    onChange={(e) => { const v = e.target.value; setLotRows((p) => { const rows = [...(p[id] ?? [{ bucketKey: '', quantity: '' }])]; rows[ri] = { ...rows[ri], bucketKey: v }; return { ...p, [id]: rows } }); unlockLine(id) }}
                    className={`${input} disabled:bg-gray-50 disabled:text-gray-500`}
                  >
                    <option value="">LOT 선택</option>
                    {l.buckets.map((b) => (
                      <option key={`${b.warehouseId}|${b.lotNo}`} value={`${b.warehouseId}|${b.lotNo}`}>
                        {b.lotNo || '(LOT 없음)'}{multiWh ? ` @${b.warehouseName}` : ''} — 잔량 {b.quantity}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number" min="1"
                    value={row.quantity}
                    disabled={isConfirmed}
                    onChange={(e) => { const v = e.target.value; setLotRows((p) => { const rows = [...(p[id] ?? [{ bucketKey: '', quantity: '' }])]; rows[ri] = { ...rows[ri], quantity: v }; return { ...p, [id]: rows } }); unlockLine(id) }}
                    placeholder="수량"
                    className={`${input} w-24 text-right disabled:bg-gray-50 disabled:text-gray-500`}
                  />
                  {cur && <span className="text-xs text-gray-400">잔량 {cur.quantity}</span>}
                  {ri > 0 && !isConfirmed && (
                    <button type="button" onClick={() => { setLotRows((p) => ({ ...p, [id]: (p[id] ?? []).filter((_, i) => i !== ri) })); unlockLine(id) }} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                  )}
                </div>
              )
            })}
            {!isConfirmed && (
              <button type="button" onClick={() => setLotRows((p) => ({ ...p, [id]: [...(p[id] ?? [{ bucketKey: '', quantity: '' }]), { bucketKey: '', quantity: '' }] }))} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">+ LOT 추가</button>
            )}
            <div className="pt-1">
              <p className={label}>시리얼 기록 (선택 — 과도기, 재고 차감과 무관)</p>
              <textarea
                value={noteText[id] ?? ''}
                onChange={(e) => setNoteText((p) => ({ ...p, [id]: e.target.value }))}
                disabled={isConfirmed}
                rows={2}
                placeholder="스캔한 시리얼을 기록으로 남기려면 줄 단위 입력"
                className="mt-1 w-full rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 font-mono text-xs disabled:bg-gray-50"
              />
            </div>
          </div>
        )}

        {l.mode === 'qty' && (
          <div className="mt-2">
            <p className="text-sm text-gray-600">
              수량 차감: <span className="font-medium">{l.quantity}개</span>
              <span className="ml-2 text-xs text-gray-400">현재고 {l.stockTotal}개</span>
            </p>
            {/* 시스템 구성품 출고분 — 수량 관리 품목도 시리얼을 적어 둘 수 있게 (기록용) */}
            {l.component && (
              <div className="mt-1.5">
                <p className={label}>출고분 시리얼 기록 (줄 단위 — 재고 차감과 무관)</p>
                <textarea
                  value={noteText[id] ?? ''}
                  onChange={(e) => setNoteText((p) => ({ ...p, [id]: e.target.value }))}
                  disabled={isConfirmed}
                  rows={Math.min(6, Math.max(2, l.quantity))}
                  placeholder="출고하는 기기의 시리얼을 한 줄에 하나씩"
                  aria-label={`${l.name} 출고분 시리얼 기록`}
                  className="mt-1 w-full rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 font-mono text-xs disabled:bg-gray-50"
                />
              </div>
            )}
          </div>
        )}

        {(lErrs.length > 0 || l.messages.length > 0) && (
          <ul className={`mt-2 space-y-0.5 text-xs ${lErrs.length > 0 ? 'text-red-600' : STATUS_TONE[l.status]}`}>
            {lErrs.map((m, i) => <li key={`l${i}`}>· {m}</li>)}
            {lErrs.length === 0 && l.messages.map((m, i) => <li key={i}>· {m}</li>)}
          </ul>
        )}
      </div>
    )
  }

  /** 시스템 구성품 미출고분 1개 — 대웅제약재고에서 빼서 편입 대상 인벤토리(thynC운영팀재고)로 넣는다 */
  const renderHold = (h: HoldPreview) => {
    const isConfirmed = holdConfirmed.has(h.itemId)
    const errs = holdErr[h.itemId] ?? []
    const cnt = (holdSerialText[h.itemId] ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).length
    return (
      <div key={`hold-${h.itemId}`} data-testid={`fulfill-hold-${h.itemId}`} className={`rounded-lg border p-3 ${
        isConfirmed ? 'border-green-300 bg-green-50/40' : h.status === 'error' ? 'border-red-300 bg-red-50/40' : 'border-dashed border-gray-300'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-800">
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700">미출고</span>
            <span className="ml-1.5">{h.quantity}개</span>
            <span className="ml-1.5 text-xs font-normal text-gray-400">→ {h.targetInventoryName ?? '편입 대상 없음'} 편입</span>
          </p>
          <div className="flex items-center gap-2">
            {isConfirmed ? (
              <>
                <span className="text-xs font-medium text-green-600">✓ 확인됨</span>
                <button type="button" onClick={() => unlockHold(h.itemId)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50">수정</button>
              </>
            ) : h.mode !== 'unsupported' ? (
              <button type="button" onClick={() => void confirmHold(h)} disabled={busy} className="rounded-md bg-gray-800 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">확인</button>
            ) : null}
          </div>
        </div>
        {h.mode === 'serial' && (
          <div className="mt-2">
            <div className="flex items-baseline justify-between">
              <p className={label}>미출고분 시리얼 스캔/입력 (줄 단위)</p>
              <span className={`text-xs ${cnt === h.quantity ? 'text-green-600' : 'text-gray-400'}`}>{cnt} / {h.quantity}</span>
            </div>
            <textarea
              value={holdSerialText[h.itemId] ?? ''}
              onChange={(e) => { setHoldSerialText((p) => ({ ...p, [h.itemId]: e.target.value })); unlockHold(h.itemId) }}
              disabled={isConfirmed}
              rows={Math.min(6, Math.max(2, h.quantity))}
              placeholder="출고하지 않고 편입할 기기의 시리얼을 한 줄에 하나씩"
              aria-label={`${h.name} 미출고분 시리얼`}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
        )}
        {h.mode === 'qty' && (
          <div className="mt-2">
            <p className="text-sm text-gray-600">
              수량 편입: <span className="font-medium">{h.quantity}개</span>
              <span className="ml-2 text-xs text-gray-400">현재고 {h.stockTotal}개{h.shipQuantity > 0 ? ` (출고분 ${h.shipQuantity}개와 합쳐 확인)` : ''}</span>
            </p>
            <div className="mt-1.5">
              <p className={label}>미출고분 시리얼 기록 (줄 단위 — 재고와 무관)</p>
              <textarea
                value={holdNoteText[h.itemId] ?? ''}
                onChange={(e) => setHoldNoteText((p) => ({ ...p, [h.itemId]: e.target.value }))}
                disabled={isConfirmed}
                rows={Math.min(6, Math.max(2, h.quantity))}
                placeholder="편입하는 기기의 시리얼을 한 줄에 하나씩"
                aria-label={`${h.name} 미출고분 시리얼 기록`}
                className="mt-1 w-full rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 font-mono text-xs disabled:bg-gray-50"
              />
            </div>
          </div>
        )}
        {(errs.length > 0 || h.messages.length > 0) && (
          <ul className={`mt-2 space-y-0.5 text-xs ${errs.length > 0 ? 'text-red-600' : STATUS_TONE[h.status]}`}>
            {errs.map((m, i) => <li key={`l${i}`}>· {m}</li>)}
            {errs.length === 0 && h.messages.map((m, i) => <li key={i}>· {m}</li>)}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-teal-200 bg-white shadow-sm">
      <div className="border-b border-teal-100 bg-teal-50/60 px-4 py-3 sm:px-6">
        <h2 className="text-sm font-semibold text-teal-800">출고 처리 <span className="font-normal text-teal-600">— 자재담당자</span></h2>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-wrap">{error}</div>}

        {/* 인벤토리·전표 유형은 라인 품목이 결정 — 창고는 서버가 자동 */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className={label}>출고일</p>
            <input type="date" value={txDate} onChange={(e) => { setTxDate(e.target.value); setConfirmed(new Set()); setHoldConfirmed(new Set()) }} className={`${input} mt-1`} />
          </div>
          {preview && preview.inventories.length > 0 && (
            <div className="pb-1">
              <p className={label}>출고 인벤토리 · 전표 유형</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {preview.inventories.map((inv) => (
                  <span key={inv.id} className="rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs text-teal-800">
                    {inv.name} <span className="text-teal-500">· {inv.reasonName}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {!preview && !error && <p className="text-sm text-gray-400">검증 중…</p>}

        {preview && (
          <>
            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {preview.errors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}

            {/* AS 모드 — ① 본체 (접수 기기별 출고 시리얼) ② 센서류·부자재 (2026-11-10) */}
            {preview.asLink && (
              <div className="space-y-4" data-testid="fulfill-as-mode">
                <div className="rounded-lg border border-teal-200 bg-teal-50/40 px-3 py-2 text-xs text-teal-900">
                  분실 AS <Link href={`/as-receipts/${preview.asLink.receipt.id}`} className="font-medium hover:underline">{preview.asLink.receipt.asCode}</Link> · {preview.asLink.receipt.hospitalName ?? ''} — 접수 기기마다 보낼 본체 시리얼을 1개씩 입력하세요(같은 기기군이면 모델이 달라도 됩니다). 센서류는 아래에서 추가합니다. 출고 실행 시 AS 라인이 교체로 확정되고 교체기 시리얼이 기입됩니다. 송장번호는 AS 상세 발송정보에서 추후 입력합니다.
                </div>
                <div className={`rounded-lg border p-3 ${bodyConfirmed ? 'border-green-300 bg-green-50/40' : 'border-gray-200'}`} data-testid="fulfill-as-body">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-800">본체 <span className="ml-1 text-xs text-gray-400">{preview.asLink.lines.length}대 · {Array.from(preview.asLink.lines.reduce((m, l) => m.set(l.deviceGroup, (m.get(l.deviceGroup) ?? 0) + 1), new Map<string, number>())).map(([g, n]) => `${g} ${n}`).join(' · ')}</span></p>
                    {bodyConfirmed ? (
                      <span className="flex items-center gap-2"><span className="text-xs font-medium text-green-600">✓ 확인됨</span><button type="button" onClick={() => setBodyConfirmed(false)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50">수정</button></span>
                    ) : (
                      <button type="button" onClick={() => void confirmBody()} disabled={busy} className="rounded-md bg-gray-800 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50" data-testid="fulfill-as-body-confirm">본체 확인</button>
                    )}
                  </div>
                  <div className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200">
                    {preview.asLink.lines.map((l) => (
                      <div key={l.asItemId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid={`fulfill-as-line-${l.lostSerialNo}`}>
                        <span className="w-20 text-xs text-gray-500">{l.deviceGroup}</span>
                        <span className="font-mono text-xs text-gray-700" title={`분실 기기${l.deviceName ? ` · ${l.deviceName}` : ''}${l.wardName ? ` · ${l.wardName}` : ''}`}>{l.lostSerialNo}</span>
                        <span className="text-gray-300">→</span>
                        <input
                          type="text" value={asSerials[l.asItemId] ?? ''} disabled={bodyConfirmed}
                          onChange={(e) => { setAsSerials((p) => ({ ...p, [l.asItemId]: e.target.value })); setBodyConfirmed(false) }}
                          placeholder="출고 본체 시리얼" className={`w-40 rounded-md border px-2 py-1 font-mono text-xs disabled:bg-gray-50 disabled:text-gray-500 ${l.status === 'error' ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                        />
                        {l.itemName && l.status === 'ok' && <span className="text-xs text-green-700">{l.itemName}</span>}
                        {l.messages.length > 0 && <span className={`text-xs ${l.status === 'error' ? 'text-red-600' : 'text-gray-400'}`}>{l.messages.join(' · ')}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-3" data-testid="fulfill-as-extras">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-800">센서류·부자재 <span className="ml-1 text-xs text-gray-400">(선택 — 판매용 재고, 모델·수량은 자재담당자가 정함)</span></p>
                    <div className="flex items-center gap-2">
                      <select value={extraPick} onChange={(e) => setExtraPick(e.target.value)} className={`${input} text-xs`} data-testid="fulfill-extra-pick">
                        <option value="">품목 선택</option>
                        {(preview.extraCatalog ?? []).filter((c) => !extras.some((e) => e.inventoryItemId === c.inventoryItemId)).map((c) => <option key={c.inventoryItemId} value={c.inventoryItemId}>{c.name}{c.modelName && c.modelName !== c.name ? ` (${c.modelName})` : ''} — 재고 {c.stockTotal}</option>)}
                      </select>
                      <button type="button" disabled={!extraPick} onClick={() => { setExtras((p) => [...p, { inventoryItemId: Number(extraPick), quantity: '1' }]); setExtraPick('') }} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40" data-testid="fulfill-extra-add">+ 추가</button>
                    </div>
                  </div>
                  {extras.length === 0 && <p className="mt-2 text-xs text-gray-400">추가한 센서류가 없습니다 — 본체만 출고하려면 비워 두세요.</p>}
                  <div className="mt-2 space-y-2">
                    {extras.map((e) => {
                      const c = catalogOf(e.inventoryItemId)
                      const l = extraLineOf(e.inventoryItemId)
                      const id = e.inventoryItemId
                      const isConfirmed = confirmed.has(id)
                      const qty = parseInt(e.quantity) || 0
                      const serialCnt = (serialText[id] ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length
                      return (
                        <div key={id} className={`rounded-md border p-2.5 ${isConfirmed ? 'border-green-300 bg-green-50/40' : l?.status === 'error' ? 'border-red-300 bg-red-50/40' : 'border-gray-200'}`} data-testid={`fulfill-extra-${id}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">{c?.name ?? `품목 #${id}`}{c?.modelName && c.modelName !== c.name && <span className="ml-1 font-mono text-xs text-gray-400">{c.modelName}</span>}</span>
                            <span className="text-xs text-gray-400">{c?.inventoryName ?? ''} · 재고 {c?.stockTotal ?? '-'}</span>
                            <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">수량
                              <input type="number" min="1" value={e.quantity} disabled={isConfirmed} onChange={(ev) => { const v = ev.target.value; setExtras((p) => p.map((x) => (x.inventoryItemId === id ? { ...x, quantity: v } : x))); unlockLine(id) }} className={`${input} w-20 text-right disabled:bg-gray-50`} />
                            </label>
                            {isConfirmed ? (
                              <><span className="text-xs font-medium text-green-600">✓ 확인됨</span><button type="button" onClick={() => unlockLine(id)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50">수정</button></>
                            ) : (
                              <button type="button" onClick={() => void confirmExtra(id)} disabled={busy || qty <= 0} className="rounded-md bg-gray-800 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">확인</button>
                            )}
                            {!isConfirmed && <button type="button" onClick={() => { setExtras((p) => p.filter((x) => x.inventoryItemId !== id)); unlockLine(id) }} className="text-xs text-red-400 hover:text-red-600">삭제</button>}
                          </div>
                          {c?.mode === 'serial' && (
                            <div className="mt-2">
                              <div className="flex items-baseline justify-between"><p className={label}>시리얼 (줄 단위)</p><span className={`text-xs ${serialCnt === qty ? 'text-green-600' : 'text-gray-400'}`}>{serialCnt} / {qty}</span></div>
                              <textarea value={serialText[id] ?? ''} disabled={isConfirmed} onChange={(ev) => { setSerialText((p) => ({ ...p, [id]: ev.target.value })); unlockLine(id) }} rows={Math.min(6, Math.max(2, qty))} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm disabled:bg-gray-50" />
                            </div>
                          )}
                          {c?.mode === 'lot' && (
                            <div className="mt-2 space-y-1.5">
                              <p className={label}>LOT별 수량 (합 = {qty})</p>
                              {(lotRows[id] ?? [{ bucketKey: '', quantity: '' }]).map((row, ri) => {
                                const multiWh = new Set(c.buckets.map((b) => b.warehouseId)).size > 1
                                return (
                                  <div key={ri} className="flex items-center gap-2">
                                    <select value={row.bucketKey} disabled={isConfirmed} onChange={(ev) => { const v = ev.target.value; setLotRows((p) => { const rows = [...(p[id] ?? [{ bucketKey: '', quantity: '' }])]; rows[ri] = { ...rows[ri], bucketKey: v }; return { ...p, [id]: rows } }); unlockLine(id) }} className={`${input} disabled:bg-gray-50`}>
                                      <option value="">LOT 선택</option>
                                      {c.buckets.map((b) => <option key={`${b.warehouseId}|${b.lotNo}`} value={`${b.warehouseId}|${b.lotNo}`}>{b.lotNo || '(LOT 없음)'}{multiWh ? ` @${b.warehouseName}` : ''} — 잔량 {b.quantity}</option>)}
                                    </select>
                                    <input type="number" min="1" value={row.quantity} disabled={isConfirmed} onChange={(ev) => { const v = ev.target.value; setLotRows((p) => { const rows = [...(p[id] ?? [{ bucketKey: '', quantity: '' }])]; rows[ri] = { ...rows[ri], quantity: v }; return { ...p, [id]: rows } }); unlockLine(id) }} placeholder="수량" className={`${input} w-24 text-right disabled:bg-gray-50`} />
                                    {ri > 0 && !isConfirmed && <button type="button" onClick={() => { setLotRows((p) => ({ ...p, [id]: (p[id] ?? []).filter((_, i) => i !== ri) })); unlockLine(id) }} className="text-xs text-red-400 hover:text-red-600">삭제</button>}
                                  </div>
                                )
                              })}
                              {!isConfirmed && <button type="button" onClick={() => setLotRows((p) => ({ ...p, [id]: [...(p[id] ?? [{ bucketKey: '', quantity: '' }]), { bucketKey: '', quantity: '' }] }))} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">+ LOT 추가</button>}
                              <textarea value={noteText[id] ?? ''} disabled={isConfirmed} onChange={(ev) => setNoteText((p) => ({ ...p, [id]: ev.target.value }))} rows={2} placeholder="시리얼 기록 (선택 — 줄 단위, 재고 차감과 무관)" className="mt-1 w-full rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 font-mono text-xs disabled:bg-gray-50" />
                            </div>
                          )}
                          {c?.mode === 'qty' && <p className="mt-1 text-xs text-gray-500">수량 차감 {qty}개 · 잔량 많은 위치부터 자동</p>}
                          {l && l.messages.length > 0 && <ul className={`mt-1.5 space-y-0.5 text-xs ${STATUS_TONE[l.status]}`}>{l.messages.map((m, i) => <li key={i}>· {m}</li>)}</ul>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 품목별 입력 + [확인] (라인 단위 검증·잠금) — 일반 모드: 인벤토리별 카드 (2026-11-12) */}
            <div className={`space-y-4 ${preview.asLink ? 'hidden' : ''}`}>
              {(preview.asLink ? [] : preview.inventories).map((inv) => {
                const invLines = preview.lines.filter((l) => l.inventoryId === inv.id && !l.component)
                const comps = (preview.components ?? []).filter((c) => c.inventoryId === inv.id)
                const target = preview.holdTarget
                const hasHold = comps.some((c) => holdsAll.some((h) => h.itemId === c.itemId))
                return (
                  <section key={inv.id} className="overflow-hidden rounded-lg border border-gray-300" data-testid={`fulfill-inv-${inv.id}`}>
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
                      <h3 className="text-sm font-semibold text-gray-800">{inv.name} <span className="ml-1 text-xs font-normal text-gray-500">전표 유형 {inv.reasonName}</span></h3>
                      <span className="text-xs text-gray-400">품목 {invLines.length}종{comps.length > 0 ? ` · 시스템 구성품 ${comps.length}종` : ''}</span>
                    </header>
                    <div className="space-y-3 p-3">
                      {invLines.map((l) => renderLine(l))}
                      {comps.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3" data-testid="fulfill-components">
                          <div className="flex flex-wrap items-end justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-amber-900">시스템 구성품</p>
                              <p className="mt-0.5 text-xs text-amber-800/80">구성품마다 출고분과 미출고분을 따로 입력합니다.{hasHold ? ` 미출고분은 ${target?.inventoryName ?? '편입 대상 인벤토리'}로 편입됩니다.` : ''}</p>
                            </div>
                            {hasHold && target && (
                              <label className="text-xs text-gray-600">
                                미출고분 편입 위치 ({target.inventoryName})
                                <select
                                  value={holdWarehouseId ?? target.warehouseId ?? ''}
                                  onChange={(e) => { setHoldWarehouseId(Number(e.target.value) || null); setHoldConfirmed(new Set()) }}
                                  className={`${input} ml-2 py-1`}
                                  data-testid="fulfill-hold-warehouse"
                                >
                                  {target.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                              </label>
                            )}
                          </div>
                          <div className="mt-3 space-y-3">
                            {comps.map((c) => {
                              const ship = preview.lines.find((l) => l.component && l.inventoryItemId === c.itemId)
                              const hold = holdsAll.find((h) => h.itemId === c.itemId)
                              return (
                                <div key={c.itemId} className="rounded-lg border border-gray-200 bg-white p-3" data-testid={`fulfill-comp-${c.itemId}`}>
                                  <p className="text-sm font-semibold text-gray-900">
                                    {c.name}
                                    <span className="ml-2 text-xs font-normal text-gray-500">합계 {c.quantity}개 = 출고 {c.quantity - c.unshippedQuantity} + 미출고 {c.unshippedQuantity}</span>
                                  </p>
                                  <div className="mt-2 space-y-2">
                                    {ship && renderLine(ship, '출고')}
                                    {hold && renderHold(hold)}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                )
              })}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-3">
              <span className="text-xs text-gray-400">{preview.asLink ? `본체 ${bodyConfirmed ? '확인됨' : '미확인'} · 센서류 ${extras.filter((e) => confirmed.has(e.inventoryItemId)).length} / ${extras.length} 확인됨` : `${confirmed.size + holdConfirmed.size} / ${preview.lines.length + holdsAll.length} 항목 확인됨`}</span>
              <button
                type="button"
                onClick={execute}
                disabled={busy || !ready}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                title={ready ? '' : preview.asLink ? '[본체 확인]과 센서류 [확인]을 마쳐야 실행할 수 있습니다' : '모든 품목을 [확인]해야 실행할 수 있습니다'}
                data-testid="fulfill-execute"
              >
                {busy ? '처리 중...' : preview.asLink ? '출고 실행 + AS 교체 확정' : '출고 실행'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
