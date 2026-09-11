'use client'

/**
 * AS접수 상세 (as_work_design.md §8 — 2026-09-11 카드 재구성)
 * 1 공통정보 → 2 접수정보(접수자 입력, 시트 A~M·S·T) → 3 AS상세내역(AS담당자 입력, 시트 N~X — 기기군별 카드: 라인별 처리내용, 기기군 단위 발송정보) → 4 비고.
 * 상태 변경(도메인→티켓 동기화)·수정 모달·삭제(티켓 동반) — 권한 §13-1.
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import TicketStatusBadge from '@/app/tickets/components/TicketStatusBadge'
import AsReceiptFormModal, { type AsEditTarget } from '../_components/AsReceiptFormModal'
import {
  AS_CATEGORY_LABELS, AS_PICKUP_METHOD_LABELS, AS_SHIP_METHOD_LABELS, AS_DEST_TYPES,
  AS_DEST_TYPE_LABELS, AS_OUTCOME_LABELS,
  type AsCategory, type AsMethod, type AsDestType, type AsOutcome, AS_REGISTRY_TAG_LABELS, AS_REGISTRY_TAG_DESC, type AsRegistryTag, type AsRegistryLineTag,
  AS_METHODS, AS_DEVICE_GROUPS, asDeviceGroupOf, type AsDeviceGroup,
  AS_RESOLVE_OUTCOMES, AS_INTAKE_STATE_LABELS, AS_DEVICE_KINDS, isAsIntakeIssue, asDeviceKindFromSerial, type AsIntakeState } from '@/lib/asReceiptShared'
import type { TicketStatus } from '@prisma/client'
import { PRODUCT_TYPES } from '@/lib/deviceRegistryShared'

interface CodeRef { id: number; name: string; color: string | null }

interface ItemRow {
  id: number
  serialNo: string
  deviceId: number | null
  newDeviceId: number | null
  deviceKind: string | null
  wardName: string | null
  symptom: string | null
  processNote: string | null
  outcome: string | null
  newSerialNo: string | null
  shipMethod: string | null
  shipTrackingNo: string | null
  shippedAt: string | null
  device: {
    id: number
    deviceInfo: { deviceName: string }
    placement: { status: string; hospitalCode: string | null; asStartedOn: string | null; asRefCode: string | null; ward: { name: string } | null } | null
  } | null
  newDevice: { id: number; serialNo: string } | null
  registryTag: AsRegistryLineTag | null // 미종결 라인의 현재 원장 정합(정상=null) — API 실시간 계산
  intakeState: string // 입고 대조 (2026-09-11): PENDING/RECEIVED/MISMATCH/EXTRA
  receivedAt: string | null
  receiptSerialNo: string | null // 치환 전 접수 시리얼
  intakeSource: string
}

interface AsDetail {
  id: number
  asCode: string
  category: string
  receiptDate: string
  reporterName: string | null
  pickupMethod: string | null
  pickupTrackingNo: string | null
  pickedUpAt: string | null
  receivedAt: string | null
  checkedAt: string | null // 확인일 (O열)
  preReplace: boolean
  destType: string | null
  destInfo: string | null
  pickupDestDiffers: boolean
  pickupDestInfo: string | null
  expectedShipDate: string | null
  note: string | null
  resolvedAt: string | null
  createdAt: string
  hospital: { hospitalCode: string; hospitalName: string } | null
  status: (CodeRef & { ticketStatus: TicketStatus | null }) | null
  createdBy: { id: string; name: string } | null
  ticket: { id: number; ticketCode: string; status: TicketStatus; owner: { id: string; name: string } | null } | null
  items: ItemRow[]
}

function codeBadge(c: CodeRef | null) {
  if (!c) return <span className="text-sm text-gray-400">-</span>
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${c.color ?? '#9CA3AF'}22`, color: c.color ?? '#6B7280' }}
    >
      {c.name}
    </span>
  )
}

const OUTCOME_BADGE_CLS: Record<string, string> = {
  REPAIR_RETURN: 'bg-emerald-50 text-emerald-700',
  REPLACE: 'bg-blue-50 text-blue-700',
  LOST: 'bg-red-50 text-red-600',
  CANCELED: 'bg-gray-100 text-gray-500',
  NOT_RECEIVED: 'bg-amber-100 text-amber-700',
}

const INTAKE_BADGE_CLS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-400',
  RECEIVED: 'bg-emerald-50 text-emerald-700',
  MISMATCH: 'bg-red-100 text-red-700',
  EXTRA: 'bg-orange-100 text-orange-700',
}
function intakeBadge(item: ItemRow) {
  if (item.outcome) return null
  const st = item.intakeState as AsIntakeState
  return (
    <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium ${INTAKE_BADGE_CLS[st] ?? INTAKE_BADGE_CLS.PENDING}`} title={item.receivedAt ? `입고 ${item.receivedAt.slice(0, 10)}` : undefined}>
      {AS_INTAKE_STATE_LABELS[st] ?? item.intakeState}
    </span>
  )
}

function fmtDt(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

const d10 = (iso: string | null) => (iso ? iso.slice(0, 10) : '-')

function todayKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

/** 라인의 기기현황 상태 배지 */
const REGISTRY_TAG_BADGE: Record<AsRegistryTag, string> = {
  OTHER_HOSPITAL: 'bg-red-50 text-red-600',
  RECOVERED: 'bg-amber-50 text-amber-700',
  UNPLACED: 'bg-gray-100 text-gray-500',
  UNREGISTERED: 'bg-gray-100 text-gray-500',
}

