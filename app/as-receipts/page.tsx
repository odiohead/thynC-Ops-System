'use client'

/**
 * AS업무 목록 (as_work_design.md §8)
 * 기기 수리·교체(AS) 접수 — 연결 티켓 refType 'AS'. [+ 접수]로 등록 (VIEWER 제외).
 */
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import TicketRuleSettingButton from '@/app/components/TicketRuleSettingButton'
import Pager from '@/app/components/ui/Pager'
import DateRangeFilter from '@/app/components/ui/DateRangeFilter'
import AsReceiptFormModal from './_components/AsReceiptFormModal'
import AsTabs from './_components/AsTabs' // 접수 목록 ↔ 수리대기 탭 (2026-09-28)
import { AS_LIST_COLUMNS, AS_LIST_COLUMN_MAP, AS_LIST_COLUMN_GROUPS, AS_LIST_VIEW_KEY, AS_LIST_COL_MIN, defaultAsListPrefs, normalizeAsListPrefs, samePrefs, type AsListPrefs } from '@/lib/asReceiptColumns' // 사용자 열 설정 (2026-10-01)
import { AS_CATEGORIES, AS_CATEGORY_LABELS, AS_REGISTRY_TAG_LABELS, AS_TAGS, AS_TAG_LABELS, AS_TAG_BADGE_CLS, asReceiptTags, asReceiptDeviceStateLabel, summarizeAsItemsByKind, summarizeAsItemsByGroup, summarizeAsItemProductTypes, type AsCategory, type AsRegistryTagSummary, type AsTag, AS_SEARCH_FIELDS, AS_SEARCH_FIELD_LABELS, AS_SEARCH_FIELD_PLACEHOLDER, parseAsSearchField, type AsSearchField, isAsCanceledStatus, AS_LIST_QS_KEY, AS_BACK_KEY, AS_BULK_STATUS_MAX, summarizeAsReceiptWards, AS_PICKUP_METHOD_LABELS, type AsPickupMethod, AS_DEST_TYPE_LABELS, type AsDestType, AS_OUTCOME_LABELS, type AsOutcome, AS_SHIP_METHOD_LABELS, type AsMethod, summarizeAsRepairProgress } from '@/lib/asReceiptShared'

interface CodeRef { id: number; name: string; color: string | null }
/** 정렬 가능 컬럼 (2026-09-16) — 서버 정렬(`?sort=&dir=`). 계산 컬럼(기기상태·기기·유형·송장·태그)은 정렬 없음 */
type SortKey = 'asCode' | 'hospital' | 'category' | 'status' | 'receiptDate' | 'receivedAt' | 'shippedAt'
const SORT_KEYS: readonly SortKey[] = ['asCode', 'hospital', 'category', 'status', 'receiptDate', 'receivedAt', 'shippedAt']
// 열 정의는 lib/asReceiptColumns.ts (사용자 열 설정 — 표시·순서·폭, 2026-10-01)

interface AsRow {
  id: number
  asCode: string
  category: string
  receiptDate: string
  receivedAt: string | null // 입고일 (최초 입고처리일, 2026-09-16 열)
  resolvedAt: string | null
  createdAt: string
  preReplace: boolean
  priorityRepair: boolean // 태그 (2026-09-15)
  firmwareUpdate: boolean
  accessoryIncluded: boolean
  combinedPack: boolean
  pickupMethod: string | null
  pickupTrackingNo: string | null
  pickedUpAt: string | null // 수거일 (2026-10-01)
  reporterName: string | null // 고객명(카카오채널명)
  pickupDestDiffers: boolean
  pickupDestInfo: string | null
  checkedAt: string | null
  destInfo: string | null
  expectedShipDate: string | null
  statusChangedAt: string | null
  note: string | null
  sheetDoneSynced: string | null
  destType: string | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  registryTags: AsRegistryTagSummary[]
  intakeIssues: number // 입고 대조 미입고·미식별입고 라인 수 (2026-09-11)
  status: CodeRef | null
  createdBy: { id: string; name: string } | null
  ticket: { id: number; ticketCode: string; status: string; owner: { id: string; name: string } | null } | null
  items: {
    id: number; serialNo: string; outcome: string | null; deviceKind: string | null; intakeState: string; receivedAt: string | null; shippedAt: string | null; shipTrackingNo: string | null
    wardName: string | null // 접수 병동 (2026-09-29)
    newSerialNo: string | null; shipMethod: string | null; symptom: string | null // 사용자 열 (2026-10-01)
    repairedAt: string | null // 수리완료 체크 (2026-09-17) — 기기 셀 `수리 n/m`
    device: { deviceInfo: { deviceName: string }; placement: { productType: string | null } | null } | null
    newDevice: { placement: { productType: string | null } | null } | null
  }[]
}

/** 구분 배지 — 고장 앰버 · 분실 빨강 (2026-09-11) */
const CATEGORY_BADGE: Record<string, string> = {
  FAULT: 'bg-amber-100 text-amber-800',
  LOST: 'bg-red-100 text-red-700',
}

const PRODUCT_TYPE_BADGE: Record<string, string> = {
  일반: 'bg-gray-100 text-gray-700',
  라이트: 'bg-blue-100 text-blue-800',
}

