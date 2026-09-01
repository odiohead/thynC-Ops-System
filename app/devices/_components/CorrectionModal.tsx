'use client'

/**
 * 식별 속성 정정 모달 (§8.2 admin — 모델·시리얼·MAC·닉네임 오타) — GROUP B
 * patchDevice(id, { deviceInfoId?, serialNo?, macAddress?, extDeviceCode?, occurredOn? }) → CORRECT 이벤트.
 *  - 시리얼 정정은 상태 이벤트가 현재 병원 REGISTER 1건뿐일 때만(409 '이력이 있는 개체 — 오입력이면 이벤트 취소를 사용하세요' 그대로 표시)
 *  - 시리얼 유니크 409 '이미 등록된 시리얼입니다' · 변경 없음 400
 * 열릴 때 getUnitDetail로 현재 MAC·닉네임을 채운다(DeviceRef에는 없음). 성공 → onDone({ message:'식별 정정: A12016 → A120160', openDeviceId })
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import { Input, Select } from '@/app/components/ui/Input'
import { cn } from '@/lib/cn'
import { isFutureYmd, isYmd, matchesSerialPattern, normalizeSerial, todayKst } from '@/lib/deviceRegistryShared'
import { errorMessage, getUnitDetail, getUsageTypes, patchDevice } from './api'
import { modelLabel } from './deviceDisplay'
import type { DevicePatchBody, DeviceRef, ModelSummary, MutationDone, UsageType } from './types'

export interface CorrectionModalProps {
  open: boolean
  onClose: () => void
  hospitalCode: string | null
  device: DeviceRef | null
  /** 모델 선택 옵션(summary.models) */
  models: ModelSummary[]
  onDone: (result: MutationDone) => void
}

interface FormState {
  deviceInfoId: string
  serialNo: string
  macAddress: string
  extDeviceCode: string
  /** 용도 id 문자열, '' = 미지정 */
  usageTypeId: string
  occurredOn: string
}

interface Baseline {
  deviceInfoId: number
  serialNo: string
  macAddress: string | null
  extDeviceCode: string | null
  usageTypeId: number | null
  serialPattern: string | null
  deviceName: string
  deviceModel: string
  stateEventCount: number
  hospitalCode: string | null
}

const EMPTY_FORM: FormState = { deviceInfoId: '', serialNo: '', macAddress: '', extDeviceCode: '', usageTypeId: '', occurredOn: '' }

