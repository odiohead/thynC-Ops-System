/**
 * 채널톡 동기화 즉시 실행 — ADMIN 이상. body { mode: 'incremental' | 'backfill' | 'rescan' } (rescan = 종료 상담 전량 재검사 강제)
 * incremental은 동기 실행(수 초), backfill은 틱당 호출 상한만큼 진행하고 반환(커서 저장 — 스케줄러가 켜져 있으면 자동으로 이어감, 아니면 다시 클릭)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { ChanneltalkClient } from '@/lib/channeltalk/client'
import { runChanneltalkVocSync, isChanneltalkVocSyncRunning } from '@/lib/channeltalk/vocSync'

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  if (!ChanneltalkClient.isConfigured()) return NextResponse.json({ error: '채널톡 API 키가 설정되지 않았습니다 (.env CHANNELTALK_ACCESS_KEY / CHANNELTALK_ACCESS_SECRET)' }, { status: 400 })
  if (isChanneltalkVocSyncRunning()) return NextResponse.json({ error: '동기화가 이미 진행 중입니다' }, { status: 409 })
  const body = await request.json().catch(() => ({}))
  const mode = body.mode === 'backfill' ? 'backfill' : 'manual'
  const result = await runChanneltalkVocSync(mode, { forceFullRescan: body.mode === 'rescan' })
  return NextResponse.json(result, { status: result.error ? 500 : 200 })
}
