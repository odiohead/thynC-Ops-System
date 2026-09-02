'use client'

/**
 * 'AS 표시' 소형 모달 (B-24) — 행 ⋯·드로어 [AS 표시](1대) / 선택 바 [AS 표시](여러 대)
 * ACTIVE 기기에 AS진행중 플래그를 켠다. 유지보수 코드는 선택 입력(MaintenanceCodeCombo — 업무일자 제안·`as_ref_code`).
 * 1대는 openDeviceAs(단건 audit), 여러 대는 bulkDeviceAction('AS_OPEN') — 같은 action_group·ref·업무일자를 공유하고
 * 이미 표시된 기기는 skipped[]. 교체·회수하면 자동 해제, 수동 해제는 [AS 해제].
 */
import { useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import { Textarea } from '@/app/components/ui/Input'
import { todayKst, type OccurredOnBasis } from '@/lib/deviceRegistryShared'
import { errorMessage, bulkDeviceAction, openDeviceAs } from './api'
import type { DeviceRef, MutationDone, RegistryRef } from './types'
import { FormField, ModalActions, Notice, OccurredOnField, isSubmitShortcut, useOccurredOn } from './registryFormKit'
import { MaintenanceCodeCombo } from './MaintenanceCodeCombo'

export interface AsFlagModalProps {
  open: boolean
  onClose: () => void
  /** 대상 — 1대(행 ⋯·드로어) 또는 선택 여러 대(선택 바). 행 정보 있는 것만(칩·현재 표기용) */
  devices: DeviceRef[]
  /** 전체 대상 id('검색 결과 전체 선택'의 행 없는 id 포함) */
  deviceIds: number[]
  /** MNT 콤보 병원 문맥 — 없으면 첫 대상의 병원 */
  hospitalCode?: string | null
  today: string | null
  note?: string | null
  onDone: (result: MutationDone) => void
}

export function AsFlagModal(props: AsFlagModalProps) {
  const { open, onClose, deviceIds, devices } = props
  const title = deviceIds.length === 1 && devices[0] ? `AS 표시 — ${devices[0].serialNo}` : `AS 표시 (${deviceIds.length.toLocaleString()}대)`
  return (
    <Modal open={open} onClose={onClose} title={title} widthClass="max-w-md">
      {open && deviceIds.length > 0 && <AsFlagForm {...props} />}
    </Modal>
  )
}

function AsFlagForm({ onClose, devices, deviceIds, hospitalCode, today: todayProp, note, onDone }: AsFlagModalProps) {
  const today = todayProp ?? todayKst()
  const occ = useOccurredOn(today)
  const [refCode, setRefCode] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const single = deviceIds.length === 1 ? devices[0] ?? null : null
  const mntHospital = hospitalCode ?? devices[0]?.hospitalCode ?? null
  const alreadyFlagged = devices.filter((d) => !!d.asStartedOn).length

  const onRefChange = (code: string | null, suggested: string | null, basis: OccurredOnBasis | null) => {
    setRefCode(code ?? '')
    if (code) occ.suggest(suggested, basis)
    else occ.suggest(null, null)
  }

  const canSubmit = !submitting && !occ.error && deviceIds.length > 0

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const ref: RegistryRef | null = refCode ? { type: 'MAINTENANCE', code: refCode } : null
    try {
      if (single) {
        const r = await openDeviceAs(single.id, { occurredOn: occ.value, memo: memo.trim() || null, ref })
        onDone({ message: `AS 표시: ${single.serialNo} (${occ.value}${refCode ? ` · ${refCode}` : ''})`, warnings: r.warnings })
      } else {
        const r = await bulkDeviceAction({
          action: 'AS_OPEN',
          deviceIds,
          ...(mntHospital ? { hospitalCode: mntHospital } : {}),
          occurredOn: occ.value,
          memo: memo.trim() || null,
          ref,
        })
        const warnings = [...r.warnings]
        if (r.skipped.length > 0) warnings.push(`이미 AS진행중 건너뜀: ${r.skipped.slice(0, 5).map((s) => s.serialNo).join(', ')}${r.skipped.length > 5 ? ' 외' : ''} (${r.skipped.length}대)`)
        onDone({ message: `AS 표시: ${r.affectedDeviceIds.length.toLocaleString()}대 (${occ.value}${refCode ? ` · ${refCode}` : ''})`, warnings })
      }
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
        {single ? (
          <>
            <span className="font-mono font-medium">{single.serialNo}</span>
            {single.wardName && <span className="text-muted-foreground"> · {single.wardName}</span>}
          </>
        ) : (
          <>
            선택 <b className="tabular-nums">{deviceIds.length.toLocaleString()}대</b>
            {alreadyFlagged > 0 && <span className="text-muted-foreground"> · 이미 AS진행중 {alreadyFlagged}대는 건너뜁니다</span>}
            {note && <span className="text-muted-foreground"> · {note}</span>}
          </>
        )}
        <div className="mt-1 text-muted-foreground">AS진행중은 배치 중(ACTIVE) 기기의 표시 플래그입니다 — 교체·회수를 기록하면 자동으로 해제됩니다.{!single && ' 유지보수 코드·업무일자는 전 대상에 함께 기록됩니다.'}</div>
      </Notice>

      <FormField label="유지보수 코드" htmlFor="as-ref" hint="선택 — 연결하면 업무일자를 제안값으로 채우고 드로어에서 MNT 링크로 보입니다">
        <MaintenanceCodeCombo id="as-ref" hospitalCode={mntHospital} value={refCode} onChange={onRefChange} disabled={submitting} />
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
          {submitting ? '기록 중…' : single ? 'AS 표시' : `AS 표시 (${deviceIds.length.toLocaleString()}대)`}
        </Button>
      </ModalActions>
    </div>
  )
}

export default AsFlagModal
