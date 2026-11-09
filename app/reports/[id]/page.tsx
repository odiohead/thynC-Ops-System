'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ReportDoc } from '@/lib/report/doc'
import { DEFAULT_DOC_NUMBER } from '@/lib/report/doc'
import ReportView from '../_components/ReportView'

/** 보고서 보기 — 웹 미리보기 + Word 다운로드 · 다시 생성 · AI만 다시 실행 · 문서번호 (§4) */

interface Detail {
  id: string
  status: 'COLLECTING' | 'ANALYZING' | 'DONE' | 'FAILED'
  aiState: 'running' | 'done' | 'failed'
  error: string | null
  aiError: string | null
  model: string | null
  effort: string | null
  docNumber: string | null
  hospitalCode: string
  hospitalName: string
  createdAt: string
  tokens: { input: number; output: number }
  doc: ReportDoc | null
}

const STEPS = [
  { key: 'COLLECTING', label: '데이터 수집' },
  { key: 'ANALYZING', label: 'AI 분석' },
  { key: 'DONE', label: '완료' },
]

export default function ReportDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [notFound, setNotFound] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [docNumber, setDocNumber] = useState('')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/reports/${params.id}`, { cache: 'no-store' })
    if (!res.ok) {
      setNotFound(res.status === 403 ? '레포트는 최고관리자만 사용할 수 있습니다.' : '보고서를 찾을 수 없습니다.')
      return
    }
    const j: Detail = await res.json()
    setD(j)
    setDocNumber((prev) => (prev === '' ? j.docNumber ?? '' : prev))
  }, [params.id])

  useEffect(() => { load() }, [load])
  const running = d?.status === 'COLLECTING' || d?.status === 'ANALYZING'
  useEffect(() => {
    if (!running) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [running, load])

  const regenerate = async () => {
    if (!d) return
    setBusy('regen')
    setMsg(null)
    const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hospitalCode: d.hospitalCode, docNumber: d.docNumber }) })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setMsg({ type: 'err', text: j.error || '다시 생성하지 못했습니다.' }); return }
    router.refresh()
    router.push(`/reports/${j.id}`)
  }

  const retryAi = async () => {
    setBusy('ai')
    setMsg(null)
    const res = await fetch(`/api/reports/${params.id}/retry-ai`, { method: 'POST' })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setMsg({ type: 'err', text: j.error || 'AI 재실행에 실패했습니다.' }); return }
    router.refresh()
    await load()
  }

  const saveDocNumber = async () => {
    setBusy('doc')
    setMsg(null)
    const res = await fetch(`/api/reports/${params.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docNumber }) })
    setBusy(null)
    if (!res.ok) { setMsg({ type: 'err', text: '문서번호를 저장하지 못했습니다.' }); return }
    router.refresh()
    setMsg({ type: 'ok', text: '문서번호를 저장했습니다.' })
    await load()
  }

  if (notFound) return <div className="p-6 text-sm text-muted-foreground">{notFound} <Link href="/reports" className="underline">목록으로</Link></div>
  if (!d) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>

  const stepIdx = d.status === 'FAILED' ? -1 : STEPS.findIndex((s) => s.key === d.status)
  const docNumberDirty = docNumber.trim() !== (d.docNumber ?? '')

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link href="/reports" className="text-xs text-muted-foreground hover:underline">← 레포트</Link>
          <h1 className="truncate text-xl font-bold text-foreground">{d.hospitalName} 고객 운영 이력 레포트</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={running ? undefined : `/api/reports/${d.id}/docx`}
            aria-disabled={running}
            className={`rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white ${running || !d.doc ? 'pointer-events-none opacity-50' : ''}`}
          >
            Word 다운로드
          </a>
          {d.status === 'DONE' && d.aiState === 'failed' && (
            <button onClick={retryAi} disabled={!!busy} className="rounded-md border px-3 py-1.5 text-sm text-foreground disabled:opacity-50">
              {busy === 'ai' ? '요청 중…' : 'AI 다시 실행'}
            </button>
          )}
          <button onClick={regenerate} disabled={!!busy || running} className="rounded-md border px-3 py-1.5 text-sm text-foreground disabled:opacity-50">
            {busy === 'regen' ? '요청 중…' : '다시 생성'}
          </button>
        </div>
      </div>

      {/* 진행 단계 / 메타 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-2.5 text-sm">
        {d.status === 'FAILED' ? (
          <span className="text-red-600">생성 실패 — {d.error ?? '알 수 없는 오류'}</span>
        ) : (
          <ol className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <li key={s.key} className={`flex items-center gap-1 ${i <= stepIdx ? 'text-foreground' : 'text-muted-foreground'}`}>
                <span className={`inline-block h-2 w-2 rounded-full ${i < stepIdx || d.status === 'DONE' ? 'bg-green-500' : i === stepIdx ? 'animate-pulse bg-blue-500' : 'bg-muted-foreground/30'}`} />
                {s.label}
                {i < STEPS.length - 1 && <span className="text-muted-foreground">›</span>}
              </li>
            ))}
          </ol>
        )}
        {d.aiError && <span className="text-amber-700">AI 분석 실패 — {d.aiError}</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          <span className="font-mono">{d.model ?? '—'} · {d.effort ?? '—'}</span>
          {d.tokens.input ? ` · 입력 ${d.tokens.input.toLocaleString()} / 출력 ${d.tokens.output.toLocaleString()} 토큰` : ''}
        </span>
      </div>

      {/* 문서번호 (D1) */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label className="text-muted-foreground" htmlFor="docnum">문서번호</label>
        <input
          id="docnum"
          value={docNumber}
          onChange={(e) => setDocNumber(e.target.value)}
          placeholder={DEFAULT_DOC_NUMBER}
          maxLength={50}
          className="w-48 rounded-md border bg-background px-2 py-1 font-mono text-sm text-foreground"
        />
        <button onClick={saveDocNumber} disabled={!docNumberDirty || !!busy} className="rounded-md border px-2.5 py-1 text-sm text-foreground disabled:opacity-50">
          {busy === 'doc' ? '저장 중…' : '저장'}
        </button>
        <span className="text-xs text-muted-foreground">비우면 양식 문구({DEFAULT_DOC_NUMBER}) 그대로 출력됩니다.</span>
        {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>

      {d.doc ? (
        <div className="-mx-4 bg-muted/40 px-2 py-4 sm:mx-0 sm:rounded-xl sm:px-6 sm:py-6">
          <ReportView doc={d.doc} />
        </div>
      ) : (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {d.status === 'FAILED' ? '수집 단계에서 실패해 보고서를 만들지 못했습니다. [다시 생성]을 눌러 주세요.' : '데이터를 수집하고 있습니다…'}
        </div>
      )}
    </div>
  )
}
