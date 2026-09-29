/**
 * 병원 태그 부여 (2026-09-28)
 * GET  /api/hospitals/[code]/tags — 부여된 태그 목록 (로그인)
 * PUT  /api/hospitals/[code]/tags { tagIds: number[] } — 부여 집합 교체 (USER 이상, VIEWER 403). 추가분만 부여자·시각 기록, 제거분 삭제. 감사 hospital_tags UPDATE
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'
type Params = { params: { code: string } }

const SELECT = {
  assignedAt: true,
  assignedBy: { select: { id: true, name: true } },
  tag: { select: { id: true, key: true, name: true, description: true, effectNote: true, color: true, isSystem: true, sortOrder: true } },
} as const

async function loadAssignments(hospitalCode: string) {
  const rows = await prisma.hospitalTagAssignment.findMany({ where: { hospitalCode }, select: SELECT, orderBy: { tag: { sortOrder: 'asc' } } })
  return rows
}

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ assignments: await loadAssignments(hospital.hospitalCode) })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isUserOrAbove(user.role)) return NextResponse.json({ error: '태그 변경 권한이 없습니다.' }, { status: 403 })
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const raw = body && Array.isArray(body.tagIds) ? body.tagIds : null
  if (!raw || !raw.every((v: unknown) => Number.isInteger(v) && (v as number) > 0)) {
    return NextResponse.json({ error: 'tagIds는 양의 정수 배열이어야 합니다.' }, { status: 400 })
  }
  const tagIds = Array.from(new Set(raw as number[]))
  const valid = await prisma.hospitalTag.findMany({ where: { id: { in: tagIds }, isActive: true }, select: { id: true, name: true } })
  if (valid.length !== tagIds.length) return NextResponse.json({ error: '존재하지 않거나 비활성인 태그가 포함되어 있습니다.' }, { status: 400 })

  const before = await loadAssignments(hospital.hospitalCode)
  const beforeIds = new Set(before.map((a) => a.tag.id))
  const toAdd = tagIds.filter((id) => !beforeIds.has(id))
  const toRemove = before.filter((a) => !tagIds.includes(a.tag.id)).map((a) => a.tag.id)

  if (toAdd.length || toRemove.length) {
    await prisma.$transaction([
      ...(toRemove.length ? [prisma.hospitalTagAssignment.deleteMany({ where: { hospitalCode: hospital.hospitalCode, tagId: { in: toRemove } } })] : []),
      ...(toAdd.length ? [prisma.hospitalTagAssignment.createMany({ data: toAdd.map((tagId) => ({ hospitalCode: hospital.hospitalCode, tagId, assignedById: user.userId })), skipDuplicates: true })] : []),
    ])
    const after = await loadAssignments(hospital.hospitalCode)
    await logAudit({
      req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'hospital_tags',
      resourceId: hospital.hospitalCode, resourceLabel: `${hospital.hospitalName} 태그`,
      before: { tags: before.map((a) => a.tag.name) }, after: { tags: after.map((a) => a.tag.name) },
    })
    return NextResponse.json({ assignments: after, added: toAdd.length, removed: toRemove.length })
  }
  return NextResponse.json({ assignments: before, added: 0, removed: 0 })
}
