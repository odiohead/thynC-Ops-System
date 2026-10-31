'use client'

/**
 * VOC·AS 주간 대시보드 하단 — 주간 보고 자료(PDF) 패널 (2026-10-31)
 * 선택 주의 1페이지 PDF를 업로드하면 서버가 PNG로 변환해 표시. 클릭 시 원본 PDF 새 창. USER 이상만 업로드·교체·삭제.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, FileText, Trash2, RefreshCw, Loader2 } from 'lucide-react'
import type { VocDashboardReportView } from '@/lib/vocDashboardReport'

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

export default function WeeklyReportPanel({ weekStart, weekIso, weekLabel, canEdit }: { weekStart: string; weekIso: string; weekLabel: string; canEdit: boolean }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<VocDashboardReportView | null | undefined>(undefined) // undefined = 로딩
  const [busy, setBusy] = useState<'upload' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/voc-receipts/dashboard/report?week=${weekStart}`)
    if (!res.ok) { setReport(null); setError((await res.json().catch(() => ({}))).error ?? '첨부를 불러오지 못했습니다.'); return }
    setReport((await res.json()).report ?? null); setError(null)
  }, [weekStart])
  useEffect(() => { setReport(undefined); void load() }, [load])

  const upload = async (file: File) => {
    if (!canEdit || busy) return
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setError('PDF 파일만 업로드할 수 있습니다.'); return }
    setBusy('upload'); setError(null)
    const fd = new FormData()
    fd.set('week', weekStart); fd.set('file', file)
    const res = await fetch('/api/voc-receipts/dashboard/report', { method: 'POST', body: fd })
    const body = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(body.error ?? '업로드에 실패했습니다.'); return }
    setReport(body.report)
    router.refresh()
  }

  const remove = async () => {
    if (!report || busy) return
    if (!confirm(`${weekIso} 주간 보고 자료(${report.fileName})를 삭제할까요?`)) return
    setBusy('delete'); setError(null)
    const res = await fetch(`/api/voc-receipts/dashboard/report?week=${weekStart}`, { method: 'DELETE' })
    setBusy(null)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? '삭제에 실패했습니다.'); return }
    setReport(null)
    router.refresh()
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f) }

  return (
    <section className="mb-6" aria-label="주간 보고 자료">
      <div className="rounded-xl border border-gray-200 bg-white p-2 sm:p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">주간 보고 자료 — {weekIso} <span className="font-normal text-gray-500">({weekLabel})</span></h3>
            <p className="mt-0.5 text-[11px] text-gray-400">파워포인트로 작성한 1페이지 PDF를 올리면 이미지로 표시됩니다 · 이미지를 클릭하면 원본 PDF를 엽니다</p>
          </div>
          {canEdit && report && (
            <div className="flex items-center gap-2">
              <button type="button" disabled={!!busy} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {busy === 'upload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 교체
              </button>
              <button type="button" disabled={!!busy} onClick={remove} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
                {busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} 삭제
              </button>
            </div>
          )}
        </div>
        {canEdit && <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onPick} />}
        {error && <p className="mb-2 px-1 text-xs text-red-600" role="alert">{error}</p>}

        {report === undefined ? (
          <p className="py-8 text-center text-xs text-gray-400">첨부를 불러오는 중…</p>
        ) : report ? (
          <div>
            <a href={report.pdfUrl} target="_blank" rel="noopener noreferrer" title="원본 PDF 열기" className="block overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL, 크기는 서버 저장값. 카드 폭 전체를 채움 */}
              <img src={report.imageUrl} alt={`${weekIso} 주간 보고 자료 — ${report.fileName}`} width={report.imageWidth} height={report.imageHeight} className="block h-auto w-full" />
            </a>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-gray-500">
              <a href={report.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline"><FileText className="h-3.5 w-3.5" />{report.fileName}</a>
              <span>{fmtBytes(report.pdfSize)}</span>
              <span>{report.uploadedBy ?? '—'} · {new Date(report.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
            </p>
          </div>
        ) : canEdit ? (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-sm transition-colors disabled:opacity-60 ${dragOver ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:bg-gray-50'}`}
          >
            {busy === 'upload' ? <Loader2 className="h-6 w-6 animate-spin text-blue-500" /> : <FileUp className="h-6 w-6 text-gray-400" />}
            <span>{busy === 'upload' ? 'PDF를 이미지로 변환하는 중…' : '이 주의 주간 보고 PDF를 선택하거나 끌어다 놓으세요'}</span>
            <span className="text-[11px] text-gray-400">1페이지 PDF · 20MB 이하</span>
          </button>
        ) : (
          <p className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-xs text-gray-400">이 주에 등록된 주간 보고 자료가 없습니다</p>
        )}
      </div>
    </section>
  )
}
