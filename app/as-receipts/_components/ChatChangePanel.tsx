'use client'

/**
 * 채널톡 변경 감지 패널 (as_channeltalk_intake_design.md §6) — AS 상세 상단. 접수 생성 후 원천 상담이 바뀌어 접수 필드와 달라진 항목을
 * "현재값 / 상담값"으로 보여주고 사람이 고른 항목만 [반영]. 자동 반영 없음.
 */
import { useState } from 'react'
import { channeltalkDeskChatUrl } from '@/lib/channeltalk/shared'
import type { AsIntakeDiffItem } from '@/lib/channeltalk/asIntakeShared'

export interface ChatIntakeInfo { linkId: number; chatId: string; channelId: string | null; changeDetectedAt: string | null; changeDiff: AsIntakeDiffItem[] | null }

export default function ChatChangePanel({ receiptId, intake, canEdit, onDone }: { receiptId: number; intake: ChatIntakeInfo; canEdit: boolean; onDone: (msg: string | null) => void }) {
  const diff = intake.changeDiff ?? []
  const [sel, setSel] = useState<Set<string>>(new Set(diff.map((d) => d.field)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!diff.length) return null
  const kst = intake.changeDetectedAt ? new Date(intake.changeDetectedAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : ''

  async function post(body: unknown) {
    setBusy(true); setErr(null)
    const res = await fetch(`/api/as-receipts/${receiptId}/chat-change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setErr(j.error ?? '처리에 실패했습니다.'); return }
    onDone(j.warnings?.length ? j.warnings.join('\n') : null)
  }

  return (
    <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-orange-800">채널톡 변경 감지 <span className="font-normal text-orange-700">— 접수 후 상담 내용이 바뀌었습니다 ({kst}). 반영할 항목을 고르세요.</span> <a href={channeltalkDeskChatUrl(intake.channelId, intake.chatId)} target="_blank" rel="noreferrer" className="ml-1 text-xs text-blue-600 hover:underline">상담 열기 ↗</a></p>
        {canEdit && (
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => post({ action: 'apply', fields: Array.from(sel) })} disabled={busy || !sel.size} className="rounded-md bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50">선택 반영 ({sel.size})</button>
            <button type="button" onClick={() => post({ action: 'dismiss' })} disabled={busy} className="rounded-md border border-orange-300 bg-white px-3 py-1 text-xs text-orange-800 hover:bg-orange-100 disabled:opacity-50">무시</button>
          </span>
        )}
      </div>
      <table className="mt-2 w-full text-xs">
        <thead><tr className="text-left text-orange-700"><th className="w-6 py-1"></th><th className="py-1">항목</th><th className="py-1">현재 접수값</th><th className="py-1">상담값</th></tr></thead>
        <tbody>
          {diff.map((d) => (
            <tr key={d.field} className="border-t border-orange-100">
              <td className="py-1"><input type="checkbox" checked={sel.has(d.field)} disabled={!canEdit} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(d.field); else n.delete(d.field); return n })} className="h-3.5 w-3.5 rounded border-gray-300" /></td>
              <td className="py-1 font-medium text-gray-800">{d.label}</td>
              <td className="py-1 text-gray-500">{d.current ?? <span className="italic text-gray-400">(없음)</span>}</td>
              <td className="py-1 text-gray-900">{d.chat ?? <span className="italic text-gray-400">(없음)</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  )
}
