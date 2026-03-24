'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface User {
  id: string
  email: string
  name: string
  phone: string
  role: 'ADMIN' | 'USER' | 'VIEWER'
  isActive: boolean
  createdAt: string
}

const ROLE_LABEL: Record<string, string> = { ADMIN: '관리자', USER: '일반', VIEWER: '뷰어' }
const ROLE_CLASS: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-700',
  USER: 'bg-gray-100 text-gray-700',
  VIEWER: 'bg-blue-100 text-blue-700',
}

const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function UsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // 계정 생성 모달
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', name: '', phone: '', role: 'USER' as 'ADMIN' | 'USER' | 'VIEWER' })
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 내 정보 수정 모달
  const [showEditModal, setShowEditModal] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [editError, setEditError] = useState('')
  const [editSuccess, setEditSuccess] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()),
    ]).then(([me, userList]) => {
      setCurrentUser(me?.id ? me : null)
      setUsers(Array.isArray(userList) ? userList : [])
      setLoading(false)
    })
  }, [])

  async function handleToggle(user: User) {
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !user.isActive }),
    })
    if (res.ok) {
      const updated = await res.json()
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      router.refresh()
    }
  }

  async function handleDelete(user: User) {
    if (!confirm(`"${user.name}" 계정을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return
    setDeletingId(user.id)
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' })
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== user.id))
        router.refresh()
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error || '생성에 실패했습니다.'); return }
      setUsers((prev) => [...prev, data])
      setShowCreateModal(false)
      setForm({ email: '', password: '', name: '', phone: '', role: 'USER' })
      router.refresh()
    } catch {
      setFormError('서버 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  function openEditModal() {
    if (!currentUser) return
    setEditName(currentUser.name)
    setEditPhone(currentUser.phone ?? '')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setEditError('')
    setEditSuccess('')
    setShowEditModal(true)
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!currentUser) return
    setEditError('')
    setEditSuccess('')

    if (newPassword) {
      if (newPassword !== confirmPassword) {
        setEditError('새 비밀번호가 일치하지 않습니다.')
        return
      }
      if (!currentPassword) {
        setEditError('현재 비밀번호를 입력해주세요.')
        return
      }
    }

    setEditSubmitting(true)
    try {
      const body: Record<string, unknown> = { name: editName, phone: editPhone }
      if (newPassword) { body.currentPassword = currentPassword; body.newPassword = newPassword }

      const res = await fetch(`/api/users/${currentUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setEditError(data.error ?? '저장에 실패했습니다.'); return }

      setCurrentUser((prev) => prev ? { ...prev, name: data.name, phone: data.phone } : prev)
      setUsers((prev) => prev.map((u) => u.id === data.id ? { ...u, name: data.name, phone: data.phone } : u))
      router.refresh()
      setEditSuccess('저장되었습니다.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      setEditError('서버 오류가 발생했습니다.')
    } finally {
      setEditSubmitting(false)
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-gray-500">로딩 중...</div>
  }

  const isAdmin = currentUser?.role === 'ADMIN'

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">계정 관리</h1>
        {isAdmin && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            계정 생성
          </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">이름</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">이메일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">연락처</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">역할</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className={`hover:bg-gray-50 ${user.id === currentUser?.id ? 'bg-blue-50/40' : ''}`}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {user.name}
                  {user.id === currentUser?.id && (
                    <span className="ml-2 text-xs text-blue-500">(나)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{user.email}</td>
                <td className="px-4 py-3 text-gray-600">{user.phone || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_CLASS[user.role] ?? 'bg-gray-100 text-gray-700'}`}>
                    {ROLE_LABEL[user.role] ?? user.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {user.isActive ? '활성' : '비활성'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {user.id === currentUser?.id ? (
                    <button
                      onClick={openEditModal}
                      className="text-xs font-medium px-3 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      수정
                    </button>
                  ) : isAdmin ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggle(user)}
                        className={`text-xs font-medium px-3 py-1 rounded-lg transition-colors ${
                          user.isActive
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        }`}
                      >
                        {user.isActive ? '비활성화' : '활성화'}
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        disabled={deletingId === user.id}
                        className="text-xs font-medium px-3 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 transition-colors"
                      >
                        {deletingId === user.id ? '삭제 중...' : '삭제'}
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">계정이 없습니다.</div>
        )}
      </div>

      {/* 계정 생성 모달 (ADMIN만) */}
      {showCreateModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-4">계정 생성</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이메일 *</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 *</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">역할</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'ADMIN' | 'USER' | 'VIEWER' })} className={inputClass}>
                  <option value="USER">일반 (USER)</option>
                  <option value="VIEWER">뷰어 (VIEWER)</option>
                  <option value="ADMIN">관리자 (ADMIN)</option>
                </select>
              </div>
              {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowCreateModal(false); setFormError('') }} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">취소</button>
                <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{submitting ? '생성 중...' : '생성'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 내 정보 수정 모달 */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-4">내 정보 수정</h2>
            <form onSubmit={handleEditSave} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="010-0000-0000" className={inputClass} />
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">비밀번호 변경 (선택)</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">현재 비밀번호</label>
                    <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 <span className="text-gray-400 font-normal">(6자 이상)</span></label>
                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 확인</label>
                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
                  </div>
                </div>
              </div>

              {editError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{editError}</p>}
              {editSuccess && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">{editSuccess}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">닫기</button>
                <button type="submit" disabled={editSubmitting} className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{editSubmitting ? '저장 중...' : '저장'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
