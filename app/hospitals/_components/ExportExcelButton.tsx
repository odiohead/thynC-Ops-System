'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

interface StatusOption {
  name: string
  color: string | null
}

/**
 * 병원 목록 Excel 다운로드 — 버튼 클릭 시 병원종·상태 선택 모달을 띄우고,
 * 체크한 항목만 내보낸다. 병원 테이블에 HIRA 전수(8만건대)가 있어 무필터 전량 내보내기를 막기 위함.
 * 목록에 이미 걸린 검색어·시도는 그대로 함께 적용되며, 병원종·상태는 모달 선택이 우선한다.
 * 선택이 바뀔 때마다 대상 건수를 미리 조회해 규모를 보여준다.
 */
export default function ExportExcelButton({
  statusOptions,
  typeOptions,
}: {
  statusOptions: StatusOption[]
  typeOptions: string[]
}) {
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [types, setTypes] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const search = searchParams.get('search') ?? ''
  const sido = searchParams.get('sido') ?? ''
  const nothingPicked = types.length === 0 && statuses.length === 0

  /** 모달을 열 때 목록에 걸려 있는 병원종·상태를 초기 선택값으로 가져온다 */
  function openModal() {
    setTypes(searchParams.getAll('type').filter(Boolean))
    setStatuses(searchParams.getAll('status').filter(Boolean))
    setError('')
    setCount(null)
    setOpen(true)
  }

  const buildParams = useCallback(() => {
    const qs = new URLSearchParams()
    if (search) qs.set('search', search)
    if (sido) qs.set('sido', sido)
    types.forEach((t) => qs.append('type', t))
    statuses.forEach((s) => qs.append('status', s))
    return qs
  }, [search, sido, types, statuses])

  // 선택이 바뀌면 대상 건수 미리 조회 (디바운스 + 이전 요청 취소)
  useEffect(() => {
    if (!open || nothingPicked) {
      setCount(null)
      return
    }
    const ctrl = new AbortController()
    setCounting(true)
    const timer = setTimeout(async () => {
      try {
        const qs = buildParams()
        qs.set('countOnly', '1')
        const res = await fetch(`/api/hospitals/export?${qs.toString()}`, { signal: ctrl.signal })
        if (!res.ok) throw new Error()
        setCount((await res.json()).count ?? null)
      } catch {
        if (!ctrl.signal.aborted) setCount(null)
      } finally {
        if (!ctrl.signal.aborted) setCounting(false)
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [open, nothingPicked, buildParams])

  async function download() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/hospitals/export?${buildParams().toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '다운로드에 실패했습니다.')

      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = m ? decodeURIComponent(m[1]) : '병원목록.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const checkboxCls = 'h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500'
  const chipCls = (checked: boolean) =>
    `flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${
      checked ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
    }`

  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        엑셀 다운로드
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900">엑셀 다운로드 대상 선택</h3>
            <p className="mt-1 text-xs text-gray-500">
              병원종·상태를 <b>1개 이상</b> 선택해야 합니다. 전체 병원 데이터는 8만 건이 넘어 파일이 매우 커집니다.
              {(search || sido) && (
                <>
                  <br />
                  현재 목록 필터도 함께 적용됩니다 —{' '}
                  {search && <b>검색어 &lsquo;{search}&rsquo;</b>}
                  {search && sido && ' · '}
                  {sido && <b>시도 &lsquo;{sido}&rsquo;</b>}
                </>
              )}
            </p>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">병원종</span>
                <button onClick={() => setTypes(typeOptions)} className="text-xs text-blue-600 hover:underline">
                  전체선택
                </button>
                {types.length > 0 && (
                  <button onClick={() => setTypes([])} className="text-xs text-red-500 hover:underline">
                    해제
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
                {typeOptions.map((opt) => (
                  <label key={opt} className={chipCls(types.includes(opt))}>
                    <input
                      type="checkbox"
                      checked={types.includes(opt)}
                      onChange={() => toggle(types, setTypes, opt)}
                      className={checkboxCls}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">상태</span>
                <button
                  onClick={() => setStatuses(statusOptions.map((s) => s.name))}
                  className="text-xs text-blue-600 hover:underline"
                >
                  전체선택
                </button>
                {statuses.length > 0 && (
                  <button onClick={() => setStatuses([])} className="text-xs text-red-500 hover:underline">
                    해제
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
                {statusOptions.map((opt) => (
                  <label key={opt.name} className={chipCls(statuses.includes(opt.name))}>
                    <input
                      type="checkbox"
                      checked={statuses.includes(opt.name)}
                      onChange={() => toggle(statuses, setStatuses, opt.name)}
                      className={checkboxCls}
                    />
                    {opt.color && (
                      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: opt.color }} />
                    )}
                    {opt.name}
                  </label>
                ))}
              </div>
            </div>

            <p className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {nothingPicked
                ? '병원종 또는 상태를 선택하세요.'
                : counting
                  ? '대상 건수 확인 중…'
                  : count === null
                    ? '건수를 확인할 수 없습니다.'
                    : `대상 ${count.toLocaleString()}건`}
              {count !== null && count > 10000 && (
                <span className="ml-1 text-amber-700">— 건수가 많아 생성에 시간이 걸립니다.</span>
              )}
            </p>

            {error && <p className="mt-2 text-sm text-red-600">✗ {error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={download}
                disabled={busy || nothingPicked || count === 0}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? '생성 중…' : '다운로드'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
