'use client'

/**
 * 모바일 하단 고정 액션바 [등록][교체][회수] (§6.1 모바일) — GROUP C
 * md:hidden. [회수]는 선택 0건이면 스캔 모드(orchestrator가 RecoverModal scanMode로 연다 — 시리얼 입력줄 autoFocus). canWrite=false면 렌더하지 않음.
 * safe-area 하단 패딩. 토스트는 이 바 위에 뜬다(toast.tsx bottom 계산 참고). 페이지는 pb-24로 바 높이만큼 여백을 둔다(DevicesClient).
 */
import Button from '@/app/components/ui/Button'

export interface MobileActionBarProps {
  canWrite: boolean
  /** 선택 기기 수 — [회수] 라벨에 'n대' 병기 */
  selectedCount: number
  onRegister: () => void
  onReplace: () => void
  onRecover: () => void
}

export function MobileActionBar({ canWrite, selectedCount, onRegister, onReplace, onRecover }: MobileActionBarProps) {
  if (!canWrite) return null
  const hasSelection = selectedCount > 0
  return (
    <div
      role="toolbar"
      aria-label="기기 액션"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-4px_12px_-6px_hsl(var(--foreground)/0.15)] backdrop-blur md:hidden"
    >
      {hasSelection && (
        <div className="mb-1.5 text-center text-[11px] tabular-nums text-muted-foreground">
          선택 {selectedCount.toLocaleString()}대
        </div>
      )}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={onRegister} aria-label="기기 등록">
          등록
        </Button>
        <Button className="flex-1" variant="outline" onClick={onReplace} aria-label="기기 교체">
          교체
        </Button>
        <Button
          className="flex-1"
          variant={hasSelection ? 'secondary' : 'outline'}
          onClick={onRecover}
          aria-label={hasSelection ? `선택 ${selectedCount}대 회수` : '회수 (시리얼 스캔)'}
          title={hasSelection ? undefined : '선택이 없으면 시리얼 스캔 모드로 엽니다'}
        >
          회수{hasSelection ? ` ${selectedCount.toLocaleString()}대` : ''}
        </Button>
      </div>
    </div>
  )
}

export default MobileActionBar
