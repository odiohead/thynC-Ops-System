'use client'

/**
 * 출고요청 첨부파일 패널 — 목록 + 드롭존 + 다중 업로드 + 삭제 (projects/stock_out_v2_design.md §15, 2026-11-02)
 * 상세 페이지 '첨부 파일' 카드와 수정 모달에서 재사용. API /api/stock-out-requests/[id]/files(/[fileId]).
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { FileSpreadsheet, Paperclip, Upload, X } from 'lucide-react'
import { STOCK_OUT_FILE_MAX_BYTES, STOCK_OUT_FILES_PER_REQUEST, isSpreadsheetFile, type StockOutFileDto } from '@/lib/stockOutFiles'

const MAX_MB = Math.round(STOCK_OUT_FILE_MAX_BYTES / 1024 / 1024)

export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export default function StockOutFilesPanel({
  requestId,
  canWrite,
  initialFiles,
  onChanged,
  compact = false,
}: {
  requestId: number
  canWrite: boolean
  /** 이미 받아 둔 목록 (상세 응답) — 없으면 자체 fetch */
  initialFiles?: StockOutFileDto[]
  onChanged?: (files: StockOutFileDto[]) => void
  /** 모달 안 등 좁은 공간용 */
  compact?: boolean
}) {
  const router = useRouter()
  const [files, setFiles] = useState<StockOutFileDto[] | null>(initialFiles ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const base = `/api/stock-out-requests/${requestId}/files`

  const load = useCallback(async (): Promise<StockOutFileDto[] | null> => {
    const res = await fetch(base, { cache: 'no-store' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error ?? '첨부 목록을 불러오지 못했습니다.'); return null }
    const list: StockOutFileDto[] = d.files ?? []
    setFiles(list)
    return list
  }, [base])

  useEffect(() => { if (!initialFiles) void load() }, [initialFiles, load])
  useEffect(() => { if (initialFiles) setFiles(initialFiles) }, [initialFiles])

  const upload = async (list: FileList | File[]) => {
    const picked = Array.from(list)
    if (!picked.length || !canWrite || busy) return
    setError(null)
    if (picked.length > STOCK_OUT_FILES_PER_REQUEST) { setError(`한 번에 최대 ${STOCK_OUT_FILES_PER_REQUEST}개까지 업로드할 수 있습니다.`); return }
    const tooBig = picked.filter((f) => f.size > STOCK_OUT_FILE_MAX_BYTES)
    if (tooBig.length) { setError(`파일당 ${MAX_MB}MB를 초과했습니다: ${tooBig.map((f) => f.name).join(', ')}`); return }
    const fd = new FormData()
    picked.forEach((f) => fd.append('files', f))
    setBusy(true)
    try {
      const res = await fetch(base, { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? '업로드에 실패했습니다.'); return }
      const failed: { name: string; error: string }[] = d.failed ?? []
      if (failed.length) setError(`${picked.length}건 중 ${failed.length}건 실패: ${failed.map((f) => `${f.name}(${f.error})`).join(', ')}`)
      router.refresh()
      const next = await load()
      if (next) onChanged?.(next)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async (f: StockOutFileDto) => {
    if (!canWrite || busy) return
    if (!confirm(`'${f.fileName}' 파일을 삭제할까요?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${base}/${f.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? '삭제에 실패했습니다.'); return }
      router.refresh()
      const next = await load()
      if (next) onChanged?.(next)
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (!canWrite || busy) return
    if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files)
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {canWrite && (
        <div
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          className={`flex cursor-pointer flex-wrap items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-xs transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Upload className="h-4 w-4" />
          <span className="font-medium">{busy ? '업로드 중…' : '파일 선택 또는 끌어다 놓기'}</span>
          <span className="text-gray-400">(엑셀·PDF·이미지 등 · 파일당 {MAX_MB}MB · 한 번에 {STOCK_OUT_FILES_PER_REQUEST}개)</span>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void upload(e.target.files)} />
        </div>
      )}

      {error && <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {files === null ? (
        <p className="py-2 text-center text-xs text-gray-400">불러오는 중…</p>
      ) : files.length === 0 ? (
        <p className="py-2 text-center text-xs text-gray-400">첨부된 파일이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              {isSpreadsheetFile(f.fileName)
                ? <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
                : <Paperclip className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
              <a href={`${base}/${f.id}`} className="min-w-0 flex-1 truncate font-medium text-blue-700 hover:underline" title={f.fileName}>
                {f.fileName}
              </a>
              <span className="shrink-0 whitespace-nowrap text-[11px] text-gray-400">{fmtFileSize(f.sizeBytes)} · {f.uploadedByName ?? '—'} · {fmtDate(f.uploadedAt)}</span>
              {canWrite && (
                <button type="button" onClick={() => void remove(f)} disabled={busy} className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50" title="삭제" aria-label={`${f.fileName} 삭제`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
