'use client'

/**
 * 출고 처리 카드 (stock_out_request_design.md §13.4 — 자재담당자 전용, 2026-09-03 개정)
 * 출고유형 3택(→ 인벤토리 자동, 창고 선택 없음) → 품목별 입력 후 **[확인]**(라인 단위 검증·잠금)
 * → 전 품목 확인 완료 시 [출고 실행] (전량 일치·all-or-nothing).
 */
import { useState, useCallback } from 'react'
import { STOCK_OUT_OUT_TYPES, OUT_TYPE_META, type StockOutOutType } from '@/lib/stockOutShared'

interface Bucket { warehouseId: number; warehouseName: string; lotNo: string; quantity: number }
interface PreviewLine {
  itemId: number
  name: string
  itemGroup: string
  quantity: number
  mode: 'serial' | 'lot' | 'qty' | 'missing'
  wmsItemName: string | null
  registry: boolean
  buckets: Bucket[]
  stockTotal: number
  status: 'ok' | 'warning' | 'error' | 'pending'
  messages: string[]
}
interface Preview {
  inventory: { id: number; name: string } | null
  reasonName: string
  lines: PreviewLine[]
  errors: string[]
  ok: boolean
}

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
  const [outType, setOutType] = useState<StockOutOutType | null>(null)
  const [txDate, setTxDate] = useState(todayKst())
  const [serialText, setSerialText] = useState<Record<number, string>>({})
  const [lotRows, setLotRows] = useState<Record<number, LotRow[]>>({})
  const [noteText, setNoteText] = useState<Record<number, string>>({})
  const [localErr, setLocalErr] = useState<Record<number, string[]>>({})
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buildLines = useCallback((p: Preview | null) => {
    if (!p) return []
    return p.lines.map((l) => ({
      itemId: l.itemId,
      serials: l.mode === 'serial' ? (serialText[l.itemId] ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined,
      lots: l.mode === 'lot'
        ? (lotRows[l.itemId] ?? []).filter((r) => r.bucketKey && r.quantity !== '').map((r) => {
            const [wh, ...lot] = r.bucketKey.split('|')
            return { warehouseId: Number(wh), lotNo: lot.join('|'), quantity: parseInt(r.quantity) || 0 }
          })
        : undefined,
      serialsNote: l.mode !== 'serial' ? (noteText[l.itemId] ?? '').trim() || null : undefined,
    }))
  }, [serialText, lotRows, noteText])

  const callPreview = useCallback(async (ot: StockOutOutType, withLines: boolean, base: Preview | null) => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/stock-out-requests/${requestId}/fulfill?preview=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outType: ot, txDate, lines: withLines ? buildLines(base) : [] }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? '검증에 실패했습니다.'); return null }
    setPreview(d.preview)
    return d.preview as Preview
  }, [requestId, txDate, buildLines])

  async function selectOutType(t: StockOutOutType) {
    setOutType(t)
    setConfirmed(new Set())
    setLocalErr({})
    await callPreview(t, false, null)
  }

  /** 품목별 [확인] — 라인 단위 검증 후 잠금 */
  async function confirmLine(l: PreviewLine) {
    if (!outType) return
    // 클라 선제 검증 (시리얼 개수·중복)
    if (l.mode === 'serial') {
      const { errors } = localSerialCheck(serialText[l.itemId] ?? '', l.quantity)
      if (errors.length > 0) { setLocalErr((p) => ({ ...p, [l.itemId]: errors })); return }
    }
    setLocalErr((p) => ({ ...p, [l.itemId]: [] }))
    const p = await callPreview(outType, true, preview)
    if (!p) return
    const after = p.lines.find((x) => x.itemId === l.itemId)
    if (after && (after.status === 'ok' || after.status === 'warning')) {
      setConfirmed((prev) => new Set(prev).add(l.itemId))
    }
  }

  function unlockLine(itemId: number) {
    setConfirmed((prev) => { const n = new Set(prev); n.delete(itemId); return n })
  }

  async function execute() {
    if (!outType || !preview) return
    if (!confirm('출고를 실행합니다. 재고 차감·기기현황 등록·요청 완료 처리가 한 번에 진행됩니다.')) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/stock-out-requests/${requestId}/fulfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outType, txDate, lines: buildLines(preview) }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(d.error ?? '출고 처리에 실패했습니다.')
      if (d.preview) { setPreview(d.preview); setConfirmed(new Set()) }
      return
    }
    onDone()
  }

  const allConfirmed = !!preview && preview.lines.length > 0 && preview.lines.every((l) => confirmed.has(l.itemId))
  const ready = allConfirmed && !!preview?.ok
  const label = 'text-xs font-medium text-gray-500'
  const input = 'rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-teal-200 bg-white shadow-sm">
      <div className="border-b border-teal-100 bg-teal-50/60 px-4 py-3 sm:px-6">
        <h2 className="text-sm font-semibold text-teal-800">출고 처리 <span className="font-normal text-teal-600">— 자재담당자</span></h2>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-wrap">{error}</div>}

        {/* 출고유형 → 인벤토리 자동 (창고 선택 없음 — 위치는 서버가 자동 결정) */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className={label}>출고유형 *</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {STOCK_OUT_OUT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => void selectOutType(t)}
                  disabled={busy}
                  className={`rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    outType === t ? 'border-teal-500 bg-teal-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {OUT_TYPE_META[t].label}
                  <span className={`ml-1.5 text-xs ${outType === t ? 'text-teal-100' : 'text-gray-400'}`}>{OUT_TYPE_META[t].inventoryName}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className={label}>출고일</p>
            <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} className={`${input} mt-1`} />
          </div>
          {preview && <p className="pb-1.5 text-xs text-gray-400">전표 유형: {preview.reasonName}</p>}
        </div>

        {preview && (
          <>
            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {preview.errors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}

            {/* 품목별 입력 + [확인] (라인 단위 검증·잠금) */}
            <div className="space-y-3">
              {preview.lines.map((l) => {
                const isConfirmed = confirmed.has(l.itemId)
                const lErrs = localErr[l.itemId] ?? []
                const serialCnt = (serialText[l.itemId] ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length
                return (
                  <div key={l.itemId} className={`rounded-lg border p-3 ${
                    isConfirmed ? 'border-green-300 bg-green-50/40' : l.status === 'error' ? 'border-red-300 bg-red-50/40' : 'border-gray-200'
                  }`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-800">
                        {l.name}
                        <span className="ml-1.5 text-xs text-gray-400">요청 {l.quantity}개{l.wmsItemName ? ` · WMS ${l.wmsItemName}` : ''}</span>
                        {l.registry && <span className="ml-1.5 rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-medium text-teal-700">기기현황 등록</span>}
                      </p>
                      <div className="flex items-center gap-2">
                        {isConfirmed ? (
                          <>
                            <span className="text-xs font-medium text-green-600">✓ 확인됨</span>
                            <button type="button" onClick={() => unlockLine(l.itemId)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50">수정</button>
                          </>
                        ) : l.mode !== 'missing' ? (
                          <button
                            type="button"
                            onClick={() => void confirmLine(l)}
                            disabled={busy}
                            className="rounded-md bg-gray-800 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                          >
                            확인
                          </button>
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
                          value={serialText[l.itemId] ?? ''}
                          onChange={(e) => { setSerialText((p) => ({ ...p, [l.itemId]: e.target.value })); unlockLine(l.itemId) }}
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
                        {(lotRows[l.itemId] ?? [{ bucketKey: '', quantity: '' }]).map((row, ri) => {
                          const cur = l.buckets.find((b) => `${b.warehouseId}|${b.lotNo}` === row.bucketKey)
                          const multiWh = new Set(l.buckets.map((b) => b.warehouseId)).size > 1
                          return (
                            <div key={ri} className="flex items-center gap-2">
                              <select
                                value={row.bucketKey}
                                disabled={isConfirmed}
                                onChange={(e) => { const v = e.target.value; setLotRows((p) => { const rows = [...(p[l.itemId] ?? [{ bucketKey: '', quantity: '' }])]; rows[ri] = { ...rows[ri], bucketKey: v }; return { ...p, [l.itemId]: rows } }); unlockLine(l.itemId) }}
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
                                onChange={(e) => { const v = e.target.value; setLotRows((p) => { const rows = [...(p[l.itemId] ?? [{ bucketKey: '', quantity: '' }])]; rows[ri] = { ...rows[ri], quantity: v }; return { ...p, [l.itemId]: rows } }); unlockLine(l.itemId) }}
                                placeholder="수량"
                                className={`${input} w-24 text-right disabled:bg-gray-50 disabled:text-gray-500`}
                              />
                              {cur && <span className="text-xs text-gray-400">잔량 {cur.quantity}</span>}
                              {ri > 0 && !isConfirmed && (
                                <button type="button" onClick={() => { setLotRows((p) => ({ ...p, [l.itemId]: (p[l.itemId] ?? []).filter((_, i) => i !== ri) })); unlockLine(l.itemId) }} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                              )}
                            </div>
                          )
                        })}
                        {!isConfirmed && (
                          <button
                            type="button"
                            onClick={() => setLotRows((p) => ({ ...p, [l.itemId]: [...(p[l.itemId] ?? [{ bucketKey: '', quantity: '' }]), { bucketKey: '', quantity: '' }] }))}
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50"
                          >
                            + LOT 추가
                          </button>
                        )}
                        <div className="pt-1">
                          <p className={label}>시리얼 기록 (선택 — 과도기, 재고 차감과 무관)</p>
                          <textarea
                            value={noteText[l.itemId] ?? ''}
                            onChange={(e) => setNoteText((p) => ({ ...p, [l.itemId]: e.target.value }))}
                            disabled={isConfirmed}
                            rows={2}
                            placeholder="스캔한 시리얼을 기록으로 남기려면 줄 단위 입력"
                            className="mt-1 w-full rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 font-mono text-xs disabled:bg-gray-50"
                          />
                        </div>
                      </div>
                    )}

                    {l.mode === 'qty' && (
                      <p className="mt-2 text-sm text-gray-600">
                        수량 차감: <span className="font-medium">{l.quantity}개</span>
                        <span className="ml-2 text-xs text-gray-400">현재고 {l.stockTotal}개</span>
                      </p>
                    )}

                    {(lErrs.length > 0 || l.messages.length > 0) && (
                      <ul className={`mt-2 space-y-0.5 text-xs ${lErrs.length > 0 ? 'text-red-600' : STATUS_TONE[l.status]}`}>
                        {lErrs.map((m, i) => <li key={`l${i}`}>· {m}</li>)}
                        {lErrs.length === 0 && l.messages.map((m, i) => <li key={i}>· {m}</li>)}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-3">
              <span className="text-xs text-gray-400">{confirmed.size} / {preview.lines.length} 품목 확인됨</span>
              <button
                type="button"
                onClick={execute}
                disabled={busy || !ready}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                title={ready ? '' : '모든 품목을 [확인]해야 실행할 수 있습니다'}
              >
                {busy ? '처리 중...' : '출고 실행'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
