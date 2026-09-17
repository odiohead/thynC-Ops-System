import { NextResponse } from 'next/server'
import { DEVICE_EVENT_TYPES } from '@/lib/deviceRegistryShared'

export const dynamic = 'force-dynamic'

/**
 * 빌드 커밋 — `next.config.mjs`의 `env.GIT_COMMIT`(빌드 시 `git rev-parse --short HEAD`를 번들에 인라인)·VERCEL_GIT_COMMIT_SHA, 없으면 null.
 * 런타임 env가 아니라 번들에 박힌 값이라 재시작 누락(디스크 소스 ≠ 실행 중 빌드)을 드러낸다 — 백필 스크립트의 실행 중 서버 가드용(P2 리뷰 2026-09-17)
 */
const BUILD_COMMIT = process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null

/**
 * GET /api/health — 무인증 생존 확인 (사이니지 /dashboard 자동 복구 폴링용)
 * DB를 건드리지 않고 앱 프로세스 응답 여부만 알린다. middleware 공개 경로.
 * `eventTypes`·`buildCommit`(2026-09-17 device_condition_location_design.md A.0): 백필 `scripts/backfill-device-condition.mts --apply`가
 * 실행 중 서버가 신규 이벤트 어휘(INTAKE 포함)를 아는 빌드인지 확인한다(tsx는 디스크 소스를 읽어 상수 검사만으로는 재시작 누락을 못 잡음).
 */
export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now(), eventTypes: DEVICE_EVENT_TYPES, buildCommit: BUILD_COMMIT }, { headers: { 'Cache-Control': 'no-store' } })
}
