import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { SIGNUP_ROLES, type SignupRole } from '@/lib/signup'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 가입 신청 처리 (2026-11-13) — ADMIN 이상.
 * POST { action: 'approve', role?, organizationId?, departmentId? } → 계정 생성(신청 비밀번호 그대로) + 신청 APPROVED
 * POST { action: 'reject', reason? } → 신청 REJECTED
 * 처리가 끝난 신청의 비밀번호 해시는 비운다. 최고관리자 권한 부여는 최고관리자만.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const admin = await getAuthUser(req)
  if (!admin || !isAdminOrAbove(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const request = await prisma.signupRequest.findUnique({ where: { id }, include: { organization: { select: { id: true, name: true } } } })
  if (!request) return NextResponse.json({ error: '가입 신청을 찾을 수 없습니다.' }, { status: 404 })
  if (request.status !== 'PENDING') return NextResponse.json({ error: '이미 처리된 가입 신청입니다.' }, { status: 409 })

  if (body.action === 'reject') {
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null
    const res = await prisma.signupRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectReason: reason, reviewedById: admin.userId, reviewedAt: new Date(), passwordHash: '' },
    })
    if (res.count === 0) return NextResponse.json({ error: '이미 처리된 가입 신청입니다.' }, { status: 409 })
    await logAudit({
      req, actor: auditActorFromJWT(admin), action: 'UPDATE', resource: 'signup_request', resourceId: id,
      resourceLabel: `가입 신청 반려 ${request.name} (${request.email})`,
      before: { status: 'PENDING' }, after: { status: 'REJECTED', rejectReason: reason },
    })
    return NextResponse.json({ ok: true })
  }

  if (body.action !== 'approve') return NextResponse.json({ error: '처리 방법이 올바르지 않습니다.' }, { status: 400 })

  const role = (body.role === undefined || body.role === null || body.role === '' ? 'USER' : body.role) as SignupRole
  if (!(SIGNUP_ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: '권한이 올바르지 않습니다.' }, { status: 400 })
  if (role === 'SUPER_ADMIN' && !isSuperAdmin(admin.role)) return NextResponse.json({ error: '최고관리자 권한은 최고관리자만 부여할 수 있습니다.' }, { status: 403 })

  // 소속·부서 — 생략하면 신청자가 고른 소속, 부서는 그 소속의 부서여야 한다
  const orgRaw = body.organizationId === undefined ? request.organizationId : body.organizationId
  const organizationId = orgRaw === null || orgRaw === '' ? null : Number(orgRaw)
  if (organizationId !== null) {
    if (!Number.isInteger(organizationId) || !(await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) {
      return NextResponse.json({ error: '소속이 올바르지 않습니다.' }, { status: 400 })
    }
  }
  const deptRaw = body.departmentId
  const departmentId = deptRaw === undefined || deptRaw === null || deptRaw === '' ? null : Number(deptRaw)
  if (departmentId !== null) {
    const dept = Number.isInteger(departmentId) ? await prisma.department.findUnique({ where: { id: departmentId }, select: { organizationId: true } }) : null
    if (!dept || dept.organizationId !== organizationId) return NextResponse.json({ error: '부서가 선택한 소속에 속하지 않습니다.' }, { status: 400 })
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // 대기 상태를 잡고(동시 승인 방지) 계정 생성 — 이메일 중복은 users UNIQUE가 최종 방어
      const lock = await tx.signupRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedById: admin.userId, reviewedAt: new Date() } })
      if (lock.count === 0) throw new Error('ALREADY')
      const user = await tx.user.create({
        data: { email: request.email, password: request.passwordHash, name: request.name, phone: request.phone, role, organizationId, departmentId },
        select: { id: true, email: true, name: true, phone: true, role: true, isActive: true, organization: { select: { id: true, name: true, code: true } }, department: { select: { id: true, name: true } } },
      })
      await tx.signupRequest.update({ where: { id }, data: { userId: user.id, passwordHash: '' } })
      return user
    })
    await logAudit({
      req, actor: auditActorFromJWT(admin), action: 'CREATE', resource: 'user', resourceId: created.id,
      resourceLabel: `${created.name} (${created.email}) — 가입 신청 승인`,
      after: { ...created, signupRequestId: id },
    })
    return NextResponse.json({ ok: true, user: created }, { status: 201 })
  } catch (e) {
    if (e instanceof Error && e.message === 'ALREADY') return NextResponse.json({ error: '이미 처리된 가입 신청입니다.' }, { status: 409 })
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: '같은 이메일의 계정이 이미 있습니다. 이 신청은 반려 처리하세요.' }, { status: 409 })
    }
    throw e
  }
}
