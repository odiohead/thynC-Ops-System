'use client'

/**
 * GROUP D 공용 소형 헬퍼 — EventsTab · WardPanel · ImportPanel 이 함께 쓰는 페이저·날짜 포맷·이벤트 요약.
 * (스켈레톤 파일이 아님 — 그룹 D 소유. 다른 그룹은 import하지 않는다.)
 */
import { useEffect, useRef } from 'react'
import Button from '@/app/components/ui/Button'
import { cn } from '@/lib/cn'
import { DEVICE_EVENT_TYPE_LABELS, toYmd, todayKst } from '@/lib/deviceRegistryShared'
import type { DeviceDetailEvent, DeviceEvent } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// 날짜
// ─────────────────────────────────────────────────────────────────────────────

/** @db.Date ISO('YYYY-MM-DDT00:00:00.000Z') · YYYY-MM-DD → 'YYYY-MM-DD' (없으면 '—') */
export function ymdOrDash(v: string | null | undefined): string {
  return toYmd(v) ?? '—'
}

/** ISO → 'MM-DD' */
export function fmtMd(v: string | null | undefined): string {
  const y = toYmd(v)
  return y ? y.slice(5) : '—'
}

/** 타임스탬프 → KST 'YYYY-MM-DD HH:mm' */
export function fmtDateTimeKst(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const hm = d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${ymd} ${hm}`
}

/** 타임스탬프의 KST 날짜(YYYY-MM-DD) */
export function kstYmd(v: string | null | undefined): string | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

/** YYYY-MM-DD 에서 n일 빼기 */
/** 전역 '최근 이벤트' 기본 기간(일) — §6.1-A '최근 이벤트 탭 = 전역 이벤트 목록(기본 30일)' */
export const DEFAULT_GLOBAL_EVENT_DAYS = 30
/** 전역 최근 이벤트 기본 시작일(KST 오늘 − 30일) */
export function defaultGlobalEventFrom(): string {
  return ymdMinusDays(todayKst(), DEFAULT_GLOBAL_EVENT_DAYS)
}

export function ymdMinusDays(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// ─────────────────────────────────────────────────────────────────────────────
// 이벤트 요약(내용 열 — 병동 from→to · 교체 상대 · CORRECT 변경)
// ─────────────────────────────────────────────────────────────────────────────

const CHANGE_FIELD_LABELS: Record<string, string> = {
  deviceInfoId: '모델',
  deviceModel: '모델',
  serialNo: '시리얼',
  serialRaw: '원문',
  macAddress: 'MAC',
  extDeviceCode: '닉네임',
}

function fmtChangeValue(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 이벤트 1건 → 내용 문구 */
export function eventContent(ev: DeviceDetailEvent | DeviceEvent): string {
  const from = ev.fromWard?.name ?? '미지정'
  const to = ev.toWard?.name ?? '미지정'
  switch (ev.eventType) {
    case 'REGISTER': {
      const parts = [`→ ${to}`]
      if (ev.relatedDevice) parts.push(`교체 ${ev.relatedDevice.serialNo} 대체`)
      if (ev.importBatch) parts.push(`임포트 #${ev.importBatch.id}`)
      return parts.join(' · ')
    }
    case 'MOVE_WARD':
      return `${from} → ${to}`
    case 'RECOVER': {
      const parts = [`${from} 회수`]
      if (ev.relatedDevice) parts.push(`→ 교체 ${ev.relatedDevice.serialNo}`)
      return parts.join(' ')
    }
    case 'CORRECT': {
      const ch = ev.changes ?? {}
      const items = Object.entries(ch).map(([k, v]) => `${CHANGE_FIELD_LABELS[k] ?? k} ${fmtChangeValue(v?.before)} → ${fmtChangeValue(v?.after)}`)
      return items.length ? items.join(' · ') : '식별 정보 정정'
    }
    default:
      return DEVICE_EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 페이저(서버 페이지네이션)
// ─────────────────────────────────────────────────────────────────────────────

export interface PagerProps {
  page: number
  total: number
  limit: number
  onPage: (page: number) => void
  className?: string
  /** 표시 단위(기본 '건') */
  unit?: string
}

export function Pager({ page, total, limit, onPage, className, unit = '건' }: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)))
  const start = total === 0 ? 0 : (page - 1) * limit + 1
  const end = Math.min(total, page * limit)
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground', className)}>
      <span className="tabular-nums">
        총 {total.toLocaleString()}
        {unit}
        {total > 0 && (
          <>
            {' '}
            · {start.toLocaleString()}–{end.toLocaleString()}
          </>
        )}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            이전
          </Button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            다음
          </Button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 디바운스 콜백
// ─────────────────────────────────────────────────────────────────────────────

/** 마지막 호출 후 `delay` ms 뒤 1회 실행. 언마운트 시 대기 취소 */
export function useDebounced<T extends unknown[]>(fn: (...args: T) => void, delay = 400): (...args: T) => void {
  const fnRef = useRef(fn)
  const timer = useRef<number | null>(null)
  fnRef.current = fn
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    []
  )
  return (...args: T) => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      fnRef.current(...args)
    }, delay)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 소형 표시
// ─────────────────────────────────────────────────────────────────────────────

/** 헤더는 유지하고 본문 자리에 안내 1행(빈 상태·로딩·오류 공용) */
export function TableMessageRow({ colSpan, children, tone = 'muted' }: { colSpan: number; children: React.ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <tr>
      <td colSpan={colSpan} className={cn('px-4 py-10 text-center text-sm', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
        {children}
      </td>
    </tr>
  )
}

/** 요약 칩(숫자 강조) */
export function StatChip({ label, value, active, onClick, tone }: { label: string; value: number | string; active?: boolean; onClick?: () => void; tone?: string }) {
  const Comp = onClick ? 'button' : 'span'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs tabular-nums',
        active ? 'border-primary bg-primary-subtle text-primary-subtle-foreground' : 'border-border bg-card text-muted-foreground',
        onClick && 'transition-colors hover:border-primary/60 hover:text-foreground',
        tone
      )}
    >
      <span>{label}</span>
      <span className="font-semibold text-foreground">{typeof value === 'number' ? value.toLocaleString() : value}</span>
    </Comp>
  )
}
