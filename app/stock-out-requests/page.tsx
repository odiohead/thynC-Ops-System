'use client'

/**
 * 출고업무 목록 (stock_out_request_design.md §8)
 * 구축 프로젝트 자재 출고요청 — 연결 티켓 refType 'STOCK_OUT'.
 * 생성 진입점은 프로젝트 상세의 [출고요청] 버튼 (목록은 조회·처리 중심 — §2 파생 결정).
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import TicketRuleSettingButton from '@/app/components/TicketRuleSettingButton'

interface CodeRef { id: number; name: string; color: string | null }
interface StockOutRow {
  id: number
  sorCode: string
  requestDate: string
  resolvedAt: string | null
  note: string | null
  createdAt: string
  project: { projectCode: string; projectName: string; hospital: { hospitalCode: string; hospitalName: string } | null } | null
  status: CodeRef | null
  createdBy: { id: string; name: string } | null
  ticket: { id: number; ticketCode: string; status: string; owner: { id: string; name: string } | null } | null
  items: { id: number; quantity: number; item: { id: number; name: string } }[]
}

function kstDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

function itemsSummary(items: StockOutRow['items']): string {
  if (!items.length) return '-'
  const total = items.reduce((s, l) => s + l.quantity, 0)
  const first = `${items[0].item.name} ${items[0].quantity}`
  return items.length > 1 ? `${first} 외 ${items.length - 1}종 · 총 ${total}개` : `${first}`
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

export default function StockOutListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<StockOutRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 30
  const [loading, setLoading] = useState(true)

  const [statuses, setStatuses] = useState<CodeRef[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [statusId, setStatusId] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    fetch('/api/settings/stock-out-status').then((r) => (r.ok ? r.json() : null)).then((d) => setStatuses(d?.statusCodes ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (statusId) params.set('statusId', statusId)
    if (q) params.set('q', q)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    const res = await fetch(`/api/stock-out-requests?${params.toString()}`)
    if (res.ok) {
      const d = await res.json()
      setRows(d.requests ?? [])
      setTotal(d.total ?? 0)
    }
    setLoading(false)
  }, [from, to, statusId, q, page])

  useEffect(() => { void load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const thClass = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500'

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">출고업무</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            구축 프로젝트의 자재 출고요청 — 등록은 프로젝트 상세의 [출고요청] 버튼에서 합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TicketRuleSettingButton refType="STOCK_OUT" />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">희망 출고일</span>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <span className="text-gray-400">~</span>
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <select value={statusId} onChange={(e) => { setStatusId(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
          <option value="">상태 전체</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (setQ(qInput), setPage(1))}
            placeholder="코드·프로젝트·병원 검색"
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
          <p className="py-16 text-center text-sm text-gray-400">출고요청이 없습니다. 프로젝트 상세에서 [출고요청]으로 등록하세요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['요청번호', '프로젝트', '병원', '품목', '희망 출고일', '상태', '담당(티켓)', '요청자', '등록일', '티켓'].map((h) => (
                    <th key={h} className={thClass}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/stock-out-requests/${r.id}`)}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-blue-600">{r.sorCode}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-gray-900">{r.project?.projectName ?? '-'}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-gray-700">{r.project?.hospital?.hospitalName ?? '-'}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2 text-gray-700">{itemsSummary(r.items)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.requestDate.slice(0, 10)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{codeBadge(r.status)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.ticket?.owner?.name ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.createdBy?.name ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">{kstDate(r.createdAt)}</td>
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
    </div>
  )
}
