'use client'

/**
 * 교체 폼 (1폼 → 2이벤트, §6.1-B 폼 · 교체 / §7.0 교체 계약) — GROUP C
 * 구 시리얼 ↵ → lookupSerial:
 *  (a) 이 병원 ACTIVE: 모델·병동 표시
 *  (b) 원장에 없음: 안내 '원장에 없는 시리얼 — 이 병원에 업무일자로 소급 등록한 뒤 교체합니다(실제 설치일은 기록되지 않음)' + 모델(guessDeviceClassByPrefix 자동)·병동 입력 → oldDeviceInfoId/oldWardId|oldWardName
 *  (c) 타 병원 ACTIVE: 서버 409 문구 그대로 "구 기기가 {병원}에 배치 중 — 그 병원에서 회수(또는 이관) 기록 후 신 기기를 등록으로 처리하세요"
 *  (d) 이 병원 RECOVERED: 'RECOVER 없이 교체 기기만 등록' 안내
 * 신 시리얼(모델 자동·⚠접두 불일치·회수 이력 있으면 "재등록으로 이력 연결" 힌트·타 병원 ACTIVE면 [이관 처리]=newConflict:'TRANSFER'·이 병원 배치 중이면 '이미 등록된 기기 — 회수만 기록하고 병동을 맞춥니다')
 * · 병동(구 기본) · 신 기기 용도(구 기기 용도 기본 — 사용자가 손대지 않으면 구 기기 조회 결과를 따라감; 신규 유닛일 때만 부여) · 사유(DEFECT 기본) · 업무일자 · 코드. Tab 구→신→제출.
 * replaceDevice(code, body) → onDone({ message:'교체 기록: P018363 회수(불량) · P020418 등록(3병동)', openDeviceId: newDevice.id, warnings })
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import Badge from '@/app/components/ui/Badge'
import { Input, Select, Textarea } from '@/app/components/ui/Input'
import { cn } from '@/lib/cn'
import { guessDeviceClassByPrefix, normalizeSerial, todayKst, toYmd, type OccurredOnBasis } from '@/lib/deviceRegistryShared'
import { errorMessage, isApiError, getRecoveryReasons, getUsageTypes, lookupSerial, replaceDevice } from './api'
import type { DeviceRef, DeviceRowBase, ModelSummary, MutationDone, RecoveryReason, RegistryRef, ReplaceBody, UsageType, WardOption, WardValue } from './types'
import { WardCombo } from './WardCombo'
import { MaintenanceCodeCombo } from './MaintenanceCodeCombo'
import { FormField, ModalActions, Notice, OccurredOnField, StatusBadge, describeWard, isSubmitShortcut, useOccurredOn, wardBody } from './registryFormKit'

export interface ReplaceModalProps {
  open: boolean
  onClose: () => void
  hospitalCode: string
  /** 구 기기 프리셋(행 ⋯·드로어·회수 폼 전환에서 진입) — null이면 구 시리얼 입력부터 */
  oldDevice?: DeviceRef | null
  models: ModelSummary[]
  wards: WardOption[]
  today: string | null
  onDone: (result: MutationDone) => void
}

type OldState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'active_here'; device: DeviceRowBase }
  | { kind: 'not_found'; serialNo: string }
  | { kind: 'other_hospital'; device: DeviceRowBase }
  | { kind: 'recovered_here'; device: DeviceRowBase }
  | { kind: 'recovered_elsewhere'; device: DeviceRowBase }
  | { kind: 'error'; message: string }

type NewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'create'; serialNo: string }
  | { kind: 'reregister'; device: DeviceRowBase }
  | { kind: 'other_hospital'; device: DeviceRowBase }
  | { kind: 'active_here'; device: DeviceRowBase }
  | { kind: 'same_as_old' }
  | { kind: 'error'; message: string }

/** 접두 추정 → summary.models 매칭 (온프렘 코드 일치 → GATEWAY 분류) */
function guessModel(serialNo: string, models: ModelSummary[]): { model: ModelSummary | null; hint: string | null } {
  const g = guessDeviceClassByPrefix(serialNo)
  let model: ModelSummary | null = null
  if (g.onpremDeviceType != null) model = models.find((m) => m.onpremDeviceType === g.onpremDeviceType) ?? null
  else if (g.deviceClass === 'GATEWAY') model = models.find((m) => m.deviceClass === 'GATEWAY') ?? null
  return { model, hint: g.hintModel ?? null }
}

