'use client'

import { useState, useEffect } from 'react'

interface Constructor {
  id: number
  code: string
  name: string
  bizRegNumber: string | null
  managerName: string | null
  managerPhone: string | null
  managerEmail: string | null
  createdAt: string
}

interface EditForm {
  name: string
  bizRegNumber: string
  managerName: string
  managerPhone: string
  managerEmail: string
}

const emptyForm: EditForm = {
  name: '',
  bizRegNumber: '',
  managerName: '',
  managerPhone: '',
  managerEmail: '',
}

function formFromConstructor(c: Constructor): EditForm {
  return {
    name: c.name,
    bizRegNumber: c.bizRegNumber ?? '',
    managerName: c.managerName ?? '',
    managerPhone: c.managerPhone ?? '',
    managerEmail: c.managerEmail ?? '',
  }
}

export default function ConstructorsSettingsPage() {
  const [constructors, setConstructors] = useState<Constructor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editCode, setEditCode] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>(emptyForm)

  const [isAdding, setIsAdding] = useState(false)
  const [addForm, setAddForm] = useState<EditForm>(emptyForm)

  const [busy, setBusy] = useState(false)

  async function fetchConstructors() {
    const res = await fetch('/api/constructors')
    const data = await res.json()
    setConstructors(data.constructors ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchConstructors() }, [])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  async function handleSaveEdit(c: Constructor) {
    if (!editForm.name.trim()) return
    setBusy(true)
    const res = await fetch(`/api/constructors/${c.code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      await fetchConstructors()
      setEditCode(null)
    } else {
      showError((await res.json()).error ?? '수정에 실패했습니다.')
    }
    setBusy(false)
  }

  async function handleDelete(c: Constructor) {
    if (!confirm(`'${c.name}(${c.code})' 공사업체를 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/constructors/${c.code}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      await fetchConstructors()
    } else {
      showError(data.error ?? '삭제에 실패했습니다.')
    }
    setBusy(false)
  }

  async function handleAdd() {
    if (!addForm.name.trim()) return
    setBusy(true)
    const res = await fetch('/api/constructors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    if (res.ok) {
      await fetchConstructors()
      setIsAdding(false)
      setAddForm(emptyForm)
    } else {
      showError((await res.json()).error ?? '등록에 실패했습니다.')
    }
    setBusy(false)
  }

  const inputCls = 'w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">공사업체 관리</h1>
            <p className="mt-1 text-sm text-gray-500">구축 프로젝트에 연결되는 공사업체 정보를 관리합니다.</p>
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => { setIsAdding(true); setEditCode(null) }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 업체 추가
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* 테이블 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">업체코드</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">업체명</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:table-cell">사업자등록번호</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 lg:table-cell">담당자명</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 lg:table-cell">담당자연락처</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 xl:table-cell">담당자이메일</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr><td colSpan={7} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td></tr>
                ) : constructors.length === 0 && !isAdding ? (
                  <tr><td colSpan={7} className="py-12 text-center text-sm text-gray-400">등록된 공사업체가 없습니다.</td></tr>
                ) : (
                  constructors.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-medium text-gray-900">{c.code}</span>
                      </td>
                      <td className="px-4 py-3">
                        {editCode === c.code ? (
                          <input type="text" value={editForm.name} autoFocus onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="업체명" />
                        ) : (
                          <span className="text-sm text-gray-900">{c.name}</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {editCode === c.code ? (
                          <input type="text" value={editForm.bizRegNumber} onChange={(e) => setEditForm((f) => ({ ...f, bizRegNumber: e.target.value }))} className={inputCls} placeholder="000-00-00000" />
                        ) : (
                          <span className="text-sm text-gray-600">{c.bizRegNumber ?? '-'}</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {editCode === c.code ? (
                          <input type="text" value={editForm.managerName} onChange={(e) => setEditForm((f) => ({ ...f, managerName: e.target.value }))} className={inputCls} placeholder="담당자명" />
                        ) : (
                          <span className="text-sm text-gray-600">{c.managerName ?? '-'}</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {editCode === c.code ? (
                          <input type="text" value={editForm.managerPhone} onChange={(e) => setEditForm((f) => ({ ...f, managerPhone: e.target.value }))} className={inputCls} placeholder="010-0000-0000" />
                        ) : (
                          <span className="text-sm text-gray-600">{c.managerPhone ?? '-'}</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 xl:table-cell">
                        {editCode === c.code ? (
                          <input type="email" value={editForm.managerEmail} onChange={(e) => setEditForm((f) => ({ ...f, managerEmail: e.target.value }))} className={inputCls} placeholder="email@example.com" />
                        ) : (
                          <span className="text-sm text-gray-600">{c.managerEmail ?? '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editCode === c.code ? (
                          <div className="flex justify-end gap-2">
                            <button onClick={() => handleSaveEdit(c)} disabled={busy || !editForm.name.trim()} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">저장</button>
                            <button onClick={() => setEditCode(null)} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">취소</button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => { setEditCode(c.code); setEditForm(formFromConstructor(c)); setIsAdding(false) }}
                              disabled={busy}
                              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                            >수정</button>
                            <button onClick={() => handleDelete(c)} disabled={busy} className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50">삭제</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}

                {/* 추가 행 */}
                {isAdding && (
                  <tr className="bg-blue-50">
                    <td className="px-4 py-3 text-sm text-gray-400">자동생성</td>
                    <td className="px-4 py-3">
                      <input type="text" value={addForm.name} autoFocus onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="업체명 *" className={inputCls} />
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <input type="text" value={addForm.bizRegNumber} onChange={(e) => setAddForm((f) => ({ ...f, bizRegNumber: e.target.value }))} placeholder="사업자등록번호" className={inputCls} />
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <input type="text" value={addForm.managerName} onChange={(e) => setAddForm((f) => ({ ...f, managerName: e.target.value }))} placeholder="담당자명" className={inputCls} />
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <input type="text" value={addForm.managerPhone} onChange={(e) => setAddForm((f) => ({ ...f, managerPhone: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setIsAdding(false); setAddForm(emptyForm) } }} placeholder="담당자연락처" className={inputCls} />
                    </td>
                    <td className="hidden px-4 py-3 xl:table-cell">
                      <input type="email" value={addForm.managerEmail} onChange={(e) => setAddForm((f) => ({ ...f, managerEmail: e.target.value }))} placeholder="담당자이메일" className={inputCls} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={handleAdd} disabled={busy || !addForm.name.trim()} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">추가</button>
                        <button onClick={() => { setIsAdding(false); setAddForm(emptyForm) }} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">취소</button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
