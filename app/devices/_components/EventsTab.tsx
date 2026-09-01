'use client'

/**
 * 이력 탭(병원) / 최근 이벤트 탭(전역, hospitalCode=null · 기본 최근 30일) (§6.1) — GROUP D
 * 필터: 기간(from/to) · 유형(type) · 시리얼(q — URL 동기화) · 연결 유형(refType) · 출처(source) · (전역은 병원 열 추가)
 * 컬럼: 업무일자 | 유형 | 시리얼 | 모델 | 내용(병동 from→to · 교체 상대 relatedDevice) | 사유 | 연결(refLink) | 기록자 | 메모
 *  - 같은 actionGroup의 교체·이관 쌍은 1행 '교체 B033167→B035120' / 임포트 배치는 1행 '등록 127대 (배치 #12) ▸'(펼치면 개별) — 서버는 개별 행을 주므로 클라이언트에서 페이지 내 접기
 *  - 시리얼 클릭 → onOpenDevice(device.id). 기록 시각이 업무일자와 다르면 회색 병기. 편집됨(editedAt) 표시.
 * getEvents({ hospital, q, type, from, to, refType, source, page, limit }) 서버 페이지네이션. 조회 후 onTotalChange(total). 모바일 md:hidden 카드.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import Badge from '@/app/components/ui/Badge'
import Button from '@/app/components/ui/Button'
import { Input, Select } from '@/app/components/ui/Input'
import { TBody, TD, TH, THead, TR, Table } from '@/app/components/ui/Table'
import { cn } from '@/lib/cn'
import {
  DEVICE_EVENT_TYPES,
  DEVICE_EVENT_TYPE_COLORS,
  DEVICE_EVENT_TYPE_LABELS,
  REGISTRY_REF_TYPES,
  REGISTRY_REF_TYPE_LABELS,
  REGISTRY_SOURCES,
  REGISTRY_SOURCE_LABELS,
  refLink,
  type DeviceEventType,
  type RegistryRefType,
  type RegistrySource,
} from '@/lib/deviceRegistryShared'
import { errorMessage, getEvents } from './api'
import { Pager, TableMessageRow, defaultGlobalEventFrom, eventContent, fmtDateTimeKst, kstYmd, useDebounced, ymdOrDash } from './groupd-shared'
import type { Capabilities, DeviceEvent, EventFilters } from './types'

export interface EventsTabProps {
  /** null = 전역 최근 이벤트 */
  hospitalCode: string | null
  /** q/page는 URL 동기화, 나머지 로컬 — setFilters로만 변경(page는 patch에 없으면 1로 리셋) */
  filters: EventFilters
  setFilters: (patch: Partial<EventFilters>) => void
  capabilities: Capabilities
  onOpenDevice: (id: number) => void
  onTotalChange?: (total: number) => void
  reloadKey: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 페이지 내 접기(같은 actionGroup 쌍 · 임포트 배치)
// ─────────────────────────────────────────────────────────────────────────────

type GroupKind = 'batch' | 'replace' | 'transfer' | 'bulk'

interface EventGroup {
  key: string
  kind: GroupKind
  /** 대표 행(업무일자·기록자 등은 첫 행 기준) */
  head: DeviceEvent
  events: DeviceEvent[]
  label: string
  /** 교체·이관은 시리얼 old→new / 배치·일괄은 대수 */
  serialText: string
  /** 대표 기기(시리얼 클릭 대상) — 교체는 신 기기 */
  deviceId: number | null
  content: string
  reason: string | null
}

type Item = { type: 'single'; ev: DeviceEvent } | { type: 'group'; group: EventGroup }

