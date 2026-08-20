'use client'

// 주간업무 리치텍스트 표시 — HTML(신규)·plain text(구 데이터) 하위호환 렌더 (2026-08-20)
// 서버 저장 시 sanitize되지만 방어적으로 표시 직전에도 한 번 더 정화한다.
import { useMemo, type CSSProperties } from 'react'
import { sanitizeRichTextHtml } from '@/lib/richtext'

interface Props {
  content: string
  /** 표 셀 요약용 줄수 제한 — 미지정 시 전체 표시 */
  clampLines?: number
  className?: string
}

export default function RichContent({ content, clampLines, className = '' }: Props) {
  const isHtml = content.trimStart().startsWith('<')
  const safe = useMemo(() => (isHtml ? sanitizeRichTextHtml(content) : content), [isHtml, content])

  const clampStyle: CSSProperties | undefined = clampLines
    ? {
        display: '-webkit-box',
        WebkitLineClamp: clampLines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }
    : undefined

  if (!isHtml) {
    return (
      <div className={`whitespace-pre-wrap ${className}`} style={clampStyle}>
        {safe}
      </div>
    )
  }
  return (
    <div
      className={`weekly-rich ${className}`}
      style={clampStyle}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}
