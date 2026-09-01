'use client'

/**
 * 병동 이동 폼 (§6.1-B 폼 · 병동 이동) — GROUP C
 * 대상 = 선택 칩(initialDevices, 현재 병동 요약) + 시리얼 입력줄(↵/스캔마다 lookupSerial → 이 병원 ACTIVE면 칩 추가, 아니면 인라인 오류)
 * · 병동(WardCombo allowNew) · 업무일자 · 메모 · 유지보수 코드
 * 제출: 1대 → moveDevice(id, body) / 2대 이상 또는 initialDeviceIds(전체 선택) → bulkDeviceAction({ action:'MOVE_WARD', deviceIds, hospitalCode, … })
 * 같은 병동 400 · 회수됨 409 · 일괄은 이미 대상 병동인 개체 skipped[] 안내.
 * 성공 → onDone({ message:'병동 이동: 12대 → 101병동', warnings })
 */
import { useMemo, useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import { Textarea } from '@/app/components/ui/Input'
import { todayKst, type OccurredOnBasis } from '@/lib/deviceRegistryShared'
import { bulkDeviceAction, errorMessage, isApiError, moveDevice } from './api'
import type { DeviceRef, MutationDone, RegistryRef, WardOption, WardValue } from './types'
import { WardCombo } from './WardCombo'
import { MaintenanceCodeCombo } from './MaintenanceCodeCombo'
import { FormField, ModalActions, Notice, OccurredOnField, TargetPicker, describeWard, isSubmitShortcut, targetRefs, targetsFrom, useOccurredOn, wardBody, wardSummaryOf, type TargetMap } from './registryFormKit'

export interface MoveWardModalProps {
  open: boolean
  onClose: () => void
  hospitalCode: string
  /** 칩으로 보여줄 선택 기기(행 정보 있는 것) */
  initialDevices: DeviceRef[]
  /** 전체 대상 id(전체 선택 포함) — 생략 시 initialDevices의 id */
  initialDeviceIds?: number[]
  /** 병동 콤보 사전 로드 */
  wards: WardOption[]
  today: string | null
  /** 안내문(예: '252병동 배치 중 전체 38대') */
  note?: string | null
  onDone: (result: MutationDone) => void
}

const BULK_MAX = 2000

export function MoveWardModal(props: MoveWardModalProps) {
  const { open, onClose } = props
  return (
    <Modal open={open} onClose={onClose} title="병동 이동" widthClass="max-w-xl">
      {open && <MoveWardForm {...props} />}
    </Modal>
  )
}

function MoveWardForm({ onClose, hospitalCode, initialDevices, initialDeviceIds, wards, today: todayProp, note, onDone }: MoveWardModalProps) {
  const today = todayProp ?? todayKst()
  const [targets, setTargets] = useState<TargetMap>(() => targetsFrom(initialDevices, initialDeviceIds))
  const [ward, setWard] = useState<WardValue>({})
  const occ = useOccurredOn(today)
  const [memo, setMemo] = useState('')
  const [refCode, setRefCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skippedNote, setSkippedNote] = useState<string[] | null>(null)

  const refs = useMemo(() => targetRefs(targets), [targets])
  const ids = useMemo(() => Array.from(targets.keys()), [targets])
  const currentSummary = refs.length > 0 ? wardSummaryOf(refs) : null
  const wardChosen = ward.wardId != null || !!ward.wardName?.trim()

  // 클라이언트 선검사 — 대상 전부가 이미 그 병동이면 400/409를 받기 전에 안내
  const allSameWard = wardChosen && ward.wardId != null && refs.length > 0 && refs.length === targets.size && refs.every((r) => r.wardId === ward.wardId)

  const disabled = submitting || ids.length === 0 || !wardChosen || !!occ.error || allSameWard || ids.length > BULK_MAX

  const onRefChange = (code: string | null, suggested: string | null, basis: OccurredOnBasis | null) => {
    setRefCode(code ?? '')
    if (code) occ.suggest(suggested, basis)
    else occ.suggest(null, null)
  }

  const submit = async () => {
    if (disabled) return
    setSubmitting(true)
    setError(null)
    setSkippedNote(null)
    const ref: RegistryRef | null = refCode ? { type: 'MAINTENANCE', code: refCode } : null
    const common = { ...wardBody(ward), occurredOn: occ.value, memo: memo.trim() || null, ref }
    try {
      if (ids.length === 1) {
        const id = ids[0]
        const r = await moveDevice(id, common)
        const serial = targets.get(id)?.serialNo ?? r.device.serialNo
        onDone({ message: `병동 이동: ${serial} → ${r.toWard.name}${r.toWard.isNew ? ' (신규 병동)' : ''}`, warnings: r.warnings })
      } else {
        const r = await bulkDeviceAction({ action: 'MOVE_WARD', deviceIds: ids, hospitalCode, ...common })
        const wardName = describeWard(ward, wards).replace(' (신규)', '')
        const warnings = [...r.warnings]
        if (r.skipped.length > 0) {
          const sample = r.skipped
            .slice(0, 5)
            .map((s) => s.serialNo)
            .join(', ')
          warnings.push(`이미 대상 병동이라 건너뜀 ${r.skipped.length}대: ${sample}${r.skipped.length > 5 ? ' 외' : ''}`)
        }
        onDone({ message: `병동 이동: ${r.affectedDeviceIds.length.toLocaleString()}대 → ${wardName}`, warnings })
      }
    } catch (e) {
      setError(errorMessage(e))
      if (isApiError(e) && e.skipped && e.skipped.length > 0) setSkippedNote(e.skipped.map((s) => `${s.serialNo} — ${s.reason}`))
    } finally {
      setSubmitting(false)
    }
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
        hint={currentSummary ? `현재 병동: ${currentSummary}` : undefined}
      >
        <TargetPicker hospitalCode={hospitalCode} targets={targets} onChange={setTargets} note={note} disabled={submitting} emptyHint="이동할 기기를 시리얼로 추가하세요 (이 병원 배치 중 기기만)" inputId="move-serial" />
      </FormField>

      <FormField label="이동할 병동" htmlFor="move-ward" required hint={allSameWard ? <span className="text-destructive">대상이 모두 이미 해당 병동에 배치되어 있습니다</span> : '기존 병동 선택 또는 새 병동명 입력 (비활성 병동은 목록에 없음)'}>
        <WardCombo id="move-ward" hospitalCode={hospitalCode} value={ward} onChange={setWard} allowNew wards={wards} disabled={submitting} autoFocus={targets.size > 0} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <OccurredOnField id="move-date" state={occ} today={today} disabled={submitting} />
        <FormField label="유지보수 코드" htmlFor="move-ref" hint="선택 시 업무일자를 제안값으로 채웁니다 (직접 고친 값은 유지)">
          <MaintenanceCodeCombo id="move-ref" hospitalCode={hospitalCode} value={refCode} onChange={onRefChange} disabled={submitting} />
        </FormField>
      </div>

      <FormField label="메모" htmlFor="move-memo">
        <Textarea id="move-memo" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={submitting} rows={2} className="min-h-0" placeholder="예: 병동 리모델링으로 이동" />
      </FormField>

      {error && (
        <Notice tone="error">
          {error}
          {skippedNote && (
            <ul className="mt-1 list-disc pl-4">
              {skippedNote.slice(0, 5).map((s, i) => (
                <li key={i} className="font-mono">
                  {s}
                </li>
              ))}
              {skippedNote.length > 5 && <li>외 {skippedNote.length - 5}건</li>}
            </ul>
          )}
        </Notice>
      )}
      {ids.length > BULK_MAX && <Notice tone="error">일괄 처리는 최대 {BULK_MAX.toLocaleString()}대까지 가능합니다 (현재 {ids.length.toLocaleString()}대)</Notice>}

      <ModalActions>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          취소
        </Button>
        <Button onClick={() => void submit()} disabled={disabled}>
          {submitting ? '기록 중…' : ids.length > 1 ? `${ids.length.toLocaleString()}대 병동 이동` : '병동 이동'}
        </Button>
      </ModalActions>
    </div>
  )
}

export default MoveWardModal
