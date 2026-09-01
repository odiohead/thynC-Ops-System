'use client'

/**
 * 병원 콤보 (§6.1 헤더) — GROUP A
 * 고객(운영·계약완료·보류) ∪ 원장 보유 병원 사전 로드(options) + '☐ 전체 병원 검색' 토글(`searchHospitals` → /api/hospitals?search=, 20건).
 * SearchSelect(app/weekly/_components/SearchSelect.tsx) 재사용 — `onSearch?(q)` 비동기 옵션 1개를 하위 호환으로 추가해 사용.
 *  - 토글 off: 사전 로드 모집단을 로컬 필터(표시 50건 캡)
 *  - 토글 on : 검색어가 있으면 전체 병원 검색(20건) — 결과에서 고른 병원은 로컬 캐시에 남겨 라벨을 유지(orchestrator가 곧 단건 옵션을 합쳐 줌)
 * 라벨: '세란병원 (H0001) · 운영 · 원장 등록' — 옵션에 activeTotal이 실려 오면 '배치 중 n대'로 대체(현 HospitalOption은 registered만 보유)
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import SearchSelect, { type SearchSelectOption } from '@/app/weekly/_components/SearchSelect'
import { cn } from '@/lib/cn'
import { searchHospitals } from './api'
import type { HospitalOption } from './types'

export interface HospitalPickerProps {
  /** 선택 병원 코드('' 아님 — null = 미선택) */
  value: string | null
  /** 사전 로드 모집단(커버리지 전체 페이지) — URL 병원이 모집단 밖이면 orchestrator가 단건 옵션을 합쳐 준다 */
  options: HospitalOption[]
  loading?: boolean
  onChange: (code: string | null) => void
  className?: string
}

/** 전체 병원 검색 표시 건수(§6.1 — 20건) */
const SEARCH_LIMIT = 20

function optionLabel(o: HospitalOption): string {
  const parts = [`${o.hospitalName} (${o.hospitalCode})`]
  if (o.status) parts.push(o.status)
  // 커버리지 행에 배치 중 합계가 실려 오면 우선 표시(형상 확장 대비) — 없으면 registered 표식
  const activeTotal = (o as HospitalOption & { activeTotal?: number }).activeTotal
  if (typeof activeTotal === 'number' && activeTotal > 0) parts.push(`배치 중 ${activeTotal.toLocaleString()}대`)
  else if (o.registered) parts.push('원장 등록')
  return parts.join(' · ')
}

export function HospitalPicker({ value, options, loading, onChange, className }: HospitalPickerProps) {
  const [searchAll, setSearchAll] = useState(false)
  // 전체 검색 결과 캐시(code → option) — 모집단 밖 병원을 골랐을 때 라벨 유지
  const cacheRef = useRef<Map<string, HospitalOption>>(new Map())

  const mergedOptions = useMemo<SearchSelectOption[]>(() => {
    const list = options.map((o) => ({ value: o.hospitalCode, label: optionLabel(o) }))
    if (value && !options.some((o) => o.hospitalCode === value)) {
      const cached = cacheRef.current.get(value)
      if (cached) list.unshift({ value: cached.hospitalCode, label: optionLabel(cached) })
    }
    return list
  }, [options, value])

  const onSearch = useCallback(async (q: string): Promise<SearchSelectOption[]> => {
    const rows = (await searchHospitals(q)).slice(0, SEARCH_LIMIT)
    for (const r of rows) cacheRef.current.set(r.hospitalCode, r)
    return rows.map((r) => ({ value: r.hospitalCode, label: optionLabel(r) }))
  }, [])

  const handleChange = useCallback((v: string) => onChange(v || null), [onChange])

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <SearchSelect
        className="min-w-0 flex-1 basis-56"
        value={value ?? ''}
        onChange={handleChange}
        options={mergedOptions}
        placeholder={loading ? '병원 목록 불러오는 중…' : searchAll ? '병원 검색 (전체 병원 · 병원명/코드)' : '병원 검색 (병원명/코드)'}
        emptyLabel="— 병원 미선택 (전역 뷰) —"
        disabled={loading}
        onSearch={searchAll ? onSearch : undefined}
      />
      <label className="inline-flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground" title="고객 병원·원장 보유 병원 외 전체 병원 마스터에서 검색합니다 (20건)">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-input accent-primary"
          checked={searchAll}
          onChange={(e) => setSearchAll(e.target.checked)}
          disabled={loading}
        />
        전체 병원 검색
      </label>
    </div>
  )
}

export default HospitalPicker
