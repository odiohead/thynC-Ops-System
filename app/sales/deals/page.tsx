import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales, toAmount } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import SalesConceptTabs from '../_components/SalesConceptTabs'
import DealsEntryTable, { type DealEntryRow } from './_components/DealsEntryTable'

export const dynamic = 'force-dynamic'

/**
 * 도입현황 입력 (계약 이력 전용 입력 페이지) — 엑셀(thynC_status.xlsx) B~AK 컬럼 순서 재현.
 * 1행 = 1차수(딜). 행 클릭 → 딜 상세 편집(/sales/deals/[id]), 우측 상단 등록 → 병원 매핑 후 상세로 이동.
 * 답사·공사·교육일·오더현황·지역은 운영 축(연결 프로젝트·병원) 조인 — 저장 없음.
 * 권한: (ADMIN 이상 또는 sales.access 권한) + SEERS 소속 — 편집은 USER 등급 이상
 */
export default async function SalesDealsEntryPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  const allowed = await canAccessSales(user)

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          영업 현황은 ADMIN 이상 또는 영업 접근 권한 보유자 + 씨어스(SEERS) 소속만 열람할 수 있습니다.
        </div>
      </div>
    )
  }

  const deals = await prisma.salesDeal.findMany({
    orderBy: [{ contractDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    include: {
      hospital: {
        select: {
          hospitalCode: true,
          hospitalName: true,
          type: true,
          sidoName: true,
          siteVisits: { orderBy: { visitDate: { sort: 'desc', nulls: 'last' } }, take: 1, select: { visitDate: true } },
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
          startDate: true,
          endDateExpected: true,
          educationDate: true,
          hasOrder: true,
          buildStatus: { select: { label: true, color: true } },
        },
      },
    },
  })

  const d2s = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null)

  const rows: DealEntryRow[] = deals.map((d) => ({
    id: d.id,
    dealCode: d.dealCode,
    roundNo: d.roundNo,
    hospitalCode: d.hospital.hospitalCode,
    hospitalName: d.hospital.hospitalName,
    hospitalType: d.hospital.type,
    sido: d.hospital.sidoName,
    dealStatus: d.status,
    buildStatus: d.project?.buildStatus ? { name: d.project.buildStatus.label, color: d.project.buildStatus.color } : null,
    dwCountType: d.daewoongCountType,
    dwOrderStatus: d.daewoongOrderStatus,
    dwDivision: d.daewoongDivision,
    dwOffice: d.daewoongOffice,
    dwManager: d.daewoongManager,
    dwClientCode: d.daewoongClientCode,
    dwModelKind: d.daewoongModelKind,
    dwModel: d.daewoongModel,
    wardsText: d.wardsText,
    dwDeviceCount: d.daewoongDeviceCount,
    bedCount: d.bedCount,
    dwAmountTotal: toAmount(d.daewoongAmountTotal),
    contractDate: d2s(d.contractDate),
    dwBuildDate: d2s(d.daewoongBuildDate),
    dwAmountProduct: toAmount(d.daewoongAmountProduct),
    dwAmountConstruction: toAmount(d.daewoongAmountConstruction),
    dwAmountActual: toAmount(d.daewoongAmountActual),
    dwAmountService: toAmount(d.daewoongAmountService),
    dwTaxInvoice: d.daewoongTaxInvoice,
    dwSettlement: d.daewoongSettlement,
    dwPriceType: d.daewoongPriceType,
    remark: d.remark,
  }))

  return (
    <div>
      <SalesConceptTabs />
      <DealsEntryTable rows={rows} />
    </div>
  )
}
