'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import HospitalSearchInput, { type HospitalPick } from '@/app/components/HospitalSearchInput'

/**
 * 레포트 (최고관리자) — 병원 운영 이력 보고서 생성·이력 (projects/hospital_report_design.md §4)
 * 초기 버전은 축 1개: 병원 검색 → 생성 / 최근 생성 이력
 */

interface RunRow {
  id: string
  status: string
  aiError: string | null
  model: string | null
  effort: string | null
  createdAt: string
  finishedAt: string | null
  hospital: { hospitalCode: string; hospitalName: string | null }
  createdBy: { name: string } | null
}

function statusBadge(r: RunRow) {
  if (r.status === 'COLLECTING') return { label: '데이터 수집 중', cls: 'bg-blue-50 text-blue-700' }
  if (r.status === 'ANALYZING') return { label: 'AI 분석 중', cls: 'bg-blue-100 text-blue-700' }
  if (r.status === 'FAILED') return { label: '실패', cls: 'bg-red-100 text-red-700' }
  if (r.aiError) return { label: '완료 (AI 실패)', cls: 'bg-amber-100 text-amber-700' }
  return { label: '완료', cls: 'bg-green-100 text-green-700' }
}

const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function ReportsPage() {
  const router = useRouter()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [total, setTotal] = useState(0)
  const [take, setTake] = useState(20)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [hospital, setHospital] = useState<HospitalPick | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/reports?take=${take}`, { cache: 'no-store' })
    if (res.status === 403) { setForbidden(true); setLoading(false); return }
    if (res.ok) {
      const d = await res.json()
      setRuns(d.runs)
      setTotal(d.total)
    }
    setLoading(false)
  }, [take])

  useEffect(() => { load() }, [load])
  // 진행 중 행이 있으면 5초마다 갱신
  useEffect(() => {
    if (!runs.some((r) => r.status === 'COLLECTING' || r.status === 'ANALYZING')) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [runs, load])

  const create = async () => {
    if (!hospital) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hospitalCode: hospital.hospitalCode }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '보고서 생성을 시작하지 못했습니다.')
      router.refresh()
      router.push(`/reports/${d.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
      setCreating(false)
    }
  }

  if (forbidden) return <div className="p-6 text-sm text-muted-foreground">레포트는 최고관리자만 사용할 수 있습니다.</div>

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="mb-1 text-2xl font-bold text-foreground">레포트</h1>
        <p className="text-sm text-muted-foreground">
          고객 운영 이력 레포트 — 시스템 데이터로 수치·표를 만들고 AI가 요약·반복 문의·주요 이슈·시사점을 작성합니다. 사내 보고서 양식으로 Word 다운로드할 수 있습니다.
        </p>
      </div>

      <div className="mb-6 rounded-xl border bg-card p-4">
        <p className="mb-2 text-sm font-medium text-foreground">고객 운영 이력 레포트 생성</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 [&>div]:mt-0">
            <HospitalSearchInput value={hospital} onChange={setHospital} />
          </div>
          <button
            onClick={create}
            disabled={!hospital || creating}
            className="shrink-0 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {creating ? '생성 시작 중…' : '보고서 생성'}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          데이터 수집은 수 초, AI 분석은 1~3분 걸립니다. AI 모델·사고 깊이는{' '}
          <Link href="/settings/ai-assistant" className="underline">설정 &gt; AI 어시스턴트</Link>의 &lsquo;레포트&rsquo; 섹션에서 바꿀 수 있습니다.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-2.5 text-sm font-medium text-foreground">최근 생성 이력 <span className="text-muted-foreground">({total})</span></div>
        {loading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">불러오는 중…</p>
        ) : runs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">아직 생성한 보고서가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">생성일시</th>
                  <th className="px-4 py-2 text-left font-medium">병원</th>
                  <th className="px-4 py-2 text-left font-medium">상태</th>
                  <th className="hidden px-4 py-2 text-left font-medium sm:table-cell">AI 모델 · effort</th>
                  <th className="hidden px-4 py-2 text-left font-medium sm:table-cell">생성자</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const b = statusBadge(r)
                  return (
                    <tr key={r.id} onClick={() => router.push(`/reports/${r.id}`)} className="cursor-pointer border-t hover:bg-muted/40">
                      <td className="whitespace-nowrap px-4 py-2 text-foreground">{fmt(r.createdAt)}</td>
                      <td className="px-4 py-2 text-foreground">{r.hospital.hospitalName ?? r.hospital.hospitalCode} <span className="text-xs text-muted-foreground">{r.hospital.hospitalCode}</span></td>
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${b.cls}`}>{b.label}</span></td>
                      <td className="hidden px-4 py-2 font-mono text-xs text-muted-foreground sm:table-cell">{r.model ?? '—'} · {r.effort ?? '—'}</td>
                      <td className="hidden px-4 py-2 text-muted-foreground sm:table-cell">{r.createdBy?.name ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {runs.length < total && (
              <button onClick={() => setTake((t) => t + 20)} className="w-full border-t px-4 py-2 text-sm text-blue-600 hover:bg-muted/40">더보기</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
