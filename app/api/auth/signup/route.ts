import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { parseSignupBody, signupOrganizations, signupRateLimited, requestIp, SIGNUP_PENDING_CAP } from '@/lib/signup'

export const dynamic = 'force-dynamic'

/**
 * 회원가입 신청 (2026-11-13) — 공개 엔드포인트(`/api/auth/*`는 미들웨어 공개 경로).
 * GET  → 가입 신청 화면의 소속 선택지
 * POST → 신청 접수(PENDING). 계정은 만들지 않는다 — 관리자 승인(`/api/signup-requests/[id]`) 시 생성
 */
export async function GET() {
  return NextResponse.json({ organizations: await signupOrganizations() })
}

export async function POST(req: NextRequest) {
  const ip = requestIp(req)
  if (signupRateLimited(ip)) return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 })

  const parsed = parseSignupBody((await req.json().catch(() => ({}))) as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { email, password, name, phone, organizationId, memo } = parsed.input

  const org = await prisma.organization.findFirst({ where: { id: organizationId!, isActive: true }, select: { id: true, name: true } })
  if (!org) return NextResponse.json({ error: '소속이 올바르지 않습니다.' }, { status: 400 })

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: '이미 가입된 이메일입니다. 로그인해 주세요.' }, { status: 409 })
  }
  if (await prisma.signupRequest.findFirst({ where: { email, status: 'PENDING' }, select: { id: true } })) {
    return NextResponse.json({ error: '이미 가입 신청이 접수되어 승인을 기다리고 있습니다.' }, { status: 409 })
  }
  if ((await prisma.signupRequest.count({ where: { status: 'PENDING' } })) >= SIGNUP_PENDING_CAP) {
    return NextResponse.json({ error: '지금은 가입 신청을 받을 수 없습니다. 관리자에게 문의해 주세요.' }, { status: 503 })
  }

  let created
  try {
    created = await prisma.signupRequest.create({
      data: { email, passwordHash: await bcrypt.hash(password, 10), name, phone, organizationId: org.id, memo, ipAddress: ip?.slice(0, 64) ?? null },
      select: { id: true, email: true, name: true },
    })
  } catch (e) {
    // 동시 신청 — 대기 신청 부분 UNIQUE 충돌
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: '이미 가입 신청이 접수되어 승인을 기다리고 있습니다.' }, { status: 409 })
    }
    throw e
  }

  await logAudit({
    req, actor: { name: `${created.name} (가입 신청자)`, email: created.email }, action: 'CREATE', resource: 'signup_request', resourceId: created.id,
    resourceLabel: `가입 신청 ${created.name} (${created.email}) · ${org.name}`,
    after: { email, name, phone, organizationId: org.id, memo },
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
