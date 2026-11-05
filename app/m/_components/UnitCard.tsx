'use client'

import { cn } from '@/lib/cn'
import { type LookupUnit, UNIT_STATUS_LABEL, unitWhere } from './stockApi'

const STATUS_CLS: Record<string, string> = {
  IN_STOCK: 'bg-success-subtle text-success',
  OUT: 'bg-primary-subtle text-primary',
  DISPOSED: 'bg-muted text-muted-foreground',
}

/** 시리얼 개체 카드 — 조회·선택 공용 */
export default function UnitCard({ unit, onClick, active }: { unit: LookupUnit; onClick?: () => void; active?: boolean }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'block w-full rounded-xl border bg-card p-3 text-left',
        active ? 'border-primary ring-2 ring-primary/20' : 'border-border',
        onClick && 'active:bg-accent'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-base font-semibold">{unit.serialNo}</p>
          <p className="truncate text-sm text-foreground">{unit.item.name}{unit.item.modelName ? <span className="text-muted-foreground"> · {unit.item.modelName}</span> : null}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_CLS[unit.status] ?? 'bg-muted text-muted-foreground')}>
          {UNIT_STATUS_LABEL[unit.status] ?? unit.status}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[4.5rem_1fr] gap-y-0.5 text-sm">
        <dt className="text-muted-foreground">인벤토리</dt><dd className="truncate">{unit.inventory.name}</dd>
        <dt className="text-muted-foreground">{unit.status === 'OUT' ? '출고처' : '위치'}</dt><dd className="truncate">{unitWhere(unit)}</dd>
        {unit.lotNo && (<><dt className="text-muted-foreground">LOT</dt><dd className="truncate font-mono">{unit.lotNo}</dd></>)}
        {unit.tags.length > 0 && (<><dt className="text-muted-foreground">태그</dt><dd className="truncate">{unit.tags.join(', ')}</dd></>)}
      </dl>
    </Tag>
  )
}
