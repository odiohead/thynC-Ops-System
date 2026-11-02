'use client'

/**
 * 딜 첨부 패널 — 견적서 · 계약서 (projects/sales_crm_design.md §7, 2026-11-02)
 * 딜 상세 '규모 · 계약' 카드 안에 종류별 2열로 노출. 필수는 아니지만(계약서는 추후 전달 가능) '미첨부'를 눈에 띄게 표시한다.
 * 업로드·삭제는 /api/hospitals/[code]/sales/deals/[id]/files(/[fileId]) — 접근은 서버(checkSalesAccess)가 강제.
 */
import { useRef, useState, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Paperclip, Upload, X } from 'lucide-react'
import {
  SALES_DEAL_FILE_KINDS,
  SALES_DEAL_FILE_KIND_LABELS,
  SALES_DEAL_FILE_MAX_BYTES,
  SALES_DEAL_FILES_PER_REQUEST,
  type SalesDealFileDto,
  type SalesDealFileKind,
} from '@/lib/salesDealFiles'

const MAX_MB = Math.round(SALES_DEAL_FILE_MAX_BYTES / 1024 / 1024)

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export default function DealFilesPanel({
  hospitalCode,
  dealId,
  canWrite,
  initialFiles,
}: {
  hospitalCode: string
  dealId: number
  canWrite: boolean
  initialFiles: SalesDealFileDto[]
}) {
  const router = useRouter()
  const [files, setFiles] = useState<SalesDealFileDto[]>(initialFiles)
  const [busyKind, setBusyKind] = useState<SalesDealFileKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/hospitals/${hospitalCode}/sales/deals/${dealId}/files`

  const reload = async () => {
    const res = await fetch(base, { cache: 'no-store' })
    const d = await res.json().catch(() => ({}))
    if (res.ok) setFiles(d.files ?? [])
  }

  const upload = async (kind: SalesDealFileKind, list: FileList | File[]) => {
    const picked = Array.from(list)
    if (!picked.length || !canWrite || busyKind) return
    setError(null)
    if (picked.length > SALES_DEAL_FILES_PER_REQUEST) { setError(`한 번에 최대 ${SALES_DEAL_FILES_PER_REQUEST}개까지 업로드할 수 있습니다.`); return }
    const tooBig = picked.filter((f) => f.size > SALES_DEAL_FILE_MAX_BYTES)
    if (tooBig.length) { setError(`파일당 ${MAX_MB}MB를 초과했습니다: ${tooBig.map((f) => f.name).join(', ')}`); return }
    const fd = new FormData()
    fd.append('kind', kind)
    picked.forEach((f) => fd.append('files', f))
    setBusyKind(kind)
    try {
      const res = await fetch(base, { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? '업로드에 실패했습니다.'); return }
      const failed: { name: string; error: string }[] = d.failed ?? []
      if (failed.length) setError(`${picked.length}건 중 ${failed.length}건 실패: ${failed.map((f) => `${f.name}(${f.error})`).join(', ')}`)
      await reload()
      router.refresh()
    } finally {
      setBusyKind(null)
    }
  }

  const remove = async (f: SalesDealFileDto) => {
    if (!canWrite || busyKind) return
    if (!confirm(`${SALES_DEAL_FILE_KIND_LABELS[f.kind]} '${f.fileName}' 파일을 삭제할까요?`)) return
    setBusyKind(f.kind)
    setError(null)
    try {
      const res = await fetch(`${base}/${f.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? '삭제에 실패했습니다.'); return }
      await reload()
      router.refresh()
    } finally {
      setBusyKind(null)
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <p className="text-xs font-semibold text-gray-500">
        견적서 · 계약서 첨부
        <span className="ml-2 font-normal text-gray-400">필수 아님 — 계약서는 추후 전달되면 첨부 · 파일당 {MAX_MB}MB</span>
      </p>
      {error && <div className="mt-2 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        {SALES_DEAL_FILE_KINDS.map((kind) => (
          <KindColumn
            key={kind}
            kind={kind}
            files={files.filter((f) => f.kind === kind)}
            canWrite={canWrite}
            busy={busyKind !== null}
            onUpload={(list) => void upload(kind, list)}
            onRemove={(f) => void remove(f)}
            href={(f) => `${base}/${f.id}`}
          />
        ))}
      </div>
    </div>
  )
}

function KindColumn({
  kind, files, canWrite, busy, onUpload, onRemove, href,
}: {
  kind: SalesDealFileKind
  files: SalesDealFileDto[]
  canWrite: boolean
  busy: boolean
  onUpload: (list: FileList | File[]) => void
  onRemove: (f: SalesDealFileDto) => void
  href: (f: SalesDealFileDto) => string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const label = SALES_DEAL_FILE_KIND_LABELS[kind]
  const empty = files.length === 0

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (!canWrite || busy) return
    if (e.dataTransfer.files?.length) onUpload(e.dataTransfer.files)
  }

  return (
    <div className={`rounded-lg border ${empty ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <FileText className={`h-4 w-4 ${empty ? 'text-amber-500' : 'text-blue-600'}`} />
          {label}
        </span>
        {empty ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">미첨부</span>
        ) : (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{files.length}건</span>
        )}
      </div>

      {!empty && (
        <ul className="divide-y divide-gray-100">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <a href={href(f)} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium text-blue-700 hover:underline" title={f.fileName}>
                {f.fileName}
              </a>
              <span className="shrink-0 whitespace-nowrap text-[11px] text-gray-400">{fmtSize(f.sizeBytes)} · {f.uploadedByName ?? '—'} · {fmtDate(f.uploadedAt)}</span>
              {canWrite && (
                <button type="button" onClick={() => onRemove(f)} disabled={busy} className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50" title="삭제" aria-label={`${f.fileName} 삭제`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <div
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          className={`m-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-xs transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50 text-blue-700' : empty ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-gray-300 text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="font-medium">{busy ? '처리 중…' : `${label} 파일 선택 또는 끌어다 놓기`}</span>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) onUpload(e.target.files); e.target.value = '' }} />
        </div>
      ) : empty ? (
        <p className="px-3 py-2 text-xs text-gray-400">첨부된 {label}가 없습니다.</p>
      ) : null}
    </div>
  )
}
