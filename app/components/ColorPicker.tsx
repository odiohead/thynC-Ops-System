'use client'

const PALETTE = [
  '#3B82F6', '#60A5FA', '#93C5FD',
  '#10B981', '#34D399', '#6EE7B7',
  '#F59E0B', '#FCD34D',
  '#EF4444', '#F87171',
  '#8B5CF6', '#A78BFA',
  '#F97316', '#FB923C',
  '#14B8A6', '#2DD4BF',
  '#EC4899', '#F472B6',
  '#6B7280', '#9CA3AF',
  '#1F2937', '#FFFFFF',
]

interface ColorPickerProps {
  value: string
  onChange: (v: string) => void
}

export default function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="space-y-2.5">
      {/* 미리보기 + 색상 없음 버튼 */}
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-5 w-5 shrink-0 rounded-full border border-gray-300"
          style={{ backgroundColor: value || 'transparent' }}
        />
        <span className="font-mono text-xs text-gray-500">{value || '색상 없음'}</span>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50"
          >
            색상 없음
          </button>
        )}
      </div>

      {/* 팔레트 */}
      <div className="flex flex-wrap gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${
              value === c ? 'border-gray-700 scale-110' : 'border-transparent'
            }`}
            style={{
              backgroundColor: c,
              boxShadow: c === '#FFFFFF' ? 'inset 0 0 0 1px #d1d5db' : undefined,
            }}
          />
        ))}
      </div>

      {/* 직접 입력 */}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || '#6B7280'}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-7 cursor-pointer rounded border border-gray-300"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value
            if (v === '' || /^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v)
          }}
          placeholder="#000000"
          className="w-28 rounded border border-gray-300 px-2 py-1 font-mono text-xs focus:border-blue-400 focus:outline-none"
        />
      </div>
    </div>
  )
}
