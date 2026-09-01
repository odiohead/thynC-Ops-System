'use client'

/**
 * GROUP C 공용 폼 조각 (§6.1-B 폼 공통) — 등록·병동 이동·회수·교체 모달이 함께 쓴다.
 *
 * - FormField / Notice / ModalActions : 레이아웃·안내 문구(시맨틱 토큰만)
 * - useOccurredOn + OccurredOnField   : 업무일자(기본 오늘·과거 허용·미래 차단). 유지보수 코드 선택 시 제안값을 채우되 사용자가 고친 값은 유지(D7)
 * - TargetPicker                      : 대상 칩 + 시리얼 입력줄(↵/스캔마다 lookupSerial → 이 병원 ACTIVE면 칩 추가, 아니면 인라인 오류)
 * - isSubmitShortcut                  : ⌘/Ctrl+Enter 제출
 * - describeWard / ratioLabel 등 소형 표시 헬퍼
 *
 * 서버 전용 모듈(lib/deviceRegistry·lib/wiki) import 금지 — 클라이언트 안전 상수는 lib/deviceRegistryShared 만.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import Badge from '@/app/components/ui/Badge'
import { Input } from '@/app/components/ui/Input'
import { DEVICE_STATUS_LABELS, OCCURRED_ON_BASIS_LABELS, isFutureYmd, normalizeSerial, toYmd, type OccurredOnBasis } from '@/lib/deviceRegistryShared'
import { errorMessage, lookupSerial } from './api'
import { toDeviceRef, type DeviceRef, type WardOption, type WardValue } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// 레이아웃
// ─────────────────────────────────────────────────────────────────────────────

export function FormField({
  label,
  htmlFor,
  hint,
  required,
  right,
  children,
  className,
}: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  required?: boolean
  /** 라벨 우측 보조(배지 등) */
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </label>
        {right}
      </div>
      {children}
      {hint && <div className="text-[11px] leading-snug text-muted-foreground">{hint}</div>}
    </div>
  )
}

export type NoticeTone = 'info' | 'warning' | 'error' | 'success'

const NOTICE_CLASS: Record<NoticeTone, string> = {
  info: 'border-border bg-muted/60 text-foreground',
  warning: 'border-warning/40 bg-warning-subtle text-warning-subtle-foreground',
  error: 'border-destructive/40 bg-destructive-subtle text-destructive-subtle-foreground',
  success: 'border-success/40 bg-success-subtle text-success-subtle-foreground',
}

export function Notice({ tone = 'info', children, className, role }: { tone?: NoticeTone; children: ReactNode; className?: string; role?: string }) {
  return (
    <div role={role ?? (tone === 'error' ? 'alert' : undefined)} className={cn('rounded-md border px-3 py-2 text-xs leading-relaxed', NOTICE_CLASS[tone], className)}>
      {children}
    </div>
  )
}

/** 모달 하단 버튼 줄 — 좌측 보조 문구 + 우측 버튼들 */
export function ModalActions({ left, children, className }: { left?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="text-[11px] text-muted-foreground">{left ?? <span className="hidden sm:inline">⌘/Ctrl+Enter 제출</span>}</div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">{children}</div>
    </div>
  )
}

/** ⌘/Ctrl+Enter — 폼 컨테이너 onKeyDown에서 사용 */
export function isSubmitShortcut(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
}

// ─────────────────────────────────────────────────────────────────────────────
// 업무일자 (D7 — 기본 오늘·과거 허용·미래 400, 유지보수 제안은 사용자가 고치기 전까지만)
// ─────────────────────────────────────────────────────────────────────────────

export interface OccurredOnState {
  value: string
  /** 사용자가 직접 고쳤는지 — true면 유지보수 제안을 덮어쓰지 않는다 */
  dirty: boolean
  /** 현재 값이 유지보수 제안에서 왔으면 그 근거 */
  basis: OccurredOnBasis | null
  error: string | null
  setByUser: (v: string) => void
  /** 제안 적용 — dirty면 무시(false). date null이면 근거만 지운다 */
  suggest: (date: string | null, basis: OccurredOnBasis | null) => boolean
}

