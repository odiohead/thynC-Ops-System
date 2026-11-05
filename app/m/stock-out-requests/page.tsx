'use client'

/**
 * 모바일 출고요청 — 내가 등록한 영업 유형 출고요청 목록 + [새 출고요청] (projects/stock_out_sales_request_design.md §6)
 * 처리(출고)는 자재 담당자가 PC에서. 목록은 진행 상태 확인용.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Plus } from 'lucide-react'
import MobileHeader from '../_components/MobileHeader'
import { Notice } from '../_components/ui'
import { useMobileMe } from '../_components/useMobileMe'
import { stockOutTitle } from '@/lib/stockOutShared'
import { StatusPill, itemsLine, type MobileStockOutRow } from './_shared'

export default function MobileStockOutRequestsPage() {
  const { me } = useMobileMe()
  const [rows, setRows] = useState<MobileStockOutRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/stock-out-requests?createdById=me&purpose=SALES_TYPES&pageSize=30', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error()
        setRows((await r.json()).requests ?? [])
      })
      .catch(() => { setRows([]); setError('목록을 불러오지 못했습니다.') })
  }, [])

  return (
    <>
      <MobileHeader title="출고요청" />
      <main className="mx-auto max-w-lg space-y-4 p-4">
        {me?.role !== 'VIEWER' && (
          <Link href="/m/stock-out-requests/new" className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground active:bg-primary-hover">
            <Plus size={20} /> 새 출고요청
          </Link>
        )}

        <div>
          <p className="mb-2 px-1 text-sm font-semibold text-muted-foreground">내 출고요청</p>
          {error && <Notice tone="error">{error}</Notice>}
          {rows === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">등록한 출고요청이 없습니다</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/m/stock-out-requests/${r.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 active:bg-accent">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold">{stockOutTitle(r)}</span>
                        <StatusPill status={r.status} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{itemsLine(r.items)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">희망 {r.requestDate.slice(0, 10)} · {r.sorCode}</p>
                    </div>
                    <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  )
}
