'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { SPACE_TYPE_LABELS } from '@/lib/gateway-planner/types'

interface Space {
  id: string
  type: string
  label: string
  bbox: [number, number, number, number]
  confidence: string
}
interface Point { x: number; y: number; spaceId: string; spaceType: string; spaceLabel: string }
interface ScaleCandidate { mPerPx: number | null; spreadPct: number | null; used: number; rejected: number }

interface JobDetail {
  id: number
  title: string
  status: string
  originalName: string
  pageIndex: number
  pageCount: number | null
  visionUrl: string | null
  pptxUrl: string | null
  visionWidth: number | null
  visionHeight: number | null
  scaleMPerPx: number | null
  scaleSource: string | null
  scaleMeta: { candidate?: ScaleCandidate } | null
  analysis: { spaces: Space[] } | null
  placements: { points: Point[]; skipped: Record<string, number>; notes: string[] } | null
  gatewayCount: number | null
  errorMessage: string | null
  tokenUsage: { inputTokens: number; outputTokens: number; calls: number } | null
  createdAt: string
  createdBy: { name: string }
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '대기', cls: 'bg-gray-100 text-gray-600' },
  RASTERIZING: { label: '도면 변환 중', cls: 'bg-blue-50 text-blue-600' },
  ANALYZING: { label: 'AI 분석 중', cls: 'bg-blue-100 text-blue-700' },
  NEED_SCALE: { label: '스케일 확인 필요', cls: 'bg-amber-100 text-amber-700' },
  PLACED: { label: '배치 완료', cls: 'bg-green-100 text-green-700' },
  ERROR: { label: '오류', cls: 'bg-red-100 text-red-700' },
}

const SPACE_COLORS: Record<string, string> = {
  corridor: '#2563eb', ward: '#059669', toilet: '#d97706', nurse_station: '#7c3aed',
  stairs: '#6b7280', elevator: '#6b7280', outdoor: '#9ca3af', storage: '#92400e',
  machine: '#374151', other: '#db2777',
}

const ACTIVE_STATUSES = ['PENDING', 'RASTERIZING', 'ANALYZING']

