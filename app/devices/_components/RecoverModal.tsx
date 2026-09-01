'use client'

/**
 * 회수 폼 (§6.1-B 폼 · 회수) — GROUP C
 * 대상(칩 + 시리얼 입력줄; scanMode면 입력줄 autoFocus) · 사유(getRecoveryReasons 마스터, value LOST → 안내 "분실 — 창고 반입 대상 아님",
 * value DEFECT 선택 시 [교체 폼으로 전환] 원클릭 → onSwitchToReplace(대상 1대 or null)) · 업무일자 · 메모 · 유지보수 코드
 * 제출: 1대 → recoverDevice(id, { reasonCodeId, … }) / 여러 대 → bulkDeviceAction({ action:'RECOVER', … })
 * 성공 → onDone({ message:'회수 기록: A126861 (불량(AS 회수))', warnings })
 */
import { useEffect, useMemo, useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import { Select, Textarea } from '@/app/components/ui/Input'
import { todayKst, type OccurredOnBasis } from '@/lib/deviceRegistryShared'
import { bulkDeviceAction, errorMessage, getRecoveryReasons, recoverDevice } from './api'
import type { DeviceRef, MutationDone, RecoveryReason, RegistryRef } from './types'
import { MaintenanceCodeCombo } from './MaintenanceCodeCombo'
import { FormField, ModalActions, Notice, OccurredOnField, TargetPicker, isSubmitShortcut, targetRefs, targetsFrom, useOccurredOn, wardSummaryOf, type TargetMap } from './registryFormKit'

export interface RecoverModalProps {
  open: boolean
  onClose: () => void
  hospitalCode: string
  initialDevices: DeviceRef[]
  initialDeviceIds?: number[]
  today: string | null
  /** 모바일 [회수] 0건 진입 — 시리얼 입력줄 autoFocus 스캔 모드 */
  scanMode?: boolean
  /** DEFECT 선택 시 [교체 폼으로 전환] */
  onSwitchToReplace: (device: DeviceRef | null) => void
  onDone: (result: MutationDone) => void
}

const BULK_MAX = 2000

export function RecoverModal(props: RecoverModalProps) {
  const { open, onClose } = props
  return (
    <Modal open={open} onClose={onClose} title="회수" widthClass="max-w-xl">
      {open && <RecoverForm {...props} />}
    </Modal>
  )
}

function RecoverForm({ onClose, hospitalCode, initialDevices, initialDeviceIds, today: todayProp, scanMode, onSwitchToReplace, onDone }: RecoverModalProps) {
  const today = todayProp ?? todayKst()
  const [targets, setTargets] = useState<TargetMap>(() => targetsFrom(initialDevices, initialDeviceIds))
  const [reasons, setReasons] = useState<RecoveryReason[] | null>(null)
  const [reasonsError, setReasonsError] = useState<string | null>(null)
  const [reasonId, setReasonId] = useState<number | ''>('')
  const occ = useOccurredOn(today)
  const [memo, setMemo] = useState('')
  const [refCode, setRefCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getRecoveryReasons()
      .then((r) => alive && setReasons(r))
      .catch((e) => alive && setReasonsError(errorMessage(e, '회수 사유 마스터를 불러오지 못했습니다.')))
    return () => {
      alive = false
    }
  }, [])

  const refs = useMemo(() => targetRefs(targets), [targets])
  const ids = useMemo(() => Array.from(targets.keys()), [targets])
  const reason = useMemo(() => (reasons ?? []).find((r) => r.id === reasonId) ?? null, [reasons, reasonId])
  const currentSummary = refs.length > 0 ? wardSummaryOf(refs) : null

  const disabled = submitting || ids.length === 0 || reasonId === '' || !!occ.error || ids.length > BULK_MAX

  const onRefChange = (code: string | null, suggested: string | null, basis: OccurredOnBasis | null) => {
    setRefCode(code ?? '')
    if (code) occ.suggest(suggested, basis)
    else occ.suggest(null, null)
  }

  const submit = async () => {
    const reasonCodeId = reasonId === '' ? null : reasonId
    if (disabled || reasonCodeId == null) return
    setSubmitting(true)
    setError(null)
    const ref: RegistryRef | null = refCode ? { type: 'MAINTENANCE', code: refCode } : null
    const common = { reasonCodeId, occurredOn: occ.value, memo: memo.trim() || null, ref }
    try {
      if (ids.length === 1) {
        const id = ids[0]
        const r = await recoverDevice(id, common)
        const serial = targets.get(id)?.serialNo ?? r.device.serialNo
        onDone({ message: `회수 기록: ${serial} (${r.reason.name})`, warnings: r.warnings })
      } else {
        const r = await bulkDeviceAction({ action: 'RECOVER', deviceIds: ids, hospitalCode, ...common })
        const warnings = [...r.warnings]
        if (r.skipped.length > 0) warnings.push(`건너뜀 ${r.skipped.length}대: ${r.skipped.slice(0, 5).map((s) => s.serialNo).join(', ')}${r.skipped.length > 5 ? ' 외' : ''}`)
        onDone({ message: `회수 기록: ${r.affectedDeviceIds.length.toLocaleString()}대 (${reason?.name ?? '사유'})`, warnings })
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const switchToReplace = () => {
    // 대상이 정확히 1대(행 정보 있음)일 때만 구 기기 프리셋, 아니면 구 시리얼 입력부터
    onSwitchToReplace(targets.size === 1 && refs.length === 1 ? refs[0] : null)
  }

  return (
    <div
      className="space-y-4"
      onKeyDown={(e) => {
        if (isSubmitShortcut(e)) {
          e.preventDefault()
          void submit()
        }
      }}
    >
      <FormField
        label={
          <>
            대상 <span className="tabular-nums text-foreground">{ids.length.toLocaleString()}대</span>
          </>
        }
        hint={currentSummary ? `현재 병동: ${currentSummary}` : scanMode ? '스캔 모드 — 시리얼을 스캔하면 대상에 추가됩니다' : undefined}
      >
        <TargetPicker hospitalCode={hospitalCode} targets={targets} onChange={setTargets} autoFocus={!!scanMode || targets.size === 0} disabled={submitting} emptyHint="회수할 기기를 시리얼로 추가하세요 (이 병원 배치 중 기기만)" inputId="recover-serial" />
      </FormField>

      <FormField
        label="사유"
        htmlFor="recover-reason"
        required
        hint={reasonsError ? <span className="text-destructive">{reasonsError}</span> : reasons && reasons.length === 0 ? <span className="text-destructive">회수 사유 마스터가 비어 있습니다 — 설정 &gt; 기기 회수 사유 관리</span> : undefined}
      >
        <Select id="recover-reason" value={reasonId} disabled={submitting || !reasons} onChange={(e) => setReasonId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">{reasons ? '— 사유 선택 —' : '불러오는 중…'}</option>
          {(reasons ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </FormField>

      {reason?.value === 'LOST' && <Notice tone="warning">분실 — 창고 반입 대상 아님 (WMS 대조에서 제외됩니다)</Notice>}
      {reason?.value === 'TRANSFER' && <Notice tone="info">이관 — 타 병원 재배치는 그 병원에서 등록(또는 임포트) 시 이관 처리로 기록하는 것이 이력 연결에 유리합니다. 여기서는 &apos;이 병원에서 나감&apos;만 기록됩니다.</Notice>}
      {reason?.value === 'DEFECT' && (
        <Notice tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>불량 회수와 교체 기기 등록을 한 번에 기록하려면 교체 폼을 사용하세요 (같은 action group으로 RECOVER + REGISTER).</span>
            <Button size="sm" variant="outline" onClick={switchToReplace} disabled={submitting}>
              교체 폼으로 전환
            </Button>
          </div>
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <OccurredOnField id="recover-date" state={occ} today={today} disabled={submitting} />
        <FormField label="유지보수 코드" htmlFor="recover-ref" hint="선택 시 업무일자를 제안값으로 채웁니다 (직접 고친 값은 유지)">
          <MaintenanceCodeCombo id="recover-ref" hospitalCode={hospitalCode} value={refCode} onChange={onRefChange} disabled={submitting} />
        </FormField>
      </div>

      <FormField label="메모" htmlFor="recover-memo">
        <Textarea id="recover-memo" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={submitting} rows={2} className="min-h-0" placeholder="예: 배터리 불량, AS 반입" />
      </FormField>

      {error && <Notice tone="error">{error}</Notice>}
      {ids.length > BULK_MAX && <Notice tone="error">일괄 처리는 최대 {BULK_MAX.toLocaleString()}대까지 가능합니다 (현재 {ids.length.toLocaleString()}대)</Notice>}

      <ModalActions>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          취소
        </Button>
        <Button onClick={() => void submit()} disabled={disabled}>
          {submitting ? '기록 중…' : ids.length > 1 ? `${ids.length.toLocaleString()}대 회수 기록` : '회수 기록'}
        </Button>
      </ModalActions>
    </div>
  )
}

export default RecoverModal
