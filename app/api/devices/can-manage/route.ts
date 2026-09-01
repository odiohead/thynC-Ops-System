import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getDeviceRegistryCapabilities } from '@/lib/deviceRegistryAccess'

export const dynamic = 'force-dynamic'

/** UI 게이트 프로브 — `{ canWrite, canAdmin }` (§6.1 가시성 · §8.1). 로그인 전체 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  return NextResponse.json(await getDeviceRegistryCapabilities(user))
}
