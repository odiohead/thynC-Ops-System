'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'

interface FieldEngineerUser {
  id: string
  name: string
  email: string
  department?: { name: string } | null
}

type WorkType = 'PROJECT' | 'INSTALL_PLAN' | 'MAINTENANCE'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelect: (users: { id: string; name: string; email: string }[]) => void
  currentAssigneeIds: string[]
  title?: string
  workType?: WorkType
}

export default function FieldEngineerSelectModal({
  isOpen,
  onClose,
  onSelect,
  currentAssigneeIds,
  title = '담당자 선택',
  workType = 'PROJECT',
}: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<FieldEngineerUser[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [checkedMap, setCheckedMap] = useState<Map<string, { id: string; name: string; email: string }>>(new Map())
  const limit = 10
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // debounce search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [search])

  // Initialize checked state from currentAssigneeIds
  useEffect(() => {
    if (isOpen) {
      const map = new Map<string, { id: string; name: string; email: string }>()
      currentAssigneeIds.forEach((id) => map.set(id, { id, name: '', email: '' }))
      setCheckedMap(map)
      setSearch('')
      setDebouncedSearch('')
      setPage(1)
    }
  }, [isOpen, currentAssigneeIds])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(limit), workType })
    if (debouncedSearch) params.set('search', debouncedSearch)
    const res = await fetch(`/api/settings/field-engineers?${params}`)
    if (res.ok) {
      const json = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users = (json.data ?? []).map((fe: any) => ({
        id: fe.user.id,
        name: fe.user.name,
        email: fe.user.email,
        department: fe.user.department ?? null,
      }))
      setData(users)
      setTotal(json.total ?? 0)

      // Update names for checked items that we now have data for
      setCheckedMap((prev) => {
        const next = new Map(prev)
        users.forEach((u: FieldEngineerUser) => {
          if (next.has(u.id)) {
            next.set(u.id, { id: u.id, name: u.name, email: u.email })
          }
        })
        return next
      })
    }
    setLoading(false)
  }, [page, debouncedSearch, workType])

  useEffect(() => {
    if (isOpen) fetchData()
  }, [isOpen, fetchData])

  function toggleCheck(user: FieldEngineerUser) {
    setCheckedMap((prev) => {
      const next = new Map(prev)
      if (next.has(user.id)) {
        next.delete(user.id)
      } else {
        next.set(user.id, { id: user.id, name: user.name, email: user.email })
      }
      return next
    })
  }

  function handleConfirm() {
    onSelect(Array.from(checkedMap.values()).filter((u) => u.name))
    onClose()
  }

  if (!isOpen) return null

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '640px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        className="rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상단 고정: 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4" style={{ flexShrink: 0 }}>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 중간 스크롤: 검색 + 테이블 */}
        <div className="p-5" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 이메일로 검색..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">이름</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">이메일</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">부서</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={4} className="py-8 text-center text-sm text-gray-400">불러오는 중...</td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={4} className="py-8 text-center text-sm text-gray-400">검색 결과가 없습니다.</td></tr>
                ) : (
                  data.map((u) => (
                    <tr
                      key={u.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => toggleCheck(u)}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checkedMap.has(u.id)}
                          onChange={() => toggleCheck(u)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2 text-gray-900">{u.name}</td>
                      <td className="px-3 py-2 text-gray-600">{u.email}</td>
                      <td className="px-3 py-2 text-gray-600">{u.department?.name ?? '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 하단 고정: 페이지네이션 + 버튼 */}
        <div className="border-t border-gray-200 px-5 py-4" style={{ flexShrink: 0 }}>
          <div className="flex items-center justify-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              이전
            </button>
            <span className="text-sm text-gray-600">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              다음
            </button>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              선택 완료
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
