'use client'

/**
 * 선택 액션 바 (§6.1-B '선택 시: [병동 이동] [회수] [상품유형 지정]') — GROUP B
 * 선택 > 0 이면 탭 콘텐츠 상단에 sticky로 뜬다. count = 선택 기기 수(전체 선택 포함), note = '검색 결과 전체 선택 2,000건(상한)' 같은 안내.
 * 쓰기 권한이 없으면 버튼 대신 안내 문구 + [선택 해제]만.
 */
import { CheckSquare, X } from 'lucide-react'
import Button from '@/app/components/ui/Button'

export interface BulkActionBarProps {
  count: number
  canWrite: boolean
  onMove: () => void
  onRecover: () => void
  /** 상품유형(일반/라이트) 일괄 지정 — B-22 */
  onSetProductType?: () => void
  onClear: () => void
  note?: string | null
}

export function BulkActionBar({ count, canWrite, onMove, onRecover, onSetProductType, onClear, note }: BulkActionBarProps) {
  if (count === 0) return null
  return (
    <div
      role="toolbar"
      aria-label="선택 기기 작업"
      className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary-subtle px-3 py-2 text-sm text-primary-subtle-foreground shadow-sm"
    >
      <CheckSquare size={16} className="shrink-0" aria-hidden="true" />
      <span className="font-semibold tabular-nums">{count.toLocaleString()}대 선택</span>
      {note && <span className="text-xs opacity-80">· {note}</span>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canWrite ? (
          <>
            <Button size="sm" variant="outline" onClick={onMove}>
              병동 이동
            </Button>
            <Button size="sm" variant="outline" onClick={onRecover}>
              회수
            </Button>
            {onSetProductType && (
              <Button size="sm" variant="outline" onClick={onSetProductType} title="선택 기기의 상품유형(일반/라이트)을 한 번에 지정 — 기기마다 정정 이벤트">
                상품유형 지정
              </Button>
            )}
          </>
        ) : (
          <span className="text-xs opacity-80">일괄 이동·회수는 USER 등급부터 가능합니다</span>
        )}
        <Button size="sm" variant="ghost" onClick={onClear} className="gap-1">
          <X size={14} aria-hidden="true" />
          선택 해제
        </Button>
      </div>
    </div>
  )
}

export default BulkActionBar
