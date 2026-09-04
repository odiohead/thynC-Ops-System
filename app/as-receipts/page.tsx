'use client'

/**
 * AS업무 목록 (as_work_design.md §8)
 * 기기 수리·교체(AS) 접수 — 연결 티켓 refType 'AS'. [+ 접수]로 등록 (VIEWER 제외).
 */
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import TicketRuleSettingButton from '@/app/components/TicketRuleSettingButton'
import AsReceiptFormModal from './_components/AsReceiptFormModal'
import { AS_CATEGORIES, AS_CATEGORY_LABELS, summarizeAsItems, type AsCategory } from '@/lib/asReceiptShared'

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
  items: { id: number; serialNo: string; outcome: string | null }[]
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
  const [page, setPage] = useState(1)
  const pageSize = 30
  const [loading, setLoading] = useState(true)

  const [statuses, setStatuses] = useState<CodeRef[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [statusId, setStatusId] = useState('')
  const [category, setCategory] = useState('')
  const [qInput, setQInput] = useState(searchParams.get('q') ?? '')
  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const [createOpen, setCreateOpen] = useState(false)
  const [canWrite, setCanWrite] = useState(false)
  const [notice, setNotice] = useState<string[] | null>(null)

  useEffect(() => {
    fetch('/api/settings/as-status').then((r) => (r.ok ? r.json() : null)).then((d) => setStatuses(d?.statusCodes ?? []))
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setCanWrite(d.role !== 'VIEWER'))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (statusId) params.set('statusId', statusId)
    if (category) params.set('category', category)
    if (q) params.set('q', q)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    const res = await fetch(`/api/as-receipts?${params.toString()}`)
    if (res.ok) {
      const d = await res.json()
      setRows(d.receipts ?? [])
      setTotal(d.total ?? 0)
    }
    setLoading(false)
  }, [from, to, statusId, category, q, page])

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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">접수일</span>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <span className="text-gray-400">~</span>
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <select value={statusId} onChange={(e) => { setStatusId(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
          <option value="">상태 전체</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
          <option value="">구분 전체</option>
          {AS_CATEGORIES.map((c) => <option key={c} value={c}>{AS_CATEGORY_LABELS[c]}</option>)}
        </select>
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
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{summarizeAsItems(r.items)}</td>
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
        onSaved={(warnings) => { setNotice(warnings.length ? warnings : null); router.refresh(); void load() }}
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
