import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const [items, settings] = await Promise.all([
    prisma.installPlanQueue.findMany({
      orderBy: { receivedAt: 'desc' },
      include: {
        installPlan: {
          select: { id: true, planCode: true },
        },
      },
    }),
    prisma.appSetting.findMany({
      where: { key: { in: ['mail_sync_interval', 'mail_sync_last_install_plan', 'mail_sync_last'] } },
    }),
  ])

  const syncInterval = settings.find((s) => s.key === 'mail_sync_interval')?.value || 'off'
  // 설치계획 전용 키 우선, 없으면 레거시 공용 키로 폴백
  const syncLast =
    settings.find((s) => s.key === 'mail_sync_last_install_plan')?.value ||
    settings.find((s) => s.key === 'mail_sync_last')?.value ||
    null

  return NextResponse.json({ items, syncInterval, syncLast })
}

export async function DELETE(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  const where = status && status !== 'all' ? { status } : {}

  // FK 해제 후 삭제
  await prisma.installPlanQueue.updateMany({
    where: { ...where, installPlanId: { not: null } },
    data: { installPlanId: null },
  })

  const { count } = await prisma.installPlanQueue.deleteMany({ where })

  return NextResponse.json({ success: true, deleted: count })
}
