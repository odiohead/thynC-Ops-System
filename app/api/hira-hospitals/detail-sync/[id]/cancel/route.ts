import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { cancelDetailSyncJob } from '@/lib/hira-detail-sync'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

// POST — 진행/대기 중인 상세연동 요청 취소 (SUPER_ADMIN)
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const jobId = parseInt(params.id)
  if (isNaN(jobId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const result = await cancelDetailSyncJob(jobId)
  if (result === 'not_found') return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
  if (result === 'not_active') return NextResponse.json({ error: '진행 중이거나 대기 중인 요청만 취소할 수 있습니다.' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
