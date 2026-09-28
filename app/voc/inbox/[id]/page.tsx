'use client'

/** 채널톡 상담 원본 상세 — 상담 정보 · 고객 · 메시지 타임라인(고객/담당자/봇) · 데스크 딥링크. 읽기 전용 */
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CHANNELTALK_STATE_LABEL, CHANNELTALK_PERSON_LABEL, CHANNELTALK_HOSPITAL_MATCH_LABEL, channeltalkDeskChatUrl, type ChanneltalkChatState } from '@/lib/channeltalk/shared'

interface Msg { id: string; personType: string | null; personId: string | null; plainText: string | null; hasFiles: boolean; fileMeta: { name?: string; type?: string; size?: number }[] | null; createdAtCt: string }
interface Chat {
  id: string; channelId: string | null; state: ChanneltalkChatState; assigneeId: string | null; managerIds: string[]; tags: string[]; name: string | null; description: string | null
  contactMediumType: string | null; sourceType: string | null; firstAskText: string | null; firstAskedAt: string | null; openedAt: string | null; closedAt: string | null
  messageCount: number; messagesSyncedAt: string | null; lastSyncedAt: string; hospitalCode: string | null; hospitalMatchSource: string | null; hospitalMatchNote: string | null
  user: { id: string; name: string | null; mobileNumber: string | null; landlineNumber: string | null; email: string | null; opsCode: string | null; hospitalNameRaw: string | null; ward: string | null; address: string | null; tags: string[] } | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  messages: Msg[]
}
const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')
const BUBBLE: Record<string, string> = { user: 'bg-blue-50 border-blue-100', manager: 'bg-white border-gray-200', bot: 'bg-gray-50 border-gray-100 text-gray-500' }

export default function ChanneltalkChatDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [chat, setChat] = useState<Chat | null>(null)
  const [managerNames, setManagerNames] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch(`/api/channeltalk/chats/${id}`).then(async (r) => {
      if (!r.ok) { setErr((await r.json()).error ?? '오류'); return }
      const d = await r.json(); setChat(d.chat); setManagerNames(d.managerNames ?? {})
    })
  }, [id])

  if (err) return <div className="p-8 text-sm text-red-600">{err}</div>
  if (!chat) return <div className="p-8 text-sm text-gray-400">불러오는 중...</div>
  const who = (m: Msg) => m.personType === 'manager' ? managerNames[m.personId ?? ''] ?? '담당자' : m.personType === 'user' ? chat.user?.name ?? '고객' : CHANNELTALK_PERSON_LABEL[m.personType ?? ''] ?? m.personType
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

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">대화 ({chat.messages.length})</h2>
          {chat.messages.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">메시지가 없습니다.</p> : (
            <div className="space-y-2">
              {chat.messages.map((m) => (
                <div key={m.id} className={`rounded-lg border px-3 py-2 ${BUBBLE[m.personType ?? ''] ?? BUBBLE.bot} ${m.personType === 'user' ? 'mr-8' : 'ml-8'}`}>
                  <div className="mb-0.5 flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="font-medium">{who(m)}</span><span>{CHANNELTALK_PERSON_LABEL[m.personType ?? ''] ?? ''}</span><span className="ml-auto">{kst(m.createdAtCt)}</span>
                  </div>
                  {m.plainText && <p className="whitespace-pre-wrap break-words text-sm">{m.plainText}</p>}
                  {m.hasFiles && m.fileMeta && <p className="mt-1 text-xs text-gray-500">📎 {m.fileMeta.map((f) => f.name ?? f.type ?? '파일').join(', ')}</p>}
                  {!m.plainText && !m.hasFiles && <p className="text-xs text-gray-400">(본문 없음)</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
