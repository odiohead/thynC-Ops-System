import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Params = { params: { id: string } }

export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.task.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Task를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const { isCompleted } = body

  if (typeof isCompleted !== 'boolean') {
    return NextResponse.json({ error: 'isCompleted는 boolean이어야 합니다.' }, { status: 400 })
  }

  const task = await prisma.task.update({
    where: { id },
    data: {
      isCompleted,
      completedAt: isCompleted ? new Date() : null,
    },
  })

  // 업무현황 완료 체크박스는 Task.isCompleted 플래그만 토글하며 원본 업무의 상태값을 바꾸지 않으므로
  // Slack 상태변경 알림 대상이 아니다(상태 알림은 각 업무 상세의 상태 변경에서 발송).

  return NextResponse.json({ task })
}
