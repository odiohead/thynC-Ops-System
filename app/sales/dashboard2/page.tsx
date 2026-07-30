import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import SalesConceptTabs from '../_components/SalesConceptTabs'
import SalesDashboardB, { type DashboardBData } from './_components/SalesDashboardB'

export const dynamic = 'force-dynamic'

/**
 * 영업 대시보드 B — 영업 파이프라인 (활동·기회)
 * 단계 분포·라이프사이클·담당자별 성과·확장 기회(침투 여지)·활동 추이·방치 딜.
 * 권한: ADMIN 이상 + SEERS (영업 섹션 공통 게이트)
 */
export default async function SalesDashboard2Page() {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  const allowed = await canAccessSales(user)
  if (!allowed) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          영업 현황은 ADMIN 이상 + 씨어스(SEERS) 소속만 열람할 수 있습니다.
        </div>
      </div>
    )
  }

  const [profiles, deals, activities, stages] = await Promise.all([
    prisma.hospitalSalesProfile.findMany({
      include: {
        stage: { select: { id: true, name: true, color: true, order: true } },
        owner: { select: { name: true } },
        hospital: { select: { hospitalCode: true, hospitalName: true, introBeds: true } },
      },
    }),
    prisma.salesDeal.findMany({
      include: {
        status: { select: { name: true } },
        hospital: {
          select: {
            hospitalCode: true,
            hospitalName: true,
            salesProfile: { select: { owner: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.salesActivity.findMany({ select: { activityDate: true } }),
    prisma.statusCode.findMany({ where: { category: 'SALES_STAGE' }, orderBy: { order: 'asc' }, select: { name: true, color: true } }),
  ])

  const n = (v: bigint | null) => (v === null ? 0 : Number(v))
  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7)

  // 영업 단계 분포 (프로필 보유 병원 기준, 마스터 순서·색 유지)
  const stageCount = new Map<string, number>()
  profiles.forEach((p) => { if (p.stage) stageCount.set(p.stage.name, (stageCount.get(p.stage.name) ?? 0) + 1) })
  const stageUnset = profiles.filter((p) => !p.stage).length
  const stageDist = stages.map((s) => ({ name: s.name, color: s.color, count: stageCount.get(s.name) ?? 0 }))

  // 라이프사이클 분포 (딜 보유 병원 기준 — sales3와 동일 파생 규칙)
  const byHosp = new Map<string, typeof deals>()
  deals.forEach((d) => {
    const list = byHosp.get(d.hospitalCode)
    if (list) list.push(d)
    else byHosp.set(d.hospitalCode, [d])
  })
  const lifecycle = { first: 0, adopted: 0, expanding: 0, dropped: 0 }
  for (const list of Array.from(byHosp.values())) {
    const done = list.filter((d) => d.status?.name === '계약완료').length
    const act = list.filter((d) => d.status?.name === '영업중' || !d.status).length
    if (done > 0 && act > 0) lifecycle.expanding++
    else if (done > 0) lifecycle.adopted++
    else if (act > 0) lifecycle.first++
    else lifecycle.dropped++
  }

  // 담당자별 성과
  const ownerMap = new Map<string, { hospitals: Set<string>; active: number; done: number; actual: number }>()
  const ownerOf = (code: string, fromDeal?: string | null) => fromDeal ?? '미지정'
  profiles.forEach((p) => {
    const k = p.owner?.name ?? '미지정'
    const cur = ownerMap.get(k) ?? { hospitals: new Set<string>(), active: 0, done: 0, actual: 0 }
    cur.hospitals.add(p.hospitalCode)
    ownerMap.set(k, cur)
  })
  deals.forEach((d) => {
    const k = ownerOf(d.hospitalCode, d.hospital.salesProfile?.owner?.name)
    const cur = ownerMap.get(k) ?? { hospitals: new Set<string>(), active: 0, done: 0, actual: 0 }
    cur.hospitals.add(d.hospitalCode)
    if (d.status?.name === '영업중' || !d.status) cur.active++
    if (d.status?.name === '계약완료') { cur.done++; cur.actual += n(d.amountActual) }
    ownerMap.set(k, cur)
  })
  const ownerStats = Array.from(ownerMap.entries())
    .map(([name, v]) => ({ name, hospitals: v.hospitals.size, active: v.active, done: v.done, actual: v.actual }))
    .sort((a, b) => b.actual - a.actual)

  // 확장 기회 — 전체 병상 입력 병원 중 잔여 병상 큰 순 Top 10
  const introByHosp = new Map(profiles.map((p) => [p.hospitalCode, p.hospital.introBeds ?? 0]))
  const opportunity = profiles
    .filter((p) => (p.totalBeds ?? 0) > 0)
    .map((p) => {
      const intro = introByHosp.get(p.hospitalCode) ?? 0
      const total = p.totalBeds ?? 0
      return { name: p.hospital.hospitalName, intro, remaining: Math.max(0, total - intro), penetration: total > 0 ? Math.round((intro / total) * 1000) / 10 : 0 }
    })
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 10)

  // 월별 영업 활동 (최근 12개월)
  const actMap = new Map<string, number>()
  activities.forEach((a) => {
    const ym = a.activityDate.toISOString().slice(0, 7)
    actMap.set(ym, (actMap.get(ym) ?? 0) + 1)
  })
  const actMonths = Array.from(actMap.keys()).sort().slice(-12)
  const activityMonthly = actMonths.map((ym) => ({ ym: ym.slice(2).replace('-', '.'), count: actMap.get(ym) ?? 0 }))

  // 방치 딜 — 영업중 상태에서 오래 갱신 없는 순 Top 10
  const staleDeals = deals
    .filter((d) => d.status?.name === '영업중' || !d.status)
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .slice(0, 10)
    .map((d) => ({
      hospitalCode: d.hospitalCode,
      hospitalName: d.hospital.hospitalName,
      roundNo: d.roundNo,
      owner: d.hospital.salesProfile?.owner?.name ?? null,
      updatedAt: d.updatedAt.toISOString().slice(0, 10),
      daysIdle: Math.floor((now.getTime() - d.updatedAt.getTime()) / 86400000),
    }))

  const data: DashboardBData = {
    kpi: {
      activeDeals: deals.filter((d) => d.status?.name === '영업중' || !d.status).length,
      expandingHospitals: lifecycle.expanding,
      newDealsThisMonth: deals.filter((d) => d.createdAt.toISOString().slice(0, 7) === thisMonth).length,
      activitiesThisMonth: activities.filter((a) => a.activityDate.toISOString().slice(0, 7) === thisMonth).length,
      profiledHospitals: profiles.length,
      stageUnset,
    },
    stageDist,
    lifecycle,
    ownerStats,
    opportunity,
    activityMonthly,
    staleDeals,
  }

  return (
    <div>
      <SalesConceptTabs />
      <SalesDashboardB data={data} />
    </div>
  )
}
