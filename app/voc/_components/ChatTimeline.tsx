'use client'

/** 채널톡 상담 메시지 타임라인 (고객/담당자/봇 말풍선) — inbox 상세·VOC 상세 공용 (2026-09-28) */
import { CHANNELTALK_PERSON_LABEL } from '@/lib/channeltalk/shared'

export interface TimelineMsg { id: string; personType: string | null; personId: string | null; plainText: string | null; hasFiles: boolean; fileMeta: { name?: string; type?: string; size?: number }[] | null; createdAtCt: string }
const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')
const BUBBLE: Record<string, string> = { user: 'bg-blue-50 border-blue-100', manager: 'bg-white border-gray-200', bot: 'bg-gray-50 border-gray-100 text-gray-500' }

export default function ChatTimeline({ messages, managerNames, customerName }: { messages: TimelineMsg[]; managerNames: Record<string, string>; customerName: string | null }) {
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
          {m.hasFiles && m.fileMeta && <p className="mt-1 text-xs text-gray-500">📎 {m.fileMeta.map((f) => f.name ?? f.type ?? '파일').join(', ')}</p>}
          {!m.plainText && !m.hasFiles && <p className="text-xs text-gray-400">(본문 없음)</p>}
        </div>
      ))}
    </div>
  )
}
