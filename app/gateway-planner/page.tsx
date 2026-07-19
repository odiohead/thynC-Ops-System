'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface JobRow {
  id: number
  title: string
  status: string
  originalName: string
  gatewayCount: number | null
  pptxKey: string | null
  errorMessage: string | null
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

const ACTIVE_STATUSES = ['PENDING', 'RASTERIZING', 'ANALYZING']

export default function GatewayPlannerPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [page, setPage] = useState('1')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway-planner/jobs')
      if (!res.ok) throw new Error('목록 조회 실패')
      const data = await res.json()
      setJobs(data.jobs)
    } catch {
      // 폴링 중 일시 오류는 무시
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // 진행 중 잡이 있으면 5초 폴링
  useEffect(() => {
    if (!jobs.some((j) => ACTIVE_STATUSES.includes(j.status))) return
    const t = setInterval(fetchJobs, 5000)
    return () => clearInterval(t)
  }, [jobs, fetchJobs])

  const isPdf = file?.name.toLowerCase().endsWith('.pdf') ?? false

  const onSelectFile = (f: File | null) => {
    setFile(f)
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  const handleUpload = async () => {
    if (!file || uploading) return
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title)
      fd.append('page', page)
      const res = await fetch('/api/gateway-planner/jobs', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '업로드 실패')
      router.refresh()
      router.push(`/gateway-planner/${data.jobId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 실패')
      setUploading(false)
    }
  }

  const handleDelete = async (job: JobRow) => {
    if (!confirm(`'${job.title}' 잡을 삭제할까요? 생성된 파일도 함께 삭제됩니다.`)) return
    const res = await fetch(`/api/gateway-planner/jobs/${job.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      fetchJobs()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || '삭제 실패')
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">GW 배치 플래너</h1>
        <p className="mt-1 text-sm text-gray-500">
          1개층 도면(PDF/JPG/PNG)을 업로드하면 AI가 공간을 인식하고 게이트웨이 설치 위치 초안을 배치합니다.
          결과는 PowerPoint로 내려받아 검토·수정 후 설치계획 문서에 사용하세요.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* 업로드 카드 */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) onSelectFile(f)
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => onSelectFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="text-sm">
              <span className="font-medium text-gray-900 dark:text-gray-100">{file.name}</span>
              <span className="ml-2 text-gray-400">({(file.size / 1024 / 1024).toFixed(1)}MB)</span>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              도면 파일을 끌어다 놓거나 클릭해서 선택하세요
              <div className="mt-1 text-xs text-gray-400">PDF · JPG · PNG, 최대 30MB, 1회 1개층</div>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-500">제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: ○○병원 9층"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
          </div>
          {isPdf && (
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-gray-500">PDF 페이지</label>
              <input
                type="number"
                min={1}
                value={page}
                onChange={(e) => setPage(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              />
            </div>
          )}
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {uploading ? '업로드 중...' : '분석 시작'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          분석에는 30초~2분 정도 걸립니다. 업로드 후 상세 화면에서 진행 상태를 확인하세요.
        </p>
      </div>

      {/* 잡 목록 */}
      <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">분석 이력</h2>
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">불러오는 중...</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-gray-200 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          아직 분석한 도면이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-2">제목</th>
                <th className="px-4 py-2">상태</th>
                <th className="px-4 py-2 text-right">GW 수</th>
                <th className="px-4 py-2">작성자</th>
                <th className="px-4 py-2">생성일</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {jobs.map((job) => {
                const st = STATUS_LABEL[job.status] ?? { label: job.status, cls: 'bg-gray-100 text-gray-600' }
                return (
                  <tr
                    key={job.id}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                    onClick={() => router.push(`/gateway-planner/${job.id}`)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{job.title}</div>
                      <div className="text-xs text-gray-400">{job.originalName}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {job.gatewayCount != null ? `${job.gatewayCount}대` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{job.createdBy.name}</td>
                    <td className="px-4 py-2.5 text-gray-500">{new Date(job.createdAt).toLocaleString('ko-KR')}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(job) }}
                        className="text-xs text-gray-400 hover:text-red-500"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-400">
        배치 규칙(커버리지·병실 개수 등)은 <Link href="/settings/gateway-planner" className="text-blue-500 hover:underline">설정 &gt; GW 배치 규칙</Link>에서 변경할 수 있습니다.
      </div>
    </div>
  )
}
