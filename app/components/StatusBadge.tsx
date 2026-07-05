import type { CSSProperties } from 'react'

function getTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? '#1f2937' : '#ffffff'
}

interface StatusBadgeProps {
  label: string
  color?: string | null
}

export default function StatusBadge({ label, color }: StatusBadgeProps) {
  if (color) {
    // 라이트: 원색 배경 + 명도 기반 텍스트 / 다크: globals.css의 .dark .status-badge-dynamic이 틴트로 변환
    const style = {
      '--sb-color': color,
      '--sb-text': getTextColor(color),
    } as CSSProperties
    return (
      <span
        className="status-badge-dynamic inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
        style={style}
      >
        {label}
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  )
}
