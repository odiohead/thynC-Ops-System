'use client'

/**
 * VOC 접수 상세 (cs_ticket_workflow_design.md §5)
 * CS 사건의 단일 추적점 — 기본 정보 + 처리 결과 + 하위 티켓 현황 + 연결 콜 이력.
 * 하위 티켓 생성(P3)은 마스터 티켓의 parentId로 연결된다.
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import TicketStatusBadge from '@/app/tickets/components/TicketStatusBadge'
import TicketSeverityBadge from '@/app/tickets/components/TicketSeverityBadge'
import TicketRefTypeBadge from '@/app/tickets/components/TicketRefTypeBadge'
import RichTextEditor from '@/app/components/RichTextEditor'
import VocForm, { emptyVocForm, type VocFormValue } from '../_components/VocForm'
import type { TicketStatus, TicketSeverity } from '@prisma/client'
import { TICKET_DOMAIN_META, DOMAIN_REF_TYPES } from '@/lib/ticket-domains/meta'

interface CodeRef { id: number; name: string; color: string | null }
interface ChildTicket {
  id: number
  ticketCode: string
  title: string
  status: TicketStatus
  severity: TicketSeverity
  refType: string | null
  ownerId: string | null
}
interface VocDetail {
  id: number
  vocCode: string
  title: string
  hospitalCode: string | null
  hospitalNameRaw: string | null
  customerName: string | null
  customerPhone: string | null
  channelId: number | null
  vocTypeId: number | null
  statusId: number | null
  content: string | null
  resolution: string | null
  receivedAt: string
  resolvedAt: string | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  channel: CodeRef | null
  vocType: CodeRef | null
  status: CodeRef | null
  createdBy: { id: string; name: string } | null
  ticket: {
    id: number
    ticketCode: string
    status: TicketStatus
    parentId: number | null
    owner: { id: string; name: string } | null
    children: ChildTicket[]
  } | null
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

function fmtDt(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

function isoToLocalInput(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16).replace(' ', 'T')
}

export default function VocDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [voc, setVoc] = useState<VocDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [me, setMe] = useState<{ role: string } | null>(null)
  const canWrite = !!me && me.role !== 'VIEWER'
  const isAdmin = !!me && (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN')

  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<VocFormValue>(emptyVocForm)

  const [resEdit, setResEdit] = useState(false)
  const [resHtml, setResHtml] = useState('')

  const [childMenuOpen, setChildMenuOpen] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setMe({ role: d.role }))
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/voc-receipts/${id}`)
    if (!res.ok) { setError('VOC 접수를 찾을 수 없습니다.'); setLoading(false); return }
    const d = await res.json()
    setVoc(d.vocReceipt)
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  function flash(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  function openEdit() {
    if (!voc) return
    setForm({
      title: voc.title,
      hospitalCode: voc.hospitalCode ?? '',
      hospitalName: voc.hospital?.hospitalName ?? '',
      hospitalNameRaw: voc.hospitalNameRaw ?? '',
      customerName: voc.customerName ?? '',
      customerPhone: voc.customerPhone ?? '',
      channelId: voc.channelId ?? '',
      vocTypeId: voc.vocTypeId ?? '',
      statusId: voc.statusId ?? '',
      receivedAt: isoToLocalInput(voc.receivedAt),
      content: voc.content ?? '',
    })
    setEditOpen(true)
  }

  async function submitEdit() {
    if (!voc) return
    setBusy(true)
    const res = await fetch(`/api/voc-receipts/${voc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        hospitalCode: form.hospitalCode || null,
        hospitalNameRaw: form.hospitalCode ? null : form.hospitalNameRaw || null,
        customerName: form.customerName || null,
        customerPhone: form.customerPhone || null,
        channelId: form.channelId === '' ? null : form.channelId,
        vocTypeId: form.vocTypeId === '' ? null : form.vocTypeId,
        // 빈 선택은 '현재 상태 유지' (undefined) — null을 보내면 상태가 지워진다
        statusId: form.statusId === '' ? undefined : form.statusId,
        receivedAt: form.receivedAt ? `${form.receivedAt}:00+09:00` : undefined,
        content: form.content || null,
      }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '수정에 실패했습니다.'); return }
    setEditOpen(false)
    router.refresh()
    await load()
  }

  async function saveResolution() {
    if (!voc) return
    setBusy(true)
    const res = await fetch(`/api/voc-receipts/${voc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: resHtml || null }),
    })
    setBusy(false)
    if (!res.ok) { flash('처리 결과 저장에 실패했습니다.'); return }
    setResEdit(false)
    router.refresh()
    await load()
  }

  async function removeVoc() {
    if (!voc) return
    if (!confirm(`${voc.vocCode}를 삭제하시겠습니까? 연결된 마스터 티켓도 함께 삭제됩니다.`)) return
    setBusy(true)
    const res = await fetch(`/api/voc-receipts/${voc.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { flash('삭제에 실패했습니다.'); return }
    router.refresh()
    router.push('/voc')
  }

  if (loading) return <div className="py-20 text-center text-sm text-gray-400">불러오는 중...</div>
  if (!voc) return <div className="py-20 text-center text-sm text-gray-400">{error ?? 'VOC 접수를 찾을 수 없습니다.'}</div>

  const ticket = voc.ticket
  // 하위 생성 후보 — 순수 티켓 + childCreate를 선언한 도메인 (레지스트리 순회, P3)
  const childDomains = DOMAIN_REF_TYPES.filter((rt) => TICKET_DOMAIN_META[rt].childCreate)

  const label = 'text-xs font-medium uppercase tracking-wider text-gray-400'

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {/* 헤더 */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/voc" className="text-sm text-gray-400 hover:text-gray-600">VOC 접수</Link>
            <span className="text-gray-300">/</span>
            <span className="font-mono text-sm text-gray-500">{voc.vocCode}</span>
            {codeBadge(voc.status)}
          </div>
          <h1 className="mt-1 text-xl font-bold text-gray-900">{voc.title}</h1>
          {ticket && (
            <p className="mt-1 text-sm text-gray-500">
              마스터 티켓{' '}
              <Link href={`/tickets/${ticket.ticketCode}`} className="font-mono text-blue-600 hover:underline">{ticket.ticketCode}</Link>
              <span className="ml-1.5 align-middle"><TicketStatusBadge status={ticket.status} /></span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {canWrite && !editOpen && (
            <button type="button" onClick={openEdit} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">수정</button>
          )}
          {isAdmin && (
            <button type="button" onClick={removeVoc} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50">삭제</button>
          )}
        </div>
      </div>

      {/* 수정 폼 */}
      {editOpen ? (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <VocForm value={form} onChange={setForm} onSubmit={submitEdit} onCancel={() => setEditOpen(false)} busy={busy} submitLabel="수정 저장" statusEmptyLabel="현재 상태 유지" />
        </div>
      ) : (
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 sm:px-6 sm:py-5 md:grid-cols-4">
            <div>
              <p className={label}>병원</p>
              <p className="mt-1 text-sm text-gray-900">
                {voc.hospital ? (
                  <Link href={`/hospitals/${voc.hospital.hospitalCode}`} className="text-blue-600 hover:underline">{voc.hospital.hospitalName}</Link>
                ) : (
                  voc.hospitalNameRaw ?? '-'
                )}
              </p>
            </div>
            <div>
              <p className={label}>고객</p>
              <p className="mt-1 text-sm text-gray-900">
                {voc.customerName ?? '-'}
                {voc.customerPhone && <span className="ml-1.5 text-xs text-gray-400">{voc.customerPhone}</span>}
              </p>
            </div>
            <div>
              <p className={label}>분류 · 채널</p>
              <p className="mt-1 flex items-center gap-1.5">{codeBadge(voc.vocType)}{codeBadge(voc.channel)}</p>
            </div>
            <div>
              <p className={label}>담당 (티켓) · 생성자</p>
              <p className="mt-1 text-sm text-gray-900">
                {ticket?.owner?.name ?? '미배정'}
                <span className="ml-1.5 text-xs text-gray-400">· 생성 {voc.createdBy?.name ?? '-'}</span>
              </p>
            </div>
            <div>
              <p className={label}>접수 일시</p>
              <p className="mt-1 text-sm text-gray-900">{fmtDt(voc.receivedAt)}</p>
            </div>
            <div>
              <p className={label}>완료일</p>
              <p className="mt-1 text-sm text-gray-900">{voc.resolvedAt ? voc.resolvedAt.slice(0, 10) : '-'}</p>
            </div>
          </div>
          {voc.content && (
            <div className="border-t border-gray-100 px-4 py-4 sm:px-6">
              <p className={label}>내용</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{voc.content}</p>
            </div>
          )}
        </div>
      )}

      {/* 처리 결과 (Tiptap — 유지보수 resolution 선례) */}
      <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 className="text-sm font-semibold text-gray-700">처리 결과</h2>
          {canWrite && !resEdit && (
            <button type="button" onClick={() => { setResHtml(voc.resolution ?? ''); setResEdit(true) }} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
              {voc.resolution ? '편집' : '작성'}
            </button>
          )}
        </div>
        {resEdit ? (
          <div className="p-4 sm:p-6">
            <RichTextEditor value={resHtml} onChange={setResHtml} placeholder="처리 결과 요약 (회신 내용 포함)" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setResEdit(false)} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">취소</button>
              <button type="button" onClick={saveResolution} disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">저장</button>
            </div>
          </div>
        ) : voc.resolution ? (
          <div className="prose prose-sm max-w-none px-4 py-4 text-sm sm:px-6" dangerouslySetInnerHTML={{ __html: voc.resolution }} />
        ) : (
          <p className="px-4 py-4 text-sm text-gray-400 sm:px-6">아직 처리 결과가 없습니다.</p>
        )}
      </div>

      {/* 하위 티켓 (마스터 티켓 기준 — P3) */}
      {ticket && (
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 sm:px-6">
            <h2 className="text-sm font-semibold text-gray-700">
              하위 티켓
              <span className="ml-1 font-normal text-gray-400">{ticket.children.length}건</span>
            </h2>
            {canWrite && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setChildMenuOpen((v) => !v)}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  + 하위 티켓 생성
                </button>
                {childMenuOpen && (
                  <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50"
                      onClick={() => router.push(`/tickets/new?parentId=${ticket.id}`)}
                    >
                      순수 티켓
                    </button>
                    {childDomains.map((rt) => (
                      <button
                        key={rt}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50"
                        onClick={() => router.push(`${TICKET_DOMAIN_META[rt].childCreate!.formPath}?parentTicketId=${ticket.id}`)}
                      >
                        {TICKET_DOMAIN_META[rt].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {ticket.children.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-400 sm:px-6">하위 티켓이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {ticket.children.map((c) => (
                <li key={c.id}>
                  <Link href={`/tickets/${c.ticketCode}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-gray-50 sm:px-6">
                    <span className="font-mono text-xs text-blue-600">{c.ticketCode}</span>
                    <TicketRefTypeBadge refType={c.refType} fallback={<span className="text-xs text-gray-300">순수</span>} />
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{c.title}</span>
                    <TicketSeverityBadge severity={c.severity} short />
                    <TicketStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

    </div>
  )
}