function deviceBadge(item: ItemRow, asCode: string, hospitalCode: string | null) {
  // 미종결 라인 — API가 시리얼로 실시간 대조한 태그 우선 (목록 '접수 기기상태'와 같은 기준)
  if (item.registryTag) {
    const t = item.registryTag
    return (
      <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${REGISTRY_TAG_BADGE[t.tag]}`} title={AS_REGISTRY_TAG_DESC[t.tag]}>
        {AS_REGISTRY_TAG_LABELS[t.tag]}{t.detail ? ` · ${t.detail}` : ''}
      </span>
    )
  }
  if (!item.deviceId) return <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">미등록</span>
  const p = item.device?.placement
  if (!p) return null
  if (p.status === 'RECOVERED') return <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">회수</span>
  if (hospitalCode && p.hospitalCode !== hospitalCode) return <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">타 병원</span>
  if (p.asStartedOn) {
    return (
      <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[11px] font-medium text-cyan-700" title={p.asRefCode === asCode ? '이 접수의 AS 표시' : `다른 참조: ${p.asRefCode ?? '없음'}`}>
        AS진행중
      </span>
    )
  }
  return null
}

const label = 'text-xs font-medium uppercase tracking-wider text-gray-400'
const inputCls = 'mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm'

function Card({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-2.5 sm:px-6">
        <h2 className="text-sm font-semibold text-gray-700">
          {title}
          {sub && <span className="ml-2 text-xs font-normal text-gray-400">{sub}</span>}
        </h2>
        {right}
      </div>
      {children}
    </div>
  )
}

// ── 3-x 기기군 카드 ─────────────────────────────────────────────
interface GroupCardProps {
  index: string
  group: AsDeviceGroup
  items: ItemRow[]
  asCode: string
  hospitalCode: string | null
  canResolve: boolean
  canEdit: boolean
  busy: boolean
  onResolve: (lines: { itemId: number; outcome: AsOutcome; newSerial?: string; processNote?: string }[], effectiveDate: string, shipMethod: string, shipTrackingNo: string) => Promise<boolean>
  onSaveProcessNote: (item: ItemRow, note: string) => Promise<boolean>
  onApplyShipInfo: (itemIds: number[], shipMethod: string, shipTrackingNo: string, shippedAt: string) => Promise<boolean>
  onConfirm: (body: Record<string, unknown>) => Promise<boolean> // 입고 대조 접수자 확인 (2026-09-11)
  extras: ItemRow[] // 접수 전체의 미식별입고 라인 (치환 후보 — 기기군 무관)
  onRegistryConfirm: (body: Record<string, unknown>) => Promise<boolean> // 원장 정합 확정 (2026-09-11)
}
const MODEL_BY_KIND: Record<string, string> = { 심전도: '심전계', 산소포화도: '산소포화도', 게이트웨이: '게이트웨이' }

function GroupCard({ index, group, items, asCode, hospitalCode, canResolve, canEdit, busy, onResolve, onSaveProcessNote, onApplyShipInfo, onConfirm, extras, onRegistryConfirm }: GroupCardProps) {
  const openItems = items.filter((i) => !i.outcome && !isAsIntakeIssue(i.intakeState)) // 미입고·미식별입고는 처리 대상 아님
  const issueItems = items.filter((i) => !i.outcome && isAsIntakeIssue(i.intakeState))
  const shippedItems = items.filter((i) => i.outcome === 'REPAIR_RETURN' || i.outcome === 'REPLACE')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const registryItems = items.filter((i) => !i.outcome && i.registryTag) // 원장 정합 확인 대상 (타병원·회수·미배치·미등록)
  const [regForm, setRegForm] = useState<Record<number, { modelInput: string; productType: string; wardName: string }>>({})
  const regOf = (i: ItemRow) => regForm[i.id] ?? { modelInput: MODEL_BY_KIND[asDeviceKindFromSerial(i.serialNo) ?? ''] ?? '', productType: '', wardName: i.wardName ?? '' }
  const [remapPick, setRemapPick] = useState<Record<number, string>>({}) // MISMATCH 라인별 치환 대상 EXTRA id
  const [nrComment, setNrComment] = useState<Record<number, string>>({}) // 미회수 코멘트
  const [outcome, setOutcome] = useState<AsOutcome>('REPAIR_RETURN')
  const [effectiveDate, setEffectiveDate] = useState(todayKst())
  const [newSerials, setNewSerials] = useState<Record<number, string>>({})
  const [notes, setNotes] = useState<Record<number, string>>({})
  // 기기군 공통 발송정보 — 기발송 라인이 있으면 첫 라인 값으로 초기화 (한 번만 입력 — 2026-09-11)
  const first = shippedItems[0]
  const [shipMethod, setShipMethod] = useState(first?.shipMethod ?? '')
  const [shipTrackingNo, setShipTrackingNo] = useState(first?.shipTrackingNo ?? '')
  const [shippedAt, setShippedAt] = useState(first?.shippedAt?.slice(0, 10) ?? '')
  useEffect(() => {
    setSelected(new Set())
    setNotes({})
    const f = items.find((i) => i.outcome === 'REPAIR_RETURN' || i.outcome === 'REPLACE')
    if (f) { setShipMethod(f.shipMethod ?? ''); setShipTrackingNo(f.shipTrackingNo ?? ''); setShippedAt(f.shippedAt?.slice(0, 10) ?? '') }
  }, [items])

  const isShipOutcome = outcome === 'REPAIR_RETURN' || outcome === 'REPLACE'
  const allOpenSelected = openItems.length > 0 && openItems.every((i) => selected.has(i.id))
  const noteOf = (i: ItemRow) => (notes[i.id] ?? i.processNote ?? '')

  async function run() {
    const lines = Array.from(selected).map((itemId) => ({
      itemId, outcome,
      newSerial: outcome === 'REPLACE' ? newSerials[itemId] ?? '' : undefined,
      processNote: notes[itemId] !== undefined ? notes[itemId] : undefined,
    }))
    if (!lines.length) return
    if (outcome === 'REPLACE' && lines.some((l) => !l.newSerial?.trim())) { alert('교체 처리는 선택한 모든 라인에 발송기기 시리얼이 필요합니다.'); return }
    if (!confirm(`[${group}] ${lines.length}개 라인을 [${AS_OUTCOME_LABELS[outcome]}] 처리합니다.\n기기현황에 즉시 기록됩니다. 계속할까요?`)) return
    const ok = await onResolve(lines, isShipOutcome ? (shippedAt || effectiveDate) : effectiveDate, isShipOutcome ? shipMethod : '', isShipOutcome ? shipTrackingNo : '')
    if (ok) { setSelected(new Set()); setNewSerials({}) }
  }

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
        <h3 className="text-sm font-semibold text-gray-700">{index}. {group}</h3>
        <span className="text-xs text-gray-400">
          {items.length}대 · 종결 {items.filter((i) => i.outcome).length}대
          {issueItems.length > 0 && <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">입고 확인 {issueItems.length}</span>}
          {registryItems.length > 0 && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">원장 확인 {registryItems.length}</span>}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead>
            <tr>
              {canResolve && (
                <th className="w-8 px-3 py-2">
                  {openItems.length > 0 && (
                    <input type="checkbox" checked={allOpenSelected} onChange={(e) => setSelected(e.target.checked ? new Set(openItems.map((i) => i.id)) : new Set())} className="rounded border-gray-300" title="처리 가능 라인 전체 선택" />
                  )}
                </th>
              )}
              {['시리얼', '입고', '병동', '증상', '처리내용', '결과', '교체기', '발송'].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item) => (
              <tr key={item.id} className={item.outcome === 'CANCELED' ? 'text-gray-400' : ''}>
                {canResolve && (
                  <td className="px-3 py-2">
                    {!item.outcome && !isAsIntakeIssue(item.intakeState) && (
                      <input type="checkbox" checked={selected.has(item.id)} onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(item.id); else n.delete(item.id); return n })} className="rounded border-gray-300" />
                    )}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="font-mono text-sm text-gray-900">{item.serialNo}</span>
                  <span className="ml-1.5">{deviceBadge(item, asCode, hospitalCode)}</span>
                  {item.device?.deviceInfo.deviceName == null && item.deviceKind && <span className="ml-1 text-[11px] text-gray-400">{item.deviceKind}</span>}
                  {item.receiptSerialNo && <span className="ml-1 text-[11px] text-gray-400" title="접수 시 입력된 시리얼(치환 전)">접수 {item.receiptSerialNo}</span>}
                  {item.intakeSource === 'INTAKE' && item.intakeState === 'RECEIVED' && <span className="ml-1 text-[11px] text-gray-400">입고 편입</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{intakeBadge(item)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{item.device?.placement?.ward?.name ?? item.wardName ?? '-'}</td>
                <td className="max-w-[14rem] truncate px-3 py-2 text-gray-700" title={item.symptom ?? undefined}>{item.symptom ?? '-'}</td>
                <td className="px-3 py-1.5">
                  {canEdit ? (
                    <input
                      type="text"
                      value={noteOf(item)}
                      onChange={(e) => setNotes((p) => ({ ...p, [item.id]: e.target.value }))}
                      onBlur={() => { if (notes[item.id] !== undefined && notes[item.id] !== (item.processNote ?? '')) void onSaveProcessNote(item, notes[item.id]) }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      placeholder="처리내용"
                      className={`w-44 rounded-md border px-2 py-1 text-xs ${notes[item.id] !== undefined && notes[item.id] !== (item.processNote ?? '') ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}
                    />
                  ) : <span className="text-xs text-gray-500" title={item.processNote ?? undefined}>{item.processNote ?? '-'}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {item.outcome ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_BADGE_CLS[item.outcome] ?? 'bg-gray-100 text-gray-500'}`}>{AS_OUTCOME_LABELS[item.outcome as AsOutcome] ?? item.outcome}</span>
                  ) : <span className="text-xs text-gray-300">진행 중</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">{item.newSerialNo ?? '-'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                  {item.shippedAt ? (
                    <>
                      {d10(item.shippedAt)}
                      {item.shipMethod && <span className="ml-1">{AS_SHIP_METHOD_LABELS[item.shipMethod as AsMethod]}</span>}
                      {item.shipTrackingNo && <span className="ml-1 font-mono text-gray-400">{item.shipTrackingNo}</span>}
                    </>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 원장 정합 — 접수자 확정 (타병원·회수·미배치·미등록 라인 → 이 병원 배치로 보정) */}
      {canEdit && registryItems.length > 0 && (
        <div className="space-y-2 border-t border-amber-100 bg-amber-50/40 px-4 py-3">
          <p className="text-xs font-medium text-amber-800">원장 정합 확인 {registryItems.length}대 — [확정]하면 기기현황을 이 병원 배치로 갱신합니다 (신규 등록 · 재등록 · 타병원 이관)</p>
          {registryItems.map((item) => {
            const t = item.registryTag!
            const f = regOf(item)
            const actionLabel = t.tag === 'OTHER_HOSPITAL' ? `${t.detail ?? '타병원'}에서 회수(이관) 후 이 병원 배치` : t.tag === 'UNREGISTERED' ? '원장 신규 등록 후 이 병원 배치' : '이 병원에 재등록'
            return (
              <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border border-amber-100 bg-white px-3 py-2 text-xs">
                <span className="font-mono text-sm text-gray-900">{item.serialNo}</span>
                {deviceBadge(item, asCode, hospitalCode)}
                <span className="text-gray-400">→ {actionLabel}</span>
                {t.tag === 'UNREGISTERED' && (
                  <select value={f.modelInput} onChange={(e) => setRegForm((p) => ({ ...p, [item.id]: { ...f, modelInput: e.target.value } }))} className="rounded-md border border-gray-300 px-2 py-1 text-xs" title="모델 (시리얼 접두로 추정, 확인 후 확정)">
                    <option value="">모델 선택</option>
                    {['심전계', '산소포화도', '게이트웨이'].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
                <input type="text" value={f.wardName} onChange={(e) => setRegForm((p) => ({ ...p, [item.id]: { ...f, wardName: e.target.value } }))} placeholder="병동" className="w-24 rounded-md border border-gray-300 px-2 py-1 text-xs" />
                <select value={f.productType} onChange={(e) => setRegForm((p) => ({ ...p, [item.id]: { ...f, productType: e.target.value } }))} className="rounded-md border border-gray-300 px-2 py-1 text-xs" title="상품유형 — 병원 딜이 일반·라이트 혼합이면 필수">
                  <option value="">상품유형 (자동)</option>
                  {PRODUCT_TYPES.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
                </select>
                <button
                  type="button"
                  disabled={busy || (t.tag === 'UNREGISTERED' && !f.modelInput)}
                  onClick={() => { if (confirm(`${item.serialNo}: ${actionLabel}\n기기현황에 즉시 기록됩니다. 계속할까요?`)) void onRegistryConfirm({ itemId: item.id, modelInput: f.modelInput || null, productType: f.productType || null, wardName: f.wardName || null }) }}
                  className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
                >
                  확정
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 입고 대조 — 접수자 확인 (미입고·미식별입고 라인) */}
      {canEdit && issueItems.length > 0 && (
        <div className="space-y-2 border-t border-red-100 bg-red-50/40 px-4 py-3">
          <p className="text-xs font-medium text-red-700">입고 대조 — 미입고·미식별입고 {issueItems.length}대, 접수자 확인 후 처리 가능</p>
          {issueItems.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border border-red-100 bg-white px-3 py-2 text-xs">
              <span className="font-mono text-sm text-gray-900">{item.serialNo}</span>
              {intakeBadge(item)}
              {item.intakeState === 'MISMATCH' ? (
                <>
                  <span className="text-gray-400">접수 시리얼이 입고로 식별되지 않음 →</span>
                  {extras.length > 0 && (
                    <>
                      <select value={remapPick[item.id] ?? ''} onChange={(e) => setRemapPick((p) => ({ ...p, [item.id]: e.target.value }))} className="rounded-md border border-gray-300 px-2 py-1 text-xs">
                        <option value="">치환할 미식별입고 시리얼</option>
                        {extras.map((x) => <option key={x.id} value={x.id}>{x.serialNo}</option>)}
                      </select>
                      <button type="button" disabled={busy || !remapPick[item.id]} onClick={() => { if (confirm(`${item.serialNo} → ${extras.find((x) => String(x.id) === remapPick[item.id])?.serialNo} 로 치환합니다 (접수 시리얼은 보존).`)) void onConfirm({ type: 'REMAP', itemId: item.id, extraItemId: Number(remapPick[item.id]) }) }} className="rounded-md bg-gray-800 px-2.5 py-1 text-xs text-white disabled:opacity-40">치환</button>
                    </>
                  )}
                  <button type="button" disabled={busy} onClick={() => { if (confirm(`${item.serialNo} 을(를) 정상입고로 확정합니다.`)) void onConfirm({ type: 'MARK_RECEIVED', itemId: item.id }) }} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40">정상입고 확정</button>
                  <input type="text" value={nrComment[item.id] ?? ''} onChange={(e) => setNrComment((p) => ({ ...p, [item.id]: e.target.value }))} placeholder="미회수 코멘트 (필수)" className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs" />
                  <button type="button" disabled={busy || !(nrComment[item.id] ?? '').trim()} onClick={() => { if (confirm(`${item.serialNo} 을(를) 미회수로 종결합니다 (수리 진행 없음).`)) void onConfirm({ type: 'NOT_RECEIVED', itemId: item.id, comment: nrComment[item.id] }) }} className="rounded-md border border-amber-300 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40">미회수</button>
                </>
              ) : (
                <>
                  <span className="text-gray-400">입고 시리얼이 접수 내역에 없음 →</span>
                  {!item.deviceId && (
                    <select value={remapPick[item.id] ?? ''} onChange={(e) => setRemapPick((p) => ({ ...p, [item.id]: e.target.value }))} className="rounded-md border border-gray-300 px-2 py-1 text-xs" title="미등록 시리얼 — 기기종류">
                      <option value="">기기종류</option>
                      {AS_DEVICE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  )}
                  <button type="button" disabled={busy} onClick={() => { if (confirm(`${item.serialNo} 을(를) 이 접수의 신규 라인으로 편입합니다.`)) void onConfirm({ type: 'ACCEPT_EXTRA', itemId: item.id, deviceKind: remapPick[item.id] || null }) }} className="rounded-md bg-gray-800 px-2.5 py-1 text-xs text-white disabled:opacity-40">신규 라인 편입</button>
                  <button type="button" disabled={busy} onClick={() => { if (confirm(`${item.serialNo} 미식별입고 라인을 삭제합니다 (입고 입력 오타).`)) void onConfirm({ type: 'DISCARD_EXTRA', itemId: item.id }) }} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40">삭제</button>
                  <span className="text-gray-400">(미입고 라인의 [치환] 대상으로도 선택 가능)</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 기기군 공통 발송정보 + 라인 처리 */}
      {(canResolve && openItems.length > 0) || (canEdit && shippedItems.length > 0) ? (
        <div className="space-y-2.5 border-t border-gray-200 bg-gray-50 px-4 py-3">
          {(canResolve && openItems.length > 0 && isShipOutcome) || (canEdit && shippedItems.length > 0) ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500">발송정보 (기기군 공통)</span>
              <select value={shipMethod} onChange={(e) => setShipMethod(e.target.value)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
                <option value="">발송방법</option>
                {AS_METHODS.map((m) => <option key={m} value={m}>{AS_SHIP_METHOD_LABELS[m]}</option>)}
              </select>
              <input type="text" value={shipTrackingNo} onChange={(e) => setShipTrackingNo(e.target.value)} placeholder="발송 송장" className="w-44 rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              <input type="date" value={shippedAt} onChange={(e) => setShippedAt(e.target.value)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" title="발송일" />
              {canEdit && shippedItems.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { if (confirm(`[${group}] 발송 라인 ${shippedItems.length}대에 이 발송정보를 적용합니다.`)) void onApplyShipInfo(shippedItems.map((i) => i.id), shipMethod, shipTrackingNo, shippedAt) }}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                  title="이미 발송 처리된 라인의 발송방법·송장·발송일을 기기군 단위로 갱신"
                >
                  발송 라인 {shippedItems.length}대에 적용
                </button>
              )}
            </div>
          ) : null}
          {canResolve && openItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-700">{selected.size > 0 ? `선택 ${selected.size}개 라인` : '라인 선택 후 처리'}</span>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value as AsOutcome)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
                {AS_RESOLVE_OUTCOMES.map((o) => <option key={o} value={o}>{AS_OUTCOME_LABELS[o]}</option>)}
              </select>
              {!isShipOutcome && (
                <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" title="처리일" />
              )}
              {isShipOutcome && <span className="text-xs text-gray-400">발송일·방법·송장은 위 발송정보 사용{!shippedAt && ' (발송일 미입력 시 오늘)'}</span>}
              <button type="button" onClick={run} disabled={busy || selected.size === 0} className="ml-auto rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? '처리 중...' : '처리 실행'}
              </button>
            </div>
          )}
          {canResolve && outcome === 'REPLACE' && selected.size > 0 && (
            <div className="space-y-1.5 rounded-md border border-gray-200 bg-white px-3 py-2">
              <p className="text-xs font-medium text-gray-500">교체 발송기기 시리얼 (라인별)</p>
              {Array.from(selected).map((itemId) => {
                const item = items.find((i) => i.id === itemId)
                if (!item) return null
                return (
                  <div key={itemId} className="flex items-center gap-2">
                    <span className="w-28 font-mono text-xs text-gray-600">{item.serialNo}</span>
                    <span className="text-gray-300">→</span>
                    <input type="text" value={newSerials[itemId] ?? ''} onChange={(e) => setNewSerials((p) => ({ ...p, [itemId]: e.target.value }))} placeholder="교체기 시리얼" className="w-40 rounded-md border border-gray-300 px-2 py-1 font-mono text-xs" />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default function AsReceiptDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [req, setReq] = useState<AsDetail | null>(null)
  const [statuses, setStatuses] = useState<CodeRef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [me, setMe] = useState<{ id: string; role: string; permissions?: string[] } | null>(null)

  // 2. 접수정보 (접수자 입력 — 시트 A~M·S·T)
  const [intake, setIntake] = useState({ pickupMethod: '', pickupTrackingNo: '', pickedUpAt: '', destType: '', destInfo: '', pickupDestDiffers: false, pickupDestInfo: '' })
  // 3. AS상세내역 헤더 (AS담당자 입력 — 시트 N·U)
  const [asHead, setAsHead] = useState({ expectedShipDate: '' })
  // 3. 입고처리 (2026-09-11) — 실물 시리얼 대조
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [intakeText, setIntakeText] = useState('')
  const [intakeDates, setIntakeDates] = useState({ receivedAt: todayKst(), checkedAt: todayKst() })
  // 4. 비고
  const [note, setNote] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setMe({ id: d.id ?? d.userId ?? '', role: d.role, permissions: d.permissions }))
    fetch('/api/settings/as-status').then((r) => (r.ok ? r.json() : null)).then((d) => setStatuses(d?.statusCodes ?? []))
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/as-receipts/${id}`)
    if (!res.ok) { setError('AS접수를 찾을 수 없습니다.'); setLoading(false); return }
    const d = await res.json()
    const r: AsDetail = d.asReceipt
    setReq(r)
    setIntake({
      pickupMethod: r.pickupMethod ?? '',
      pickupTrackingNo: r.pickupTrackingNo ?? '',
      pickedUpAt: r.pickedUpAt?.slice(0, 10) ?? '',
      destType: r.destType ?? '',
      destInfo: r.destInfo ?? '',
      pickupDestDiffers: r.pickupDestDiffers,
      pickupDestInfo: r.pickupDestInfo ?? '',
    })
    setAsHead({ expectedShipDate: r.expectedShipDate?.slice(0, 10) ?? '' })
    setIntakeDates({ receivedAt: r.receivedAt?.slice(0, 10) ?? todayKst(), checkedAt: todayKst() })
    setNote(r.note ?? '')
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  function flash(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 6000)
  }

  const isAdmin = !!me && (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN')
  const isTerminal = req?.status?.ticketStatus === 'RESOLVED' || req?.status?.ticketStatus === 'CLOSED'
  // ADMIN 이상 또는 (USER 이상 + as_receipt.admin 권한) — RBAC v1.5 가산, VIEWER 제외
  const adminPerm = !!me && me.role !== 'VIEWER' && (me.permissions ?? []).includes('as_receipt.admin')
  // 서버 canEditAsReceipt와 동일 판정 (2026-09-07 개정 CX #4 — 종결 전 USER 전원)
  const canEdit = !!me && !!req && (isAdmin || adminPerm || (me.role !== 'VIEWER' && !isTerminal))
  // 삭제는 구 규칙 유지 — ADMIN 항상 / USER 본인 등록 + 종결 전
  const canDelete = !!me && !!req && (isAdmin || adminPerm || (me.role !== 'VIEWER' && req.createdBy?.id === me.id && !isTerminal))
  // 라인 처리 — USER 이상 전원 (별도 처리 풀 없음, 설계 §7)
  const canResolve = !!me && me.role !== 'VIEWER' && !isTerminal
  const openItems = req?.items.filter((i) => !i.outcome) ?? []

  async function putReceipt(body: Record<string, unknown>, failMsg: string) {
    if (!req) return false
    setBusy(true)
    const res = await fetch(`/api/as-receipts/${req.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? failMsg); return false }
    if (d.warnings?.length) setWarnings(d.warnings)
    router.refresh()
    await load()
    return true
  }

  /** 라인별 처리내용 저장 — PUT items(전 라인 시리얼 + 해당 라인 processNote만) */
  async function saveProcessNote(item: ItemRow, noteText: string) {
    if (!req) return false
    return putReceipt({ items: req.items.map((i) => (i.id === item.id ? { serial: i.serialNo, processNote: noteText } : { serial: i.serialNo })) }, '처리내용 저장에 실패했습니다.')
  }

  async function resolveLines(lines: { itemId: number; outcome: AsOutcome; newSerial?: string; processNote?: string }[], effectiveDate: string, shipMethod: string, shipTrackingNo: string) {
    if (!req) return false
    setBusy(true)
    const res = await fetch(`/api/as-receipts/${req.id}/resolve-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, effectiveDate, shipMethod: shipMethod || null, shipTrackingNo: shipTrackingNo || null }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '라인 처리에 실패했습니다.'); return false }
    setWarnings(d.warnings ?? [])
    router.refresh()
    await load()
    return true
  }

  async function runIntake() {
    if (!req) return
    const serials = intakeText.split(/[\r\n,]+/).map((v) => v.trim()).filter(Boolean)
    if (!serials.length) { flash('입고 시리얼을 입력하세요.'); return }
    if (!confirm(`입고 시리얼 ${serials.length}개를 접수 라인과 대조합니다.\n일치 → 정상입고, 접수됐으나 없음 → 미입고, 접수에 없음 → 미식별입고`)) return
    setBusy(true)
    const res = await fetch(`/api/as-receipts/${req.id}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serials, receivedAt: intakeDates.receivedAt || null, checkedAt: intakeDates.checkedAt || null }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '입고처리에 실패했습니다.'); return }
    const summary = [`정상입고 ${d.received?.length ?? 0}`, `미입고 ${d.mismatch?.length ?? 0}`, `미식별입고 ${d.extra?.length ?? 0}`].join(' · ')
    setWarnings([`입고처리 결과 — ${summary}${d.statusChanged ? ' (상태 → 입고)' : ''}`, ...(d.warnings ?? [])])
    setIntakeText('')
    setIntakeOpen(false)
    router.refresh()
    await load()
  }

  async function confirmIntake(body: Record<string, unknown>) {
    if (!req) return false
    setBusy(true)
    const res = await fetch(`/api/as-receipts/${req.id}/intake-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '입고 확인에 실패했습니다.'); return false }
    if (d.warnings?.length) setWarnings(d.warnings)
    router.refresh()
    await load()
    return true
  }

  async function registryConfirm(body: Record<string, unknown>) {
    if (!req) return false
    setBusy(true)
    const res = await fetch(`/api/as-receipts/${req.id}/registry-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? d.message ?? '원장 확정에 실패했습니다.'); return false }
    if (d.warnings?.length) setWarnings(d.warnings)
    router.refresh()
    await load()
    return true
  }

  async function applyShipInfo(itemIds: number[], shipMethod: string, shipTrackingNo: string, shippedAt: string) {
    if (!req) return false
    setBusy(true)
    const res = await fetch(`/api/as-receipts/${req.id}/ship-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds, shipMethod: shipMethod || null, shipTrackingNo, shippedAt: shippedAt || null }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '발송정보 갱신에 실패했습니다.'); return false }
    router.refresh()
    await load()
    return true
  }

  async function reopen() {
    if (!req) return
    const reason = prompt(`${req.asCode}를 리오픈합니다. 사유를 입력하세요 (비고에 기록):`)
    if (reason == null) return
    if (!reason.trim()) { flash('리오픈 사유를 입력하세요.'); return }
    setBusy(true)
    const res = await fetch(`/api/as-receipts/${req.id}/reopen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '리오픈에 실패했습니다.'); return }
    setWarnings([`리오픈 — 상태 '${d.statusName}' (라인 결과·기기현황 기록은 그대로입니다)`])
    router.refresh()
    await load()
  }

  async function remove() {
    if (!req) return
    if (!confirm(`${req.asCode}를 삭제하시겠습니까? 연결된 티켓도 함께 삭제됩니다.\n(이 접수가 켠 AS 표시는 해제되고, 기록된 기기현황 이벤트는 보존됩니다)`)) return
    setBusy(true)
    const res = await fetch(`/api/as-receipts/${req.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '삭제에 실패했습니다.'); return }
    router.refresh()
    router.push('/as-receipts')
  }

  if (loading) return <div className="py-20 text-center text-sm text-gray-400">불러오는 중...</div>
  if (!req) return <div className="py-20 text-center text-sm text-gray-400">{error ?? 'AS접수를 찾을 수 없습니다.'}</div>

  const catLabel = AS_CATEGORY_LABELS[req.category as AsCategory] ?? req.category
  // 기기군별 분리 — 심전계 / 산소포화도 / 기타(해당 라인 있을 때만)
  const groups = AS_DEVICE_GROUPS
    .map((g) => ({ group: g, items: req.items.filter((i) => asDeviceGroupOf(i.device?.deviceInfo.deviceName, i.deviceKind, i.serialNo) === g) }))
    .filter((g) => g.items.length > 0)
  const saveIntake = () => putReceipt({
    pickupMethod: intake.pickupMethod || null,
    pickupTrackingNo: intake.pickupTrackingNo || null,
    pickedUpAt: intake.pickedUpAt || null,
    destType: intake.destType || null,
    destInfo: intake.destInfo || null,
    pickupDestDiffers: intake.pickupDestDiffers,
    pickupDestInfo: (intake.pickupDestDiffers ? intake.pickupDestInfo : intake.destInfo) || null,
  }, '접수정보 저장에 실패했습니다.')

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {warnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <div className="flex items-center justify-between">
            <p className="font-medium">경고 {warnings.length}건</p>
            <button type="button" className="text-xs text-amber-600 hover:underline" onClick={() => setWarnings([])}>닫기</button>
          </div>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* 헤더 */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/as-receipts" className="text-sm text-gray-400 hover:text-gray-600">AS업무</Link>
            <span className="text-gray-300">/</span>
            <span className="font-mono text-sm text-gray-500">{req.asCode}</span>
            {codeBadge(req.status)}
            {req.preReplace
              ? <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600">선교체</span>
              : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">일반 (선교체 아님)</span>}
          </div>
          <h1 className="mt-1 text-xl font-bold text-gray-900">
            {req.hospital?.hospitalName ?? '-'} <span className="font-normal text-gray-400">· {catLabel} · 기기 {req.items.length}대</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <select
              value={req.status?.id ?? ''}
              onChange={(e) => e.target.value && putReceipt({ statusId: Number(e.target.value) }, '상태 변경에 실패했습니다.')}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
            >
              <option value="" disabled>상태 변경</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {canEdit && (
            <button type="button" onClick={() => setEditOpen(true)} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" title="접수 기본값·기기 시리얼 수정">수정</button>
          )}
          {isTerminal && !!me && me.role !== 'VIEWER' && (
            <button type="button" onClick={reopen} disabled={busy} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50" title="완료·취소 접수를 다시 진행 상태로 (사유 기록)">리오픈</button>
          )}
          {canDelete && (
            <button type="button" onClick={remove} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50">삭제</button>
          )}
        </div>
      </div>

      {/* 1. 공통정보 */}
      <Card title="1. 공통정보">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4 sm:px-6 md:grid-cols-4">
          <div>
            <p className={label}>병원</p>
            <p className="mt-1 text-sm text-gray-900">
              {req.hospital ? <Link href={`/hospitals/${req.hospital.hospitalCode}`} className="text-blue-600 hover:underline">{req.hospital.hospitalName}</Link> : '-'}
            </p>
          </div>
          <div>
            <p className={label}>구분</p>
            <p className="mt-1 text-sm text-gray-900">{catLabel}{req.preReplace && <span className="ml-1.5 text-xs text-orange-600">선교체</span>}</p>
          </div>
          <div>
            <p className={label}>상태</p>
            <p className="mt-1">{codeBadge(req.status)}</p>
          </div>
          <div>
            <p className={label}>담당 (티켓)</p>
            <p className="mt-1 text-sm text-gray-900">
              {req.ticket?.owner?.name ?? '미배정'}
              {req.ticket && (
                <>
                  <span className="mx-1.5 text-gray-300">·</span>
                  <Link href={`/tickets/${req.ticket.ticketCode}`} className="font-mono text-xs text-blue-600 hover:underline">{req.ticket.ticketCode}</Link>
                  <span className="ml-1.5 align-middle"><TicketStatusBadge status={req.ticket.status} /></span>
                </>
              )}
            </p>
          </div>
          <div>
            <p className={label}>등록자</p>
            <p className="mt-1 text-sm text-gray-900">{req.createdBy?.name ?? '-'}</p>
          </div>
          <div>
            <p className={label}>등록 일시</p>
            <p className="mt-1 text-sm text-gray-900">{fmtDt(req.createdAt)}</p>
          </div>
          <div>
            <p className={label}>완료일</p>
            <p className="mt-1 text-sm text-gray-900">{d10(req.resolvedAt)}</p>
          </div>
          <div>
            <p className={label}>기기</p>
            <p className="mt-1 text-sm text-gray-900">{req.items.length}대 <span className="text-xs text-gray-400">· 종결 {req.items.length - openItems.length}대</span></p>
          </div>
        </div>
      </Card>

      {/* 2. 접수정보 (접수자 입력 — 시트 A~M · S·T) */}
      <Card
        title="2. 접수정보"
        sub="접수자 입력"
        right={canEdit && (
          <button type="button" disabled={busy} onClick={saveIntake} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">접수정보 저장</button>
        )}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 sm:px-6 md:grid-cols-4">
          <div>
            <p className={label}>접수일</p>
            <p className="mt-1 text-sm text-gray-900">{d10(req.receiptDate)}</p>
          </div>
          <div>
            <p className={label}>고객명 (카카오채널명)</p>
            <p className="mt-1 truncate text-sm text-gray-900" title={req.reporterName ?? undefined}>{req.reporterName ?? '-'}</p>
          </div>
          <div>
            <p className={label}>수거방법</p>
            {canEdit ? (
              <select value={intake.pickupMethod} onChange={(e) => setIntake((p) => ({ ...p, pickupMethod: e.target.value }))} className={inputCls}>
                <option value="">선택</option>
                {AS_METHODS.map((m) => <option key={m} value={m}>{AS_PICKUP_METHOD_LABELS[m]}</option>)}
              </select>
            ) : <p className="mt-1 text-sm text-gray-900">{req.pickupMethod ? AS_PICKUP_METHOD_LABELS[req.pickupMethod as AsMethod] : '-'}</p>}
          </div>
          <div>
            <p className={label}>수거 송장번호</p>
            {canEdit ? (
              <input type="text" value={intake.pickupTrackingNo} onChange={(e) => setIntake((p) => ({ ...p, pickupTrackingNo: e.target.value }))} placeholder="고장품 택배 송장" className={`${inputCls} font-mono`} />
            ) : <p className="mt-1 font-mono text-sm text-gray-900">{req.pickupTrackingNo ?? '-'}</p>}
          </div>
          <div>
            <p className={label}>수거일</p>
            {canEdit ? (
              <input type="date" value={intake.pickedUpAt} onChange={(e) => setIntake((p) => ({ ...p, pickedUpAt: e.target.value }))} className={inputCls} />
            ) : <p className="mt-1 text-sm text-gray-900">{d10(req.pickedUpAt)}</p>}
          </div>
          <div>
            <p className={label}>발송지 구분</p>
            {canEdit ? (
              <select value={intake.destType} onChange={(e) => setIntake((p) => ({ ...p, destType: e.target.value }))} className={inputCls}>
                <option value="">선택</option>
                {AS_DEST_TYPES.map((t) => <option key={t} value={t}>{AS_DEST_TYPE_LABELS[t]}</option>)}
              </select>
            ) : <p className="mt-1 text-sm text-gray-900">{req.destType ? AS_DEST_TYPE_LABELS[req.destType as AsDestType] : '-'}</p>}
          </div>
          <div className="col-span-2">
            <p className={label}>발송지 정보</p>
            {canEdit ? (
              <input type="text" value={intake.destInfo} onChange={(e) => setIntake((p) => ({ ...p, destInfo: e.target.value }))} placeholder="주소 / 수령인" className={inputCls} />
            ) : <p className="mt-1 truncate text-sm text-gray-900">{req.destInfo ?? '-'}</p>}
          </div>
        </div>
        {/* 회수지 (CX #13) */}
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3 sm:px-6">
          <p className={label}>고장품 회수지</p>
          <label className={`flex items-center gap-1.5 text-sm ${canEdit ? 'cursor-pointer text-gray-600' : 'text-gray-400'}`}>
            <input
              type="checkbox"
              checked={intake.pickupDestDiffers}
              disabled={!canEdit}
              onChange={(e) => setIntake((p) => ({ ...p, pickupDestDiffers: e.target.checked, pickupDestInfo: e.target.checked ? p.pickupDestInfo : p.destInfo }))}
              className="rounded border-gray-300"
            />
            회수지 상이
          </label>
          {intake.pickupDestDiffers ? (
            canEdit ? (
              <input type="text" value={intake.pickupDestInfo} onChange={(e) => setIntake((p) => ({ ...p, pickupDestInfo: e.target.value }))} placeholder="회수지 주소 / 회수자 / 연락처" className="min-w-[16rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
            ) : <p className="flex-1 truncate text-sm text-gray-900">{req.pickupDestInfo ?? '-'}</p>
          ) : (
            <p className="flex-1 truncate text-sm text-gray-500">발송지와 동일{(intake.destInfo || req.destInfo) ? ` — ${intake.destInfo || req.destInfo}` : ''}</p>
          )}
        </div>
      </Card>

      {/* 3. AS상세내역 (AS담당자 입력 — 시트 N~X) */}
      <Card
        title="3. AS상세내역"
        sub="AS담당자 입력"
        right={canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => putReceipt({ expectedShipDate: asHead.expectedShipDate || null }, 'AS상세 저장에 실패했습니다.')}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            예상 출하일 저장
          </button>
        )}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:px-6 md:grid-cols-4">
          <div>
            <p className={label}>입고일 <span className="normal-case tracking-normal text-gray-300">(입고처리 시 기록)</span></p>
            <p className="mt-1 text-sm text-gray-900">{d10(req.receivedAt)}</p>
          </div>
          <div>
            <p className={label}>확인일 <span className="normal-case tracking-normal text-gray-300">(입고 대조)</span></p>
            <p className="mt-1 text-sm text-gray-900">{d10(req.checkedAt)}</p>
          </div>
          <div>
            <p className={label}>예상 출하일</p>
            {canEdit ? (
              <input type="date" value={asHead.expectedShipDate} onChange={(e) => setAsHead((p) => ({ ...p, expectedShipDate: e.target.value }))} className={inputCls} />
            ) : <p className="mt-1 text-sm text-gray-900">{d10(req.expectedShipDate)}</p>}
          </div>
          <div className="flex items-end">
            {canResolve && (
              <button type="button" disabled={busy} onClick={() => setIntakeOpen((v) => !v)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${intakeOpen ? 'border border-gray-300 bg-white text-gray-600' : 'bg-gray-800 text-white hover:bg-gray-700'} disabled:opacity-50`}>
                {intakeOpen ? '입고처리 닫기' : '입고처리'}
              </button>
            )}
          </div>
        </div>
        {intakeOpen && canResolve && (
          <div className="mx-4 mb-4 rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-3 sm:mx-6">
            <p className="text-xs font-medium text-blue-800">입고처리 — 실제 수거된 기기의 시리얼을 입력하면 접수 라인과 대조합니다 (여러 번 누적 실행 가능)</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <textarea value={intakeText} onChange={(e) => setIntakeText(e.target.value)} rows={4} placeholder={'입고 시리얼 (줄당 1개)\nP013798\nP015127'} className="min-w-[16rem] flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm" />
              <div className="space-y-2">
                <div>
                  <p className={label}>입고일 (N)</p>
                  <input type="date" value={intakeDates.receivedAt} onChange={(e) => setIntakeDates((p) => ({ ...p, receivedAt: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <p className={label}>확인일 (O)</p>
                  <input type="date" value={intakeDates.checkedAt} onChange={(e) => setIntakeDates((p) => ({ ...p, checkedAt: e.target.value }))} className={inputCls} />
                </div>
                <button type="button" disabled={busy || !intakeText.trim()} onClick={runIntake} className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {busy ? '처리 중...' : '대조 실행'}
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">접수 시리얼이 입고로 식별되면 정상입고 · 식별되지 않으면 미입고 · 입고 시리얼이 접수 내역에 없으면 미식별입고. 미입고·미식별입고 라인은 접수자 확인(치환·정상입고 확정·미회수·편입) 후 처리할 수 있습니다. 원장 정합 태그(타병원·회수 등)와는 별개 축입니다.</p>
          </div>
        )}
        <div className="px-4 pb-4 sm:px-6">
          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">기기 라인이 없습니다.</p>
          ) : groups.map((g, gi) => (
            <GroupCard
              key={g.group}
              index={`3-${gi + 1}`}
              group={g.group}
              items={g.items}
              asCode={req.asCode}
              hospitalCode={req.hospital?.hospitalCode ?? null}
              canResolve={canResolve}
              canEdit={canEdit}
              busy={busy}
              onResolve={resolveLines}
              onSaveProcessNote={saveProcessNote}
              onApplyShipInfo={applyShipInfo}
              onConfirm={confirmIntake}
              extras={req.items.filter((i) => !i.outcome && i.intakeState === 'EXTRA')}
              onRegistryConfirm={registryConfirm}
            />
          ))}
          {canResolve && openItems.length > 0 && (
            <p className="text-xs text-gray-400">결과 확정 시 기기현황(AS 해제·교체·회수)에 즉시 기록됩니다. 전 라인 종결 시 접수가 자동 완료됩니다.</p>
          )}
        </div>
      </Card>

      {/* 4. 비고 */}
      <Card
        title="4. 비고"
        sub="이 접수건의 특이사항"
        right={canEdit && (
          <button type="button" disabled={busy || note === (req.note ?? '')} onClick={() => putReceipt({ note: note || null }, '비고 저장에 실패했습니다.')} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">비고 저장</button>
        )}
      >
        <div className="px-4 py-3 sm:px-6">
          {canEdit ? (
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="후속 조치·특이사항 등" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
          ) : <p className="whitespace-pre-wrap text-sm text-gray-800">{req.note || <span className="text-gray-400">-</span>}</p>}
        </div>
      </Card>

      {/* 수정 모달 */}
      {req.hospital && (
        <AsReceiptFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={(w) => { setWarnings(w); router.refresh(); void load() }}
          editTarget={{
            id: req.id,
            asCode: req.asCode,
            hospitalCode: req.hospital.hospitalCode,
            hospitalName: req.hospital.hospitalName,
            category: req.category,
            receiptDate: req.receiptDate.slice(0, 10),
            reporterName: req.reporterName,
            pickupMethod: req.pickupMethod,
            pickupTrackingNo: req.pickupTrackingNo,
            preReplace: req.preReplace,
            note: req.note,
            items: req.items.map((i) => ({
              serialNo: i.serialNo,
              wardName: i.wardName,
              deviceKind: i.deviceKind,
              symptom: i.symptom,
              outcome: i.outcome,
              deviceId: i.deviceId,
              modelName: i.device?.deviceInfo.deviceName ?? null,
            })),
          } satisfies AsEditTarget}
        />
      )}
    </div>
  )
}
