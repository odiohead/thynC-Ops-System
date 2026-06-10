'use client'

import { useState } from 'react'

export interface VehicleOption {
  id: number
  name: string
  plateNumber: string
  color: string | null
}

export interface ReservationItem {
  id: number
  vehicleId: number
  startAt: string
  endAt: string
  purpose: string | null
  destination: string | null
  status: string
  user: { id: string; name: string; email: string }
  vehicle: { id: number; name: string; plateNumber: string; color: string | null }
}

interface Props {
  mode: 'create' | 'edit' | 'view'
  vehicles: VehicleOption[]
  reservation?: ReservationItem | null
  initialVehicleId?: number
  initialDate?: string // YYYY-MM-DD
  canEdit: boolean // 본인 예약 or ADMIN+
  onClose: () => void
  onSaved: () => void
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toTimeStr(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 30분 단위 시각 옵션 (시작: 00:00~23:30 / 종료: 00:30~24:00)
const START_TIMES: string[] = []
const END_TIMES: string[] = []
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const t = `${pad(h)}:${pad(m)}`
    START_TIMES.push(t)
    if (!(h === 0 && m === 0)) END_TIMES.push(t)
  }
}
END_TIMES.push('24:00')

/** 날짜(YYYY-MM-DD) + 시각(HH:MM, 24:00 허용)을 로컬 Date로 변환 */
function combine(dateStr: string, timeStr: string): Date {
  if (timeStr === '24:00') {
    const d = new Date(`${dateStr}T00:00:00`)
    d.setDate(d.getDate() + 1)
    return d
  }
  return new Date(`${dateStr}T${timeStr}:00`)
}

export default function ReservationModal({
  mode: initialMode, vehicles, reservation, initialVehicleId, initialDate, canEdit, onClose, onSaved,
}: Props) {
  const [mode, setMode] = useState(initialMode)
  const isView = mode === 'view'
  const r = reservation

  // 자정(00:00) 종료 예약은 select 옵션에 맞춰 전날 24:00으로 표현
  function initEnd(endAt: string): { date: string; time: string } {
    const d = new Date(endAt)
    if (d.getHours() === 0 && d.getMinutes() === 0) {
      const prev = new Date(d)
      prev.setDate(prev.getDate() - 1)
      return { date: toDateStr(prev), time: '24:00' }
    }
    return { date: toDateStr(d), time: toTimeStr(d) }
  }

  const [vehicleId, setVehicleId] = useState<number>(r?.vehicleId ?? initialVehicleId ?? vehicles[0]?.id ?? 0)
  const [startDate, setStartDate] = useState(r ? toDateStr(new Date(r.startAt)) : initialDate ?? toDateStr(new Date()))
  const [startTime, setStartTime] = useState(r ? toTimeStr(new Date(r.startAt)) : '09:00')
  const [endDate, setEndDate] = useState(r ? initEnd(r.endAt).date : initialDate ?? toDateStr(new Date()))
  const [endTime, setEndTime] = useState(r ? initEnd(r.endAt).time : '18:00')
  const [purpose, setPurpose] = useState(r?.purpose ?? '')
  const [destination, setDestination] = useState(r?.destination ?? '')

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function setAllDay() {
    setStartTime('09:00')
    setEndTime('18:00')
    setEndDate(startDate)
  }

  async function handleSubmit() {
    setError(null)
    const start = combine(startDate, startTime)
    const end = combine(endDate, endTime)
    if (start >= end) {
      setError('종료 시각은 시작 시각보다 늦어야 합니다.')
      return
    }
    setBusy(true)
    const body = {
      vehicleId,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      purpose,
      destination,
    }
    const res = mode === 'create'
      ? await fetch('/api/vehicle-reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      : await fetch(`/api/vehicle-reservations/${r!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
    if (res.ok) {
      onSaved()
    } else {
      setError((await res.json()).error ?? '저장에 실패했습니다.')
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (!r) return
    if (!confirm('이 예약을 취소하시겠습니까?')) return
    setBusy(true)
    const res = await fetch(`/api/vehicle-reservations/${r.id}`, { method: 'DELETE' })
    if (res.ok) {
      onSaved()
    } else {
      setError((await res.json()).error ?? '취소에 실패했습니다.')
      setBusy(false)
    }
  }

  const title = mode === 'create' ? '차량 예약' : mode === 'edit' ? '예약 수정' : '예약 상세'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="space-y-4">
          {/* 예약자 (상세/수정 시) */}
          {r && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-500">예약자</span>
              <span className="text-sm font-medium text-gray-900">{r.user.name}</span>
            </div>
          )}

          {/* 차량 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">차량</label>
            {isView ? (
              <p className="text-sm text-gray-900">{r?.vehicle.name} ({r?.vehicle.plateNumber})</p>
            ) : (
              <select
                value={vehicleId}
                onChange={(e) => setVehicleId(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name} ({v.plateNumber})</option>
                ))}
              </select>
            )}
          </div>

          {/* 시간 */}
          {isView ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">이용 시간</label>
              <p className="text-sm text-gray-900">
                {new Date(r!.startAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
                {' ~ '}
                {new Date(r!.endAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
              </p>
            </div>
          ) : (
            <>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-medium text-gray-500">시작</label>
                  <button
                    type="button"
                    onClick={setAllDay}
                    className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
                  >
                    종일 (09:00~18:00)
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value)
                      if (endDate < e.target.value) setEndDate(e.target.value)
                    }}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <select
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-28 rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {START_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">종료</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <select
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-28 rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {END_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* 목적 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">사용 목적</label>
            {isView ? (
              <p className="text-sm text-gray-900">{r?.purpose || '-'}</p>
            ) : (
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="예: 병원 답사"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
          </div>

          {/* 행선지 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">행선지</label>
            {isView ? (
              <p className="text-sm text-gray-900">{r?.destination || '-'}</p>
            ) : (
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="예: 서울A병원"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
          </div>
        </div>

        {/* 액션 */}
        <div className="mt-6 flex justify-end gap-2">
          {isView && canEdit && (
            <>
              <button
                onClick={handleCancel}
                disabled={busy}
                className="mr-auto rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                예약 취소
              </button>
              <button
                onClick={() => setMode('edit')}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
              >
                수정
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            닫기
          </button>
          {!isView && (
            <button
              onClick={handleSubmit}
              disabled={busy || !vehicleId}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {mode === 'create' ? '예약하기' : '저장'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
