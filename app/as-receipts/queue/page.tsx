'use client'

/**
 * AS 수리대기 큐 (2026-09-28 — as_repair_queue_design.md §4) — AS담당자용 기기 단위 화면
 * 버킷 2개(수리 대기 · 입고 예정) × 기기군 세그먼트(심전계 / 산소포화도 / 기타). 라인 1행 = 기기 1대.
 * 수리 대기 행 액션: [수리완료] 체크(단건·선택 일괄) · 처리방법 초안(수리반환/교체+발송기기) · [폐기] — 전부 기존 라인 API 재사용.
 * 최종확정·발송정보는 접수 상세에서만(§5.3). 입고 예정은 읽기 전용.
 */
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Pager from '@/app/components/ui/Pager'
import AsTabs from '../_components/AsTabs'
import {
  AS_QUEUE_BUCKETS, AS_QUEUE_BUCKET_LABELS, AS_QUEUE_BUCKET_DESC, parseAsQueueBucket, type AsQueueBucket,
  AS_DEVICE_GROUP_CODE_LIST, AS_DEVICE_GROUP_CODE_LABELS, parseAsDeviceGroupCode, type AsDeviceGroupCode,
  AS_TAG_LABELS, AS_TAG_BADGE_CLS, type AsTag, AS_OUTCOME_LABELS, type AsOutcome, AS_INTAKE_STATE_LABELS, type AsIntakeState,
  AS_PICKUP_METHOD_LABELS, type AsPickupMethod, AS_CATEGORY_LABELS, type AsCategory,
  AS_LINE_CONDITION_BADGE_CLS, isAsLineConditionBadge, AS_QUEUE_QS_KEY, AS_BACK_KEY, AS_QUEUE_BULK_MAX,
} from '@/lib/asReceiptShared'
import { deviceConditionLabel, deviceSiteLabel } from '@/lib/deviceRegistryShared'

interface QueueItem {
  id: number
  serialNo: string
  deviceId: number | null
  symptom: string | null
  processNote: string | null
  outcome: string | null
  newSerialNo: string | null
  draftOutcome: string | null
  draftNewSerialNo: string | null
  intakeState: string
  receivedAt: string | null
  repairedAt: string | null
  device: {
    id: number
    deviceInfo: { deviceName: string }
    placement: { status: string; hospitalCode: string | null; asStartedOn: string | null; asRefCode: string | null; ward: { name: string } | null } | null
    unit?: { condition: string | null; locationSiteValue: string | null; locationHospitalCode: string | null; locationHospitalName?: string | null } | null
  } | null
  newDevice: { id: number; serialNo: string } | null
  receipt: {
    id: number
    asCode: string
    hospitalCode: string
    hospitalName: string
    receiptDate: string
    category: string
    pickupMethod: string | null
    pickupTrackingNo: string | null
    pickedUpAt: string | null
    receivedAt: string | null
    status: { id: number; name: string; color: string | null; ticketStatus: string | null } | null
    tags: AsTag[]
    canEdit: boolean
  }
}
type Counts = Record<AsQueueBucket, Record<AsDeviceGroupCode, number>>
interface QueueData { counts: Counts; items: QueueItem[]; total: number; page: number; pageSize: number }

