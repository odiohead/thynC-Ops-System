'use client'

/**
 * 출고요청 등록·수정 모달 (stock_out_request_design.md §8 · v2 stock_out_v2_design.md §7)
 * 프로젝트는 읽기 전용(프로젝트 상세에서 진입 — 생성 진입점 한정, §2 파생 결정).
 * 품목 = 자재관리 품목 중 해당 업무(이번 범위: 구축 BUILD)에 노출된 것 — 인벤토리 → 분류 순 섹션(품목명만, 모델명 미표시 — 2026-11-01), 빈 값/0 = 미요청.
 * 시스템 구성품 (2026-11-12 개편 — stock_out_v2_design.md §13): '시스템' 분류(thynC시스템 XX)에는 수량만 적고, 그 아래 별도 섹션 두 개가 붙는다.
 *  ① 시스템 구성품 — 고정 종류(`componentKinds`)별 합계 = Σ(시스템 수량 × 구성 수량), 읽기 전용
 *  ② 미출고 수량 — 신청자가 종류별로 입력(0 ≤ 미출고 ≤ 합계). 요청에 `unshipped: [{itemId, quantity}]`로 저장되고, 출고 처리에서 미출고분은 thynC운영팀재고로 편입된다.
 * 구성품은 직접 요청 품목이 아니다(대웅제약재고의 구성품 품목 — 출고 처리에서 합계만큼 자동으로 출고 대상이 됨).
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
  /** 시스템 구성품 미출고 수량 (2026-11-12) — itemId = 구성품 종류 */
  unshipped?: { itemId: number; quantity: number }[]
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
  // 시스템 구성품 — 고정 종류 목록 + 종류별 미출고 수량 입력값 (2026-11-12)
  const [kinds, setKinds] = useState<{ itemId: number; name: string }[]>([])
  const [unshipped, setUnshipped] = useState<Record<number, string>>({})
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
    if (!effPurpose) { setItems([]); setKinds([]); setLoaded(true); return } // 영업 유형 미선택
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
        setKinds(d?.componentKinds ?? [])
        setLoaded(true)
      })
    if (editTarget) {
      setRequestDate(editTarget.requestDate)
      setNote(editTarget.note ?? '')
      const map: Record<number, string> = {}
      const un: Record<number, string> = {}
      editTarget.items.forEach((l) => { map[l.inventoryItemId] = String(l.quantity) })
      for (const u of editTarget.unshipped ?? []) if (u.quantity > 0) un[u.itemId] = String(u.quantity)
      setQty(map)
      setUnshipped(un)
    } else {
      setRequestDate(todayKst())
      setNote('')
      setQty({})
      setUnshipped({})
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
  /** 시스템 구성품 합계 — 종류 id → Σ(시스템 입력 수량 × 구성 수량) */
  const compTotals = useMemo(() => {
    const m = new Map<number, number>()
    for (const it of items) {
      const n = parseInt(qty[it.id] ?? '') || 0
      if (n <= 0) continue
      for (const c of it.components ?? []) m.set(c.childItemId, (m.get(c.childItemId) ?? 0) + n * c.quantity)
    }
    return m
  }, [items, qty])
  /** 구성을 가진 품목(시스템)이 하나라도 노출돼 있을 때만 구성품 섹션을 보인다 */
  const hasSystems = kinds.length > 0 && items.some((it) => (it.components?.length ?? 0) > 0)
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0)

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
    // 미출고 수량 — 합계가 있는 구성품만, 0 ≤ 미출고 ≤ 합계
    const unshippedPayload: { itemId: number; quantity: number }[] = []
    if (!lockItems && hasSystems) {
      for (const k of kinds) {
        const raw = unshipped[k.itemId] ?? ''
        const total = compTotals.get(k.itemId) ?? 0
        if (raw === '' || total === 0) continue
        const u = Number(raw)
        if (!Number.isInteger(u) || u < 0) { setError(`'${k.name}' 미출고 수량은 0 이상의 정수로 입력하세요.`); return }
        if (u > total) { setError(`'${k.name}' 미출고 수량(${u})이 구성품 수량(${total})보다 많습니다.`); return }
        if (u > 0) unshippedPayload.push({ itemId: k.itemId, quantity: u })
      }
    }
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
    const payload = { requestDate, note: note || null, ...(lockItems ? {} : { items: lines, unshipped: unshippedPayload }), ...salesFields }
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
                              <input
                                type="number" min="0"
                                value={qty[it.id] ?? ''}
                                onChange={(e) => setQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                                placeholder="0"
                                className="w-16 shrink-0 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
                              />
                            </div>
                          ))}
                        </div>
                        {/* 시스템 구성품 · 미출고 수량 — 시스템(구성을 가진 품목)이 있는 분류 바로 아래 (2026-11-12) */}
                        {hasSystems && c.list.some((it) => (it.components?.length ?? 0) > 0) && (
                          <div className="mt-3 space-y-2">
                            <div className="rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2" data-testid="so-comp-totals">
                              <p className="mb-1 text-[11px] font-semibold text-amber-800">시스템 구성품 <span className="font-normal text-amber-700/80">— 위 시스템 수량에 따라 자동 계산</span></p>
                              <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                                {kinds.map((k) => {
                                  const total = compTotals.get(k.itemId) ?? 0
                                  return (
                                    <div key={k.itemId} className="flex items-center justify-between gap-2 text-sm" data-testid={`so-comp-total-${k.itemId}`}>
                                      <span className={`min-w-0 flex-1 break-words leading-snug ${total > 0 ? 'text-gray-800' : 'text-gray-400'}`}>{k.name}</span>
                                      <span className={`w-16 shrink-0 pr-2 text-right tabular-nums ${total > 0 ? 'font-semibold text-amber-800' : 'text-gray-300'}`}>{total}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                            <div className="rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2" data-testid="so-comp-unshipped">
                              <p className="mb-1 text-[11px] font-semibold text-gray-700">미출고 수량 <span className="font-normal text-gray-500">— 구성품 중 출고하지 않을 수량 (신청자 입력)</span></p>
                              <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                                {kinds.map((k) => {
                                  const total = compTotals.get(k.itemId) ?? 0
                                  const raw = unshipped[k.itemId] ?? ''
                                  const over = total > 0 && raw !== '' && (!(Number(raw) >= 0) || Number(raw) > total)
                                  return (
                                    <div key={k.itemId} className="flex items-center justify-between gap-2 text-sm">
                                      <span className={`min-w-0 flex-1 break-words leading-snug ${total > 0 ? 'text-gray-800' : 'text-gray-400'}`}>{k.name}</span>
                                      <input
                                        type="number" min="0" max={total}
                                        value={total > 0 ? raw : ''}
                                        disabled={total === 0}
                                        onChange={(e) => setUnshipped((prev) => ({ ...prev, [k.itemId]: e.target.value }))}
                                        placeholder="0"
                                        aria-label={`${k.name} 미출고 수량`}
                                        title={total > 0 ? `${k.name} ${total}개 중 출고하지 않을 수량` : '시스템 수량을 먼저 입력하세요'}
                                        className={`w-16 shrink-0 rounded-md border px-2 py-1 text-right text-sm disabled:bg-gray-100 disabled:text-gray-300 ${over ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        )}
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
