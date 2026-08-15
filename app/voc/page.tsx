'use client'

/**
 * VOC 접수 목록 (cs_ticket_workflow_design.md §5)
 * CS 사건의 원본 도메인 레코드 — 연결 티켓(refType 'VOC')이 CS 마스터 티켓.
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import TicketRuleSettingButton from '@/app/components/TicketRuleSettingButton'

interface CodeRef { id: number; name: string; color: string | null }
interface VocReceipt {
  id: number
  vocCode: string
  title: string
  hospitalNameRaw: string | null
  customerName: string | null
  receivedAt: string
  resolvedAt: string | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  channel: CodeRef | null
  vocType: CodeRef | null
  status: CodeRef | null
  createdBy: { id: string; name: string } | null
  ticket: { id: number; ticketCode: string; status: string; owner: { id: string; name: string } | null } | null
}

/** ISO(UTC) → KST 날짜 (UTC slice는 KST 00~09시 접수 건이 하루 전으로 표시됨) */
function kstDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
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

export default function VocListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<VocReceipt[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 30
  const [loading, setLoading] = useState(true)

  const [statuses, setStatuses] = useState<CodeRef[]>([])
  const [types, setTypes] = useState<CodeRef[]>([])

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [statusId, setStatusId] = useState('')
  const [vocTypeId, setVocTypeId] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')

  const [me, setMe] = useState<{ role: string } | null>(null)
  const canWrite = !!me && me.role !== 'VIEWER'

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setMe({ role: d.role }))
    fetch('/api/settings/voc-status').then((r) => (r.ok ? r.json() : null)).then((d) => setStatuses(d?.statusCodes ?? []))
    fetch('/api/settings/voc-type').then((r) => (r.ok ? r.json() : null)).then((d) => setTypes(d?.statusCodes ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (statusId) params.set('statusId', statusId)
    if (vocTypeId) params.set('vocTypeId', vocTypeId)
    if (q) params.set('q', q)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    const res = await fetch(`/api/voc-receipts?${params.toString()}`)
    if (res.ok) {
      const d = await res.json()
      setRows(d.vocReceipts ?? [])
      setTotal(d.total ?? 0)
    }
    setLoading(false)
  }, [from, to, statusId, vocTypeId, q, page])

  useEffect(() => { void load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const thClass = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500'

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">VOC 접수</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            고객 관점의 CS 사건 원본 — 연결 티켓이 CS 마스터 티켓이 되고, 그 아래에 하위 업무 티켓이 붙습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TicketRuleSettingButton refType="VOC" />
          {canWrite && (
            <button
              type="button"
              onClick={() => router.push('/voc/new')}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + VOC 등록
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <span className="text-gray-400">~</span>
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <select value={statusId} onChange={(e) => { setStatusId(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
          <option value="">상태 전체</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={vocTypeId} onChange={(e) => { setVocTypeId(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
          <option value="">분류 전체</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (setQ(qInput), setPage(1))}
            placeholder="제목·고객·병원 검색"
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
          <p className="py-16 text-center text-sm text-gray-400">VOC 접수가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['VOC번호', '접수일', '병원', '고객', '분류', '채널', '제목', '상태', '담당(티켓)', '생성자', '티켓'].map((h) => (
                    <th key={h} className={thClass}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((v) => (
                  <tr key={v.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/voc/${v.id}`)}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-blue-600">{v.vocCode}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{kstDate(v.receivedAt)}</td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-gray-900">{v.hospital?.hospitalName ?? v.hospitalNameRaw ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{v.customerName ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{codeBadge(v.vocType)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{codeBadge(v.channel)}</td>
                    <td className="max-w-sm truncate px-3 py-2 text-gray-900">{v.title}</td>
                    <td className="whitespace-nowrap px-3 py-2">{codeBadge(v.status)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{v.ticket?.owner?.name ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{v.createdBy?.name ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {v.ticket ? (
                        <Link href={`/tickets/${v.ticket.ticketCode}`} className="font-mono text-xs text-blue-600 hover:underline">{v.ticket.ticketCode}</Link>
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
