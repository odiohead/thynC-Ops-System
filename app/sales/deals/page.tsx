import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales, toAmount } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import DealsEntryTable, { type DealEntryRow } from './_components/DealsEntryTable'

export const dynamic = 'force-dynamic'

/**
 * 도입현황 입력 (계약 이력 전용 입력 페이지) — 엑셀(thynC_status.xlsx) B~AK 컬럼 순서 재현.
 * 1행 = 1차수(딜). 행 클릭 → 딜 상세 편집(/sales/deals/[id]), 우측 상단 등록 → 병원 매핑 후 상세로 이동.
 * 답사·공사·교육일·오더현황·지역은 운영 축(연결 프로젝트·병원) 조인 — 저장 없음.
 * 권한: ADMIN 이상 + SEERS 소속
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
          영업 현황은 ADMIN 이상 + 씨어스(SEERS) 소속만 열람할 수 있습니다.
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
    hospitalModel: d.hospitalModel?.name ?? null,
    seersModel: d.seersModel?.name ?? null,
    warrantyText: d.warrantyText,
    wardsText: d.wardsText,
    deptsText: d.deptsText,
    wardCount: d.wardCount,
    bedCount: d.bedCount,
    amountProduct: toAmount(d.amountProduct),
    amountConstruction: toAmount(d.amountConstruction),
    amountService: toAmount(d.amountService),
    amountActual: toAmount(d.amountActual),
    firstContactDate: d2s(d.firstContactDate),
    siteVisitDate: d2s(d.hospital.siteVisits[0]?.visitDate),
    contractDate: d2s(d.contractDate),
    startDate: d2s(d.project?.startDate),
    endDateExpected: d2s(d.project?.endDateExpected),
    educationDate: d2s(d.project?.educationDate),
    hasOrder: d.project ? d.project.hasOrder : null,
    taxInvoice: d.taxInvoice?.name ?? null,
    settlement: d.settlement?.name ?? null,
    priceTypeText: d.priceTypeText,
    remark: d.remark,
    daewoongDivision: d.daewoongDivision,
    daewoongOffice: d.daewoongOffice,
    daewoongManager: d.daewoongManager,
    daewoongPhone: d.daewoongPhone,
  }))

  return <DealsEntryTable rows={rows} />
}
