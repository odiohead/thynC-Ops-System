'use client'

import type { ReactNode, Ref } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useOverlayDismiss } from '@/app/components/useOverlayDismiss'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** max-w-* 클래스 오버라이드 (기본 max-w-lg) */
  widthClass?: string
  /** 배경 클릭으로 닫기 (기본 true). 입력형 모달은 false — useUnsavedGuard와 함께 쓴다 */
  closeOnBackdrop?: boolean
  /** 대화상자 본문 ref — useUnsavedGuard의 ref를 넘기면 입력 여부를 감지한다 */
  dialogRef?: Ref<HTMLDivElement>
}

export default function Modal({ open, onClose, title, children, widthClass = 'max-w-lg', closeOnBackdrop = true, dialogRef }: ModalProps) {
  // ESC 닫기 + 열림 동안 배경 스크롤 잠금 (입력형은 onClose 자체가 확인을 거치는 requestClose)
  useOverlayDismiss(open, onClose)

  if (!open) return null

  return (
    // 모바일: 하단 시트 / sm 이상: 중앙 다이얼로그
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]" onClick={closeOnBackdrop ? onClose : undefined} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative flex max-h-[90dvh] w-full flex-col rounded-t-2xl border border-border bg-card text-card-foreground shadow-xl sm:max-h-[85dvh] sm:rounded-lg',
          widthClass
        )}
      >
        {/* 모바일 시트 그랩 핸들 */}
        <div className="flex shrink-0 justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <div className="h-1 w-9 rounded-full bg-muted-foreground/30" />
        </div>
        {title && (
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5 sm:py-4">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="-mr-1 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:p-1"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">{children}</div>
      </div>
    </div>
  )
}
