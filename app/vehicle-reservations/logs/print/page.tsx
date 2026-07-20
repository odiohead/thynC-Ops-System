'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * 차량 운행일지 인쇄 페이지 — A4 가로, 차량별 1장(페이지 나눔).
 * /vehicle-reservations 운행일지 탭의 '인쇄' 버튼에서 현재 필터(차량·기간)로 열림.
 */

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
  vehicle: { id: number; name: string; plateNumber: string }
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function PrintContent() {
  const sp = useSearchParams()
  const vehicleId = sp.get('vehicleId')
  const from = sp.get('from')
  const to = sp.get('to')
  const [logs, setLogs] = useState<VehicleLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams()
    if (vehicleId) params.set('vehicleId', vehicleId)
    if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString())
    if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString())
    fetch(`/api/vehicle-logs?${params.toString()}`)
      .then(async (r) => { if (r.ok) setLogs((await r.json()).logs ?? []) })
      .finally(() => setLoading(false))
  }, [vehicleId, from, to])

  // 차량별 그룹 (시트 1장씩) — 표 안은 운행 종료 시각 오름차순
  const groups = useMemo(() => {
    const map = new Map<number, { vehicle: VehicleLog['vehicle']; rows: VehicleLog[] }>()
    for (const log of logs) {
      if (!map.has(log.vehicleId)) map.set(log.vehicleId, { vehicle: log.vehicle, rows: [] })
      map.get(log.vehicleId)!.rows.push(log)
    }
    const arr = Array.from(map.values())
    arr.forEach((g) => g.rows.sort((a, b) => a.endAt.localeCompare(b.endAt)))
    arr.sort((a, b) => a.vehicle.name.localeCompare(b.vehicle.name, 'ko'))
    return arr
  }, [logs])

  const period = `${from ?? ''} ~ ${to ?? ''}`
  const printedAt = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })

  return (
    <div className="mx-auto max-w-[277mm] bg-white p-6 text-gray-900 print:p-0">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body { background: #fff !important; }
        }
        .log-sheet { break-after: page; }
        .log-sheet:last-child { break-after: auto; }
      `}</style>

      {/* 화면 전용 툴바 */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div className="text-sm text-gray-500">
          {loading ? '불러오는 중...' : `차량 ${groups.length}대 · 운행 기록 ${logs.length}건 — 차량별 1장으로 인쇄됩니다 (A4 가로).`}
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.close()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">닫기</button>
          <button onClick={() => window.print()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">인쇄</button>
        </div>
      </div>

      {!loading && groups.length === 0 && (
        <div className="py-24 text-center text-sm text-gray-400">해당 기간의 운행 기록이 없습니다.</div>
      )}

      {groups.map(({ vehicle, rows }) => {
        const total = rows.reduce((sum, l) => sum + (l.distanceKm ?? 0), 0)
        return (
          <div key={vehicle.id} className="log-sheet mb-10 print:mb-0">
            <h1 className="mb-3 text-center text-xl font-bold tracking-[0.3em]">차 량 운 행 일 지</h1>
            <div className="mb-2 flex items-end justify-between text-sm">
              <div className="flex gap-6">
                <span>차량명: <b>{vehicle.name}</b></span>
                <span>차량번호: <b className="font-mono">{vehicle.plateNumber}</b></span>
                <span>기간: {period}</span>
              </div>
              <div className="text-xs text-gray-500">출력일: {printedAt}</div>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100 text-xs">
                  {['번호', '운행일자', '운행시간', '운전자', '운행목적', '행선지', '계기판거리(km)', '주행거리(km)', '비고'].map((h) => (
                    <th key={h} className="border border-gray-400 px-2 py-1.5 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((log, i) => (
                  <tr key={log.id}>
                    <td className="border border-gray-400 px-2 py-1 text-center tabular-nums">{i + 1}</td>
                    <td className="border border-gray-400 px-2 py-1 text-center whitespace-nowrap tabular-nums">{fmtDate(log.startAt)}</td>
                    <td className="border border-gray-400 px-2 py-1 text-center whitespace-nowrap tabular-nums">{fmtTime(log.startAt)} ~ {fmtTime(log.endAt)}</td>
                    <td className="border border-gray-400 px-2 py-1 text-center">{log.driver.name}</td>
                    <td className="border border-gray-400 px-2 py-1">{log.purpose || ''}</td>
                    <td className="border border-gray-400 px-2 py-1">{log.destination || ''}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right tabular-nums">{log.endOdometer.toLocaleString()}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right tabular-nums">{log.distanceKm != null ? log.distanceKm.toLocaleString() : ''}</td>
                    <td className="border border-gray-400 px-2 py-1 text-xs">{log.note || ''}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td colSpan={7} className="border border-gray-400 px-2 py-1.5 text-right">합계 주행거리</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{total.toLocaleString()}</td>
                  <td className="border border-gray-400 px-2 py-1.5" />
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

export default function VehicleLogPrintPage() {
  return (
    <Suspense fallback={<div className="py-24 text-center text-sm text-gray-400">불러오는 중...</div>}>
      <PrintContent />
    </Suspense>
  )
}
