'use client'

import { Truck } from 'lucide-react'
import MobileHeader from '../_components/MobileHeader'

/** 모바일 출고요청 — 껍데기(요구사항 확정 후 구현). 전원 노출 */
export default function MobileStockOutRequestsPage() {
  return (
    <>
      <MobileHeader title="출고요청" back />
      <main className="mx-auto max-w-lg p-4">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
            <Truck size={28} />
          </span>
          <p className="text-base font-semibold">준비 중입니다</p>
          <p className="text-sm text-muted-foreground">출고요청 등록·진행 확인 기능이 이곳에 들어갑니다.</p>
          <a href="/stock-out-requests" className="mt-2 text-sm font-medium text-primary underline-offset-4 active:underline">
            PC 화면에서 출고요청 열기
          </a>
        </div>
      </main>
    </>
  )
}
