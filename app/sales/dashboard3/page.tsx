import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import SalesConceptTabs from '../_components/SalesConceptTabs'
import SalesDashboardC, { type DashboardCData } from './_components/SalesDashboardC'

export const dynamic = 'force-dynamic'

/**
 * 영업 대시보드 C — 인사이트 (모던 CRM 레이아웃 실험)
 * 히어로 KPI(스파크라인·전월 대비) + 매출 에어리어 + 목표 게이지 + 파이프라인 + 도넛 +
 * 담당자 리더보드 + 최근 활동 피드 + 지역/확장 기회.
 * 권한: SUPER_ADMIN + SEERS (임시)
 */
export default async function SalesDashboard3Page() {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  const allowed = await canAccessSales(user)
  if (!allowed) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          도입 현황은 기능 개발 중으로 최고관리자만 열람할 수 있습니다.
        </div>
      </div>
    )
  }

  const [deals, profiles, stages, activities] = await Promise.all([
    prisma.salesDeal.findMany({
      include: {
        status: { select: { name: true } },
        hospitalModel: { select: { name: true } },
        hospital: {
          select: {
            hospitalCode: true, hospitalName: true, sidoName: true,
            salesProfile: { select: { owner: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.hospitalSalesProfile.findMany({
      include: {
        stage: { select: { name: true, color: true, order: true } },
        owner: { select: { name: true } },
        hospital: { select: { hospitalCode: true, hospitalName: true, introBeds: true } },
      },
    }),
    prisma.statusCode.findMany({ where: { category: 'SALES_STAGE' }, orderBy: { order: 'asc' }, select: { name: true, color: true } }),
    prisma.salesActivity.findMany({
      orderBy: [{ activityDate: 'desc' }, { id: 'desc' }],
      take: 8,
      include: {
        activityType: { select: { name: true } },
        author: { select: { name: true } },
        hospital: { select: { hospitalCode: true, hospitalName: true } },
      },
    }),
  ])

  const n = (v: bigint | null) => (v === null ? 0 : Number(v))
  const completed = deals.filter((d) => d.status?.name === '계약완료')
  const active = deals.filter((d) => d.status?.name === '영업중' || !d.status)
  const now = new Date()
  const ymOf = (d: Date) => d.toISOString().slice(0, 7)
  const thisYm = ymOf(now)
  const prevYm = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 15))

  // 월별 (최근 12개월 연속 버킷 — 빈 달 0 채움)
  const buckets: string[] = []
  for (let i = 11; i >= 0; i--) buckets.push(ymOf(new Date(now.getFullYear(), now.getMonth() - i, 15)))
  const mAgg = new Map<string, { actual: number; count: number }>()
  completed.forEach((d) => {
    if (!d.contractDate) return
    const ym = ymOf(d.contractDate)
    const cur = mAgg.get(ym) ?? { actual: 0, count: 0 }
    cur.actual += n(d.amountActual)
    cur.count += 1
    mAgg.set(ym, cur)
  })
  const monthly = buckets.map((ym) => ({ ym: ym.slice(2).replace('-', '.'), actual: mAgg.get(ym)?.actual ?? 0, count: mAgg.get(ym)?.count ?? 0 }))
  const cur = mAgg.get(thisYm) ?? { actual: 0, count: 0 }
  const prev = mAgg.get(prevYm) ?? { actual: 0, count: 0 }

  // KPI
  const hospSet = new Set(completed.map((d) => d.hospitalCode))
  const perHosp = new Map<string, number>()
  completed.forEach((d) => perHosp.set(d.hospitalCode, (perHosp.get(d.hospitalCode) ?? 0) + 1))
  const bedSum = completed.reduce((a, d) => a + (d.bedCount ?? 0), 0)
  const actualSum = completed.reduce((a, d) => a + n(d.amountActual), 0)
  const BED_TARGET = 50000

  // 파이프라인 (설정 마스터 순서·색)
  const stageCount = new Map<string, number>()
  profiles.forEach((p) => { if (p.stage) stageCount.set(p.stage.name, (stageCount.get(p.stage.name) ?? 0) + 1) })
  const pipeline = stages.map((s) => ({ name: s.name, color: s.color, count: stageCount.get(s.name) ?? 0 }))

  // 판매모델 도넛 (계약완료 딜)
  const modelMap = new Map<string, number>()
  completed.forEach((d) => { const k = d.hospitalModel?.name ?? '미지정'; modelMap.set(k, (modelMap.get(k) ?? 0) + 1) })
  const modelDist = Array.from(modelMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)

  // 담당자 리더보드 Top 5
  const ownerMap = new Map<string, { actual: number; done: number; active: number }>()
  deals.forEach((d) => {
    const k = d.hospital.salesProfile?.owner?.name ?? '미지정'
    const o = ownerMap.get(k) ?? { actual: 0, done: 0, active: 0 }
    if (d.status?.name === '계약완료') { o.done++; o.actual += n(d.amountActual) }
    if (d.status?.name === '영업중' || !d.status) o.active++
    ownerMap.set(k, o)
  })
  const leaderboard = Array.from(ownerMap.entries())
    .filter(([name]) => name !== '미지정')
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 5)
  const unassignedActual = ownerMap.get('미지정')?.actual ?? 0

  // 지역 Top 8 (실판매액)
  const regionMap = new Map<string, number>()
  completed.forEach((d) => { const k = d.hospital.sidoName ?? '기타'; regionMap.set(k, (regionMap.get(k) ?? 0) + n(d.amountActual)) })
  const regionTop = Array.from(regionMap.entries()).map(([name, actual]) => ({ name, actual })).sort((a, b) => b.actual - a.actual).slice(0, 8)

  // 확장 기회 Top 5
  const opportunity = profiles
    .filter((p) => (p.totalBeds ?? 0) > 0)
    .map((p) => {
      const total = p.totalBeds ?? 0
      const intro = p.hospital.introBeds ?? 0
      return {
        hospitalCode: p.hospitalCode,
        name: p.hospital.hospitalName,
        total, intro,
        remaining: Math.max(0, total - intro),
        penetration: total > 0 ? Math.round((intro / total) * 100) : 0,
      }
    })
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 5)

  const data: DashboardCData = {
    hero: {
      actualSum,
      monthActual: cur.actual,
      prevActual: prev.actual,
      monthCount: cur.count,
      prevCount: prev.count,
      hospitals: hospSet.size,
      expanded: Array.from(perHosp.values()).filter((c) => c >= 2).length,
      beds: bedSum,
      bedTarget: BED_TARGET,
      activeDeals: active.length,
      newDealsThisMonth: deals.filter((d) => ymOf(d.createdAt) === thisYm).length,
    },
    monthly,
    pipeline,
    modelDist,
    leaderboard,
    unassignedActual,
    regionTop,
    opportunity,
    activities: activities.map((a) => ({
      id: a.id,
      date: a.activityDate.toISOString().slice(0, 10),
      type: a.activityType?.name ?? '활동',
      author: a.author?.name ?? null,
      hospitalCode: a.hospital.hospitalCode,
      hospitalName: a.hospital.hospitalName,
    })),
  }

  return (
    <div>
      <SalesConceptTabs />
      <SalesDashboardC data={data} />
    </div>
  )
}
