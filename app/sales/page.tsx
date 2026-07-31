import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales, toAmount } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import SalesLedgerTable, { type LedgerRow } from './_components/SalesLedgerTable'
import SalesConceptTabs from './_components/SalesConceptTabs'

export const dynamic = 'force-dynamic'

/**
 * 도입 현황 목록 (영업/CRM v4 P3 — 엑셀 '도입 현황' 와꾸 재현)
 * 1행 = 1차수(딜). 영업 축 + 운영 축(연결 프로젝트·답사) 조인 — 이중 저장 없음.
 * 권한: ADMIN 이상 + SEERS 소속
 */
export default async function SalesPage() {
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
  })

  const d2s = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null)

  const rows: LedgerRow[] = deals.map((d) => ({
    id: d.id,
    dealCode: d.dealCode,
    roundNo: d.roundNo,
    hospitalCode: d.hospital.hospitalCode,
    hospitalName: d.hospital.hospitalName,
    hospitalType: d.hospital.type,
    sido: d.hospital.sidoName,
    stage: d.hospital.salesProfile?.stage ?? null,
    owner: d.hospital.salesProfile?.owner?.name ?? null,
    dealStatus: d.status,
    buildStatus: d.project?.buildStatus ? { name: d.project.buildStatus.label, color: d.project.buildStatus.color } : null,
    hospitalModel: d.hospitalModel?.name ?? null,
    seersModel: d.seersModel?.name ?? null,
    contractDate: d2s(d.contractDate),
    wardsText: d.wardsText,
    deptsText: d.deptsText,
    wardCount: d.wardCount,
    bedCount: d.bedCount,
    // 금액·정산은 대웅 축 기준 표시 (2026-07-31 사용자 결정 — 씨어스 금액은 수기 입력 전까지 비어 있음)
    amountProduct: toAmount(d.daewoongAmountProduct),
    amountConstruction: toAmount(d.daewoongAmountConstruction),
    amountActual: toAmount(d.daewoongAmountActual),
    taxInvoice: d.daewoongTaxInvoice,
    settlement: d.daewoongSettlement,
    startDate: d2s(d.project?.startDate),
    endDateExpected: d2s(d.project?.endDateExpected),
    educationDate: d2s(d.project?.educationDate),
    projectCode: d.project?.projectCode ?? null,
    remark: d.remark,
  }))

  return (
    <div>
      <SalesConceptTabs />
      <SalesLedgerTable rows={rows} />
    </div>
  )
}
