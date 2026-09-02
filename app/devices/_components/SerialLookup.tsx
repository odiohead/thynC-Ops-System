'use client'

/**
 * 헤더 '시리얼 조회' (§6.1) — GROUP A
 * 입력 ↵ → `lookupSerial(input)` (서버가 normalizeSerial 적용: 키 또는 원문 정확 일치).
 *  - device ACTIVE  → onNavigate({ hospitalCode: device.hospitalCode, deviceId, status:'ACTIVE' }) (orchestrator가 병원 전환 + 드로어)
 *  - device RECOVERED → onNavigate({ hospitalCode: device.lastHospitalCode, deviceId, status:'RECOVERED' }) (orchestrator가 상태 필터 '회수됨' + 드로어)
 *  - 0건 → 드롭다운: "원장에 없음" + 원장 접두 일치 ≤10(병원·상태 표시, 클릭 → onNavigate) + WMS 개체 ≤10(읽기 표시)
 * 스캐너 친화: autoFocus 옵션·자동 대문자·Enter 제출·이동 후 입력 전체 선택(다음 스캔이 덮어씀).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import Badge from '@/app/components/ui/Badge'
import { Input } from '@/app/components/ui/Input'
import { cn } from '@/lib/cn'
import { DEVICE_STATUS_LABELS, normalizeSerial } from '@/lib/deviceRegistryShared'
import { errorMessage, lookupSerial } from './api'
import { useDevicesToast } from './toast'
import type { DeviceRowBase, LookupNavigateTarget, LookupResponse } from './types'

export interface SerialLookupProps {
  onNavigate: (target: LookupNavigateTarget) => void
  autoFocus?: boolean
  className?: string
}

/** 개체 → 이동 대상 (ACTIVE는 현재 병원, RECOVERED는 마지막 병원 — 없으면 드로어만) */
function toTarget(d: DeviceRowBase): LookupNavigateTarget {
  return {
    hospitalCode: d.status === 'RECOVERED' ? d.lastHospitalCode : d.hospitalCode,
    deviceId: d.id,
    status: d.status,
  }
}

/** 후보 행의 위치 문구 — ACTIVE '세란병원 · 6병동' / RECOVERED '(이전) ○○병원' */
function whereText(d: DeviceRowBase): string {
  if (d.status === 'ACTIVE') {
    const name = d.hospital?.hospitalName ?? d.hospitalCode ?? '병원 미상'
    return d.ward ? `${name} · ${d.ward.name}` : `${name} · 미지정`
  }
  const last = d.lastHospital?.hospitalName ?? d.lastHospitalCode
  return last ? `(이전) ${last}` : '이전 병원 없음'
}