export function useOccurredOn(today: string): OccurredOnState {
  const [value, setValue] = useState(today)
  const [dirty, setDirty] = useState(false)
  const [basis, setBasis] = useState<OccurredOnBasis | null>(null)

  const setByUser = useCallback((v: string) => {
    setValue(v)
    setDirty(true)
    setBasis(null)
  }, [])

  const suggest = useCallback(
    (date: string | null, b: OccurredOnBasis | null) => {
      if (!date) {
        setBasis(null)
        return false
      }
      if (dirty) return false
      setValue(date)
      setBasis(b)
      return true
    },
    [dirty]
  )

  const error = !value ? '업무일자를 입력하세요' : isFutureYmd(value, today) ? '미래 일자는 기록할 수 없습니다' : null
  return { value, dirty, basis, error, setByUser, suggest }
}

export function OccurredOnField({ id, state, today, disabled, label = '업무일자', className }: { id: string; state: OccurredOnState; today: string; disabled?: boolean; label?: string; className?: string }) {
  const basisText = state.basis ? `유지보수 ${OCCURRED_ON_BASIS_LABELS[state.basis]} 기준으로 제안된 일자입니다` : null
  return (
    <FormField
      label={label}
      htmlFor={id}
      required
      className={className}
      right={
        state.basis ? (
          <span className="text-[11px] text-muted-foreground" title={basisText ?? undefined}>
            제안: {OCCURRED_ON_BASIS_LABELS[state.basis]}
          </span>
        ) : undefined
      }
      hint={state.error ? <span className="text-destructive">{state.error}</span> : state.value !== today ? '과거 일자 허용 (실제 업무가 있었던 날)' : '기본 오늘 · 과거 허용'}
    >
      <Input id={id} type="date" value={state.value} max={today} disabled={disabled} onChange={(e) => state.setByUser(e.target.value)} className={cn(state.error && 'border-destructive')} />
    </FormField>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 대상 지정 — 칩 + 시리얼 입력줄 (스캐너 친화: autoFocus·자동 대문자·↵ 추가·중복 병합)
// ─────────────────────────────────────────────────────────────────────────────

export type TargetMap = Map<number, DeviceRef | null>

export function targetsFrom(devices: DeviceRef[], ids?: number[] | null): TargetMap {
  const m: TargetMap = new Map()
  for (const d of devices) m.set(d.id, d)
  for (const id of ids ?? []) if (!m.has(id)) m.set(id, null)
  return m
}

export function targetRefs(targets: TargetMap): DeviceRef[] {
  return Array.from(targets.values()).filter((v): v is DeviceRef => v != null)
}

/** 현재 병동 요약 — '252병동 12 · 미지정 3' (행 정보 없는 대상은 제외) */
export function wardSummaryOf(refs: DeviceRef[]): string {
  const counts = new Map<string, number>()
  for (const r of refs) {
    const k = r.wardName ?? '미지정'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')
}

export interface TargetPickerProps {
  hospitalCode: string
  targets: TargetMap
  onChange: (next: TargetMap) => void
  /** 스캔 모드 — 입력줄 autoFocus */
  autoFocus?: boolean
  disabled?: boolean
  /** 안내문(예: '252병동 배치 중 전체 38대') */
  note?: string | null
  /** 대상 0건일 때 입력줄 아래 문구 */
  emptyHint?: string
  inputId?: string
}

export function TargetPicker({ hospitalCode, targets, onChange, autoFocus, disabled, note, emptyHint, inputId }: TargetPickerProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: NoticeTone; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const refs = targetRefs(targets)
  const blindCount = targets.size - refs.length

  const remove = (id: number) => {
    const next = new Map(targets)
    next.delete(id)
    onChange(next)
  }

  const addSerials = async () => {
    const tokens = Array.from(new Set(text.split(/[\s,;　]+/).map((t) => normalizeSerial(t).serialNo).filter(Boolean)))
    if (tokens.length === 0) return
    setBusy(true)
    setMsg(null)
    const next = new Map(targets)
    const added: string[] = []
    const problems: string[] = []
    try {
      for (const serial of tokens) {
        try {
          const r = await lookupSerial(serial)
          const d = r.device
          if (!d) {
            problems.push(`${serial}: 원장에 없는 시리얼입니다`)
            continue
          }
          if (d.status !== 'ACTIVE') {
            const last = d.lastHospital?.hospitalName ?? d.lastHospitalCode ?? ''
            problems.push(`${d.serialNo}: ${DEVICE_STATUS_LABELS[d.status]} 기기입니다${last ? ` (마지막 병원 ${last}${d.recoveredOn ? `, ${toYmd(d.recoveredOn)}` : ''})` : ''}`)
            continue
          }
          if (d.hospitalCode !== hospitalCode) {
            problems.push(`${d.serialNo}: 다른 병원(${d.hospital?.hospitalName ?? d.hospitalCode})에 배치 중인 기기입니다`)
            continue
          }
          if (next.has(d.id) && next.get(d.id)) {
            problems.push(`${d.serialNo}: 이미 대상에 있습니다`)
            continue
          }
          next.set(d.id, toDeviceRef(d))
          added.push(d.serialNo)
        } catch (e) {
          problems.push(`${serial}: ${errorMessage(e, '조회 실패')}`)
        }
      }
      if (added.length > 0) onChange(next)
      if (problems.length > 0) setMsg({ tone: added.length > 0 ? 'warning' : 'error', text: problems.join(' · ') })
      else if (added.length > 0) setMsg({ tone: 'success', text: `${added.join(', ')} 추가` })
      setText('')
    } finally {
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  return (
    <div className="space-y-2">
      {(refs.length > 0 || blindCount > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {refs.map((r) => (
            <span key={r.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/60 py-0.5 pl-2.5 pr-1 text-xs text-foreground">
              <span className="font-mono">{r.serialNo}</span>
              {r.wardName ? <span className="text-muted-foreground">· {r.wardName}</span> : <span className="text-muted-foreground">· 미지정</span>}
              {!disabled && (
                <button type="button" aria-label={`${r.serialNo} 제거`} onClick={() => remove(r.id)} className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {blindCount > 0 && (
            <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground" title="검색 결과 전체 선택으로 들어온 기기(행 정보 없음)">
              외 {blindCount.toLocaleString()}대 (전체 선택)
            </span>
          )}
        </div>
      )}
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          id={inputId}
          value={text}
          disabled={disabled || busy}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="시리얼 입력 또는 스캔 후 ↵ (여러 개는 공백·쉼표 구분)"
          className="font-mono uppercase"
          onChange={(e) => {
            setText(e.target.value)
            if (msg) setMsg(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault()
              void addSerials()
            }
          }}
          aria-label="대상 시리얼 추가"
        />
        <button
          type="button"
          disabled={disabled || busy || !text.trim()}
          onClick={() => void addSerials()}
          className="h-9 shrink-0 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {busy ? '조회 중…' : '추가'}
        </button>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!msg && targets.size === 0 && emptyHint && <div className="text-[11px] text-muted-foreground">{emptyHint}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 표시 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** WardValue → 표시명 ('101병동' / '62병동 (신규)' / '미지정') */
export function describeWard(v: WardValue | null | undefined, wards: readonly WardOption[]): string {
  if (!v) return '미지정'
  if (v.wardId != null) return wards.find((w) => w.id === v.wardId)?.name ?? `#${v.wardId}`
  if (v.wardName) return `${v.wardName} (신규)`
  return '미지정'
}

/** ward id → 이름(옵션 밖이면 대체 문자열) */
export function wardNameById(id: number | null | undefined, wards: readonly WardOption[], fallback = '미지정'): string {
  if (id == null) return fallback
  return wards.find((w) => w.id === id)?.name ?? `#${id}`
}

/** WardValue → API body 조각 */
export function wardBody(v: WardValue): { wardId?: number; wardName?: string } {
  if (v.wardId != null) return { wardId: v.wardId }
  if (v.wardName && v.wardName.trim()) return { wardName: v.wardName.trim() }
  return {}
}

export function StatusBadge({ status }: { status: DeviceRef['status'] }) {
  return <Badge variant={status === 'ACTIVE' ? 'success' : 'default'}>{DEVICE_STATUS_LABELS[status]}</Badge>
}
