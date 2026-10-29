'use client'

/**
 * AS 등록대기 큐 목록 (as_channeltalk_intake_design.md §5) — 채널톡 상담에서 자동 생성에 실패한 AS 접수 후보.
 * /as-receipts 우측 상단 [등록대기 N] 버튼으로 진입(nav 미등록). 행 클릭 → 상세(프리필 폼 + 원문).
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AS_INTAKE_FAIL_LABEL, AS_INTAKE_IGNORE_LABEL, type AsIntakeIgnoreReason } from '@/lib/channeltalk/asIntakeShared'
import { AS_CATEGORY_LABELS, type AsCategory } from '@/lib/asReceiptShared'

interface Row {
  id: number; chatId: string; state: string; failClass: string | null; failNote: string | null; extractLayer: string; createdAt: string; decidedAt: string | null; ignoreReason: string | null
  receipt: { id: number; asCode: string } | null; decidedBy: string | null
  chat: { name: string | null; state: string; tags: string[]; at: string | null; assignee: string | null; voc: { id: number; vocCode: string } | null }
  hospitalCode: string | null; hospitalName: string | null; hospitalNameRaw: string | null; category: string | null; serialCount: number; receiptDate: string | null
}

const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')
const STATES = [['PENDING', '등록대기'], ['LINKED', '처리됨'], ['IGNORED', 'AS 아님']] as const

export default function AsIntakeQueuePage() {
  const router = useRouter()
  const [state, setState] = useState<'PENDING' | 'LINKED' | 'IGNORED'>('PENDING')
  const [failClass, setFailClass] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [failCounts, setFailCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ state })
    if (failClass) qs.set('failClass', failClass)
    const res = await fetch(`/api/as-receipts/intake?${qs}`, { cache: 'no-store' })
    const d = res.ok ? await res.json() : { links: [], failCounts: {} }
    setRows(d.links ?? []); setFailCounts(d.failCounts ?? {}); setLoading(false)
  }, [state, failClass])
  useEffect(() => { void load() }, [load])

  const pendingTotal = Object.values(failCounts).reduce((a, b) => a + b, 0)
  const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500'

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          {/* 좌측 상단 복귀 버튼 — 회색 브레드크럼 대체 (2026-10-30 요청) */}
          <div className="mb-2 flex items-center gap-2">
            <Link href="/as-receipts" className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">← AS업무</Link>
          </div>
          <h1 className="text-xl font-bold text-gray-900">AS 등록대기</h1>
          <p className="mt-0.5 text-sm text-gray-500">채널톡 AS 상담 중 자동 접수에 실패한 건입니다. 원문을 보고 빈칸을 채워 [등록]하거나, AS가 아니면 제외하세요.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 text-sm">
          {STATES.map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setState(k); setFailClass('') }} className={`rounded-md px-3 py-1 ${state === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{l}{k === 'PENDING' && pendingTotal > 0 ? ` ${pendingTotal}` : ''}</button>
          ))}
        </div>
      </div>

      {state === 'PENDING' && Object.keys(failCounts).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setFailClass('')} className={`rounded-full px-2.5 py-0.5 text-xs ${!failClass ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>전체 {pendingTotal}</button>
          {Object.entries(failCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <button key={k} type="button" onClick={() => setFailClass(k === failClass ? '' : k)} className={`rounded-full px-2.5 py-0.5 text-xs ${failClass === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} title={AS_INTAKE_FAIL_LABEL[k]}>{AS_INTAKE_FAIL_LABEL[k]?.split(' (')[0] ?? k} {n}</button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? <p className="py-10 text-center text-sm text-gray-400">불러오는 중...</p> : rows.length === 0 ? <p className="py-10 text-center text-sm text-gray-400">항목이 없습니다.</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50"><tr>
                {['상담 일시', '병원', '구분', '기기', '접수일(추출)', state === 'PENDING' ? '실패 사유' : '결과', '채널톡 담당', 'VOC', '상담'].map((h) => <th key={h} className={th}>{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => router.push(`/as-receipts/intake/${r.id}`)}>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{kst(r.chat.at)}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-900">{r.hospitalName ?? <span className="text-red-600">미매칭</span>}</span>
                      {r.hospitalNameRaw && r.hospitalNameRaw !== r.hospitalName && <span className="ml-1 text-xs text-gray-400">&apos;{r.hospitalNameRaw}&apos;</span>}
                      {r.chat.name && <span className="block text-xs text-gray-400">{r.chat.name}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{r.category ? AS_CATEGORY_LABELS[r.category as AsCategory] : '-'}{r.chat.tags.length > 1 && <span className="ml-1 text-xs text-amber-600">혼합</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{r.serialCount}대</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.receiptDate ?? '-'}</td>
                    <td className="px-3 py-2">
                      {state === 'PENDING' ? (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700" title={r.failNote ?? ''}>{r.failClass ? AS_INTAKE_FAIL_LABEL[r.failClass]?.split(' (')[0] ?? r.failClass : '-'}</span>
                      ) : state === 'LINKED' ? (
                        r.receipt ? <Link href={`/as-receipts/${r.receipt.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-blue-600 hover:underline">{r.receipt.asCode}</Link> : '-'
                      ) : (
                        <span className="text-xs text-gray-600">{r.ignoreReason ? AS_INTAKE_IGNORE_LABEL[r.ignoreReason as AsIntakeIgnoreReason] ?? r.ignoreReason : '-'}{r.decidedBy ? ` · ${r.decidedBy}` : ''}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.chat.assignee ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.chat.voc ? <Link href={`/voc/${r.chat.voc.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-blue-600 hover:underline">{r.chat.voc.vocCode}</Link> : <span className="text-xs text-gray-400">-</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{r.chat.state === 'closed' ? '종료' : '진행중'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
