'use client'

/**
 * AS접수 상세 (as_work_design.md §8)
 * 기본 정보 → 진행 기록(물류 날짜·발송지) → 기기 라인 표 + 라인 처리(부분 발송 — 결정 6).
 * 상태 변경(도메인→티켓 동기화)·수정 모달·삭제(티켓 동반) — 권한 §13-1.
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import TicketStatusBadge from '@/app/tickets/components/TicketStatusBadge'
import AsReceiptFormModal, { type AsEditTarget } from '../_components/AsReceiptFormModal'
import {
  AS_CATEGORY_LABELS, AS_PICKUP_METHOD_LABELS, AS_SHIP_METHOD_LABELS, AS_DEST_TYPES,
  AS_DEST_TYPE_LABELS, AS_OUTCOMES, AS_OUTCOME_LABELS,
  type AsCategory, type AsMethod, type AsDestType, type AsOutcome,
} from '@/lib/asReceiptShared'
import type { TicketStatus } from '@prisma/client'

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
  preReplace: boolean
  destType: string | null
  destInfo: string | null
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
function deviceBadge(item: ItemRow, asCode: string, hospitalCode: string | null) {
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
  const [me, setMe] = useState<{ id: string; role: string } | null>(null)

  // 진행 기록 (물류)
  const [logistics, setLogistics] = useState({ pickedUpAt: '', receivedAt: '', expectedShipDate: '', destType: '', destInfo: '' })

  // 라인 처리 패널
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [outcome, setOutcome] = useState<AsOutcome>('REPAIR_RETURN')
  const [newSerials, setNewSerials] = useState<Record<number, string>>({})
  const [effectiveDate, setEffectiveDate] = useState(todayKst())
  const [shipMethod, setShipMethod] = useState('')
  const [shipTrackingNo, setShipTrackingNo] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setMe({ id: d.id ?? d.userId ?? '', role: d.role }))
    fetch('/api/settings/as-status').then((r) => (r.ok ? r.json() : null)).then((d) => setStatuses(d?.statusCodes ?? []))
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/as-receipts/${id}`)
    if (!res.ok) { setError('AS접수를 찾을 수 없습니다.'); setLoading(false); return }
    const d = await res.json()
    const r: AsDetail = d.asReceipt
    setReq(r)
    setLogistics({
      pickedUpAt: r.pickedUpAt?.slice(0, 10) ?? '',
      receivedAt: r.receivedAt?.slice(0, 10) ?? '',
      expectedShipDate: r.expectedShipDate?.slice(0, 10) ?? '',
      destType: r.destType ?? '',
      destInfo: r.destInfo ?? '',
    })
    setSelected(new Set())
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  function flash(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 6000)
  }

  const isAdmin = !!me && (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN')
  const isTerminal = req?.status?.ticketStatus === 'RESOLVED' || req?.status?.ticketStatus === 'CLOSED'
  // 서버 canEditAsReceipt와 동일 판정 (§13-1)
  const canEdit = !!me && !!req && (isAdmin || (me.role !== 'VIEWER' && req.createdBy?.id === me.id && !isTerminal))
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

  async function runResolve() {
    if (!req || selected.size === 0) return
    const lines = Array.from(selected).map((itemId) => ({
      itemId,
      outcome,
      newSerial: outcome === 'REPLACE' ? newSerials[itemId] ?? '' : undefined,
    }))
    if (outcome === 'REPLACE' && lines.some((l) => !l.newSerial?.trim())) {
      flash('교체 처리는 선택한 모든 라인에 발송기기 시리얼이 필요합니다.')
      return
    }
    const label = AS_OUTCOME_LABELS[outcome]
    if (!confirm(`선택한 ${lines.length}개 라인을 [${label}] 처리합니다.\n기기현황에 즉시 기록됩니다. 계속할까요?`)) return
    setBusy(true)
    const res = await fetch(`/api/as-receipts/${req.id}/resolve-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, effectiveDate, shipMethod: shipMethod || null, shipTrackingNo: shipTrackingNo || null }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '라인 처리에 실패했습니다.'); return }
    setWarnings(d.warnings ?? [])
    setNewSerials({})
    setShipTrackingNo('')
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

  const label = 'text-xs font-medium uppercase tracking-wider text-gray-400'
  const catLabel = AS_CATEGORY_LABELS[req.category as AsCategory] ?? req.category

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
            {req.preReplace && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600">선교체</span>}
          </div>
          <h1 className="mt-1 text-xl font-bold text-gray-900">
            {req.hospital?.hospitalName ?? '-'} <span className="font-normal text-gray-400">· {catLabel} · 기기 {req.items.length}대</span>
          </h1>
          {req.ticket && (
            <p className="mt-1 text-sm text-gray-500">
              연결 티켓{' '}
              <Link href={`/tickets/${req.ticket.ticketCode}`} className="font-mono text-blue-600 hover:underline">{req.ticket.ticketCode}</Link>
              <span className="ml-1.5 align-middle"><TicketStatusBadge status={req.ticket.status} /></span>
            </p>
          )}
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
            <button type="button" onClick={() => setEditOpen(true)} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">수정</button>
          )}
          {canEdit && (
            <button type="button" onClick={remove} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50">삭제</button>
          )}
        </div>
      </div>

      {/* 기본 정보 */}
      <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4 sm:px-6 sm:py-5 md:grid-cols-4">
          <div>
            <p className={label}>병원</p>
            <p className="mt-1 text-sm text-gray-900">
              {req.hospital ? (
                <Link href={`/hospitals/${req.hospital.hospitalCode}`} className="text-blue-600 hover:underline">{req.hospital.hospitalName}</Link>
              ) : '-'}
            </p>
          </div>
          <div>
            <p className={label}>접수일</p>
            <p className="mt-1 text-sm text-gray-900">{d10(req.receiptDate)}</p>
          </div>
          <div>
            <p className={label}>고객명</p>
            <p className="mt-1 text-sm text-gray-900">{req.reporterName ?? '-'}</p>
          </div>
          <div>
            <p className={label}>수거</p>
            <p className="mt-1 text-sm text-gray-900">
              {req.pickupMethod ? AS_PICKUP_METHOD_LABELS[req.pickupMethod as AsMethod] : '-'}
              {req.pickupTrackingNo && <span className="ml-1 font-mono text-xs text-gray-400">{req.pickupTrackingNo}</span>}
            </p>
          </div>
          <div>
            <p className={label}>담당 (티켓)</p>
            <p className="mt-1 text-sm text-gray-900">{req.ticket?.owner?.name ?? '미배정'}</p>
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
        </div>
        {req.note && (
          <div className="border-t border-gray-100 px-4 py-4 sm:px-6">
            <p className={label}>비고</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{req.note}</p>
          </div>
        )}
      </div>

      {/* 진행 기록 (물류) — 파이프라인 날짜·발송지 */}
      <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 className="text-sm font-semibold text-gray-700">진행 기록</h2>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 sm:px-6 md:grid-cols-5">
          <div>
            <p className={label}>수거일</p>
            {canEdit ? (
              <input type="date" value={logistics.pickedUpAt} onChange={(e) => setLogistics((p) => ({ ...p, pickedUpAt: e.target.value }))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
            ) : <p className="mt-1 text-sm text-gray-900">{d10(req.pickedUpAt)}</p>}
          </div>
          <div>
            <p className={label}>입고일</p>
            {canEdit ? (
              <input type="date" value={logistics.receivedAt} onChange={(e) => setLogistics((p) => ({ ...p, receivedAt: e.target.value }))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
            ) : <p className="mt-1 text-sm text-gray-900">{d10(req.receivedAt)}</p>}
          </div>
          <div>
            <p className={label}>예상 출하일</p>
            {canEdit ? (
              <input type="date" value={logistics.expectedShipDate} onChange={(e) => setLogistics((p) => ({ ...p, expectedShipDate: e.target.value }))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
            ) : <p className="mt-1 text-sm text-gray-900">{d10(req.expectedShipDate)}</p>}
          </div>
          <div>
            <p className={label}>발송지 구분</p>
            {canEdit ? (
              <select value={logistics.destType} onChange={(e) => setLogistics((p) => ({ ...p, destType: e.target.value }))} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option value="">선택</option>
                {AS_DEST_TYPES.map((t) => <option key={t} value={t}>{AS_DEST_TYPE_LABELS[t]}</option>)}
              </select>
            ) : <p className="mt-1 text-sm text-gray-900">{req.destType ? AS_DEST_TYPE_LABELS[req.destType as AsDestType] : '-'}</p>}
          </div>
          <div className="col-span-2 md:col-span-1">
            <p className={label}>발송지 정보</p>
            {canEdit ? (
              <input type="text" value={logistics.destInfo} onChange={(e) => setLogistics((p) => ({ ...p, destInfo: e.target.value }))} placeholder="주소 / 수령인" className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
            ) : <p className="mt-1 truncate text-sm text-gray-900">{req.destInfo ?? '-'}</p>}
          </div>
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-gray-100 px-4 py-2.5 sm:px-6">
            <button
              type="button"
              disabled={busy}
              onClick={() => putReceipt({
                pickedUpAt: logistics.pickedUpAt || null,
                receivedAt: logistics.receivedAt || null,
                expectedShipDate: logistics.expectedShipDate || null,
                destType: logistics.destType || null,
                destInfo: logistics.destInfo || null,
              }, '진행 기록 저장에 실패했습니다.')}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              진행 기록 저장
            </button>
          </div>
        )}
      </div>

      {/* 기기 라인 */}
      <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 className="text-sm font-semibold text-gray-700">기기 라인</h2>
          <span className="text-xs text-gray-400">{req.items.length}대 · 종결 {req.items.length - openItems.length}대</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {canResolve && <th className="w-8 px-3 py-2" />}
                {['시리얼', '모델·병동', '증상', '결과', '발송', '교체기'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {req.items.map((item) => (
                <tr key={item.id} className={item.outcome === 'CANCELED' ? 'text-gray-400' : ''}>
                  {canResolve && (
                    <td className="px-3 py-2">
                      {!item.outcome && (
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={(e) => setSelected((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(item.id)
                            else next.delete(item.id)
                            return next
                          })}
                          className="rounded border-gray-300"
                        />
                      )}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="font-mono text-sm text-gray-900">{item.serialNo}</span>
                    <span className="ml-1.5">{deviceBadge(item, req.asCode, req.hospital?.hospitalCode ?? null)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                    {item.device?.deviceInfo.deviceName ?? item.deviceKind ?? '-'}
                    {(item.device?.placement?.ward?.name ?? item.wardName) && (
                      <span className="ml-1 text-gray-400">· {item.device?.placement?.ward?.name ?? item.wardName}</span>
                    )}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-gray-700" title={item.symptom ?? undefined}>{item.symptom ?? '-'}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {item.outcome ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_BADGE_CLS[item.outcome] ?? 'bg-gray-100 text-gray-500'}`}>
                        {AS_OUTCOME_LABELS[item.outcome as AsOutcome] ?? item.outcome}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">진행 중</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                    {item.shippedAt ? (
                      <>
                        {d10(item.shippedAt)}
                        {item.shipMethod && <span className="ml-1">{AS_SHIP_METHOD_LABELS[item.shipMethod as AsMethod]}</span>}
                        {item.shipTrackingNo && <span className="ml-1 font-mono text-gray-400">{item.shipTrackingNo}</span>}
                      </>
                    ) : '-'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">{item.newSerialNo ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 라인 처리 패널 */}
        {canResolve && openItems.length > 0 && (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-6">
            {selected.size === 0 ? (
              <p className="text-xs text-gray-400">처리할 라인을 선택하세요 — 결과 확정 시 기기현황(AS 해제·교체·회수)에 즉시 기록됩니다.</p>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">선택 {selected.size}개 라인</span>
                  <select value={outcome} onChange={(e) => setOutcome(e.target.value as AsOutcome)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
                    {AS_OUTCOMES.map((o) => <option key={o} value={o}>{AS_OUTCOME_LABELS[o]}</option>)}
                  </select>
                  <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" title="처리일 (발송일)" />
                  {(outcome === 'REPAIR_RETURN' || outcome === 'REPLACE') && (
                    <>
                      <select value={shipMethod} onChange={(e) => setShipMethod(e.target.value)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
                        <option value="">발송방법</option>
                        <option value="PARCEL">택배발송</option>
                        <option value="VISIT">방문교체</option>
                      </select>
                      <input type="text" value={shipTrackingNo} onChange={(e) => setShipTrackingNo(e.target.value)} placeholder="발송 송장" className="w-40 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={runResolve}
                    disabled={busy}
                    className="ml-auto rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy ? '처리 중...' : '처리 실행'}
                  </button>
                </div>
                {outcome === 'REPLACE' && (
                  <div className="space-y-1.5 rounded-md border border-gray-200 bg-white px-3 py-2">
                    <p className="text-xs font-medium text-gray-500">교체 발송기기 시리얼 (라인별)</p>
                    {Array.from(selected).map((itemId) => {
                      const item = req.items.find((i) => i.id === itemId)
                      if (!item) return null
                      return (
                        <div key={itemId} className="flex items-center gap-2">
                          <span className="w-28 font-mono text-xs text-gray-600">{item.serialNo}</span>
                          <span className="text-gray-300">→</span>
                          <input
                            type="text"
                            value={newSerials[itemId] ?? ''}
                            onChange={(e) => setNewSerials((prev) => ({ ...prev, [itemId]: e.target.value }))}
                            placeholder="교체기 시리얼"
                            className="w-40 rounded-md border border-gray-300 px-2 py-1 font-mono text-xs"
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