function describeGroup(key: string, events: DeviceEvent[], isBatch: boolean): EventGroup {
  const head = events[0]
  const registers = events.filter((e) => e.eventType === 'REGISTER')
  const recovers = events.filter((e) => e.eventType === 'RECOVER')
  const devices = new Set(events.map((e) => e.deviceId))

  if (isBatch) {
    const transferCount = recovers.length
    const batchId = head.importBatch?.id ?? head.importBatchId
    const cancelled = head.importBatch?.cancelledAt ? ' · 취소됨' : ''
    return {
      key,
      kind: 'batch',
      head,
      events,
      label: `등록 ${registers.length.toLocaleString()}대 (배치 #${batchId})${transferCount ? ` · 이관 ${transferCount}` : ''}${cancelled}`,
      serialText: `${devices.size.toLocaleString()}대`,
      deviceId: null,
      content: head.importBatch?.fileName ? `임포트 파일 ${head.importBatch.fileName}` : '임포트',
      reason: null,
    }
  }

  // 교체: 서로 다른 기기의 RECOVER(구) + REGISTER(신) (+ 소급 REGISTER(구) · MOVE_WARD(신))
  if (devices.size === 2 && recovers.length >= 1 && registers.length >= 1) {
    const recover = recovers[0]
    const register = registers.find((r) => r.deviceId !== recover.deviceId) ?? registers[0]
    const oldSerial = recover.device.serialNo
    const newSerial = register.device.serialNo
    const ward = register.toWard?.name ?? '미지정'
    return {
      key,
      kind: 'replace',
      head: register,
      events,
      label: `교체 ${oldSerial}→${newSerial}`,
      serialText: `${oldSerial} → ${newSerial}`,
      deviceId: register.deviceId,
      content: `${oldSerial} 회수(${recover.reasonCode?.name ?? '사유 없음'}) → ${newSerial} 등록 ${ward}`,
      reason: recover.reasonCode?.name ?? null,
    }
  }

  // 이관: 같은 기기의 RECOVER(TRANSFER, 상대 병원) + REGISTER(이 병원)
  if (devices.size === 1 && recovers.length === 1 && registers.length === 1) {
    const recover = recovers[0]
    const register = registers[0]
    const from = recover.hospital?.hospitalName ?? recover.hospitalCode ?? '—'
    const to = register.hospital?.hospitalName ?? register.hospitalCode ?? '—'
    return {
      key,
      kind: 'transfer',
      head: register,
      events,
      label: `이관 ${register.device.serialNo}`,
      serialText: register.device.serialNo,
      deviceId: register.deviceId,
      content: `${from} → ${to} ${register.toWard?.name ?? '미지정'}`,
      reason: recover.reasonCode?.name ?? null,
    }
  }

  // 일괄(같은 유형 n대)
  const types = Array.from(new Set(events.map((e) => e.eventType)))
  const typeLabel = types.length === 1 ? DEVICE_EVENT_TYPE_LABELS[types[0]] : '이벤트'
  const sample = head
  let content = ''
  if (types.length === 1 && types[0] === 'MOVE_WARD') content = `${sample.fromWard?.name ?? '미지정'} → ${sample.toWard?.name ?? '미지정'}`
  else if (types.length === 1 && types[0] === 'RECOVER') content = `${sample.fromWard?.name ?? '미지정'} 회수`
  else content = eventContent(sample)
  return {
    key,
    kind: 'bulk',
    head,
    events,
    label: `${typeLabel} ${devices.size.toLocaleString()}대 (일괄)`,
    serialText: `${devices.size.toLocaleString()}대`,
    deviceId: null,
    content,
    reason: types.length === 1 && types[0] === 'RECOVER' ? sample.reasonCode?.name ?? null : null,
  }
}

/** 페이지 행(최신순)을 순서 보존하며 접는다 — 배치는 importBatchId, 쌍/일괄은 actionGroup(페이지 내 2건 이상일 때만) */
function collapseEvents(rows: DeviceEvent[]): Item[] {
  const groupCount = new Map<string, number>()
  for (const r of rows) {
    if (r.importBatchId != null) groupCount.set(`batch:${r.importBatchId}`, (groupCount.get(`batch:${r.importBatchId}`) ?? 0) + 1)
    else if (r.actionGroup) groupCount.set(`group:${r.actionGroup}`, (groupCount.get(`group:${r.actionGroup}`) ?? 0) + 1)
  }
  const items: Item[] = []
  const buckets = new Map<string, DeviceEvent[]>()
  for (const r of rows) {
    const key = r.importBatchId != null ? `batch:${r.importBatchId}` : r.actionGroup ? `group:${r.actionGroup}` : null
    if (!key || (groupCount.get(key) ?? 0) < 2) {
      items.push({ type: 'single', ev: r })
      continue
    }
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
      // 자리 표시 — 나중에 그룹으로 치환
      items.push({ type: 'group', group: { key, kind: 'bulk', head: r, events: bucket, label: '', serialText: '', deviceId: null, content: '', reason: null } })
    }
    bucket.push(r)
  }
  return items.map((it) => (it.type === 'group' ? { type: 'group', group: describeGroup(it.group.key, it.group.events, it.group.key.startsWith('batch:')) } : it))
}

