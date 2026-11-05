import type { Metadata } from 'next'
import MobileShell from './_components/MobileShell'

/**
 * 모바일 앱(PWA) 셸 — projects/mobile_pwa_design.md
 * 데스크톱 Navigation·MainWrapper 는 /m/* 에서 렌더하지 않는다(전체화면 판정). 데이터는 전부 기존 API.
 */
export const metadata: Metadata = {
  title: 'thynC Ops',
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <MobileShell>{children}</MobileShell>
}