const d10 = (iso: string | null) => (iso ? iso.slice(0, 10) : '-')
function todayKstYmd(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}
/** 경과일 (YYYY-MM-DD → 오늘 KST) */
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const a = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime()
  const b = new Date(`${todayKstYmd()}T00:00:00Z`).getTime()
  return Math.max(0, Math.round((b - a) / 86400000))
}
function elapsedCell(iso: string | null) {
  const d = daysSince(iso)
  if (d == null) return <span className="text-gray-300">-</span>
  const cls = d >= 14 ? 'text-red-600 font-semibold' : d >= 7 ? 'text-amber-600 font-medium' : 'text-gray-500'
  return <span className={cls}>{d}일</span>
}
function statusBadge(s: QueueItem['receipt']['status']) {
  if (!s) return <span className="text-xs text-gray-300">-</span>
  return (
    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium" style={s.color ? { backgroundColor: `${s.color}22`, color: s.color } : undefined}>
      {s.name}
    </span>
  )
}
const INTAKE_BADGE_CLS: Record<string, string> = { PENDING: 'bg-gray-100 text-gray-400', RECEIVED: 'bg-emerald-50 text-emerald-700', MISMATCH: 'bg-red-100 text-red-700', EXTRA: 'bg-orange-100 text-orange-700' }
function intakeBadge(item: QueueItem) {
  const st = item.intakeState as AsIntakeState
  return <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium ${INTAKE_BADGE_CLS[st] ?? INTAKE_BADGE_CLS.PENDING}`}>{AS_INTAKE_STATE_LABELS[st] ?? item.intakeState}</span>
}
/** 기기 상태 배지 — 상세 시리얼 셀과 같은 3종(수리완료·폐기·분실) + 위치 툴팁. 큐에서는 AS접수 상태도 위치 파악용으로 회색 표시 */
function conditionBadge(item: QueueItem) {
  const u = item.device?.unit
  if (!u || !u.condition) return null
  const hospitalCode = item.receipt.hospitalCode
  const loc = u.locationSiteValue ? deviceSiteLabel(u.locationSiteValue) : u.locationHospitalCode ? (u.locationHospitalCode === hospitalCode ? '접수 병원' : `병원 ${u.locationHospitalName ?? u.locationHospitalCode}`) : '없음'
  const cls = isAsLineConditionBadge(u.condition) ? AS_LINE_CONDITION_BADGE_CLS[u.condition] : 'bg-gray-100 text-gray-500'
  return (
    <span className={`ml-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium ${cls}`} title={`기기 상태 ${deviceConditionLabel(u.condition)} · 위치: ${loc}`}>
      {deviceConditionLabel(u.condition)}
    </span>
  )
}
function tagBadges(tags: AsTag[]) {
  if (!tags.length) return <span className="text-xs text-gray-300">-</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => <span key={t} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${AS_TAG_BADGE_CLS[t]}`}>{AS_TAG_LABELS[t]}</span>)}
    </span>
  )
}
const OUTCOME_BADGE_CLS: Record<string, string> = { REPAIR_RETURN: 'bg-emerald-50 text-emerald-700', REPLACE: 'bg-blue-50 text-blue-700' }
const QUEUE_OUTCOMES: readonly AsOutcome[] = ['REPAIR_RETURN', 'REPLACE'] // 큐에서 고르는 처리방법 — 분실·취소는 접수 상세(접수자 판단)
const thCls = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500'
const tdCls = 'px-3 py-2 align-top'

function QueuePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [bucket, setBucket] = useState<AsQueueBucket>(() => parseAsQueueBucket(searchParams.get('bucket')))
  const [group, setGroup] = useState<AsDeviceGroupCode>(() => parseAsDeviceGroupCode(searchParams.get('group')))
  const [hospitalInput, setHospitalInput] = useState(searchParams.get('hospital') ?? '')
  const [hospital, setHospital] = useState(searchParams.get('hospital') ?? '')
  const [priority, setPriority] = useState(searchParams.get('priority') === '1')
  const [page, setPage] = useState(() => Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1))
  const [data, setData] = useState<QueueData | null>(null)
  const [loading, setLoading] = useState(true)
  const [canWrite, setCanWrite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [replaceSerial, setReplaceSerial] = useState<Record<number, string>>({}) // 교체 초안 발송기기 입력 (라인별, 열려 있는 동안만)
  const loadSeq = useRef(0)

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setCanWrite(d.role !== 'VIEWER'))
  }, [])

  const buildParams = useCallback(() => {
    const p = new URLSearchParams()
    p.set('bucket', bucket)
    p.set('group', group)
    if (hospital) p.set('hospital', hospital)
    if (priority) p.set('priority', '1')
    if (page > 1) p.set('page', String(page))
    return p
  }, [bucket, group, hospital, priority, page])

  // URL 동기화 + 마지막 조회 보관(상세 [← 목록]·탭 복귀용) — 목록 페이지와 같은 패턴
  useEffect(() => {
    const qs = buildParams().toString()
    window.history.replaceState(null, '', `/as-receipts/queue?${qs}`)
    try { window.sessionStorage.setItem(AS_QUEUE_QS_KEY, qs); window.sessionStorage.setItem(AS_BACK_KEY, 'queue') } catch { /* 저장 불가 환경 */ }
  }, [buildParams])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    const res = await fetch(`/api/as-receipts/queue?${buildParams().toString()}`, { cache: 'no-store' })
    const d = res.ok ? ((await res.json()) as QueueData) : null
    if (seq !== loadSeq.current) return
    setData(d)
    setLoading(false)
    if (d) setSelected((prev) => new Set(Array.from(prev).filter((id) => d.items.some((i) => i.id === id)))) // 화면 밖 선택 해제
  }, [buildParams])
  useEffect(() => { void load() }, [load])

  const items = data?.items ?? []
  const counts = data?.counts
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? 50
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const groupTotal = (b: AsQueueBucket) => (counts ? AS_DEVICE_GROUP_CODE_LIST.reduce((s, g) => s + counts[b][g], 0) : 0)

  function flash(lines: string[]) { setNotice(lines) }

  async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    setBusy(true)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { ok: res.ok, data: d }
    } finally {
      setBusy(false)
    }
  }

  /** [수리완료] 단건 — 체크 즉시 기록, 다음 조회부터 수리 대기에서 빠짐 */
  async function markRepaired(item: QueueItem) {
    const r = await post(`/api/as-receipts/${item.receipt.id}/repair-done`, { itemId: item.id, repaired: true })
    if (!r.ok) { flash([String(r.data.error ?? '수리완료 처리에 실패했습니다.')]); return }
    const warnings = (r.data.warnings as string[] | undefined) ?? []
    flash([`${item.serialNo} 수리완료 기록됨 (${item.receipt.asCode})`, ...warnings])
    router.refresh()
    await load()
  }

  /** 선택 라인 수리완료 일괄 */
  async function bulkRepaired() {
    const ids = Array.from(selected)
    if (!ids.length) return
    if (!confirm(`선택한 ${ids.length}대를 수리완료로 기록합니다. 기기 상태가 '수리완료'로 바뀝니다. 계속할까요?`)) return
    const r = await post('/api/as-receipts/queue/repair-done', { itemIds: ids })
    if (!r.ok) { flash([String(r.data.error ?? '일괄 수리완료에 실패했습니다.')]); return }
    const skipped = (r.data.skipped as { serialNo: string | null; reason: string }[] | undefined) ?? []
    const warnings = (r.data.warnings as string[] | undefined) ?? []
    flash([
      `수리완료 ${r.data.updated}대 기록${skipped.length ? ` · 건너뜀 ${skipped.length}대` : ''}`,
      ...skipped.map((s) => `${s.serialNo ?? '?'}: ${s.reason}`),
      ...warnings,
    ])
    setSelected(new Set())
    router.refresh()
    await load()
  }

  /** 처리방법 초안 — 기기현황에 기록되지 않음, 최종확정은 접수 상세 */
  async function saveDraft(item: QueueItem, outcome: AsOutcome | null, newSerial?: string) {
    if (outcome === 'REPLACE' && !newSerial?.trim()) { flash(['교체 초안은 발송기기 시리얼이 필요합니다.']); return }
    const r = await post(`/api/as-receipts/${item.receipt.id}/draft-lines`, { lines: [{ itemId: item.id, outcome, newSerial: outcome === 'REPLACE' ? newSerial!.trim() : undefined }] })
    if (!r.ok) { flash([String(r.data.error ?? '처리방법 저장에 실패했습니다.')]); return }
    setReplaceSerial((prev) => { const n = { ...prev }; delete n[item.id]; return n })
    router.refresh()
    await load()
  }

  async function scrapLine(item: QueueItem) {
    const memo = prompt(`${item.serialNo} 폐기 사유를 입력하세요 (필수 — 접수 비고에 기록):`)
    if (memo == null) return
    if (!memo.trim()) { flash(['폐기 사유를 입력하세요.']); return }
    const r = await post(`/api/as-receipts/${item.receipt.id}/scrap-line`, { itemId: item.id, memo: memo.trim() })
    if (!r.ok) { flash([String(r.data.error ?? r.data.message ?? '폐기 처리에 실패했습니다.')]); return }
    flash([`${item.serialNo} 폐기 처리됨`, ...(((r.data.warnings as string[] | undefined) ?? []))])
    router.refresh()
    await load()
  }

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id))
  const isWaiting = bucket === 'WAITING'

  /** 처리방법 셀 — 확정 배지 / 초안 셀렉트(+교체 발송기기) */
  function outcomeCell(item: QueueItem) {
    if (item.outcome) {
      return (
        <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium ${OUTCOME_BADGE_CLS[item.outcome] ?? 'bg-gray-100 text-gray-500'}`} title="최종확정된 결과 (접수 상세)">
          {AS_OUTCOME_LABELS[item.outcome as AsOutcome] ?? item.outcome} 확정{item.newSerialNo ? ` · ${item.newSerialNo}` : ''}
        </span>
      )
    }
    const editable = canWrite && item.receipt.canEdit
    const editing = item.id in replaceSerial
    const cur = editing ? 'REPLACE' : (item.draftOutcome ?? '')
    return (
      <div className="flex flex-wrap items-center gap-1">
        <select
          value={cur}
          disabled={!editable || busy}
          onChange={(e) => {
            const v = e.target.value as AsOutcome | ''
            if (v === 'REPLACE') { setReplaceSerial((prev) => ({ ...prev, [item.id]: item.draftNewSerialNo ?? '' })); return }
            setReplaceSerial((prev) => { const n = { ...prev }; delete n[item.id]; return n })
            void saveDraft(item, v || null)
          }}
          className={`rounded-md border px-1.5 py-0.5 text-xs ${item.draftOutcome ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-gray-300 bg-white text-gray-600'} disabled:opacity-60`}
          title={!editable ? '초안 저장 권한이 없습니다 (종결 접수는 ADMIN·AS 관리 권한만)' : '처리방법 초안 — 기기현황에 기록되지 않으며 접수 상세 [최종확정]으로 확정'}
        >
          <option value="">미정</option>
          {QUEUE_OUTCOMES.map((o) => <option key={o} value={o}>{AS_OUTCOME_LABELS[o]}</option>)}
        </select>
        {item.draftOutcome && !editing && <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700">초안{item.draftOutcome === 'REPLACE' && item.draftNewSerialNo ? ` · ${item.draftNewSerialNo}` : ''}</span>}
        {editing && (
          <>
            <input
              autoFocus
              value={replaceSerial[item.id] ?? ''}
              onChange={(e) => setReplaceSerial((prev) => ({ ...prev, [item.id]: e.target.value.toUpperCase() }))}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveDraft(item, 'REPLACE', replaceSerial[item.id]); if (e.key === 'Escape') setReplaceSerial((prev) => { const n = { ...prev }; delete n[item.id]; return n }) }}
              placeholder="발송기기 시리얼"
              className="w-32 rounded-md border border-blue-300 px-1.5 py-0.5 font-mono text-xs"
            />
            <button type="button" disabled={busy} onClick={() => void saveDraft(item, 'REPLACE', replaceSerial[item.id])} className="rounded bg-blue-600 px-1.5 py-0.5 text-[11px] text-white hover:bg-blue-700 disabled:opacity-50">저장</button>
            <button type="button" onClick={() => setReplaceSerial((prev) => { const n = { ...prev }; delete n[item.id]; return n })} className="text-[11px] text-gray-500 hover:underline">취소</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">AS업무</h1>
          <p className="mt-0.5 text-sm text-gray-500">수리대기 — 센터에 들어와 수리를 기다리는 기기와 입고 예정 기기를 기기 단위로 봅니다.</p>
        </div>
      </div>
      <AsTabs />

      {notice && notice.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{notice[0]}</p>
              {notice.length > 1 && <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">{notice.slice(1).map((w, i) => <li key={i}>{w}</li>)}</ul>}
            </div>
            <button type="button" onClick={() => setNotice(null)} className="text-xs text-amber-700 hover:underline">닫기</button>
          </div>
        </div>
      )}

      {/* 버킷 카드 — 클릭으로 전환, 기기군 3종 건수 항상 표시 */}
      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        {AS_QUEUE_BUCKETS.map((b) => {
          const active = b === bucket
          return (
            <button
              key={b}
              type="button"
              onClick={() => { setBucket(b); setPage(1); setSelected(new Set()) }}
              className={`rounded-lg border px-3.5 py-2.5 text-left shadow-sm transition ${active ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
              title={AS_QUEUE_BUCKET_DESC[b]}
            >
              <p className={`text-xs ${active ? 'text-blue-700' : 'text-gray-400'}`}>{AS_QUEUE_BUCKET_LABELS[b]}</p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-lg font-bold text-gray-900">{counts ? groupTotal(b).toLocaleString() : '–'}<span className="ml-0.5 text-sm font-normal text-gray-400">대</span></span>
                {AS_DEVICE_GROUP_CODE_LIST.map((g) => (
                  <span key={g} className={`text-xs ${active && g === group ? 'font-semibold text-blue-700' : 'text-gray-500'}`}>
                    {AS_DEVICE_GROUP_CODE_LABELS[g]} <span className="font-medium text-gray-800">{counts ? counts[b][g].toLocaleString() : '–'}</span>
                  </span>
                ))}
              </p>
            </button>
          )
        })}
      </div>

      {/* 필터 줄 — 기기군 세그먼트 · 병원 · 우선수리 */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white text-sm">
          {AS_DEVICE_GROUP_CODE_LIST.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => { setGroup(g); setPage(1); setSelected(new Set()) }}
              className={`px-3 py-1 ${g === group ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {AS_DEVICE_GROUP_CODE_LABELS[g]}{counts && <span className={`ml-1 text-xs ${g === group ? 'text-blue-100' : 'text-gray-400'}`}>{counts[bucket][g]}</span>}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setHospital(hospitalInput.trim()); setPage(1) }} className="flex items-center gap-1">
          <input value={hospitalInput} onChange={(e) => setHospitalInput(e.target.value)} placeholder="병원명·코드" className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm" />
          <button type="submit" className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 hover:bg-gray-50">검색</button>
          {hospital && <button type="button" onClick={() => { setHospital(''); setHospitalInput(''); setPage(1) }} className="text-xs text-gray-500 hover:underline">지우기</button>}
        </form>
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${priority ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-700'}`} title="'우선수리' 태그 접수의 기기만">
          <input type="checkbox" checked={priority} onChange={(e) => { setPriority(e.target.checked); setPage(1) }} className="rounded border-gray-300" />
          우선수리만
        </label>
        <span className="ml-auto text-sm text-gray-500">{total.toLocaleString()}대</span>
      </div>

      {isWaiting && canWrite && selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <span className="font-medium">{selected.size}대 선택</span>
          <span className="text-blue-300">|</span>
          <button type="button" onClick={() => void bulkRepaired()} disabled={busy || selected.size > AS_QUEUE_BULK_MAX} className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50" title={selected.size > AS_QUEUE_BULK_MAX ? `한 번에 최대 ${AS_QUEUE_BULK_MAX}대` : '선택한 기기를 수리완료로 기록 (기기 상태 수리완료 — 단건 체크와 같은 규칙)'}>
            {busy ? '처리 중…' : `수리완료 ${selected.size}대 적용`}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} disabled={busy} className="ml-auto text-xs text-blue-700 hover:underline">선택 해제</button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading && !data ? (
          <p className="py-16 text-center text-sm text-gray-400">불러오는 중...</p>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">{AS_QUEUE_BUCKET_LABELS[bucket]} 기기가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`min-w-full divide-y divide-gray-200 text-sm ${loading ? 'opacity-60' : ''}`}>
              <thead className="bg-gray-50">
                <tr>
                  {isWaiting && canWrite && (
                    <th className="w-8 px-3 py-2">
                      <input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} className="rounded border-gray-300" title="현재 페이지 전체 선택" />
                    </th>
                  )}
                  <th className={thCls}>시리얼</th>
                  <th className={thCls}>접수번호</th>
                  <th className={thCls}>병원</th>
                  {isWaiting ? (
                    <>
                      <th className={thCls}>입고일</th>
                      <th className={thCls}>경과</th>
                    </>
                  ) : (
                    <>
                      <th className={thCls}>접수일</th>
                      <th className={thCls}>경과</th>
                      <th className={thCls}>상태</th>
                      <th className={thCls}>수거</th>
                      <th className={thCls}>입고대조</th>
                    </>
                  )}
                  <th className={`${thCls} min-w-[16rem]`}>접수사유</th>
                  <th className={thCls}>태그</th>
                  {isWaiting && (
                    <>
                      <th className={`${thCls} min-w-[14rem]`}>처리방법</th>
                      <th className={thCls}>수리완료</th>
                      <th className={thCls}></th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => {
                  const cond = item.device?.unit?.condition ?? null
                  const scrappable = canWrite && item.device?.placement?.status === 'RECOVERED' && cond !== 'SCRAPPED' && cond !== 'LOST'
                  return (
                    <tr key={item.id} className={`hover:bg-gray-50 ${item.receipt.tags.includes('PRIORITY_REPAIR') ? 'bg-red-50/40' : ''}`}>
                      {isWaiting && canWrite && (
                        <td className="px-3 py-2 align-top">
                          <input type="checkbox" checked={selected.has(item.id)} onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(item.id); else n.delete(item.id); return n })} className="rounded border-gray-300" />
                        </td>
                      )}
                      <td className={`${tdCls} whitespace-nowrap font-mono text-xs`}>
                        {item.serialNo}
                        {!item.deviceId && <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 font-sans text-[11px] font-medium text-gray-500">미등록</span>}
                        {conditionBadge(item)}
                      </td>
                      <td className={`${tdCls} whitespace-nowrap`}>
                        <Link href={`/as-receipts/${item.receipt.id}`} className="font-mono text-xs text-blue-600 hover:underline">{item.receipt.asCode}</Link>
                        {item.receipt.category !== 'FAULT' && <span className="ml-1 text-[11px] text-gray-400">{AS_CATEGORY_LABELS[item.receipt.category as AsCategory] ?? item.receipt.category}</span>}
                      </td>
                      <td className={`${tdCls} max-w-[12rem] truncate`} title={item.receipt.hospitalName}>{item.receipt.hospitalName}</td>
                      {isWaiting ? (
                        <>
                          <td className={`${tdCls} whitespace-nowrap text-xs text-gray-600`}>{d10(item.receivedAt)}</td>
                          <td className={`${tdCls} whitespace-nowrap text-xs`}>{elapsedCell(item.receivedAt)}</td>
                        </>
                      ) : (
                        <>
                          <td className={`${tdCls} whitespace-nowrap text-xs text-gray-600`}>{d10(item.receipt.receiptDate)}</td>
                          <td className={`${tdCls} whitespace-nowrap text-xs`}>{elapsedCell(item.receipt.receiptDate)}</td>
                          <td className={tdCls}>{statusBadge(item.receipt.status)}</td>
                          <td className={`${tdCls} whitespace-nowrap text-xs text-gray-600`}>
                            {item.receipt.pickupMethod ? AS_PICKUP_METHOD_LABELS[item.receipt.pickupMethod as AsPickupMethod] ?? item.receipt.pickupMethod : '-'}
                            {item.receipt.pickedUpAt && <span className="ml-1 text-gray-400">{d10(item.receipt.pickedUpAt).slice(5)}</span>}
                            {item.receipt.pickupTrackingNo && <span className="ml-1 font-mono text-gray-400" title="수거 송장">{item.receipt.pickupTrackingNo}</span>}
                          </td>
                          <td className={tdCls}>{intakeBadge(item)}</td>
                        </>
                      )}
                      <td className={`${tdCls} max-w-[24rem]`}>
                        <p className="truncate text-xs text-gray-700" title={item.symptom ?? undefined}>{item.symptom || <span className="text-gray-300">-</span>}</p>
                        {isWaiting && item.processNote && <p className="truncate text-[11px] text-gray-400" title={item.processNote}>처리: {item.processNote}</p>}
                      </td>
                      <td className={tdCls}>{tagBadges(item.receipt.tags)}</td>
                      {isWaiting && (
                        <>
                          <td className={tdCls}>{outcomeCell(item)}</td>
                          <td className={`${tdCls} text-center`}>
                            <input
                              type="checkbox"
                              checked={false}
                              disabled={!canWrite || busy}
                              onChange={() => void markRepaired(item)}
                              className="h-4 w-4 rounded border-gray-300 text-emerald-600"
                              title={!canWrite ? '수리완료 체크 권한이 없습니다' : '체크하면 수리완료로 기록되고 이 목록에서 빠집니다 (해제는 접수 상세)'}
                            />
                          </td>
                          <td className={`${tdCls} whitespace-nowrap`}>
                            {scrappable && (
                              <button type="button" disabled={busy} onClick={() => void scrapLine(item)} className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-red-600 disabled:opacity-40" title="회수된 기기를 폐기 처리합니다 (기기 상태 폐기·위치 없음, 사유 필수)">폐기</button>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {totalPages > 1 && <Pager page={page} totalPages={totalPages} onChange={(p) => { setPage(p); setSelected(new Set()) }} total={total} className="mt-3" />}
    </div>
  )
}

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">불러오는 중...</div>}>
      <QueuePageInner />
    </Suspense>
  )
}
