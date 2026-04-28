import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const PAGE_SIZE_DEFAULT = 50

/** 감사 로그 목록 조회 (SUPER_ADMIN 전용) */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') ?? String(PAGE_SIZE_DEFAULT))))

  const actorId = searchParams.get('actorId')
  const actorEmail = searchParams.get('actorEmail')
  const action = searchParams.get('action')
  const resource = searchParams.get('resource')
  const resourceId = searchParams.get('resourceId')
  const search = searchParams.get('search') ?? ''
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const where: Prisma.AuditLogWhereInput = {
    ...(actorId && { actorId }),
    ...(actorEmail && { actorEmail: { contains: actorEmail, mode: 'insensitive' } }),
    ...(action && { action }),
    ...(resource && { resource }),
    ...(resourceId && { resourceId }),
    ...(from || to ? {
      createdAt: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      },
    } : {}),
    ...(search && {
      OR: [
        { actorName: { contains: search, mode: 'insensitive' } },
        { actorEmail: { contains: search, mode: 'insensitive' } },
        { resourceLabel: { contains: search, mode: 'insensitive' } },
        { resourceId: { contains: search, mode: 'insensitive' } },
      ],
    }),
  }

  const [logs, total, distinctResources, distinctActions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      distinct: ['resource'],
      select: { resource: true },
      orderBy: { resource: 'asc' },
    }),
    prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    }),
  ])

  return NextResponse.json({
    logs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    facets: {
      resources: distinctResources.map((r) => r.resource),
      actions: distinctActions.map((a) => a.action),
    },
  })
}
