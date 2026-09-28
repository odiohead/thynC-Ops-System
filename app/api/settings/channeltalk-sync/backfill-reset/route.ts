/** 백필 커서 초기화 (처음부터 다시) — ADMIN 이상. 데이터는 upsert라 삭제되지 않음 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { resetChanneltalkBackfill, isChanneltalkVocSyncRunning } from '@/lib/channeltalk/vocSync'

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  if (isChanneltalkVocSyncRunning()) return NextResponse.json({ error: '동기화가 진행 중입니다. 끝난 뒤 다시 시도하세요' }, { status: 409 })
  await resetChanneltalkBackfill()
  return NextResponse.json({ ok: true })
}
