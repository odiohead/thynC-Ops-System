'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ScanSearch } from 'lucide-react'
import MobileHeader from '../_components/MobileHeader'
import { MButton, Notice, Segmented } from '../_components/ui'
import { useMobileMe, useCanManageStock } from '../_components/useMobileMe'
import { type TxType, type TxDoneInfo, TX_LABEL, TxDone, useStockMasters } from './shared'
import ScanOutFlow from './ScanOutFlow'
import QtyOutFlow from './QtyOutFlow'
import InFlow from './InFlow'

/**
 * 모바일 자재 입출고 (mobile_pwa_design.md §6) — 전표는 기존 POST /api/inventory/transactions.
 * 출고·이동: 시리얼은 스캔 먼저 / 수량 품목은 선택. 입고: 품목 먼저.
 * 처리 권한(재고 담당자·ADMIN·RBAC inventory.manage/admin)이 없으면 조회 전용 안내.
 */
export default function MobileStockPage() {
  const { me } = useMobileMe()
  const canManage = useCanManageStock()
  const masters = useStockMasters()
  const [txType, setTxType] = useState<TxType>('OUT')
  const [kind, setKind] = useState<'scan' | 'qty'>('scan')
  const [done, setDone] = useState<TxDoneInfo | null>(null)
  // 흐름 컴포넌트를 새로 마운트해 상태를 비우는 키 (새 전표·유형 전환)
  const [flowKey, setFlowKey] = useState(0)

  const requesterName = me?.name ?? ''

  function switchType(t: TxType) {
    setTxType(t)
    setDone(null)
    setFlowKey((k) => k + 1)
  }

  return (
    <>
      <MobileHeader title="자재 입출고" />
      <main className="mx-auto max-w-lg space-y-4 p-4">
        {canManage === null || !masters.loaded || !me ? (
          <p className="px-1 text-sm text-muted-foreground">불러오는 중…</p>
        ) : !canManage ? (
          <>
            <Notice>
              입고·출고·이동은 재고 담당자 또는 관리자만 처리할 수 있습니다. 개체 위치·상태는 시리얼 조회에서 확인하세요.
            </Notice>
            <Link href="/m/lookup"><MButton size="lg" className="w-full"><ScanSearch size={22} /> 시리얼 조회</MButton></Link>
          </>
        ) : done ? (
          <TxDone tx={done} onNew={() => { setDone(null); setFlowKey((k) => k + 1) }} />
        ) : (
          <>
            <Segmented<TxType>
              value={txType}
              onChange={switchType}
              options={(['OUT', 'IN', 'MOVE'] as TxType[]).map((t) => ({ value: t, label: TX_LABEL[t] }))}
            />
            {txType !== 'IN' && (
              <div className="flex justify-center gap-4 text-sm">
                {(['scan', 'qty'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => { setKind(k); setFlowKey((x) => x + 1) }}
                    className={kind === k ? 'font-semibold text-primary underline underline-offset-4' : 'text-muted-foreground'}
                  >
                    {k === 'scan' ? '시리얼 품목 (스캔)' : '수량 품목'}
                  </button>
                ))}
              </div>
            )}
            {txType === 'IN' ? (
              <InFlow key={`in-${flowKey}`} masters={masters} requesterName={requesterName} onDone={setDone} />
            ) : kind === 'scan' ? (
              <ScanOutFlow key={`${txType}-scan-${flowKey}`} txType={txType} masters={masters} requesterName={requesterName} onDone={setDone} />
            ) : (
              <QtyOutFlow key={`${txType}-qty-${flowKey}`} txType={txType} masters={masters} requesterName={requesterName} onDone={setDone} />
            )}
          </>
        )}
      </main>
    </>
  )
}
