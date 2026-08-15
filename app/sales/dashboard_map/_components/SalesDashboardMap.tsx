'use client'

/**
 * 영업 대시보드(지도) — 지역별 도입현황
 * 한반도 지도(7개 권역 병합 폴리곤) 위에 권역별 병원수·병상수 막대를 표시하고,
 * 우측에 KPI·지역별 수치 표·드릴다운(권역 병원 리스트)을 제공한다.
 *
 * 서버는 병원 단위 flat 데이터(hospitals)와 권역×종별 전체 집계(totals)만 내려주고,
 * 종별 필터·막대 모드·지표 토글에 따른 집계는 전부 클라이언트 useMemo로 즉시 재계산한다.
 * - 막대 모드 3종 — 'plain'(도입 수치만) · 'adoption'(도입현황 대비 — 배경 = 전국 도입 합계, 채움 비율 = 지역 구성비)
 *   · 'overlay'(전체 대비 — 배경 = 선택 종별의 전체 병원수/허가병상, 채움 비율 = 침투율). 배경은 연하게, 도입은 진하게.
 * - 막대 높이는 지표별 독립 정규화 (병원수·병상수는 자릿수가 달라 공통 스케일 불가).
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import { REGION_GEO } from './koreaGeo'

export interface MapDashboardData {
  /** 계약완료 딜 보유 병원 (딜 다건 → 1행, region='etc'는 시도 미상) */
  hospitals: DealHospitalRow[]
  /** 권역×종별 전체 집계 — 전체 병원수·허가병상(심평원 연동분) */
  totals: RegionTypeTotalRow[]
  /** 딜 보유 병원에 존재하는 종별 (위계 순) */
  types: string[]
}

export interface DealHospitalRow {
  region: string
  code: string
  name: string
  type: string
  sido: string | null
  deals: number
  devices: number
  lastContract: string | null
}

export interface RegionTypeTotalRow {
  region: string
  type: string
  hospitals: number
  permBeds: number
}

interface RegionRow {
  key: string
  name: string
  hospitals: number
  devices: number
  totalHosp: number
  totalBeds: number
  rate: number | null
}

type Metric = 'both' | 'hospitals' | 'beds'
type BarMode = 'plain' | 'adoption' | 'overlay'
type SortKey = 'hospitals' | 'devices' | 'rate'

// 지도 막대 규격 (와이어프레임 기준)
const BW = 15
const GAP = 4
const MAX_BAR_H = 108
// 콘텐츠 영역만 남긴 크롭 (830×700 좌표계 — 막대·라벨 extents 기준, 제주 하향 배치 포함)
const VIEWBOX = '228 12 442 516'

/**
 * 지도 레이어 줌 — 한반도(베이스맵+폴리곤)만 1.12배 확대, 막대·라벨은 원 크기 유지 (2026-08-15 요청).
 * 이미지·히트 폴리곤은 <g transform>으로 일괄 확대되고, 막대 앵커는 같은 아핀(a*k+t)으로 재배치되어
 * 정렬이 보존된다. tx는 지도 가로 중심(≈464) 고정, ty는 상단(수도권 라벨)·하단(제주 막대) 여백 균형값.
 */
const ZOOM = { k: 1.12, tx: -54, ty: -42 }
const zx = (x: number) => x * ZOOM.k + ZOOM.tx
const zy = (y: number) => y * ZOOM.k + ZOOM.ty

/**
 * 베이스맵 PNG(korea-map-E1-muted-earth, 1137×1905) 배치 — koreaGeo 폴리곤 좌표계로의 정렬 변환.
 * 극점 대응(호미곶·고성·남해안 3점 회귀)으로 유도: sx 0.18599 · sy 0.21609 (이미지가 mercator 대비
 * 세로 ~16% 연장이라 비등방) · 오프셋 (358.43, 101.67). 유도 과정은 설계문서 §4b.
 */
const IMG = { href: '/geo/korea-map-E1-muted-earth.png', x: 358.43, y: 101.67, w: 211.47, h: 411.66 }

/** 큰 수 압축 표기 — 라벨 폭 제한용 (41,831 → 4.2만) */
const fmtMan = (n: number) => (n >= 10000 ? `${Math.round(n / 1000) / 10}만` : n.toLocaleString())

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-gray-400">{sub}</p>}
    </div>
  )
}