function modelLabel(m: { deviceName: string; deviceModel: string } | null | undefined): string {
  if (!m) return '—'
  return `${m.deviceName} ${m.deviceModel}`
}

export function ReplaceModal(props: ReplaceModalProps) {
  const { open, onClose } = props
  return (
    <Modal open={open} onClose={onClose} title="교체 (회수 + 신 기기 등록)" widthClass="max-w-2xl">
      {open && <ReplaceForm {...props} />}
    </Modal>
  )
}

function ReplaceForm({ onClose, hospitalCode, oldDevice, models, wards, today: todayProp, onDone }: ReplaceModalProps) {
  const today = todayProp ?? todayKst()

  // ── 구 기기
  const [oldInput, setOldInput] = useState(oldDevice?.serialNo ?? '')
  const [oldState, setOldState] = useState<OldState>({ kind: 'idle' })
  const [oldModelId, setOldModelId] = useState<number | ''>('')
  const [oldWard, setOldWard] = useState<WardValue>({})
  const oldLooked = useRef<string | null>(null)
  const oldSeq = useRef(0)

  // ── 신 기기
  const [newInput, setNewInput] = useState('')
  const [newState, setNewState] = useState<NewState>({ kind: 'idle' })
  const [newModelId, setNewModelId] = useState<number | ''>('')
  const [newConflict, setNewConflict] = useState(false)
  const newLooked = useRef<string | null>(null)
  const newSeq = useRef(0)

  // ── 공통
  const [toWard, setToWard] = useState<WardValue>({})
  const [toWardDirty, setToWardDirty] = useState(false)
  const [reasons, setReasons] = useState<RecoveryReason[] | null>(null)
  const [reasonId, setReasonId] = useState<number | ''>('')
  const [usageTypes, setUsageTypes] = useState<UsageType[] | null>(null)
  /** 신 기기 용도 — 사용자가 고르기 전까지는 구 기기 용도를 따라간다 */
  const [newUsageId, setNewUsageId] = useState<number | ''>(oldDevice?.usageTypeId ?? '')
  const [newUsageDirty, setNewUsageDirty] = useState(false)
  const occ = useOccurredOn(today)
  const [memo, setMemo] = useState('')
  const [refCode, setRefCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const oldRef = useRef<HTMLInputElement>(null)
  const newRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let alive = true
    getRecoveryReasons()
      .then((r) => {
        if (!alive) return
        setReasons(r)
        const defect = r.find((x) => x.value === 'DEFECT')
        setReasonId((cur) => (cur === '' && defect ? defect.id : cur))
      })
      .catch(() => alive && setReasons([]))
    getUsageTypes()
      .then((r) => alive && setUsageTypes(r))
      .catch(() => alive && setUsageTypes([]))
    return () => {
      alive = false
    }
  }, [])

  const oldKey = normalizeSerial(oldInput).serialNo
  const newKey = normalizeSerial(newInput).serialNo

  // ── 구 기기 조회
  const lookupOld = useCallback(
    async (raw: string) => {
      const key = normalizeSerial(raw).serialNo
      if (!key) {
        setOldState({ kind: 'idle' })
        oldLooked.current = null
        return
      }
      if (oldLooked.current === key) return
      oldLooked.current = key
      const seq = ++oldSeq.current
      setOldState({ kind: 'loading' })
      try {
        const r = await lookupSerial(raw.trim())
        if (seq !== oldSeq.current) return
        const d = r.device
        if (!d) {
          setOldState({ kind: 'not_found', serialNo: r.input.serialNo || key })
          const g = guessModel(key, models)
          setOldModelId(g.model?.deviceInfoId ?? '')
          setOldWard({})
          if (!toWardDirty) setToWard({})
          if (!newUsageDirty) setNewUsageId('')
        } else if (d.status === 'ACTIVE' && d.hospitalCode === hospitalCode) {
          setOldState({ kind: 'active_here', device: d })
          if (!toWardDirty) setToWard(d.wardId != null ? { wardId: d.wardId } : {})
          if (!newUsageDirty) setNewUsageId(d.usageTypeId ?? '')
        } else if (d.status === 'ACTIVE') {
          setOldState({ kind: 'other_hospital', device: d })
        } else if (d.lastHospitalCode === hospitalCode) {
          setOldState({ kind: 'recovered_here', device: d })
          if (!toWardDirty) setToWard({})
          if (!newUsageDirty) setNewUsageId(d.usageTypeId ?? '')
        } else {
          setOldState({ kind: 'recovered_elsewhere', device: d })
        }
      } catch (e) {
        if (seq !== oldSeq.current) return
        setOldState({ kind: 'error', message: errorMessage(e, '조회 실패') })
        oldLooked.current = null
      }
    },
    [hospitalCode, models, toWardDirty, newUsageDirty]
  )

  // ── 신 기기 조회
  const lookupNew = useCallback(
    async (raw: string, currentOldKey: string) => {
      const key = normalizeSerial(raw).serialNo
      if (!key) {
        setNewState({ kind: 'idle' })
        newLooked.current = null
        return
      }
      if (key === currentOldKey) {
        setNewState({ kind: 'same_as_old' })
        newLooked.current = key
        return
      }
      if (newLooked.current === key && newState.kind !== 'same_as_old') return
      newLooked.current = key
      const seq = ++newSeq.current
      setNewState({ kind: 'loading' })
      setNewConflict(false)
      try {
        const r = await lookupSerial(raw.trim())
        if (seq !== newSeq.current) return
        const d = r.device
        if (!d) {
          setNewState({ kind: 'create', serialNo: r.input.serialNo || key })
          setNewModelId(guessModel(key, models).model?.deviceInfoId ?? '')
        } else if (d.status === 'RECOVERED') setNewState({ kind: 'reregister', device: d })
        else if (d.hospitalCode === hospitalCode) setNewState({ kind: 'active_here', device: d })
        else setNewState({ kind: 'other_hospital', device: d })
      } catch (e) {
        if (seq !== newSeq.current) return
        setNewState({ kind: 'error', message: errorMessage(e, '조회 실패') })
        newLooked.current = null
      }
    },
    [hospitalCode, models, newState.kind]
  )

  // 프리셋 구 기기 → 즉시 조회 + 신 시리얼로 포커스
  useEffect(() => {
    if (oldDevice?.serialNo) {
      void lookupOld(oldDevice.serialNo)
      requestAnimationFrame(() => newRef.current?.focus())
    } else requestAnimationFrame(() => oldRef.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 구 시리얼이 바뀌면 신 기기 '동일' 판정 갱신
  useEffect(() => {
    if (newState.kind === 'same_as_old' && newKey && newKey !== oldKey) {
      newLooked.current = null
      void lookupNew(newInput, oldKey)
    } else if (newKey && newKey === oldKey && newState.kind !== 'same_as_old' && newState.kind !== 'idle') setNewState({ kind: 'same_as_old' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldKey])

  // ── 파생
  const oldDeviceRow = 'device' in oldState ? oldState.device : null
  const oldModelEff: { id: number; label: string } | null = useMemo(() => {
    if (oldDeviceRow) return { id: oldDeviceRow.deviceInfo.id, label: modelLabel(oldDeviceRow.deviceInfo) }
    if (oldState.kind === 'not_found' && oldModelId !== '') {
      const m = models.find((x) => x.deviceInfoId === oldModelId)
      return m ? { id: m.deviceInfoId, label: modelLabel(m) } : null
    }
    return null
  }, [oldDeviceRow, oldState.kind, oldModelId, models])

  const newDeviceRow = 'device' in newState ? newState.device : null
  const newModelEff: { id: number; label: string } | null = useMemo(() => {
    if (newDeviceRow) return { id: newDeviceRow.deviceInfo.id, label: modelLabel(newDeviceRow.deviceInfo) }
    if (newState.kind === 'create' && newModelId !== '') {
      const m = models.find((x) => x.deviceInfoId === newModelId)
      return m ? { id: m.deviceInfoId, label: modelLabel(m) } : null
    }
    return null
  }, [newDeviceRow, newState.kind, newModelId, models])

  const modelMismatch = !!oldModelEff && !!newModelEff && oldModelEff.id !== newModelEff.id
  const newGuessHint = newState.kind === 'create' && newModelId === '' ? guessModel(newKey, models).hint : null
  const oldGuessHint = oldState.kind === 'not_found' && oldModelId === '' ? guessModel(oldKey, models).hint : null

  const oldOk = oldState.kind === 'active_here' || oldState.kind === 'recovered_here' || (oldState.kind === 'not_found' && oldModelId !== '')
  const newOk = newState.kind === 'reregister' || newState.kind === 'active_here' || (newState.kind === 'create' && newModelId !== '') || (newState.kind === 'other_hospital' && newConflict)
  const reason = useMemo(() => (reasons ?? []).find((r) => r.id === reasonId) ?? null, [reasons, reasonId])
  const disabled = submitting || !oldOk || !newOk || !!occ.error

  // 구 기기의 병동 표시(폼 기본값 설명용)
  const oldWardLabel = oldState.kind === 'active_here' ? oldState.device.ward?.name ?? '미지정' : oldState.kind === 'not_found' ? describeWard(oldWard, wards) : oldState.kind === 'recovered_here' ? '회수 전 병동' : null

  const onRefChange = (code: string | null, suggested: string | null, basis: OccurredOnBasis | null) => {
    setRefCode(code ?? '')
    if (code) occ.suggest(suggested, basis)
    else occ.suggest(null, null)
  }

  const submit = async () => {
    if (disabled) return
    setSubmitting(true)
    setError(null)
    const ref: RegistryRef | null = refCode ? { type: 'MAINTENANCE', code: refCode } : null
    const oldWardB = wardBody(oldWard)
    const toWardB = wardBody(toWard)
    const body: ReplaceBody = {
      ...(oldDeviceRow ? { oldDeviceId: oldDeviceRow.id } : { oldSerial: oldInput.trim(), ...(oldModelId !== '' ? { oldDeviceInfoId: oldModelId } : {}), ...(oldWardB.wardId != null ? { oldWardId: oldWardB.wardId } : oldWardB.wardName ? { oldWardName: oldWardB.wardName } : {}) }),
      newSerial: newInput.trim(),
      ...(newState.kind === 'create' && newModelId !== '' ? { newDeviceInfoId: newModelId } : {}),
      ...(toWardB.wardId != null ? { toWardId: toWardB.wardId } : toWardB.wardName ? { toWardName: toWardB.wardName } : {}),
      ...(reasonId !== '' ? { reasonCodeId: reasonId } : {}),
      ...(newUsageId !== '' ? { newUsageTypeId: newUsageId } : {}),
      ...(oldState.kind === 'not_found' && newUsageId !== '' ? { oldUsageTypeId: newUsageId } : {}),
      occurredOn: occ.value,
      memo: memo.trim() || null,
      ref,
      ...(newState.kind === 'other_hospital' && newConflict ? { newConflict: 'TRANSFER' as const } : {}),
    }
    try {
      const r = await replaceDevice(hospitalCode, body)
      const oldSerial = r.oldDevice.serialNo
      const newSerial = r.newDevice.serialNo
      const reasonName = reason?.name ?? '불량'
      const wardName = (id: number | null) => (id == null ? '미지정' : wards.find((w) => w.id === id)?.name ?? toWard.wardName ?? oldWard.wardName ?? `#${id}`)
      const oldPart = r.recovered ? `${oldSerial} 회수(${reasonName})` : `${oldSerial} (기존 회수 이벤트에 연결)`
      const newPart = r.registered ? `${newSerial} 등록(${wardName(r.registered.toWardId)})` : r.movedNew ? `${newSerial} 병동 이동(${wardName(r.movedNew.toWardId)})` : `${newSerial} (이미 배치 중)`
      const warnings = [...r.warnings]
      if (r.transferRecovered) warnings.push(`${newSerial}: 타 병원 회수(이관) 기록을 함께 남겼습니다`)
      onDone({ message: `교체 기록: ${oldPart} · ${newPart}`, openDeviceId: r.newDevice.id, warnings })
    } catch (e) {
      setError(errorMessage(e))
      // 신 시리얼 타 병원 충돌(미리보기 이후 변동 등) → 이관 처리 선택지를 다시 연다
      if (isApiError(e) && e.status === 409 && e.conflicts && e.conflicts.length > 0 && newState.kind !== 'other_hospital') {
        newLooked.current = null
        void lookupNew(newInput, oldKey)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onSerialKey = (which: 'old' | 'new') => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey) return
      e.preventDefault()
      if (which === 'old') {
        void lookupOld(oldInput)
        newRef.current?.focus()
      } else {
        void lookupNew(newInput, oldKey)
        submitRef.current?.focus()
      }
    }
  }

  return (
    <div
      className="space-y-5"
      onKeyDown={(e) => {
        if (isSubmitShortcut(e)) {
          e.preventDefault()
          void submit()
        }
      }}
    >
      {/* ── 구 기기 */}
      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">구 기기 (회수)</h3>
          {oldDeviceRow && <StatusBadge status={oldDeviceRow.status} />}
        </div>
        <FormField label="구 시리얼" htmlFor="replace-old" required hint={oldState.kind === 'loading' ? '조회 중…' : '↵ 또는 포커스 이동 시 원장 조회'}>
          <Input
            ref={oldRef}
            id="replace-old"
            value={oldInput}
            disabled={submitting}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono uppercase"
            placeholder="예: P018363"
            onChange={(e) => {
              setOldInput(e.target.value)
              if (normalizeSerial(e.target.value).serialNo !== oldLooked.current) setOldState({ kind: 'idle' })
            }}
            onBlur={() => void lookupOld(oldInput)}
            onKeyDown={onSerialKey('old')}
          />
        </FormField>

        {oldState.kind === 'active_here' && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
            <span>
              모델 <span className="font-medium">{modelLabel(oldState.device.deviceInfo)}</span>
            </span>
            <span>
              병동 <span className="font-medium">{oldState.device.ward?.name ?? '미지정'}</span>
            </span>
            {oldState.device.placedOn && <span className="text-muted-foreground">배치일 {toYmd(oldState.device.placedOn)}</span>}
          </div>
        )}
        {oldState.kind === 'not_found' && (
          <>
            <Notice tone="warning">원장에 없는 시리얼 — 이 병원에 업무일자로 소급 등록한 뒤 교체합니다(실제 설치일은 기록되지 않음)</Notice>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="구 기기 모델" htmlFor="replace-old-model" required hint={oldModelId === '' ? <span className="text-destructive">{oldGuessHint ? `${oldGuessHint} 모델이 등록되어 있지 않습니다 — 모델을 지정하세요` : '접두로 판별 불가 — 모델을 지정하세요'}</span> : '접두로 자동 판별 (수정 가능)'}>
                <Select id="replace-old-model" value={oldModelId} disabled={submitting} onChange={(e) => setOldModelId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">— 모델 선택 —</option>
                  {models.map((m) => (
                    <option key={m.deviceInfoId} value={m.deviceInfoId}>
                      {modelLabel(m)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="구 기기 병동" htmlFor="replace-old-ward" hint="소급 등록될 병동 (신 기기 병동 기본값)">
                <WardCombo
                  id="replace-old-ward"
                  hospitalCode={hospitalCode}
                  value={oldWard}
                  onChange={(v) => {
                    setOldWard(v)
                    if (!toWardDirty) setToWard(v)
                  }}
                  allowNew
                  wards={wards}
                  disabled={submitting}
                />
              </FormField>
            </div>
          </>
        )}
        {oldState.kind === 'other_hospital' && (
          <Notice tone="error">
            구 기기가 {oldState.device.hospital?.hospitalName ?? oldState.device.hospitalCode}에 배치 중 — 그 병원에서 회수(또는 이관) 기록 후 신 기기를 등록으로 처리하세요
            {oldState.device.ward?.name ? <span className="ml-1 text-muted-foreground">({oldState.device.ward.name}{oldState.device.placedOn ? ` · 배치일 ${toYmd(oldState.device.placedOn)}` : ''})</span> : null}
          </Notice>
        )}
        {oldState.kind === 'recovered_here' && (
          <Notice tone="info">
            이 병원에서 이미 회수된 기기입니다 ({toYmd(oldState.device.recoveredOn) ?? '일자 미상'} · {oldState.device.recoverReason?.name ?? '사유 미상'}) — RECOVER 없이 교체 기기만 등록하고, 기존 회수 이벤트에 교체 상대로 연결합니다. 업무일자는 회수일 이후여야 합니다.
          </Notice>
        )}
        {oldState.kind === 'recovered_elsewhere' && (
          <Notice tone="error">
            구 기기가 이 병원에서 회수된 기기가 아닙니다 (마지막 병원 {oldState.device.lastHospital?.hospitalName ?? oldState.device.lastHospitalCode ?? '—'}) — 신 기기를 등록으로 처리하세요
          </Notice>
        )}
        {oldState.kind === 'error' && <Notice tone="error">{oldState.message}</Notice>}
      </section>

      {/* ── 신 기기 */}
      <section className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">신 기기 (등록)</h3>
          {newDeviceRow && <StatusBadge status={newDeviceRow.status} />}
        </div>
        <FormField label="신 시리얼" htmlFor="replace-new" required hint={newState.kind === 'loading' ? '조회 중…' : '↵ 시 조회 후 제출 버튼으로 이동'}>
          <Input
            ref={newRef}
            id="replace-new"
            value={newInput}
            disabled={submitting}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono uppercase"
            placeholder="예: P020418"
            onChange={(e) => {
              setNewInput(e.target.value)
              if (normalizeSerial(e.target.value).serialNo !== newLooked.current) {
                setNewState({ kind: 'idle' })
                setNewConflict(false)
              }
            }}
            onBlur={() => void lookupNew(newInput, oldKey)}
            onKeyDown={onSerialKey('new')}
          />
        </FormField>

        {newState.kind === 'create' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="신 기기 모델" htmlFor="replace-new-model" required hint={newModelId === '' ? <span className="text-destructive">{newGuessHint ? `${newGuessHint} 모델이 등록되어 있지 않습니다 — 모델을 지정하세요` : '접두로 판별 불가 — 모델을 지정하세요'}</span> : '접두로 자동 판별 (수정 가능)'}>
              <Select id="replace-new-model" value={newModelId} disabled={submitting} onChange={(e) => setNewModelId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— 모델 선택 —</option>
                {models.map((m) => (
                  <option key={m.deviceInfoId} value={m.deviceInfoId}>
                    {modelLabel(m)}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="self-end text-xs text-muted-foreground">원장에 없는 시리얼 — 신규 등록됩니다</div>
          </div>
        )}
        {newState.kind === 'reregister' && (
          <Notice tone="info">
            회수 이력이 있는 기기 — 재등록으로 이력을 연결합니다 ({newState.device.lastHospital?.hospitalName ?? newState.device.lastHospitalCode ?? '—'}에서 {toYmd(newState.device.recoveredOn) ?? '일자 미상'} {newState.device.recoverReason?.name ?? ''} 회수)
            {newState.device.recoverReason?.value === 'LOST' && <span className="ml-1 text-warning-subtle-foreground">· 분실 처리됐던 기기입니다</span>}
          </Notice>
        )}
        {newState.kind === 'active_here' && (
          <Notice tone="info">
            이미 등록된 기기 — 회수만 기록하고 병동을 맞춥니다 (현재 {newState.device.ward?.name ?? '미지정'}{toWard.wardId != null && toWard.wardId !== newState.device.wardId ? ` → ${describeWard(toWard, wards)}` : ''}). REGISTER는 만들지 않습니다.
          </Notice>
        )}
        {newState.kind === 'other_hospital' && (
          <Notice tone={newConflict ? 'warning' : 'error'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {newState.device.hospital?.hospitalName ?? newState.device.hospitalCode} {newState.device.ward?.name ?? ''} 배치 중{newState.device.placedOn ? ` (${toYmd(newState.device.placedOn)})` : ''} —{' '}
                {newConflict ? '이관 처리: 그 병원에 회수(이관)를 기록하고 이 병원에 등록합니다' : '이관 처리를 지정하거나 그 병원에서 먼저 회수 기록하세요'}
              </span>
              <Button size="sm" variant={newConflict ? 'primary' : 'outline'} onClick={() => setNewConflict((v) => !v)} disabled={submitting} aria-pressed={newConflict}>
                {newConflict ? '이관 처리 ✓' : '이관 처리'}
              </Button>
            </div>
          </Notice>
        )}
        {newState.kind === 'same_as_old' && <Notice tone="error">구 기기와 신 기기가 같습니다</Notice>}
        {newState.kind === 'error' && <Notice tone="error">{newState.message}</Notice>}
        {modelMismatch && (
          <Notice tone="warning">
            ⚠ 모델 불일치 — 구 {oldModelEff?.label} ↔ 신 {newModelEff?.label}. 같은 모델로 교체하는 것이 일반적입니다 (기록은 가능).
          </Notice>
        )}
      </section>

      {/* ── 공통 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="신 기기 병동" htmlFor="replace-ward" hint={oldWardLabel ? `비우면 구 기기 병동(${oldWardLabel})` : '비우면 구 기기 병동'}>
          <WardCombo
            id="replace-ward"
            hospitalCode={hospitalCode}
            value={toWard}
            onChange={(v) => {
              setToWard(v)
              setToWardDirty(true)
            }}
            allowNew
            wards={wards}
            disabled={submitting}
          />
        </FormField>
        <FormField
          label="신 기기 용도"
          htmlFor="replace-usage"
          hint={
            newState.kind === 'reregister' || newState.kind === 'active_here'
              ? '이미 원장에 있는 기기 — 용도가 비어 있을 때만 적용(변경은 식별 정정)'
              : oldState.kind === 'not_found'
                ? '구 기기 소급 등록에도 같은 용도를 적용'
                : '기본 = 구 기기 용도. 평가용은 계약 대조에서 제외'
          }
        >
          <Select
            id="replace-usage"
            value={newUsageId}
            disabled={submitting || usageTypes == null}
            onChange={(e) => {
              setNewUsageId(e.target.value ? Number(e.target.value) : '')
              setNewUsageDirty(true)
            }}
          >
            <option value="">미지정</option>
            {(usageTypes ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="회수 사유" htmlFor="replace-reason" hint="기본 불량(DEFECT)">
          <Select id="replace-reason" value={reasonId} disabled={submitting || !reasons} onChange={(e) => setReasonId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">{reasons ? '— 기본(불량) —' : '불러오는 중…'}</option>
            {(reasons ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </FormField>
        <OccurredOnField id="replace-date" state={occ} today={today} disabled={submitting} />
        <FormField label="유지보수 코드" htmlFor="replace-ref" hint="선택 시 업무일자를 제안값으로 채웁니다 (직접 고친 값은 유지)">
          <MaintenanceCodeCombo id="replace-ref" hospitalCode={hospitalCode} value={refCode} onChange={onRefChange} disabled={submitting} />
        </FormField>
      </div>
      <FormField label="메모" htmlFor="replace-memo">
        <Textarea id="replace-memo" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={submitting} rows={2} className="min-h-0" placeholder="예: 화면 불량 교체" />
      </FormField>

      {error && <Notice tone="error">{error}</Notice>}

      <ModalActions
        left={
          <span className={cn('inline-flex flex-wrap items-center gap-1.5', !(oldOk && newOk) && 'text-muted-foreground')}>
            {oldKey && <Badge variant={oldOk ? 'success' : 'outline'}>구 {oldKey}</Badge>}
            {newKey && <Badge variant={newOk ? 'success' : 'outline'}>신 {newKey}</Badge>}
            {!oldKey && !newKey && <span className="hidden sm:inline">⌘/Ctrl+Enter 제출</span>}
          </span>
        }
      >
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          취소
        </Button>
        <Button ref={submitRef} onClick={() => void submit()} disabled={disabled}>
          {submitting ? '기록 중…' : '교체 기록'}
        </Button>
      </ModalActions>
    </div>
  )
}

export default ReplaceModal
