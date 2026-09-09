'use client'

/**
 * 사이니지 자동 복구·주기 리프레시 훅 — /dashboard 전용
 *
 * 3중 구조:
 *  1) 서비스 워커(/sw.js, scope '/dashboard') 등록
 *     → 서버 다운 중 문서 로드가 실패하면 브라우저 오류 화면 대신 폴백 페이지(/dashboard-offline.html)를 띄우고,
 *       그 페이지가 /api/health 폴링 후 복구 시 원래 URL을 다시 연다. (JS가 사라지는 "페이지를 열 수 없음" 상태 자체를 차단)
 *  2) 페이지 내 워치독
 *     → 데이터 폴링이 전부 실패하면 disconnected=true (오버레이 표시) + 5초마다 /api/health 확인, 복구되면 location.reload()
 *  3) 주기 전체 리로드(기본 2분)
 *     → 새 배포 코드 반영·메모리 누수 방지. 리로드 직전 /api/health 를 확인해 서버가 죽어 있으면 리로드하지 않고 2)로 전환
 *       (리로드 순간 서버가 죽더라도 1)이 받아준다)
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const HEALTH_URL = '/api/health'
const RECOVER_POLL_MS = 5_000

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

export function useSignageKeepAlive(reloadMs: number) {
  const [disconnected, setDisconnected] = useState(false)
  const [swReady, setSwReady] = useState(false)
  const reloading = useRef(false)

  const reloadPage = useCallback(() => {
    if (reloading.current) return
    reloading.current = true
    window.location.reload()
  }, [])

  /* 1) 서비스 워커 등록 (HTTPS 또는 localhost 에서만 동작) */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/dashboard' })
      .then(() => setSwReady(true))
      .catch(() => setSwReady(false))
  }, [])

  /* 3) 주기 전체 리로드 — 직전 health 확인 */
  useEffect(() => {
    const t = setTimeout(async () => {
      if (await isHealthy()) reloadPage()
      else setDisconnected(true)
    }, reloadMs)
    return () => clearTimeout(t)
  }, [reloadMs, reloadPage])

  /* 2) 끊김 상태 → 5초마다 health 폴링, 복구 시 리로드 */
  useEffect(() => {
    if (!disconnected) return
    const t = setInterval(async () => {
      if (await isHealthy()) reloadPage()
    }, RECOVER_POLL_MS)
    return () => clearInterval(t)
  }, [disconnected, reloadPage])

  /* 페이지가 데이터 폴링 전부 실패를 감지했을 때 호출 */
  const reportFailure = useCallback(() => setDisconnected(true), [])

  return { disconnected, swReady, reportFailure }
}
