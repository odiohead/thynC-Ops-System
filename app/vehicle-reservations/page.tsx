'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ReservationModal, { ReservationItem, VehicleOption } from './ReservationModal'

interface Me {
  id: string
  name: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'VIEWER'
  vehicleReservationBlocked?: boolean
}

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtTime(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 해당 날짜가 속한 주의 월요일 00:00 */
function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = out.getDay() // 0=일
  out.setDate(out.getDate() - (day === 0 ? 6 : day - 1))
  return out
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export default function VehicleReservationsPage() {
  const router = useRouter()

  const [me, setMe] = useState<Me | null>(null)
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [reservations, setReservations] = useState<ReservationItem[]>([])
  const [myUpcoming, setMyUpcoming] = useState<ReservationItem[]>([])
  const [loading, setLoading] = useState(true)

  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()))
  const [tab, setTab] = useState<'board' | 'mine'>('board')

  // 모달 상태
  const [modal, setModal] = useState<{
    mode: 'create' | 'edit' | 'view'
    reservation?: ReservationItem | null
    initialVehicleId?: number
    initialDate?: string
  } | null>(null)

  const isAdmin = me != null && (me.role === 'SUPER_ADMIN' || me.role === 'ADMIN')
  const isBlocked = me != null && me.vehicleReservationBlocked === true
  const canReserve = me != null && me.role !== 'VIEWER' && !isBlocked

  // URL ?week= 동기화 (최초 1회 읽기)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const w = sp.get('week')
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) {
      const d = new Date(`${w}T00:00:00`)
      if (!isNaN(d.getTime())) setWeekStart(mondayOf(d))
    }
  }, [])

  useEffect(() => {
    const url = `/vehicle-reservations?week=${toDateStr(weekStart)}`
    window.history.replaceState(null, '', url)
  }, [weekStart])

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data?.id ? { id: data.id, name: data.name, role: data.role, vehicleReservationBlocked: data.vehicleReservationBlocked } : null))
      .catch(() => setMe(null))
    fetch('/api/vehicles?activeOnly=true')
      .then((res) => res.json())
      .then((data) => setVehicles(data.vehicles ?? []))
  }, [])

  const fetchReservations = useCallback(async () => {
    const from = weekStart
    const to = addDays(weekStart, 7)
    const res = await fetch(
      `/api/vehicle-reservations?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    )
    if (res.ok) {
      const data = await res.json()
      setReservations(data.reservations ?? [])
    }
    setLoading(false)
  }, [weekStart])

  const fetchMyUpcoming = useCallback(async () => {
    const res = await fetch(
      `/api/vehicle-reservations?mine=true&from=${encodeURIComponent(new Date().toISOString())}`,
    )
    if (res.ok) {
      const data = await res.json()
      setMyUpcoming(data.reservations ?? [])
    }
  }, [])

  useEffect(() => { fetchReservations() }, [fetchReservations])
  useEffect(() => { fetchMyUpcoming() }, [fetchMyUpcoming])

  function handleSaved() {
    setModal(null)
    router.refresh()
    fetchReservations()
    fetchMyUpcoming()
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const todayStr = toDateStr(new Date())

  function chipsFor(vehicleId: number, day: Date) {
    const dayStart = day
    const dayEnd = addDays(day, 1)
    return reservations
      .filter((r) => {
        if (r.vehicleId !== vehicleId) return false
        const s = new Date(r.startAt)
        const e = new Date(r.endAt)
        return s < dayEnd && e > dayStart
      })
      .map((r) => {
        const s = new Date(r.startAt)
        const e = new Date(r.endAt)
        const clipS = s < dayStart ? dayStart : s
        const clipE = e > dayEnd ? dayEnd : e
        return {
          r,
          label: `${s < dayStart ? '←' : ''}${fmtTime(clipS)}~${e > dayEnd ? '24:00→' : fmtTime(clipE)}`,
        }
      })
      .sort((a, b) => new Date(a.r.startAt).getTime() - new Date(b.r.startAt).getTime())
  }

  function openView(r: ReservationItem) {
    setModal({ mode: 'view', reservation: r })
  }

  function openCreate(vehicleId: number, day: Date) {
    if (!canReserve) return
    setModal({ mode: 'create', initialVehicleId: vehicleId, initialDate: toDateStr(day) })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">차량예약</h1>
            <p className="mt-1 text-sm text-gray-500">법인차량 주간 예약 현황입니다. 빈 영역을 클릭해 예약하세요.</p>
          </div>
          {canReserve && (
            <button
              type="button"
              onClick={() => setModal({ mode: 'create', initialDate: todayStr })}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 예약하기
            </button>
          )}
        </div>

        {isBlocked && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            차량예약 사용이 제한된 계정입니다. 예약 등록·수정·취소가 불가하며 현황 조회만 가능합니다. 문의는 관리자에게 해주세요.
          </div>
        )}

        {/* 탭 + 주 네비게이션 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
            <button
              onClick={() => setTab('board')}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === 'board' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              현황 보드
            </button>
            <button
              onClick={() => setTab('mine')}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === 'mine' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              내 예약 {myUpcoming.length > 0 && <span className="ml-1 rounded-full bg-white/20 px-1.5 text-xs">{myUpcoming.length}</span>}
            </button>
          </div>

          {tab === 'board' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                ◀ 이전 주
              </button>
              <button
                onClick={() => setWeekStart(mondayOf(new Date()))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                오늘
              </button>
              <button
                onClick={() => setWeekStart(addDays(weekStart, 7))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                다음 주 ▶
              </button>
              <span className="ml-2 text-sm font-medium text-gray-700">
                {weekStart.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} ~{' '}
                {addDays(weekStart, 6).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
              </span>
            </div>
          )}
        </div>

        {/* 현황 보드 */}
        {tab === 'board' && (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] table-fixed border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-44 border-r border-gray-200 px-3 py-2 text-left text-xs font-medium text-gray-500">차량</th>
                  {days.map((d, i) => {
                    const isToday = toDateStr(d) === todayStr
                    const isWeekend = i >= 5
                    return (
                      <th
                        key={i}
                        className={`border-r border-gray-100 px-2 py-2 text-center text-xs font-medium last:border-r-0 ${
                          isToday ? 'bg-blue-50 text-blue-700' : isWeekend ? 'bg-gray-100/60 text-gray-400' : 'text-gray-500'
                        }`}
                      >
                        <div>{DAY_LABELS[i]}</div>
                        <div className={`text-sm ${isToday ? 'font-bold' : ''}`}>{d.getDate()}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {vehicles.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-sm text-gray-400">
                      {loading ? '불러오는 중...' : '등록된 차량이 없습니다. 설정 > 차량 관리에서 차량을 등록하세요.'}
                    </td>
                  </tr>
                ) : (
                  vehicles.map((v) => (
                    <tr key={v.id} className="border-b border-gray-100 last:border-b-0">
                      {/* 차량 정보 */}
                      <td className="border-r border-gray-200 px-3 py-2 align-top">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-200"
                            style={{ backgroundColor: v.color || '#9CA3AF' }}
                          />
                          <div>
                            <div className="text-sm font-medium text-gray-900">{v.name}</div>
                            <div className="font-mono text-xs text-gray-400">{v.plateNumber}</div>
                          </div>
                        </div>
                      </td>
                      {/* 요일 셀 */}
                      {days.map((d, i) => {
                        const chips = chipsFor(v.id, d)
                        const isToday = toDateStr(d) === todayStr
                        const isWeekend = i >= 5
                        return (
                          <td
                            key={i}
                            onClick={() => openCreate(v.id, d)}
                            className={`h-20 border-r border-gray-100 p-1 align-top last:border-r-0 ${
                              isToday ? 'bg-blue-50/40' : isWeekend ? 'bg-gray-50/60' : ''
                            } ${canReserve ? 'cursor-pointer hover:bg-blue-50/60' : ''}`}
                          >
                            <div className="flex flex-col gap-1">
                              {chips.map(({ r, label }) => {
                                const mine = me != null && r.user.id === me.id
                                return (
                                  <button
                                    key={`${r.id}-${i}`}
                                    onClick={(e) => { e.stopPropagation(); openView(r) }}
                                    style={{ borderLeftColor: v.color || '#9CA3AF' }}
                                    className={`w-full rounded border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight transition-colors ${
                                      mine
                                        ? 'bg-blue-100 text-blue-900 ring-1 ring-blue-300 hover:bg-blue-200'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                    title={`${r.user.name}${r.purpose ? ` · ${r.purpose}` : ''}`}
                                  >
                                    <div className="font-medium tabular-nums">{label}</div>
                                    <div className="truncate">
                                      {r.user.name}
                                      {r.purpose && <span className="text-gray-400"> · {r.purpose}</span>}
                                    </div>
                                  </button>
                                )
                              })}
                              {/* 예약이 차 있어도 항상 클릭 가능한 신규 예약 여백 (hover 시 + 표시) */}
                              {canReserve && (
                                <div
                                  className={`flex items-center justify-center rounded text-xs font-medium text-transparent transition-colors hover:bg-blue-100/80 hover:text-blue-500 ${
                                    chips.length > 0 ? 'min-h-[20px]' : 'min-h-[64px]'
                                  }`}
                                  title="새 예약"
                                >
                                  +
                                </div>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 내 예약 */}
        {tab === 'mine' && (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">차량</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">이용 시간</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:table-cell">목적</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:table-cell">행선지</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {myUpcoming.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-sm text-gray-400">다가오는 예약이 없습니다.</td>
                  </tr>
                ) : (
                  myUpcoming.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-200"
                            style={{ backgroundColor: r.vehicle.color || '#9CA3AF' }}
                          />
                          <div>
                            <div className="text-sm font-medium text-gray-900">{r.vehicle.name}</div>
                            <div className="font-mono text-xs text-gray-400">{r.vehicle.plateNumber}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {new Date(r.startAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
                        {' ~ '}
                        {new Date(r.endAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 sm:table-cell">{r.purpose || '-'}</td>
                      <td className="hidden px-4 py-3 text-sm text-gray-500 sm:table-cell">{r.destination || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openView(r)}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                        >
                          상세
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 범례 */}
        {tab === 'board' && (
          <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded bg-blue-100 ring-1 ring-blue-300" /> 내 예약
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded bg-gray-100" /> 다른 사용자 예약
            </span>
            {canReserve && <span>빈 영역 클릭 = 해당 차량·날짜로 바로 예약</span>}
          </div>
        )}

      </div>

      {/* 예약 모달 */}
      {modal && (
        <ReservationModal
          mode={modal.mode}
          vehicles={vehicles}
          reservation={modal.reservation}
          initialVehicleId={modal.initialVehicleId}
          initialDate={modal.initialDate}
          canEdit={
            modal.reservation != null &&
            me != null &&
            me.role !== 'VIEWER' &&
            !isBlocked &&
            (modal.reservation.user.id === me.id || isAdmin)
          }
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