export default function SalesDashboardMap({ data }: { data: MapDashboardData }) {
  const chart = useChartTheme()
  const [metric, setMetric] = useState<Metric>('both')
  const [barMode, setBarMode] = useState<BarMode>('plain') // 진입 디폴트: 도입 수치 (2026-08-15 사용자 재확정)
  const [selTypes, setSelTypes] = useState<Set<string>>(new Set())
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'devices', dir: 'desc' })

  const typeActive = (t: string) => selTypes.size === 0 || selTypes.has(t)

  // ── 종별 필터 반영 집계 (전부 클라이언트 즉시 재계산) ──
  const filteredHosp = useMemo(
    () => data.hospitals.filter((h) => typeActive(h.type)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.hospitals, selTypes],
  )

  const regions = useMemo<RegionRow[]>(() => {
    const totByRegion = new Map<string, { hosp: number; beds: number }>()
    data.totals.forEach((t) => {
      if (!typeActive(t.type)) return
      const cur = totByRegion.get(t.region) ?? { hosp: 0, beds: 0 }
      cur.hosp += t.hospitals
      cur.beds += t.permBeds
      totByRegion.set(t.region, cur)
    })
    return REGION_GEO.map((g) => {
      const hs = filteredHosp.filter((h) => h.region === g.key)
      const devices = hs.reduce((a, h) => a + h.devices, 0)
      const tot = totByRegion.get(g.key) ?? { hosp: 0, beds: 0 }
      return {
        key: g.key,
        name: g.name,
        hospitals: hs.length,
        devices,
        totalHosp: tot.hosp,
        totalBeds: tot.beds,
        rate: tot.beds > 0 ? Math.round((devices / tot.beds) * 1000) / 10 : null,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.totals, filteredHosp, selTypes])

  const etc = useMemo(() => {
    const hs = filteredHosp.filter((h) => h.region === 'etc')
    return hs.length > 0 ? { hospitals: hs.length, devices: hs.reduce((a, h) => a + h.devices, 0) } : null
  }, [filteredHosp])

  const kpi = useMemo(() => {
    const devices = filteredHosp.reduce((a, h) => a + h.devices, 0)
    // 침투율 분자는 분모(7개 권역 허가병상)와 모집단을 맞춰 권역 매핑분만 사용 — 기타(시도 미상) 제외
    const mappedDevices = regions.reduce((a, r) => a + r.devices, 0)
    const nationalHosp = regions.reduce((a, r) => a + r.totalHosp, 0)
    const nationalBeds = regions.reduce((a, r) => a + r.totalBeds, 0)
    return {
      hospitals: filteredHosp.length,
      devices,
      nationalHosp,
      nationalBeds,
      nationalRate: nationalBeds > 0 ? Math.round((mappedDevices / nationalBeds) * 1000) / 10 : null,
    }
  }, [filteredHosp, regions])

  // 배경 막대 기준 — overlay('전체 대비')는 권역 전체 병원/허가병상, adoption('도입현황 대비')은 전국 도입 합계
  const hasBg = barMode !== 'plain'
  const bgHospOf = (r: RegionRow) => (barMode === 'overlay' ? r.totalHosp : barMode === 'adoption' ? kpi.hospitals : 0)
  const bgBedsOf = (r: RegionRow) => (barMode === 'overlay' ? r.totalBeds : barMode === 'adoption' ? kpi.devices : 0)
  // 막대 스케일 — 배경 모드는 배경 기준, plain은 도입 수치 기준. 지표별 독립 정규화
  const maxHosp = Math.max(1, ...regions.map((r) => (hasBg ? Math.max(bgHospOf(r), r.hospitals) : r.hospitals)))
  const maxBeds = Math.max(1, ...regions.map((r) => (hasBg ? Math.max(bgBedsOf(r), r.devices) : r.devices)))

  const sorted = useMemo(() => {
    const rows = [...regions]
    const v = (r: RegionRow) => (sort.key === 'rate' ? r.rate ?? -1 : r[sort.key])
    rows.sort((a, b) => (sort.dir === 'desc' ? v(b) - v(a) : v(a) - v(b)))
    return rows
  }, [regions, sort])

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))

  const selectRegion = (key: string) => {
    // 터치 기기에서 탭으로 설정된 hover가 mouseleave 없이 고착되는 것 방지 (클릭 시점에 해제)
    setHoverKey(null)
    setSelectedKey((cur) => (cur === key ? null : key))
  }

  const toggleType = (t: string) =>
    setSelTypes((cur) => {
      const next = new Set(cur)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      // 모든 칩을 켜면 '전체'로 승격 — 두 상태의 집계가 동일하므로 표시도 통일
      return next.size === data.types.length ? new Set<string>() : next
    })

  const selectedRegion = selectedKey === 'etc' ? null : regions.find((r) => r.key === selectedKey) ?? null
  const drillRows = selectedKey ? filteredHosp.filter((h) => h.region === selectedKey) : []

  // 지도 색 (SVG 속성은 CSS 변수를 못 읽어 useChartTheme 패턴으로 분기)
  // 베이스맵이 muted-earth 톤이라 라이트 모드 주변 요소는 warm gray(stone) 계열로 맞춘다
  const c = {
    sea: chart.dark ? 'hsl(222 36% 8%)' : '#faf9f7',
    leader: chart.dark ? 'hsl(215 15% 48%)' : '#a8a29e',
    baseline: chart.dark ? 'hsl(215 15% 42%)' : '#a8a29e',
    ink: chart.dark ? 'hsl(210 30% 88%)' : '#44403c',
    mute: chart.tick,
    hospitals: chart.blue,
    beds: chart.amber,
  }
  // 라벨 헤일로 — 바다·막대 위에서도 읽히도록 배경색으로 테두리
  const haloProps = { paintOrder: 'stroke' as const, stroke: c.sea, strokeWidth: 3, strokeLinejoin: 'round' as const }

  const exportCsv = () => {
    const head = ['지역', '도입 병원수', '전체 병원수', '병상수(디바이스)', '전체 허가병상', '도입률(%)']
    const lines = sorted.map((r) =>
      [r.name, r.hospitals, r.totalHosp, r.devices, r.totalBeds, r.rate ?? ''].join(','),
    )
    if (etc) lines.push(['기타(시도 미상)', etc.hospitals, '', etc.devices, '', ''].join(','))
    lines.push(['합계', kpi.hospitals, kpi.nationalHosp, kpi.devices, kpi.nationalBeds, kpi.nationalRate ?? ''].join(','))
    const typeLabel = selTypes.size === 0 ? '전체' : Array.from(selTypes).join('·')
    const dateStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) // KST 보정
    const blob = new Blob(['﻿' + [`종별:,${typeLabel}`, head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `지역별_도입현황_${dateStr}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const th = 'whitespace-nowrap px-2 py-2 text-right'
  const thBtn = 'select-none text-[11px] font-medium text-gray-400 hover:text-gray-600'
  const td = 'whitespace-nowrap px-2 py-2 text-right text-[13px] tabular-nums text-gray-700'
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : '')
  const rowKeyDown = (key: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectRegion(key)
    }
  }

  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-500 hover:text-gray-700'
    }`
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
      active ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-500 hover:text-gray-700'
    }`

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-bold text-gray-900">지역별 도입현황</h2>
          <span className="text-xs text-gray-400">계약완료 딜 기준 · 병상수 = 대웅 디바이스 수량</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[11px] text-gray-400">막대</span>
            <button className={pill(barMode === 'plain')} onClick={() => setBarMode('plain')}>도입 수치</button>
            <button className={pill(barMode === 'adoption')} onClick={() => setBarMode('adoption')}>도입현황 대비</button>
            <button className={pill(barMode === 'overlay')} onClick={() => setBarMode('overlay')}>전체 대비</button>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[11px] text-gray-400">지표</span>
            <button className={pill(metric === 'both')} onClick={() => setMetric('both')}>병원수 + 병상수</button>
            <button className={pill(metric === 'hospitals')} onClick={() => setMetric('hospitals')}>병원수</button>
            <button className={pill(metric === 'beds')} onClick={() => setMetric('beds')}>병상수</button>
          </span>
        </div>
      </div>

      {/* 종별 필터 — 복수 선택, 선택 즉시 지도·KPI·표 재계산 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-gray-400">종별</span>
        <button className={chip(selTypes.size === 0)} onClick={() => setSelTypes(new Set())}>전체</button>
        {data.types.map((t) => (
          <button key={t} className={chip(selTypes.has(t))} onClick={() => toggleType(t)}>{t}</button>
        ))}
        {selTypes.size > 0 && (
          <span className="text-[11px] text-gray-400">— {selTypes.size}종 선택</span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_430px]">
        {/* 지도 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-gray-700">주요지역별 도입현황</h3>
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              {metric !== 'beds' && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.hospitals }} />병원수
                </span>
              )}
              {metric !== 'hospitals' && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.beds }} />병상수
                </span>
              )}
              {hasBg && <span className="text-gray-400">{barMode === 'overlay' ? '연한 막대 = 선택 종별 전체' : '연한 막대 = 전국 도입 합계'}</span>}
            </div>
          </div>
          <svg viewBox={VIEWBOX} className="mx-auto mt-2 block w-full max-w-[720px]" role="img" aria-label="지역별 도입현황 지도">
            {/* 바다 배경 */}
            <rect x="229" y="13" width="440" height="514" rx="14" fill={c.sea} />

            {/* 지도 레이어 (베이스맵+폴리곤) — ZOOM 아핀으로 일괄 확대 */}
            <g transform={`translate(${ZOOM.tx} ${ZOOM.ty}) scale(${ZOOM.k})`}>
              {/* 베이스맵 PNG — 시각은 이미지가 담당, 상호작용은 아래 투명 폴리곤이 담당 */}
              <image
                href={IMG.href}
                x={IMG.x}
                y={IMG.y}
                width={IMG.w}
                height={IMG.h}
                preserveAspectRatio="none"
                pointerEvents="none"
                style={chart.dark ? { filter: 'brightness(0.85) saturate(0.9)', opacity: 0.95 } : undefined}
              />

              {/* 권역 히트 폴리곤 (투명) + 활성 틴트 */}
              {REGION_GEO.map((r) => (
                <path
                  key={r.key}
                  d={r.d}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverKey(r.key)}
                  onMouseLeave={() => setHoverKey(null)}
                  onClick={() => selectRegion(r.key)}
                >
                  <title>{r.name}</title>
                </path>
              ))}
              {REGION_GEO.map((r) => {
                const active = hoverKey === r.key || selectedKey === r.key
                if (!active) return null
                return (
                  <path
                    key={`hl-${r.key}`}
                    d={r.d}
                    fill={c.hospitals}
                    fillOpacity={selectedKey === r.key ? 0.24 : 0.14}
                    stroke={c.hospitals}
                    strokeWidth="0.8"
                    strokeOpacity="0.5"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                )
              })}
            </g>

            {/* 권역별 막대 그룹 — 앵커는 줌 아핀 적용, 막대·라벨 크기는 원본 유지 */}
            {REGION_GEO.map((r) => {
              const row = regions.find((x) => x.key === r.key)
              if (!row) return null
              const ax = zx(r.anchor[0])
              const ay = zy(r.anchor[1])
              const gx = ax + r.offset[0]
              const gy = ay + r.offset[1]
              // 도입 막대는 값이 있으면 최소 1.5px 보장 (overlay에서 전체 대비 극소수여도 존재가 보이도록)
              const hFg = row.hospitals > 0 ? Math.max((row.hospitals / maxHosp) * MAX_BAR_H, 1.5) : 0
              const bFg = row.devices > 0 ? Math.max((row.devices / maxBeds) * MAX_BAR_H, 1.5) : 0
              const hBg = hasBg ? (bgHospOf(row) / maxHosp) * MAX_BAR_H : 0
              const bBg = hasBg ? (bgBedsOf(row) / maxBeds) * MAX_BAR_H : 0
              const active = hoverKey === r.key || selectedKey === r.key
              const showH = metric !== 'beds'
              const showB = metric !== 'hospitals'
              const both = showH && showB
              // 단일 지표일 땐 막대를 그룹 중앙에 배치
              const hX = both ? -BW - GAP / 2 : -BW / 2
              const bX = both ? GAP / 2 : -BW / 2
              const topY = -Math.max(showH ? Math.max(hFg, hBg) : 0, showB ? Math.max(bFg, bBg) : 0)
              const shareH = kpi.hospitals > 0 ? Math.round((row.hospitals / kpi.hospitals) * 1000) / 10 : 0
              const shareB = kpi.devices > 0 ? Math.round((row.devices / kpi.devices) * 1000) / 10 : 0
              const tip =
                barMode === 'overlay'
                  ? `${r.name} — 병원 ${row.hospitals.toLocaleString()}/${row.totalHosp.toLocaleString()}곳 · 병상 ${row.devices.toLocaleString()}/${row.totalBeds.toLocaleString()}`
                  : barMode === 'adoption'
                    ? `${r.name} — 병원 ${row.hospitals.toLocaleString()}곳 (전국 도입의 ${shareH}%) · 병상 ${row.devices.toLocaleString()} (${shareB}%)`
                    : `${r.name} — 병원 ${row.hospitals.toLocaleString()}곳 · 병상 ${row.devices.toLocaleString()}`
              // 리더선 — 앵커에서 내려와 그룹 측면(앵커 쪽 가장자리)으로 수평 진입.
              // 그룹 중앙 수직 진입은 막대 사이 틈·라벨을 관통한다 (2026-08-14 리뷰)
              const side = Math.sign(ax - gx) || 1
              const leadX = gx + side * (BW + GAP / 2 + 4)
              return (
                <g key={r.key}>
                  <circle cx={ax} cy={ay} r="2.2" fill={c.leader} stroke={c.sea} strokeWidth="1" pointerEvents="none" />
                  <path
                    d={`M ${ax} ${ay} Q ${ax} ${gy} ${leadX} ${gy}`}
                    fill="none"
                    stroke={c.leader}
                    strokeWidth="0.9"
                    strokeOpacity="0.55"
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                  <g
                    transform={`translate(${gx},${gy})`}
                    className="cursor-pointer"
                    opacity={hoverKey && !active ? 0.45 : 1}
                    onMouseEnter={() => setHoverKey(r.key)}
                    onMouseLeave={() => setHoverKey(null)}
                    onClick={() => selectRegion(r.key)}
                  >
                    <title>{tip}</title>
                    {/* 히트 영역 — 실제 막대·라벨 높이만큼만 (고정 크기로 잡으면 인접 그룹 라벨·지도 폴리곤을 가로챈다) */}
                    <rect x={-BW - GAP / 2 - 8} y={topY - 30} width={(BW + GAP / 2 + 8) * 2} height={-topY + 50} fill="transparent" />
                    <line x1={-BW - GAP / 2 - 2} y1="0" x2={BW + GAP / 2 + 2} y2="0" stroke={c.baseline} strokeWidth="1" strokeLinecap="round" />
                    {/* 배경 막대 — overlay(권역 전체)/adoption(전국 도입 합계) */}
                    {showH && hasBg && hBg > 0 && (
                      <rect x={hX} y={-hBg} width={BW} height={hBg} fill={c.hospitals} fillOpacity="0.18" rx="2" />
                    )}
                    {showB && hasBg && bBg > 0 && (
                      <rect x={bX} y={-bBg} width={BW} height={bBg} fill={c.beds} fillOpacity="0.18" rx="2" />
                    )}
                    {/* 전경(도입) 막대 */}
                    {showH && (
                      <rect x={hX} y={-hFg} width={BW} height={hFg} fill={c.hospitals} fillOpacity={active ? 1 : 0.9} rx="2" />
                    )}
                    {showB && (
                      <rect x={bX} y={-bFg} width={BW} height={bFg} fill={c.beds} fillOpacity={active ? 1 : 0.9} rx="2" />
                    )}
                    {/* 수치 라벨 — 두 지표일 땐 그룹 상단에 시리즈 색으로 스택.
                        배경 모드에선 '도입/기준' 병기 — 라벨이 배경 막대 꼭대기에 앉으므로
                        도입 값만 쓰면 배경 막대의 값으로 오독된다 (2026-08-14 리뷰) */}
                    {both ? (
                      <>
                        <text y={topY - 18} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={c.hospitals} {...haloProps}>
                          {row.hospitals.toLocaleString()}
                          {hasBg && <tspan fontWeight="400" fill={c.mute}>/{fmtMan(bgHospOf(row))}</tspan>}곳
                        </text>
                        <text y={topY - 6} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={c.beds} {...haloProps}>
                          {row.devices.toLocaleString()}
                          {hasBg && <tspan fontWeight="400" fill={c.mute}>/{bgBedsOf(row) > 0 ? fmtMan(bgBedsOf(row)) : '-'}</tspan>}
                        </text>
                      </>
                    ) : (
                      <text y={topY - 6} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={showH ? c.hospitals : c.beds} {...haloProps}>
                        {showH ? row.hospitals.toLocaleString() : row.devices.toLocaleString()}
                        {hasBg && (
                          <tspan fontWeight="400" fill={c.mute}>
                            /{showH ? fmtMan(bgHospOf(row)) : bgBedsOf(row) > 0 ? fmtMan(bgBedsOf(row)) : '-'}
                          </tspan>
                        )}
                        {showH ? '곳' : ''}
                      </text>
                    )}
                    <text y="14" textAnchor="middle" fontSize="11.5" fontWeight={active ? 700 : 500} fill={c.ink} {...haloProps}>
                      {r.name}
                    </text>
                  </g>
                </g>
              )
            })}
          </svg>
          <p className="mt-1 text-[11px] text-gray-400">
            막대 높이는 지표별 최대 지역 대비 상대값{barMode === 'overlay' && ' (전체 대비: 연한 막대 = 선택 종별 전체, 채움 비율 = 침투율)'}{barMode === 'adoption' && ' (도입현황 대비: 연한 막대 = 전국 도입 합계, 채움 비율 = 지역 구성비)'} · 권역/막대 클릭 → 해당 지역 병원 리스트
          </p>
        </div>

        {/* 우측 — KPI · 표 · 드릴다운 */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Kpi
              label="도입 병원수"
              value={`${kpi.hospitals.toLocaleString()}곳`}
              sub={`전체 ${kpi.nationalHosp.toLocaleString()}곳 중`}
            />
            <Kpi label="도입 병상수" value={kpi.devices.toLocaleString()} sub="대웅 디바이스 수량" />
            <Kpi
              label="병상 침투율"
              value={kpi.nationalRate !== null ? `${kpi.nationalRate}%` : '-'}
              sub={`허가병상 ${kpi.nationalBeds.toLocaleString()} 대비`}
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                지역별 수치
                {selTypes.size > 0 && (
                  <span className="ml-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                    {Array.from(selTypes).join('·')}
                  </span>
                )}
              </h3>
              <button onClick={exportCsv} className="text-[11px] text-blue-600 hover:underline">CSV 내보내기</button>
            </div>
            <table className="mt-2 w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-gray-400">지역</th>
                  <th className={th}><button type="button" className={thBtn} onClick={() => toggleSort('hospitals')}>병원수{arrow('hospitals')}</button></th>
                  <th className={th}><button type="button" className={thBtn} onClick={() => toggleSort('devices')}>병상수{arrow('devices')}</button></th>
                  <th className={th}><button type="button" className={thBtn} onClick={() => toggleSort('rate')} title="지역 허가병상(심평원 연동분) 대비 도입 병상">도입률{arrow('rate')}</button></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((r) => {
                  const active = hoverKey === r.key || selectedKey === r.key
                  return (
                    <tr
                      key={r.key}
                      tabIndex={0}
                      aria-label={`${r.name} 도입 병원 리스트 열기`}
                      className={`cursor-pointer transition-colors focus:outline-none focus-visible:bg-blue-50 dark:focus-visible:bg-blue-500/10 ${active ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50'}`}
                      onMouseEnter={() => setHoverKey(r.key)}
                      onMouseLeave={() => setHoverKey(null)}
                      onClick={() => selectRegion(r.key)}
                      onKeyDown={rowKeyDown(r.key)}
                    >
                      <td className="px-2 py-2 text-left text-[13px] font-medium text-gray-900">{r.name}</td>
                      <td className={td}>
                        {r.hospitals.toLocaleString()}
                        {barMode === 'overlay' && <span className="ml-0.5 text-[11px] text-gray-400">/{r.totalHosp.toLocaleString()}</span>}
                        {barMode === 'adoption' && kpi.hospitals > 0 && (
                          <span className="ml-0.5 text-[11px] text-gray-400">({Math.round((r.hospitals / kpi.hospitals) * 1000) / 10}%)</span>
                        )}
                      </td>
                      <td className={td}>
                        {r.devices.toLocaleString()}
                        {barMode === 'overlay' && <span className="ml-0.5 text-[11px] text-gray-400">/{r.totalBeds > 0 ? r.totalBeds.toLocaleString() : '-'}</span>}
                        {barMode === 'adoption' && kpi.devices > 0 && (
                          <span className="ml-0.5 text-[11px] text-gray-400">({Math.round((r.devices / kpi.devices) * 1000) / 10}%)</span>
                        )}
                      </td>
                      <td className={td}>{r.rate !== null ? `${r.rate}%` : '-'}</td>
                    </tr>
                  )
                })}
                {etc && (
                  <tr
                    tabIndex={0}
                    aria-label="기타(시도 미상) 도입 병원 리스트 열기"
                    className={`cursor-pointer transition-colors focus:outline-none focus-visible:bg-blue-50 dark:focus-visible:bg-blue-500/10 ${selectedKey === 'etc' ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50'}`}
                    onClick={() => selectRegion('etc')}
                    onKeyDown={rowKeyDown('etc')}
                  >
                    <td className="px-2 py-2 text-left text-[13px] text-gray-500">기타 (시도 미상)</td>
                    <td className={td}>{etc.hospitals.toLocaleString()}</td>
                    <td className={td}>{etc.devices.toLocaleString()}</td>
                    <td className={td}>-</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-300">
                  <td className="px-2 py-2 text-left text-[13px] font-bold text-gray-900">합계</td>
                  <td className={`${td} font-bold text-gray-900`}>
                    {kpi.hospitals.toLocaleString()}
                    {barMode === 'overlay' && <span className="ml-0.5 text-[11px] font-normal text-gray-400">/{kpi.nationalHosp.toLocaleString()}</span>}
                  </td>
                  <td className={`${td} font-bold text-gray-900`}>
                    {kpi.devices.toLocaleString()}
                    {barMode === 'overlay' && <span className="ml-0.5 text-[11px] font-normal text-gray-400">/{kpi.nationalBeds > 0 ? kpi.nationalBeds.toLocaleString() : '-'}</span>}
                  </td>
                  <td className={`${td} font-bold text-gray-900`}>{kpi.nationalRate !== null ? `${kpi.nationalRate}%` : '-'}</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-1.5 text-[11px] text-gray-400">
              도입률 = 지역 허가병상수(심평원 연동분, 딜 보유 종별 기준) 대비 도입 병상 · 열 클릭 정렬
            </p>
          </div>

          {/* 드릴다운 — 선택 권역 병원 리스트 */}
          {selectedKey && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  {selectedRegion?.name ?? '기타 (시도 미상)'} 도입 병원
                  <span className="ml-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                    {drillRows.length}곳
                  </span>
                </h3>
                <button onClick={() => setSelectedKey(null)} className="text-xs text-gray-400 hover:text-gray-600" aria-label="닫기">✕ 닫기</button>
              </div>
              <div className="mt-2 max-h-[320px] overflow-auto">
                {drillRows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">도입 병원이 없습니다.</p>
                ) : (
                  <table className="min-w-full">
                    <thead className="sticky top-0 bg-white">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-[11px] font-medium text-gray-400">병원명</th>
                        <th className="px-2 py-1.5 text-left text-[11px] font-medium text-gray-400">종별</th>
                        <th className="px-2 py-1.5 text-left text-[11px] font-medium text-gray-400">시도</th>
                        <th className="px-2 py-1.5 text-right text-[11px] font-medium text-gray-400">딜</th>
                        <th className="px-2 py-1.5 text-right text-[11px] font-medium text-gray-400">병상</th>
                        <th className="px-2 py-1.5 text-left text-[11px] font-medium text-gray-400">최근 계약</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {drillRows.map((h) => (
                        <tr key={h.code} className="hover:bg-gray-50">
                          <td className="max-w-[150px] truncate px-2 py-1.5 text-[12px] font-medium" title={h.name}>
                            <Link href={`/hospitals/${h.code}`} className="text-blue-600 hover:underline">{h.name}</Link>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-[12px] text-gray-600">{h.type}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-[12px] text-gray-600">{h.sido ?? '-'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right text-[12px] tabular-nums text-gray-700">{h.deals}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right text-[12px] tabular-nums text-gray-700">{h.devices.toLocaleString()}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-[12px] tabular-nums text-gray-500">{h.lastContract ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">병상 = 대웅 디바이스 수량 합 · 병원명 클릭 → 병원 상세</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
