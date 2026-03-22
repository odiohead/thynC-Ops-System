'use client'

import { useState } from 'react'

interface DeviceRow {
  deviceInfoId: number
  deviceModel: string
  deviceName: string
  quantity: number
}

interface Props {
  hospitalCode: string
  initialDevices: DeviceRow[]
}

export default function HospitalDevicesSection({ hospitalCode, initialDevices }: Props) {
  const [quantities, setQuantities] = useState<Record<number, number>>(
    Object.fromEntries(initialDevices.map((d) => [d.deviceInfoId, d.quantity]))
  )
  const [isSaving, setIsSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleChange(deviceInfoId: number, value: string) {
    const num = parseInt(value, 10)
    setQuantities((prev) => ({ ...prev, [deviceInfoId]: isNaN(num) || num < 0 ? 0 : num }))
    setSuccessMsg(null)
    setError(null)
  }

  async function handleSave() {
    setIsSaving(true)
    setSuccessMsg(null)
    setError(null)
    try {
      const body = initialDevices.map((d) => ({
        deviceInfoId: d.deviceInfoId,
        quantity: quantities[d.deviceInfoId] ?? 0,
      }))
      const res = await fetch(`/api/hospitals/${hospitalCode}/devices`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '저장에 실패했습니다.')
      setSuccessMsg('저장되었습니다.')
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setIsSaving(false)
    }
  }

  if (initialDevices.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        등록된 기기가 없습니다. 설정 → 기기 관리에서 먼저 기기를 추가하세요.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">기기명</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">모델코드</th>
              <th className="w-28 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">수량</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {initialDevices.map((d) => (
              <tr key={d.deviceInfoId}>
                <td className="px-3 py-2 text-sm text-gray-800">{d.deviceName}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{d.deviceModel}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      value={quantities[d.deviceInfoId] ?? 0}
                      onChange={(e) => handleChange(d.deviceInfoId, e.target.value)}
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none"
                      disabled={isSaving}
                    />
                    <span className="text-xs text-gray-500">대</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSaving && (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {isSaving ? '저장 중…' : '저장'}
        </button>
        {successMsg && <span className="text-xs text-green-600">{successMsg}</span>}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  )
}
