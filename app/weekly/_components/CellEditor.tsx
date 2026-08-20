'use client'

// 인라인 리치텍스트 에디터 — draft를 로컬 상태로 격리 (금주 진행 셀·주간 특이사항 공용)
// 2026-08-20: Textarea → WeeklyRichEditor (마크다운 입력 규칙 + 글자색·형광펜)
import { useState } from 'react'
import Button from '@/app/components/ui/Button'
import WeeklyRichEditor, { toEditableHtml } from './WeeklyRichEditor'

interface Props {
  initial: string
  busy: boolean
  placeholder?: string
  onSave: (content: string) => void
  onCancel: () => void
}

export default function CellEditor({ initial, busy, placeholder, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(() => toEditableHtml(initial))
  return (
    <div onClick={(e) => e.stopPropagation()} className="min-w-[240px]">
      <WeeklyRichEditor
        initial={initial}
        placeholder={placeholder}
        onChange={setDraft}
        onEscape={onCancel}
      />
      <div className="mt-1.5 flex gap-1.5">
        <Button size="sm" onClick={() => onSave(draft)} disabled={busy}>
          저장
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
  )
}
