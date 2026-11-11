'use client'

/**
 * AS 대시보드 공용 조각 (projects/as_dashboard_design.md §6) — 탭 4개가 같은 블록·숫자 표기·목록 링크 규칙을 쓴다.
 * 색: 차트 계열색은 `useDashPalette` 한 곳(라이트/다크 각각 검증한 값). 글자는 계열색을 쓰지 않는다(식별은 옆의 색 점·막대가 담당).
 */
import Link from 'next/link'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import type { Pair } from '@/lib/asDashboard'

/** 화면 필터 상태 — 기간 프리셋 키 + 실제 날짜 + 구분·기기군·병원 */
export type RangeKey = '7d' | '30d' | '90d' | 'month' | 'lastMonth' | 'year' | 'all' | 'custom'
export interface DashQuery {
  rangeKey: RangeKey
  from: string
  to: string
  category: '' | 'FAULT' | 'LOST'
  group: '' | 'ECG' | 'SPO2'
  hospital: { hospitalCode: string; hospitalName: string } | null
}

/**
 * AS 접수 목록 링크 — 대시보드 필터를 목록 필터로 옮긴다(구분·기기군·병원, 필요하면 접수일 기간).
 * 병원은 목록이 병원명 검색(`q`+`field=hospital`)으로 받으므로 그 형식으로 넘긴다(병원 상세 AS 현황 블록과 동일).
 */
export function asListHref(q: DashQuery, opts: { period?: boolean; hospitalName?: string; extra?: [string, string][] } = {}): string {
  const p = new URLSearchParams()
  if (opts.period) { p.set('from', q.from); p.set('to', q.to) }
  if (q.category) p.set('category', q.category)
  if (q.group) p.set('group', q.group)
  const name = opts.hospitalName ?? q.hospital?.hospitalName
  if (name) { p.set('q', name); p.set('field', 'hospital') }
  for (const [k, v] of opts.extra ?? []) p.append(k, v)
  const qs = p.toString()
  return qs ? `/as-receipts?${qs}` : '/as-receipts'
}

export const CATEGORY_LABEL: Record<string, string> = { FAULT: '고장', LOST: '분실' }
export const CATEGORY_BADGE: Record<string, string> = { FAULT: 'bg-amber-100 text-amber-800', LOST: 'bg-red-100 text-red-700' }

export const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString())
export const days = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}일`)
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`)

/** 차트 계열색 — 고장/분실/흐름선 3색(범주), 경과일 4단계(한 색상 밝기 순서). 라이트·다크 모두 표면 대비·색각 구분을 검증한 값 */
export function useDashPalette() {
  const chart = useChartTheme()
  return {
    chart,
    fault: chart.dark ? '#3987e5' : '#2a78d6',
    lost: chart.dark ? '#d95926' : '#eb6834',
    flow: chart.dark ? '#199e70' : '#1baf7a',
    /** 경과일 구간(짧음 → 김). 다크에서는 긴 쪽이 밝다(표면에서 멀수록 눈에 띄게) */
    aging: chart.dark ? ['#184f95', '#256abf', '#5598e7', '#b7d3f6'] : ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
    surface: chart.dark ? 'hsl(222 33% 11%)' : '#ffffff',
    axis: { tick: { fontSize: 11, fill: chart.tick }, axisLine: false as const, tickLine: false as const },
  }
}
export type DashPalette = ReturnType<typeof useDashPalette>

/** 블록 — 제목 + (선택) 설명·우측 조작 */
export function Section({ title, hint, right, children, className = '' }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
        </div>
        {right && <div className="flex min-w-0 flex-wrap items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  )
}

export interface StatCell { label: string; value: string; unit?: string; sub?: React.ReactNode; title?: string; href?: string; alert?: boolean }
/** 숫자 한 줄 — 카드 나열 대신 한 띠 안에 칸으로. 칸에 href가 있으면 해당 목록으로 이동 */
export function StatStrip({ cells }: { cells: StatCell[] }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-gray-200 bg-white sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
      {cells.map((c) => {
        const body = (
          <>
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${c.alert ? 'text-red-600' : 'text-gray-900'}`}>
              {c.value}{c.unit && <span className="ml-0.5 text-sm font-medium text-gray-500">{c.unit}</span>}
            </p>
            <div className="mt-0.5 min-h-4 text-xs text-gray-500">{c.sub}</div>
          </>
        )
        const cls = '-mb-px -mr-px block border-b border-r border-gray-100 px-4 py-3'
        return c.href
          ? <Link key={c.label} prefetch={false} href={c.href} title={c.title} className={`${cls} hover:bg-gray-50`}>{body}</Link>
          : <div key={c.label} title={c.title} className={cls}>{body}</div>
      })}
    </div>
  )
}

/** 직전 동기간 대비 — 방향 기호 + 차이(+%) 를 본문색으로(늘고 줄어듦에 좋고 나쁨을 칠하지 않는다) */
export function Delta({ pair, unit = '' }: { pair: Pair; unit?: string }) {
  const d = pair.cur - pair.prev
  if (!pair.prev && !pair.cur) return <span className="text-gray-400">직전 기간 —</span>
  const rate = pair.prev ? ` (${d >= 0 ? '+' : ''}${Math.round((d / pair.prev) * 100)}%)` : ''
  return <span title={`직전 같은 길이 기간 ${pair.prev.toLocaleString()}${unit}`}>직전 대비 {d > 0 ? '▲' : d < 0 ? '▼' : '='} {Math.abs(d).toLocaleString()}{rate}</span>
}

/** 비중 막대 한 줄 — 이름 · 막대 · 건수(비중) */
export function ShareRow({ label, count, total, color, unit = '' }: { label: string; count: number; total: number; color: string; unit?: string }) {
  const share = total ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="w-28 shrink-0 truncate text-gray-700" title={label}>{label}</span>
      <span className="h-2.5 min-w-0 flex-1 rounded-sm bg-gray-100">
        <span className="block h-2.5 rounded-sm" style={{ width: `${Math.max(share, count ? 1.5 : 0)}%`, backgroundColor: color }} />
      </span>
      <span className="w-24 shrink-0 text-right tabular-nums text-gray-900">{count.toLocaleString()}{unit} <span className="text-xs text-gray-500">{total ? `${Math.round(share)}%` : '—'}</span></span>
    </div>
  )
}

/** 범례 한 칸 — 색 점 + 이름 (글자는 본문색) */
export function LegendDot({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1 text-xs text-gray-600"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />{label}</span>
}

/** 작은 토글(세그먼트) */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      {label && <span className="text-xs text-gray-500">{label}</span>}
      <div className="inline-flex overflow-hidden rounded-md border border-gray-300" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={o.value === value}
            className={`border-r border-gray-300 px-2.5 py-1 text-xs font-medium last:border-r-0 ${o.value === value ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export const th = 'whitespace-nowrap px-2 py-1.5 text-left text-xs font-medium text-gray-500'
export const thR = 'whitespace-nowrap px-2 py-1.5 text-right text-xs font-medium text-gray-500'
export const td = 'px-2 py-1.5 text-sm text-gray-800'
export const tdR = 'px-2 py-1.5 text-right text-sm tabular-nums text-gray-800'
export function EmptyRow({ cols, text = '데이터 없음' }: { cols: number; text?: string }) {
  return <tr><td colSpan={cols} className="py-6 text-center text-xs text-gray-400">{text}</td></tr>
}
