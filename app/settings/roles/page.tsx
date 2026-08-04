'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { permissionsByModule, PERMISSIONS, type PermKey } from '@/lib/permissions'

interface Member {
  id: number
  createdAt: string
  user: {
    id: string
    name: string
    email: string
    isActive: boolean
    organization: { name: string } | null
    department: { name: string } | null
  }
}

interface AppRole {
  id: number
  code: string
  name: string
  description: string | null
  isActive: boolean
  sortOrder: number
  permissions: string[]
  members: Member[]
}

interface Candidate {
  id: string
  name: string
  email: string
  organization: { name: string } | null
  department: { name: string } | null
}

export default function RolesSettingsPage() {
  const router = useRouter()
  const [roles, setRoles] = useState<AppRole[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 역할 추가 폼
  const [showCreate, setShowCreate] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  // 역할 편집
  const [editMode, setEditMode] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  // 멤버 추가 모달
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const permModules = permissionsByModule()
  const selected = roles.find((r) => r.id === selectedId) ?? null

  const fetchRoles = useCallback(async () => {
    const res = await fetch('/api/settings/app-roles')
    if (res.ok) {
      const data = await res.json()
      setRoles(data.roles)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        setUserRole(data?.role ?? null)
        if (data?.role !== 'SUPER_ADMIN') router.push('/')
      })
      .catch(() => router.push('/'))
    fetchRoles()
  }, [fetchRoles, router])

  async function handleCreate() {
    setCreateError(null)
    const res = await fetch('/api/settings/app-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: newCode, name: newName, description: newDesc }),
    })
    if (res.ok) {
      const created = await res.json()
      setShowCreate(false)
      setNewCode(''); setNewName(''); setNewDesc('')
      await fetchRoles()
      setSelectedId(created.id)
      router.refresh()
    } else {
      const data = await res.json()
      setCreateError(data.error ?? '등록에 실패했습니다.')
    }
  }

  async function handleUpdate(id: number, patch: Record<string, unknown>) {
    setError(null)
    const res = await fetch(`/api/settings/app-roles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) {
      await fetchRoles()
      router.refresh()
    } else {
      const data = await res.json()
      setError(data.error ?? '수정에 실패했습니다.')
    }
  }

  async function handleMove(role: AppRole, dir: -1 | 1) {
    const idx = roles.findIndex((r) => r.id === role.id)
    const other = roles[idx + dir]
    if (!other) return
    // sortOrder 교환 (동일 값이면 위치가 안 바뀌므로 보정)
    const a = role.sortOrder === other.sortOrder ? other.sortOrder - dir : other.sortOrder
    const b = role.sortOrder === other.sortOrder ? role.sortOrder : role.sortOrder
    await fetch(`/api/settings/app-roles/${role.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder: a }),
    })
    await fetch(`/api/settings/app-roles/${other.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder: b }),
    })
    await fetchRoles()
    router.refresh()
  }

  async function handleDelete(role: AppRole) {
    const detail = role.members.length > 0 || role.permissions.length > 0
      ? `\n(멤버 ${role.members.length}명, 권한 ${role.permissions.length}개가 함께 삭제됩니다)`
      : ''
    if (!confirm(`'${role.name}' 역할을 삭제하시겠습니까?${detail}`)) return
    const res = await fetch(`/api/settings/app-roles/${role.id}`, { method: 'DELETE' })
    if (res.ok) {
      if (selectedId === role.id) setSelectedId(null)
      await fetchRoles()
      router.refresh()
    } else {
      const data = await res.json()
      setError(data.error ?? '삭제에 실패했습니다.')
    }
  }

  async function handleTogglePermission(role: AppRole, key: PermKey) {
    const next = role.permissions.includes(key)
      ? role.permissions.filter((p) => p !== key)
      : [...role.permissions, key]
    setError(null)
    const res = await fetch(`/api/settings/app-roles/${role.id}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: next }),
    })
    if (res.ok) {
      await fetchRoles()
      router.refresh()
    } else {
      const data = await res.json()
      setError(data.error ?? '권한 변경에 실패했습니다.')
    }
  }

  const fetchCandidates = useCallback(async (roleId: number, s: string) => {
    setCandidateLoading(true)
    setModalError(null)
    const res = await fetch(`/api/settings/app-roles/candidates?roleId=${roleId}&search=${encodeURIComponent(s)}&limit=10`)
    if (res.ok) {
      const data = await res.json()
      setCandidates(data.data)
    }
    setCandidateLoading(false)
  }, [])

  function openMemberModal() {
    if (!selected) return
    setShowMemberModal(true)
    setSearch('')
    setCandidates([])
    setModalError(null)
    fetchCandidates(selected.id, '')
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    if (!selected) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchCandidates(selected.id, value), 300)
  }

  async function handleAddMember(candidate: Candidate) {
    if (!selected) return
    setModalError(null)
    const res = await fetch(`/api/settings/app-roles/${selected.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: candidate.id }),
    })
    if (res.ok) {
      await fetchRoles()
      fetchCandidates(selected.id, search)
      router.refresh()
    } else {
      const data = await res.json()
      setModalError(data.error ?? '추가에 실패했습니다.')
    }
  }

  async function handleRemoveMember(m: Member) {
    if (!selected) return
    if (!confirm(`'${m.user.name}'에게서 '${selected.name}' 역할을 회수하시겠습니까?`)) return
    const res = await fetch(`/api/settings/app-roles/${selected.id}/members?userId=${m.user.id}`, { method: 'DELETE' })
    if (res.ok) {
      await fetchRoles()
      router.refresh()
    } else {
      const data = await res.json()
      setError(data.error ?? '제거에 실패했습니다.')
    }
  }

  function startEdit(role: AppRole) {
    setEditMode(true)
    setEditName(role.name)
    setEditDesc(role.description ?? '')
  }

  async function saveEdit() {
    if (!selected) return
    await handleUpdate(selected.id, { name: editName, description: editDesc })
    setEditMode(false)
  }

  if (loading) return <div className="p-8 text-sm text-gray-500">로딩 중...</div>
  if (userRole && userRole !== 'SUPER_ADMIN') return null

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold text-gray-900">역할 관리</h1>
        <button
          onClick={() => { setShowCreate(!showCreate); setCreateError(null) }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          {showCreate ? '닫기' : '+ 역할 추가'}
        </button>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        직무 단위 권한 묶음(역할)을 정의하고 사용자에게 부여합니다. 역할은 권한을 <b>더해줄 뿐</b> 기존 등급(SUPER_ADMIN/ADMIN/USER/VIEWER)의 접근을 제한하지 않습니다.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>
      )}

      {showCreate && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">코드 (영문 대문자·언더스코어)</label>
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="INVENTORY_MANAGER"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">이름</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="재고담당"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">설명 (선택)</label>
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="재고 입출고 처리 담당"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          {createError && <div className="mt-2 text-sm text-red-600">{createError}</div>}
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleCreate}
              disabled={!newCode.trim() || !newName.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              등록
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* ── 역할 목록 ── */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
              역할 목록 ({roles.length})
            </div>
            {roles.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">등록된 역할이 없습니다.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {roles.map((r, i) => (
                  <li
                    key={r.id}
                    onClick={() => { setSelectedId(r.id); setEditMode(false) }}
                    className={`cursor-pointer px-4 py-3 transition-colors ${selectedId === r.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-gray-900">{r.name}</span>
                          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono text-gray-500">{r.code}</span>
                          {!r.isActive && (
                            <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500">비활성</span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          권한 {r.permissions.length}개 · 멤버 {r.members.length}명
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleMove(r, -1)}
                          disabled={i === 0}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
                          title="위로"
                        >↑</button>
                        <button
                          onClick={() => handleMove(r, 1)}
                          disabled={i === roles.length - 1}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
                          title="아래로"
                        >↓</button>
                        <button
                          onClick={() => handleDelete(r)}
                          className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                          title="삭제"
                        >✕</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── 선택 역할 상세 ── */}
        <div className="lg:col-span-3">
          {!selected ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 py-16 text-center text-sm text-gray-500">
              좌측 목록에서 역할을 선택하세요.
            </div>
          ) : (
            <div className="space-y-6">
              {/* 기본 정보 */}
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between">
                  {editMode ? (
                    <div className="flex-1 space-y-2 pr-4">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <input
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="설명 (선택)"
                        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold text-gray-900">{selected.name}</h2>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono text-gray-500">{selected.code}</span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{selected.description || '설명 없음'}</p>
                    </div>
                  )}
                  <div className="flex shrink-0 items-center gap-2">
                    {editMode ? (
                      <>
                        <button onClick={saveEdit} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">저장</button>
                        <button onClick={() => setEditMode(false)} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">취소</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(selected)} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">수정</button>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={selected.isActive}
                            onChange={(e) => handleUpdate(selected.id, { isActive: e.target.checked })}
                            className="h-3.5 w-3.5 rounded border-gray-300"
                          />
                          활성
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 권한 할당 */}
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  권한 ({selected.permissions.length}/{Object.keys(PERMISSIONS).length})
                </div>
                <div className="p-4 space-y-4">
                  {permModules.map((g) => (
                    <div key={g.module}>
                      <div className="mb-2 text-xs font-semibold text-gray-700">{g.module}</div>
                      <div className="space-y-1.5">
                        {g.perms.map((p) => (
                          <label key={p.key} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={selected.permissions.includes(p.key)}
                              onChange={() => handleTogglePermission(selected, p.key)}
                              className="mt-0.5 h-4 w-4 rounded border-gray-300"
                            />
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="text-sm text-gray-800">{p.label}</span>
                                <span className="text-[11px] font-mono text-gray-400">{p.key}</span>
                              </span>
                              {/* 권한 적용 범위 설명 — 카탈로그(lib/permissions.ts) 단일 소스 */}
                              <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{p.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 멤버 할당 */}
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">멤버 ({selected.members.length})</span>
                  <button
                    onClick={openMemberModal}
                    className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                  >
                    + 추가
                  </button>
                </div>
                {selected.members.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-500">부여된 사용자가 없습니다.</div>
                ) : (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      {selected.members.map((m) => (
                        <tr key={m.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                            {m.user.name}
                            {!m.user.isActive && <span className="ml-1.5 rounded bg-gray-200 px-1 py-0.5 text-[10px] text-gray-500">비활성 계정</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-600">{m.user.email}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                            {m.user.organization?.name ?? '-'}{m.user.department ? ` / ${m.user.department.name}` : ''}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => handleRemoveMember(m)}
                              className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                            >
                              회수
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 멤버 추가 모달 */}
      {showMemberModal && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setShowMemberModal(false) }}
        >
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl mx-4">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-semibold text-gray-900">{selected.name} — 멤버 추가</h2>
              <button
                onClick={() => setShowMemberModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="px-6 py-4">
              <input
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="이름 또는 이메일 검색"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              {modalError && (
                <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{modalError}</div>
              )}
              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {candidateLoading ? (
                      <tr><td className="py-6 text-center text-xs text-gray-400">검색 중...</td></tr>
                    ) : candidates.length === 0 ? (
                      <tr><td className="py-6 text-center text-xs text-gray-400">후보 없음</td></tr>
                    ) : (
                      candidates.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{c.name}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">{c.email}</td>
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{c.organization?.name ?? '-'}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handleAddMember(c)}
                              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                            >
                              추가
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
