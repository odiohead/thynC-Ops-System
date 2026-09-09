/*
 * 사이니지 대시보드 서비스 워커 — scope '/dashboard' 전용
 *
 * 목적: 서버 재시작(빌드·PM2) 중 브라우저가 /dashboard 를 (재)로드했을 때
 *       "페이지를 열 수 없음" / Nginx 502 화면에 갇히지 않도록,
 *       네트워크 실패·5xx 응답이면 캐시해 둔 오프라인 폴백 페이지를 대신 응답한다.
 *       폴백 페이지는 /api/health 를 폴링하다 서버가 살아나면 스스로 원래 URL을 다시 연다.
 *
 * 범위: navigation 요청(문서 로드)만 개입. API·정적 자원은 그대로 통과.
 * 등록: app/dashboard/page.tsx 의 useSignageKeepAlive 훅 (scope: '/dashboard')
 */
const CACHE = 'thync-signage-v1'
const OFFLINE_URL = '/dashboard-offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.mode !== 'navigate') return
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Nginx 502/503/504 (앱 프로세스 다운) 도 오프라인으로 간주
        if (res.status >= 500) return offlineResponse()
        return res
      })
      .catch(() => offlineResponse()),
  )
})

async function offlineResponse() {
  const cached = await caches.match(OFFLINE_URL)
  if (cached) return cached
  // 캐시가 없는 극단 상황 — 최소 폴백 (자기 자신을 5초 후 재시도)
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>서버 연결 대기</title>' +
      '<body style="font-family:sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;margin:0;background:#0a0f1c;color:#e2e8f0">' +
      '<p>서버 연결 대기 중… 5초 후 재시도합니다.</p></body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
