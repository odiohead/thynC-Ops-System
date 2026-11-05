import type { MetadataRoute } from 'next'

/**
 * 모바일 앱(PWA) manifest — projects/mobile_pwa_design.md §3.3·§4.1
 * scope 는 반드시 '/m/'(슬래시 포함) — '/m' 이면 문자열 접두 일치로 '/maintenances' 까지 앱 범위가 된다.
 * 그래서 홈도 '/m/home'. 데스크톱 화면은 앱 범위 밖(링크로 열면 브라우저 바가 붙음).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/m/home',
    name: 'thynC Ops',
    short_name: 'thynC Ops',
    description: 'thynC 운영관리 모바일 — 주차 등록 · 자재 입출고 · 시리얼 조회',
    start_url: '/m/home',
    scope: '/m/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8fafc',
    theme_color: '#2C5CE5',
    lang: 'ko',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '주차등록', url: '/m/parking', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: '출고요청', url: '/m/stock-out-requests', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