export function CorrectionModal({ open, onClose, hospitalCode, device, models, onDone }: CorrectionModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [base, setBase] = useState<Baseline | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usageTypes, setUsageTypes] = useState<UsageType[] | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    getUsageTypes()
      .then((r) => alive && setUsageTypes(r))
      .catch(() => alive && setUsageTypes([]))
    return () => {
      alive = false
    }
  }, [open])

  // 열릴 때 현재 값 로드 — DeviceRef에는 MAC·닉네임이 없다
  useEffect(() => {
    if (!open || !device) {
      setBase(null)
      setForm(EMPTY_FORM)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    setForm({
      deviceInfoId: device.deviceInfoId != null ? String(device.deviceInfoId) : '',
      serialNo: device.serialNo,
      macAddress: '',
      extDeviceCode: '',
      usageTypeId: device.usageTypeId != null ? String(device.usageTypeId) : '',
      occurredOn: todayKst(),
    })
    getUnitDetail(device.id)
      .then((r) => {
        if (!alive) return
        const d = r.device
        const stateEventCount = r.events.filter((e) => e.eventType !== 'CORRECT').length
        setBase({
          deviceInfoId: d.deviceInfoId,
          serialNo: d.serialNo,
          macAddress: d.macAddress,
          extDeviceCode: d.extDeviceCode,
          usageTypeId: d.usageTypeId ?? null,
          serialPattern: d.deviceInfo?.serialPattern ?? null,
          deviceName: d.deviceInfo?.deviceName ?? '',
          deviceModel: d.deviceInfo?.deviceModel ?? '',
          stateEventCount,
          hospitalCode: d.hospitalCode ?? d.lastHospitalCode,
        })
        setForm({
          deviceInfoId: String(d.deviceInfoId),
          serialNo: d.serialNo,
          macAddress: d.macAddress ?? '',
          extDeviceCode: d.extDeviceCode ?? '',
          usageTypeId: d.usageTypeId != null ? String(d.usageTypeId) : '',
          occurredOn: todayKst(),
        })
      })
      .catch((e) => alive && setError(errorMessage(e, '기기 정보를 불러오지 못했습니다.')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [open, device])

  const modelOptions = useMemo(() => {
    const opts = models.map((m) => ({ id: m.deviceInfoId, label: modelLabel(m.deviceName, m.deviceModel) }))
    const currentId = base?.deviceInfoId ?? device?.deviceInfoId ?? null
    if (currentId != null && !opts.some((o) => o.id === currentId)) {
      opts.unshift({ id: currentId, label: modelLabel(base?.deviceName ?? device?.deviceName, base?.deviceModel ?? device?.deviceModel) })
    }
    return opts
  }, [models, base, device])

  const normalized = useMemo(() => normalizeSerial(form.serialNo), [form.serialNo])
  const patternOk = useMemo(() => matchesSerialPattern(normalized.serialNo, base?.serialPattern), [normalized.serialNo, base?.serialPattern])
  const serialChanged = base != null && normalized.serialNo !== '' && normalized.serialNo !== base.serialNo
  const serialLocked = base != null && base.stateEventCount > 1

  const patch = useMemo<DevicePatchBody | null>(() => {
    if (!base) return null
    const out: DevicePatchBody = {}
    const modelId = Number(form.deviceInfoId)
    if (form.deviceInfoId && Number.isInteger(modelId) && modelId !== base.deviceInfoId) out.deviceInfoId = modelId
    if (serialChanged) out.serialNo = normalized.serialNo
    const mac = form.macAddress.trim()
    if ((mac || null) !== (base.macAddress ?? null)) out.macAddress = mac || null
    const ext = form.extDeviceCode.trim()
    if ((ext || null) !== (base.extDeviceCode ?? null)) out.extDeviceCode = ext || null
    const usage = form.usageTypeId ? Number(form.usageTypeId) : null
    if (usage !== (base.usageTypeId ?? null)) out.usageTypeId = usage
    return out
  }, [base, form, serialChanged, normalized.serialNo])

  const hasChanges = patch != null && Object.keys(patch).length > 0
  const occurredOnInvalid = form.occurredOn !== '' && (!isYmd(form.occurredOn) || isFutureYmd(form.occurredOn))

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!device || !base || !patch) return
    if (!hasChanges) {
      setError('변경 사항이 없습니다.')
      return
    }
    if (occurredOnInvalid) {
      setError('업무일자 형식이 잘못되었거나 미래 날짜입니다.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const body: DevicePatchBody = { ...patch }
      if (form.occurredOn && form.occurredOn !== todayKst()) body.occurredOn = form.occurredOn
      await patchDevice(device.id, body)
      const parts: string[] = []
      if (body.serialNo) parts.push(`${base.serialNo} → ${body.serialNo}`)
      if (body.deviceInfoId != null) {
        const m = modelOptions.find((o) => o.id === body.deviceInfoId)
        parts.push(`모델 → ${m?.label ?? body.deviceInfoId}`)
      }
      if ('macAddress' in body) parts.push(body.macAddress ? `MAC ${body.macAddress}` : 'MAC 삭제')
      if ('extDeviceCode' in body) parts.push(body.extDeviceCode ? `닉네임 ${body.extDeviceCode}` : '닉네임 삭제')
      if ('usageTypeId' in body) parts.push(body.usageTypeId == null ? '용도 미지정' : `용도 ${usageTypes?.find((u) => u.id === body.usageTypeId)?.name ?? body.usageTypeId}`)
      onDone({ message: `식별 정정: ${parts.length ? parts.join(' · ') : base.serialNo}`, openDeviceId: device.id })
    } catch (err) {
      setError(errorMessage(err, '정정에 실패했습니다.'))
    } finally {
      setSubmitting(false)
    }
  }

  const title = device ? `식별 정정 (관리) — ${device.serialNo}` : '식별 정정 (관리)'

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {!device ? (
        <p className="text-sm text-muted-foreground">정정할 기기가 지정되지 않았습니다.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4 text-sm">
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            식별 속성(모델·시리얼·MAC·닉네임·용도)의 <b>오타 보정</b>용입니다. CORRECT 이벤트로 기록되며 드로어에서 취소할 수 있습니다. 상태·병원·병동은 등록/이동/회수 이벤트로만 바뀝니다.
            {hospitalCode && base?.hospitalCode && base.hospitalCode !== hospitalCode && (
              <span className="mt-1 block text-warning-subtle-foreground">이 기기는 현재 선택한 병원({hospitalCode})이 아닌 {base.hospitalCode} 소속입니다.</span>
            )}
          </p>

          <div>
            <label htmlFor="corr-model" className="mb-1 block text-xs font-medium text-muted-foreground">
              모델
            </label>
            <Select id="corr-model" value={form.deviceInfoId} onChange={(e) => set('deviceInfoId', e.target.value)} disabled={loading || !base}>
              {modelOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label htmlFor="corr-serial" className="mb-1 block text-xs font-medium text-muted-foreground">
              시리얼
            </label>
            <Input
              id="corr-serial"
              value={form.serialNo}
              onChange={(e) => set('serialNo', e.target.value.toUpperCase())}
              disabled={loading || !base || serialLocked}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {serialLocked ? (
                <p className="flex items-start gap-1 text-warning-subtle-foreground">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  이력이 있는 개체(상태 이벤트 {base?.stateEventCount}건) — 시리얼은 정정할 수 없습니다. 오입력이면 이벤트 취소를 사용하세요.
                </p>
              ) : (
                <p>시리얼 정정은 이 병원 등록 1건만 있는 개체에서만 허용됩니다. 저장 키는 정규화(대문자·공백 제거·GW 합성 분해) 후 값입니다.</p>
              )}
              {serialChanged && normalized.serialRaw && (
                <p>
                  키 <span className="font-mono">{normalized.serialNo}</span> · 원문 <span className="font-mono">{normalized.serialRaw}</span>
                </p>
              )}
              {serialChanged && patternOk === false && (
                <p className="flex items-center gap-1 text-warning-subtle-foreground">
                  <AlertTriangle size={12} /> 모델 시리얼 형식과 일치하지 않습니다(경고만).
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="corr-mac" className="mb-1 block text-xs font-medium text-muted-foreground">
                MAC 주소
              </label>
              <Input id="corr-mac" value={form.macAddress} onChange={(e) => set('macAddress', e.target.value)} placeholder="08:D5:C0:…" disabled={loading || !base} className="font-mono" autoComplete="off" />
            </div>
            <div>
              <label htmlFor="corr-ext" className="mb-1 block text-xs font-medium text-muted-foreground">
                닉네임(온프렘 deviceCode)
              </label>
              <Input id="corr-ext" value={form.extDeviceCode} onChange={(e) => set('extDeviceCode', e.target.value)} placeholder="S12" disabled={loading || !base} autoComplete="off" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="corr-usage" className="mb-1 block text-xs font-medium text-muted-foreground">
                용도
              </label>
              <Select id="corr-usage" value={form.usageTypeId} onChange={(e) => set('usageTypeId', e.target.value)} disabled={loading || !base || usageTypes == null}>
                <option value="">미지정</option>
                {(usageTypes ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">판매용/평가용 — 평가용은 계약 대조에서 제외. 용도만 바꾸는 것은 USER 등급도 드로어에서 가능합니다.</p>
            </div>
          </div>

          <div className="sm:w-1/2">
            <label htmlFor="corr-date" className="mb-1 block text-xs font-medium text-muted-foreground">
              업무일자(정정 이벤트)
            </label>
            <Input id="corr-date" type="date" value={form.occurredOn} max={todayKst()} onChange={(e) => set('occurredOn', e.target.value)} disabled={loading || !base} className={cn(occurredOnInvalid && 'border-destructive')} />
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive-subtle px-3 py-2 text-xs text-destructive-subtle-foreground">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              취소
            </Button>
            <Button type="submit" size="sm" disabled={submitting || loading || !base || !hasChanges || occurredOnInvalid}>
              {submitting ? '저장 중…' : '정정 저장'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

export default CorrectionModal
