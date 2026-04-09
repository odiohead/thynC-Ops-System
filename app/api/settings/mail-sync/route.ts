import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { startScheduler, getCurrentInterval } from '@/lib/mail-scheduler'

const VALID_INTERVALS = ['30m', '1h', '2h', '6h', 'off']

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const setting = await prisma.appSetting.findUnique({
    where: { key: 'mail_sync_interval' },
  })

  return NextResponse.json({
    interval: setting?.value || 'off',
    activeInterval: getCurrentInterval(),
  })
}

export async function PUT(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const body = await request.json()
  const { interval } = body

  if (!interval || !VALID_INTERVALS.includes(interval)) {
    return NextResponse.json(
      { error: `interval은 ${VALID_INTERVALS.join(', ')} 중 하나여야 합니다.` },
      { status: 400 }
    )
  }

  await prisma.appSetting.upsert({
    where: { key: 'mail_sync_interval' },
    update: { value: interval },
    create: { key: 'mail_sync_interval', value: interval },
  })

  startScheduler(interval)

  return NextResponse.json({ interval, message: '설정이 저장되었습니다.' })
}
