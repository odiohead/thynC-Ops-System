'use client'

/**
 * 채널톡 상담 원본 열람 (voc_channeltalk_intake_design.md §5.2) — 읽기 전용, nav 미등록(URL 직접 진입)
 * 상단 요약 한 줄 · 필터(상태·기간·태그·병원 매칭·검색) · 표 · 행 클릭 → 상세(/voc/inbox/[id])
 * 승격([VOC 생성]) 버튼은 다음 단계에서 이 화면에 붙는다.
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Pager from '@/app/components/ui/Pager'
import { CHANNELTALK_STATE_LABEL, CHANNELTALK_HOSPITAL_MATCH_LABEL, type ChanneltalkChatState } from '@/lib/channeltalk/shared'

interface Row {
  id: string; state: ChanneltalkChatState; assigneeName: string | null; tags: string[]; name: string | null; contactMediumType: string | null
  firstAskText: string | null; firstAskedAt: string | null; closedAt: string | null; messageCount: number
  hospitalCode: string | null; hospitalMatchSource: string | null; hospitalMatchNote: string | null
  user: { id: string; name: string | null; hospitalNameRaw: string | null; opsCode: string | null } | null
  hospital: { hospitalCode: string; hospitalName: string } | null
}
const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')
const STATE_CLS: Record<string, string> = { opened: 'bg-green-100 text-green-700', snoozed: 'bg-amber-100 text-amber-700', closed: 'bg-gray-100 text-gray-600' }

export default function ChanneltalkInboxPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([])
  const [summary, setSummary] = useState<{ active: number; today: number; last_synced: string | null } | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = 30
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tag, setTag] = useState('')
  const [match, setMatch] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (state) p.set('state', state); if (from) p.set('from', from); if (to) p.set('to', to)
    if (tag) p.set('tag', tag); if (match) p.set('match', match); if (q) p.set('q', q)
    p.set('page', String(page)); p.set('pageSize', String(pageSize))
    const res = await fetch(`/api/channeltalk/chats?${p}`)
    if (res.ok) { const d = await res.json(); setRows(d.chats ?? []); setTotal(d.total ?? 0); setTags(d.tags ?? []); setSummary(d.summary ?? null) }
    setLoading(false)
  }, [state, from, to, tag, match, q, page])
  useEffect(() => { void load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500'
  const sel = 'rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">채널톡 상담</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            채널톡에서 적재한 상담 원본(읽기 전용)
            {summary && <> · 활성 {summary.active.toLocaleString()} · 오늘 인입 {summary.today.toLocaleString()} · 마지막 동기화 {kst(summary.last_synced)}</>}
          </p>
        </div>
        <Link href="/voc" className="text-sm text-blue-600 hover:underline">VOC 접수 →</Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={state} onChange={(e) => { setState(e.target.value); setPage(1) }} className={sel}>
          <option value="">상태 전체</option><option value="active">활성(진행중·보류)</option><option value="opened">진행중</option><option value="snoozed">보류</option><option value="closed">종료</option>
        </select>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className={sel} />
        <span className="text-gray-400">~</span>
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className={sel} />
        <select value={tag} onChange={(e) => { setTag(e.target.value); setPage(1) }} className={`${sel} max-w-[14rem]`}>
          <option value="">태그 전체</option>
          {tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
        </select>
        <select value={match} onChange={(e) => { setMatch(e.target.value); setPage(1) }} className={sel}>
          <option value="">병원 매칭 전체</option>
          {Object.entries(CHANNELTALK_HOSPITAL_MATCH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <input type="text" value={qInput} onChange={(e) => setQInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setQ(qInput), setPage(1))} placeholder="첫 질문·고객·병원 검색" className="w-48 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
          <button type="button" onClick={() => { setQ(qInput); setPage(1) }} className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700">검색</button>
        </div>
        <span className="ml-auto text-sm text-gray-500">{total.toLocaleString()}건</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading && rows.length === 0 ? <p className="py-16 text-center text-sm text-gray-400">불러오는 중...</p>
          : rows.length === 0 ? <p className="py-16 text-center text-sm text-gray-400">상담이 없습니다.</p> : (
          <div className="overflow-x-auto">
            <table className={`min-w-full divide-y divide-gray-200 text-sm ${loading ? 'opacity-60' : ''}`}>
              <thead className="bg-gray-50"><tr>{['인입', '상태', '고객', '병원', '첫 질문', '태그', '담당', '메시지', '종료'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/voc/inbox/${r.id}`)}>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{kst(r.firstAskedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CLS[r.state]}`}>{CHANNELTALK_STATE_LABEL[r.state]}</span></td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-gray-800" title={r.user?.name ?? ''}>{r.user?.name ?? '-'}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2" title={r.hospitalMatchNote ?? r.user?.hospitalNameRaw ?? ''}>
                      {r.hospital ? <span className="text-gray-900">{r.hospital.hospitalName}</span> : <span className="text-gray-400">{r.user?.hospitalNameRaw ?? '-'}</span>}
                      {r.hospitalMatchSource && r.hospitalMatchSource !== 'opscode' && <span className="ml-1 text-[10px] text-gray-400">{CHANNELTALK_HOSPITAL_MATCH_LABEL[r.hospitalMatchSource]}</span>}
                    </td>
                    <td className="max-w-md truncate px-3 py-2 text-gray-900" title={r.firstAskText ?? ''}>{r.firstAskText ?? <span className="text-gray-300">(고객 발화 없음)</span>}</td>
                    <td className="max-w-[14rem] px-3 py-2"><div className="flex flex-wrap gap-1">{r.tags.map((t) => <span key={t} className="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{t}</span>)}</div></td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.assigneeName ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">{r.messageCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">{kst(r.closedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {totalPages > 1 && <Pager page={page} totalPages={totalPages} onChange={setPage} total={total} className="mt-3" />}
    </div>
  )
}
