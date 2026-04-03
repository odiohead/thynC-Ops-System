'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Organization {
  id: number
  name: string
  code: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  _count: { users: number }
}

interface Department {
  id: number
  name: string
  organizationId: number
  sortOrder: number
  _count: { users: number }
}

interface EditForm {
  name: string
  sortOrder: number
  isActive: boolean
}

interface AddForm {
  name: string
  code: string
  sortOrder: number
  isActive: boolean
}

const emptyAddForm: AddForm = { name: '', code: '', sortOrder: 0, isActive: true }

export default function OrganizationsSettingsPage() {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ name: '', sortOrder: 0, isActive: true })

  const [isAdding, setIsAdding] = useState(false)
  const [addForm, setAddForm] = useState<AddForm>(emptyAddForm)

  const [busy, setBusy] = useState(false)

  // 부서 아코디언
  const [openDeptOrgId, setOpenDeptOrgId] = useState<number | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [deptLoading, setDeptLoading] = useState(false)
  const [deptError, setDeptError] = useState<string | null>(null)
  const [deptEditId, setDeptEditId] = useState<number | null>(null)
  const [deptEditName, setDeptEditName] = useState('')
  const [deptAddName, setDeptAddName] = useState('')
  const [deptBusy, setDeptBusy] = useState(false)

  async function fetchData() {
    const [orgRes, meRes] = await Promise.all([
      fetch('/api/settings/organizations'),
      fetch('/api/auth/me'),
    ])
    const orgData = await orgRes.json()
    const meData = await meRes.json()
    setOrganizations(orgData.organizations ?? [])
    setUserRole(meData?.role ?? null)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const fetchDepartments = useCallback(async (orgId: number) => {
    setDeptLoading(true)
    setDeptError(null)
    const res = await fetch(`/api/settings/departments?organizationId=${orgId}`)
    if (res.ok) {
      setDepartments(await res.json())
    }
    setDeptLoading(false)
  }, [])

  function toggleDeptAccordion(orgId: number) {
    if (openDeptOrgId === orgId) {
      setOpenDeptOrgId(null)
    } else {
      setOpenDeptOrgId(orgId)
      setDeptEditId(null)
      setDeptAddName('')
      setDeptError(null)
      fetchDepartments(orgId)
    }
  }

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  async function handleSaveEdit(org: Organization) {
    if (!editForm.name.trim()) return
    setBusy(true)
    const res = await fetch(`/api/settings/organizations/${org.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      router.refresh()
      await fetchData()
      setEditId(null)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleDelete(org: Organization) {
    if (!confirm(`'${org.name}' 소속을 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/organizations/${org.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      await fetchData()
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleAdd() {
    if (!addForm.name.trim() || !addForm.code.trim()) return
    setBusy(true)
    const res = await fetch('/api/settings/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    if (res.ok) {
      router.refresh()
      await fetchData()
      setIsAdding(false)
      setAddForm(emptyAddForm)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleMove(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= organizations.length) return

    const current = organizations[index]
    const target = organizations[targetIndex]
    setBusy(true)

    await Promise.all([
      fetch(`/api/settings/organizations/${current.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: target.sortOrder }),
      }),
      fetch(`/api/settings/organizations/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: current.sortOrder }),
      }),
    ])

    router.refresh()
    await fetchData()
    setBusy(false)
  }

  // 부서 관리 핸들러
  async function handleDeptMove(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= departments.length) return

    const current = departments[index]
    const target = departments[targetIndex]
    setDeptBusy(true)

    await Promise.all([
      fetch(`/api/settings/departments/${current.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: target.sortOrder }),
      }),
      fetch(`/api/settings/departments/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: current.sortOrder }),
      }),
    ])

    if (openDeptOrgId) await fetchDepartments(openDeptOrgId)
    setDeptBusy(false)
  }

  async function handleDeptSaveEdit(dept: Department) {
    if (!deptEditName.trim()) return
    setDeptBusy(true)
    const res = await fetch(`/api/settings/departments/${dept.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: deptEditName }),
    })
    if (res.ok) {
      setDeptEditId(null)
      if (openDeptOrgId) await fetchDepartments(openDeptOrgId)
    } else {
      setDeptError((await res.json()).error)
    }
    setDeptBusy(false)
  }

  async function handleDeptDelete(dept: Department) {
    setDeptBusy(true)
    setDeptError(null)
    const res = await fetch(`/api/settings/departments/${dept.id}`, { method: 'DELETE' })
    if (res.ok) {
      if (openDeptOrgId) await fetchDepartments(openDeptOrgId)
    } else {
      setDeptError((await res.json()).error)
    }
    setDeptBusy(false)
  }

  async function handleDeptAdd(orgId: number) {
    if (!deptAddName.trim()) return
    setDeptBusy(true)
    setDeptError(null)
    const maxSort = departments.length > 0 ? Math.max(...departments.map((d) => d.sortOrder)) + 1 : 0
    const res = await fetch('/api/settings/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: deptAddName, organizationId: orgId, sortOrder: maxSort }),
    })
    if (res.ok) {
      setDeptAddName('')
      await fetchDepartments(orgId)
    } else {
      setDeptError((await res.json()).error)
    }
    setDeptBusy(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-sm text-gray-400">불러오는 중...</p>
        </div>
      </div>
    )
  }

  if (userRole !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            권한이 없습니다. 최고관리자만 접근할 수 있습니다.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">소속 관리</h1>
            <p className="mt-1 text-sm text-gray-500">사용자 소속 조직을 관리합니다.</p>
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => { setIsAdding(true); setEditId(null) }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 소속 추가
            </button>
          )}
        </div>

        {/* 에러 */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 테이블 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-16 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">순서</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">소속명</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">코드</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">사용자 수</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">활성</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {organizations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-gray-400">등록된 소속이 없습니다.</td>
                </tr>
              ) : (
                organizations.map((org, index) => (
                  <>
                    <tr key={org.id} className={`hover:bg-gray-50 ${!org.isActive ? 'opacity-50' : ''}`}>

                      {/* 순서 */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <span className="w-6 text-sm tabular-nums text-gray-500">{index + 1}</span>
                          <div className="flex flex-col">
                            <button
                              onClick={() => handleMove(index, 'up')}
                              disabled={index === 0 || busy}
                              className="rounded px-0.5 text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-30"
                              title="위로"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="18 15 12 9 6 15" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleMove(index, 'down')}
                              disabled={index === organizations.length - 1 || busy}
                              className="rounded px-0.5 text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-30"
                              title="아래로"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* 소속명 */}
                      <td className="px-4 py-3">
                        {editId === org.id ? (
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            autoFocus
                            className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="text-sm font-medium text-gray-900">{org.name}</span>
                        )}
                      </td>

                      {/* 코드 */}
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-gray-600">{org.code}</span>
                      </td>

                      {/* 사용자 수 */}
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">{org._count.users}명</span>
                      </td>

                      {/* 활성 여부 */}
                      <td className="px-4 py-3 text-center">
                        {editId === org.id ? (
                          <input
                            type="checkbox"
                            checked={editForm.isActive}
                            onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        ) : (
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            org.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {org.isActive ? '활성' : '비활성'}
                          </span>
                        )}
                      </td>

                      {/* 액션 */}
                      <td className="px-4 py-3 text-right">
                        {editId === org.id ? (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleSaveEdit(org)}
                              disabled={busy || !editForm.name.trim()}
                              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                            >
                              저장
                            </button>
                            <button
                              onClick={() => setEditId(null)}
                              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => toggleDeptAccordion(org.id)}
                              disabled={busy}
                              className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                                openDeptOrgId === org.id
                                  ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                  : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                              }`}
                            >
                              부서 관리
                            </button>
                            <button
                              onClick={() => {
                                setEditId(org.id)
                                setEditForm({ name: org.name, sortOrder: org.sortOrder, isActive: org.isActive })
                                setIsAdding(false)
                              }}
                              disabled={busy}
                              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleDelete(org)}
                              disabled={busy}
                              className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* 부서 아코디언 */}
                    {openDeptOrgId === org.id && (
                      <tr key={`dept-${org.id}`}>
                        <td colSpan={6} className="bg-blue-50/40 px-6 py-4">
                          <div className="space-y-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">부서 목록 — {org.name}</p>

                            {deptError && (
                              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                                {deptError}
                              </div>
                            )}

                            {deptLoading ? (
                              <p className="text-xs text-gray-400">불러오는 중...</p>
                            ) : (
                              <table className="min-w-full divide-y divide-gray-200 rounded-md overflow-hidden border border-gray-200 bg-white">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="w-14 px-3 py-2 text-left text-xs font-medium text-gray-500">순서</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">부서명</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">소속 계정 수</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">관리</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {departments.length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="py-4 text-center text-xs text-gray-400">등록된 부서가 없습니다.</td>
                                    </tr>
                                  ) : (
                                    departments.map((dept, di) => (
                                      <tr key={dept.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2">
                                          <div className="flex items-center gap-1">
                                            <div className="flex flex-col">
                                              <button
                                                onClick={() => handleDeptMove(di, 'up')}
                                                disabled={di === 0 || deptBusy}
                                                className="rounded px-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                                title="위로"
                                              >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                  <polyline points="18 15 12 9 6 15" />
                                                </svg>
                                              </button>
                                              <button
                                                onClick={() => handleDeptMove(di, 'down')}
                                                disabled={di === departments.length - 1 || deptBusy}
                                                className="rounded px-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                                                title="아래로"
                                              >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                  <polyline points="6 9 12 15 18 9" />
                                                </svg>
                                              </button>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-3 py-2">
                                          {deptEditId === dept.id ? (
                                            <input
                                              type="text"
                                              value={deptEditName}
                                              onChange={(e) => setDeptEditName(e.target.value)}
                                              autoFocus
                                              className="w-full rounded border border-blue-400 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            />
                                          ) : (
                                            <span className="text-sm text-gray-900">{dept.name}</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-500">{dept._count.users}명</td>
                                        <td className="px-3 py-2 text-right">
                                          {deptEditId === dept.id ? (
                                            <div className="flex justify-end gap-1">
                                              <button
                                                onClick={() => handleDeptSaveEdit(dept)}
                                                disabled={deptBusy || !deptEditName.trim()}
                                                className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                              >
                                                저장
                                              </button>
                                              <button
                                                onClick={() => setDeptEditId(null)}
                                                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
                                              >
                                                취소
                                              </button>
                                            </div>
                                          ) : (
                                            <div className="flex justify-end gap-1">
                                              <button
                                                onClick={() => { setDeptEditId(dept.id); setDeptEditName(dept.name) }}
                                                disabled={deptBusy}
                                                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                                              >
                                                수정
                                              </button>
                                              <button
                                                onClick={() => handleDeptDelete(dept)}
                                                disabled={deptBusy}
                                                className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
                                              >
                                                삭제
                                              </button>
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    ))
                                  )}

                                  {/* 부서 추가 행 */}
                                  <tr className="bg-gray-50">
                                    <td className="px-3 py-2 text-xs text-gray-400">{departments.length + 1}</td>
                                    <td className="px-3 py-2" colSpan={2}>
                                      <input
                                        type="text"
                                        value={deptAddName}
                                        onChange={(e) => setDeptAddName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleDeptAdd(org.id)
                                        }}
                                        placeholder="새 부서명 입력"
                                        className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                      />
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <button
                                        onClick={() => handleDeptAdd(org.id)}
                                        disabled={deptBusy || !deptAddName.trim()}
                                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                      >
                                        추가
                                      </button>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}

              {/* 추가 행 */}
              {isAdding && (
                <tr className="bg-blue-50">
                  <td className="px-4 py-3 text-sm text-gray-400">{organizations.length + 1}</td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={addForm.name}
                      onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="소속명 (예: 씨어스)"
                      autoFocus
                      className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={addForm.code}
                      onChange={(e) => setAddForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAdd()
                        if (e.key === 'Escape') { setIsAdding(false); setAddForm(emptyAddForm) }
                      }}
                      placeholder="코드 (예: SEERS)"
                      className="w-full rounded border border-blue-400 px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">-</td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={addForm.isActive}
                      onChange={(e) => setAddForm((f) => ({ ...f, isActive: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={handleAdd}
                        disabled={busy || !addForm.name.trim() || !addForm.code.trim()}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        추가
                      </button>
                      <button
                        onClick={() => { setIsAdding(false); setAddForm(emptyAddForm) }}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                      >
                        취소
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
