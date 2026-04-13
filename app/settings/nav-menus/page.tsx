'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ICON_MAP, getMenuIcon } from '@/app/components/NavIcons'

const ALL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'USER', 'VIEWER'] as const
const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: '최고관리자',
  ADMIN: '관리자',
  USER: '일반',
  VIEWER: '뷰어',
}
const ICON_KEYS = Object.keys(ICON_MAP)

interface NavItem {
  id: number
  menuKey: string
  label: string
  href: string
  iconKey: string | null
  parentKey: string | null
  allowedRoles: string[]
  allowedOrgCodes: string[]
  isActive: boolean
  sortOrder: number
}

interface Org {
  code: string
  name: string
}

export default function NavMenuSettingsPage() {
  const router = useRouter()
  const [items, setItems] = useState<NavItem[]>([])
  const [orgs, setOrgs] = useState<Org[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<NavItem>>({})
  const [busy, setBusy] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [addData, setAddData] = useState({
    menuKey: '', label: '', href: '', iconKey: '',
    parentKey: '', allowedRoles: [] as string[], allowedOrgCodes: [] as string[],
  })

  async function fetchData() {
    try {
      const res = await fetch('/api/settings/nav-menus')
      if (!res.ok) { router.push('/'); return }
      const data = await res.json()
      setItems(data.items)
      setOrgs(data.organizations)
    } catch {
      showError('데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  const mainItems = items.filter(i => i.parentKey === null).sort((a, b) => a.sortOrder - b.sortOrder)
  const settingsItems = items.filter(i => i.parentKey === 'settings').sort((a, b) => a.sortOrder - b.sortOrder)

  function startEdit(item: NavItem) {
    setEditId(item.id)
    setEditData({
      label: item.label,
      iconKey: item.iconKey,
      allowedRoles: [...item.allowedRoles],
      allowedOrgCodes: [...item.allowedOrgCodes],
    })
  }

  function cancelEdit() {
    setEditId(null)
    setEditData({})
  }

  async function handleSave(item: NavItem) {
    if (!editData.label?.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/settings/nav-menus/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      })
      if (!res.ok) {
        const d = await res.json()
        showError(d.error || '저장 실패')
        return
      }
      cancelEdit()
      await fetchData()
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleActive(item: NavItem) {
    setBusy(true)
    try {
      const res = await fetch(`/api/settings/nav-menus/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.isActive }),
      })
      if (!res.ok) {
        const d = await res.json()
        showError(d.error || '변경 실패')
        return
      }
      await fetchData()
    } finally {
      setBusy(false)
    }
  }

  async function handleMove(list: NavItem[], idx: number, dir: -1 | 1) {
    const target = list[idx]
    const swap = list[idx + dir]
    if (!target || !swap) return
    setBusy(true)
    try {
      await Promise.all([
        fetch(`/api/settings/nav-menus/${target.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: swap.sortOrder }),
        }),
        fetch(`/api/settings/nav-menus/${swap.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: target.sortOrder }),
        }),
      ])
      await fetchData()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(item: NavItem) {
    if (!confirm(`"${item.label}" 메뉴를 삭제하시겠습니까?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/settings/nav-menus/${item.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        showError(d.error || '삭제 실패')
        return
      }
      await fetchData()
    } finally {
      setBusy(false)
    }
  }

  async function handleAdd() {
    if (!addData.menuKey.trim() || !addData.label.trim() || !addData.href.trim()) {
      showError('메뉴 키, 메뉴명, 경로는 필수입니다.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/settings/nav-menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...addData,
          iconKey: addData.iconKey || null,
          parentKey: addData.parentKey || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        showError(d.error || '추가 실패')
        return
      }
      setIsAdding(false)
      setAddData({ menuKey: '', label: '', href: '', iconKey: '', parentKey: '', allowedRoles: [], allowedOrgCodes: [] })
      await fetchData()
    } finally {
      setBusy(false)
    }
  }

  function toggleRole(roles: string[], role: string): string[] {
    return roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role]
  }

  function toggleOrg(codes: string[], code: string): string[] {
    return codes.includes(code) ? codes.filter(c => c !== code) : [...codes, code]
  }

  function RoleBadges({ roles }: { roles: string[] }) {
    if (roles.length === 0) return <span className="text-xs text-gray-400">모든 역할</span>
    return (
      <div className="flex flex-wrap gap-1">
        {roles.map(r => (
          <span key={r} className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
            {ROLE_LABEL[r] || r}
          </span>
        ))}
      </div>
    )
  }

  function OrgBadges({ codes }: { codes: string[] }) {
    if (codes.length === 0) return <span className="text-xs text-gray-400">전체 소속</span>
    return (
      <div className="flex flex-wrap gap-1">
        {codes.map(c => {
          const org = orgs.find(o => o.code === c)
          return (
            <span key={c} className="inline-block rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
              {org?.name || c}
            </span>
          )
        })}
      </div>
    )
  }

  function RoleCheckboxes({ selected, onChange }: { selected: string[], onChange: (roles: string[]) => void }) {
    return (
      <div className="flex flex-wrap gap-2">
        {ALL_ROLES.map(role => (
          <label key={role} className="flex items-center gap-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(role)}
              onChange={() => onChange(toggleRole(selected, role))}
              className="rounded border-gray-300"
            />
            {ROLE_LABEL[role]}
          </label>
        ))}
      </div>
    )
  }

  function OrgCheckboxes({ selected, onChange }: { selected: string[], onChange: (codes: string[]) => void }) {
    return (
      <div className="flex flex-wrap gap-2">
        {orgs.map(org => (
          <label key={org.code} className="flex items-center gap-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(org.code)}
              onChange={() => onChange(toggleOrg(selected, org.code))}
              className="rounded border-gray-300"
            />
            {org.name}
          </label>
        ))}
      </div>
    )
  }

  function renderTable(title: string, list: NavItem[]) {
    return (
      <div className="mb-8">
        <h2 className="text-base font-semibold text-gray-800 mb-3">{title}</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left w-16">순서</th>
                <th className="px-3 py-2 text-left w-10">아이콘</th>
                <th className="px-3 py-2 text-left">메뉴명</th>
                <th className="px-3 py-2 text-left w-44">경로</th>
                <th className="px-3 py-2 text-left">허용 역할</th>
                <th className="px-3 py-2 text-left">허용 소속</th>
                <th className="px-3 py-2 text-center w-16">활성</th>
                <th className="px-3 py-2 text-center w-28">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((item, idx) => {
                const isEditing = editId === item.id
                return (
                  <tr key={item.id} className={`${!item.isActive ? 'bg-gray-50 opacity-60' : ''} ${isEditing ? 'bg-yellow-50' : ''}`}>
                    {/* 순서 */}
                    <td className="px-3 py-2">
                      <div className="flex gap-0.5">
                        <button
                          disabled={idx === 0 || busy}
                          onClick={() => handleMove(list, idx, -1)}
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title="위로"
                        >&#9650;</button>
                        <button
                          disabled={idx === list.length - 1 || busy}
                          onClick={() => handleMove(list, idx, 1)}
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title="아래로"
                        >&#9660;</button>
                      </div>
                    </td>
                    {/* 아이콘 */}
                    <td className="px-3 py-2 text-gray-500">
                      {isEditing ? (
                        <select
                          value={editData.iconKey ?? ''}
                          onChange={e => setEditData({ ...editData, iconKey: e.target.value || null })}
                          className="w-20 text-xs border border-gray-300 rounded px-1 py-0.5"
                        >
                          <option value="">없음</option>
                          {ICON_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      ) : (
                        getMenuIcon(item.iconKey)
                      )}
                    </td>
                    {/* 메뉴명 */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          value={editData.label ?? ''}
                          onChange={e => setEditData({ ...editData, label: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') handleSave(item); if (e.key === 'Escape') cancelEdit() }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                          autoFocus
                        />
                      ) : (
                        <div>
                          <span className="font-medium">{item.label}</span>
                          <span className="ml-2 text-xs text-gray-400">{item.menuKey}</span>
                        </div>
                      )}
                    </td>
                    {/* 경로 */}
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono">{item.href}</td>
                    {/* 허용 역할 */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <RoleCheckboxes
                          selected={editData.allowedRoles ?? []}
                          onChange={roles => setEditData({ ...editData, allowedRoles: roles })}
                        />
                      ) : (
                        <RoleBadges roles={item.allowedRoles} />
                      )}
                    </td>
                    {/* 허용 소속 */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <OrgCheckboxes
                          selected={editData.allowedOrgCodes ?? []}
                          onChange={codes => setEditData({ ...editData, allowedOrgCodes: codes })}
                        />
                      ) : (
                        <OrgBadges codes={item.allowedOrgCodes} />
                      )}
                    </td>
                    {/* 활성 토글 */}
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => handleToggleActive(item)}
                        disabled={busy}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${item.isActive ? 'bg-blue-600' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${item.isActive ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                    {/* 액션 */}
                    <td className="px-3 py-2 text-center">
                      {isEditing ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => handleSave(item)} disabled={busy} className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">저장</button>
                          <button onClick={cancelEdit} className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-300">취소</button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => startEdit(item)} disabled={busy} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200">수정</button>
                          <button onClick={() => handleDelete(item)} disabled={busy} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">삭제</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded" />
          <div className="h-64 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1400px]">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">네비게���션 메뉴 관리</h1>
        <button
          onClick={() => setIsAdding(v => !v)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          {isAdding ? '추가 취소' : '+ 메뉴 추가'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <p className="text-xs text-gray-500 mb-4">
        허용 역할이 비어있으면 모든 역할에게 노출됩니다. 허용 소속이 비어있으면 전체 소속에게 노출됩니다.
      </p>

      {/* 새 메뉴 추가 */}
      {isAdding && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="text-sm font-semibold mb-3">새 메뉴 추가</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="text-xs text-gray-600">메뉴 키 *</label>
              <input
                value={addData.menuKey}
                onChange={e => setAddData({ ...addData, menuKey: e.target.value })}
                placeholder="예: new-feature"
                className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">메뉴명 *</label>
              <input
                value={addData.label}
                onChange={e => setAddData({ ...addData, label: e.target.value })}
                placeholder="표시될 메뉴 이름"
                className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">경로 *</label>
              <input
                value={addData.href}
                onChange={e => setAddData({ ...addData, href: e.target.value })}
                placeholder="/경로"
                className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">상위 메뉴</label>
              <select
                value={addData.parentKey}
                onChange={e => setAddData({ ...addData, parentKey: e.target.value })}
                className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
              >
                <option value="">최상위 메뉴</option>
                <option value="settings">설정 하위</option>
              </select>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs text-gray-600">아이콘</label>
              <select
                value={addData.iconKey}
                onChange={e => setAddData({ ...addData, iconKey: e.target.value })}
                className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
              >
                <option value="">없음</option>
                {ICON_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">허용 역할 (비어있으면 전체)</label>
              <RoleCheckboxes
                selected={addData.allowedRoles}
                onChange={roles => setAddData({ ...addData, allowedRoles: roles })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">허용 소속 (비어있으면 전체)</label>
              <OrgCheckboxes
                selected={addData.allowedOrgCodes}
                onChange={codes => setAddData({ ...addData, allowedOrgCodes: codes })}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleAdd}
              disabled={busy}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              추가
            </button>
          </div>
        </div>
      )}

      {renderTable('메인 메뉴', mainItems)}
      {renderTable('설정 하위 메뉴', settingsItems)}
    </div>
  )
}
