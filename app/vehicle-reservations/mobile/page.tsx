'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'

/**
 * 차량 빠른 예약·반납 (모바일 최적화 단일 페이지)
 *
 * 현장에서 폰으로 ①반납 처리(주행거리 입력) ②시간대 선택 → 가능 차량 즉시 검색 → 예약
 * 을 최소 탭으로 끝내는 페이지. 데이터는 기존 API만 사용 (신규 API 없음).
 * 반납 미처리(종료 경과) 건이 있으면 서버가 새 예약을 차단하므로 반납 섹션을 최상단에 배치.
 */

interface Me {
  id: string
  name: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'VIEWER'
  vehicleReservationBlocked?: boolean
}

interface Vehicle {
  id: number
  name: string
  plateNumber: string
  model: string | null
  seatCount: number | null
  color: string | null
  lastOdometer: number | null
}

interface Reservation {
  id: number
  vehicleId: number
  startAt: string
  endAt: string
  purpose: string | null
  destination: string | null
  returnedAt: string | null
  user: { id: string; name: string }
  vehicle: { id: number; name: string; plateNumber: string; color: string | null }
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
/** 현재 시각을 다음 30분 단위로 올림 */
function nextHalfHour(): Date {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() % 30 === 0 ? d.getMinutes() : d.getMinutes() + (30 - (d.getMinutes() % 30)))
  return d
}
function fmtPeriod(s: Date, e: Date) {
  const sameDay = toDateStr(s) === toDateStr(e)
  const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} ${toTimeStr(d)}`
  return sameDay ? `${f(s)} ~ ${toTimeStr(e)}` : `${f(s)} ~ ${f(e)}`
}

/** 30분 간격 시각 옵션 (00:00 ~ 23:30) */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${pad(h)}:${m}`
})

const DURATION_CHIPS = [
  { key: '1', label: '1시간', hours: 1 },
  { key: '2', label: '2시간', hours: 2 },
  { key: '4', label: '4시간', hours: 4 },
  { key: 'day', label: '종일', hours: 0 },
  { key: 'custom', label: '직접 입력', hours: 0 },
] as const
type DurationKey = (typeof DURATION_CHIPS)[number]['key']

