'use client'

// 주간업무 첨부파일 레이어 — 목표일 셀 트리거에서 여는 Modal (projects/weekly_attachments_design.md §3.2)
import Modal from '@/app/components/ui/Modal'
import WeeklyFilesPanel from './WeeklyFilesPanel'

interface Props {
  item: { id: number; title: string } | null
  canWrite: boolean
  onClose: () => void
  onChanged?: (itemId: number, count: number) => void
}

export default function FilesModal({ item, canWrite, onClose, onChanged }: Props) {
  const title = item ? `첨부파일 — ${item.title.length > 40 ? `${item.title.slice(0, 40)}…` : item.title}` : '첨부파일'
  return (
    <Modal open={item != null} onClose={onClose} title={title} widthClass="max-w-xl">
      {item && (
        <WeeklyFilesPanel
          key={item.id}
          itemId={item.id}
          canWrite={canWrite}
          onChanged={(count) => onChanged?.(item.id, count)}
        />
      )}
    </Modal>
  )
}
