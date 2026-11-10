'use client'

/**
 * 파일 끌어다 놓기 영역 (2026-11-10) — 첨부 입력이 있는 모든 화면 공용.
 * 자식 영역 위로 파일을 끌어오면 테두리·배경이 강조되고, 놓으면 `onFiles(File[])`를 부른다. 클릭 동작·숨은 input은 그대로 호출부가 가진다.
 * - 파일이 아닌 드래그(텍스트 선택 등)는 무시 · 자식 요소 진입/이탈 깜박임은 depth 카운터로 방지 · disabled면 강조·드롭 모두 안 함
 * - `children`은 노드 또는 `(dragging) => 노드` 렌더 함수
 */
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react'

export default function FileDropZone({ onFiles, disabled = false, className = '', activeClassName = 'ring-2 ring-blue-400 ring-offset-1 bg-blue-50/40', children, label, testId }: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  className?: string
  /** 드래그 중 덧붙는 클래스 */
  activeClassName?: string
  children: ReactNode | ((dragging: boolean) => ReactNode)
  /** 드래그 중 영역 가운데에 띄울 문구 (기본 '여기에 놓으면 첨부됩니다') — null이면 표시 안 함 */
  label?: string | null
  testId?: string
}) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault(); e.stopPropagation()
    depth.current += 1
    setDragging(true)
  }, [disabled])
  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [disabled])
  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault(); e.stopPropagation()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }, [disabled])
  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault(); e.stopPropagation()
    depth.current = 0
    setDragging(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) onFiles(files)
  }, [disabled, onFiles])

  const text = label === undefined ? '여기에 놓으면 첨부됩니다' : label
  return (
    <div
      onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      className={`relative rounded-md transition-colors ${className} ${dragging ? activeClassName : ''}`}
      data-testid={testId} data-dragging={dragging ? 'true' : undefined}
    >
      {typeof children === 'function' ? children(dragging) : children}
      {dragging && text && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-white/70">
          <span className="rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{text}</span>
        </div>
      )}
    </div>
  )
}
