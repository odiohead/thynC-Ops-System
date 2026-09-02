'use client'

/**
 * 이력 드로어 (§6.1-B, 우측 슬라이드 / 모바일 바텀시트) — GROUP B
 * getUnitDetail(deviceId) → 헤더 'A126861 · 심전계 MC200M-T · 배치 중 @ 병원 병동 (배치일) · 창고 개체: …'
 *  - 헤더 용도 배지(판매용/평가용/미지정) — USER+는 인라인 select로 변경(patchDevice({usageTypeId}) → CORRECT 이벤트)
 *  - 헤더 상품유형 배지(일반/라이트/미지정, 배치 속성 B-22) — USER+ 인라인 변경(patchDevice({productType}) → CORRECT). 이벤트 행은 스냅샷이 현재 값과 다를 때만 '(당시 라이트)' 병기
 *  - '온프렘 스냅샷 ▸'(macAddress·extDeviceCode·ext_* 값 있을 때만) · 메모 인라인 저장(USER+, patchDevice({memo}))
 *  - 버튼 [병동 이동] [회수] [교체](canWrite, ACTIVE) → onAction · 관리 ▾(canAdmin): 이벤트 정정(patchEvent, §8.2 허용 필드) · 마지막 이벤트 취소(cancelEvent) · 모델/시리얼 정정(onAction('correct'))
 *  - 이벤트 목록 최신순(서버 순서 그대로): 업무일자 · 타입 배지 · 요약(병동 from→to / 사유 / 교체·이관 상대 링크 → 그 기기 드로어) · 연결(refLink) · 기록자 · 기록 시각(업무일자와 다르면 회색 병기)
 *  - 병원이 바뀌는 지점에 '─ 이전 병원 ─' 구분선. 임포트 REGISTER는 '(임포트 #12)' + '(배치 취소로만)'
 * 관리 액션 성공 후 onMutated(). deviceId null이면 렌더하지 않음. ESC/배경 클릭 → onClose.
 * 상대 기기 링크: onOpenDevice(옵션)가 없으면 URL ?device= 를 직접 교체(orchestrator의 setDevice와 같은 형식).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import Badge from '@/app/components/ui/Badge'
import Button from '@/app/components/ui/Button'
import { Input, Select } from '@/app/components/ui/Input'
import { useOverlayDismiss } from '@/app/components/useOverlayDismiss'
import { cn } from '@/lib/cn'
import {
  DEVICE_EVENT_TYPE_LABELS,
  DEVICE_STATE_EVENT_TYPES,
  DEVICE_STATUS_LABELS,
  REGISTRY_REF_TYPES,
  REGISTRY_REF_TYPE_LABELS,
  PRODUCT_TYPES,
  PRODUCT_TYPE_UNSET_LABEL,
  REGISTRY_SOURCE_LABELS,
  isFutureYmd,
  isYmd,
  placementStatusLabel,
  refLink,
  toYmd,
  todayKst,
  type DeviceEventType,
  type ProductType,
  type RegistryRefType,
} from '@/lib/deviceRegistryShared'
import { cancelEvent, errorMessage, getHospitalSummary, getRecoveryReasons, getUnitDetail, getUsageTypes, getWards, patchDevice, patchEvent } from './api'
import { useDevicesToast } from './toast'
import { RegistryFloatingPanel, RegistryMenuItem } from './RegistryFloatingPanel'
import { changeSummaryLines, fmtKstDateTime, kstYmd, modelLabel, productTypeBadgeVariant, usageBadgeVariant, wmsCell, ymdOrDash } from './deviceDisplay'
import { toDeviceRef, type Capabilities, type DeviceAction, type DeviceDetail, type DeviceDetailEvent, type DeviceRef, type EventPatchBody, type RecoveryReason, type SummaryDealRow, type UsageType, type Ward } from './types'

export interface DeviceHistoryDrawerProps {
  /** URL ?device= — null이면 닫힘 */
  deviceId: number | null
  onClose: () => void
  capabilities: Capabilities
  /** 정정·취소·메모 저장 후 */
  onMutated: () => void
  /** [병동 이동] [회수] [교체] · 관리 ▾ 식별 정정 */
  onAction: (action: DeviceAction, device: DeviceRef) => void
  /** 값이 바뀌면 상세 재조회 */
  reloadKey: number
  /** 교체·이관 상대 기기 링크 → 그 기기 드로어(없으면 URL ?device= 직접 교체) */
  onOpenDevice?: (id: number) => void
}

const EVENT_BADGE_VARIANT: Record<DeviceEventType, 'primary' | 'default' | 'warning' | 'outline' | 'destructive'> = {
  REGISTER: 'primary',
  MOVE_WARD: 'outline',
  RECOVER: 'warning',
  CORRECT: 'default',
  AS_OPEN: 'destructive',
  AS_CLEAR: 'outline',
}

