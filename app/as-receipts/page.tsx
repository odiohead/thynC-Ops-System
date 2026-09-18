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
import { AS_CATEGORIES, AS_CATEGORY_LABELS, AS_REGISTRY_TAG_LABELS, AS_TAGS, AS_TAG_LABELS, AS_TAG_BADGE_CLS, asReceiptTags, asReceiptDeviceStateLabel, summarizeAsItemsByKind, summarizeAsItemsByGroup, summarizeAsItemProductTypes, type AsCategory, type AsRegistryTagSummary, type AsTag, AS_SEARCH_FIELDS, AS_SEARCH_FIELD_LABELS, AS_SEARCH_FIELD_PLACEHOLDER, parseAsSearchField, type AsSearchField } from '@/lib/asReceiptShared'

interface CodeRef { id: number; name: string; color: string | null }
/** 정렬 가능 컬럼 (2026-09-16) — 서버 정렬(`?sort=&dir=`). 계산 컬럼(기기상태·기기·유형·송장·태그)은 정렬 없음 */
type SortKey = 'asCode' | 'hospital' | 'category' | 'status' | 'receiptDate' | 'receivedAt' | 'shippedAt'
const SORT_KEYS: readonly SortKey[] = ['asCode', 'hospital', 'category', 'status', 'receiptDate', 'receivedAt', 'shippedAt']
const COLUMNS: { label: string; sort?: SortKey; cls?: string }[] = [
  { label: '접수번호', sort: 'asCode' },
  { label: '병원', sort: 'hospital' },
  { label: '접수 기기상태' },
  { label: '구분', sort: 'category' },
  { label: '기기' },
  { label: '유형' },
  { label: '상태', sort: 'status' },
  { label: '접수일', sort: 'receiptDate' },
  { label: '입고일', sort: 'receivedAt' },
  { label: '발송일', sort: 'shippedAt' },
  { label: '발송 송장번호' },
  { label: '태그', cls: 'w-[27rem] min-w-[27rem]' },
]

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
  pickupMethod: string | null
  pickupTrackingNo: string | null
  destType: string | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  registryTags: AsRegistryTagSummary[]
  intakeIssues: number // 입고 대조 미입고·미식별입고 라인 수 (2026-09-11)
  status: CodeRef | null
  createdBy: { id: string; name: string } | null
  ticket: { id: number; ticketCode: string; status: string; owner: { id: string; name: string } | null } | null
  items: {
    id: number; serialNo: string; outcome: string | null; deviceKind: string | null; intakeState: string; receivedAt: string | null; shippedAt: string | null; shipTrackingNo: string | null
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

/** 태그 열 (2026-09-15) — 선교체·우선수리·펌웨어 업데이트·부속품 동봉 */
function tagBadges(r: AsRow) {
  const tags = asReceiptTags(r)
  if (!tags.length) return <span className="text-xs text-gray-300">-</span>
  return (
    <span className="inline-flex flex-nowrap gap-1">
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
  const label = asReceiptDeviceStateLabel(r.items.some((i) => !i.outcome), r.registryTags ?? [], r.intakeIssues ?? 0)
  if (!label) return <span className="text-xs text-gray-300">-</span>
  if (label === '정상') return <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700">정상</span>
  const parts = r.registryTags.map((t) => `${t.tag === 'DUPLICATE' ? '' : '원장 '}${AS_REGISTRY_TAG_LABELS[t.tag]} ${t.count}대${t.detail ? ` (${t.detail})` : ''}`) // DUPLICATE(2026-09-18)는 원장 축이 아님
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
  const loadSeq = useRef(0) // 필터 연속 변경 시 이전 응답이 최신 화면을 덮지 않도록 (리뷰 결함5)

  const loadSummary = useCallback(() => {
    fetch('/api/as-receipts/summary').then((r) => (r.ok ? r.json() : null)).then((d) => d && setSummary(d))
  }, [])

  useEffect(() => {
    loadSummary()
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setCanWrite(d.role !== 'VIEWER'))
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
      setRows(d.receipts ?? [])
      setTotal(d.total ?? 0)
    }
    setLoading(false)
  }, [buildFilterParams, page, sort])

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
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

      {notice && notice.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <p className="font-medium">등록 완료 — 경고 {notice.length}건</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
            {notice.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
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
        <span className="ml-auto text-sm text-gray-500">{total.toLocaleString()}건</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <p className="py-16 text-center text-sm text-gray-400">불러오는 중...</p>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">AS접수가 없습니다.{canWrite && ' [+ 접수]로 등록하세요.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col.label} className={`${thClass} ${col.cls ?? ''}`}>
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
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/as-receipts/${r.id}`)}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-blue-600">{r.asCode}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2 text-gray-900" title={r.hospital?.hospitalName ?? undefined}><span className="block min-w-[8rem] max-w-[14rem] truncate">{r.hospital?.hospitalName ?? '-'}</span></td>
                    <td className="whitespace-nowrap px-3 py-2">{deviceStateBadge(r)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CATEGORY_BADGE[r.category] ?? 'bg-gray-100 text-gray-700'}`}>{AS_CATEGORY_LABELS[r.category as AsCategory] ?? r.category}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{deviceCell(r)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{productTypeBadges(r.items)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{codeBadge(r.status)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.receiptDate.slice(0, 10)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{receivedCell(r)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{shippedCell(r)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{shipTrackingCell(r)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{tagBadges(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pager page={page} totalPages={totalPages} total={total} onChange={setPage} className="mt-3" />

      <AsReceiptFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(warnings) => { setNotice(warnings.length ? warnings : null); router.refresh(); void load(); loadSummary() }}
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
