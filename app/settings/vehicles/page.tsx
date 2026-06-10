'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ColorPicker from '@/app/components/ColorPicker'

interface Vehicle {
  id: number
  name: string
  plateNumber: string
  model: string | null
  seatCount: number | null
  color: string | null
  memo: string | null
  isActive: boolean
  sortOrder: number
  createdAt: string
  reservationCount: number
}

interface EditForm {
  name: string
  plateNumber: string
  model: string
  seatCount: string
  color: string
  memo: string
  sortOrder: number
  isActive: boolean
}

const emptyForm: EditForm = {
  name: '', plateNumber: '', model: '', seatCount: '', color: '', memo: '', sortOrder: 0, isActive: true,
}

function toForm(v: Vehicle): EditForm {
  return {
    name: v.name,
    plateNumber: v.plateNumber,
    model: v.model ?? '',
    seatCount: v.seatCount != null ? String(v.seatCount) : '',
    color: v.color ?? '',
    memo: v.memo ?? '',
    sortOrder: v.sortOrder,
    isActive: v.isActive,
  }
}

export default function VehiclesSettingsPage() {
  const router = useRouter()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditForm>(emptyForm)

  const [isAdding, setIsAdding] = useState(false)
  const [addForm, setAddForm] = useState<EditForm>(emptyForm)

  const [busy, setBusy] = useState(false)

  async function fetchVehicles() {
    const res = await fetch('/api/vehicles')
    const data = await res.json()
    setVehicles(data.vehicles)
    setLoading(false)
  }

  useEffect(() => { fetchVehicles() }, [])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  function showInfo(msg: string) {
    setInfo(msg)
    setTimeout(() => setInfo(null), 5000)
  }

  async function handleSaveEdit(vehicle: Vehicle) {
    if (!editForm.name.trim() || !editForm.plateNumber.trim()) return
    setBusy(true)
    const res = await fetch(`/api/vehicles/${vehicle.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      router.refresh()
      await fetchVehicles()
      setEditId(null)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleDelete(vehicle: Vehicle) {
    if (!confirm(`'${vehicle.name}(${vehicle.plateNumber})' 차량을 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/vehicles/${vehicle.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      router.refresh()
      await fetchVehicles()
      if (data.deactivated) showInfo(data.message)
    } else {
      showError(data.error)
    }
    setBusy(false)
  }

  async function handleAdd() {
    if (!addForm.name.trim() || !addForm.plateNumber.trim()) return
    setBusy(true)
    const res = await fetch('/api/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...addForm, sortOrder: vehicles.length > 0 ? Math.max(...vehicles.map((v) => v.sortOrder)) + 10 : 0 }),
    })
    if (res.ok) {
      router.refresh()
      await fetchVehicles()
      setIsAdding(false)
      setAddForm(emptyForm)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleMove(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= vehicles.length) return

    const current = vehicles[index]
    const target = vehicles[targetIndex]
    setBusy(true)

    await Promise.all([
      fetch(`/api/vehicles/${current.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...toForm(current), sortOrder: target.sortOrder }),
      }),
      fetch(`/api/vehicles/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...toForm(target), sortOrder: current.sortOrder }),
      }),
    ])

    router.refresh()
    await fetchVehicles()
    setBusy(false)
  }

  function renderFormCells(form: EditForm, setForm: (fn: (f: EditForm) => EditForm) => void, onEnter: () => void, onEscape: () => void) {
    return (
      <>
        <td className="px-4 py-3">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            autoFocus
            placeholder="예: 카니발 1호"
            className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </td>
        <td className="px-4 py-3">
          <input
            type="text"
            value={form.plateNumber}
            onChange={(e) => setForm((f) => ({ ...f, plateNumber: e.target.value }))}
            placeholder="예: 12가3456"
            className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </td>
        <td className="hidden px-4 py-3 sm:table-cell">
          <input
            type="text"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            placeholder="예: 카니발"
            className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </td>
        <td className="hidden px-4 py-3 sm:table-cell">
          <input
            type="number"
            value={form.seatCount}
            onChange={(e) => setForm((f) => ({ ...f, seatCount: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEnter()
              if (e.key === 'Escape') onEscape()
            }}
            placeholder="9"
            className="w-16 rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </td>
        <td className="hidden px-4 py-3 md:table-cell">
          <ColorPicker value={form.color} onChange={(c) => setForm((f) => ({ ...f, color: c }))} />
        </td>
        <td className="hidden px-4 py-3 text-center md:table-cell">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </td>
      </>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">차량 관리</h1>
            <p className="mt-1 text-sm text-gray-500">차량예약에 사용되는 법인차량을 관리합니다.</p>
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => { setIsAdding(true); setEditId(null) }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 차량 추가
            </button>
          )}
        </div>

        {/* 에러 */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 안내 (비활성화 처리 결과 등) */}
        {info && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {info}
          </div>
        )}

        {/* 테이블 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-16 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">순서</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">차량명</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">차량번호</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:table-cell">모델</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:table-cell">인승</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:table-cell">색상</th>
                <th className="hidden px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 md:table-cell">활성</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                </tr>
              ) : vehicles.length === 0 && !isAdding ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-gray-400">등록된 차량이 없습니다.</td>
                </tr>
              ) : (
                vehicles.map((vehicle, index) => (
                  <tr key={vehicle.id} className={`hover:bg-gray-50 ${!vehicle.isActive ? 'opacity-50' : ''}`}>

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
                            disabled={index === vehicles.length - 1 || busy}
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

                    {editId === vehicle.id ? (
                      renderFormCells(editForm, setEditForm, () => handleSaveEdit(vehicle), () => setEditId(null))
                    ) : (
                      <>
                        {/* 차량명 */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {vehicle.color && (
                              <span
                                className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-200"
                                style={{ backgroundColor: vehicle.color }}
                              />
                            )}
                            <span className="text-sm font-medium text-gray-900">{vehicle.name}</span>
                          </div>
                        </td>

                        {/* 차량번호 */}
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm text-gray-900">{vehicle.plateNumber}</span>
                        </td>

                        {/* 모델 */}
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <span className="text-sm text-gray-500">{vehicle.model || '-'}</span>
                        </td>

                        {/* 인승 */}
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <span className="text-sm text-gray-500">{vehicle.seatCount != null ? `${vehicle.seatCount}인승` : '-'}</span>
                        </td>

                        {/* 색상 */}
                        <td className="hidden px-4 py-3 md:table-cell">
                          {vehicle.color ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="inline-block h-4 w-4 rounded-full border border-gray-200" style={{ backgroundColor: vehicle.color }} />
                              <span className="font-mono text-xs text-gray-400">{vehicle.color}</span>
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>

                        {/* 활성 여부 */}
                        <td className="hidden px-4 py-3 text-center md:table-cell">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            vehicle.isActive
                              ? 'bg-green-50 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            {vehicle.isActive ? '활성' : '비활성'}
                          </span>
                        </td>
                      </>
                    )}

                    {/* 액션 */}
                    <td className="px-4 py-3 text-right align-top">
                      {editId === vehicle.id ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleSaveEdit(vehicle)}
                            disabled={busy || !editForm.name.trim() || !editForm.plateNumber.trim()}
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
                            onClick={() => {
                              setEditId(vehicle.id)
                              setEditForm(toForm(vehicle))
                              setIsAdding(false)
                            }}
                            disabled={busy}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDelete(vehicle)}
                            disabled={busy}
                            className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}

              {/* 추가 행 */}
              {isAdding && (
                <tr className="bg-blue-50">
                  <td className="px-4 py-3 text-sm text-gray-400">{vehicles.length + 1}</td>
                  {renderFormCells(addForm, setAddForm, handleAdd, () => { setIsAdding(false); setAddForm(emptyForm) })}
                  <td className="px-4 py-3 text-right align-top">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={handleAdd}
                        disabled={busy || !addForm.name.trim() || !addForm.plateNumber.trim()}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        추가
                      </button>
                      <button
                        onClick={() => { setIsAdding(false); setAddForm(emptyForm) }}
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

        <p className="mt-3 text-xs text-gray-400">
          예약 이력이 있는 차량은 삭제 시 자동으로 비활성화 처리됩니다. 비활성 차량은 새 예약을 받을 수 없습니다.
        </p>

      </div>
    </div>
  )
}
