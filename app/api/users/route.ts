import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const orgCode = searchParams.get('organization')
  const search = searchParams.get('search') ?? ''
  const pageParam = searchParams.get('page')
  const limitParam = searchParams.get('limit')

  const where = {
    ...(orgCode && { organization: { code: orgCode } }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
  }

  const select = {
    id: true,
    email: true,
    name: true,
    phone: true,
    role: true,
    isActive: true,
    vehicleReservationBlocked: true,
    slackNotifyEnabled: true,
    createdAt: true,
    lastLoginAt: true,
    organization: { select: { id: true, name: true, code: true } },
    department: { select: { id: true, name: true } },
  }

  // 페이지네이션 모드: page 또는 limit 파라미터가 있을 때
  if (pageParam || limitParam) {
    const page = Math.max(1, parseInt(pageParam ?? '1'))
    const limit = Math.max(1, parseInt(limitParam ?? '10'))

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
      prisma.user.count({ where }),
    ])

    return NextResponse.json({ data, total, page, limit })
  }

  // 기존 호환: 배열 반환
  const users = await prisma.user.findMany({
    where,
    select,
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, password, name, phone, role, organizationId, departmentId, vehicleReservationBlocked, slackNotifyEnabled } = await req.json()

  if (!email || !password || !name) {
    return NextResponse.json({ error: '필수 항목을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: '이미 사용 중인 이메일입니다.' }, { status: 409 })
  }

  const hashed = await bcrypt.hash(password, 10)
  const newUser = await prisma.user.create({
    data: {
      email,
      password: hashed,
      name,
      phone: phone || '',
      role: role || 'USER',
      vehicleReservationBlocked: vehicleReservationBlocked === true,
      slackNotifyEnabled: slackNotifyEnabled !== false, // 기본 true(발송)
      organizationId: organizationId || null,
      departmentId: departmentId || null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      vehicleReservationBlocked: true,
      slackNotifyEnabled: true,
      createdAt: true,
      lastLoginAt: true,
      organization: { select: { id: true, name: true, code: true } },
      department: { select: { id: true, name: true } },
    },
  })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'user',
    resourceId: newUser.id,
    resourceLabel: `${newUser.name} (${newUser.email})`,
    after: newUser,
  })

  return NextResponse.json(newUser, { status: 201 })
}
