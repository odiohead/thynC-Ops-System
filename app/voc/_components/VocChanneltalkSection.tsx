'use client'

/** VOC 상세 — 연결된 채널톡 상담 섹션 (2026-09-28): 상담 목록(상태·태그·연결 사유) + 선택 상담 타임라인(읽기 전용) + 데스크 딥링크 */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import ChatTimeline, { type TimelineMsg } from './ChatTimeline'
import { CHANNELTALK_STATE_LABEL, VOC_LINK_REASON_LABEL, channeltalkDeskChatUrl, type ChanneltalkChatState } from '@/lib/channeltalk/shared'

export interface LinkedChat { linkReason: string; linkedAt: string; chat: { id: string; channelId: string | null; state: ChanneltalkChatState; tags: string[]; firstAskText: string | null; firstAskedAt: string | null; closedAt: string | null; messageCount: number } }
const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')
const STATE_CLS: Record<string, string> = { opened: 'bg-green-100 text-green-700', snoozed: 'bg-amber-100 text-amber-700', closed: 'bg-gray-100 text-gray-600' }

export default function VocChanneltalkSection({ links, customerName }: { links: LinkedChat[]; customerName: string | null }) {
  const [openId, setOpenId] = useState<string | null>(links[0]?.chat.id ?? null)
  const [msgs, setMsgs] = useState<Record<string, { messages: TimelineMsg[]; managerNames: Record<string, string> }>>({})
  useEffect(() => {
    if (!openId || msgs[openId]) return
    fetch(`/api/channeltalk/chats/${openId}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setMsgs((m) => ({ ...m, [openId]: { messages: d.chat.messages ?? [], managerNames: d.managerNames ?? {} } })))
  }, [openId, msgs])
  if (links.length === 0) return null
  const cur = openId ? msgs[openId] : null
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6">
        <h2 className="text-sm font-semibold text-gray-700">채널톡 상담 ({links.length})</h2>
        <Link href="/voc/inbox" className="text-xs text-blue-600 hover:underline">상담 원본 목록 →</Link>
      </div>
      <ul className="divide-y divide-gray-100">
        {links.map((l) => (
          <li key={l.chat.id} className={`px-4 py-2.5 sm:px-6 ${openId === l.chat.id ? 'bg-gray-50' : ''}`}>
            <button type="button" onClick={() => setOpenId(openId === l.chat.id ? null : l.chat.id)} className="flex w-full flex-wrap items-center gap-2 text-left">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CLS[l.chat.state]}`}>{CHANNELTALK_STATE_LABEL[l.chat.state]}</span>
              <span className="text-xs text-gray-500">{kst(l.chat.firstAskedAt)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{l.chat.firstAskText ?? '(고객 발화 없음)'}</span>
              <span className="text-xs text-gray-400">{l.chat.messageCount}건 · {VOC_LINK_REASON_LABEL[l.linkReason] ?? l.linkReason}</span>
              <a href={channeltalkDeskChatUrl(l.chat.channelId, l.chat.id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-blue-600 hover:underline">데스크 ↗</a>
            </button>
            {l.chat.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{l.chat.tags.map((t) => <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{t}</span>)}</div>}
            {openId === l.chat.id && (
              <div className="mt-3">
                {cur ? <ChatTimeline messages={cur.messages} managerNames={cur.managerNames} customerName={customerName} /> : <p className="text-sm text-gray-400">불러오는 중...</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
