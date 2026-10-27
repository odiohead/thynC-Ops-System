'use client'

/** 채널톡 상담 메시지 타임라인 (고객/담당자/봇 말풍선) — inbox 상세·VOC 상세·AS 등록대기 공용 (2026-09-28). 첨부는 서명 URL 프록시로 미리보기·다운로드 (2026-10-27) */
import { CHANNELTALK_PERSON_LABEL } from '@/lib/channeltalk/shared'

export interface TimelineFile { id?: string; name?: string; type?: string; size?: number; contentType?: string; previewKey?: string; key?: string }
export interface TimelineMsg { id: string; personType: string | null; personId: string | null; plainText: string | null; hasFiles: boolean; fileMeta: TimelineFile[] | null; createdAtCt: string }
const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')
const BUBBLE: Record<string, string> = { user: 'bg-blue-50 border-blue-100', manager: 'bg-white border-gray-200', bot: 'bg-gray-50 border-gray-100 text-gray-500' }
const fmtSize = (n?: number) => (!n ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`)

function Attachment({ chatId, f }: { chatId: string; f: TimelineFile }) {
  if (!f.id || !f.key) return <span className="text-xs text-gray-500">📎 {f.name ?? f.type ?? '파일'}</span>
  const href = `/api/channeltalk/chats/${chatId}/files/${f.id}`
  const isImage = (f.contentType ?? '').startsWith('image/') || f.type === 'image'
  const isVideo = (f.contentType ?? '').startsWith('video/') || f.type === 'video'
  if (isImage) {
    return (
      <a href={href} target="_blank" rel="noreferrer" title={`${f.name ?? ''} ${fmtSize(f.size)} — 새 탭에서 원본`} className="inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={f.previewKey ? `${href}?thumb=1` : href} alt={f.name ?? '첨부 이미지'} loading="lazy" className="max-h-40 max-w-[220px] rounded-md border border-gray-200 object-cover hover:opacity-90" />
      </a>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-50">
      {isVideo ? '🎬' : '📄'} {f.name ?? f.type ?? '파일'}{f.size ? <span className="text-gray-400">({fmtSize(f.size)})</span> : null}
    </a>
  )
}

export default function ChatTimeline({ messages, managerNames, customerName, chatId }: { messages: TimelineMsg[]; managerNames: Record<string, string>; customerName: string | null; chatId?: string }) {
  const who = (m: TimelineMsg) => m.personType === 'manager' ? managerNames[m.personId ?? ''] ?? '담당자' : m.personType === 'user' ? customerName ?? '고객' : CHANNELTALK_PERSON_LABEL[m.personType ?? ''] ?? m.personType
  if (messages.length === 0) return <p className="py-8 text-center text-sm text-gray-400">메시지가 없습니다.</p>
  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <div key={m.id} className={`rounded-lg border px-3 py-2 ${BUBBLE[m.personType ?? ''] ?? BUBBLE.bot} ${m.personType === 'user' ? 'mr-8' : 'ml-8'}`}>
          <div className="mb-0.5 flex items-center gap-2 text-[11px] text-gray-500">
            <span className="font-medium">{who(m)}</span><span>{CHANNELTALK_PERSON_LABEL[m.personType ?? ''] ?? ''}</span><span className="ml-auto">{kst(m.createdAtCt)}</span>
          </div>
          {m.plainText && <p className="whitespace-pre-wrap break-words text-sm">{m.plainText}</p>}
          {m.hasFiles && m.fileMeta && (
            chatId
              ? <div className="mt-1.5 flex flex-wrap gap-1.5">{m.fileMeta.map((f, i) => <Attachment key={f.id ?? i} chatId={chatId} f={f} />)}</div>
              : <p className="mt-1 text-xs text-gray-500">📎 {m.fileMeta.map((f) => f.name ?? f.type ?? '파일').join(', ')}</p>
          )}
          {!m.plainText && !m.hasFiles && <p className="text-xs text-gray-400">(본문 없음)</p>}
        </div>
      ))}
    </div>
  )
}
