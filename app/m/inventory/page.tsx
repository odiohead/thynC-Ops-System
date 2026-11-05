'use client'

import { Boxes } from 'lucide-react'
import MobileHeader from '../_components/MobileHeader'
import { Notice } from '../_components/ui'
import { useMobileMe, hasInventoryMenu } from '../_components/useMobileMe'

/**
 * 모바일 자재관리 — 껍데기. 입고·출고·이동·시리얼 조회는 이 화면 진입 후 하위 메뉴로 재구성 예정
 * (프로토타입 /m/stock·/m/lookup 코드를 옮겨 올 자리). 노출은 재고담당·재고책임자 역할만.
 */
export default function MobileInventoryPage() {
  const { me, loading } = useMobileMe()
  const allowed = hasInventoryMenu(me)

  return (
    <>
      <MobileHeader title="자재관리" back />
      <main className="mx-auto max-w-lg p-4">
        {loading ? null : !allowed ? (
          <Notice tone="warning">자재관리는 재고담당·재고책임자 역할이 있는 사용자만 사용할 수 있습니다.</Notice>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
              <Boxes size={28} />
            </span>
            <p className="text-base font-semibold">준비 중입니다</p>
            <p className="text-sm text-muted-foreground">입고·출고·이동과 시리얼 조회가 이곳에 들어갑니다.</p>
          </div>
        )}
      </main>
    </>
  )
}
