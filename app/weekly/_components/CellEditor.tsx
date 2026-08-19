'use client'

// 여러 줄 텍스트 인라인 에디터 — draft를 로컬 상태로 격리 (금주 진행 셀·주간 특이사항 공용)
import { useState } from 'react'
import Button from '@/app/components/ui/Button'
import { Textarea } from '@/app/components/ui/Input'

interface Props {
  initial: string
  busy: boolean
  placeholder?: string
  onSave: (content: string) => void
  onCancel: () => void
}

export default function CellEditor({ initial, busy, placeholder, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(initial)
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Textarea
        autoFocus
        rows={4}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return // IME 조합 취소 Escape로 draft 소실 방지
          if (e.key === 'Escape') onCancel()
        }}
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