export default function MobileVehiclePage() {
  const [me, setMe] = useState<Me | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [myActive, setMyActive] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)

  // ── 예약 폼 상태 ─────────────────────────────
  const initial = nextHalfHour()
  const [dateStr, setDateStr] = useState(() => toDateStr(initial))
  const [startTime, setStartTime] = useState(() => toTimeStr(initial))
  const [duration, setDuration] = useState<DurationKey>('2')
  const [endDateStr, setEndDateStr] = useState(() => toDateStr(initial))
  const [endTime, setEndTime] = useState(() => {
    const e = new Date(initial)
    e.setHours(e.getHours() + 2)
    return toTimeStr(e)
  })
  const [windowReservations, setWindowReservations] = useState<Reservation[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null)
  const [purpose, setPurpose] = useState('')
  const [destination, setDestination] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reserveError, setReserveError] = useState<string | null>(null)
  const [reserveSuccess, setReserveSuccess] = useState<string | null>(null)

  // ── 반납 폼 상태 ─────────────────────────────
  const [returnTargetId, setReturnTargetId] = useState<number | null>(null)
  const [endOdometer, setEndOdometer] = useState('')
  const [returnNote, setReturnNote] = useState('')
  const [returning, setReturning] = useState(false)
  const [returnError, setReturnError] = useState<string | null>(null)
  const [returnSuccess, setReturnSuccess] = useState<string | null>(null)

  const isBlocked = me?.vehicleReservationBlocked === true
  const canAct = me != null && me.role !== 'VIEWER' && !isBlocked

  // ── 예약 시간창 계산 ──────────────────────────
  const { startAt, endAt, windowError } = useMemo(() => {
    const s = new Date(`${dateStr}T${startTime}:00`)
    let e: Date
    if (duration === 'day') {
      const ds = new Date(`${dateStr}T09:00:00`)
      e = new Date(`${dateStr}T18:00:00`)
      return { startAt: ds, endAt: e, windowError: null }
    }
    if (duration === 'custom') {
      e = new Date(`${endDateStr}T${endTime}:00`)
    } else {
      e = new Date(s)
      e.setHours(e.getHours() + DURATION_CHIPS.find((c) => c.key === duration)!.hours)
    }
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return { startAt: s, endAt: e, windowError: '시간을 확인해주세요.' }
    if (s >= e) return { startAt: s, endAt: e, windowError: '종료 시각은 시작 시각보다 늦어야 합니다.' }
    return { startAt: s, endAt: e, windowError: null }
  }, [dateStr, startTime, duration, endDateStr, endTime])

  // ── 데이터 로드 ──────────────────────────────
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d?.id ? { id: d.id, name: d.name, role: d.role, vehicleReservationBlocked: d.vehicleReservationBlocked } : null))
      .catch(() => setMe(null))
    fetch('/api/vehicles?activeOnly=true')
      .then((r) => r.json())
      .then((d) => setVehicles(d.vehicles ?? []))
      .catch(() => {})
  }, [])

  // 내 진행중·반납대기 예약 (시작됐고 미반납)
  const fetchMyActive = useCallback(async () => {
    const res = await fetch(`/api/vehicle-reservations?mine=true&to=${encodeURIComponent(new Date().toISOString())}`)
    if (res.ok) {
      const data = await res.json()
      const list = ((data.reservations ?? []) as Reservation[]).filter((r) => !r.returnedAt)
      list.sort((a, b) => new Date(a.endAt).getTime() - new Date(b.endAt).getTime())
      setMyActive(list)
    }
    setLoading(false)
  }, [])
  useEffect(() => { fetchMyActive() }, [fetchMyActive])

  // 선택 시간창의 예약 조회 → 차량별 가용성
  const fetchWindow = useCallback(async () => {
    if (windowError) return
    const res = await fetch(
      `/api/vehicle-reservations?from=${encodeURIComponent(startAt.toISOString())}&to=${encodeURIComponent(endAt.toISOString())}`,
    )
    if (res.ok) {
      const data = await res.json()
      setWindowReservations(data.reservations ?? [])
    }
  }, [startAt, endAt, windowError])
  useEffect(() => {
    const t = setTimeout(() => void fetchWindow(), 250)
    return () => clearTimeout(t)
  }, [fetchWindow])

  const conflictOf = useCallback(
    (vehicleId: number): Reservation | null => {
      return (
        windowReservations.find(
          (r) => r.vehicleId === vehicleId && new Date(r.startAt) < endAt && new Date(r.endAt) > startAt,
        ) ?? null
      )
    },
    [windowReservations, startAt, endAt],
  )

  const overdue = myActive.filter((r) => new Date(r.endAt) < new Date())
  const hasOverdue = overdue.length > 0

  // ── 반납 처리 ────────────────────────────────
  function openReturn(r: Reservation) {
    setReturnTargetId(r.id === returnTargetId ? null : r.id)
    setEndOdometer('')
    setReturnNote('')
    setReturnError(null)
  }

  async function handleReturn(r: Reservation) {
    const odo = parseInt(endOdometer, 10)
    if (!Number.isInteger(odo) || odo < 0) {
      setReturnError('계기판의 최종 누적 주행거리를 입력해주세요.')
      return
    }
    setReturning(true)
    setReturnError(null)
    try {
      const res = await fetch(`/api/vehicle-reservations/${r.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endOdometer: odo, note: returnNote }),
      })
      if (!res.ok) {
        setReturnError((await res.json()).error ?? '반납에 실패했습니다.')
        return
      }
      setReturnSuccess(`${r.vehicle.name} 반납 완료 (${odo.toLocaleString()} km)`)
      setReturnTargetId(null)
      setReserveError(null) // 반납으로 예약 차단이 풀렸을 수 있음
      await fetchMyActive()
      // 차량 lastOdometer 갱신 반영
      fetch('/api/vehicles?activeOnly=true').then((r2) => r2.json()).then((d) => setVehicles(d.vehicles ?? [])).catch(() => {})
      setTimeout(() => setReturnSuccess(null), 4000)
    } finally {
      setReturning(false)
    }
  }

  // ── 예약 처리 ────────────────────────────────
  async function handleReserve() {
    if (!selectedVehicleId || windowError) return
    setSubmitting(true)
    setReserveError(null)
    setReserveSuccess(null)
    try {
      const res = await fetch('/api/vehicle-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: selectedVehicleId,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          purpose,
          destination,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setReserveError(data.error ?? '예약에 실패했습니다.')
        void fetchWindow()
        return
      }
      const v = vehicles.find((x) => x.id === selectedVehicleId)
      setReserveSuccess(`${v?.name ?? '차량'} 예약 완료 — ${fmtPeriod(startAt, endAt)}`)
      setSelectedVehicleId(null)
      setPurpose('')
      setDestination('')
      void fetchWindow()
      void fetchMyActive()
    } finally {
      setSubmitting(false)
    }
  }

  const now = new Date()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-6 pb-16">

        {/* 헤더 */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">🚗 빠른 예약·반납</h1>
            <p className="mt-0.5 text-xs text-gray-500">법인차량을 폰에서 바로 예약하고 반납하세요.</p>
          </div>
          <Link
            href="/vehicle-reservations"
            className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            주간 보드
          </Link>
        </div>

        {isBlocked && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            차량예약 사용이 제한된 계정입니다. 조회만 가능합니다.
          </div>
        )}

        {returnSuccess && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            ✓ {returnSuccess}
          </div>
        )}

        {/* ── 반납 섹션 (내 진행중·반납대기) ───────────── */}
        {canAct && myActive.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">내 이용 중인 차량</h2>
            <div className="space-y-2">
              {myActive.map((r) => {
                const isOverdue = new Date(r.endAt) < now
                const vehicle = vehicles.find((v) => v.id === r.vehicleId)
                const open = returnTargetId === r.id
                return (
                  <div
                    key={r.id}
                    className={`rounded-xl border bg-white p-4 shadow-sm ${isOverdue ? 'border-amber-300' : 'border-gray-200'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {r.vehicle.color && (
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.vehicle.color }} />
                          )}
                          <span className="truncate text-sm font-semibold text-gray-900">{r.vehicle.name}</span>
                          <span className="shrink-0 text-xs text-gray-400">{r.vehicle.plateNumber}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">{fmtPeriod(new Date(r.startAt), new Date(r.endAt))}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {isOverdue ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">⚠ 반납필요</span>
                        ) : (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">운행중</span>
                        )}
                        <button
                          type="button"
                          onClick={() => openReturn(r)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            open ? 'bg-gray-100 text-gray-600' : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                        >
                          {open ? '접기' : '반납하기'}
                        </button>
                      </div>
                    </div>

                    {/* 반납 인라인 폼 */}
                    {open && (
                      <div className="mt-3 space-y-2.5 border-t border-gray-100 pt-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600">
                            최종 주행거리 (km) <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={endOdometer}
                            onChange={(e) => setEndOdometer(e.target.value)}
                            placeholder={
                              vehicle?.lastOdometer != null
                                ? `직전 기록: ${vehicle.lastOdometer.toLocaleString()} km`
                                : '계기판의 누적 주행거리'
                            }
                            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          {vehicle?.lastOdometer != null && (
                            <p className="mt-1 text-[11px] text-gray-400">직전 운행 종료 거리: {vehicle.lastOdometer.toLocaleString()} km</p>
                          )}
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600">비고 (선택)</label>
                          <input
                            type="text"
                            value={returnNote}
                            onChange={(e) => setReturnNote(e.target.value)}
                            placeholder="특이사항"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        {returnError && <p className="text-xs text-red-500">{returnError}</p>}
                        <button
                          type="button"
                          onClick={() => handleReturn(r)}
                          disabled={returning}
                          className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                        >
                          {returning ? '반납 중...' : '반납 완료'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── 예약 섹션 ─────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">빠른 예약</h2>

          {hasOverdue && canAct && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
              ⚠ 반납 처리하지 않은 이용 건이 있어 새 예약을 할 수 없습니다. 위에서 먼저 반납해주세요.
            </div>
          )}

          {reserveSuccess && (
            <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              ✓ {reserveSuccess}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            {/* 시간 선택 */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">날짜</label>
                <input
                  type="date"
                  value={dateStr}
                  min={toDateStr(new Date())}
                  onChange={(e) => { setDateStr(e.target.value); if (duration === 'custom' && e.target.value > endDateStr) setEndDateStr(e.target.value) }}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">시작 시각</label>
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={duration === 'day'}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                >
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* 이용 시간 칩 */}
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-600">이용 시간</label>
              <div className="flex flex-wrap gap-1.5">
                {DURATION_CHIPS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setDuration(c.key)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      duration === c.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {duration === 'day' && <p className="mt-1.5 text-[11px] text-gray-400">종일: 09:00 ~ 18:00</p>}
            </div>

            {/* 직접 입력: 종료 일시 */}
            {duration === 'custom' && (
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">종료 날짜</label>
                  <input
                    type="date"
                    value={endDateStr}
                    min={dateStr}
                    onChange={(e) => setEndDateStr(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">종료 시각</label>
                  <select
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}

            {windowError && <p className="mt-2 text-xs text-red-500">{windowError}</p>}

            {/* 차량 가용성 목록 */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-600">차량 선택</label>
                {!windowError && (
                  <span className="text-[11px] text-gray-400">{fmtPeriod(startAt, endAt)} 기준</span>
                )}
              </div>
              <div className="space-y-1.5">
                {vehicles.map((v) => {
                  const conflict = windowError ? null : conflictOf(v.id)
                  const available = !windowError && !conflict
                  const selected = selectedVehicleId === v.id
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={!available || !canAct}
                      onClick={() => setSelectedVehicleId(selected ? null : v.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                          : available
                            ? 'border-gray-200 bg-white hover:border-blue-300'
                            : 'border-gray-100 bg-gray-50 opacity-60'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {v.color && <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: v.color }} />}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-900">
                            {v.name} <span className="font-normal text-gray-400">{v.plateNumber}</span>
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {[v.model, v.seatCount ? `${v.seatCount}인승` : null].filter(Boolean).join(' · ') || ' '}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {available ? (
                          <span className={`text-xs font-medium ${selected ? 'text-blue-600' : 'text-green-600'}`}>
                            {selected ? '✓ 선택됨' : '이용 가능'}
                          </span>
                        ) : windowError ? null : (
                          <span className="block text-[11px] leading-tight text-gray-400">
                            {conflict!.user.name}님 예약
                            <br />
                            {fmtPeriod(new Date(conflict!.startAt), new Date(conflict!.endAt))}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
                {vehicles.length === 0 && !loading && (
                  <p className="py-4 text-center text-xs text-gray-400">등록된 차량이 없습니다.</p>
                )}
              </div>
            </div>

            {/* 목적·행선지 + 예약 버튼 */}
            {canAct && selectedVehicleId != null && (
              <div className="mt-4 space-y-2.5 border-t border-gray-100 pt-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">목적</label>
                  <input
                    type="text"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="예: 병원 방문, 자재 운반"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">행선지</label>
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="예: OO병원"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                {reserveError && <p className="text-xs text-red-500">{reserveError}</p>}
                <button
                  type="button"
                  onClick={handleReserve}
                  disabled={submitting || !!windowError || hasOverdue}
                  className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? '예약 중...' : `예약하기 — ${fmtPeriod(startAt, endAt)}`}
                </button>
              </div>
            )}
            {reserveError && selectedVehicleId == null && <p className="mt-3 text-xs text-red-500">{reserveError}</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
