'use client'

import { useEffect } from 'react'

/**
 * 오버레이(드로어·모달·풀스크린 패널) 공통 동작 훅
 * - 열림 동안 배경(body) 스크롤 잠금 (lockScroll: false로 비활성 가능)
 * - ESC 키로 닫기
 */
export function useOverlayDismiss(
  open: boolean,
  onClose: () => void,
  { lockScroll = true }: { lockScroll?: boolean } = {}
) {
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    if (lockScroll) document.body.style.overflow = 'hidden'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      if (lockScroll) document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, lockScroll])
}
