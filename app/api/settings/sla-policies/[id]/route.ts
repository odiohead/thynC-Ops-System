/**
 * SLA 정책 개별 수정·삭제 (1.1 P2)
 *
 * PUT    : 스코프·우선순위·활성 + **타깃 전체 재설정**(매트릭스 저장 = 그 행의 셀 전부 반영)
 *          `applyToOpen: true`면 열린 티켓 시계를 **quiet 재계산**(알림 없이) — §4.8 "설정 변경의 적용 범위"
 * DELETE : 정책 삭제 (타깃 cascade, 시계는 policy_id만 NULL — 이력 보존)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { syncTicketClocks } from '@/lib/sla'
import {
  validateTargets, normalizeScope, targetCreateData, expandCtiSubtree, openTicketWhere,
  type TargetInput, type PolicyScope,
} from '@/lib/slaSettings'

/** 이 정책 스코프에 걸리는 열린 티켓 (우선순위 경합은 syncTicketClocks가 최종 판정) */
async function candidateOpenTickets(scope: PolicyScope) {
  const nodes = scope.ctiIds.length > 0 ? await prisma.ticketCti.findMany({ select: { id: true, parentId: true } }) : []
  const ctiIds = expandCtiSubtree(scope.ctiIds, nodes)
  return prisma.ticket.findMany({ where: openTicketWhere(scope, ctiIds), select: { id: true } })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.slaPolicy.findUnique({ where: { id }, include: { targets: true } })
  if (!before) return NextResponse.json({ error: '정책을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const scope = normalizeScope(body, {
    refTypes: before.refTypes, queueIds: before.queueIds, ctiIds: before.ctiIds, severities: before.severities,
  })

  const targets: TargetInput[] | null = Array.isArray(body.targets) ? body.targets : null
  if (targets) {
    const err = validateTargets(targets, scope.refTypes)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.slaPolicy.update({
      where: { id },
      data: {
        ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
        ...(Number.isFinite(body.priority) ? { priority: Math.floor(body.priority) } : {}),
        ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
        ...scope,
      },
    })

    // 타깃 전체 재설정 — 매트릭스 화면의 "행 저장" 의미론(빈 셀 = 타깃 삭제 = 감지 안 함)
    if (targets) {
      await tx.slaTarget.deleteMany({ where: { policyId: id } })
      if (targets.length > 0) {
        await tx.slaTarget.createMany({
          data: targets.map((t) => ({ policyId: id, ...targetCreateData(t) })),
        })
      }
    }
    return tx.slaPolicy.findUnique({ where: { id }, include: { targets: true } })
  })

  // 적용 범위: 기본은 신규 티켓부터(진행 중 시계 불변). 명시 선택 시 열린 티켓 quiet 재계산
  let recalculated = 0
  if (body.applyToOpen === true) {
    const candidates = await candidateOpenTickets(scope)
    for (const t of candidates) {
      try {
        await syncTicketClocks(t.id, { quiet: true }) // quiet: 재계산으로 즉시 초과가 돼도 알림 없음
        recalculated++
      } catch (err) {
        console.error(`[sla-policies] 재계산 실패 (ticket ${t.id}):`, err)
      }
    }
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:sla-policy',
    resourceId: id,
    resourceLabel: `${updated?.name}${body.applyToOpen === true ? ` (열린 티켓 ${recalculated}건 재계산)` : ''}`,
    before,
    after: updated,
  })

  return NextResponse.json({ policy: updated, recalculated })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.slaPolicy.findUnique({ where: { id }, include: { targets: true } })
  if (!before) return NextResponse.json({ error: '정책을 찾을 수 없습니다.' }, { status: 404 })

  // 시계는 policy_id가 SET NULL로 남는다(이력 보존). 진행 중 시계는 다음 동기화에서 CANCELED 처리됨
  await prisma.slaPolicy.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:sla-policy',
    resourceId: id,
    resourceLabel: before.name,
    before,
  })

  return NextResponse.json({ ok: true })
}
