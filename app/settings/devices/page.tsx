'use client'

import { useState, useEffect } from 'react'

interface DeviceInfo {
  id: number
  deviceModel: string
  deviceName: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  usageCount: number
}

interface EditForm {
  deviceModel: string
  deviceName: string
  sortOrder: number
  isActive: boolean
}

const emptyForm: EditForm = { deviceModel: '', deviceName: '', sortOrder: 0, isActive: true }

export default function DevicesSettingsPage() {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditForm>(emptyForm)

  const [isAdding, setIsAdding] = useState(false)
  const [addForm, setAddForm] = useState<EditForm>(emptyForm)

  const [busy, setBusy] = useState(false)

  async function fetchDevices() {
    const res = await fetch('/api/settings/devices')
    const data = await res.json()
    setDevices(data.devices)
    setLoading(false)
  }

  useEffect(() => { fetchDevices() }, [])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  function showInfo(msg: string) {
    setInfo(msg)
    setTimeout(() => setInfo(null), 5000)
  }

  async function handleSaveEdit(device: DeviceInfo) {
    if (!editForm.deviceModel.trim() || !editForm.deviceName.trim()) return
    setBusy(true)
    const res = await fetch(`/api/settings/devices/${device.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      await fetchDevices()
      setEditId(null)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleDelete(device: DeviceInfo) {
    if (!confirm(`'${device.deviceName}(${device.deviceModel})' 기기를 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/devices/${device.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      await fetchDevices()
      if (data.deactivated) showInfo(data.message)
    } else {
      showError(data.error)
    }
    setBusy(false)
  }

  async function handleAdd() {
    if (!addForm.deviceModel.trim() || !addForm.deviceName.trim()) return
    setBusy(true)
    const res = await fetch('/api/settings/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    if (res.ok) {
      await fetchDevices()
      setIsAdding(false)
      setAddForm(emptyForm)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleMove(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= devices.length) return

    const current = devices[index]
    const target = devices[targetIndex]
    setBusy(true)

    await Promise.all([
      fetch(`/api/settings/devices/${current.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceModel: current.deviceModel,
          deviceName: current.deviceName,
          isActive: current.isActive,
          sortOrder: target.sortOrder,
        }),
      }),
      fetch(`/api/settings/devices/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceModel: target.deviceModel,
          deviceName: target.deviceName,
          isActive: target.isActive,
          sortOrder: current.sortOrder,
        }),
      }),
    ])

    await fetchDevices()
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">기기 관리</h1>
            <p className="mt-1 text-sm text-gray-500">프로젝트에 사용되는 기기 정보를 관리합니다.</p>
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => { setIsAdding(true); setEditId(null) }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 기기 추가
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
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">모델 코드</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">기기명</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:table-cell">등록일</th>
                <th className="hidden px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 md:table-cell">활성</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                </tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-gray-400">등록된 기기가 없습니다.</td>
                </tr>
              ) : (
                devices.map((device, index) => (
                  <tr key={device.id} className={`hover:bg-gray-50 ${!device.isActive ? 'opacity-50' : ''}`}>

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
                            disabled={index === devices.length - 1 || busy}
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

                    {/* 모델 코드 */}
                    <td className="px-4 py-3">
                      {editId === device.id ? (
                        <input
                          type="text"
                          value={editForm.deviceModel}
                          onChange={(e) => setEditForm((f) => ({ ...f, deviceModel: e.target.value }))}
                          className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="예: ECG-100"
                        />
                      ) : (
                        <span className="text-sm font-mono font-medium text-gray-900">{device.deviceModel}</span>
                      )}
                    </td>

                    {/* 기기명 */}
                    <td className="px-4 py-3">
                      {editId === device.id ? (
                        <input
                          type="text"
                          value={editForm.deviceName}
                          onChange={(e) => setEditForm((f) => ({ ...f, deviceName: e.target.value }))}
                          autoFocus
                          className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="예: 심전계"
                        />
                      ) : (
                        <span className="text-sm text-gray-900">{device.deviceName}</span>
                      )}
                    </td>

                    {/* 등록일 */}
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <span className="text-sm text-gray-500">
                        {new Date(device.createdAt).toLocaleDateString('ko-KR')}
                      </span>
                    </td>

                    {/* 활성 여부 */}
                    <td className="hidden px-4 py-3 text-center md:table-cell">
                      {editId === device.id ? (
                        <input
                          type="checkbox"
                          checked={editForm.isActive}
                          onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      ) : (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          device.isActive
                            ? 'bg-green-50 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {device.isActive ? '활성' : '비활성'}
                        </span>
                      )}
                    </td>

                    {/* 액션 */}
                    <td className="px-4 py-3 text-right">
                      {editId === device.id ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleSaveEdit(device)}
                            disabled={busy || !editForm.deviceModel.trim() || !editForm.deviceName.trim()}
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
                              setEditId(device.id)
                              setEditForm({
                                deviceModel: device.deviceModel,
                                deviceName: device.deviceName,
                                sortOrder: device.sortOrder,
                                isActive: device.isActive,
                              })
                              setIsAdding(false)
                            }}
                            disabled={busy}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDelete(device)}
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
                  <td className="px-4 py-3 text-sm text-gray-400">{devices.length + 1}</td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={addForm.deviceModel}
                      onChange={(e) => setAddForm((f) => ({ ...f, deviceModel: e.target.value }))}
                      placeholder="모델 코드 (예: ECG-100)"
                      autoFocus
                      className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={addForm.deviceName}
                      onChange={(e) => setAddForm((f) => ({ ...f, deviceName: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAdd()
                        if (e.key === 'Escape') { setIsAdding(false); setAddForm(emptyForm) }
                      }}
                      placeholder="기기명 (예: 심전계)"
                      className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">순서</label>
                      <input
                        type="number"
                        value={addForm.sortOrder}
                        onChange={(e) => setAddForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                        className="w-16 rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-center md:table-cell">
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
                        disabled={busy || !addForm.deviceModel.trim() || !addForm.deviceName.trim()}
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

      </div>
    </div>
  )
}