function productTypeBadges(items: AsRow['items']) {
  const types = summarizeAsItemProductTypes(items)
  if (!types.length) return <span className="text-xs text-gray-300">-</span>
  return (
    <span className="inline-flex gap-1">
      {types.map((t) => (
        <span key={t} className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRODUCT_TYPE_BADGE[t] ?? 'bg-gray-100 text-gray-700'}`}>{t}</span>
      ))}
    </span>
  )
}

/** 기기 열 (2026-09-15 축약) — ECG · SpO2 · ETC 코드 + 대수, 종결분은 흐리게 '/n'. 툴팁에 기존 상세 표기. 2026-09-17: 체크 가능(입고) 라인이 있으면 '수리 n/m' 병기(n<m amber · n=m green) */
const DEVICE_GROUP_BADGE: Record<string, string> = {
  ECG: 'bg-sky-50 text-sky-700 ring-sky-200',
  SpO2: 'bg-rose-50 text-rose-700 ring-rose-200',
  ETC: 'bg-gray-100 text-gray-600 ring-gray-200',
}
function deviceCell(r: AsRow) {
  const groups = summarizeAsItemsByGroup(r.items)
  if (!groups.length) return <span className="text-xs text-gray-300">-</span>
  return (
    <span className="inline-flex items-center gap-1" title={summarizeAsItemsByKind(r.items)}>
      {groups.map((g) => (
        <span key={g.code} className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 font-mono text-[11px] font-semibold ring-1 ring-inset ${DEVICE_GROUP_BADGE[g.code]}`}>
          {g.code}<span className="font-sans font-medium">{g.count}</span>
          {g.done > 0 && <span className="font-sans font-normal opacity-50">/{g.done}</span>}
          {g.repairable > 0 && (
            <span className={`ml-0.5 font-sans font-medium ${g.repaired < g.repairable ? 'text-amber-700' : 'text-emerald-700'}`} title={`수리완료 ${g.repaired} / 입고 라인 ${g.repairable}`}>수리{g.repaired}/{g.repairable}</span>
          )}
        </span>
      ))}
    </span>
  )
}

/** 태그 배지 (2026-09-15) — 선교체·우선수리·펌웨어 업데이트·부속품 동봉·합포장 (보조 줄로 이동, 표기는 그대로 — 2026-10-01) */
function tagBadges(r: AsRow) {
  const tags = asReceiptTags(r)
  if (!tags.length) return <span className="text-xs text-gray-300">-</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => <span key={t} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${AS_TAG_BADGE_CLS[t]}`}>{AS_TAG_LABELS[t]}</span>)}
    </span>
  )
}

/** 입고일 열 (2026-09-16) — 라인 입고일 중 최신(없으면 접수 헤더 입고일). 여러 날짜면 툴팁에 전체, 미입고 라인이 남으면 '(n/m)' */
function receivedCell(r: AsRow) {
  const dates = Array.from(new Set(r.items.map((i) => i.receivedAt?.slice(0, 10)).filter((d): d is string => !!d))).sort()
  const headerDate = r.receivedAt?.slice(0, 10) ?? null
  if (!dates.length) {
    if (!headerDate) return <span className="text-xs text-gray-300">-</span>
    return <span>{headerDate}</span>
  }
  const received = r.items.filter((i) => i.receivedAt).length
  const partial = received < r.items.length
  return (
    <span title={dates.length > 1 ? `입고일 ${dates.join(', ')}` : undefined}>
      {dates[dates.length - 1]}
      {(partial || dates.length > 1) && <span className="ml-1 text-xs text-gray-400">({received}/{r.items.length})</span>}
    </span>
  )
}

/** 발송일 열 (2026-09-15) — 라인 발송일 중 최신. 여러 날짜면 툴팁에 전체, 미발송 라인이 남으면 '(n/m)' */
function shippedCell(r: AsRow) {
  const dates = Array.from(new Set(r.items.map((i) => i.shippedAt?.slice(0, 10)).filter((d): d is string => !!d))).sort()
  if (!dates.length) return <span className="text-xs text-gray-300">-</span>
  const shipped = r.items.filter((i) => i.shippedAt).length
  const partial = shipped < r.items.length
  return (
    <span title={dates.length > 1 ? `발송일 ${dates.join(', ')}` : undefined}>
      {dates[dates.length - 1]}
      {(partial || dates.length > 1) && <span className="ml-1 text-xs text-gray-400">({shipped}/{r.items.length})</span>}
    </span>
  )
}

/** 발송 송장번호 열 (2026-09-15) — 라인 송장 중복 제거, 여러 개면 첫 값 + '+n'(툴팁 전체) */
function shipTrackingCell(r: AsRow) {
  const nos = Array.from(new Set(r.items.map((i) => i.shipTrackingNo?.trim()).filter((v): v is string => !!v)))
  if (!nos.length) return <span className="text-xs text-gray-300">-</span>
  return (
    <span className="font-mono text-xs text-gray-700" title={nos.length > 1 ? nos.join(', ') : undefined}>
      {nos[0]}{nos.length > 1 && <span className="ml-1 font-sans text-gray-400">+{nos.length - 1}</span>}
    </span>
  )
}

/** 접수 기기상태 — 미종결 라인의 원장 정합: 정상 / 확인필요(툴팁에 태그별 라인 수) / 미종결 라인 없으면 '-' */
function deviceStateBadge(r: AsRow) {
  const label = asReceiptDeviceStateLabel(r.items.some((i) => !i.outcome), r.registryTags ?? [], r.intakeIssues ?? 0, isAsCanceledStatus(r.status))
  if (!label) return <span className="text-xs text-gray-300">-</span>
  if (label === '취소') return <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-500" title="취소된 접수 — 원장 정합·입고 대조 검토 대상 아님">취소</span>
  if (label === '정상') return <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700">정상</span>
  const parts = r.registryTags.map((t) => `${t.tag === 'DUPLICATE' || t.tag === 'BAD_SERIAL' ? '' : '원장 '}${AS_REGISTRY_TAG_LABELS[t.tag]} ${t.count}대${t.detail ? ` (${t.detail})` : ''}`) // DUPLICATE(2026-09-18)는 원장 축이 아님
  if (r.intakeIssues > 0) parts.push(`입고 대조 미입고·미식별입고 ${r.intakeIssues}대`)
  const tip = parts.join(' · ')
  return <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700" title={tip}>확인필요</span>
}

function codeBadge(c: CodeRef | null) {
  if (!c) return <span className="text-xs text-gray-300">-</span>
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${c.color ?? '#9CA3AF'}22`, color: c.color ?? '#6B7280' }}
    >
      {c.name}
    </span>
  )
}

