'use client'

/**
 * 출고요청 상세 (stock_out_request_design.md §8)
 * 상태 변경(도메인→티켓 동기화)·수정 모달·삭제(티켓 동반) — 권한: 설계 §2-6.
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import TicketStatusBadge from '@/app/tickets/components/TicketStatusBadge'
import StockOutRequestFormModal, { type StockOutEditTarget } from '../_components/StockOutRequestFormModal'
import FulfillCard from '../_components/FulfillCard'
import type { TicketStatus } from '@prisma/client'

interface CodeRef { id: number; name: string; color: string | null }
interface FulfillTx {
  id: number
  txCode: string
  txType: string
  quantity: number
  lotNo: string | null
  txDate: string
  canceledAt: string | null
  item: { name: string }
  inventory: { name: string }
}

interface StockOutDetail {
  id: number
  sorCode: string
  requestDate: string
  note: string | null
  resolvedAt: string | null
  createdAt: string
  fulfilledAt: string | null
  fulfilledBy: { id: string; name: string } | null
  transactions: FulfillTx[]
  project: { projectCode: string; projectName: string; hospital: { hospitalCode: string; hospitalName: string } | null } | null
  status: (CodeRef & { ticketStatus: TicketStatus | null }) | null
  createdBy: { id: string; name: string } | null
  ticket: { id: number; ticketCode: string; status: TicketStatus; owner: { id: string; name: string } | null } | null
  items: { id: number; itemId: number; quantity: number; fulfilledSerials: string | null; item: { id: number; name: string; itemGroup: string } }[]
}

const GROUP_LABELS: Record<string, string> = { SYSTEM: '시스템', WEARABLE: '웨어러블 디바이스' }

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

function fmtDt(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function StockOutDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [req, setReq] = useState<StockOutDetail | null>(null)
  const [statuses, setStatuses] = useState<CodeRef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const [me, setMe] = useState<{ id: string; role: string } | null>(null)
  const [canManage, setCanManage] = useState(false) // 재고 처리 권한 (출고 처리 카드 게이트)

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setMe({ id: d.id ?? d.userId ?? '', role: d.role }))
    fetch('/api/settings/stock-out-status').then((r) => (r.ok ? r.json() : null)).then((d) => setStatuses(d?.statusCodes ?? []))
    fetch('/api/inventory/can-manage').then((r) => (r.ok ? r.json() : null)).then((d) => setCanManage(!!d?.canManage))
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/stock-out-requests/${id}`)
    if (!res.ok) { setError('출고요청을 찾을 수 없습니다.'); setLoading(false); return }
    const d = await res.json()
    setReq(d.stockOutRequest)
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  function flash(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  const isAdmin = !!me && (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN')
  const isTerminal = req?.status?.ticketStatus === 'RESOLVED' || req?.status?.ticketStatus === 'CLOSED'
  // 서버 canEditStockOutRequest와 동일 판정 (설계 §2-6)
  const canEdit = !!me && !!req && (isAdmin || (me.role !== 'VIEWER' && req.createdBy?.id === me.id && !isTerminal))

  async function changeStatus(statusId: number) {
    if (!req) return
    setBusy(true)
    const res = await fetch(`/api/stock-out-requests/${req.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusId }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '상태 변경에 실패했습니다.'); return }
    router.refresh()
    await load()
  }

  async function remove() {
    if (!req) return
    if (!confirm(`${req.sorCode}를 삭제하시겠습니까? 연결된 티켓도 함께 삭제됩니다.`)) return
    setBusy(true)
    const res = await fetch(`/api/stock-out-requests/${req.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '삭제에 실패했습니다.'); return }
    router.refresh()
    router.push('/stock-out-requests')
  }

  if (loading) return <div className="py-20 text-center text-sm text-gray-400">불러오는 중...</div>
  if (!req) return <div className="py-20 text-center text-sm text-gray-400">{error ?? '출고요청을 찾을 수 없습니다.'}</div>

  const label = 'text-xs font-medium uppercase tracking-wider text-gray-400'
  const totalQty = req.items.reduce((s, l) => s + l.quantity, 0)

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {/* 헤더 */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/stock-out-requests" className="text-sm text-gray-400 hover:text-gray-600">출고업무</Link>
            <span className="text-gray-300">/</span>
            <span className="font-mono text-sm text-gray-500">{req.sorCode}</span>
            {codeBadge(req.status)}
          </div>
          <h1 className="mt-1 text-xl font-bold text-gray-900">{req.project?.projectName ?? '-'}</h1>
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
              onChange={(e) => e.target.value && changeStatus(Number(e.target.value))}
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
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 sm:px-6 sm:py-5 md:grid-cols-4">
          <div>
            <p className={label}>프로젝트</p>
            <p className="mt-1 text-sm text-gray-900">
              {req.project ? (
                <Link href={`/projects/${req.project.projectCode}`} className="text-blue-600 hover:underline">{req.project.projectName}</Link>
              ) : '-'}
            </p>
          </div>
          <div>
            <p className={label}>병원</p>
            <p className="mt-1 text-sm text-gray-900">
              {req.project?.hospital ? (
                <Link href={`/hospitals/${req.project.hospital.hospitalCode}`} className="text-blue-600 hover:underline">{req.project.hospital.hospitalName}</Link>
              ) : '-'}
            </p>
          </div>
          <div>
            <p className={label}>희망 출고일</p>
            <p className="mt-1 text-sm text-gray-900">{req.requestDate.slice(0, 10)}</p>
          </div>
          <div>
            <p className={label}>완료일</p>
            <p className="mt-1 text-sm text-gray-900">{req.resolvedAt ? req.resolvedAt.slice(0, 10) : '-'}</p>
          </div>
          <div>
            <p className={label}>담당 (티켓)</p>
            <p className="mt-1 text-sm text-gray-900">{req.ticket?.owner?.name ?? '미배정'}</p>
          </div>
          <div>
            <p className={label}>요청자</p>
            <p className="mt-1 text-sm text-gray-900">{req.createdBy?.name ?? '-'}</p>
          </div>
          <div className="md:col-span-2">
            <p className={label}>등록 일시</p>
            <p className="mt-1 text-sm text-gray-900">{fmtDt(req.createdAt)}</p>
          </div>
        </div>
        {req.note && (
          <div className="border-t border-gray-100 px-4 py-4 sm:px-6">
            <p className={label}>비고</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{req.note}</p>
          </div>
        )}
      </div>

      {/* 품목 라인 */}
      <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 className="text-sm font-semibold text-gray-700">출고 품목</h2>
          <span className="text-xs text-gray-400">{req.items.length}종 · 총 {totalQty}개</span>
        </div>
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">그룹</th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">품목</th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 sm:pr-6">수량</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {req.items.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500 sm:px-6">{GROUP_LABELS[l.item.itemGroup] ?? l.item.itemGroup}</td>
                <td className="px-4 py-2 text-gray-900">
                  {l.item.name}
                  {l.fulfilledSerials && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">처리 시리얼 {l.fulfilledSerials.split('\n').filter(Boolean).length}건</summary>
                      <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 font-mono text-xs text-gray-600">{l.fulfilledSerials}</pre>
                    </details>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-medium text-gray-900 sm:pr-6">{l.quantity.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 출고 처리 (P2 — 자재담당자, stock_out_request_design.md §13) */}
      {canManage && !req.fulfilledAt && !isTerminal && (
        <FulfillCard requestId={req.id} onDone={() => { router.refresh(); void load() }} />
      )}

      {/* 처리 내역 (P2) */}
      {req.fulfilledAt && (
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6">
            <h2 className="text-sm font-semibold text-gray-700">출고 처리 내역</h2>
            <span className="text-xs text-gray-400">
              {req.fulfilledBy?.name ?? '-'} · {fmtDt(req.fulfilledAt)}
            </span>
          </div>
          {req.transactions.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-400 sm:px-6">연결된 전표가 없습니다.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['전표', '인벤토리', '품목', 'LOT', '수량', '출고일'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {req.transactions.map((t) => (
                  <tr key={t.id} className={t.canceledAt ? 'text-gray-400 line-through' : ''}>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs sm:px-6">
                      <Link href={`/inventory/transactions/${t.id}`} className="text-blue-600 hover:underline no-underline">{t.txCode}</Link>
                      {t.canceledAt && <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-600 no-underline">취소됨</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">{t.inventory.name}</td>
                    <td className="px-4 py-2">{t.item.name}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs">{t.lotNo || '-'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">{t.quantity.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">{t.txDate.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 수정 모달 */}
      {req.project && (
        <StockOutRequestFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => { router.refresh(); void load() }}
          project={{ projectCode: req.project.projectCode, projectName: req.project.projectName, hospitalName: req.project.hospital?.hospitalName }}
          editTarget={{
            id: req.id,
            sorCode: req.sorCode,
            requestDate: req.requestDate.slice(0, 10),
            note: req.note,
            items: req.items.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
          } satisfies StockOutEditTarget}
        />
      )}
    </div>
  )
}
