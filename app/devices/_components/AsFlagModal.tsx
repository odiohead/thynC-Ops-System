'use client'

/**
 * 'AS 표시' 소형 모달 (B-24) — 행 ⋯ 메뉴 [AS 표시]
 * ACTIVE 기기 1대에 AS진행중 플래그를 켠다(openDeviceAs → AS_OPEN 이벤트). 유지보수 코드는 선택 입력(MaintenanceCodeCombo —
 * 선택 시 업무일자 제안·`as_ref_code`로 기록). 교체·회수하면 자동 해제되고, 수동 해제는 행 ⋯ [AS 해제].
 */
import { useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import { Textarea } from '@/app/components/ui/Input'
import { todayKst, type OccurredOnBasis } from '@/lib/deviceRegistryShared'
import { errorMessage, openDeviceAs } from './api'
import type { DeviceRef, MutationDone, RegistryRef } from './types'
import { FormField, ModalActions, Notice, OccurredOnField, isSubmitShortcut, useOccurredOn } from './registryFormKit'
import { MaintenanceCodeCombo } from './MaintenanceCodeCombo'

export interface AsFlagModalProps {
  open: boolean
  onClose: () => void
  device: DeviceRef | null
  today: string | null
  onDone: (result: MutationDone) => void
}

export function AsFlagModal(props: AsFlagModalProps) {
  const { open, onClose, device } = props
  return (
    <Modal open={open} onClose={onClose} title={device ? `AS 표시 — ${device.serialNo}` : 'AS 표시'} widthClass="max-w-md">
      {open && device && <AsFlagForm {...props} device={device} />}
    </Modal>
  )
}

function AsFlagForm({ onClose, device, today: todayProp, onDone }: AsFlagModalProps & { device: DeviceRef }) {
  const today = todayProp ?? todayKst()
  const occ = useOccurredOn(today)
  const [refCode, setRefCode] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRefChange = (code: string | null, suggested: string | null, basis: OccurredOnBasis | null) => {
    setRefCode(code ?? '')
    if (code) occ.suggest(suggested, basis)
    else occ.suggest(null, null)
  }

  const canSubmit = !submitting && !occ.error

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const ref: RegistryRef | null = refCode ? { type: 'MAINTENANCE', code: refCode } : null
    try {
      const r = await openDeviceAs(device.id, { occurredOn: occ.value, memo: memo.trim() || null, ref })
      onDone({ message: `AS 표시: ${device.serialNo} (${occ.value}${refCode ? ` · ${refCode}` : ''})`, warnings: r.warnings })
    } catch (e) {
      setError(errorMessage(e, 'AS 표시에 실패했습니다.'))
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
      <Notice tone="info">
        <span className="font-mono font-medium">{device.serialNo}</span>
        {device.wardName && <span className="text-muted-foreground"> · {device.wardName}</span>}
        <div className="mt-1 text-muted-foreground">AS진행중은 배치 중(ACTIVE) 기기의 표시 플래그입니다 — 교체·회수를 기록하면 자동으로 해제됩니다.</div>
      </Notice>

      <FormField label="유지보수 코드" htmlFor="as-ref" hint="선택 — 연결하면 업무일자를 제안값으로 채우고 드로어에서 MNT 링크로 보입니다">
        <MaintenanceCodeCombo id="as-ref" hospitalCode={device.hospitalCode} value={refCode} onChange={onRefChange} disabled={submitting} />
      </FormField>
      <OccurredOnField id="as-date" state={occ} today={today} disabled={submitting} label="AS 시작일(업무일자)" />
      <FormField label="메모" htmlFor="as-memo">
        <Textarea id="as-memo" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={submitting} rows={2} className="min-h-0" placeholder="예: 화면 불량 접수 — 교체 대기" />
      </FormField>

      {error && <Notice tone="error">{error}</Notice>}

      <ModalActions>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          취소
        </Button>
        <Button onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? '기록 중…' : 'AS 표시'}
        </Button>
      </ModalActions>
    </div>
  )
}

export default AsFlagModal
