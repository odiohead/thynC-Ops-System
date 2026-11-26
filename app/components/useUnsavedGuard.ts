'use client'

import { useCallback, useEffect, useRef } from 'react'

/** 입력형 모달 닫기 확인 문구 — 화면마다 다르게 쓰지 않는다 */
export const UNSAVED_CLOSE_CONFIRM = '작성 중인 내용이 있습니다. 창을 닫으시겠습니까?'

/**
 * 입력형 모달의 작성 내용 유실 방지 (2026-11-26)
 * - `ref`를 모달 본문 컨테이너에 달면, 그 안에서 사용자가 입력(input·change·drop 이벤트)한 적이 있는지 기억한다.
 *   열 때마다 초기화. 프로그램이 넣은 기본값·수정 모달의 기존 값은 '입력'으로 치지 않는다.
 * - `requestClose`: 입력한 내용이 있으면 확인 후 닫고, 없으면 바로 닫는다 — X·취소·ESC에 쓴다.
 *   저장 성공 후 닫기는 원래 onClose를 그대로 부른다(확인 없음). 저장 후에도 창이 남는 화면은 `reset()`으로 입력 기록을 지운다.
 * - `dirty`를 주면 자동 판정 대신 그 값을 쓴다(입력 이벤트가 없는 선택형 컨트롤만으로 바뀌는 폼).
 * - 바깥(배경) 클릭으로 닫지 않는 것은 모달 쪽에서 한다 — 공통 Modal은 `closeOnBackdrop={false}`.
 */
export function useUnsavedGuard(open: boolean, onClose: () => void, opts: { dirty?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const touched = useRef(false)
  const { dirty } = opts

  useEffect(() => {
    if (!open) return
    touched.current = false
    const el = ref.current
    if (!el) return
    const mark = () => { touched.current = true }
    const events = ['input', 'change', 'drop'] as const // 입력·선택·파일 끌어다 놓기
    events.forEach((t) => el.addEventListener(t, mark, true))
    return () => events.forEach((t) => el.removeEventListener(t, mark, true))
  }, [open])

  const requestClose = useCallback(() => {
    const hasContent = dirty ?? touched.current
    if (hasContent && !window.confirm(UNSAVED_CLOSE_CONFIRM)) return
    onClose()
  }, [dirty, onClose])

  const reset = useCallback(() => { touched.current = false }, [])

  return { ref, requestClose, reset }
}