export function DeviceHistoryDrawer({ deviceId, onClose, capabilities, onMutated, onAction, reloadKey, onOpenDevice }: DeviceHistoryDrawerProps) {
  const notify = useDevicesToast()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { canWrite, canAdmin } = capabilities
  const open = deviceId != null
  useOverlayDismiss(open, onClose)

  const openOther = useCallback(
    (id: number) => {
      if (onOpenDevice) return onOpenDevice(id)
      const next = new URLSearchParams(searchParams?.toString() ?? '')
      next.set('device', String(id))
      router.replace(`${pathname || '/devices'}?${next.toString()}`, { scroll: false })
    },
    [onOpenDevice, router, pathname, searchParams]
  )

  // ── 상세 로드
  const [device, setDevice] = useState<DeviceDetail | null>(null)
  const [events, setEvents] = useState<DeviceDetailEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (deviceId == null) {
      setDevice(null)
      setEvents([])
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    getUnitDetail(deviceId)
      .then((r) => {
        if (!alive) return
        setDevice(r.device)
        setEvents(r.events)
        setError(null)
      })
      .catch((e) => {
        if (!alive) return
        setError(errorMessage(e, '기기 정보를 불러오지 못했습니다.'))
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [deviceId, reloadKey, retry])

  // 다른 기기로 전환되면 편집 상태 초기화
  useEffect(() => {
    setEditingEventId(null)
    setMemoEditing(false)
    setSnapshotOpen(false)
    setUsageEditing(false)
    setPtEditing(false)
    setDealEditing(false)
    setDealOptions(null)
  }, [deviceId])

  // ── 상품유형(일반/라이트) — 배치 속성(B-22), USER+ 인라인 변경(CORRECT)
  const [ptEditing, setPtEditing] = useState(false)
  const [ptSaving, setPtSaving] = useState(false)
  const savePt = async (raw: string) => {
    if (!device || ptSaving) return
    const next = (raw || null) as ProductType | null
    if (next === (device.productType ?? null)) {
      setPtEditing(false)
      return
    }
    setPtSaving(true)
    try {
      const r = await patchDevice(device.id, { productType: next })
      setDevice({ ...device, productType: r.device.productType ?? next })
      setPtEditing(false)
      notify(`${device.serialNo} 상품유형 → ${next ?? PRODUCT_TYPE_UNSET_LABEL}`, 'success')
      onMutated()
    } catch (e) {
      notify(errorMessage(e, '상품유형 변경에 실패했습니다.'), 'error')
    } finally {
      setPtSaving(false)
    }
  }

  // ── 계약건(딜 코드, B-23) — USER+ 인라인 변경(CORRECT). 선택지는 편집 시작 시 병원 요약에서 지연 로드
  const [dealEditing, setDealEditing] = useState(false)
  const [dealSaving, setDealSaving] = useState(false)
  const [dealOptions, setDealOptions] = useState<SummaryDealRow[] | null>(null)
  const startDealEdit = () => {
    setDealEditing(true)
    if (dealOptions != null) return
    const hosp = device?.hospitalCode ?? device?.lastHospitalCode
    if (!hosp) return setDealOptions([])
    getHospitalSummary(hosp)
      .then((s) => setDealOptions(s.deals.filter((d) => d.contracted)))
      .catch(() => setDealOptions([]))
  }
  const saveDeal = async (raw: string) => {
    if (!device || dealSaving) return
    const next = raw || null
    if (next === (device.dealCode ?? null)) {
      setDealEditing(false)
      return
    }
    setDealSaving(true)
    try {
      const r = await patchDevice(device.id, { dealCode: next })
      setDevice({ ...device, dealCode: r.device.dealCode ?? next })
      setDealEditing(false)
      notify(`${device.serialNo} 계약건 → ${next ?? '미지정'}`, 'success')
      onMutated()
    } catch (e) {
      notify(errorMessage(e, '계약건 변경에 실패했습니다.'), 'error')
    } finally {
      setDealSaving(false)
    }
  }

  // ── 용도(판매용/평가용) — 마스터는 드로어가 열려 있는 동안 1회 로드, USER+ 인라인 변경(CORRECT)
  const [usageTypes, setUsageTypes] = useState<UsageType[] | null>(null)
  const [usageEditing, setUsageEditing] = useState(false)
  const [usageSaving, setUsageSaving] = useState(false)
  useEffect(() => {
    if (!open || usageTypes) return
    let alive = true
    getUsageTypes()
      .then((r) => alive && setUsageTypes(r))
      .catch(() => alive && setUsageTypes([]))
    return () => {
      alive = false
    }
  }, [open, usageTypes])
  const saveUsage = async (raw: string) => {
    if (!device || usageSaving) return
    const next = raw ? Number(raw) : null
    if (next === (device.usageTypeId ?? null)) {
      setUsageEditing(false)
      return
    }
    setUsageSaving(true)
    try {
      const r = await patchDevice(device.id, { usageTypeId: next })
      const u = usageTypes?.find((x) => x.id === next) ?? null
      setDevice({ ...device, usageTypeId: r.device.usageTypeId ?? next, usageType: u ? { id: u.id, name: u.name, value: u.value } : null })
      setUsageEditing(false)
      notify(`${device.serialNo} 용도 → ${u?.name ?? '미지정'}`, 'success')
      onMutated()
    } catch (e) {
      notify(errorMessage(e, '용도 변경에 실패했습니다.'), 'error')
    } finally {
      setUsageSaving(false)
    }
  }

  // ── 메모
  const [memoEditing, setMemoEditing] = useState(false)
  const [memoValue, setMemoValue] = useState('')
  const [memoSaving, setMemoSaving] = useState(false)
  useEffect(() => {
    if (!memoEditing) setMemoValue(device?.memo ?? '')
  }, [device?.memo, memoEditing])
  const saveMemo = async () => {
    if (!device || memoSaving) return
    const next = memoValue.trim()
    if (next === (device.memo ?? '')) {
      setMemoEditing(false)
      return
    }
    setMemoSaving(true)
    try {
      await patchDevice(device.id, { memo: next || null })
      setDevice({ ...device, memo: next || null })
      setMemoEditing(false)
      notify(`${device.serialNo} 메모 저장`, 'success')
      onMutated()
    } catch (e) {
      notify(errorMessage(e, '메모 저장에 실패했습니다.'), 'error')
    } finally {
      setMemoSaving(false)
    }
  }

  // ── 온프렘 스냅샷
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const snapshot = useMemo(() => {
    if (!device) return []
    const items: { label: string; value: string }[] = []
    if (device.extDeviceCode) items.push({ label: '닉네임', value: device.extDeviceCode })
    if (device.macAddress) items.push({ label: 'MAC', value: device.macAddress })
    const seen = fmtKstDateTime(device.extLastSeenAt)
    if (seen) items.push({ label: '마지막 확인', value: seen })
    const synced = fmtKstDateTime(device.extSyncedAt)
    if (synced) items.push({ label: '동기화', value: synced })
    return items
  }, [device])

  // ── 관리 메뉴 · 이벤트 정정/취소
  const [adminAnchor, setAdminAnchor] = useState<HTMLElement | null>(null)
  const closeAdmin = useCallback(() => setAdminAnchor(null), [])
  const [editingEventId, setEditingEventId] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const latest = events[0] ?? null

  const cancelLatest = async () => {
    if (!device || !latest || cancelling) return
    const lines = [
      `${device.serialNo} · ${ymdOrDash(latest.occurredOn)} ${DEVICE_EVENT_TYPE_LABELS[latest.eventType]} 이벤트를 취소할까요?`,
      latest.actionGroup ? '교체·이관·일괄로 함께 기록된 짝 이벤트가 있으면 같이 취소됩니다.' : null,
      latest.importBatchId != null ? `임포트 배치 #${latest.importBatchId}의 행이므로 배치 카운트도 조정됩니다.` : null,
      events.filter((e) => (DEVICE_STATE_EVENT_TYPES as readonly string[]).includes(e.eventType)).length <= 1 && latest.eventType === 'REGISTER' ? '유일한 등록 이벤트 — 개체 자체가 삭제됩니다.' : null,
      '취소는 되돌릴 수 없습니다(감사 로그에 원문이 남습니다).',
    ].filter(Boolean)
    if (!window.confirm(lines.join('\n'))) return
    setCancelling(true)
    try {
      const r = await cancelEvent(latest.id)
      const deleted = r.deletedDeviceIds.includes(device.id)
      const details: string[] = []
      if (r.cancelledEventIds.length > 1) details.push(`함께 취소된 이벤트 ${r.cancelledEventIds.length}건`)
      if (r.restoredDevices.length > 0) details.push(`복원: ${r.restoredDevices.map((d) => `${d.serialNo} ${DEVICE_STATUS_LABELS[d.status] ?? d.status}`).join(', ')}`)
      if (deleted) details.push('이벤트가 없어진 개체는 삭제되었습니다')
      notify(`이벤트 취소: ${device.serialNo} ${DEVICE_EVENT_TYPE_LABELS[latest.eventType]}`, 'success', { details })
      onMutated()
      if (deleted) onClose()
    } catch (e) {
      notify(errorMessage(e, '이벤트 취소에 실패했습니다.'), 'error')
    } finally {
      setCancelling(false)
    }
  }

  if (!open) return null

  const ref = device ? toDeviceRef(device) : null
  const currentHospital = device?.hospitalCode ?? device?.lastHospitalCode ?? null
  const wms = device ? wmsCell(device.wms ?? device.wmsTransient) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="기기 이력"
        className="relative flex max-h-[90dvh] w-full flex-col rounded-t-2xl border border-border bg-card text-card-foreground shadow-xl sm:h-full sm:max-h-none sm:w-[600px] sm:rounded-none sm:border-l"
      >
        <div className="flex shrink-0 justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <div className="h-1 w-9 rounded-full bg-muted-foreground/30" />
        </div>

        {/* ── 헤더 */}
        <div className="shrink-0 border-b border-border px-5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {device ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-lg font-semibold leading-tight">{device.serialNo}</span>
                    {device.serialRaw && <span className="font-mono text-xs text-muted-foreground">원문 {device.serialRaw}</span>}
                    <Badge
                      variant={device.status !== 'ACTIVE' ? 'default' : device.asStartedOn ? 'warning' : 'success'}
                      title={device.asStartedOn ? `AS 시작 ${toYmd(device.asStartedOn) ?? ''}${device.asRefCode ? ` · ${device.asRefCode}` : ''} — 교체·회수 시 자동 해제` : undefined}
                    >
                      {placementStatusLabel(device)}
                    </Badge>
                    {canWrite && usageEditing ? (
                      <Select
                        aria-label="용도"
                        autoFocus
                        value={device.usageTypeId != null ? String(device.usageTypeId) : ''}
                        disabled={usageSaving || usageTypes == null}
                        onChange={(e) => void saveUsage(e.target.value)}
                        onBlur={() => !usageSaving && setUsageEditing(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setUsageEditing(false)
                        }}
                        className="h-7 w-auto text-xs"
                      >
                        <option value="">미지정</option>
                        {(usageTypes ?? []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </Select>
                    ) : canWrite ? (
                      <button
                        type="button"
                        onClick={() => setUsageEditing(true)}
                        className="rounded hover:bg-accent"
                        title="용도 변경 (판매용/평가용 — CORRECT 이벤트로 기록, 평가용은 계약 대조 제외)"
                        aria-label="용도 변경"
                      >
                        {device.usageType ? <Badge variant={usageBadgeVariant(device.usageType) ?? 'default'}>{device.usageType.name}</Badge> : <Badge variant="outline">용도 미지정</Badge>}
                      </button>
                    ) : device.usageType ? (
                      <Badge variant={usageBadgeVariant(device.usageType) ?? 'default'} title={device.usageType.value === 'EVAL' ? '평가용 — 계약 대조 제외' : undefined}>
                        {device.usageType.name}
                      </Badge>
                    ) : null}
                    {canWrite && device.status === 'ACTIVE' && ptEditing ? (
                      <Select
                        aria-label="상품유형"
                        autoFocus
                        value={device.productType ?? ''}
                        disabled={ptSaving}
                        onChange={(e) => void savePt(e.target.value)}
                        onBlur={() => !ptSaving && setPtEditing(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setPtEditing(false)
                        }}
                        className="h-7 w-auto text-xs"
                      >
                        <option value="">{PRODUCT_TYPE_UNSET_LABEL}</option>
                        {PRODUCT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </Select>
                    ) : canWrite && device.status === 'ACTIVE' ? (
                      <button type="button" onClick={() => setPtEditing(true)} className="rounded hover:bg-accent" title="상품유형 변경 (일반/라이트 — 자리의 판매 조건, CORRECT 이벤트로 기록)" aria-label="상품유형 변경">
                        {device.productType ? <Badge variant={productTypeBadgeVariant(device.productType) ?? 'default'}>{device.productType}</Badge> : <Badge variant="outline">상품유형 미지정</Badge>}
                      </button>
                    ) : device.productType ? (
                      <Badge variant={device.status === 'RECOVERED' ? 'outline' : (productTypeBadgeVariant(device.productType) ?? 'default')} title={device.status === 'RECOVERED' ? '회수 전 상품유형 — 재등록 시 다시 지정' : '상품유형 (자리의 판매 조건)'}>
                        {device.status === 'RECOVERED' ? `회수 전 ${device.productType}` : device.productType}
                      </Badge>
                    ) : null}
                    {canWrite && device.status === 'ACTIVE' && dealEditing ? (
                      <Select
                        aria-label="계약건"
                        autoFocus
                        value={device.dealCode ?? ''}
                        disabled={dealSaving || dealOptions == null}
                        onChange={(e) => void saveDeal(e.target.value)}
                        onBlur={() => !dealSaving && setDealEditing(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setDealEditing(false)
                        }}
                        className="h-7 w-auto max-w-[15rem] text-xs"
                      >
                        <option value="">{dealOptions == null ? '계약건 불러오는 중…' : '계약건 미지정'}</option>
                        {(dealOptions ?? []).map((d) => (
                          <option key={d.dealCode} value={d.dealCode}>
                            {d.dealCode}
                            {d.roundNo != null ? ` (${d.roundNo}차${d.productType ? ` ${d.productType}` : ''})` : ''}
                          </option>
                        ))}
                        {device.dealCode && !(dealOptions ?? []).some((d) => d.dealCode === device.dealCode) && (
                          <option value={device.dealCode}>{device.dealCode} (계약 외)</option>
                        )}
                      </Select>
                    ) : canWrite && device.status === 'ACTIVE' ? (
                      <button type="button" onClick={startDealEdit} className="rounded hover:bg-accent" title="계약건 변경 (이 병원 계약완료 딜 — CORRECT 이벤트로 기록, B-23)" aria-label="계약건 변경">
                        {device.dealCode ? (
                          <Badge variant="outline" className="font-mono">
                            {device.dealCode}
                          </Badge>
                        ) : (
                          <Badge variant="outline">계약건 미지정</Badge>
                        )}
                      </button>
                    ) : device.dealCode ? (
                      <Badge variant="outline" className="font-mono" title={device.status === 'RECOVERED' ? '회수 전 계약건 — 재등록 시 다시 지정' : '계약건(딜) 소프트 참조'}>
                        {device.status === 'RECOVERED' ? `회수 전 ${device.dealCode}` : device.dealCode}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-foreground">
                    {modelLabel(device.deviceInfo?.deviceName, device.deviceInfo?.deviceModel)}
                    {' · '}
                    {device.status === 'ACTIVE' ? (
                      <>
                        배치 중 @ {device.hospital?.hospitalName ?? device.hospitalCode ?? '—'} {device.ward ? `${device.ward.name}${device.ward.isActive ? '' : ' (폐쇄)'}` : '미지정'}
                        <span className="text-muted-foreground"> (배치일 {ymdOrDash(device.placedOn)})</span>
                      </>
                    ) : (
                      <>
                        회수됨 · 마지막 병원 {device.lastHospital?.hospitalName ?? device.lastHospitalCode ?? '—'}
                        <span className="text-muted-foreground">
                          {' '}
                          (회수일 {ymdOrDash(device.recoveredOn)}
                          {device.recoverReason ? ` · ${device.recoverReason.name}` : ''})
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      창고 개체:{' '}
                      {wms ? (
                        <>
                          {device.wmsWarning && <AlertTriangle size={12} className="text-warning" aria-label={device.wmsWarning} />}
                          <span className={cn(device.wmsWarning && 'text-warning-subtle-foreground')} title={device.wmsWarning ?? undefined}>
                            {wms.text}
                          </span>
                          {wms.transient && <span>(자동 매칭)</span>}
                        </>
                      ) : (
                        '—'
                      )}
                    </span>
                    {device.replacedBy && (
                      <span>
                        교체 →{' '}
                        <button type="button" className="font-mono text-primary hover:underline" onClick={() => openOther(device.replacedBy!.id)}>
                          {device.replacedBy.serialNo}
                        </button>
                      </span>
                    )}
                    {device.replaces.length > 0 && (
                      <span>
                        대체한 기기:{' '}
                        {device.replaces.map((r, i) => (
                          <span key={r.id}>
                            {i > 0 && ', '}
                            <button type="button" className="font-mono text-primary hover:underline" onClick={() => openOther(r.id)}>
                              {r.serialNo}
                            </button>
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <h2 className="text-sm font-semibold">기기 이력 #{deviceId}</h2>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="닫기" className="-mr-1 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:p-1">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── 본문 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
          {loading && !device && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> 불러오는 중…
            </div>
          )}
          {error && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive-subtle px-3 py-2 text-xs text-destructive-subtle-foreground">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={() => setRetry((k) => k + 1)}>
                다시 시도
              </Button>
            </div>
          )}

          {device && (
            <div className={cn('space-y-4', loading && 'opacity-70 transition-opacity')}>
              {/* 온프렘 스냅샷 — 값이 있을 때만 */}
              {snapshot.length > 0 && (
                <div className="text-xs">
                  <button type="button" onClick={() => setSnapshotOpen((v) => !v)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" aria-expanded={snapshotOpen}>
                    {snapshotOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    온프렘 스냅샷
                    {!snapshotOpen && <span className="ml-1">({snapshot.map((s) => `${s.label} ${s.value}`).join(' · ')})</span>}
                  </button>
                  {snapshotOpen && (
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md border border-border bg-muted/40 px-3 py-2">
                      {snapshot.map((s) => (
                        <div key={s.label} className="contents">
                          <dt className="text-muted-foreground">{s.label}</dt>
                          <dd className="font-mono">{s.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}

              {/* 메모 */}
              <div className="flex items-start gap-2 text-xs">
                <span className="mt-1.5 shrink-0 text-muted-foreground">메모</span>
                {canWrite ? (
                  memoEditing ? (
                    <Input
                      autoFocus
                      value={memoValue}
                      maxLength={500}
                      disabled={memoSaving}
                      onChange={(e) => setMemoValue(e.target.value)}
                      onBlur={saveMemo}
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') saveMemo()
                        if (e.key === 'Escape') {
                          setMemoValue(device.memo ?? '')
                          setMemoEditing(false)
                        }
                      }}
                      placeholder="각인·스티커 번호 등 현장 식별 보조"
                      className="h-8 text-xs"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMemoEditing(true)}
                      className={cn('min-h-8 flex-1 rounded-md border border-dashed border-border px-2 py-1.5 text-left hover:bg-accent', device.memo ? 'text-foreground' : 'text-muted-foreground/70')}
                      title="클릭하여 편집 (Enter 저장 · Esc 취소)"
                    >
                      {device.memo || '메모 추가'}
                    </button>
                  )
                ) : (
                  <span className="py-1.5">{device.memo || <span className="text-muted-foreground">—</span>}</span>
                )}
              </div>

              {/* 액션 */}
              <div className="flex flex-wrap items-center gap-2">
                {canWrite && ref && device.status === 'ACTIVE' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => onAction('move', ref)}>
                      병동 이동
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onAction('recover', ref)}>
                      회수
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onAction('replace', ref)}>
                      교체
                    </Button>
                  </>
                )}
                {canWrite && device.status === 'RECOVERED' && <span className="text-xs text-muted-foreground">회수된 기기 — 재배치는 [+ 등록] 폼에 시리얼을 입력하면 이력이 이어집니다.</span>}
                {!canWrite && <span className="text-xs text-muted-foreground">이동·회수·교체는 USER 등급부터 가능합니다.</span>}
                {canAdmin && (
                  <div className="ml-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        const el = e.currentTarget
                        setAdminAnchor((prev) => (prev ? null : el))
                      }}
                      aria-haspopup="menu"
                      aria-expanded={adminAnchor != null}
                      className="gap-1"
                    >
                      관리 <ChevronDown size={14} />
                    </Button>
                    <RegistryFloatingPanel open={adminAnchor != null} anchor={adminAnchor} onClose={closeAdmin} className="w-64 py-1">
                      <RegistryMenuItem
                        onClick={() => {
                          closeAdmin()
                          if (ref) onAction('correct', ref)
                        }}
                      >
                        모델/시리얼 정정
                      </RegistryMenuItem>
                      <RegistryMenuItem
                        destructive
                        disabled={!latest || cancelling}
                        onClick={() => {
                          closeAdmin()
                          void cancelLatest()
                        }}
                      >
                        마지막 이벤트 취소{latest ? ` (${ymdOrDash(latest.occurredOn)} ${DEVICE_EVENT_TYPE_LABELS[latest.eventType]})` : ''}
                      </RegistryMenuItem>
                      <div className="px-3 pb-1.5 pt-1 text-[11px] text-muted-foreground">사실은 이벤트로, 실수는 취소로 — 정정은 각 이벤트 행의 [정정]에서.</div>
                    </RegistryFloatingPanel>
                  </div>
                )}
              </div>

              {/* 타임라인 */}
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>이벤트 {events.length.toLocaleString()}건 · 최신순 · 병원 경계 무관</span>
                </div>
                {events.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">이벤트가 없습니다.</p>
                ) : (
                  <ol className="divide-y divide-border rounded-md border border-border">
                    {renderTimeline({
                      events,
                      device,
                      currentHospital,
                      canAdmin,
                      editingEventId,
                      cancelling,
                      onEdit: setEditingEventId,
                      onCancelLatest: cancelLatest,
                      onOpenDevice: openOther,
                      onSaved: () => {
                        setEditingEventId(null)
                        onMutated()
                      },
                      notify,
                      usageTypes: usageTypes ?? [],
                    })}
                  </ol>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 타임라인
// ─────────────────────────────────────────────────────────────────────────────

interface TimelineArgs {
  events: DeviceDetailEvent[]
  device: DeviceDetail
  currentHospital: string | null
  canAdmin: boolean
  editingEventId: number | null
  cancelling: boolean
  onEdit: (id: number | null) => void
  onCancelLatest: () => void
  onOpenDevice: (id: number) => void
  onSaved: () => void
  notify: ReturnType<typeof useDevicesToast>
  /** CORRECT 용도 변경 라벨 해석용 */
  usageTypes: readonly UsageType[]
}

function renderTimeline(a: TimelineArgs): ReactNode[] {
  const out: ReactNode[] = []
  let prevHospital: string | null | undefined = undefined
  a.events.forEach((ev, i) => {
    const h = ev.hospitalCode ?? (prevHospital ?? null)
    if (i > 0 && prevHospital !== undefined && h !== prevHospital) {
      out.push(
        <li key={`sep-${ev.id}`} className="flex items-center gap-2 bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground" aria-label="이전 병원">
          <span className="h-px flex-1 bg-border" />
          이전 병원{ev.hospital ? ` · ${ev.hospital.hospitalName}` : ''}
          <span className="h-px flex-1 bg-border" />
        </li>
      )
    }
    prevHospital = h
    out.push(
      <EventRow
        key={ev.id}
        ev={ev}
        isLatest={i === 0}
        showHospital={ev.hospitalCode != null && ev.hospitalCode !== a.currentHospital}
        canAdmin={a.canAdmin}
        editing={a.editingEventId === ev.id}
        cancelling={a.cancelling}
        onEdit={() => a.onEdit(a.editingEventId === ev.id ? null : ev.id)}
        onCancelLatest={a.onCancelLatest}
        onOpenDevice={a.onOpenDevice}
        onSaved={a.onSaved}
        onCancelEdit={() => a.onEdit(null)}
        notify={a.notify}
        usageTypes={a.usageTypes}
        currentProductType={a.device.productType ?? null}
      />
    )
  })
  return out
}

function EventRow({
  ev,
  isLatest,
  showHospital,
  canAdmin,
  editing,
  cancelling,
  onEdit,
  onCancelLatest,
  onOpenDevice,
  onSaved,
  onCancelEdit,
  notify,
  usageTypes,
  currentProductType,
}: {
  ev: DeviceDetailEvent
  isLatest: boolean
  showHospital: boolean
  canAdmin: boolean
  editing: boolean
  cancelling: boolean
  onEdit: () => void
  onCancelLatest: () => void
  onOpenDevice: (id: number) => void
  onSaved: () => void
  onCancelEdit: () => void
  notify: ReturnType<typeof useDevicesToast>
  usageTypes: readonly UsageType[]
  /** 현재 배치 상품유형 — 이벤트 스냅샷과 다르면 '(당시 …)' 병기 */
  currentProductType: string | null
}) {
  const occurred = toYmd(ev.occurredOn)
  const createdKst = fmtKstDateTime(ev.createdAt)
  const createdDiffers = createdKst != null && occurred != null && kstYmd(ev.createdAt) !== occurred
  const href = refLink(ev.refType, ev.refCode)
  const importLocked = ev.importBatchId != null && ev.eventType === 'REGISTER'
  const editedKst = fmtKstDateTime(ev.editedAt)
  // 상품유형 스냅샷 — 현재 배치 값과 다를 때만 표시(CORRECT는 요약에 before→after가 이미 있으므로 생략)
  const productTypeSnapshotNote = ev.eventType !== 'CORRECT' && (ev.productType ?? null) !== (currentProductType ?? null) ? `당시 ${ev.productType ?? PRODUCT_TYPE_UNSET_LABEL}` : null

  return (
    <li className={cn('px-3 py-2 text-xs', isLatest && 'bg-primary-subtle/20')}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="w-[5.5rem] shrink-0 font-medium tabular-nums text-foreground">{occurred ?? '—'}</span>
        <Badge variant={EVENT_BADGE_VARIANT[ev.eventType] ?? 'default'} className="shrink-0">
          {DEVICE_EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="text-foreground">
            {showHospital && ev.hospital && <span className="mr-1 text-muted-foreground">{ev.hospital.hospitalName}</span>}
            <EventSummary ev={ev} onOpenDevice={onOpenDevice} usageTypes={usageTypes} />
            {importLocked && ev.importBatch && (
              <span className="ml-1 text-muted-foreground">
                (임포트 #{ev.importBatch.id}
                {ev.importBatch.fileName ? `, ${ev.importBatch.fileName}` : ''}
                {ev.importBatch.cancelledAt ? ', 취소됨' : ''})
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
            {ev.refCode && (
              <span>
                {REGISTRY_REF_TYPE_LABELS[(ev.refType ?? '') as RegistryRefType] ?? ev.refType}{' '}
                {href ? (
                  <Link href={href} className="font-mono text-primary hover:underline">
                    {ev.refCode}
                  </Link>
                ) : (
                  <span className="font-mono">{ev.refCode}</span>
                )}
              </span>
            )}
            {ev.source !== 'MANUAL' && <span className="rounded bg-muted px-1 py-px text-[10px]">{REGISTRY_SOURCE_LABELS[ev.source] ?? ev.source}</span>}
            {productTypeSnapshotNote && <span className="rounded bg-muted px-1 py-px text-[10px]" title="이벤트 시점 상품유형 스냅샷(현재 값과 다름)">{productTypeSnapshotNote}</span>}
            <span>{ev.actorName ?? '—'}</span>
            {createdKst && <span className={cn(createdDiffers ? 'text-muted-foreground/80' : 'text-muted-foreground')}>(기록 {createdKst.slice(5)})</span>}
            {editedKst && <span title={`정정 ${editedKst}`}>· 정정됨 {editedKst.slice(5, 10)}</span>}
            {ev.memo && <span className="italic">“{ev.memo}”</span>}
          </div>
        </div>
        {canAdmin && (
          <div className="flex shrink-0 items-center gap-1">
            {importLocked ? (
              <span className="text-[11px] text-muted-foreground" title="임포트 행의 업무일자는 임포트 탭 [업무일자 정정]·[취소]로 처리합니다">
                (배치 취소로만)
              </span>
            ) : (
              <button type="button" onClick={onEdit} className={cn('rounded px-1.5 py-0.5 text-[11px] hover:bg-accent', editing ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
                정정
              </button>
            )}
            {isLatest && (
              <button type="button" onClick={onCancelLatest} disabled={cancelling} className="rounded px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive-subtle disabled:opacity-50" title="마지막 이벤트 취소(LIFO)">
                취소
              </button>
            )}
          </div>
        )}
      </div>
      {editing && <EventEditForm ev={ev} onCancel={onCancelEdit} onSaved={onSaved} notify={notify} />}
    </li>
  )
}

function DeviceLink({ id, serial, onOpenDevice }: { id: number; serial: string; onOpenDevice: (id: number) => void }) {
  return (
    <button type="button" className="font-mono text-primary hover:underline" onClick={() => onOpenDevice(id)}>
      {serial}
    </button>
  )
}

function EventSummary({ ev, onOpenDevice, usageTypes }: { ev: DeviceDetailEvent; onOpenDevice: (id: number) => void; usageTypes: readonly UsageType[] }) {
  switch (ev.eventType) {
    case 'REGISTER':
      return (
        <>
          → {ev.toWard?.name ?? '미지정'}
          {ev.relatedDevice && (
            <span className="text-muted-foreground">
              {' '}
              (교체: <DeviceLink id={ev.relatedDevice.id} serial={ev.relatedDevice.serialNo} onOpenDevice={onOpenDevice} /> 대체)
            </span>
          )}
        </>
      )
    case 'MOVE_WARD':
      return (
        <>
          {ev.fromWard?.name ?? '미지정'} → {ev.toWard?.name ?? '미지정'}
        </>
      )
    case 'RECOVER':
      return (
        <>
          {ev.fromWard?.name ?? '미지정'} · {ev.reasonCode?.name ?? '사유 없음'}
          {ev.relatedDevice && (
            <>
              {' '}
              → 교체 <DeviceLink id={ev.relatedDevice.id} serial={ev.relatedDevice.serialNo} onOpenDevice={onOpenDevice} />
            </>
          )}
        </>
      )
    case 'AS_OPEN':
      return <>AS진행중 표시</>
    case 'AS_CLEAR':
      return <>AS진행중 해제</>
    case 'CORRECT': {
      const lines = changeSummaryLines(ev.changes, undefined, usageTypes)
      return <>{lines.length ? lines.join(' · ') : '식별 정정'}</>
    }
    default:
      return <>{ev.eventType}</>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 이벤트 인플레이스 정정 폼 (§8.2 허용 필드만)
// ─────────────────────────────────────────────────────────────────────────────

function EventEditForm({ ev, onCancel, onSaved, notify }: { ev: DeviceDetailEvent; onCancel: () => void; onSaved: () => void; notify: ReturnType<typeof useDevicesToast> }) {
  const needsToWard = ev.eventType === 'REGISTER' || ev.eventType === 'MOVE_WARD'
  const needsFromWard = ev.eventType === 'RECOVER'
  const needsReason = ev.eventType === 'RECOVER'

  const [occurredOn, setOccurredOn] = useState(toYmd(ev.occurredOn) ?? '')
  const [memo, setMemo] = useState(ev.memo ?? '')
  const [refType, setRefType] = useState<string>(ev.refType ?? '')
  const [refCode, setRefCode] = useState(ev.refCode ?? '')
  const [toWardId, setToWardId] = useState<string>(ev.toWardId != null ? String(ev.toWardId) : '')
  const [fromWardId, setFromWardId] = useState<string>(ev.fromWardId != null ? String(ev.fromWardId) : '')
  const [reasonCodeId, setReasonCodeId] = useState<string>(ev.reasonCodeId != null ? String(ev.reasonCodeId) : '')
  const [wards, setWards] = useState<Ward[] | null>(null)
  const [reasons, setReasons] = useState<RecoveryReason[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    if ((needsToWard || needsFromWard) && ev.hospitalCode) {
      getWards(ev.hospitalCode)
        .then((r) => alive && setWards(r.data))
        .catch(() => alive && setWards([]))
    }
    if (needsReason) {
      getRecoveryReasons()
        .then((r) => alive && setReasons(r))
        .catch(() => alive && setReasons([]))
    }
    return () => {
      alive = false
    }
  }, [ev.hospitalCode, needsToWard, needsFromWard, needsReason])

  const wardOptions = useMemo(() => {
    const list = (wards ?? []).filter((w) => w.isActive || w.id === ev.toWardId || w.id === ev.fromWardId)
    return list.map((w) => ({ id: w.id, label: `${w.name}${w.isActive ? '' : ' (폐쇄)'}` }))
  }, [wards, ev.toWardId, ev.fromWardId])

  const patch = useMemo<EventPatchBody>(() => {
    const p: EventPatchBody = {}
    if (occurredOn && occurredOn !== toYmd(ev.occurredOn)) p.occurredOn = occurredOn
    if (memo.trim() !== (ev.memo ?? '')) p.memo = memo.trim() || null
    const rt = refType || null
    const rc = refCode.trim() || null
    if (rt !== (ev.refType ?? null) || rc !== (ev.refCode ?? null)) {
      p.ref = rt && rc ? { type: rt as RegistryRefType, code: rc } : null
    }
    if (needsToWard) {
      const v = toWardId === '' ? null : Number(toWardId)
      if (v !== (ev.toWardId ?? null)) p.toWardId = v
    }
    if (needsFromWard) {
      const v = fromWardId === '' ? null : Number(fromWardId)
      if (v !== (ev.fromWardId ?? null)) p.fromWardId = v
    }
    if (needsReason && reasonCodeId && Number(reasonCodeId) !== ev.reasonCodeId) p.reasonCodeId = Number(reasonCodeId)
    return p
  }, [occurredOn, memo, refType, refCode, toWardId, fromWardId, reasonCodeId, ev, needsToWard, needsFromWard, needsReason])

  const hasChanges = Object.keys(patch).length > 0
  const dateInvalid = occurredOn !== '' && (!isYmd(occurredOn) || isFutureYmd(occurredOn))
  const refInvalid = (refType !== '') !== (refCode.trim() !== '')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!hasChanges) {
      setError('변경 사항이 없습니다.')
      return
    }
    if (dateInvalid) {
      setError('업무일자 형식이 잘못되었거나 미래 날짜입니다.')
      return
    }
    if (refInvalid) {
      setError('연결은 유형과 코드를 함께 입력하세요.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await patchEvent(ev.id, patch)
      notify(`이벤트 정정: ${toYmd(ev.occurredOn)} ${DEVICE_EVENT_TYPE_LABELS[ev.eventType]}`, 'success')
      onSaved()
    } catch (err) {
      setError(errorMessage(err, '정정에 실패했습니다.'))
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = 'h-8 text-xs'

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-md border border-border bg-muted/40 p-3 text-xs" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-0.5 block text-muted-foreground">업무일자</span>
          <Input type="date" value={occurredOn} max={todayKst()} onChange={(e) => setOccurredOn(e.target.value)} className={cn(fieldCls, dateInvalid && 'border-destructive')} />
        </label>
        {needsReason && (
          <label className="block">
            <span className="mb-0.5 block text-muted-foreground">사유</span>
            <Select value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)} className={fieldCls} disabled={reasons == null}>
              {reasons == null && <option value={reasonCodeId}>{ev.reasonCode?.name ?? '불러오는 중…'}</option>}
              {reasons?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              {reasons && ev.reasonCodeId != null && !reasons.some((r) => r.id === ev.reasonCodeId) && <option value={ev.reasonCodeId}>{ev.reasonCode?.name ?? `#${ev.reasonCodeId}`}</option>}
            </Select>
          </label>
        )}
        {needsToWard && (
          <label className="block">
            <span className="mb-0.5 block text-muted-foreground">병동(to)</span>
            <Select value={toWardId} onChange={(e) => setToWardId(e.target.value)} className={fieldCls} disabled={wards == null}>
              <option value="">미지정</option>
              {wards == null && ev.toWardId != null && <option value={ev.toWardId}>{ev.toWard?.name ?? `#${ev.toWardId}`}</option>}
              {wardOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </Select>
          </label>
        )}
        {needsFromWard && (
          <label className="block">
            <span className="mb-0.5 block text-muted-foreground">병동(from)</span>
            <Select value={fromWardId} onChange={(e) => setFromWardId(e.target.value)} className={fieldCls} disabled={wards == null}>
              <option value="">미지정</option>
              {wards == null && ev.fromWardId != null && <option value={ev.fromWardId}>{ev.fromWard?.name ?? `#${ev.fromWardId}`}</option>}
              {wardOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="block">
          <span className="mb-0.5 block text-muted-foreground">연결 유형</span>
          <Select value={refType} onChange={(e) => setRefType(e.target.value)} className={fieldCls}>
            <option value="">없음</option>
            {REGISTRY_REF_TYPES.map((t) => (
              <option key={t} value={t}>
                {REGISTRY_REF_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-muted-foreground">연결 코드</span>
          <Input value={refCode} onChange={(e) => setRefCode(e.target.value.toUpperCase())} placeholder="MNT-202605-0047" className={cn(fieldCls, 'font-mono', refInvalid && 'border-destructive')} autoComplete="off" />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-0.5 block text-muted-foreground">메모</span>
          <Input value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} className={fieldCls} />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">유형·기기·병원·상대 기기·배치는 정정할 수 없습니다 — 잘못 기록됐다면 취소 후 다시 입력하세요. 업무일자 변경은 전이 재검증(불성립 시 409)을 거칩니다.</p>
      {error && (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive-subtle px-2 py-1 text-destructive-subtle-foreground">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving} className="h-7 text-xs">
          닫기
        </Button>
        <Button type="submit" size="sm" disabled={saving || !hasChanges || dateInvalid || refInvalid} className="h-7 text-xs">
          {saving ? '저장 중…' : '정정 저장'}
        </Button>
      </div>
    </form>
  )
}

export default DeviceHistoryDrawer
