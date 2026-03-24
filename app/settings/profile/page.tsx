'use client'

import { useState, useEffect } from 'react'

interface Me {
  id: string
  email: string
  name: string
  phone: string
  role: 'ADMIN' | 'USER' | 'VIEWER'
  isActive: boolean
}

const ROLE_LABEL: Record<string, string> = { ADMIN: '관리자', USER: '일반', VIEWER: '뷰어' }

const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400'
const labelClass = 'block text-sm font-medium text-gray-700'

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  // 기본 정보 폼
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [infoSaving, setInfoSaving] = useState(false)
  const [infoMsg, setInfoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 비밀번호 변경 폼
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (!data?.id) {
          setLoading(false)
          return
        }
        setMe(data)
        setName(data.name ?? '')
        setPhone(data.phone ?? '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleInfoSave(e: React.FormEvent) {
    e.preventDefault()
    if (!me) return
    setInfoSaving(true)
    setInfoMsg(null)
    try {
      const res = await fetch(`/api/users/${me.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInfoMsg({ type: 'error', text: data.error ?? '저장에 실패했습니다.' })
      } else {
        setMe((prev) => prev ? { ...prev, name: data.name, phone: data.phone } : prev)
        setInfoMsg({ type: 'success', text: '저장되었습니다.' })
      }
    } catch {
      setInfoMsg({ type: 'error', text: '서버 오류가 발생했습니다.' })
    } finally {
      setInfoSaving(false)
    }
  }

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault()
    if (!me) return
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' })
      return
    }
    setPwSaving(true)
    setPwMsg(null)
    try {
      const res = await fetch(`/api/users/${me.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPwMsg({ type: 'error', text: data.error ?? '변경에 실패했습니다.' })
      } else {
        setPwMsg({ type: 'success', text: '비밀번호가 변경되었습니다.' })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      }
    } catch {
      setPwMsg({ type: 'error', text: '서버 오류가 발생했습니다.' })
    } finally {
      setPwSaving(false)
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-gray-500">로딩 중...</div>
  }

  if (!me) return null

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">내 프로필</h1>

      {/* 계정 정보 (읽기 전용) */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-700">계정 정보</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-5 sm:grid-cols-2">
          <div>
            <label className={labelClass}>이메일</label>
            <input type="text" value={me.email} disabled className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>역할</label>
            <input type="text" value={ROLE_LABEL[me.role] ?? me.role} disabled className={inputClass} />
          </div>
        </div>
      </div>

      {/* 기본 정보 수정 */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-700">기본 정보</h2>
        </div>
        <form onSubmit={handleInfoSave}>
          <div className="grid grid-cols-1 gap-4 px-6 py-5 sm:grid-cols-2">
            <div>
              <label className={labelClass}>이름 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>전화번호</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                className={inputClass}
              />
            </div>
          </div>
          {infoMsg && (
            <div className={`mx-6 mb-4 rounded-lg px-4 py-2 text-sm ${infoMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {infoMsg.text}
            </div>
          )}
          <div className="flex justify-end px-6 pb-5">
            <button
              type="submit"
              disabled={infoSaving}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {infoSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>

      {/* 비밀번호 변경 */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-700">비밀번호 변경</h2>
        </div>
        <form onSubmit={handlePasswordSave}>
          <div className="space-y-4 px-6 py-5">
            <div>
              <label className={labelClass}>현재 비밀번호 *</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>새 비밀번호 * <span className="text-gray-400 font-normal">(6자 이상)</span></label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>새 비밀번호 확인 *</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
          </div>
          {pwMsg && (
            <div className={`mx-6 mb-4 rounded-lg px-4 py-2 text-sm ${pwMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {pwMsg.text}
            </div>
          )}
          <div className="flex justify-end px-6 pb-5">
            <button
              type="submit"
              disabled={pwSaving}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {pwSaving ? '변경 중...' : '비밀번호 변경'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
