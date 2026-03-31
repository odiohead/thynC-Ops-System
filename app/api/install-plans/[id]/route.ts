import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

interface Params { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  const installPlan = await prisma.installPlan.findUnique({
    where: { id },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      author: { select: { id: true, name: true } },
    },
  })

  if (!installPlan) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ installPlan })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  const body = await request.json()
  const { hospitalCode, requestDate, writeStatus, replyStatus, authorId, replyDate, note } = body

  const installPlan = await prisma.installPlan.update({
    where: { id },
    data: {
      hospitalCode: hospitalCode || null,
      requestDate: requestDate ? new Date(requestDate) : null,
      writeStatus: writeStatus ?? '-',
      replyStatus: replyStatus ?? '-',
      authorId: authorId || null,
      replyDate: replyDate ? new Date(replyDate) : null,
      note: note || null,
      updatedAt: new Date(),
    },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      author: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ installPlan })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(authUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  await prisma.installPlan.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
