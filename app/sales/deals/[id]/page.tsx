import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { verifyToken } from '@/lib/auth'
import { canAccessSales, toAmount } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import DealDetailForm, { type DealDetail, type DealMasters } from './_components/DealDetailForm'

export const dynamic = 'force-dynamic'

/**
 * 딜(계약 이력) 상세 편집 — 도입현황 입력 전용 페이지의 행 단위 편집 화면.
 * 병원은 등록 시 매핑 완료(변경 불가 — 잘못 매핑 시 삭제 후 재등록), 지역·종별은 병원에서 자동 표시.
 * 운영 축(공사 단계·일정·교육일)은 연결 프로젝트에서 읽기 전용 표시.
 * 권한: ADMIN 이상 + SEERS 소속
 */
export default async function SalesDealDetailPage({ params }: { params: { id: string } }) {
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

  const id = parseInt(params.id)
  if (isNaN(id)) notFound()

  const deal = await prisma.salesDeal.findUnique({
    where: { id },
    include: {
      devices: { select: { deviceInfoId: true, quantity: true } },
      hospital: { select: { hospitalCode: true, hospitalName: true, type: true, sidoName: true, sigunguName: true } },
      project: {
        select: {
          projectCode: true,
          projectName: true,
          startDate: true,
          endDateExpected: true,
          educationDate: true,
          hasOrder: true,
          buildStatus: { select: { label: true, color: true } },
        },
      },
    },
  })
  if (!deal) notFound()

  const [codes, projects, deviceInfos] = await Promise.all([
    prisma.statusCode.findMany({
      where: { category: { in: ['SALES_DEAL_STATUS', 'SALES_MODEL', 'SALES_TAX_INVOICE', 'SALES_SETTLEMENT'] } },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, category: true },
    }),
    prisma.project.findMany({
      where: { hospitalCode: deal.hospitalCode },
      orderBy: { orderNumber: 'asc' },
      select: { projectCode: true, projectName: true },
    }),
    // 기기 마스터 — 활성 전체 + (비활성이어도 이 딜에 수량이 있으면 표시). 새 기기가 늘어나면 기존 딜은 0으로 노출
    prisma.deviceInfo.findMany({
      where: { OR: [{ isActive: true }, { salesDealDevices: { some: { dealId: id } } }] },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, deviceName: true, deviceModel: true },
    }),
  ])

  const pick = (cat: string) => codes.filter((c) => c.category === cat).map(({ id: cid, name }) => ({ id: cid, name }))
  const masters: DealMasters = {
    dealStatuses: pick('SALES_DEAL_STATUS'),
    models: pick('SALES_MODEL'),
    taxInvoices: pick('SALES_TAX_INVOICE'),
    settlements: pick('SALES_SETTLEMENT'),
    projects,
    devices: deviceInfos,
  }

  const d2s = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null)

  const detail: DealDetail = {
    id: deal.id,
    dealCode: deal.dealCode,
    roundNo: deal.roundNo,
    hospitalCode: deal.hospital.hospitalCode,
    hospitalName: deal.hospital.hospitalName,
    hospitalType: deal.hospital.type,
    sido: deal.hospital.sidoName,
    sigungu: deal.hospital.sigunguName,
    statusId: deal.statusId,
    hospitalModelId: deal.hospitalModelId,
    seersModelId: deal.seersModelId,
    contractDate: d2s(deal.contractDate),
    firstContactDate: d2s(deal.firstContactDate),
    warrantyText: deal.warrantyText,
    wardsText: deal.wardsText,
    deptsText: deal.deptsText,
    wardCount: deal.wardCount,
    bedCount: deal.bedCount,
    deviceQuantities: Object.fromEntries(deal.devices.map((d) => [d.deviceInfoId, d.quantity])),
    amountProduct: toAmount(deal.amountProduct),
    amountConstruction: toAmount(deal.amountConstruction),
    amountActual: toAmount(deal.amountActual),
    taxInvoiceId: deal.taxInvoiceId,
    settlementId: deal.settlementId,
    daewoongClientCode: deal.daewoongClientCode,
    daewoongCountType: deal.daewoongCountType,
    daewoongOrderStatus: deal.daewoongOrderStatus,
    daewoongModelKind: deal.daewoongModelKind,
    daewoongModel: deal.daewoongModel,
    daewoongDeviceCount: deal.daewoongDeviceCount,
    daewoongAmountTotal: toAmount(deal.daewoongAmountTotal),
    daewoongBuildDate: d2s(deal.daewoongBuildDate),
    daewoongAmountProduct: toAmount(deal.daewoongAmountProduct),
    daewoongAmountConstruction: toAmount(deal.daewoongAmountConstruction),
    daewoongAmountActual: toAmount(deal.daewoongAmountActual),
    daewoongAmountService: toAmount(deal.daewoongAmountService),
    daewoongTaxInvoice: deal.daewoongTaxInvoice,
    daewoongSettlement: deal.daewoongSettlement,
    daewoongPriceType: deal.daewoongPriceType,
    daewoongDivision: deal.daewoongDivision,
    daewoongOffice: deal.daewoongOffice,
    daewoongManager: deal.daewoongManager,
    daewoongPhone: deal.daewoongPhone,
    projectCode: deal.projectCode,
    remark: deal.remark,
    projectInfo: deal.project
      ? {
          projectCode: deal.project.projectCode,
          projectName: deal.project.projectName,
          buildStatus: deal.project.buildStatus ? { name: deal.project.buildStatus.label, color: deal.project.buildStatus.color } : null,
          startDate: d2s(deal.project.startDate),
          endDateExpected: d2s(deal.project.endDateExpected),
          educationDate: d2s(deal.project.educationDate),
          hasOrder: deal.project.hasOrder,
        }
      : null,
  }

  return <DealDetailForm deal={detail} masters={masters} />
}
