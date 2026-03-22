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
    return (
      <span
        className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
        style={{ backgroundColor: color, color: getTextColor(color) }}
      >
        {label}
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
      {label}
    </span>
  )
}
