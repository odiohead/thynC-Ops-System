'use client'

/** 병원 태그 칩 (읽기 전용) — AS접수 상세 등 타 화면에서 병원 태그를 한눈에. 시스템 태그(선교체 기본 등)는 강조 (2026-09-29) */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { HospitalTagAssignmentDto } from '@/lib/hospitalTags'
import { HOSPITAL_TAG_KEYS } from '@/lib/hospitalTags'

export default function HospitalTagChips({ hospitalCode, emphasizeKeys = [HOSPITAL_TAG_KEYS.PRE_REPLACE_DEFAULT] }: { hospitalCode: string; emphasizeKeys?: string[] }) {
  const [assigned, setAssigned] = useState<HospitalTagAssignmentDto[] | null>(null)
  useEffect(() => { fetch(`/api/hospitals/${hospitalCode}/tags`).then((r) => (r.ok ? r.json() : null)).then((d) => setAssigned(d?.assignments ?? [])) }, [hospitalCode])
  if (assigned === null) return <span className="text-xs text-gray-400">불러오는 중...</span>
  if (assigned.length === 0) return <span className="text-sm text-gray-400">태그 없음 <Link href={`/hospitals/${hospitalCode}`} className="text-xs text-blue-600 hover:underline">병원에서 설정</Link></span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      {assigned.map((a) => {
        const strong = emphasizeKeys.includes(a.tag.key)
        return (
          <span key={a.tag.id} title={a.tag.effectNote ?? a.tag.description ?? ''} className={`rounded-full px-2 py-0.5 text-xs font-medium ${strong ? 'ring-1' : ''}`} style={{ backgroundColor: `${a.tag.color}22`, color: a.tag.color, ...(strong ? { boxShadow: `0 0 0 1px ${a.tag.color}` } : {}) }}>
            {strong && '★ '}{a.tag.name}
          </span>
        )
      })}
    </span>
  )
}
