'use client'

// 첨부 컬럼 셀 — 보드·아카이브·병원별·경과 리스트 공용, 목표일과 별도 컬럼 (projects/weekly_attachments_design.md §3.1 — 2026-09-19 개정)
// 0건: 쓰기 권한자에게만 '+ 첨부' / n건: 클립 아이콘 + 건수 (VIEWER는 열람용으로 표시)
import type { MouseEvent } from 'react'
import { Paperclip } from 'lucide-react'

interface Props {
  fileCount: number
  canWrite: boolean
  onOpenFiles: () => void
}

export default function AttachCell({ fileCount, canWrite, onOpenFiles }: Props) {
  const open = (e: MouseEvent) => {
    e.stopPropagation() // 행 클릭(상세 모달)과 분리
    onOpenFiles()
  }
  if (fileCount > 0) {
    return (
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 text-xs text-foreground hover:bg-muted"
        title={`첨부파일 ${fileCount}건`}
        aria-label={`첨부파일 ${fileCount}건`}
      >
        <Paperclip className="h-3.5 w-3.5" />
        {fileCount}
      </button>
    )
  }
  if (!canWrite) return <span className="text-muted-foreground">—</span>
  return (
    <button
      type="button"
      onClick={open}
      className="whitespace-nowrap rounded px-1 py-0.5 text-[11px] text-muted-foreground/70 hover:bg-muted hover:text-foreground"
      title="첨부파일 추가"
    >
      + 첨부
    </button>
  )
}
