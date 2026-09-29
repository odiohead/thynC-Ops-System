'use client'

/** 채널톡 상담 원본 상세 — 상담 정보 · 고객 · 메시지 타임라인(고객/담당자/봇) · 데스크 딥링크. 읽기 전용 */
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ChatTimeline, { type TimelineMsg } from '@/app/voc/_components/ChatTimeline'
import { CHANNELTALK_STATE_LABEL, CHANNELTALK_HOSPITAL_MATCH_LABEL, VOC_SKIP_LABEL, VOC_LINK_REASON_LABEL, channeltalkDeskChatUrl, type ChanneltalkChatState, type VocSkipReason } from '@/lib/channeltalk/shared'

type Msg = TimelineMsg
interface Chat {
  id: string; channelId: string | null; state: ChanneltalkChatState; assigneeId: string | null; managerIds: string[]; tags: string[]; name: string | null; description: string | null
  contactMediumType: string | null; sourceType: string | null; firstAskText: string | null; firstAskedAt: string | null; openedAt: string | null; closedAt: string | null
  messageCount: number; messagesSyncedAt: string | null; lastSyncedAt: string; hospitalCode: string | null; hospitalMatchSource: string | null; hospitalMatchNote: string | null
  user: { id: string; name: string | null; mobileNumber: string | null; landlineNumber: string | null; email: string | null; opsCode: string | null; hospitalNameRaw: string | null; ward: string | null; address: string | null; tags: string[] } | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  messages: Msg[]
  vocSkipReason: VocSkipReason | null; vocExcludedAt: string | null; vocExcludedBy: { id: string; name: string } | null
  vocLink: { vocId: number; linkReason: string; linkedAt: string; voc: { vocCode: string; title: string } } | null
}
const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')

export default function ChanneltalkChatDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [chat, setChat] = useState<Chat | null>(null)
  const [managerNames, setManagerNames] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [me, setMe] = useState<{ role: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')
  const canWrite = !!me && me.role !== 'VIEWER'

  const load = () => fetch(`/api/channeltalk/chats/${id}`).then(async (r) => {
    if (!r.ok) { setErr((await r.json()).error ?? '오류'); return }
    const d = await r.json(); setChat(d.chat); setManagerNames(d.managerNames ?? {})
  })
  useEffect(() => { fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setMe({ role: d.role })) }, [])
  async function promote() {
    if (!confirm('이 상담으로 VOC를 생성합니다. 진행할까요?')) return
    setBusy(true); setFlash('')
    try {
      const res = await fetch(`/api/channeltalk/chats/${id}/promote`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) { setFlash(d.error ?? '실패'); return }
      setFlash(`${d.vocCode} 생성`); router.refresh(); await load()
    } finally { setBusy(false) }
  }
  async function exclude(excluded: boolean) {
    setBusy(true); setFlash('')
    try {
      const res = await fetch(`/api/channeltalk/chats/${id}/exclude`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ excluded }) })
      const d = await res.json()
      if (!res.ok) { setFlash(d.error ?? '실패'); return }
      router.refresh(); await load()
    } finally { setBusy(false) }
  }

  useEffect(() => {
    fetch(`/api/channeltalk/chats/${id}`).then(async (r) => {
      if (!r.ok) { setErr((await r.json()).error ?? '오류'); return }
      const d = await r.json(); setChat(d.chat); setManagerNames(d.managerNames ?? {})
    })
  }, [id])

  if (err) return <div className="p-8 text-sm text-red-600">{err}</div>
  if (!chat) return <div className="p-8 text-sm text-gray-400">불러오는 중...</div>
  const row = (l: string, v: React.ReactNode) => <div className="flex gap-2 text-sm"><span className="w-20 shrink-0 text-gray-500">{l}</span><span className="min-w-0 break-words text-gray-900">{v ?? '-'}</span></div>

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => router.push('/voc/inbox')} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">← 목록</button>
        <h1 className="text-lg font-bold text-gray-900">{chat.name ?? '채널톡 상담'}</h1>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{CHANNELTALK_STATE_LABEL[chat.state]}</span>
        <a href={channeltalkDeskChatUrl(chat.channelId, chat.id)} target="_blank" rel="noreferrer" className="ml-auto text-sm text-blue-600 hover:underline">채널톡 데스크에서 열기 ↗</a>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">상담</h2>
            <div className="space-y-1">
              {row('인입', kst(chat.firstAskedAt))}{row('열림', kst(chat.openedAt))}{row('종료', kst(chat.closedAt))}
              {row('담당', chat.assigneeId ? managerNames[chat.assigneeId] ?? chat.assigneeId : '-')}
              {row('참여', chat.managerIds.map((m) => managerNames[m] ?? m).join(', ') || '-')}
              {row('태그', chat.tags.length ? <span className="flex flex-wrap gap-1">{chat.tags.map((t) => <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{t}</span>)}</span> : '-')}
              {row('매체', [chat.contactMediumType, chat.sourceType].filter(Boolean).join(' / ') || '-')}
              {row('메시지', `${chat.messageCount}건 (동기화 ${kst(chat.messagesSyncedAt)})`)}
              {row('상담 ID', <span className="font-mono text-xs">{chat.id}</span>)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">고객 · 병원</h2>
            <div className="space-y-1">
              {row('고객', chat.user?.name)}{row('연락처', chat.user?.mobileNumber ?? chat.user?.landlineNumber)}{row('이메일', chat.user?.email)}
              {row('병원(프로필)', chat.user?.hospitalNameRaw)}{row('OpsCode', chat.user?.opsCode)}{row('병동', chat.user?.ward)}{row('주소', chat.user?.address)}
              {row('병원 힌트', chat.hospital ? <>{chat.hospital.hospitalName} <span className="text-xs text-gray-400">({CHANNELTALK_HOSPITAL_MATCH_LABEL[chat.hospitalMatchSource ?? 'none']})</span></> : <span className="text-gray-400">미매칭{chat.hospitalMatchNote ? ` — ${chat.hospitalMatchNote}` : ''}</span>)}
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">VOC</h2>
          {chat.vocLink ? (
            <p className="text-sm text-gray-700">
              <Link href={`/voc/${chat.vocLink.vocId}`} className="font-mono text-blue-600 hover:underline">{chat.vocLink.voc.vocCode}</Link>
              <span className="ml-2 text-gray-900">{chat.vocLink.voc.title}</span>
              <span className="ml-2 text-xs text-gray-400">{VOC_LINK_REASON_LABEL[chat.vocLink.linkReason] ?? chat.vocLink.linkReason} · {kst(chat.vocLink.linkedAt)}</span>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={chat.vocSkipReason ? 'text-gray-500' : 'rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700'}>
                {chat.vocSkipReason ? `자동 승격 제외 — ${VOC_SKIP_LABEL[chat.vocSkipReason]}${chat.vocExcludedBy ? ` (${chat.vocExcludedBy.name})` : ''}` : '자동 승격 대기'}
              </span>
              {canWrite && (
                <>
                  <button type="button" onClick={promote} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">VOC 생성</button>
                  {chat.vocExcludedAt
                    ? <button type="button" onClick={() => exclude(false)} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">제외 해제</button>
                    : <button type="button" onClick={() => exclude(true)} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">자동 승격 제외</button>}
                </>
              )}
              {flash && <span className="text-xs text-gray-500">{flash}</span>}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">대화 ({chat.messages.length})</h2>
          <ChatTimeline messages={chat.messages} managerNames={managerNames} customerName={chat.user?.name ?? null} />
        </div>
        </div>
      </div>
    </div>
  )
}
