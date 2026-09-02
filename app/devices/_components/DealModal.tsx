'use client'

/**
 * 계약건(딜) 일괄 지정 모달 (B-23 — 선택 바 [계약건 지정]) — 소형
 * 대상 = 선택 기기(같은 병원 ACTIVE). 이 병원 계약완료 딜 목록 + '미지정으로' 선택 → bulkDeviceAction({ action:'SET_DEAL' })
 * → 기기마다 CORRECT 이벤트(changes.dealCode {before,after}), 이미 같은 값인 기기는 skipped[].
 * 상품유형과의 결합 검증은 없다(백필·정정 도구) — 불일치는 상단 계약별 표에서 드러난다.
 */
import { useMemo, useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import { Select, Textarea } from '@/app/components/ui/Input'
import { todayKst, toYmd } from '@/lib/deviceRegistryShared'
import { errorMessage, bulkDeviceAction } from './api'
import type { DeviceRef, MutationDone, SummaryDealRow } from './types'
import { FormField, ModalActions, Notice, OccurredOnField, isSubmitShortcut, useOccurredOn } from './registryFormKit'

export interface DealModalProps {
  open: boolean
  onClose: () => void
  hospitalCode: string
  /** 선택 기기(행 정보 있는 것) */
  devices: DeviceRef[]
  /** 선택 id 전체(전체 선택으로 들어온 행 없는 id 포함) */
  deviceIds: number[]
  /** 병원 계약건 현황(summary.deals) — 계약완료 딜만 선택지 */
  deals: SummaryDealRow[]
  today: string | null
  note?: string | null
  onDone: (result: MutationDone) => void
}

export function dealOptionLabel(d: SummaryDealRow): string {
  const ym = d.contractDate ? (toYmd(d.contractDate) ?? '').slice(0, 7) : null
  return `${d.dealCode} · ${d.roundNo != null ? `${d.roundNo}차` : ''}${ym ? ` ${ym}` : ''}${d.productType ? ` · ${d.productType}` : ''}${d.expected != null ? ` · ${d.expected.toLocaleString()}대` : ''}`
}

export function DealModal(props: DealModalProps) {
  const { open, onClose } = props
  return (
    <Modal open={open} onClose={onClose} title="계약건 지정" widthClass="max-w-md">
      {open && <DealForm {...props} />}
    </Modal>
  )
}

function DealForm({ onClose, hospitalCode, devices, deviceIds, deals, today: todayProp, note, onDone }: DealModalProps) {
  const today = todayProp ?? todayKst()
  const contracted = useMemo(() => deals.filter((d) => d.contracted), [deals])
  const [value, setValue] = useState<string>('')
  const [memo, setMemo] = useState('')
  const occ = useOccurredOn(today)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of devices) {
      const k = d.dealCode ?? '미지정'
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([k, n]) => `${k} ${n}`).join(' · ')
  }, [devices])

  const count = deviceIds.length
  const canSubmit = !submitting && count > 0 && !occ.error

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const r = await bulkDeviceAction({
        action: 'SET_DEAL',
        deviceIds,
        hospitalCode,
        dealCode: value === '' ? null : value,
        occurredOn: occ.value,
        memo: memo.trim() || null,
      })
      const warnings = [...r.warnings]
      if (r.skipped.length > 0) warnings.push(`이미 같은 계약건: ${r.skipped.slice(0, 5).map((s) => s.serialNo).join(', ')}${r.skipped.length > 5 ? ' 외' : ''} (${r.skipped.length}대)`)
      onDone({ message: `계약건 지정: ${value === '' ? '미지정' : value} ${r.affectedDeviceIds.length.toLocaleString()}대`, warnings })
    } catch (e) {
      setError(errorMessage(e, '계약건 지정에 실패했습니다.'))
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
        선택 <b className="tabular-nums">{count.toLocaleString()}대</b>
        {current && <span className="text-muted-foreground"> · 현재 {current}</span>}
        {note && <span className="text-muted-foreground"> · {note}</span>}
        <div className="mt-1 text-muted-foreground">계약건은 배치가 속한 딜의 소프트 참조입니다 — 기기마다 정정(CORRECT) 이벤트로 기록되고, 상단 계약별 표의 등록 수량에 반영됩니다.</div>
      </Notice>

      <FormField
        label="계약건"
        htmlFor="deal-select"
        required
        hint={contracted.length > 0 ? `계약완료 딜 ${contracted.length}건 — 교체 기기는 구 기기의 계약건을 자동 상속합니다` : '이 병원에 계약완료 딜이 없습니다 — 미지정만 가능'}
      >
        <Select id="deal-select" value={value} disabled={submitting} onChange={(e) => setValue(e.target.value)}>
          <option value="">미지정으로</option>
          {contracted.map((d) => (
            <option key={d.dealCode} value={d.dealCode}>
              {dealOptionLabel(d)}
            </option>
          ))}
        </Select>
      </FormField>

      <OccurredOnField id="deal-date" state={occ} today={today} disabled={submitting} label="업무일자(정정 이벤트)" />
      <FormField label="메모" htmlFor="deal-memo">
        <Textarea id="deal-memo" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={submitting} rows={2} className="min-h-0" placeholder="예: 2차 계약분 백필" />
      </FormField>

      {error && <Notice tone="error">{error}</Notice>}

      <ModalActions>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          취소
        </Button>
        <Button onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? '지정 중…' : `계약건 지정 (${count.toLocaleString()}대)`}
        </Button>
      </ModalActions>
    </div>
  )
}

export default DealModal
