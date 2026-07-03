'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type HospitalHit = {
  hospitalCode: string
  hospitalName: string
  status?: string | null
}

type Props = {
  fromHospitalCode: string
  fromHospitalName?: string | null
  /** SUPER_ADMIN일 때만 노출 */
  canTransfer: boolean
}

/**
 * Phase 2: 이 병원의 모든 업무(프로젝트/답사/설치계획/유지보수/상담)를 다른 병원으로 일괄 이전.
 * 병원을 통째로 잘못 만든 경우 정리용. SUPER_ADMIN 전용.
 */
export default function TransferAllWorkButton({
  fromHospitalCode,
  fromHospitalName,
  canTransfer,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'search' | 'confirm'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HospitalHit[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<HospitalHit | null>(null)
  const [updateNames, setUpdateNames] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

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

  if (!canTransfer) return null

  const reset = () => {
    setOpen(false)
    setStep('search')
    setQuery('')
    setResults([])
    setSelected(null)
    setError('')
    setUpdateNames(true)
  }

  const pick = (h: HospitalHit) => {
    if (h.hospitalCode === fromHospitalCode) {
      setError('같은 병원입니다.')
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
      const res = await fetch(`/api/hospitals/${fromHospitalCode}/transfer-work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toHospitalCode: selected.hospitalCode, updateProjectNames: updateNames }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `일괄 이전 실패 (${res.status})`)
        return
      }
      reset()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '일괄 이전 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
        title="이 병원의 모든 업무를 다른 병원으로 옮깁니다 (병원을 통째로 잘못 만든 경우)"
      >
        업무 일괄 이전
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
              <h2 className="text-base font-semibold text-gray-900">업무 일괄 이전</h2>
              <button onClick={reset} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="px-4 py-3">
              <p className="mb-3 text-xs text-gray-500">
                원본 병원:{' '}
                <span className="font-medium text-gray-800">
                  {fromHospitalName || fromHospitalCode}
                </span>
                <br />이 병원의 <b>모든 업무</b>(프로젝트·답사·설치계획·유지보수·상담)를 다른 병원으로 옮깁니다.
              </p>

              {step === 'search' && (
                <>
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="옮길 대상(올바른) 병원 검색"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
                  <div className="mt-2 max-h-72 overflow-y-auto">
                    {loading && <div className="p-3 text-sm text-gray-400">검색 중…</div>}
                    {!loading && query.trim() && results.length === 0 && (
                      <div className="p-3 text-sm text-gray-400">검색 결과 없음</div>
                    )}
                    {results.map((h) => {
                      const isSame = h.hospitalCode === fromHospitalCode
                      return (
                        <button
                          key={h.hospitalCode}
                          disabled={isSame}
                          onClick={() => pick(h)}
                          className={`block w-full rounded px-3 py-2 text-left ${
                            isSame ? 'cursor-not-allowed opacity-40' : 'hover:bg-blue-50'
                          }`}
                        >
                          <span className="text-sm font-medium text-gray-800">{h.hospitalName}</span>
                          <span className="ml-2 text-xs text-gray-400">
                            {h.hospitalCode}
                            {h.status ? ` · ${h.status}` : ''}
                            {isSame ? ' · 현재 병원' : ''}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {step === 'confirm' && selected && (
                <div>
                  <div className="rounded-md bg-red-50 p-3 text-sm">
                    <div className="font-medium text-red-800">
                      {fromHospitalName || fromHospitalCode}의 <b>모든 업무</b>를
                    </div>
                    <div className="mt-1 font-medium text-gray-800">
                      <span className="text-blue-700">{selected.hospitalName}</span> 으로 이전합니다.
                    </div>
                  </div>

                  <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={updateNames}
                      onChange={(e) => setUpdateNames(e.target.checked)}
                    />
                    프로젝트명에 포함된 병원명도 <b>{selected.hospitalName}</b>으로 변경
                  </label>

                  <p className="mt-3 text-xs text-gray-500">
                    두 병원 상태가 자동 재계산됩니다. 되돌리려면 반대로 다시 이전해야 합니다.
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
                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                    >
                      {submitting ? '이전 중…' : '일괄 이전'}
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
