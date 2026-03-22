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
  initialIntroBeds: number | null
  initialDevices: DeviceRow[]
}

function parseQuantity(value: string): number {
  const num = parseInt(value, 10)
  return isNaN(num) || num < 0 ? 0 : num
}

export default function HospitalDevicesSection({ hospitalCode, initialIntroBeds, initialDevices }: Props) {
  const [introBeds, setIntroBeds] = useState<number>(initialIntroBeds ?? 0)
  const [quantities, setQuantities] = useState<Record<number, number>>(
    Object.fromEntries(initialDevices.map((d) => [d.deviceInfoId, d.quantity]))
  )
  const [isSaving, setIsSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleBedsChange(value: string) {
    setIntroBeds(parseQuantity(value))
    setSuccessMsg(null)
    setError(null)
  }

  function handleDeviceChange(deviceInfoId: number, value: string) {
    setQuantities((prev) => ({ ...prev, [deviceInfoId]: parseQuantity(value) }))
    setSuccessMsg(null)
    setError(null)
  }

  async function handleSave() {
    setIsSaving(true)
    setSuccessMsg(null)
    setError(null)
    try {
      const res = await fetch(`/api/hospitals/${hospitalCode}/devices`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          introBeds: introBeds === 0 ? null : introBeds,
          devices: initialDevices.map((d) => ({
            deviceInfoId: d.deviceInfoId,
            quantity: quantities[d.deviceInfoId] ?? 0,
          })),
        }),
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

  return (
    <div className="flex flex-col gap-3">
      <div className="divide-y divide-gray-100 rounded border border-gray-200 bg-white">

        {/* 도입 병상 수 */}
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm text-gray-700">도입 병상 수</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={introBeds}
              onChange={(e) => handleBedsChange(e.target.value)}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none"
              disabled={isSaving}
            />
            <span className="w-5 text-xs text-gray-500">병상</span>
          </div>
        </div>

        {/* 웨어러블 디바이스 그룹 레이블 */}
        <div className="bg-gray-50 px-3 py-2">
          <span className="text-xs font-medium text-gray-500">웨어러블 디바이스 도입 수량</span>
        </div>

        {/* 기기별 행 */}
        {initialDevices.length === 0 ? (
          <div className="px-3 py-3">
            <p className="text-xs text-gray-400">등록된 기기가 없습니다. 설정 → 기기 관리에서 먼저 기기를 추가하세요.</p>
          </div>
        ) : (
          initialDevices.map((d) => (
            <div key={d.deviceInfoId} className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm text-gray-700">{d.deviceName}</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  value={quantities[d.deviceInfoId] ?? 0}
                  onChange={(e) => handleDeviceChange(d.deviceInfoId, e.target.value)}
                  className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none"
                  disabled={isSaving}
                />
                <span className="w-5 text-xs text-gray-500">대</span>
              </div>
            </div>
          ))
        )}
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
