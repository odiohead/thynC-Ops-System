/**
 * 티켓 자동생성 규칙 설정 (ticket_cti_rule_design.md §6)
 * GET  — 업무별 규칙 + 선택 후보(CTI 트리·Assignment Group·조건 마스터)
 * PUT  — 업무 1건의 규칙 저장 (기본 규칙 + 조건별 규칙 일괄)
 * 권한: 조회 로그인, 변경 ADMIN 이상
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { DOMAIN_META, DOMAIN_REF_TYPES, isDomainRefType, type DomainRefType } from '@/lib/ticketCtiRules'

export const dynamic = 'force-dynamic'

async function loadRules(refType?: DomainRefType) {
  return prisma.ticketDomainCtiRule.findMany({
    where: refType ? { refType } : undefined,
    select: {
      id: true,
      refType: true,
      matchStatusCodeId: true,
      ctiId: true,
      queueId: true,
      fillDescription: true,
      isActive: true,
      updatedAt: true,
      cti: {
        select: {
          id: true,
          name: true,
          isActive: true,
          defaultQueue: { select: { id: true, name: true } },
          parent: { select: { name: true, parent: { select: { name: true } } } },
        },
      },
      queue: { select: { id: true, name: true } },
      matchStatusCode: { select: { id: true, name: true } },
      updater: { select: { name: true } },
    },
    orderBy: [{ refType: 'asc' }, { matchStatusCodeId: 'asc' }],
  })
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const refTypeParam = request.nextUrl.searchParams.get('refType')
  const refType = isDomainRefType(refTypeParam) ? refTypeParam : undefined

  const [rules, ctiNodes, queues] = await Promise.all([
    loadRules(refType),
    prisma.ticketCti.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, parentId: true, level: true, name: true, isActive: true, defaultQueueId: true },
    }),
    prisma.ticketQueue.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    }),
  ])

  // 조건 축 후보 — 메타에 matchCategory를 선언한 업무 전부 (유지보수 장애유형·VOC 분류 등, 레지스트리 단일 소스)
  const matchOptions: Record<string, { id: number; name: string }[]> = {}
  for (const rt of DOMAIN_REF_TYPES) {
    const category = DOMAIN_META[rt].matchCategory
    if (!category) continue
    matchOptions[rt] = await prisma.statusCode.findMany({
      where: { category },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    })
  }

  return NextResponse.json({
    rules: rules.map((r) => ({
      ...r,
      ctiPath: r.cti ? [r.cti.parent?.parent?.name, r.cti.parent?.name, r.cti.name].filter(Boolean).join(' / ') : null,
      effectiveQueue: r.queue ?? r.cti?.defaultQueue ?? null,
    })),
    ctiNodes,
    queues,
    matchOptions,
    meta: DOMAIN_META,
    refTypes: DOMAIN_REF_TYPES,
  })
}

interface RuleInput {
  matchStatusCodeId: number | null
  ctiId: number | null // null = 조건 규칙 삭제(기본 규칙으로 폴백)
  queueId: number | null
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const refType = body.refType
  if (!isDomainRefType(refType)) return NextResponse.json({ error: '업무 유형이 올바르지 않습니다.' }, { status: 400 })

  const meta = DOMAIN_META[refType]
  const fillDescription = body.fillDescription !== false
  const rows: RuleInput[] = Array.isArray(body.rules) ? body.rules : []

  const defaultRow = rows.find((r) => r.matchStatusCodeId == null)
  if (!defaultRow?.ctiId) {
    return NextResponse.json({ error: `${meta.label} 기본 티켓 분류(CTI)를 지정하세요.` }, { status: 400 })
  }

  // CTI 검증 — level 3(Item)만, 비활성 금지
  const ctiIds = Array.from(new Set(rows.map((r) => r.ctiId).filter((v): v is number => typeof v === 'number')))
  const ctis = await prisma.ticketCti.findMany({
    where: { id: { in: ctiIds } },
    select: { id: true, level: true, isActive: true, name: true },
  })
  if (ctis.length !== ctiIds.length) return NextResponse.json({ error: '분류를 찾을 수 없습니다.' }, { status: 400 })
  const badLevel = ctis.find((c) => c.level !== 3)
  if (badLevel) {
    return NextResponse.json({ error: `'${badLevel.name}'은 Item(3단계) 분류가 아닙니다. 3단계까지 선택하세요.` }, { status: 400 })
  }
  const inactive = ctis.find((c) => !c.isActive)
  if (inactive) {
    return NextResponse.json({ error: `'${inactive.name}'은 비활성 분류입니다. 활성 분류를 선택하세요.` }, { status: 400 })
  }

  // 조건 축 검증 — meta.matchCategory를 선언한 업무만 조건 규칙 허용 (유지보수 장애유형·VOC 분류)
  const matchIds = rows.map((r) => r.matchStatusCodeId).filter((v): v is number => typeof v === 'number')
  if (matchIds.length && !meta.matchCategory) {
    return NextResponse.json({ error: `${meta.label}는 조건별 규칙을 지원하지 않습니다.` }, { status: 400 })
  }
  if (matchIds.length) {
    const codes = await prisma.statusCode.count({ where: { id: { in: matchIds }, category: meta.matchCategory! } })
    if (codes !== new Set(matchIds).size) {
      return NextResponse.json({ error: `${meta.matchLabel} 값이 올바르지 않습니다.` }, { status: 400 })
    }
  }

  const queueIds = Array.from(new Set(rows.map((r) => r.queueId).filter((v): v is number => typeof v === 'number')))
  if (queueIds.length) {
    const cnt = await prisma.ticketQueue.count({ where: { id: { in: queueIds } } })
    if (cnt !== queueIds.length) return NextResponse.json({ error: 'Assignment Group을 찾을 수 없습니다.' }, { status: 400 })
  }

  const before = await loadRules(refType)

  await prisma.$transaction(async (tx) => {
    // 조건 규칙: 입력에 없거나 ctiId가 비면 삭제 (기본 규칙으로 폴백)
    const keepMatchIds = rows
      .filter((r) => r.matchStatusCodeId != null && r.ctiId)
      .map((r) => r.matchStatusCodeId as number)
    await tx.ticketDomainCtiRule.deleteMany({
      where: {
        refType,
        matchStatusCodeId: { not: null, ...(keepMatchIds.length ? { notIn: keepMatchIds } : {}) },
      },
    })

    for (const row of rows) {
      if (!row.ctiId) continue
      const data = {
        ctiId: row.ctiId,
        queueId: row.queueId ?? null,
        // 설명 자동입력은 업무 단위 정책 — 전 행에 같은 값을 써서 어느 행을 읽어도 동일하게 만든다
        fillDescription,
        isActive: true,
        updatedBy: user.userId,
      }
      const existing = await tx.ticketDomainCtiRule.findFirst({
        where: { refType, matchStatusCodeId: row.matchStatusCodeId ?? null },
        select: { id: true },
      })
      if (existing) await tx.ticketDomainCtiRule.update({ where: { id: existing.id }, data })
      else await tx.ticketDomainCtiRule.create({ data: { refType, matchStatusCodeId: row.matchStatusCodeId ?? null, ...data } })
    }
  })

  const after = await loadRules(refType)

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:ticket_cti_rule',
    resourceId: refType,
    resourceLabel: `${meta.label} 티켓 자동생성 규칙`,
    before,
    after,
  })

  return NextResponse.json({ rules: after })
}
