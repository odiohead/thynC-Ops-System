'use client'

import { useState, useEffect, useCallback } from 'react'
import { VehicleOption } from './ReservationModal'

interface Me {
  id: string
  name: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'VIEWER'
}

interface VehicleLog {
  id: number
  vehicleId: number
  reservationId: number | null
  startAt: string
  endAt: string
  purpose: string | null
  destination: string | null
  endOdometer: number
  distanceKm: number | null
  note: string | null
  driver: { id: string; name: string }
  vehicle: { id: number; name: string; plateNumber: string; color: string | null }
}

interface Props {
  me: Me | null
  vehicles: VehicleOption[]
  canWrite: boolean
  isAdmin: boolean
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function VehicleLogsPanel({ me, vehicles, canWrite, isAdmin }: Props) {
  const [vehicleId, setVehicleId] = useState<number | 'all'>('all')
  const today = new Date()
  const [from, setFrom] = useState(toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(toDateStr(today))
  const [logs, setLogs] = useState<VehicleLog[]>([])
  const [totalDistance, setTotalDistance] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editLog, setEditLog] = useState<VehicleLog | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (vehicleId !== 'all') params.set('vehicleId', String(vehicleId))
    if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString())
    if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString())
    const res = await fetch(`/api/vehicle-logs?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      setLogs(data.logs ?? [])
      setTotalDistance(data.totalDistance ?? 0)
    }
    setLoading(false)
  }, [vehicleId, from, to])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  function canModify(log: VehicleLog) {
    return isAdmin || (me != null && log.driver.id === me.id)
  }

  async function handleDelete(log: VehicleLog) {
    if (!confirm('이 운행일지를 삭제하시겠습니까?')) return
    const res = await fetch(`/api/vehicle-logs/${log.id}`, { method: 'DELETE' })
    if (res.ok) fetchLogs()
    else alert((await res.json()).error ?? '삭제에 실패했습니다.')
  }

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">차량</label>
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">전체 차량</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name} ({v.plateNumber})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">시작일</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">종료일</label>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-sm text-gray-600">
            합계 주행거리 <span className="font-semibold tabular-nums text-gray-900">{totalDistance.toLocaleString()}</span> km
          </div>
          {canWrite && (
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 직접 작성
            </button>
          )}
        </div>
      </div>

      {/* 목록 */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">차량</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">운행 기간</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">운전자</th>
              <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:table-cell">목적</th>
              <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 md:table-cell">행선지</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">종료거리</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">주행거리</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-sm text-gray-400">
                  {loading ? '불러오는 중...' : '운행일지가 없습니다.'}
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-200" style={{ backgroundColor: log.vehicle.color || '#9CA3AF' }} />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{log.vehicle.name}</div>
                        <div className="font-mono text-xs text-gray-400">{log.vehicle.plateNumber}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                    {fmtDateTime(log.startAt)} ~ {fmtDateTime(log.endAt)}
                    {log.reservationId == null && <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400">직접</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{log.driver.name}</td>
                  <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">{log.purpose || '-'}</td>
                  <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell">{log.destination || '-'}</td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-700">{log.endOdometer.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums font-medium text-gray-900">
                    {log.distanceKm != null ? `${log.distanceKm.toLocaleString()} km` : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canModify(log) ? (
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setEditLog(log)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100">수정</button>
                        <button onClick={() => handleDelete(log)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50">삭제</button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(showCreate || editLog) && (
        <VehicleLogModal
          vehicles={vehicles}
          log={editLog}
          onClose={() => { setShowCreate(false); setEditLog(null) }}
          onSaved={() => { setShowCreate(false); setEditLog(null); fetchLogs() }}
        />
      )}
    </div>
  )
}

// ===== 직접 작성/수정 모달 =====

interface ModalProps {
  vehicles: VehicleOption[]
  log: VehicleLog | null
  onClose: () => void
  onSaved: () => void
}

function toLocalInput(s: string) {
  const d = new Date(s)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function VehicleLogModal({ vehicles, log, onClose, onSaved }: ModalProps) {
  const isEdit = log != null
  const [vehicleId, setVehicleId] = useState<number>(log?.vehicleId ?? vehicles[0]?.id ?? 0)
  const nowLocal = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })()
  const [startAt, setStartAt] = useState(log ? toLocalInput(log.startAt) : nowLocal)
  const [endAt, setEndAt] = useState(log ? toLocalInput(log.endAt) : nowLocal)
  const [purpose, setPurpose] = useState(log?.purpose ?? '')
  const [destination, setDestination] = useState(log?.destination ?? '')
  const [endOdometer, setEndOdometer] = useState(log ? String(log.endOdometer) : '')
  const [note, setNote] = useState(log?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId)

  async function handleSubmit() {
    setError(null)
    const odo = parseInt(endOdometer, 10)
    if (!vehicleId) { setError('차량을 선택해주세요.'); return }
    if (!Number.isInteger(odo) || odo < 0) { setError('최종 주행거리를 올바르게 입력해주세요.'); return }
    const s = new Date(startAt)
    const e = new Date(endAt)
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s >= e) { setError('운행 시간을 올바르게 입력해주세요.'); return }
    setBusy(true)
    const body = {
      vehicleId,
      startAt: s.toISOString(),
      endAt: e.toISOString(),
      purpose,
      destination,
      endOdometer: odo,
      note,
    }
    const res = isEdit
      ? await fetch(`/api/vehicle-logs/${log!.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/vehicle-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) onSaved()
    else { setError((await res.json()).error ?? '저장에 실패했습니다.'); setBusy(false) }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-gray-900">{isEdit ? '운행일지 수정' : '운행일지 직접 작성'}</h2>
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">차량</label>
            <select value={vehicleId} onChange={(e) => setVehicleId(Number(e.target.value))} className={inputCls}>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.plateNumber})</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-500">운행 시작</label>
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-500">운행 종료</label>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">운행 목적</label>
            <input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="예: 병원 답사" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">행선지</label>
            <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="예: 서울A병원" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">최종 주행거리 (km) <span className="text-red-500">*</span></label>
            <input type="number" inputMode="numeric" min={0} value={endOdometer} onChange={(e) => setEndOdometer(e.target.value)}
              placeholder={selectedVehicle?.lastOdometer != null ? `직전 기록: ${selectedVehicle.lastOdometer.toLocaleString()} km` : '계기판 누적 주행거리'} className={inputCls} />
            {selectedVehicle?.lastOdometer != null && (
              <p className="mt-1 text-xs text-gray-400">직전 운행 종료 거리: {selectedVehicle.lastOdometer.toLocaleString()} km</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">비고 (선택)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100">닫기</button>
          <button onClick={handleSubmit} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">{isEdit ? '저장' : '작성'}</button>
        </div>
      </div>
    </div>
  )
}
