'use client'

import { useState } from 'react'

type State = 'idle' | 'loading' | 'success' | 'error'

export default function ExportToDriveButton() {
  const [state, setState] = useState<State>('idle')
  const [result, setResult] = useState<{ name: string; webViewLink: string; count: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleClick() {
    setState('loading')
    setResult(null)
    setErrorMsg('')

    try {
      const res = await fetch('/api/drive/export/hospitals', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error ?? '전송에 실패했습니다.')
      }

      setResult({ name: data.name, webViewLink: data.webViewLink, count: data.count })
      setState('success')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.')
      setState('error')
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={state === 'loading'}
        className="flex items-center gap-2 rounded-lg border border-green-600 bg-white px-4 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === 'loading' ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            전송 중...
          </>
        ) : (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <polyline points="9 14 12 17 15 14" />
            </svg>
            공유폴더로 전송
          </>
        )}
      </button>

      {state === 'success' && result && (
        <p className="text-xs text-green-600">
          ✓ {result.count.toLocaleString()}건 전송 완료 —{' '}
          <a href={result.webViewLink} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-800">
            {result.name}
          </a>
        </p>
      )}

      {state === 'error' && (
        <p className="text-xs text-red-500">✗ {errorMsg}</p>
      )}
    </div>
  )
}
