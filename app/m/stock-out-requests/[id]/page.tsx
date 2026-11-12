'use client'

/** 모바일 출고요청 상세 — 읽기 전용 (수정·처리는 PC). projects/stock_out_sales_request_design.md §6 */
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import MobileHeader from '../../_components/MobileHeader'
import { Notice, Section } from '../../_components/ui'
import { STOCK_OUT_PURPOSE_LABELS, subPurposeLabel, stockOutDestName, type StockOutPurpose } from '@/lib/stockOutShared'
import { StatusPill, type MobileStockOutRow } from '../_shared'

interface Detail extends MobileStockOutRow {
  shipAddress: string | null
  recipient: string | null
  note: string | null
  fulfilledAt: string | null
  createdBy: { name: string } | null
  ticket: { ticketCode: string; owner: { name: string } | null } | null
  /** 시스템 구성품 합계·미출고 (2026-11-12) */
  components?: { itemId: number; quantity: number; unshippedQuantity: number; item: { name: string } }[]
}


export default function MobileStockOutRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [r, setR] = useState<Detail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/stock-out-requests/${id}`, { cache: 'no-store' })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error ?? '불러오지 못했습니다.')
        setR(d.stockOutRequest)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">{value || '-'}</dd>
    </>
  )

  return (
    <>
      <MobileHeader title={r?.sorCode ?? '출고요청'} back />
      <main className="mx-auto max-w-lg space-y-4 p-4">
        {error && <Notice tone="error">{error}</Notice>}
        {r && (
          <>
            <Section title={<span className="flex items-center gap-2">{r.project ? r.project.projectName : STOCK_OUT_PURPOSE_LABELS[r.purpose as StockOutPurpose] ?? r.purpose} <StatusPill status={r.status} /></span>}>
              <dl className="grid grid-cols-[5.5rem_1fr] gap-y-2 text-sm">
                {!r.project && row('목적', subPurposeLabel(r.purpose, r.subPurpose))}
                {!r.project && row(r.destType === 'OTHER' ? '납품처(기타)' : '납품처', stockOutDestName(r))}
                {row('수령지', r.shipAddress)}
                {row('수취인', r.recipient)}
                {row('희망 출고일', r.requestDate.slice(0, 10))}
                {row('요청자', r.createdBy?.name)}
                {row('담당', r.ticket?.owner?.name ?? '미배정')}
                {r.fulfilledAt && row('출고 처리', new Date(r.fulfilledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))}
              </dl>
            </Section>

            <Section title="품목">
              <ul className="divide-y divide-border">
                {r.items.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{l.item.modelName || l.item.name}</span>
                      {l.item.modelName && <span className="block truncate text-xs text-muted-foreground">{l.item.name}</span>}
                    </span>
                    <span className="shrink-0 font-semibold">{l.quantity}</span>
                  </li>
                ))}
              </ul>
            </Section>

            {/* 시스템 구성품 합계·미출고 (2026-11-12) */}
            {!!r.components?.length && (
              <Section title="시스템 구성품">
                <ul className="divide-y divide-border">
                  {r.components.map((c) => (
                    <li key={c.itemId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{c.item.name}</span>
                      <span className="shrink-0">
                        <span className="font-semibold">{c.quantity}</span>
                        {c.unshippedQuantity > 0 && <span className="ml-2 text-xs font-medium text-amber-700">미출고 {c.unshippedQuantity}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {r.note && (
              <Section title="비고">
                <p className="whitespace-pre-wrap text-sm">{r.note}</p>
              </Section>
            )}

            <a href={`/stock-out-requests/${r.id}`} className="flex items-center justify-center gap-1 py-2 text-sm text-primary">
              PC 화면에서 보기 <ExternalLink size={14} />
            </a>
          </>
        )}
      </main>
    </>
  )
}
