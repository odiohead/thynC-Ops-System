/**
 * SLA 정책·타깃 설정 API (1.1 P2 — projects/notification_v1.1_design.md §4.8·§5.6)
 *
 * GET  : 정책 목록 + 타깃 (설정 화면 매트릭스 소스) + 편집용 마스터
 * POST : 정책 생성 (행 추가)
 *
 * 권한: ADMIN 이상 — SLA 기준은 운영 정책이라 일반 사용자에게 노출하지 않는다.
 * 검증·정규화 로직은 `lib/slaSettings.ts` (Route 파일은 핸들러만 export 가능)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { SLA_METRICS } from '@/lib/sla'
import {
  validateTargets, normalizeScope, targetCreateData,
  TICKET_STATUSES, TICKET_SEVERITIES, CLOCK_TYPES, DOMAIN_DUE_REF_TYPES,
  type TargetInput,
} from '@/lib/slaSettings'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const policies = await prisma.slaPolicy.findMany({
    orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    include: {
      targets: { orderBy: [{ metric: 'asc' }, { statusScope: 'asc' }, { severity: 'asc' }] },
      _count: { select: { clocks: true } },
    },
  })

  // 매트릭스 편집용 마스터 (Assignment Group·CTI 선택지)
  const [queues, ctiNodes] = await Promise.all([
    prisma.ticketQueue.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.ticketCti.findMany({ select: { id: true, parentId: true, level: true, name: true, isActive: true }, orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }] }),
  ])

  return NextResponse.json({
    policies,
    masters: {
      queues,
      ctiNodes,
      statuses: TICKET_STATUSES,
      severities: TICKET_SEVERITIES,
      metrics: SLA_METRICS,
      domainDueRefTypes: DOMAIN_DUE_REF_TYPES,
      clockTypes: CLOCK_TYPES,
    },
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: '정책 이름을 입력하세요.' }, { status: 400 })

  const scope = normalizeScope(body)
  const targets: TargetInput[] = Array.isArray(body.targets) ? body.targets : []
  const err = validateTargets(targets, scope.refTypes)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  const clockType = (CLOCK_TYPES as readonly string[]).includes(body.clockType) ? body.clockType : 'CALENDAR_24H'
  // 1.1은 24시간 시계만 구현 (§4.4 D3) — 영업시간 시계는 후속
  if (clockType === 'BUSINESS_HOURS') {
    return NextResponse.json({ error: '영업시간 시계는 아직 지원하지 않습니다(1.1 범위 외).' }, { status: 400 })
  }

  const created = await prisma.slaPolicy.create({
    data: {
      name,
      description: typeof body.description === 'string' ? body.description : null,
      priority: Number.isFinite(body.priority) ? Math.floor(body.priority) : 50,
      ...scope,
      clockType,
      isActive: body.isActive !== false,
      targets: { create: targets.map(targetCreateData) },
    },
    include: { targets: true },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:sla-policy',
    resourceId: created.id,
    resourceLabel: created.name,
    after: created,
  })

  return NextResponse.json({ policy: created }, { status: 201 })
}
