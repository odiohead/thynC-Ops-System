'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * 병원 목록 Excel 다운로드 — 현재 걸린 필터(search/sido/status/type)를 그대로 서버로 넘겨
 * 페이지네이션 없이 조건에 맞는 전체를 받는다. page 파라미터는 제외.
 */
/** 이 건수를 넘으면 파일이 커지고(수십 MB) 생성에 수 초 걸려 사전 확인을 받는다 */
const CONFIRM_OVER = 10000

export default function ExportExcelButton({ total }: { total: number }) {
  const searchParams = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleClick() {
    if (
      total > CONFIRM_OVER &&
      !confirm(
        `현재 조건에 ${total.toLocaleString()}건이 해당합니다.\n파일이 크고 생성에 시간이 걸릴 수 있습니다. 계속할까요?\n\n(필터를 좁히면 더 빠릅니다)`
      )
    )
      return

    setBusy(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      for (const key of ['search', 'sido', 'status', 'type']) {
        for (const v of searchParams.getAll(key)) if (v) qs.append(key, v)
      }
      const res = await fetch(`/api/hospitals/export?${qs.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '다운로드에 실패했습니다.')

      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd)
      const name = m ? decodeURIComponent(m[1]) : '병원목록.xlsx'

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            생성 중...
          </>
        ) : (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            엑셀 다운로드
          </>
        )}
      </button>
      {error && <p className="text-xs text-red-500">✗ {error}</p>}
    </div>
  )
}
