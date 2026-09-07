'use client'

/**
 * AS업무 목록 (as_work_design.md §8)
 * 기기 수리·교체(AS) 접수 — 연결 티켓 refType 'AS'. [+ 접수]로 등록 (VIEWER 제외).
 */
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import TicketRuleSettingButton from '@/app/components/TicketRuleSettingButton'
import AsReceiptFormModal from './_components/AsReceiptFormModal'
import { AS_CATEGORIES, AS_CATEGORY_LABELS, summarizeAsItemsByKind, type AsCategory } from '@/lib/asReceiptShared'

interface CodeRef { id: number; name: string; color: string | null }
interface AsRow {
  id: number
  asCode: string
  category: string
  receiptDate: string
  resolvedAt: string | null
  createdAt: string
  hospital: { hospitalCode: string; hospitalName: string } | null
  status: CodeRef | null
  createdBy: { id: string; name: string } | null
  ticket: { id: number; ticketCode: string; status: string; owner: { id: string; name: string } | null } | null
  items: { id: number; serialNo: string; outcome: string | null; deviceKind: string | null; device: { deviceInfo: { deviceName: string } } | null }[]
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
  const [shippedFrom, setShippedFrom] = useState(searchParams.get('shippedFrom') ?? '') // 발송일 필터 (CX #9)
  const [shippedTo, setShippedTo] = useState(searchParams.get('shippedTo') ?? '')
  const [summary, setSummary] = useState<{
    byStatus: (CodeRef & { count: number })[]
    total: number
    openTotal: number
    thisWeek: number
    avgResolutionDays: number | null
    overdue2w: number
  } | null>(null)
  const [qInput, setQInput] = useState(searchParams.get('q') ?? '')
  const [q, setQ] = useState(searchParams.get('q') ?? '')
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
    if (shippedFrom) params.set('shippedFrom', shippedFrom)
    if (shippedTo) params.set('shippedTo', shippedTo)
    if (q) params.set('q', q)
    return params
  }, [from, to, statusIds, category, shippedFrom, shippedTo, q])

  // 필터·페이지를 URL에 반영 — 뒤로가기 복원용 (CX #2, history만 교체해 리렌더 억제)
  useEffect(() => {
    const params = buildFilterParams()
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `/as-receipts?${qs}` : '/as-receipts')
  }, [buildFilterParams, page])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    const params = buildFilterParams()
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
  }, [buildFilterParams, page])

  useEffect(() => { void load() }, [load])

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
            <div className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 shadow-sm">
              <p className="text-xs text-gray-400">평균 처리시간 <span className="text-gray-300">(최근 3개월)</span></p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">
                {summary.avgResolutionDays != null ? summary.avgResolutionDays : '-'}
                <span className="ml-1 text-sm font-normal text-gray-400">일</span>
              </p>
            </div>
            <div className={`rounded-lg border px-3.5 py-2.5 shadow-sm ${summary.overdue2w > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
              <p className={`text-xs ${summary.overdue2w > 0 ? 'text-red-500' : 'text-gray-400'}`}>접수 2주 경과 미처리</p>
              <p className={`mt-0.5 text-lg font-bold ${summary.overdue2w > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {summary.overdue2w.toLocaleString()}<span className="ml-1 text-sm font-normal opacity-60">건</span>
              </p>
            </div>
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
        <span className="text-xs text-gray-400">접수일</span>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <span className="text-gray-400">~</span>
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
          <option value="">구분 전체</option>
          {AS_CATEGORIES.map((c) => <option key={c} value={c}>{AS_CATEGORY_LABELS[c]}</option>)}
        </select>
        <span className="ml-1 text-xs text-gray-400">발송일</span>
        <input type="date" value={shippedFrom} onChange={(e) => { setShippedFrom(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <span className="text-gray-400">~</span>
        <input type="date" value={shippedTo} onChange={(e) => { setShippedTo(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (setQ(qInput), setPage(1))}
            placeholder="코드·병원·시리얼 검색"
            className="w-48 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          />
          <button type="button" onClick={() => { setQ(qInput); setPage(1) }} className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700">검색</button>
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
                  {['접수번호', '병원', '구분', '기기', '상태', '접수일', '담당(티켓)', '등록자', '티켓'].map((h) => (
                    <th key={h} className={thClass}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/as-receipts/${r.id}`)}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-blue-600">{r.asCode}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-gray-900">{r.hospital?.hospitalName ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{AS_CATEGORY_LABELS[r.category as AsCategory] ?? r.category}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{summarizeAsItemsByKind(r.items)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{codeBadge(r.status)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.receiptDate.slice(0, 10)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.ticket?.owner?.name ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.createdBy?.name ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {r.ticket ? (
                        <Link href={`/tickets/${r.ticket.ticketCode}`} className="font-mono text-xs text-blue-600 hover:underline">{r.ticket.ticketCode}</Link>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40">이전</button>
          <span className="text-gray-500">{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40">다음</button>
        </div>
      )}

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
