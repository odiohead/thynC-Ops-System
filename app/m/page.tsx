import { redirect } from 'next/navigation'

// 앱 범위가 '/m/'(슬래시 포함)라 홈은 /m/home — /m 은 리다이렉트만 (mobile_pwa_design.md §3.3)
export default function MobileIndex() {
  redirect('/m/home')
}
