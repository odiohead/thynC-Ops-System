import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * 티켓 프로세스 지표 (P12 — ticket_dev_schedule.md 상세 설계)
 *
 * DB 뷰 없이 라우트에서 raw SQL 집계 (규모상 실시간 집계 충분 — §2.11).
 * 지표 2계열: 필드 기반(전 기간 — 백필 티켓도 원본 날짜 보존) / 이벤트 기반(체류 — P11 이후 축적).
 * 날짜 버킷·오늘 판정은 KST(Asia/Seoul) 기준.
 *
 * 쿼리 파라미터: months(3|6|12|0=전체, 기본 6) · queueId · refType(MAINTENANCE…|PURE=순수)
 * perOwner(담당별 처리량)는 ADMIN 이상에게만 포함 (사용자 확정).
 */

const KST = `AT TIME ZONE 'Asia/Seoul'`

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const monthsRaw = parseInt(sp.get('months') ?? '6')
  const months = [0, 3, 6, 12].includes(monthsRaw) ? monthsRaw : 6
  const queueId = sp.get('queueId') ? parseInt(sp.get('queueId')!) : null
  const refType = sp.get('refType') // 'MAINTENANCE' | ... | 'PURE' | null

  // 공통 필터 (큐·유형) — 스냅샷·기간 지표 모두 적용
  const filters: Prisma.Sql[] = []
  if (queueId && Number.isFinite(queueId)) filters.push(Prisma.sql`t.queue_id = ${queueId}`)
  if (refType === 'PURE') filters.push(Prisma.sql`t.ref_type IS NULL`)
  else if (refType && ['MAINTENANCE', 'ETC', 'SITE_VISIT', 'INSTALL_PLAN', 'PROJECT'].includes(refType)) {
    filters.push(Prisma.sql`t.ref_type = ${refType}`)
  }
  const whereBase = filters.length ? Prisma.sql`AND ${Prisma.join(filters, ' AND ')}` : Prisma.empty

  // 기간 (월별 추이·처리량·평균 소요) — months=0이면 전체.
  // KST 당월 1일에서 (months-1)개월 전 시작 — 벽시계(KST) 월초를 timestamptz로 환산해 비교
  const periodStart = Prisma.sql`((date_trunc('month', (now() ${Prisma.raw(KST)})) - ${`${months - 1} months`}::interval) ${Prisma.raw(KST)})`
  const periodClosed = months > 0 ? Prisma.sql`AND t.closed_at >= ${periodStart}` : Prisma.empty
  const periodCreated = months > 0 ? Prisma.sql`AND t.created_at >= ${periodStart}` : Prisma.empty

  // ── KPI 스냅샷 ──────────────────────────────────────────────
  const [kpiRow] = await prisma.$queryRaw<
    {
      open: bigint
      unassigned: bigint
      sla_overdue: bigint
      closed_this_week: bigint
      avg_days_90: number | null
      reopened: bigint
      resolved_ever: bigint
    }[]
  >(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE t.status NOT IN ('RESOLVED','CLOSED')) AS open,
      count(*) FILTER (WHERE t.status NOT IN ('RESOLVED','CLOSED') AND t.owner_id IS NULL) AS unassigned,
      count(*) FILTER (
        WHERE t.status IN ('OPEN','ASSIGNED','IN_PROGRESS') AND t.severity <> 'SEV5'
          AND t.due_at IS NOT NULL AND (t.due_at ${Prisma.raw(KST)})::date < (now() ${Prisma.raw(KST)})::date
      ) AS sla_overdue,
      count(*) FILTER (
        WHERE t.closed_at IS NOT NULL
          AND (t.closed_at ${Prisma.raw(KST)})::date >= date_trunc('week', (now() ${Prisma.raw(KST)}))::date
      ) AS closed_this_week,
      avg(GREATEST(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)) / 86400.0, 0)) FILTER (
        WHERE t.closed_at IS NOT NULL AND t.closed_at >= now() - interval '90 days'
      ) AS avg_days_90,
      count(*) FILTER (WHERE t.reopen_count > 0) AS reopened,
      count(*) FILTER (WHERE t.resolved_at IS NOT NULL OR t.closed_at IS NOT NULL OR t.reopen_count > 0) AS resolved_ever
    FROM tickets t
    WHERE 1=1 ${whereBase}
  `)

  // ── 월별 추이: 생성 / 종결 / 소요(중앙값·평균) / SLA 준수 ──
  const monthlyCreated = await prisma.$queryRaw<{ ym: string; cnt: bigint }[]>(Prisma.sql`
    SELECT to_char(t.created_at ${Prisma.raw(KST)}, 'YYYY-MM') AS ym, count(*) AS cnt
    FROM tickets t WHERE 1=1 ${whereBase} ${periodCreated}
    GROUP BY 1 ORDER BY 1
  `)
  const monthlyClosed = await prisma.$queryRaw<
    { ym: string; cnt: bigint; median_days: number | null; avg_days: number | null; sla_met: bigint; sla_total: bigint }[]
  >(Prisma.sql`
    SELECT
      to_char(t.closed_at ${Prisma.raw(KST)}, 'YYYY-MM') AS ym,
      count(*) AS cnt,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)) / 86400.0, 0)) AS median_days,
      avg(GREATEST(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)) / 86400.0, 0)) AS avg_days,
      count(*) FILTER (WHERE t.due_at IS NOT NULL AND t.closed_at <= t.due_at) AS sla_met,
      count(*) FILTER (WHERE t.due_at IS NOT NULL) AS sla_total
    FROM tickets t
    WHERE t.closed_at IS NOT NULL ${whereBase} ${periodClosed}
    GROUP BY 1 ORDER BY 1
  `)

  // ── 분포 (열린 티켓 스냅샷) ─────────────────────────────────
  const bySeverity = await prisma.$queryRaw<{ severity: string; open: bigint }[]>(Prisma.sql`
    SELECT t.severity::text AS severity, count(*) AS open
    FROM tickets t WHERE t.status NOT IN ('RESOLVED','CLOSED') ${whereBase}
    GROUP BY 1 ORDER BY 1
  `)
  const byQueue = await prisma.$queryRaw<{ queue_id: number; name: string; open: bigint }[]>(Prisma.sql`
    SELECT t.queue_id, q.name, count(*) AS open
    FROM tickets t JOIN ticket_queues q ON q.id = t.queue_id
    WHERE t.status NOT IN ('RESOLVED','CLOSED') ${whereBase}
    GROUP BY 1, 2 ORDER BY 3 DESC
  `)
  const byRefType = await prisma.$queryRaw<{ ref_type: string | null; open: bigint }[]>(Prisma.sql`
    SELECT t.ref_type, count(*) AS open
    FROM tickets t WHERE t.status NOT IN ('RESOLVED','CLOSED') ${whereBase}
    GROUP BY 1 ORDER BY 2 DESC
  `)

  // ── 담당별 처리량 (ADMIN 이상만 — 사용자 확정) ──────────────
  let perOwner: { ownerId: string; name: string; closed: number; avgDays: number | null; openLoad: number }[] | undefined
  if (isAdminOrAbove(user.role)) {
    const rows = await prisma.$queryRaw<
      { owner_id: string; name: string; closed: bigint; avg_days: number | null; open_load: bigint }[]
    >(Prisma.sql`
      SELECT u.id AS owner_id, u.name,
        count(*) FILTER (WHERE t.closed_at IS NOT NULL ${periodClosed}) AS closed,
        avg(GREATEST(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)) / 86400.0, 0)) FILTER (WHERE t.closed_at IS NOT NULL ${periodClosed}) AS avg_days,
        count(*) FILTER (WHERE t.status NOT IN ('RESOLVED','CLOSED')) AS open_load
      FROM tickets t JOIN users u ON u.id = t.owner_id
      WHERE t.owner_id IS NOT NULL ${whereBase}
      GROUP BY 1, 2
      HAVING count(*) FILTER (WHERE t.closed_at IS NOT NULL ${periodClosed}) > 0
          OR count(*) FILTER (WHERE t.status NOT IN ('RESOLVED','CLOSED')) > 0
      ORDER BY 3 DESC, 5 DESC
    `)
    perOwner = rows.map((r) => ({
      ownerId: r.owner_id,
      name: r.name,
      closed: Number(r.closed),
      avgDays: r.avg_days === null ? null : Math.round(Number(r.avg_days) * 10) / 10,
      openLoad: Number(r.open_load),
    }))
  }

  // ── 현 상태 장기 체류 Top 10 (statusChangedAt 기준 — 이벤트 축적 전에도 산출 가능) ──
  const dwellTop = await prisma.$queryRaw<
    { ticket_code: string; title: string; status: string; severity: string; queue_name: string; ref_type: string | null; days: number }[]
  >(Prisma.sql`
    SELECT t.ticket_code, t.title, t.status::text AS status, t.severity::text AS severity,
      q.name AS queue_name, t.ref_type,
      floor(EXTRACT(EPOCH FROM (now() - t.status_changed_at)) / 86400.0)::int AS days
    FROM tickets t JOIN ticket_queues q ON q.id = t.queue_id
    WHERE t.status NOT IN ('RESOLVED','CLOSED') ${whereBase}
    ORDER BY t.status_changed_at ASC
    LIMIT 10
  `)

  // ── 월별 병합 (생성·종결을 하나의 시계열로) ─────────────────
  const ymSet = new Set<string>(monthlyCreated.map((r) => r.ym).concat(monthlyClosed.map((r) => r.ym)))
  const closedMap = new Map(monthlyClosed.map((r) => [r.ym, r]))
  const createdMap = new Map(monthlyCreated.map((r) => [r.ym, r]))
  const monthly = Array.from(ymSet).sort().map((ym) => {
    const c = closedMap.get(ym)
    const slaTotal = c ? Number(c.sla_total) : 0
    return {
      ym,
      created: Number(createdMap.get(ym)?.cnt ?? 0),
      closed: c ? Number(c.cnt) : 0,
      medianDays: c?.median_days === null || c === undefined ? null : Math.round(Number(c.median_days) * 10) / 10,
      avgDays: c?.avg_days === null || c === undefined ? null : Math.round(Number(c.avg_days) * 10) / 10,
      slaRate: slaTotal > 0 ? Math.round((Number(c!.sla_met) / slaTotal) * 1000) / 10 : null,
      slaTotal,
    }
  })

  const reopened = Number(kpiRow.reopened)
  const resolvedEver = Number(kpiRow.resolved_ever)

  return NextResponse.json({
    kpi: {
      open: Number(kpiRow.open),
      unassigned: Number(kpiRow.unassigned),
      slaOverdue: Number(kpiRow.sla_overdue),
      closedThisWeek: Number(kpiRow.closed_this_week),
      avgResolutionDays90: kpiRow.avg_days_90 === null ? null : Math.round(Number(kpiRow.avg_days_90) * 10) / 10,
      reopenRate: { reopened, resolvedEver, pct: resolvedEver > 0 ? Math.round((reopened / resolvedEver) * 1000) / 10 : 0 },
    },
    monthly,
    bySeverity: bySeverity.map((r) => ({ severity: r.severity, open: Number(r.open) })),
    byQueue: byQueue.map((r) => ({ queueId: r.queue_id, name: r.name, open: Number(r.open) })),
    byRefType: byRefType.map((r) => ({ refType: r.ref_type, open: Number(r.open) })),
    perOwner,
    dwellTop: dwellTop.map((r) => ({
      ticketCode: r.ticket_code,
      title: r.title,
      status: r.status,
      severity: r.severity,
      queueName: r.queue_name,
      refType: r.ref_type,
      days: Number(r.days),
    })),
    filters: { months, queueId, refType: refType ?? null },
  })
}
