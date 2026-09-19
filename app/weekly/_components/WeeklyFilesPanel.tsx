'use client'

// 주간업무 항목 첨부파일 패널 — 리스트 + 드롭존 + 다중 업로드 + 삭제
// 첨부 레이어(FilesModal)·항목 상세 모달 양쪽에서 재사용 (projects/weekly_attachments_design.md §3.2·§5)
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip, Upload, X } from 'lucide-react'
import Button from '@/app/components/ui/Button'
import { WEEKLY_FILE_MAX_BYTES, WEEKLY_FILES_PER_REQUEST, type WeeklyFileDto } from '@/lib/weekly'

interface Props {
  itemId: number
  canWrite: boolean
  /** 업로드·삭제 성공 후 현재 건수 통지 — 부모(보드)의 fileCount 로컬 갱신용 */
  onChanged?: (count: number) => void
  /** 초기 목록 (상세 모달처럼 이미 받아 둔 경우) — 없으면 자체 fetch */
  initialFiles?: WeeklyFileDto[]
}

const MAX_MB = Math.round(WEEKLY_FILE_MAX_BYTES / 1024 / 1024)

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function WeeklyFilesPanel({ itemId, canWrite, onChanged, initialFiles }: Props) {
  const router = useRouter()
  const [files, setFiles] = useState<WeeklyFileDto[] | null>(initialFiles ?? null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /** 목록 재조회 — 성공 시 배열 반환 (호출부가 건수 통지에 사용) */
  const load = useCallback(async (): Promise<WeeklyFileDto[] | null> => {
    const res = await fetch(`/api/weekly/items/${itemId}/files`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? '첨부 목록을 불러오지 못했습니다.')
      return null
    }
    const list: WeeklyFileDto[] = data.files ?? []
    setFiles(list)
    return list
  }, [itemId])

  useEffect(() => {
    if (!initialFiles) void load()
  }, [initialFiles, load])

  const upload = async (list: FileList | File[]) => {
    const picked = Array.from(list)
    if (picked.length === 0 || !canWrite) return
    setError(null)
    if (picked.length > WEEKLY_FILES_PER_REQUEST) {
      setError(`한 번에 최대 ${WEEKLY_FILES_PER_REQUEST}개까지 업로드할 수 있습니다.`)
      return
    }
    const tooBig = picked.filter((f) => f.size > WEEKLY_FILE_MAX_BYTES)
    if (tooBig.length) {
      setError(`파일당 ${MAX_MB}MB를 초과했습니다: ${tooBig.map((f) => f.name).join(', ')}`)
      return
    }
    const fd = new FormData()
    picked.forEach((f) => fd.append('files', f))
    setBusy(true)
    setProgress(`업로드 중… ${picked.length}개 (${fmtSize(picked.reduce((a, f) => a + f.size, 0))})`)
    try {
      const res = await fetch(`/api/weekly/items/${itemId}/files`, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? '업로드에 실패했습니다.')
        return
      }
      const failed: { name: string; error: string }[] = data.failed ?? []
      if (failed.length) {
        setError(`${picked.length}건 중 ${failed.length}건 실패: ${failed.map((f) => `${f.name}(${f.error})`).join(', ')}`)
      }
      router.refresh()
      const list = await load()
      if (list) onChanged?.(list.length)
    } finally {
      setBusy(false)
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async (f: WeeklyFileDto) => {
    if (!canWrite || busy) return
    if (!confirm(`'${f.fileName}' 파일을 삭제할까요?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/weekly/items/${itemId}/files/${f.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? '삭제에 실패했습니다.')
        return
      }
      router.refresh()
      const list = await load()
      if (list) onChanged?.(list.length)
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
    <div className="space-y-3">
      {canWrite && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            if (!busy) setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-wrap items-center justify-center gap-2 rounded-md border border-dashed px-3 py-3 text-xs transition-colors ${
            dragOver ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground'
          }`}
        >
          <Upload className="h-4 w-4" />
          <span>여기에 파일을 끌어다 놓거나</span>
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            파일 선택
          </Button>
          <span>
            (여러 개 가능 · 파일당 {MAX_MB}MB · 한 번에 {WEEKLY_FILES_PER_REQUEST}개)
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && void upload(e.target.files)}
          />
        </div>
      )}

      {progress && <div className="text-xs text-muted-foreground">{progress}</div>}
      {error && (
        <div className="whitespace-pre-line rounded-md bg-destructive-subtle px-3 py-2 text-xs text-destructive-subtle-foreground">
          {error}
        </div>
      )}

      {files === null ? (
        <div className="py-4 text-center text-xs text-muted-foreground">불러오는 중…</div>
      ) : files.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">첨부된 파일이 없습니다.</div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <a
                href={`/api/weekly/items/${itemId}/files/${f.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate font-medium hover:underline"
                title={f.fileName}
              >
                {f.fileName}
              </a>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {fmtSize(f.sizeBytes)} · {f.uploadedByName ?? '—'} · {fmtDate(f.uploadedAt)}
              </span>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => void remove(f)}
                  disabled={busy}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                  title="삭제"
                  aria-label={`${f.fileName} 삭제`}
                >
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
