'use client'

/**
 * VOC 등록대기 큐 목록 (projects/voc_sheet_import_design.md §4) — 자동 생성 못 한 VOC 후보(시트 적재 잔여·채널톡 미승격 상담).
 * /voc 우측 상단 [등록대기 N] 버튼으로 진입(nav 미등록). 행 클릭 → 상세(프리필 폼 + 원문).
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { VOC_INTAKE_FAIL_LABEL, VOC_INTAKE_IGNORE_LABEL, VOC_INTAKE_SOURCE_LABEL, type VocIntakeIgnoreReason, type VocIntakeSource } from '@/lib/vocIntakeShared'

interface Row {
  id: number; source: VocIntakeSource; chatId: string | null; sourceRef: string | null; state: string; failClass: string | null; failNote: string | null; createdAt: string; decidedAt: string | null; ignoreReason: string | null
  voc: { id: number; vocCode: string } | null; decidedBy: string | null
  receivedAt: string | null; title: string | null; tag: string | null; statusName: string | null; registrantName: string | null
  hospitalCode: string | null; hospitalName: string | null; hospitalNameRaw: string | null; sheetRow: number | null
  chat: { name: string | null; state: string; tags: string[] } | null
}

const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')
const STATES = [['PENDING', '등록대기'], ['REGISTERED', '등록됨'], ['IGNORED', 'VOC 아님']] as const

export default function VocIntakeQueuePage() {
  const router = useRouter()
  const [state, setState] = useState<'PENDING' | 'REGISTERED' | 'IGNORED'>('PENDING')
  const [failClass, setFailClass] = useState('')
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [failCounts, setFailCounts] = useState<Record<string, number>>({})
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ state })
    if (failClass) qs.set('failClass', failClass)
    if (source) qs.set('source', source)
    const res = await fetch(`/api/voc-receipts/intake?${qs}`, { cache: 'no-store' })
    const d = res.ok ? await res.json() : { items: [], failCounts: {}, sourceCounts: {} }
    setRows(d.items ?? []); setFailCounts(d.failCounts ?? {}); setSourceCounts(d.sourceCounts ?? {}); setLoading(false)
  }, [state, failClass, source])
  useEffect(() => { void load() }, [load])

  const pendingTotal = Object.values(failCounts).reduce((a, b) => a + b, 0)
  const th = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500'
  const chip = (active: boolean) => `rounded-full px-2.5 py-0.5 text-xs ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Link href="/voc" className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">← VOC 접수</Link>
          </div>
          <h1 className="text-xl font-bold text-gray-900">VOC 등록대기</h1>
          <p className="mt-0.5 text-sm text-gray-500">자동으로 VOC를 만들지 못한 건입니다. 병원·분류 등 빈칸을 채워 [VOC 등록]하거나, VOC가 아니면 제외하세요.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 text-sm">
          {STATES.map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setState(k); setFailClass('') }} className={`rounded-md px-3 py-1 ${state === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{l}{k === 'PENDING' && pendingTotal > 0 ? ` ${pendingTotal}` : ''}</button>
          ))}
        </div>
      </div>

      {state === 'PENDING' && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => { setFailClass(''); setSource('') }} className={chip(!failClass && !source)}>전체 {pendingTotal}</button>
          {Object.entries(sourceCounts).map(([k, n]) => (
            <button key={k} type="button" onClick={() => setSource(k === source ? '' : k)} className={chip(source === k)}>{VOC_INTAKE_SOURCE_LABEL[k as VocIntakeSource] ?? k} {n}</button>
          ))}
          <span className="mx-1 text-gray-300">|</span>
          {Object.entries(failCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <button key={k} type="button" onClick={() => setFailClass(k === failClass ? '' : k)} className={chip(failClass === k)} title={VOC_INTAKE_FAIL_LABEL[k]}>{VOC_INTAKE_FAIL_LABEL[k]?.split(' (')[0] ?? k} {n}</button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? <p className="py-10 text-center text-sm text-gray-400">불러오는 중...</p> : rows.length === 0 ? <p className="py-10 text-center text-sm text-gray-400">항목이 없습니다.</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50"><tr>
                {['접수 일시', '병원', '분류', '제목', '출처', state === 'PENDING' ? '사유' : '결과', '등록자(시트)'].map((h) => <th key={h} className={th}>{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => router.push(`/voc/intake/${r.id}`)}>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{kst(r.receivedAt)}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-900">{r.hospitalName ?? <span className="text-red-600">미식별</span>}</span>
                      {r.hospitalNameRaw && r.hospitalNameRaw !== r.hospitalName && <span className="ml-1 text-xs text-gray-400">&apos;{r.hospitalNameRaw}&apos;</span>}
                      {r.chat?.name && <span className="block text-xs text-gray-400">{r.chat.name}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{r.tag ?? <span className="text-gray-300">-</span>}</td>
                    <td className="max-w-md truncate px-3 py-2 text-gray-900" title={r.title ?? ''}>{r.title ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{r.source === 'SHEET' ? `시트 r${r.sheetRow ?? ''}` : `채널톡${r.chat ? (r.chat.state === 'closed' ? ' · 종료' : ' · 진행중') : ''}`}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {state === 'PENDING' ? (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700" title={r.failNote ?? ''}>{r.failClass ? VOC_INTAKE_FAIL_LABEL[r.failClass]?.split(' (')[0] ?? r.failClass : '-'}</span>
                      ) : state === 'REGISTERED' ? (
                        r.voc ? <Link href={`/voc/${r.voc.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-blue-600 hover:underline">{r.voc.vocCode}</Link> : '-'
                      ) : (
                        <span className="text-xs text-gray-600">{r.ignoreReason ? VOC_INTAKE_IGNORE_LABEL[r.ignoreReason as VocIntakeIgnoreReason] ?? r.ignoreReason : '-'}{r.decidedBy ? ` · ${r.decidedBy}` : ''}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.registrantName ?? '-'}</td>
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