const GROUP_BADGE: Record<GroupKind, string> = {
  batch: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  replace: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  transfer: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  bulk: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
}

const GROUP_BADGE_LABEL: Record<GroupKind, string> = { batch: '임포트', replace: '교체', transfer: '이관', bulk: '일괄' }

// ─────────────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────


export function EventsTab({ hospitalCode, filters, setFilters, onOpenDevice, onTotalChange, reloadKey }: EventsTabProps) {
  const isGlobal = hospitalCode == null
  const [rows, setRows] = useState<DeviceEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  // 전역 최근 이벤트의 기본 기간(30일)은 orchestrator(DevicesClient)의 eventLocal 기본값이 담당 — 여기서는 '초기화'가 그 기본값으로 되돌린다
  const defaultFrom = isGlobal ? defaultGlobalEventFrom() : null

  // 시리얼 검색 — 로컬 입력 + 디바운스 후 URL q
  const [qInput, setQInput] = useState(filters.q)
  useEffect(() => setQInput(filters.q), [filters.q])
  const pushQ = useDebounced((q: string) => {
    if (q !== filters.q) setFilters({ q })
  }, 400)

  const onTotalRef = useRef(onTotalChange)
  onTotalRef.current = onTotalChange

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    getEvents({
      hospital: hospitalCode,
      q: filters.q || null,
      type: filters.type,
      from: filters.from,
      to: filters.to,
      refType: filters.refType,
      source: filters.source,
      page: filters.page,
      limit: filters.limit,
    })
      .then((r) => {
        if (!alive) return
        setRows(r.data)
        setTotal(r.total)
        setExpanded(new Set())
        onTotalRef.current?.(r.total)
      })
      .catch((e) => {
        if (!alive) return
        setRows([])
        setTotal(0)
        setError(errorMessage(e, '이력을 불러오지 못했습니다.'))
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [hospitalCode, filters.q, filters.type, filters.from, filters.to, filters.refType, filters.source, filters.page, filters.limit, reloadKey])

  const items = useMemo(() => collapseEvents(rows), [rows])
  const hasFilter = !!(filters.q || filters.type || (filters.from && filters.from !== defaultFrom) || filters.to || filters.refType || filters.source)
  const colCount = isGlobal ? 10 : 9

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="space-y-3">
      {/* 필터 */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          기간
          <span className="flex items-center gap-1">
            <Input type="date" className="h-8 w-[9.5rem] text-xs" value={filters.from ?? ''} max={filters.to ?? undefined} onChange={(e) => setFilters({ from: e.target.value || null })} aria-label="시작일" />
            <span>~</span>
            <Input type="date" className="h-8 w-[9.5rem] text-xs" value={filters.to ?? ''} min={filters.from ?? undefined} onChange={(e) => setFilters({ to: e.target.value || null })} aria-label="종료일" />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          유형
          <Select className="h-8 w-32 text-xs" value={filters.type ?? ''} onChange={(e) => setFilters({ type: (e.target.value || null) as DeviceEventType | null })}>
            <option value="">전체</option>
            {DEVICE_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DEVICE_EVENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          시리얼
          <Input
            className="h-8 w-40 font-mono text-xs uppercase"
            placeholder="A126861"
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value)
              pushQ(e.target.value.trim())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setFilters({ q: qInput.trim() })
            }}
            aria-label="시리얼 검색"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          연결 유형
          <Select className="h-8 w-32 text-xs" value={filters.refType ?? ''} onChange={(e) => setFilters({ refType: (e.target.value || null) as RegistryRefType | null })}>
            <option value="">전체</option>
            {REGISTRY_REF_TYPES.map((t) => (
              <option key={t} value={t}>
                {REGISTRY_REF_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          출처
          <Select className="h-8 w-28 text-xs" value={filters.source ?? ''} onChange={(e) => setFilters({ source: (e.target.value || null) as RegistrySource | null })}>
            <option value="">전체</option>
            {REGISTRY_SOURCES.map((s) => (
              <option key={s} value={s}>
                {REGISTRY_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
        {hasFilter && (
          <Button size="sm" variant="ghost" onClick={() => setFilters({ q: '', type: null, from: defaultFrom, to: null, refType: null, source: null })}>
            초기화
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isGlobal && filters.from && !filters.to && <span className="text-[11px] text-muted-foreground">{filters.from} 이후 · Excel은 헤더 [Excel]</span>}
        </div>
      </div>

      {/* 데스크톱 표 */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <THead>
            <tr>
              <TH className="w-28">업무일자</TH>
              <TH className="w-24">유형</TH>
              {isGlobal && <TH>병원</TH>}
              <TH>시리얼</TH>
              <TH>모델</TH>
              <TH>내용</TH>
              <TH>사유</TH>
              <TH>연결</TH>
              <TH>기록자</TH>
              <TH>메모</TH>
            </tr>
          </THead>
          <TBody>
            {error ? (
              <TableMessageRow colSpan={colCount} tone="error">
                {error}
              </TableMessageRow>
            ) : loading && rows.length === 0 ? (
              <TableMessageRow colSpan={colCount}>불러오는 중…</TableMessageRow>
            ) : rows.length === 0 ? (
              <TableMessageRow colSpan={colCount}>{hasFilter ? '조건에 맞는 이벤트가 없습니다.' : isGlobal ? '최근 이벤트가 없습니다.' : '기록된 이벤트가 없습니다. 등록·이동·회수·교체를 기록하면 여기에 쌓입니다.'}</TableMessageRow>
            ) : (
              items.map((it) =>
                it.type === 'single' ? (
                  <EventRow key={`e${it.ev.id}`} ev={it.ev} isGlobal={isGlobal} onOpenDevice={onOpenDevice} />
                ) : (
                  <Fragment key={it.group.key}>
                    <GroupRow group={it.group} isGlobal={isGlobal} open={expanded.has(it.group.key)} onToggle={() => toggle(it.group.key)} onOpenDevice={onOpenDevice} />
                    {expanded.has(it.group.key) && it.group.events.map((ev) => <EventRow key={`e${ev.id}`} ev={ev} isGlobal={isGlobal} onOpenDevice={onOpenDevice} nested />)}
                  </Fragment>
                )
              )
            )}
          </TBody>
        </Table>
      </div>

      {/* 모바일 카드 */}
      <div className="space-y-2 md:hidden">
        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive-subtle p-4 text-sm text-destructive-subtle-foreground">{error}</div>
        ) : loading && rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">{hasFilter ? '조건에 맞는 이벤트가 없습니다.' : '기록된 이벤트가 없습니다.'}</div>
        ) : (
          items.map((it) =>
            it.type === 'single' ? (
              <EventCard key={`c${it.ev.id}`} ev={it.ev} isGlobal={isGlobal} onOpenDevice={onOpenDevice} />
            ) : (
              <div key={it.group.key} className="rounded-lg border border-border bg-card">
                <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => toggle(it.group.key)}>
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge className={GROUP_BADGE[it.group.kind]}>{GROUP_BADGE_LABEL[it.group.kind]}</Badge>
                    <span className="truncate text-sm font-medium text-foreground">{it.group.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {ymdOrDash(it.group.head.occurredOn)}
                    {expanded.has(it.group.key) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
                {expanded.has(it.group.key) && (
                  <div className="space-y-2 border-t border-border p-2">
                    {it.group.events.map((ev) => (
                      <EventCard key={`c${ev.id}`} ev={ev} isGlobal={isGlobal} onOpenDevice={onOpenDevice} />
                    ))}
                  </div>
                )}
              </div>
            )
          )
        )}
      </div>

      <Pager page={filters.page} total={total} limit={filters.limit} onPage={(p) => setFilters({ page: p })} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 행 · 카드
// ─────────────────────────────────────────────────────────────────────────────

function OccurredCell({ ev }: { ev: DeviceEvent }) {
  const occurred = ymdOrDash(ev.occurredOn)
  const recorded = kstYmd(ev.createdAt)
  const differs = recorded != null && recorded !== occurred
  return (
    <div className="whitespace-nowrap">
      <div className="tabular-nums">{occurred}</div>
      {differs && (
        <div className="text-[11px] text-muted-foreground" title="기록 시각(업무일자와 다름)">
          기록 {fmtDateTimeKst(ev.createdAt)}
        </div>
      )}
      {ev.editedAt && (
        <div className="text-[11px] text-muted-foreground" title={`정정 ${fmtDateTimeKst(ev.editedAt)}`}>
          정정됨
        </div>
      )}
    </div>
  )
}

function RefCell({ ev }: { ev: DeviceEvent }) {
  if (!ev.refType || !ev.refCode) return <span className="text-muted-foreground">—</span>
  const href = refLink(ev.refType, ev.refCode)
  const label = `${REGISTRY_REF_TYPE_LABELS[ev.refType] ?? ev.refType} ${ev.refCode}`
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs text-primary hover:underline">
      {ev.refCode}
      <ExternalLink size={12} />
    </a>
  ) : (
    <span className="whitespace-nowrap font-mono text-xs" title={label}>
      {ev.refCode}
    </span>
  )
}

function SerialButton({ ev, onOpenDevice }: { ev: DeviceEvent; onOpenDevice: (id: number) => void }) {
  return (
    <button type="button" onClick={() => onOpenDevice(ev.device.id)} className="font-mono text-sm text-primary hover:underline" title="이력 드로어 열기">
      {ev.device.serialNo}
      {ev.device.serialRaw && ev.device.serialRaw !== ev.device.serialNo && <span className="ml-1 text-[11px] text-muted-foreground">({ev.device.serialRaw})</span>}
    </button>
  )
}

function EventRow({ ev, isGlobal, onOpenDevice, nested }: { ev: DeviceEvent; isGlobal: boolean; onOpenDevice: (id: number) => void; nested?: boolean }) {
  return (
    <TR className={cn(nested && 'bg-muted/30')}>
      <TD className={cn('align-top text-xs', nested && 'pl-8')}>
        <OccurredCell ev={ev} />
      </TD>
      <TD className="align-top">
        <Badge className={DEVICE_EVENT_TYPE_COLORS[ev.eventType]}>{DEVICE_EVENT_TYPE_LABELS[ev.eventType]}</Badge>
      </TD>
      {isGlobal && <TD className="whitespace-nowrap align-top text-xs">{ev.hospital?.hospitalName ?? ev.hospitalCode ?? '—'}</TD>}
      <TD className="whitespace-nowrap align-top">
        <SerialButton ev={ev} onOpenDevice={onOpenDevice} />
      </TD>
      <TD className="whitespace-nowrap align-top text-xs">
        <div>{ev.device.deviceInfo.deviceModel}</div>
        <div className="text-[11px] text-muted-foreground">{ev.device.deviceInfo.deviceName}</div>
      </TD>
      <TD className="align-top text-xs">{eventContent(ev)}</TD>
      <TD className="whitespace-nowrap align-top text-xs">{ev.reasonCode?.name ?? <span className="text-muted-foreground">—</span>}</TD>
      <TD className="align-top">
        <RefCell ev={ev} />
      </TD>
      <TD className="whitespace-nowrap align-top text-xs">{ev.actorName ?? <span className="text-muted-foreground">—</span>}</TD>
      <TD className="max-w-[16rem] align-top text-xs">
        {ev.memo ? (
          <span className="line-clamp-2" title={ev.memo}>
            {ev.memo}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TD>
    </TR>
  )
}

function GroupRow({ group, isGlobal, open, onToggle, onOpenDevice }: { group: EventGroup; isGlobal: boolean; open: boolean; onToggle: () => void; onOpenDevice: (id: number) => void }) {
  const head = group.head
  const memo = head.memo ?? group.events.find((e) => e.memo)?.memo ?? null
  const ref = group.events.find((e) => e.refType && e.refCode) ?? head
  return (
    <TR className="bg-muted/20">
      <TD className="align-top text-xs">
        <OccurredCell ev={head} />
      </TD>
      <TD className="align-top">
        <button type="button" onClick={onToggle} className="inline-flex items-center gap-1" aria-expanded={open} title={open ? '접기' : '펼치기'}>
          <Badge className={GROUP_BADGE[group.kind]}>{GROUP_BADGE_LABEL[group.kind]}</Badge>
          {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        </button>
      </TD>
      {isGlobal && <TD className="whitespace-nowrap align-top text-xs">{head.hospital?.hospitalName ?? head.hospitalCode ?? '—'}</TD>}
      <TD className="align-top">
        {group.deviceId != null ? (
          <button type="button" onClick={() => onOpenDevice(group.deviceId!)} className="whitespace-nowrap font-mono text-sm text-primary hover:underline" title="이력 드로어 열기(신 기기)">
            {group.serialText}
          </button>
        ) : (
          <button type="button" onClick={onToggle} className="whitespace-nowrap text-sm font-medium text-foreground hover:underline">
            {group.label} {open ? '▾' : '▸'}
          </button>
        )}
      </TD>
      <TD className="whitespace-nowrap align-top text-xs">{group.kind === 'replace' || group.kind === 'transfer' ? head.device.deviceInfo.deviceModel : <span className="text-muted-foreground">—</span>}</TD>
      <TD className="align-top text-xs">
        {group.kind === 'replace' || group.kind === 'transfer' ? (
          <>
            <span className="font-medium">{group.label}</span>
            <span className="text-muted-foreground"> · {group.content}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{group.content}</span>
        )}
      </TD>
      <TD className="whitespace-nowrap align-top text-xs">{group.reason ?? <span className="text-muted-foreground">—</span>}</TD>
      <TD className="align-top">
        <RefCell ev={ref} />
      </TD>
      <TD className="whitespace-nowrap align-top text-xs">{head.actorName ?? <span className="text-muted-foreground">—</span>}</TD>
      <TD className="max-w-[16rem] align-top text-xs">{memo ? <span className="line-clamp-2">{memo}</span> : <span className="text-muted-foreground">—</span>}</TD>
    </TR>
  )
}

function EventCard({ ev, isGlobal, onOpenDevice }: { ev: DeviceEvent; isGlobal: boolean; onOpenDevice: (id: number) => void }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <SerialButton ev={ev} onOpenDevice={onOpenDevice} />
          <div className="text-xs text-muted-foreground">
            {ev.device.deviceInfo.deviceModel}
            {isGlobal && ` · ${ev.hospital?.hospitalName ?? ev.hospitalCode ?? '—'}`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Badge className={DEVICE_EVENT_TYPE_COLORS[ev.eventType]}>{DEVICE_EVENT_TYPE_LABELS[ev.eventType]}</Badge>
          <div className="mt-1 text-xs tabular-nums text-muted-foreground">{ymdOrDash(ev.occurredOn)}</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-foreground">{eventContent(ev)}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {ev.reasonCode && <span>사유 {ev.reasonCode.name}</span>}
        {ev.refCode && (
          <span>
            연결 <RefCell ev={ev} />
          </span>
        )}
        {ev.actorName && <span>{ev.actorName}</span>}
        {ev.editedAt && <span>정정됨</span>}
      </div>
      {ev.memo && <div className="mt-1 text-xs text-muted-foreground">{ev.memo}</div>}
    </div>
  )
}

export default EventsTab