export default function GatewayPlanJobPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const jobId = params.id

  const [job, setJob] = useState<JobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showSpaces, setShowSpaces] = useState(false)

  // 2점 보정 상태
  const [calibrating, setCalibrating] = useState(false)
  const [calPoints, setCalPoints] = useState<Array<[number, number]>>([])
  const [calMeters, setCalMeters] = useState('')
  const svgRef = useRef<SVGSVGElement>(null)

  const fetchJob = useCallback(async () => {
    const res = await fetch(`/api/gateway-planner/jobs/${jobId}`)
    if (res.status === 404) { setError('잡을 찾을 수 없습니다.'); return }
    if (!res.ok) return
    const data = await res.json()
    setJob(data.job)
  }, [jobId])

  useEffect(() => { fetchJob() }, [fetchJob])

  // 진행 중이면 3초 폴링
  useEffect(() => {
    if (!job || !ACTIVE_STATUSES.includes(job.status)) return
    const t = setInterval(fetchJob, 3000)
    return () => clearInterval(t)
  }, [job, fetchJob])

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of job?.placements?.points ?? []) counts[p.spaceType] = (counts[p.spaceType] || 0) + 1
    return counts
  }, [job])

  const candidate = job?.scaleMeta?.candidate ?? null

  const callApi = async (label: string, path: string, init?: RequestInit): Promise<Record<string, unknown> | null> => {
    setBusy(label)
    setError(null)
    try {
      const res = await fetch(path, init)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || `${label} 실패`)
      await fetchJob()
      return data as Record<string, unknown>
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} 실패`)
      return null
    } finally {
      setBusy(null)
    }
  }

  const confirmScale = () => callApi('스케일 확정', `/api/gateway-planner/jobs/${jobId}/scale`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'confirm' }),
  })
  const noScale = () => callApi('스케일 없이 진행', `/api/gateway-planner/jobs/${jobId}/scale`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'none' }),
  })
  const applyManualScale = async () => {
    const meters = parseFloat(calMeters)
    if (calPoints.length !== 2 || !meters || meters <= 0) return
    const ok = await callApi('2점 보정', `/api/gateway-planner/jobs/${jobId}/scale`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'manual', p1: calPoints[0], p2: calPoints[1], meters }),
    })
    if (ok) { setCalibrating(false); setCalPoints([]); setCalMeters('') }
  }
  const replace = () => callApi('재배치', `/api/gateway-planner/jobs/${jobId}/replace`, { method: 'POST' })
  const reanalyze = () => {
    if (!confirm('AI 분석을 다시 실행할까요? (API 비용이 발생하며 1~2분 걸립니다. 확정한 스케일은 초기화됩니다)')) return
    callApi('AI 재분석', `/api/gateway-planner/jobs/${jobId}/reanalyze`, { method: 'POST' })
  }
  const generatePptx = async () => {
    const data = await callApi('PPTX 생성', `/api/gateway-planner/jobs/${jobId}/pptx`, { method: 'POST' })
    if (data?.url) window.open(data.url as string, '_blank')
  }
  const handleDelete = async () => {
    if (!confirm('이 잡을 삭제할까요? 생성된 파일도 함께 삭제됩니다.')) return
    const res = await fetch(`/api/gateway-planner/jobs/${jobId}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      router.push('/gateway-planner')
    }
  }

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!calibrating || !job?.visionWidth || !job?.visionHeight || calPoints.length >= 2) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((e.clientX - rect.left) / rect.width) * job.visionWidth
    const y = ((e.clientY - rect.top) / rect.height) * job.visionHeight
    setCalPoints((prev) => [...prev, [Math.round(x), Math.round(y)]])
  }

  if (error && !job) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/gateway-planner" className="mt-2 inline-block text-sm text-blue-500 hover:underline">← 목록으로</Link>
      </div>
    )
  }
  if (!job) return <div className="p-10 text-center text-sm text-gray-400">불러오는 중...</div>

  const st = STATUS_LABEL[job.status] ?? { label: job.status, cls: 'bg-gray-100 text-gray-600' }
  const running = ACTIVE_STATUSES.includes(job.status)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/gateway-planner" className="text-sm text-gray-400 hover:text-gray-600">← 목록</Link>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">{job.title}</h1>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
        <span className="text-xs text-gray-400">
          {job.originalName}
          {job.pageCount && job.pageCount > 1 ? ` (${job.pageIndex + 1}/${job.pageCount}p)` : ''}
          {' · '}{job.createdBy.name} · {new Date(job.createdAt).toLocaleString('ko-KR')}
        </span>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {running && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          {st.label} — 30초~2분 정도 걸립니다. 이 화면은 자동으로 갱신됩니다.
        </div>
      )}

      {job.status === 'ERROR' && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">분석 실패</div>
          <div className="mt-1 text-xs">{job.errorMessage}</div>
          <button onClick={reanalyze} disabled={!!busy} className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40">
            다시 시도
          </button>
        </div>
      )}

      {/* 스케일 카드 */}
      {job.analysis && (
        <div className={`mb-4 rounded-xl border p-4 ${job.status === 'NEED_SCALE' ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-semibold text-gray-800 dark:text-gray-200">도면 스케일</span>
              {job.status === 'PLACED' && job.scaleSource !== 'none' && job.scaleMPerPx ? (
                <span className="ml-2 text-gray-600 dark:text-gray-300">
                  확정됨 — 1px ≈ {(job.scaleMPerPx * 100).toFixed(1)}cm ({job.scaleSource === 'manual_2point' ? '2점 보정' : 'AI 치수 판독'})
                </span>
              ) : job.status === 'PLACED' && job.scaleSource === 'none' ? (
                <span className="ml-2 text-amber-600">스케일 없이 배치됨 — 복도 간격이 부정확할 수 있습니다</span>
              ) : candidate?.mPerPx ? (
                <span className="ml-2 text-gray-700 dark:text-gray-300">
                  AI 판독 후보: 1px ≈ {(candidate.mPerPx * 100).toFixed(1)}cm
                  <span className="ml-1 text-xs text-gray-400">(치수 {candidate.used}건, 산포 {candidate.spreadPct?.toFixed(0)}%)</span>
                </span>
              ) : (
                <span className="ml-2 text-amber-600">치수를 읽지 못했습니다 — 2점 보정을 사용하세요</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {job.status === 'NEED_SCALE' && candidate?.mPerPx && (
                <button onClick={confirmScale} disabled={!!busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">
                  이 스케일로 확정
                </button>
              )}
              <button
                onClick={() => { setCalibrating(!calibrating); setCalPoints([]); setCalMeters('') }}
                disabled={!!busy}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${calibrating ? 'bg-gray-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300'}`}
              >
                {calibrating ? '보정 취소' : '2점 보정'}
              </button>
              {job.status === 'NEED_SCALE' && (
                <button onClick={noScale} disabled={!!busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600">
                  스케일 없이 진행
                </button>
              )}
            </div>
          </div>
          {calibrating && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm dark:border-gray-600 dark:bg-gray-900">
              <div className="text-xs text-gray-600 dark:text-gray-300">
                아래 도면에서 <b>실제 길이를 아는 두 점</b>을 차례로 클릭한 뒤, 그 구간의 실제 거리(m)를 입력하세요.
                (예: 치수 6,000이 표기된 기둥 간격 양 끝 → 6 입력) — 선택됨: {calPoints.length}/2
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number" step="0.1" min="0.1" value={calMeters}
                  onChange={(e) => setCalMeters(e.target.value)}
                  placeholder="실제 거리 (m)"
                  className="w-36 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
                />
                <button
                  onClick={applyManualScale}
                  disabled={calPoints.length !== 2 || !parseFloat(calMeters) || !!busy}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  적용 (재배치)
                </button>
                <button onClick={() => setCalPoints([])} className="text-xs text-gray-400 hover:text-gray-600">점 다시 찍기</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 미리보기 */}
      {job.visionUrl && job.visionWidth && job.visionHeight && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              배치 미리보기
              {job.gatewayCount != null && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">게이트웨이 총 {job.gatewayCount}대</span>}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" checked={showSpaces} onChange={(e) => setShowSpaces(e.target.checked)} />
              공간 인식 결과 표시
            </label>
          </div>
          <div className={`relative w-full overflow-hidden rounded-lg border border-gray-100 dark:border-gray-700 ${calibrating ? 'cursor-crosshair' : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={job.visionUrl} alt="도면" className="block w-full" draggable={false} />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${job.visionWidth} ${job.visionHeight}`}
              className="absolute inset-0 h-full w-full"
              onClick={onSvgClick}
            >
              {showSpaces && job.analysis?.spaces.map((s) => (
                <g key={s.id}>
                  <rect
                    x={s.bbox[0]} y={s.bbox[1]} width={s.bbox[2] - s.bbox[0]} height={s.bbox[3] - s.bbox[1]}
                    fill={SPACE_COLORS[s.type] ?? '#000'} fillOpacity={0.1}
                    stroke={SPACE_COLORS[s.type] ?? '#000'} strokeWidth={1.5}
                    strokeDasharray={s.confidence === 'low' ? '6,4' : undefined}
                  />
                  <text x={s.bbox[0] + 3} y={s.bbox[1] + 13} fontSize={11} fontWeight={700} fill={SPACE_COLORS[s.type] ?? '#000'}>
                    {SPACE_TYPE_LABELS[s.type as keyof typeof SPACE_TYPE_LABELS] ?? s.type}
                  </text>
                </g>
              ))}
              {job.placements?.points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={6} fill="#FF0000" stroke="#fff" strokeWidth={1.5} />
              ))}
              {calPoints.map((p, i) => (
                <g key={`cal${i}`}>
                  <circle cx={p[0]} cy={p[1]} r={8} fill="none" stroke="#2563eb" strokeWidth={3} />
                  <circle cx={p[0]} cy={p[1]} r={2} fill="#2563eb" />
                </g>
              ))}
              {calPoints.length === 2 && (
                <line x1={calPoints[0][0]} y1={calPoints[0][1]} x2={calPoints[1][0]} y2={calPoints[1][1]} stroke="#2563eb" strokeWidth={2} strokeDasharray="8,4" />
              )}
            </svg>
          </div>
          {(job.placements?.notes.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1">
              {job.placements!.notes.map((n, i) => (
                <div key={i} className="text-xs text-amber-600">⚠ {n}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 요약 + 액션 */}
      {job.placements && (
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-2 font-semibold text-gray-800 dark:text-gray-200">공간별 배치 집계</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(typeCounts).map(([type, count]) => (
                <span key={type} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ borderColor: SPACE_COLORS[type], color: SPACE_COLORS[type] }}>
                  {SPACE_TYPE_LABELS[type as keyof typeof SPACE_TYPE_LABELS] ?? type} {count}
                </span>
              ))}
            </div>
            {job.tokenUsage && (
              <div className="mt-3 text-xs text-gray-400">
                AI 호출 {job.tokenUsage.calls}회 · 입력 {(job.tokenUsage.inputTokens / 1000).toFixed(1)}k · 출력 {(job.tokenUsage.outputTokens / 1000).toFixed(1)}k 토큰
              </div>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">작업</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={replace} disabled={!!busy || running} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300">
                {busy === '재배치' ? '재배치 중...' : '현재 규칙으로 재배치'}
              </button>
              <button onClick={reanalyze} disabled={!!busy || running} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300">
                AI 재분석
              </button>
              <button
                onClick={generatePptx}
                disabled={!!busy || job.status !== 'PLACED'}
                title={job.status !== 'PLACED' ? '스케일 확정 후 생성할 수 있습니다' : undefined}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
              >
                {busy === 'PPTX 생성' ? '생성 중...' : 'PPTX 생성'}
              </button>
              {job.pptxUrl && (
                <a href={job.pptxUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700">
                  PPTX 다운로드
                </a>
              )}
              <button onClick={handleDelete} disabled={!!busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40">
                삭제
              </button>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              PPTX의 빨간 점은 개별 도형입니다 — PowerPoint에서 이동·삭제·복사로 검토 후 설치계획 문서에 붙여 넣으세요.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
