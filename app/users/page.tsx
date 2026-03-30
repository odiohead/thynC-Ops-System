'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Organization {
  id: number
  name: string
  code: string
}

interface User {
  id: string
  email: string
  name: string
  phone: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'VIEWER'
  isActive: boolean
  createdAt: string
  organization: Organization | null
}

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: '최고관리자',
  ADMIN: '관리자',
  USER: '일반',
  VIEWER: '뷰어',
}
const ROLE_CLASS: Record<string, string> = {
  SUPER_ADMIN: 'bg-indigo-100 text-indigo-700',
  ADMIN: 'bg-purple-100 text-purple-700',
  USER: 'bg-gray-100 text-gray-700',
  VIEWER: 'bg-blue-100 text-blue-700',
}

const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

function isAdminOrAbove(role: string | undefined) {
  return role === 'SUPER_ADMIN' || role === 'ADMIN'
}

export default function UsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)

  // 계정 생성 모달
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [form, setForm] = useState({
    email: '', password: '', name: '', phone: '',
    role: 'USER' as 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'VIEWER',
    organizationId: '',
  })
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
  const [activeTab, setActiveTab] = useState<'SEERS' | 'DAEWOONG'>('SEERS')

  // 다른 계정 수정 모달 (SUPER_ADMIN 전용)
  const [showEditOtherModal, setShowEditOtherModal] = useState(false)
  const [editOtherUser, setEditOtherUser] = useState<User | null>(null)
  const [editOtherName, setEditOtherName] = useState('')
  const [editOtherPhone, setEditOtherPhone] = useState('')
  const [editOtherRole, setEditOtherRole] = useState<User['role']>('USER')
  const [editOtherOrgId, setEditOtherOrgId] = useState('')
  const [editOtherPassword, setEditOtherPassword] = useState('')
  const [editOtherConfirmPassword, setEditOtherConfirmPassword] = useState('')
  const [editOtherError, setEditOtherError] = useState('')
  const [editOtherSuccess, setEditOtherSuccess] = useState('')
  const [editOtherSubmitting, setEditOtherSubmitting] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/settings/organizations').then((r) => r.json()),
    ]).then(([me, userList, orgData]) => {
      setCurrentUser(me?.id ? me : null)
      setUsers(Array.isArray(userList) ? userList : [])
      setOrganizations((orgData.organizations ?? []).filter((o: Organization & { isActive?: boolean }) => o.isActive !== false))
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
        body: JSON.stringify({
          ...form,
          organizationId: form.organizationId ? parseInt(form.organizationId) : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error || '생성에 실패했습니다.'); return }
      setUsers((prev) => [...prev, data])
      setShowCreateModal(false)
      setForm({ email: '', password: '', name: '', phone: '', role: 'USER', organizationId: '' })
      router.refresh()
    } catch {
      setFormError('서버 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  function openEditOtherModal(user: User) {
    setEditOtherUser(user)
    setEditOtherName(user.name)
    setEditOtherPhone(user.phone ?? '')
    setEditOtherRole(user.role)
    setEditOtherOrgId(user.organization?.id?.toString() ?? '')
    setEditOtherPassword('')
    setEditOtherConfirmPassword('')
    setEditOtherError('')
    setEditOtherSuccess('')
    setShowEditOtherModal(true)
  }

  async function handleEditOtherSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editOtherUser) return
    setEditOtherError('')
    setEditOtherSuccess('')

    if (editOtherPassword && editOtherPassword !== editOtherConfirmPassword) {
      setEditOtherError('새 비밀번호가 일치하지 않습니다.')
      return
    }
    if (editOtherPassword && editOtherPassword.length < 6) {
      setEditOtherError('새 비밀번호는 6자 이상이어야 합니다.')
      return
    }

    setEditOtherSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: editOtherName,
        phone: editOtherPhone,
        role: editOtherRole,
        organizationId: editOtherOrgId ? parseInt(editOtherOrgId) : null,
      }
      if (editOtherPassword) body.newPassword = editOtherPassword

      const res = await fetch(`/api/users/${editOtherUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setEditOtherError(data.error ?? '저장에 실패했습니다.'); return }

      setUsers((prev) => prev.map((u) => u.id === data.id ? data : u))
      router.refresh()
      setEditOtherSuccess('저장되었습니다.')
      setEditOtherPassword('')
      setEditOtherConfirmPassword('')
    } catch {
      setEditOtherError('서버 오류가 발생했습니다.')
    } finally {
      setEditOtherSubmitting(false)
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

  const isAdmin = isAdminOrAbove(currentUser?.role)

  const seersCount = users.filter((u) => u.organization?.code === 'SEERS').length
  const daewoongCount = users.filter((u) => u.organization?.code === 'DAEWOONG').length
  const filteredUsers = users.filter((u) => u.organization?.code === activeTab)

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

      {/* 조직 탭 */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {([
          { code: 'SEERS', label: '씨어스테크놀로지', count: seersCount },
          { code: 'DAEWOONG', label: '대웅제약', count: daewoongCount },
        ] as const).map((tab) => (
          <button
            key={tab.code}
            onClick={() => setActiveTab(tab.code)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.code
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              activeTab === tab.code ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">이름</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">이메일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">연락처</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">소속</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">역할</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상태</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredUsers.map((user) => (
              <tr key={user.id} className={`hover:bg-gray-50 ${user.id === currentUser?.id ? 'bg-blue-50/40' : ''}`}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {user.name}
                  {user.id === currentUser?.id && (
                    <span className="ml-2 text-xs text-blue-500">(나)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{user.email}</td>
                <td className="px-4 py-3 text-gray-600">{user.phone || '-'}</td>
                <td className="px-4 py-3 text-gray-600">{user.organization?.name ?? '-'}</td>
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
                      {currentUser?.role === 'SUPER_ADMIN' && (
                        <button
                          onClick={() => openEditOtherModal(user)}
                          className="text-xs font-medium px-3 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                        >
                          수정
                        </button>
                      )}
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
        {filteredUsers.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">계정이 없습니다.</div>
        )}
      </div>

      {/* 계정 생성 모달 (ADMIN 이상만) */}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">소속</label>
                <select value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} className={inputClass}>
                  <option value="">소속 없음</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>{org.name} ({org.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">역할</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })} className={inputClass}>
                  <option value="USER">일반 (USER)</option>
                  <option value="VIEWER">뷰어 (VIEWER)</option>
                  <option value="ADMIN">관리자 (ADMIN)</option>
                  {currentUser?.role === 'SUPER_ADMIN' && (
                    <option value="SUPER_ADMIN">최고관리자 (SUPER_ADMIN)</option>
                  )}
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

      {/* 다른 계정 수정 모달 (SUPER_ADMIN 전용) */}
      {showEditOtherModal && editOtherUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-1">계정 수정</h2>
            <p className="text-xs text-gray-500 mb-4">{editOtherUser.email}</p>
            <form onSubmit={handleEditOtherSave} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                <input type="text" value={editOtherName} onChange={(e) => setEditOtherName(e.target.value)} required className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                <input type="tel" value={editOtherPhone} onChange={(e) => setEditOtherPhone(e.target.value)} placeholder="010-0000-0000" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">역할</label>
                <select value={editOtherRole} onChange={(e) => setEditOtherRole(e.target.value as User['role'])} className={inputClass}>
                  <option value="VIEWER">뷰어 (VIEWER)</option>
                  <option value="USER">일반 (USER)</option>
                  <option value="ADMIN">관리자 (ADMIN)</option>
                  <option value="SUPER_ADMIN">최고관리자 (SUPER_ADMIN)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">소속</label>
                <select value={editOtherOrgId} onChange={(e) => setEditOtherOrgId(e.target.value)} className={inputClass}>
                  <option value="">소속 없음</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>{org.name} ({org.code})</option>
                  ))}
                </select>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">비밀번호 변경 (선택)</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 <span className="text-gray-400 font-normal">(6자 이상)</span></label>
                    <input type="password" value={editOtherPassword} onChange={(e) => setEditOtherPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 확인</label>
                    <input type="password" value={editOtherConfirmPassword} onChange={(e) => setEditOtherConfirmPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
                  </div>
                </div>
              </div>
              {editOtherError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{editOtherError}</p>}
              {editOtherSuccess && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">{editOtherSuccess}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowEditOtherModal(false)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">닫기</button>
                <button type="submit" disabled={editOtherSubmitting} className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{editOtherSubmitting ? '저장 중...' : '저장'}</button>
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
