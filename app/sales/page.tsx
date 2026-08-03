import { redirect } from 'next/navigation'

/**
 * 영업현황 모듈 루트 — 메인 화면은 대시보드 A(실적).
 * 구 차수 원장 화면은 2026-08-03 폐기되어 기존 북마크·링크를 여기로 넘긴다.
 */
export default function SalesRootPage() {
  redirect('/sales/dashboard')
}
