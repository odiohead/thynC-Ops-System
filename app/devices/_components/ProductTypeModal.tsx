'use client'

/**
 * 상품유형 일괄 지정 모달 (B-22 — 선택 바 [상품유형 지정]) — 소형
 * 대상 = 선택 기기(같은 병원 ACTIVE). 일반/라이트(또는 미지정으로) 선택 → bulkDeviceAction({ action:'SET_PRODUCT_TYPE' })
 * → 기기마다 CORRECT 이벤트(changes.productType {before,after}), 이미 같은 값인 기기는 skipped[].
 * 성공 → onDone({ message:'상품유형 지정: 라이트 12대', warnings })
 */
import { useMemo, useState } from 'react'
import Modal from '@/app/components/ui/Modal'
import Button from '@/app/components/ui/Button'
import { Textarea } from '@/app/components/ui/Input'
import { cn } from '@/lib/cn'
import { PRODUCT_TYPES, PRODUCT_TYPE_UNSET_LABEL, todayKst, type ProductType, type ProductTypeContext } from '@/lib/deviceRegistryShared'
import { errorMessage, bulkDeviceAction } from './api'
import type { DeviceRef, MutationDone } from './types'
import { FormField, ModalActions, Notice, OccurredOnField, isSubmitShortcut, useOccurredOn } from './registryFormKit'

export interface ProductTypeModalProps {
  open: boolean
  onClose: () => void
  hospitalCode: string
  /** 선택 기기(행 정보 있는 것) */
  devices: DeviceRef[]
  /** 선택 id 전체(전체 선택으로 들어온 행 없는 id 포함) */
  deviceIds: number[]
  /** 병원 딜 문맥 — 라벨('계약 딜: 일반 60') */
  context?: ProductTypeContext | null
  today: string | null
  note?: string | null
  onDone: (result: MutationDone) => void
}

export function ProductTypeModal(props: ProductTypeModalProps) {
  const { open, onClose } = props
  return (
    <Modal open={open} onClose={onClose} title="상품유형 지정" widthClass="max-w-md">
      {open && <ProductTypeForm {...props} />}
    </Modal>
  )
}

function ProductTypeForm({ onClose, hospitalCode, devices, deviceIds, context, today: todayProp, note, onDone }: ProductTypeModalProps) {
  const today = todayProp ?? todayKst()
  const [value, setValue] = useState<ProductType | ''>(context?.default ?? '')
  const [memo, setMemo] = useState('')
  const occ = useOccurredOn(today)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of devices) {
      const k = d.productType ?? PRODUCT_TYPE_UNSET_LABEL
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
        action: 'SET_PRODUCT_TYPE',
        deviceIds,
        hospitalCode,
        productType: value === '' ? null : value,
        occurredOn: occ.value,
        memo: memo.trim() || null,
      })
      const warnings = [...r.warnings]
      if (r.skipped.length > 0) warnings.push(`이미 같은 상품유형: ${r.skipped.slice(0, 5).map((s) => s.serialNo).join(', ')}${r.skipped.length > 5 ? ' 외' : ''} (${r.skipped.length}대)`)
      onDone({ message: `상품유형 지정: ${value === '' ? PRODUCT_TYPE_UNSET_LABEL : value} ${r.affectedDeviceIds.length.toLocaleString()}대`, warnings })
    } catch (e) {
      setError(errorMessage(e, '상품유형 지정에 실패했습니다.'))
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
        <div className="mt-1 text-muted-foreground">상품유형은 자리의 판매 조건(배치 속성)입니다 — 기기마다 정정(CORRECT) 이벤트로 기록되며 계약 대조 매트릭스에 반영됩니다.</div>
      </Notice>

      <FormField
        label="상품유형"
        required
        hint={
          context && context.byType.length > 0
            ? `계약완료 딜: ${context.byType.map((b) => `${b.type} ${b.devices.toLocaleString()}대(${b.deals}건)`).join(' · ')}${context.mixed ? ' — 혼합 병원' : ''}`
            : '이 병원에 계약완료 딜이 없습니다 — 미지정도 가능'
        }
      >
        <div role="radiogroup" aria-label="상품유형" className="flex flex-wrap gap-2">
          {[...PRODUCT_TYPES, '' as const].map((pt) => {
            const active = value === pt
            const label = pt === '' ? `${PRODUCT_TYPE_UNSET_LABEL}으로` : pt
            return (
              <button
                key={pt || 'unset'}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={submitting}
                onClick={() => setValue(pt)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm transition-colors',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-accent',
                  pt === '' && !active && 'text-muted-foreground'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </FormField>

      <OccurredOnField id="pt-date" state={occ} today={today} disabled={submitting} label="업무일자(정정 이벤트)" />
      <FormField label="메모" htmlFor="pt-memo">
        <Textarea id="pt-memo" value={memo} onChange={(e) => setMemo(e.target.value)} disabled={submitting} rows={2} className="min-h-0" placeholder="예: 라이트 딜 2차 분 재분류" />
      </FormField>

      {error && <Notice tone="error">{error}</Notice>}

      <ModalActions>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          취소
        </Button>
        <Button onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? '지정 중…' : `상품유형 지정 (${count.toLocaleString()}대)`}
        </Button>
      </ModalActions>
    </div>
  )
}

export default ProductTypeModal
