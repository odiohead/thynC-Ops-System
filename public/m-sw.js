/*
 * 모바일 앱(PWA) 서비스 워커 — scope '/m/' 전용 (projects/mobile_pwa_design.md §3.4)
 *
 * 하는 일: /m/* 문서 요청이 네트워크 실패·5xx 이면 캐시해 둔 오프라인 안내(/m-offline.html)를 대신 응답.
 * 하지 않는 일: API·데이터·정적 자원 캐시 — 재고·주차는 실시간 값이어야 한다(오래된 재고로 출고하는 사고 방지).
 * 사이니지 SW(/sw.js, scope '/dashboard')와 scope 가 겹치지 않는다.
 * 등록: app/m/_components/MobileShell.tsx
 */
const CACHE = 'thync-mobile-v1'
const OFFLINE_URL = '/m-offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('thync-mobile-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.mode !== 'navigate') return
  event.respondWith(
    fetch(req)
      .then((res) => (res.status >= 500 ? offlineResponse() : res))
      .catch(() => offlineResponse()),
  )
})

async function offlineResponse() {
  const cached = await caches.match(OFFLINE_URL)
  if (cached) return cached
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5">' +
      '<title>연결 대기</title><body style="font-family:sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;margin:0">' +
      '<p>서버에 연결할 수 없습니다. 5초 후 다시 시도합니다.</p></body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
