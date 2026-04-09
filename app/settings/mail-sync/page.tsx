'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const INTERVAL_OPTIONS = [
  { value: '30m', label: '30분' },
  { value: '1h', label: '1시간' },
  { value: '2h', label: '2시간' },
  { value: '6h', label: '6시간' },
  { value: 'off', label: 'OFF' },
]

export default function MailSyncSettingsPage() {
  const router = useRouter()
  const [interval, setInterval] = useState('off')
  const [activeInterval, setActiveInterval] = useState('off')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((me) => {
        const admin = !!me?.role && (me.role === 'SUPER_ADMIN' || me.role === 'ADMIN')
        setIsAdmin(admin)
        setAuthChecked(true)
        if (!admin) router.push('/')
      })
  }, [router])

  useEffect(() => {
    if (isAdmin) {
      fetch('/api/settings/mail-sync')
        .then((r) => r.json())
        .then((data) => {
          setInterval(data.interval)
          setActiveInterval(data.activeInterval)
        })
    }
  }, [isAdmin])

  async function handleSave() {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/settings/mail-sync', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval }),
      })
      if (res.ok) {
        const data = await res.json()
        setActiveInterval(interval)
        setMessage(data.message)
        setTimeout(() => setMessage(''), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!authChecked) return null

  const activeLabel = INTERVAL_OPTIONS.find((o) => o.value === activeInterval)?.label || activeInterval

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">메일 동기화 설정</h1>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <p className="text-sm text-gray-500 mb-1">현재 상태</p>
            <p className="text-sm font-medium">
              {activeInterval === 'off' ? (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">OFF</span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  {activeLabel} 간격으로 실행 중
                </span>
              )}
            </p>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">동기화 주기</label>
            <div className="flex flex-wrap gap-2">
              {INTERVAL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setInterval(opt.value)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    interval === opt.value
                      ? opt.value === 'off'
                        ? 'bg-gray-800 text-white'
                        : 'bg-blue-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              설정한 주기마다 Gmail에서 새 메일을 자동으로 가져옵니다. PM2 재시작 후에도 설정이 유지됩니다.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            {message && (
              <span className="text-sm text-green-600">{message}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
