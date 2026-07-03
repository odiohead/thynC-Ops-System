'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type WorkItemType = 'PROJECT' | 'SITE_VISIT' | 'INSTALL_PLAN' | 'MAINTENANCE'

type HospitalHit = {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName?: string | null
  status?: string | null
}

type Props = {
  type: WorkItemType
  /** 업무 고유 코드 (projectCode / siteVisitCode / planCode / maintenanceCode) */
  code: string
  currentHospitalCode: string | null
  currentHospitalName?: string | null
  /** ADMIN 이상일 때만 노출. 생략하면 컴포넌트가 /api/auth/me로 자체 판별 */
  canReassign?: boolean
  className?: string
}

const TYPE_LABEL: Record<WorkItemType, string> = {
  PROJECT: '프로젝트',
  SITE_VISIT: '답사',
  INSTALL_PLAN: '설치계획',
  MAINTENANCE: '유지보수',
}

export default function ReassignHospitalButton({
  type,
  code,
  currentHospitalCode,
  currentHospitalName,
  canReassign,
  className,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'search' | 'confirm'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HospitalHit[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<HospitalHit | null>(null)
  const [updateName, setUpdateName] = useState(type === 'PROJECT')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 권한: prop 제공 시 사용, 아니면 자체 조회 (ADMIN 이상)
  const [allowed, setAllowed] = useState<boolean>(canReassign ?? false)
  useEffect(() => {
    if (canReassign !== undefined) {
      setAllowed(canReassign)
      return
    }
    let cancelled = false
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setAllowed(d?.role === 'ADMIN' || d?.role === 'SUPER_ADMIN')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [canReassign])

  useEffect(() => {
    if (!open || step !== 'search') return
    const term = query.trim()
    if (!term) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hospitals?search=${encodeURIComponent(term)}&limit=20`)
        const data = await res.json().catch(() => ({}))
        if (!cancelled) setResults((data.hospitals as HospitalHit[]) ?? [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, step, query])

  if (!allowed) return null

  const reset = () => {
    setOpen(false)
    setStep('search')
    setQuery('')
    setResults([])
    setSelected(null)
    setError('')
    setUpdateName(type === 'PROJECT')
  }

  const pick = (h: HospitalHit) => {
    if (h.hospitalCode === currentHospitalCode) {
      setError('현재와 동일한 병원입니다.')
      return
    }
    setSelected(h)
    setError('')
    setStep('confirm')
  }

  const submit = async () => {
    if (!selected) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/work-items/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          code,
          newHospitalCode: selected.hospitalCode,
          updateProjectName: type === 'PROJECT' ? updateName : false,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `재지정 실패 (${res.status})`)
        return
      }
      reset()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '재지정 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          className ??
          'rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100'
        }
        title="잘못 지정된 병원을 바로잡습니다"
      >
        병원 재지정
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
          onClick={reset}
        >
          <div
            className="w-full max-w-lg rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-base font-semibold text-gray-900">
                {TYPE_LABEL[type]} 병원 재지정
              </h2>
              <button onClick={reset} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="px-4 py-3">
              <p className="mb-3 text-xs text-gray-500">
                현재 병원:{' '}
                <span className="font-medium text-gray-800">
                  {currentHospitalName || currentHospitalCode || '(없음)'}
                </span>
              </p>

              {step === 'search' && (
                <>
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="올바른 병원명을 검색하세요"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
                  <div className="mt-2 max-h-72 overflow-y-auto">
                    {loading && <div className="p-3 text-sm text-gray-400">검색 중…</div>}
                    {!loading && query.trim() && results.length === 0 && (
                      <div className="p-3 text-sm text-gray-400">검색 결과 없음</div>
                    )}
                    {results.map((h) => {
                      const isCurrent = h.hospitalCode === currentHospitalCode
                      return (
                        <button
                          key={h.hospitalCode}
                          disabled={isCurrent}
                          onClick={() => pick(h)}
                          className={`block w-full rounded px-3 py-2 text-left ${
                            isCurrent
                              ? 'cursor-not-allowed opacity-40'
                              : 'hover:bg-blue-50'
                          }`}
                        >
                          <span className="text-sm font-medium text-gray-800">
                            {h.hospitalName}
                          </span>
                          <span className="ml-2 text-xs text-gray-400">
                            {h.hospitalCode}
                            {h.status ? ` · ${h.status}` : ''}
                            {isCurrent ? ' · 현재 병원' : ''}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {step === 'confirm' && selected && (
                <div>
                  <div className="rounded-md bg-gray-50 p-3 text-sm">
                    <div className="text-gray-500">이 {TYPE_LABEL[type]}의 병원을 변경합니다:</div>
                    <div className="mt-1 font-medium text-gray-800">
                      {currentHospitalName || currentHospitalCode || '(없음)'}{' '}
                      <span className="text-gray-400">→</span>{' '}
                      <span className="text-blue-700">{selected.hospitalName}</span>
                    </div>
                  </div>

                  {type === 'PROJECT' && (
                    <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={updateName}
                        onChange={(e) => setUpdateName(e.target.checked)}
                      />
                      프로젝트명에 포함된 병원명도 <b>{selected.hospitalName}</b>으로 변경
                    </label>
                  )}

                  <p className="mt-3 text-xs text-gray-500">
                    두 병원의 현황 상태가 실제 업무에 맞게 자동 재계산됩니다. 담당자·첨부·일정은 그대로
                    유지됩니다.
                  </p>
                  {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setStep('search')
                        setSelected(null)
                        setError('')
                      }}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      뒤로
                    </button>
                    <button
                      onClick={submit}
                      disabled={submitting}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                    >
                      {submitting ? '처리 중…' : '재지정'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