/** 열 키 → 셀 내용 (사용자 열 설정, 2026-10-01). 긴 내용은 셀의 truncate(말줄임)로 잘리고 title 툴팁에 전체 */
function renderCell(key: string, r: AsRow): { node: React.ReactNode; title?: string } {
  const dash = <span className="text-xs text-gray-300">-</span>
  switch (key) {
    case 'asCode': return { node: <span className="font-mono text-xs text-blue-600">{r.asCode}</span> }
    case 'hospital': return { node: <span className="text-gray-900">{r.hospital?.hospitalName ?? '-'}</span>, title: r.hospital?.hospitalName ?? undefined }
    case 'receiptDate': return { node: <span className="text-gray-600">{r.receiptDate.slice(0, 10)}</span> }
    case 'ward': { const w = summarizeAsReceiptWards(r.items).join(', '); return { node: w ? <span className="text-xs text-gray-600">{w}</span> : dash, title: w || undefined } }
    case 'deviceState': return { node: deviceStateBadge(r) }
    case 'category': return { node: <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CATEGORY_BADGE[r.category] ?? 'bg-gray-100 text-gray-700'}`}>{AS_CATEGORY_LABELS[r.category as AsCategory] ?? r.category}</span> }
    case 'devices': return { node: deviceCell(r), title: summarizeAsItemsByKind(r.items) }
    case 'productType': return { node: productTypeBadges(r.items) }
    case 'status': return { node: codeBadge(r.status) }
    case 'pickedUpAt': return { node: r.pickedUpAt ? <span className="text-gray-600">{r.pickedUpAt.slice(0, 10)}</span> : dash }
    case 'pickupTrackingNo': { const v = r.pickupTrackingNo?.trim(); return { node: v ? <span className="font-mono text-xs text-gray-700">{v}</span> : dash, title: v || undefined } }
    case 'pickupMethod': return { node: r.pickupMethod ? <span className="text-xs text-gray-600">{AS_PICKUP_METHOD_LABELS[r.pickupMethod as AsPickupMethod] ?? r.pickupMethod}</span> : dash }
    case 'receivedAt': return { node: <span className="text-gray-600">{receivedCell(r)}</span> }
    case 'shippedAt': return { node: <span className="text-gray-600">{shippedCell(r)}</span> }
    case 'shipTrackingNo': return { node: shipTrackingCell(r) }
    case 'tags': return { node: tagBadges(r), title: asReceiptTags(r).map((t) => AS_TAG_LABELS[t]).join(', ') || undefined }
    case 'resolvedAt': return { node: r.resolvedAt ? <span className="text-gray-600">{r.resolvedAt.slice(0, 10)}</span> : dash }
    case 'owner': return { node: r.ticket?.owner?.name ? <span className="text-gray-700">{r.ticket.owner.name}</span> : <span className="text-xs text-gray-400">미배정</span> }
    case 'createdBy': return { node: r.createdBy?.name ? <span className="text-gray-700">{r.createdBy.name}</span> : dash }
    case 'reporterName': return { node: r.reporterName ? <span className="text-gray-700">{r.reporterName}</span> : dash, title: r.reporterName ?? undefined }
    // ── 접수정보 ──
    case 'pickupDestDiffers': return { node: r.pickupDestDiffers ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">상이</span> : dash }
    case 'pickupDestInfo': return { node: r.pickupDestInfo ? <span className="text-xs text-gray-700">{r.pickupDestInfo}</span> : dash, title: r.pickupDestInfo ?? undefined }
    case 'destType': return { node: r.destType ? <span className="text-xs text-gray-600">{AS_DEST_TYPE_LABELS[r.destType as AsDestType] ?? r.destType}</span> : dash }
    case 'destInfo': return { node: r.destInfo ? <span className="text-xs text-gray-700">{r.destInfo}</span> : dash, title: r.destInfo ?? undefined }
    case 'expectedShipDate': return { node: r.expectedShipDate ? <span className="text-gray-600">{r.expectedShipDate.slice(0, 10)}</span> : dash }
    case 'note': { const v = r.note?.replace(/\s+/g, ' ').trim(); return { node: v ? <span className="text-xs text-gray-600">{v}</span> : dash, title: r.note ?? undefined } }
    case 'tagPreReplace': return { node: r.preReplace ? <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${AS_TAG_BADGE_CLS.PRE_REPLACE}`}>선교체</span> : dash }
    case 'tagPriorityRepair': return { node: r.priorityRepair ? <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${AS_TAG_BADGE_CLS.PRIORITY_REPAIR}`}>우선수리</span> : dash }
    case 'tagFirmwareUpdate': return { node: r.firmwareUpdate ? <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${AS_TAG_BADGE_CLS.FIRMWARE_UPDATE}`}>펌웨어</span> : dash }
    case 'tagAccessory': return { node: r.accessoryIncluded ? <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${AS_TAG_BADGE_CLS.ACCESSORY}`}>부속품</span> : dash }
    case 'tagCombinedPack': return { node: r.combinedPack ? <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${AS_TAG_BADGE_CLS.COMBINED_PACK}`}>합포장</span> : dash }
    // ── 진행·처리 (라인 집계) ──
    case 'checkedAt': return { node: r.checkedAt ? <span className="text-gray-600">{r.checkedAt.slice(0, 10)}</span> : dash }
    case 'itemCount': return { node: <span className="text-gray-700">{r.items.length}</span> }
    case 'closedCount': { const n = r.items.filter((i) => i.outcome).length; return { node: <span className={n === r.items.length && n > 0 ? 'text-emerald-700' : 'text-gray-700'}>{n}<span className="text-xs text-gray-400">/{r.items.length}</span></span> } }
    case 'repairProgress': { const p = summarizeAsRepairProgress(r.items); return { node: p.repairable ? <span className={p.repaired < p.repairable ? 'text-amber-700' : 'text-emerald-700'}>{p.repaired}<span className="text-xs text-gray-400">/{p.repairable}</span></span> : dash } }
    case 'intakeIssues': return { node: r.intakeIssues > 0 ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">{r.intakeIssues}대</span> : dash }
    case 'serials': { const v = r.items.map((i) => i.serialNo).join(', '); return { node: v ? <span className="font-mono text-xs text-gray-700">{v}</span> : dash, title: v || undefined } }
    case 'newSerials': { const v = r.items.map((i) => i.newSerialNo?.trim()).filter(Boolean).join(', '); return { node: v ? <span className="font-mono text-xs text-gray-700">{v}</span> : dash, title: v || undefined } }
    case 'symptoms': { const v = Array.from(new Set(r.items.map((i) => i.symptom?.replace(/\s+/g, ' ').trim()).filter(Boolean))).join(' / '); return { node: v ? <span className="text-xs text-gray-700">{v}</span> : dash, title: v || undefined } }
    case 'outcomes': { const counts = new Map<string, number>(); for (const i of r.items) if (i.outcome) counts.set(i.outcome, (counts.get(i.outcome) ?? 0) + 1); const v = Array.from(counts).map(([k, n]) => `${AS_OUTCOME_LABELS[k as AsOutcome] ?? k} ${n}`).join(' · '); return { node: v ? <span className="text-xs text-gray-700">{v}</span> : dash, title: v || undefined } }
    case 'shipMethod': { const v = Array.from(new Set(r.items.map((i) => i.shipMethod).filter((m): m is string => !!m))).map((m) => AS_SHIP_METHOD_LABELS[m as AsMethod] ?? m).join(', '); return { node: v ? <span className="text-xs text-gray-600">{v}</span> : dash } }
    case 'sheetDoneSynced': return { node: r.sheetDoneSynced ? <span className="text-xs text-gray-600">{r.sheetDoneSynced}</span> : dash }
    // ── 관리 ──
    case 'ticketCode': return { node: r.ticket ? <span className="font-mono text-xs text-blue-600">{r.ticket.ticketCode}</span> : dash }
    case 'ticketStatus': return { node: r.ticket ? <span className="text-xs text-gray-600">{r.ticket.status}</span> : dash }
    case 'createdAt': return { node: <span className="text-gray-600">{new Date(r.createdAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)}</span> }
    case 'statusChangedAt': return { node: r.statusChangedAt ? <span className="text-gray-600">{new Date(r.statusChangedAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)}</span> : dash }
    default: return { node: dash }
  }
}

