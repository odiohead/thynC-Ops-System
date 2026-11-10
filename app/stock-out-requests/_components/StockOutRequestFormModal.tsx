'use client'

/**
 * 출고요청 등록·수정 모달 (stock_out_request_design.md §8 · v2 stock_out_v2_design.md §7)
 * 프로젝트는 읽기 전용(프로젝트 상세에서 진입 — 생성 진입점 한정, §2 파생 결정).
 * 품목 = 자재관리 품목 중 해당 업무(이번 범위: 구축 BUILD)에 노출된 것 — 인벤토리 → 분류 순 섹션(품목명만, 모델명 미표시 — 2026-11-01), 빈 값/0 = 미요청.
 * 구성 안내 (2026-11-01): 주 품목(thynC 시스템 XX) 수량을 적으면 그 구성에 포함된 부자재(운영팀재고) 행의 수량 입력란 왼쪽에 '포함 n'을 표시
 * (재고 처리와 무관한 안내 — 사용자가 추가로 적는 수량만 요청됨).
 * 첨부 파일 (2026-11-02): 등록 모드는 파일을 담아 두었다가 생성 직후 업로드, 수정 모드는 StockOutFilesPanel로 즉시 업로드·삭제. 엑셀 등 요청 근거.
 * 영업 유형 모드 (2026-11-05 — stock_out_sales_request_design.md §5): project 미지정이면 출고업무 목록 [출고요청]에서 여는
 * 평가용·판매용·오산영업소 등록/수정 — 유형·목적·납품처(병원 검색/기타)·수령지·수취인 + 항목 아래 입력 가이드. 프로젝트 유형은 여기서 만들지 않음(프로젝트 상세 전용).
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import FileDropZone from '@/app/components/FileDropZone' // 첨부 끌어다 놓기 (2026-11-10)
import { FileSpreadsheet, Paperclip, X } from 'lucide-react'
import {
  STOCK_OUT_PURPOSE_LABELS, STOCK_OUT_SALES_TYPES, STOCK_OUT_SUB_PURPOSES, STOCK_OUT_GUIDE_FIELDS, isStockOutSalesType,
  type StockOutPurpose, type StockOutSalesType, type StockOutGuideKey,
} from '@/lib/stockOutShared'
import DestHospitalSearch, { type DestHospital } from './DestHospitalSearch'
import { STOCK_OUT_FILE_MAX_BYTES, STOCK_OUT_FILES_PER_REQUEST, isSpreadsheetFile } from '@/lib/stockOutFiles'
import StockOutFilesPanel, { fmtFileSize } from './StockOutFilesPanel'

export interface StockOutItemOpt {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  categoryName: string | null
  stockTotal: number
  inventoryId: number
  inventoryName: string
  components?: { childItemId: number; childName: string; quantity: number }[]
}

export interface StockOutEditTarget {
  id: number
  sorCode: string
  requestDate: string // YYYY-MM-DD
  note: string | null
  purpose: StockOutPurpose
  /** 이미 담긴 라인 — 노출 해제된 품목도 폼에 유지하기 위해 표시용 정보 동반 */
  items: { inventoryItemId: number; quantity: number; name?: string; modelName?: string | null; inventoryId?: number; inventoryName?: string; categoryName?: string | null }[]
  /** 영업 유형 전용 */
  subPurpose?: string | null
  destType?: string | null
  destHospital?: DestHospital | null
  destText?: string | null
  shipAddress?: string | null
  recipient?: string | null
}

const DEFAULT_GUIDES = Object.fromEntries(STOCK_OUT_GUIDE_FIELDS.map((f) => [f.key, f.fallback])) as Record<StockOutGuideKey, string>

function todayKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export default function StockOutRequestFormModal({
  open,
  onClose,
  onSaved,
  project,
  editTarget,
  purpose = 'BUILD',
  lockItems = false,
}: {
  open: boolean
  onClose: () => void
  /** 저장 성공 콜백 — 호출부가 목록 갱신·router.refresh 담당 */
  onSaved: () => void
  /** 프로젝트 요청 — 미지정이면 영업 유형(평가용·판매용·오산영업소) 모드 */
  project?: { projectCode: string; projectName: string; hospitalName?: string | null } | null
  /** 지정 시 수정 모드 (PUT), 미지정이면 등록 (POST) */
  editTarget?: StockOutEditTarget | null
  /** 분실 AS 연동 요청 — 품목은 출고 시 시리얼로 정해지므로 폼에서 숨기고 전송하지 않음 (2026-11-10) */
  lockItems?: boolean
  /** 업무 구분 — 이번 범위는 프로젝트 팝업 = 구축 */
  purpose?: StockOutPurpose
}) {
  const salesMode = !project
  // 영업 유형 — 등록은 선택, 수정은 고정 (품목 라인이 유형 인벤토리에 묶여 있음)
  const [salesType, setSalesType] = useState<StockOutSalesType | ''>('')
  const effPurpose: StockOutPurpose | '' = editTarget?.purpose ?? (salesMode ? salesType : purpose)
  const [subPurpose, setSubPurpose] = useState('')
  const [destType, setDestType] = useState<'HOSPITAL' | 'OTHER' | ''>('')
  const [destHospital, setDestHospital] = useState<DestHospital | null>(null)
  const [destText, setDestText] = useState('')
  const [shipAddress, setShipAddress] = useState('')
  const [recipient, setRecipient] = useState('')
  const [guides, setGuides] = useState<Record<StockOutGuideKey, string>>(DEFAULT_GUIDES)
  const [items, setItems] = useState<StockOutItemOpt[]>([])
  const [loaded, setLoaded] = useState(false)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [requestDate, setRequestDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 등록 모드 첨부 — 생성 직후 /files 에 업로드 (수정 모드는 패널이 직접 처리)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  function addPending(list: FileList | File[] | null) {
    if (!list) return
    setError(null)
    const next = [...pendingFiles]
    for (const f of Array.from(list)) {
      if (f.size > STOCK_OUT_FILE_MAX_BYTES) { setError(`'${f.name}'은 파일당 ${Math.round(STOCK_OUT_FILE_MAX_BYTES / 1024 / 1024)}MB를 초과합니다.`); continue }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f)
    }
    if (next.length > STOCK_OUT_FILES_PER_REQUEST) { setError(`첨부는 한 번에 최대 ${STOCK_OUT_FILES_PER_REQUEST}개까지 가능합니다.`); next.length = STOCK_OUT_FILES_PER_REQUEST }
    setPendingFiles(next)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // 영업 유형 모드 — 폼 열 때 기본값·가이드
  useEffect(() => {
    if (!open || !salesMode) return
    setSalesType(editTarget && isStockOutSalesType(editTarget.purpose) ? editTarget.purpose : '')
    setSubPurpose(editTarget?.subPurpose ?? '')
    setDestType(editTarget?.destType === 'HOSPITAL' || editTarget?.destType === 'OTHER' ? editTarget.destType : '')
    setDestHospital(editTarget?.destHospital ?? null)
    setDestText(editTarget?.destText ?? '')
    setShipAddress(editTarget?.shipAddress ?? '')
    setRecipient(editTarget?.recipient ?? '')
    fetch('/api/settings/stock-out-guides', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.guides && setGuides({ ...DEFAULT_GUIDES, ...d.guides }))
      .catch(() => {})
  }, [open, salesMode, editTarget])

  // 등록 모드에서 유형을 바꾸면 목적 재설정(1개면 자동)
  function pickSalesType(t: StockOutSalesType) {
    setSalesType(t)
    const opts = STOCK_OUT_SUB_PURPOSES[t]
    setSubPurpose(opts.length === 1 ? opts[0].code : '')
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoaded(false)
    setPendingFiles([])
    if (!effPurpose) { setItems([]); setLoaded(true); return } // 영업 유형 미선택
    fetch(`/api/settings/stock-out-items?purpose=${effPurpose}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: StockOutItemOpt[] = []
        for (const g of (d?.inventories ?? []) as { id: number; name: string; items: Omit<StockOutItemOpt, 'inventoryId' | 'inventoryName'>[] }[]) {
          for (const it of g.items) list.push({ ...it, inventoryId: g.id, inventoryName: g.name })
        }
        // 수정 대상에 이미 담긴 품목이 노출 해제됐어도 유지 (현행 비활성 품목 처리와 동일)
        for (const l of editTarget?.items ?? []) {
          if (!list.some((x) => x.id === l.inventoryItemId)) {
            list.push({ id: l.inventoryItemId, itemCode: '', name: l.name ?? `품목 #${l.inventoryItemId}`, modelName: l.modelName ?? null, categoryName: l.categoryName ?? null, stockTotal: 0, inventoryId: l.inventoryId ?? 0, inventoryName: l.inventoryName ?? '(노출 해제됨)' })
          }
        }
        setItems(list)
        setLoaded(true)
      })
    if (editTarget) {
      setRequestDate(editTarget.requestDate)
      setNote(editTarget.note ?? '')
      const map: Record<number, string> = {}
      editTarget.items.forEach((l) => { map[l.inventoryItemId] = String(l.quantity) })
      setQty(map)
    } else {
      setRequestDate(todayKst())
      setNote('')
      setQty({})
    }
  }, [open, editTarget, effPurpose])

  const salesTypeKey = (effPurpose && isStockOutSalesType(effPurpose) ? effPurpose : null) as StockOutSalesType | null

  /** 인벤토리 → 분류 순 섹션 */
  const sections = useMemo(() => {
    const byInv = new Map<number, { name: string; cats: Map<string, StockOutItemOpt[]> }>()
    for (const it of items) {
      const inv = byInv.get(it.inventoryId) ?? { name: it.inventoryName, cats: new Map() }
      const key = it.categoryName ?? '기타'
      inv.cats.set(key, [...(inv.cats.get(key) ?? []), it])
      byInv.set(it.inventoryId, inv)
    }
    return Array.from(byInv.entries()).map(([id, v]) => ({ id, name: v.name, cats: Array.from(v.cats.entries()).map(([cat, list]) => ({ cat, list })) }))
  }, [items])

  const lines = useMemo(
    () => items.map((it) => ({ inventoryItemId: it.id, quantity: parseInt(qty[it.id] ?? '') || 0 })).filter((l) => l.quantity > 0),
    [items, qty]
  )
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0)

  /** 구성 포함 수량 — childId → { total, sources[] } (주 품목 입력 수량 × 구성 수량 합) */
  const included = useMemo(() => {
    const map = new Map<number, { total: number; sources: { name: string; qty: number }[] }>()
    for (const it of items) {
      const n = parseInt(qty[it.id] ?? '') || 0
      if (n <= 0 || !it.components?.length) continue
      for (const c of it.components) {
        const cur = map.get(c.childItemId) ?? { total: 0, sources: [] }
        cur.total += n * c.quantity
        cur.sources.push({ name: it.name, qty: n * c.quantity })
        map.set(c.childItemId, cur)
      }
    }
    return map
  }, [items, qty])

  function validateSales(): string | null {
    if (!salesTypeKey) return '유형을 선택하세요.'
    if (!subPurpose) return '목적을 선택하세요.'
    if (!destType) return '납품처(병원/기타)를 선택하세요.'
    if (destType === 'HOSPITAL' && !destHospital) return '납품처 병원을 검색해서 선택하세요.'
    if (destType === 'OTHER' && !destText.trim()) return '납품처를 입력하세요.'
    if (!shipAddress.trim()) return '수령지를 입력하세요.'
    if (!recipient.trim()) return '수취인을 입력하세요.'
    return null
  }

  async function submit() {
    if (salesMode) {
      const v = validateSales()
      if (v) { setError(v); return }
    }
    if (!requestDate) { setError('희망 출고일을 입력하세요.'); return }
    if (!lockItems && lines.length === 0) { setError('출고 품목 수량을 1개 이상 입력하세요.'); return }
    setBusy(true)
    setError(null)
    const salesFields = salesMode
      ? {
          subPurpose, destType,
          destHospitalCode: destType === 'HOSPITAL' ? destHospital?.hospitalCode : null,
          destText: destType === 'OTHER' ? destText.trim() : null,
          shipAddress: shipAddress.trim(), recipient: recipient.trim(),
        }
      : {}
    const payload = { requestDate, note: note || null, ...(lockItems ? {} : { items: lines }), ...salesFields }
    const res = editTarget
      ? await fetch(`/api/stock-out-requests/${editTarget.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/stock-out-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, projectCode: project?.projectCode, purpose: effPurpose }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setBusy(false); setError(d.error ?? '저장에 실패했습니다.'); return }

    // 등록 모드: 담아 둔 첨부를 생성된 요청에 업로드 (실패해도 요청은 이미 생성됨 — 상세에서 재시도 안내)
    const newId: number | undefined = editTarget ? editTarget.id : d.stockOutRequest?.id
    if (!editTarget && pendingFiles.length && newId) {
      const fd = new FormData()
      pendingFiles.forEach((f) => fd.append('files', f))
      const up = await fetch(`/api/stock-out-requests/${newId}/files`, { method: 'POST', body: fd })
      const ud = await up.json().catch(() => ({}))
      const failed: { name: string; error: string }[] = ud.failed ?? []
      if (!up.ok || failed.length) {
        window.alert(`출고요청은 생성되었지만 첨부 ${failed.length || pendingFiles.length}건이 업로드되지 않았습니다.\n${ud.error ?? failed.map((f) => `${f.name}: ${f.error}`).join('\n')}\n출고요청 상세에서 다시 첨부해 주세요.`)
      }
    }
    setBusy(false)
    onSaved()
    onClose()
  }

  if (!open) return null

  const label = 'text-xs font-medium text-gray-500'
  const guide = (k: StockOutGuideKey) => salesMode && guides[k] ? <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{guides[k]}</p> : null
  const inputCls = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {editTarget ? `출고요청 수정 — ${editTarget.sorCode}` : '출고요청'}
              {effPurpose && <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">{STOCK_OUT_PURPOSE_LABELS[effPurpose]}</span>}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {project ? (
                <>
                  {project.projectName}
                  {project.hospitalName && <span className="ml-1.5 text-gray-400">· {project.hospitalName}</span>}
                </>
              ) : (
                '평가용·판매용·오산영업소 출고 — 구축 프로젝트 출고는 프로젝트 상세에서 요청합니다.'
              )}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">✕</button>
        </div>

        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="space-y-4">
          {salesMode && (
            <>
              <div>
                <label className={label}>유형 *</label>
                {guide('type')}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {editTarget ? (
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-700">{salesTypeKey ? STOCK_OUT_PURPOSE_LABELS[salesTypeKey] : '-'} <span className="text-xs text-gray-400">(수정 불가)</span></span>
                  ) : (
                    STOCK_OUT_SALES_TYPES.map((t) => (
                      <button key={t} type="button" onClick={() => pickSalesType(t)} className={chip(salesType === t)}>{STOCK_OUT_PURPOSE_LABELS[t]}</button>
                    ))
                  )}
                </div>
              </div>

              {salesTypeKey && (
                <div>
                  <label className={label}>목적 *</label>
                  {STOCK_OUT_SUB_PURPOSES[salesTypeKey].length > 1 && guide('subPurpose')}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {STOCK_OUT_SUB_PURPOSES[salesTypeKey].map((o) => (
                      <button key={o.code} type="button" onClick={() => setSubPurpose(o.code)} className={chip(subPurpose === o.code)}>
                        {o.label}{STOCK_OUT_SUB_PURPOSES[salesTypeKey].length === 1 && <span className="ml-1 text-xs opacity-80">(자동)</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className={label}>납품처 *</label>
                {guide('dest')}
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" onClick={() => setDestType('HOSPITAL')} className={chip(destType === 'HOSPITAL')}>병원</button>
                  <button type="button" onClick={() => setDestType('OTHER')} className={chip(destType === 'OTHER')}>기타</button>
                </div>
                {destType === 'HOSPITAL' && <DestHospitalSearch value={destHospital} onChange={setDestHospital} disabled={busy} />}
                {destType === 'OTHER' && <input value={destText} maxLength={200} onChange={(e) => setDestText(e.target.value)} placeholder="납품처 이름 (예: OO학회 부스)" className={inputCls} />}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={label}>수령지 *</label>
                  {guide('shipAddress')}
                  <input value={shipAddress} maxLength={500} onChange={(e) => setShipAddress(e.target.value)} placeholder="받을 주소" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className={label}>수취인 *</label>
                  {guide('recipient')}
                  <input value={recipient} maxLength={100} onChange={(e) => setRecipient(e.target.value)} placeholder="이름 / 연락처" className={inputCls} />
                </div>
              </div>
            </>
          )}

          <div>
            <label className={label}>희망 출고일 *</label>
            {guide('requestDate')}
            <input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} className="mt-1 w-44 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
          </div>

          {lockItems ? (
            <p className="rounded-md border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs text-teal-800">분실 AS 연동 요청 — 품목은 출고 처리에서 입력한 본체 시리얼·센서류로 정해집니다 (여기서 수정 불가).</p>
          ) : (
          <div>
            <div className="flex items-baseline justify-between">
              <label className={label}>출고 품목별 수량 *</label>
              <span className="text-xs text-gray-400">{lines.length}종 · 총 {totalQty}개</span>
            </div>
            {guide('items')}
            {salesMode && !effPurpose ? (
              <p className="mt-2 text-sm text-gray-400">유형을 먼저 선택하세요.</p>
            ) : !loaded ? (
              <p className="mt-2 text-sm text-gray-400">품목을 불러오는 중…</p>
            ) : items.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">{`'${effPurpose ? STOCK_OUT_PURPOSE_LABELS[effPurpose] : ''}' 출고에 노출된 품목이 없습니다. 설정 > 출고 품목 관리에서 지정하세요.`}</p>
            ) : (
              <div className="mt-1.5 space-y-3">
                {sections.map((inv) => (
                  <div key={inv.id} className="rounded-lg border border-gray-200">
                    <p className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">{inv.name}</p>
                    {inv.cats.map((c) => (
                      <div key={c.cat} className="border-b border-gray-100 px-3 py-2 last:border-b-0">
                        <p className="mb-1 text-[11px] font-medium text-gray-400">{c.cat}</p>
                        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                          {c.list.map((it) => (
                            <div key={it.id} className="flex items-center justify-between gap-2">
                              {/* 품목명은 자르지 않고 줄바꿈 — 식별부(모델명)가 이름 끝에 있어 앞부분만으로는 구분 불가 (2026-11-09). 모델명이 이름에 없으면 모노 보조 표기 */}
                              <span className="min-w-0 flex-1 break-words text-sm leading-snug text-gray-800" data-testid={`so-item-name-${it.id}`}>
                                {it.name}
                                {it.modelName && !it.name.includes(it.modelName) && <span className="ml-1 whitespace-nowrap font-mono text-[11px] text-gray-500">{it.modelName}</span>}
                              </span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {included.get(it.id) && (
                                  <span
                                    className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
                                    title={included.get(it.id)!.sources.map((s) => `${s.name} → ${s.qty}`).join('\n')}
                                  >
                                    포함 {included.get(it.id)!.total}
                                  </span>
                                )}
                                <input
                                  type="number" min="0"
                                  value={qty[it.id] ?? ''}
                                  onChange={(e) => setQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                                  placeholder="0"
                                  className="w-16 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          <div>
            <label className={label}>비고</label>
            {guide('note')}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="배송·수령 관련 요청사항 등" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
          </div>

          {/* 첨부 파일 (2026-11-02) — 엑셀 등 출고 근거. 등록 모드: 담아 두었다가 생성 직후 업로드 / 수정 모드: 즉시 반영 */}
          <div>
            <div className="flex items-baseline justify-between">
              <label className={label}>첨부 파일 <span className="font-normal text-gray-400">(엑셀·PDF 등, 선택)</span></label>
              {!editTarget && pendingFiles.length > 0 && <span className="text-xs text-gray-400">{pendingFiles.length}개 · {fmtFileSize(pendingFiles.reduce((s, f) => s + f.size, 0))}</span>}
            </div>
            {editTarget ? (
              <div className="mt-1.5"><StockOutFilesPanel requestId={editTarget.id} canWrite compact /></div>
            ) : (
              <FileDropZone onFiles={(fs) => addPending(fs)} disabled={busy} className="mt-1.5 space-y-1.5" testId="so-pending-drop">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50"
                >
                  <Paperclip className="h-3.5 w-3.5" /> 파일 선택 또는 끌어다 놓기 <span className="text-gray-400">(파일당 {Math.round(STOCK_OUT_FILE_MAX_BYTES / 1024 / 1024)}MB · 최대 {STOCK_OUT_FILES_PER_REQUEST}개 · 생성 시 함께 업로드)</span>
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => addPending(e.target.files)} />
                {pendingFiles.length > 0 && (
                  <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                    {pendingFiles.map((f, i) => (
                      <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        {isSpreadsheetFile(f.name) ? <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" /> : <Paperclip className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                        <span className="min-w-0 flex-1 truncate text-gray-800" title={f.name}>{f.name}</span>
                        <span className="shrink-0 text-[11px] text-gray-400">{fmtFileSize(f.size)}</span>
                        <button type="button" onClick={() => setPendingFiles(pendingFiles.filter((_, j) => j !== i))} disabled={busy} className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600" aria-label={`${f.name} 제거`}><X className="h-3.5 w-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </FileDropZone>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">취소</button>
            <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? '저장 중...' : editTarget ? '수정 저장' : '출고요청 생성'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
