'use client'

/**
 * 병원 부가정보 카드 — '태그' 서브영역 (2026-09-28)
 * 마스터(3종 시드)는 엄격 정의, 여기서는 체크만. USER 이상 토글 → PUT 즉시 반영, VIEWER는 칩만.
 * 시스템 효과가 있는 태그(effectNote)는 설명에 함께 표시.
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { HospitalTagDto, HospitalTagAssignmentDto } from '@/lib/hospitalTags'

interface Props { hospitalCode: string; canWrite: boolean }

const kst = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

export default function HospitalTagsCard({ hospitalCode, canWrite }: Props) {
  const router = useRouter()
  const [tags, setTags] = useState<HospitalTagDto[]>([])
  const [assigned, setAssigned] = useState<HospitalTagAssignmentDto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [t, a] = await Promise.all([fetch('/api/hospital-tags'), fetch(`/api/hospitals/${hospitalCode}/tags`)])
    if (t.ok) setTags((await t.json()).tags ?? [])
    if (a.ok) setAssigned((await a.json()).assignments ?? [])
    setLoading(false)
  }, [hospitalCode])
  useEffect(() => { void load() }, [load])

  const assignedIds = new Set(assigned.map((a) => a.tag.id))

  async function toggle(tagId: number) {
    if (!canWrite || saving) return
    setSaving(tagId); setError('')
    const cur = Array.from(assignedIds)
    const next = assignedIds.has(tagId) ? cur.filter((id) => id !== tagId) : [...cur, tagId]
    try {
      const res = await fetch(`/api/hospitals/${hospitalCode}/tags`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tagIds: next }) })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? '저장 실패'); return }
      setAssigned(d.assignments ?? [])
      router.refresh()
    } finally { setSaving(null) }
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-700">부가정보</h2>
      </div>
      <div className="px-6 py-5">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-gray-400">태그</h3>
          {assigned.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {assigned.map((a) => (
                <span key={a.tag.id} className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${a.tag.color}22`, color: a.tag.color }} title={`${a.assignedBy?.name ?? '-'} · ${kst(a.assignedAt)}`}>
                  {a.tag.name}
                </span>
              ))}
            </span>
          )}
        </div>
        {loading ? (
          <p className="text-sm text-gray-400">불러오는 중...</p>
        ) : tags.length === 0 ? (
          <p className="text-sm text-gray-400">정의된 태그가 없습니다.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {tags.map((t) => {
              const on = assignedIds.has(t.id)
              const a = assigned.find((x) => x.tag.id === t.id)
              return (
                <li key={t.id}>
                  <label className={`flex items-start gap-2 rounded-md border px-3 py-2 ${on ? 'border-gray-300 bg-gray-50' : 'border-gray-200'} ${canWrite ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'}`}>
                    <input type="checkbox" checked={on} disabled={!canWrite || saving === t.id} onChange={() => toggle(t.id)} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.name}
                      </span>
                      {t.description && <span className="mt-0.5 block text-xs text-gray-500">{t.description}</span>}
                      {t.effectNote && <span className="mt-0.5 block text-[11px] text-amber-700">효과: {t.effectNote}</span>}
                      {on && a && <span className="mt-0.5 block text-[11px] text-gray-400">{a.assignedBy?.name ?? '-'} · {kst(a.assignedAt)}</span>}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {!canWrite && !loading && <p className="mt-2 text-xs text-gray-400">태그 변경은 USER 이상만 가능합니다.</p>}
      </div>
    </div>
  )
}