export function SerialLookup({ onNavigate, autoFocus, className }: SerialLookupProps) {
  const notify = useDevicesToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  /** 0건 결과 — 드롭다운 표시 */
  const [miss, setMiss] = useState<LookupResponse | null>(null)
  /** 모바일(<sm)에서는 fixed 팝오버 — 입력창 하단 viewport 좌표 */
  const [popTop, setPopTop] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 바깥 클릭 → 드롭다운 닫기
  useEffect(() => {
    if (!miss) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMiss(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [miss])

  const navigate = useCallback(
    (d: DeviceRowBase) => {
      setMiss(null)
      onNavigate(toTarget(d))
      // 다음 스캔이 덮어쓰도록 전체 선택
      requestAnimationFrame(() => inputRef.current?.select())
    },
    [onNavigate]
  )

  const submit = useCallback(async () => {
    const raw = value.trim()
    if (!raw || busy) return
    if (!normalizeSerial(raw).serialNo) {
      notify('시리얼을 입력하세요', 'error')
      return
    }
    setBusy(true)
    setMiss(null)
    try {
      const r = await lookupSerial(raw)
      if (r.device) navigate(r.device)
      else {
        setPopTop((inputRef.current?.getBoundingClientRect().bottom ?? 0) + 4)
        setMiss(r)
      }
    } catch (e) {
      notify(errorMessage(e, '시리얼 조회에 실패했습니다.'), 'error')
    } finally {
      setBusy(false)
    }
  }, [value, busy, notify, navigate])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      if (miss) {
        e.stopPropagation()
        setMiss(null)
      }
    }
  }

  const missInput = miss?.input
  const candidates = miss?.candidates ?? []
  const wms = miss?.wmsCandidates ?? []

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <form onSubmit={onSubmit} className="flex items-center gap-2 text-sm text-muted-foreground" role="search" aria-label="시리얼 조회">
        <label htmlFor="devices-serial-lookup" className="hidden whitespace-nowrap sm:inline">
          시리얼 조회
        </label>
        <div className="relative">
          <Input
            id="devices-serial-lookup"
            ref={inputRef}
            className={cn('h-9 w-36 font-mono uppercase sm:w-40', busy && 'pr-7')}
            placeholder="A126861"
            value={value}
            autoFocus={autoFocus}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
            aria-busy={busy || undefined}
            aria-expanded={!!miss}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase())
              if (miss) setMiss(null)
            }}
            onKeyDown={onKeyDown}
          />
          {busy && (
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground" aria-hidden>
              …
            </span>
          )}
        </div>
        <button type="submit" className="sr-only">
          조회
        </button>
      </form>

      {miss && (
        <div
          className="fixed inset-x-3 top-[var(--pop-top)] z-50 overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1 sm:w-[22rem]"
          style={{ '--pop-top': `${popTop}px` } as CSSProperties}
          role="dialog"
          aria-label="시리얼 조회 결과"
        >
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-foreground">미등록 시리얼</span>
              <span className="font-mono text-xs text-muted-foreground">{missInput?.serialNo}</span>
              {missInput?.serialRaw && missInput.serialRaw !== missInput.serialNo && (
                <span className="truncate font-mono text-[11px] text-muted-foreground/80" title="원문(정규화 전)">
                  ← {missInput.serialRaw}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">이 시리얼로 등록된 기기가 없습니다 — 병원을 선택해 등록·임포트하거나 아래 후보를 확인하세요.</div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {/* 원장 접두 일치 */}
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
              원장 접두 일치 <span className="tabular-nums">({candidates.length})</span>
            </div>
            {candidates.length === 0 ? (
              <div className="px-3 pb-2 text-xs text-muted-foreground/80">일치하는 후보 없음</div>
            ) : (
              <ul className="pb-1">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/50"
                      onClick={() => navigate(c)}
                      title="이 기기로 이동"
                    >
                      <span className="shrink-0 font-mono text-foreground">{c.serialNo}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {c.deviceInfo?.deviceModel ?? '모델 미상'} · {whereText(c)}
                      </span>
                      <Badge variant={c.status === 'ACTIVE' ? 'success' : 'default'} className="shrink-0">
                        {DEVICE_STATUS_LABELS[c.status]}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* WMS 개체(읽기) */}
            <div className="border-t border-border px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
              WMS 개체 <span className="tabular-nums">({wms.length})</span>
              <span className="ml-1 font-normal text-muted-foreground/80">— 창고 재고 개체, 참고용</span>
            </div>
            {wms.length === 0 ? (
              <div className="px-3 pb-2 text-xs text-muted-foreground/80">일치하는 창고 개체 없음</div>
            ) : (
              <ul className="pb-2">
                {wms.map((u) => (
                  <li key={u.unitId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="shrink-0 font-mono text-foreground">{u.serialNo}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {u.inventoryName} · {u.modelName ?? u.itemCode}
                      {u.linkedDeviceId != null && <span className="ml-1 text-muted-foreground/80">· 원장 #{u.linkedDeviceId} 연결</span>}
                    </span>
                    <Badge variant={u.status === 'IN_STOCK' ? 'warning' : 'outline'} className="shrink-0">
                      {u.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SerialLookup
