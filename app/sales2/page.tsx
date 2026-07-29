import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales, toAmount } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import SalesPipelineTable, { type PipelineRow, type PipelineMasters } from './_components/SalesPipelineTable'

export const dynamic = 'force-dynamic'

/**
 * 도입 현황 v2 — 영업 파이프라인 뷰 (실험 페이지, /sales와 비교용)
 * 취지: 레코드의 출발점 = 영업. 영업담당자가 이 화면에서 직접 차수를 등록(기본 '영업중')하고,
 *       계약 완료 후 프로젝트를 매핑하면 공사 단계·일정이 자동으로 붙는다.
 *       미매핑(영업 중) 딜에는 계약 전 운영 항목(답사·설치계획 건수)을 병원 레벨로 표시.
 * 권한: SUPER_ADMIN + SEERS 소속 (임시 — 기능 미완, 확정 후 ADMIN 이상 완화)
 */
export default async function Sales2Page() {
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

  const [deals, codes] = await Promise.all([
    prisma.salesDeal.findMany({
      orderBy: [{ contractDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      include: {
        hospital: {
          select: {
            hospitalCode: true,
            hospitalName: true,
            type: true,
            sidoName: true,
            salesProfile: {
              select: {
                stage: { select: { name: true, color: true } },
                owner: { select: { name: true } },
              },
            },
          },
        },
        status: { select: { name: true, color: true } },
        hospitalModel: { select: { name: true } },
        seersModel: { select: { name: true } },
        taxInvoice: { select: { name: true } },
        settlement: { select: { name: true } },
        project: {
          select: {
            projectCode: true,
            projectName: true,
            startDate: true,
            endDateExpected: true,
            educationDate: true,
            buildStatus: { select: { label: true, color: true } },
          },
        },
      },
    }),
    prisma.statusCode.findMany({
      where: { category: { in: ['SALES_DEAL_STATUS', 'SALES_MODEL'] } },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, category: true },
    }),
  ])

  // 계약 전 운영 항목(답사·설치계획) — 병원 레벨 건수 (딜↔답사 직접 연결은 없음)
  const hospitalCodes = Array.from(new Set(deals.map((d) => d.hospitalCode)))
  const [visitCounts, planCounts] = await Promise.all([
    prisma.siteVisit.groupBy({ by: ['hospitalCode'], where: { hospitalCode: { in: hospitalCodes } }, _count: { _all: true } }),
    prisma.installPlan.groupBy({ by: ['hospitalCode'], where: { hospitalCode: { in: hospitalCodes } }, _count: { _all: true } }),
  ])
  const visitMap = new Map(visitCounts.map((v) => [v.hospitalCode, v._count._all]))
  const planMap = new Map(planCounts.map((v) => [v.hospitalCode, v._count._all]))

  const d2s = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null)

  const rows: PipelineRow[] = deals.map((d) => ({
    id: d.id,
    dealCode: d.dealCode,
    roundNo: d.roundNo,
    hospitalCode: d.hospital.hospitalCode,
    hospitalName: d.hospital.hospitalName,
    hospitalType: d.hospital.type,
    sido: d.hospital.sidoName,
    stage: d.hospital.salesProfile?.stage ?? null,
    owner: d.hospital.salesProfile?.owner?.name ?? null,
    visitCount: visitMap.get(d.hospitalCode) ?? 0,
    planCount: planMap.get(d.hospitalCode) ?? 0,
    dealStatus: d.status,
    buildStatus: d.project?.buildStatus ? { name: d.project.buildStatus.label, color: d.project.buildStatus.color } : null,
    hospitalModel: d.hospitalModel?.name ?? null,
    seersModel: d.seersModel?.name ?? null,
    contractDate: d2s(d.contractDate),
    wardsText: d.wardsText,
    deptsText: d.deptsText,
    wardCount: d.wardCount,
    bedCount: d.bedCount,
    amountProduct: toAmount(d.amountProduct),
    amountConstruction: toAmount(d.amountConstruction),
    amountActual: toAmount(d.amountActual),
    taxInvoice: d.taxInvoice?.name ?? null,
    settlement: d.settlement?.name ?? null,
    startDate: d2s(d.project?.startDate),
    endDateExpected: d2s(d.project?.endDateExpected),
    educationDate: d2s(d.project?.educationDate),
    projectCode: d.project?.projectCode ?? null,
    projectName: d.project?.projectName ?? null,
    remark: d.remark,
  }))

  const masters: PipelineMasters = {
    dealStatuses: codes.filter((c) => c.category === 'SALES_DEAL_STATUS').map((c) => ({ id: c.id, name: c.name })),
    models: codes.filter((c) => c.category === 'SALES_MODEL').map((c) => ({ id: c.id, name: c.name })),
  }

  return <SalesPipelineTable rows={rows} masters={masters} />
}