/** [열 설정] — 표시할 열 체크(고정 3열은 잠김) + 기본값 복원. 순서·폭은 헤더에서 드래그 */
function ColumnSettingsButton({ prefs, onChange }: { prefs: AsListPrefs; onChange: (p: AsListPrefs) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const shown = new Set(prefs.columns.map((c) => c.key))
  const toggle = (key: string) => {
    const def = AS_LIST_COLUMN_MAP[key]
    if (def.fixed) return
    if (shown.has(key)) onChange({ ...prefs, columns: prefs.columns.filter((c) => c.key !== key) })
    else onChange({ ...prefs, columns: [...prefs.columns, { key, width: def.width }] }) // 새 열은 맨 뒤 — 위치는 헤더 드래그로
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" title="표시할 열 선택 · 순서는 헤더 드래그 · 폭은 헤더 경계 드래그 · [저장]으로 내 설정 저장">
        열 설정 <span className="text-xs text-gray-400">{prefs.columns.length}/{AS_LIST_COLUMNS.length}</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs text-gray-500">표시할 열을 선택하세요. 접수번호·병원명·접수일은 항상 맨 앞에 고정됩니다. 순서는 헤더를 드래그, 폭은 헤더 경계를 드래그해 바꾸고 [저장]을 누르세요.</p>
          <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
            {AS_LIST_COLUMN_GROUPS.map((g) => (
              <div key={g}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g}</p>
                <ul className="space-y-0.5">
                  {AS_LIST_COLUMNS.filter((c) => c.group === g).map((c) => (
                    <li key={c.key}>
                      <label className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-sm ${c.fixed ? 'text-gray-400' : 'cursor-pointer text-gray-800 hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={shown.has(c.key)} disabled={!!c.fixed} onChange={() => toggle(c.key)} className="h-4 w-4 rounded border-gray-300" />
                        {c.label}{c.fixed && <span className="ml-auto text-[10px]">고정</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between border-t border-gray-100 pt-2">
            <button type="button" onClick={() => onChange(defaultAsListPrefs())} className="text-xs text-gray-500 hover:text-gray-800">기본값으로</button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-blue-600 hover:underline">닫기</button>
          </div>
        </div>
      )}
    </div>
  )
}

function AsReceiptListInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [rows, setRows] = useState<AsRow[]>([])
  const [total, setTotal] = useState(0)
  // 필터·페이지는 URL과 동기화 (CX #2 — 상세 진입 후 뒤로가기 시 검색 결과 복원)
  const [page, setPage] = useState(() => Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1))
  const pageSize = 30
  const [loading, setLoading] = useState(true)

  const [from, setFrom] = useState(searchParams.get('from') ?? '')
  const [to, setTo] = useState(searchParams.get('to') ?? '')
  const [statusIds, setStatusIds] = useState<number[]>(() =>
    searchParams.getAll('statusId').map((v) => parseInt(v)).filter((v) => Number.isInteger(v))
  ) // 복수 선택 (2026-09-07) — 빈 배열 = 전체
  const [category, setCategory] = useState(searchParams.get('category') ?? '')
  // 기기군 체크박스 (2026-09-11) — 기본 둘 다 체크(전체). 하나만 체크 시 해당 기기군 라인 보유 접수만. 둘 다 해제 = 전체
  const [ecg, setEcg] = useState(searchParams.get('group') !== 'SPO2')
  const [spo2, setSpo2] = useState(searchParams.get('group') !== 'ECG')
  const group = ecg && !spo2 ? 'ECG' : spo2 && !ecg ? 'SPO2' : ''
  const [needsCheck, setNeedsCheck] = useState(searchParams.get('needsCheck') === '1') // 접수 기기상태 '확인필요' 필터 (2026-09-15)
  const [overdue, setOverdue] = useState(searchParams.get('overdue') === '1') // 접수 2주 경과 미처리 필터 (2026-09-15 — 요약 카드 클릭)
  const [tagFilter, setTagFilter] = useState<AsTag[]>(() => searchParams.getAll('tag').filter((t): t is AsTag => (AS_TAGS as readonly string[]).includes(t))) // 태그 필터 (2026-09-15) — 복수 = AND
  const [shippedFrom, setShippedFrom] = useState(searchParams.get('shippedFrom') ?? '') // 발송일 필터 (CX #9)
  const [shippedTo, setShippedTo] = useState(searchParams.get('shippedTo') ?? '')
  const [receivedFrom, setReceivedFrom] = useState(searchParams.get('receivedFrom') ?? '') // 입고일 필터 (2026-09-16)
  const [receivedTo, setReceivedTo] = useState(searchParams.get('receivedTo') ?? '')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(() => {
    const k = searchParams.get('sort'); const d = searchParams.get('dir')
    return k && (SORT_KEYS as readonly string[]).includes(k) ? { key: k as SortKey, dir: d === 'desc' ? 'desc' : 'asc' } : null
  }) // 정렬 (2026-09-16) — null = 기본(등록 최신순)

  // ── 사용자 열 설정 (2026-10-01, lib/asReceiptColumns) — 서버 user_view_prefs 저장, [저장] 전까지는 화면만 ──
  const [prefs, setPrefs] = useState<AsListPrefs>(defaultAsListPrefs)
  const [savedPrefs, setSavedPrefs] = useState<AsListPrefs>(defaultAsListPrefs)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const dirty = !samePrefs(prefs, savedPrefs)
  useEffect(() => {
    fetch(`/api/me/view-prefs/${AS_LIST_VIEW_KEY}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const p = d?.prefs ? normalizeAsListPrefs(d.prefs) : defaultAsListPrefs()
      setPrefs(p); setSavedPrefs(p)
    }).catch(() => {})
  }, [])
  async function savePrefs() {
    setPrefsSaving(true)
    try {
      const res = await fetch(`/api/me/view-prefs/${AS_LIST_VIEW_KEY}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs }) })
      if (res.ok) setSavedPrefs(prefs)
      else setNotice([`열 설정 저장 실패: ${(await res.json().catch(() => ({}))).error ?? res.status}`])
    } finally { setPrefsSaving(false) }
  }
  const visibleCols = prefs.columns.map((c) => ({ ...AS_LIST_COLUMN_MAP[c.key], width: c.width }))
  const setColWidth = (key: string, width: number) => setPrefs((p) => ({ ...p, columns: p.columns.map((c) => (c.key === key ? { ...c, width } : c)) }))
  /** 헤더 경계 드래그 — 폭 조절 (주간업무 보드 선례) */
  const startResize = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = prefs.columns.find((c) => c.key === key)?.width ?? AS_LIST_COLUMN_MAP[key].width
    const min = AS_LIST_COLUMN_MAP[key].minWidth ?? AS_LIST_COL_MIN
    const onMove = (ev: MouseEvent) => setColWidth(key, Math.min(2000, Math.max(min, startW + ev.clientX - startX)))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = '' }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); document.body.style.cursor = 'col-resize'
  }
  /** 헤더 드래그 — 순서 변경 (고정 3열 제외, 고정 열 앞으로는 못 놓음) */
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const moveColumn = (from: string, to: string) => {
    if (from === to || AS_LIST_COLUMN_MAP[from]?.fixed || AS_LIST_COLUMN_MAP[to]?.fixed) return
    setPrefs((p) => {
      const cols = [...p.columns]
      const fi = cols.findIndex((c) => c.key === from); const ti = cols.findIndex((c) => c.key === to)
      if (fi < 0 || ti < 0) return p
      const [moved] = cols.splice(fi, 1); cols.splice(ti, 0, moved)
      return { ...p, columns: cols }
    })
  }
  const [summary, setSummary] = useState<{
    byStatus: (CodeRef & { count: number })[]
    total: number
    openTotal: number
    thisWeek: number
    avgResolutionDays: number | null
    avgResolution: { normal: { days: number | null; count: number; doneCount: number; openCount: number }; preReplace: { days: number | null; count: number; doneCount: number; openCount: number } }
    overdue2w: number
  } | null>(null)
  const [qInput, setQInput] = useState(searchParams.get('q') ?? '')
  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const [field, setField] = useState<AsSearchField>(() => parseAsSearchField(searchParams.get('field'))) // 검색 항목 (2026-09-18)
  const [createOpen, setCreateOpen] = useState(false)
  const [canWrite, setCanWrite] = useState(false)
  const [notice, setNotice] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set()) // 체크된 접수 id (2026-09-21 — 상태 일괄변경)
  const [bulkStatusId, setBulkStatusId] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [statuses, setStatuses] = useState<CodeRef[]>([]) // AS_STATUS 마스터 (일괄변경 셀렉트)
  const loadSeq = useRef(0) // 필터 연속 변경 시 이전 응답이 최신 화면을 덮지 않도록 (리뷰 결함5)

  const loadSummary = useCallback(() => {
    fetch('/api/as-receipts/summary').then((r) => (r.ok ? r.json() : null)).then((d) => d && setSummary(d))
  }, [])

  useEffect(() => {
    loadSummary()
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setCanWrite(d.role !== 'VIEWER'))
    fetch('/api/settings/as-status').then((r) => (r.ok ? r.json() : null)).then((d) => setStatuses(d?.statusCodes ?? []))
  }, [loadSummary])

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    for (const id of statusIds) params.append('statusId', String(id))
    if (category) params.set('category', category)
    if (group) params.set('group', group)
    for (const t of tagFilter) params.append('tag', t)
    if (overdue) params.set('overdue', '1')
    if (needsCheck) params.set('needsCheck', '1')
    if (shippedFrom) params.set('shippedFrom', shippedFrom)
    if (shippedTo) params.set('shippedTo', shippedTo)
    if (receivedFrom) params.set('receivedFrom', receivedFrom)
    if (receivedTo) params.set('receivedTo', receivedTo)
    if (q) { params.set('q', q); if (field !== 'all') params.set('field', field) }
    return params
  }, [from, to, statusIds, category, group, tagFilter, overdue, needsCheck, shippedFrom, shippedTo, receivedFrom, receivedTo, q, field])

  const hasFilter = !!(from || to || statusIds.length || category || group || tagFilter.length || overdue || needsCheck || shippedFrom || shippedTo || receivedFrom || receivedTo || q)
  const resetFilters = () => {
    setFrom(''); setTo(''); setStatusIds([]); setCategory(''); setEcg(true); setSpo2(true); setTagFilter([]); setOverdue(false); setNeedsCheck(false)
    setShippedFrom(''); setShippedTo(''); setReceivedFrom(''); setReceivedTo(''); setQ(''); setQInput(''); setField('all'); setPage(1)
  }
  // 헤더 클릭: asc → desc → 기본 정렬 해제 (유지보수 목록과 동일 UX)
  const toggleSort = (key: SortKey) => {
    setSort((cur) => (!cur || cur.key !== key ? { key, dir: 'asc' } : cur.dir === 'asc' ? { key, dir: 'desc' } : null))
    setPage(1)
  }

  // 필터·페이지를 URL에 반영 — 뒤로가기 복원용 (CX #2, history만 교체해 리렌더 억제)
  useEffect(() => {
    const params = buildFilterParams()
    if (sort) { params.set('sort', sort.key); params.set('dir', sort.dir) }
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `/as-receipts?${qs}` : '/as-receipts')
    try { window.sessionStorage.setItem(AS_LIST_QS_KEY, qs); window.sessionStorage.setItem(AS_BACK_KEY, 'list') } catch { /* 저장 불가 환경 — 상세 [목록]은 필터 없이 복귀 */ }
  }, [buildFilterParams, page, sort])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    const params = buildFilterParams()
    if (sort) { params.set('sort', sort.key); params.set('dir', sort.dir) }
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    const res = await fetch(`/api/as-receipts?${params.toString()}`)
    if (seq !== loadSeq.current) return // 더 새로운 요청이 나감 — 이 응답 폐기
    if (res.ok) {
      const d = await res.json()
      const list: AsRow[] = d.receipts ?? []
      setRows(list)
      setTotal(d.total ?? 0)
      setSelected((prev) => { const ids = new Set(list.map((r) => r.id)); const next = new Set(Array.from(prev).filter((id) => ids.has(id))); return next.size === prev.size ? prev : next }) // 페이지·필터 이동 시 화면 밖 선택 해제
    }
    setLoading(false)
  }, [buildFilterParams, page, sort])

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = () => setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.id)))
  const toggleOne = (id: number) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  // 상태 일괄변경 (2026-09-21) — 접수별 PUT 단건과 같은 규칙, 결과 요약을 notice로
  const applyBulkStatus = async () => {
    const st = statuses.find((x) => String(x.id) === bulkStatusId)
    if (!st || !selected.size || bulkBusy) return
    if (!confirm(`선택한 ${selected.size}건의 상태를 '${st.name}'(으)로 변경할까요?`)) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/as-receipts/bulk-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: Array.from(selected), statusId: st.id }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice([d.error ?? '일괄변경에 실패했습니다.']); return }
      const lines: string[] = [`상태 일괄변경 '${d.status}' — 변경 ${d.updated.length}건${d.unchanged.length ? ` · 이미 같은 상태 ${d.unchanged.length}건` : ''}${d.skipped.length ? ` · 제외 ${d.skipped.length}건` : ''}`]
      for (const sk of d.skipped as { asCode: string; reason: string }[]) lines.push(`${sk.asCode}: ${sk.reason}`)
      setNotice(lines)
      setSelected(new Set())
      setBulkStatusId('')
      router.refresh()
      void load()
      loadSummary()
    } finally {
      setBulkBusy(false)
    }
  }

  useEffect(() => { void load() }, [load])

  /** [검색]·Enter — 검색어가 바뀌면 상태 갱신(effect가 재조회), 같으면(공란 포함) 목록·요약을 즉시 재조회 (2026-09-18 — 공란 [검색] = 새로고침) */
  const runSearch = () => {
    const next = qInput.trim()
    if (next !== q || page !== 1) { setQ(next); setPage(1); return }
    void load()
    loadSummary()
  }


  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const thClass = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500'

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">AS업무</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            기기 수리·교체(AS) 접수 — 수거 → 입고 → 처리 → 발송을 라인 단위로 관리합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TicketRuleSettingButton refType="AS" />
          {canWrite && (
            <button type="button" onClick={() => setCreateOpen(true)} className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700">
              + 접수
            </button>
          )}
        </div>
      </div>
      <AsTabs />

      {notice && notice.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{notice[0]}</p>
              {notice.length > 1 && (
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
                  {notice.slice(1).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
            <button type="button" onClick={() => setNotice(null)} className="text-xs text-amber-700 hover:underline">닫기</button>
          </div>
        </div>
      )}

      {/* 요약 (2026-09-07) — 상태별 건수·이번 주·평균 처리·2주 경과 */}
      {summary && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 shadow-sm">
              <p className="text-xs text-gray-400">진행 중 / 전체</p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">
                {summary.openTotal.toLocaleString()}
                <span className="ml-1 text-sm font-normal text-gray-400">/ {summary.total.toLocaleString()}건</span>
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 shadow-sm">
              <p className="text-xs text-gray-400">이번 주 접수</p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">{summary.thisWeek.toLocaleString()}<span className="ml-1 text-sm font-normal text-gray-400">건</span></p>
            </div>
            {/* 평균 처리시간 — 일반 AS / 선교체 분리 (2026-09-12 사용자 요청). 툴팁에 각 완료 건수 */}
            <div
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 shadow-sm"
              title={`최근 3개월 접수 건의 평균 경과 일수 — 완료 건은 접수→완료일, 미완료 건은 접수→오늘까지 포함 (취소 제외)\n일반 AS ${summary.avgResolution.normal.count.toLocaleString()}건 (완료 ${summary.avgResolution.normal.doneCount.toLocaleString()} · 미완료 ${summary.avgResolution.normal.openCount.toLocaleString()}) · 선교체 ${summary.avgResolution.preReplace.count.toLocaleString()}건 (완료 ${summary.avgResolution.preReplace.doneCount.toLocaleString()} · 미완료 ${summary.avgResolution.preReplace.openCount.toLocaleString()})`}
            >
              <p className="text-xs text-gray-400">평균 처리시간 <span className="text-gray-300">(최근 3개월 · 미완료 경과 포함)</span></p>
              <div className="mt-0.5 flex items-baseline gap-3">
                <p className="text-lg font-bold text-gray-900">
                  <span className="mr-1 text-xs font-normal text-gray-500">일반</span>
                  {summary.avgResolution.normal.days != null ? summary.avgResolution.normal.days : '-'}
                  <span className="ml-0.5 text-sm font-normal text-gray-400">일</span>
                </p>
                <p className="text-lg font-bold text-amber-800">
                  <span className="mr-1 text-xs font-normal text-amber-700">선교체</span>
                  {summary.avgResolution.preReplace.days != null ? summary.avgResolution.preReplace.days : '-'}
                  <span className="ml-0.5 text-sm font-normal text-amber-700/70">일</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setOverdue((v) => !v); setPage(1) }}
              title={overdue ? '2주 경과 미처리 필터 해제' : '클릭 — 접수 2주 경과 미처리 건만 보기'}
              className={`rounded-lg border px-3.5 py-2.5 text-left shadow-sm transition-colors ${overdue ? 'border-red-500 bg-red-100 ring-2 ring-red-300' : summary.overdue2w > 0 ? 'border-red-200 bg-red-50 hover:bg-red-100' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
            >
              <p className={`text-xs ${summary.overdue2w > 0 ? 'text-red-500' : 'text-gray-400'}`}>접수 2주 경과 미처리{overdue && <span className="ml-1 rounded bg-red-600 px-1 py-0.5 text-[10px] text-white">필터 중</span>}</p>
              <p className={`mt-0.5 text-lg font-bold ${summary.overdue2w > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {summary.overdue2w.toLocaleString()}<span className="ml-1 text-sm font-normal opacity-60">건</span>
              </p>
            </button>
          </div>

          {/* 상태 필터 — 체크박스 칩 (복수 선택) */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => { setStatusIds([]); setPage(1) }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusIds.length === 0 ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              전체 {summary.total.toLocaleString()}
            </button>
            {summary.byStatus.map((st) => {
              const on = statusIds.includes(st.id)
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    setStatusIds((prev) => (prev.includes(st.id) ? prev.filter((x) => x !== st.id) : [...prev, st.id]))
                    setPage(1)
                  }}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  style={on
                    ? { backgroundColor: st.color ?? '#374151', borderColor: st.color ?? '#374151' }
                    : { borderColor: `${st.color ?? '#D1D5DB'}88` }}
                >
                  {on && <span aria-hidden>✓</span>}
                  {st.name} {st.count.toLocaleString()}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DateRangeFilter label="접수일" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(1) }} />
        <DateRangeFilter label="입고일" from={receivedFrom} to={receivedTo} onChange={(f, t) => { setReceivedFrom(f); setReceivedTo(t); setPage(1) }} />
        <DateRangeFilter label="발송일" from={shippedFrom} to={shippedTo} onChange={(f, t) => { setShippedFrom(f); setShippedTo(t); setPage(1) }} />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
          <option value="">구분 전체</option>
          {AS_CATEGORIES.map((c) => <option key={c} value={c}>{AS_CATEGORY_LABELS[c]}</option>)}
        </select>
        <span className="ml-1 inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700">
          <span className="text-xs text-gray-400">기기군</span>
          <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={ecg} onChange={(e) => { setEcg(e.target.checked); setPage(1) }} className="rounded border-gray-300" />심전계</label>
          <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={spo2} onChange={(e) => { setSpo2(e.target.checked); setPage(1) }} className="rounded border-gray-300" />산소포화도</label>
        </span>
        <label className={`ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${needsCheck ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-700'}`} title="접수 기기상태가 '확인필요'(원장 정합 태그 · 입고 대조 미입고·미식별입고 · 중복접수)인 접수만">
          <input type="checkbox" checked={needsCheck} onChange={(e) => { setNeedsCheck(e.target.checked); setPage(1) }} className="rounded border-gray-300" />
          확인필요만
        </label>
        <span className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm">
          <span className="text-xs text-gray-400">태그</span>
          {AS_TAGS.map((t) => {
            const on = tagFilter.includes(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => { setTagFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])); setPage(1) }}
                className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${on ? AS_TAG_BADGE_CLS[t] + ' ring-1 ring-current' : 'bg-gray-100 text-gray-400 hover:text-gray-600'}`}
                title={on ? `${AS_TAG_LABELS[t]} 필터 해제` : `${AS_TAG_LABELS[t]} 접수만 보기 (여러 개 선택 시 모두 해당)`}
              >
                {on && <span aria-hidden>✓ </span>}{AS_TAG_LABELS[t]}
              </button>
            )
          })}
        </span>
        {hasFilter && (
          <button type="button" onClick={resetFilters} className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-800" title="모든 필터 초기화">필터 초기화</button>
        )}
        <div className="flex items-center gap-1.5">
          <select
            value={field}
            onChange={(e) => { setField(parseAsSearchField(e.target.value)); if (q) setPage(1) }}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            title="검색 항목 — 통합검색은 접수번호·고객명·병원명·시리얼·송장·담당자 전부"
          >
            {AS_SEARCH_FIELDS.map((f) => <option key={f} value={f}>{AS_SEARCH_FIELD_LABELS[f]}</option>)}
          </select>
          <input
            type="text"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder={AS_SEARCH_FIELD_PLACEHOLDER[field]}
            title="쉼표(,)로 여러 키워드를 지정하면 하나라도 맞는 접수를 보여줍니다"
            className="w-64 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          />
          <button type="button" onClick={runSearch} className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700">검색</button>
        </div>
        <button
          type="button"
          onClick={() => { window.location.href = `/api/as-receipts/export?${buildFilterParams().toString()}` }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          title="현재 필터 기준 라인 단위 Excel 다운로드"
        >
          Excel
        </button>
        <ColumnSettingsButton prefs={prefs} onChange={setPrefs} />
        <button type="button" onClick={() => setPrefs(defaultAsListPrefs())} disabled={samePrefs(prefs, defaultAsListPrefs())} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40" title="'기본' 프리셋(종전 목록 13열)으로 되돌림 — [저장]을 눌러야 내 설정으로 유지">기본으로</button>
        {dirty && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
            열 설정 변경됨
            <button type="button" onClick={savePrefs} disabled={prefsSaving} className="rounded bg-blue-600 px-2 py-0.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50">{prefsSaving ? '저장 중…' : '저장'}</button>
            <button type="button" onClick={() => setPrefs(savedPrefs)} disabled={prefsSaving} className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-600 hover:bg-gray-50">취소</button>
          </span>
        )}
        <span className="ml-auto text-sm text-gray-500">{total.toLocaleString()}건</span>
      </div>

      {canWrite && selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <span className="font-medium">{selected.size}건 선택</span>
          <span className="text-blue-300">|</span>
          <span className="text-xs text-blue-700">상태 일괄변경</span>
          <select value={bulkStatusId} onChange={(e) => setBulkStatusId(e.target.value)} disabled={bulkBusy} className="rounded-md border border-blue-200 bg-white px-2 py-1 text-sm">
            <option value="">상태 선택</option>
            {statuses.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
          <button type="button" onClick={applyBulkStatus} disabled={!bulkStatusId || bulkBusy || selected.size > AS_BULK_STATUS_MAX} className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50" title={selected.size > AS_BULK_STATUS_MAX ? `한 번에 최대 ${AS_BULK_STATUS_MAX}건` : '선택 건에 상태 적용 (접수별 상태 변경과 같은 규칙 — 티켓 동기화·완료일 자동)'}>
            {bulkBusy ? '변경 중…' : '적용'}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} disabled={bulkBusy} className="ml-auto text-xs text-blue-700 hover:underline">선택 해제</button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <p className="py-16 text-center text-sm text-gray-400">불러오는 중...</p>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">AS접수가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            {/* 사용자 열 설정 (2026-10-01): table-layout fixed + colgroup 폭 — 셀은 말줄임, 헤더 드래그로 순서·경계 드래그로 폭 */}
            <table className="divide-y divide-gray-200 text-sm" style={{ tableLayout: 'fixed', width: visibleCols.reduce((w, c) => w + c.width, canWrite ? 40 : 0) }}>
              <colgroup>
                {canWrite && <col style={{ width: 40 }} />}
                {visibleCols.map((c) => <col key={c.key} style={{ width: c.width }} />)}
              </colgroup>
              <thead className="bg-gray-50">
                <tr>
                  {canWrite && (
                    <th className="px-3 py-2">
                      <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll} className="rounded border-gray-300" title="이 페이지 전체 선택" aria-label="이 페이지 전체 선택" />
                    </th>
                  )}
                  {visibleCols.map((col) => (
                    <th
                      key={col.key}
                      className={`relative select-none ${thClass} ${dropKey === col.key && dragKey && dragKey !== col.key ? 'bg-blue-100' : ''} ${col.fixed ? '' : 'cursor-grab'}`}
                      draggable={!col.fixed}
                      onDragStart={(e) => { if (col.fixed) { e.preventDefault(); return } setDragKey(col.key); e.dataTransfer.effectAllowed = 'move' }}
                      onDragOver={(e) => { if (dragKey && !col.fixed) { e.preventDefault(); if (dropKey !== col.key) setDropKey(col.key) } }}
                      onDragLeave={() => { if (dropKey === col.key) setDropKey(null) }}
                      onDrop={(e) => { e.preventDefault(); if (dragKey) moveColumn(dragKey, col.key); setDragKey(null); setDropKey(null) }}
                      onDragEnd={() => { setDragKey(null); setDropKey(null) }}
                      title={col.fixed ? '고정 열 (폭만 조절 가능)' : '드래그하여 순서 변경 · 오른쪽 경계 드래그로 폭 조절'}
                    >
                      <span className="block truncate">
                        {col.sort ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.sort!)}
                            className={`inline-flex items-center gap-1 whitespace-nowrap uppercase tracking-wider transition-colors ${sort?.key === col.sort ? 'text-blue-600' : 'hover:text-gray-800'}`}
                            title="클릭하여 정렬 (오름차순 → 내림차순 → 기본)"
                          >
                            {col.label}
                            <span className="text-[10px]">{sort?.key === col.sort ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                          </button>
                        ) : col.label}
                      </span>
                      <span className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize select-none hover:bg-blue-300/50" onMouseDown={startResize(col.key)} onClick={(e) => e.stopPropagation()} draggable={false} title={col.minWidth ? `드래그로 폭 조절 (최소 ${col.minWidth}px)` : '드래그로 폭 조절'} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  // 취소 접수 — 접수번호 제외 전 열 취소선 (2026-09-21). 배지(inline-flex)는 text-decoration이 전파되지 않아 자손 전체에 지정
                  const strike = isAsCanceledStatus(r.status) ? ' line-through [&_*]:line-through opacity-60' : ''
                  return (
                    <tr key={r.id} className={`cursor-pointer hover:bg-gray-50 ${selected.has(r.id) ? 'bg-blue-50/60' : ''}`} onClick={() => router.push(`/as-receipts/${r.id}`)}>
                      {canWrite && (
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} className="rounded border-gray-300" aria-label={`${r.asCode} 선택`} />
                        </td>
                      )}
                      {visibleCols.map((col) => {
                        const cell = renderCell(col.key, r)
                        return (
                          <td key={col.key} className={`overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2${col.key === 'asCode' ? '' : strike}`} title={cell.title}>
                            {cell.node}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pager page={page} totalPages={totalPages} total={total} onChange={setPage} className="mt-3" />

      <AsReceiptFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(warnings) => { setNotice(warnings.length ? [`등록 완료 — 경고 ${warnings.length}건`, ...warnings] : null); router.refresh(); void load(); loadSummary() }}
      />
    </div>
  )
}

// useSearchParams 사용 컴포넌트는 Suspense 경계 필요 (Next.js App Router)
export default function AsReceiptListPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-gray-400">불러오는 중...</div>}>
      <AsReceiptListInner />
    </Suspense>
  )
}
