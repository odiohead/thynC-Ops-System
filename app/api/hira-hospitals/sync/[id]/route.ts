import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const jobId = parseInt(params.id)
  if (isNaN(jobId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const job = await prisma.hiraSyncJob.findUnique({
    where: { id: jobId },
    include: { logs: { orderBy: { createdAt: 'asc' } } },
  })

  if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ job })
}
