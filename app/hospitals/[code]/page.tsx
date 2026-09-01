import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken, isAdminOrAbove } from '@/lib/auth'
import DeleteButton from './_components/DeleteButton'
import TransferAllWorkButton from '@/app/components/TransferAllWorkButton'
import DaewoongStaffTab from './_components/DaewoongStaffTab'
import HospitalDeviceSummary from './_components/HospitalDeviceSummary'
import StatusBadge from '@/app/components/StatusBadge'
import SiteVisitsCard from './_components/SiteVisitsCard'
import InstallPlansCard from './_components/InstallPlansCard'
import MaintenancesCard from './_components/MaintenancesCard'
import RelatedWikiPagesCard from './_components/RelatedWikiPagesCard'
// 병원 노트 임베드 — 메인→위키 import 승인 예외 (CLAUDE.md 규칙 7, 데이터 교환은 전부 HTTP)
import HospitalNotePanel from '@/app/wiki/components/HospitalNotePanel'
import ConsultationsCard from './_components/ConsultationsCard'
import SalesSection from './_components/SalesSection'
import SystemStatusCard from './_components/SystemStatusCard'
import { canAccessSales } from '@/lib/sales'



export const dynamic = 'force-dynamic'

interface PageProps {
  params: { code: string }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm text-gray-900">{value ?? <span className="text-gray-400">-</span>}</dd>
    </div>
  )
}

export default async function HospitalDetailPage({ params }: PageProps) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  const isAdmin = !!user && user.role !== 'VIEWER'
  const showSales = await canAccessSales(user) // 영업 섹션 — ADMIN 이상 + SEERS 소속만

  const [hospital, projects, siteVisits, installPlans, maintenances, statusCodes, dealProductTypes] = await Promise.all([
    prisma.hospital.findUnique({
      where: { hospitalCode: params.code },
      include: {
        meta: true,
        introTypes: { include: { statusCode: true }, orderBy: { statusCode: { order: 'asc' } } },
        hiraHospital: { select: { permSbdCnt: true, detailSyncedAt: true } },
      },
    }),
    prisma.project.findMany({
      where: { hospitalCode: params.code },
      orderBy: { orderNumber: 'asc' },
      include: {
        assignees: { include: { user: { select: { name: true } } } },
        buildStatus: { select: { label: true, color: true } },
      },
    }),
    prisma.siteVisit.findMany({
      where: { hospitalCode: params.code },
      orderBy: { requestDate: { sort: 'desc', nulls: 'last' } },
      include: {
        daewoongUser: { select: { id: true, name: true } },
        assignees: { include: { user: { select: { id: true, name: true } } } },
        status: { select: { name: true, color: true } },
      },
    }),
    prisma.installPlan.findMany({
      where: { hospitalCode: params.code },
      orderBy: { requestDate: { sort: 'desc', nulls: 'last' } },
      include: {
        status: { select: { id: true, name: true, color: true } },
        assignees: { include: { user: { select: { id: true, name: true } } } },
      },
    }),
    prisma.maintenance.findMany({
      where: { hospitalCode: params.code },
      orderBy: { reportedAt: { sort: 'desc', nulls: 'last' } },
      include: {
        type: { select: { name: true, color: true } },
        status: { select: { name: true, color: true } },
        assignees: { include: { user: { select: { id: true, name: true } } } },
      },
    }),
    prisma.statusCode.findMany({ where: { category: 'HOSPITAL' }, select: { name: true, color: true } }),
    prisma.salesDeal.findMany({ where: { hospitalCode: params.code }, select: { productType: true }, distinct: ['productType'] }),
  ])
  if (!hospital) notFound()

  const statusColor = statusCodes.find((sc) => sc.name === hospital.status)?.color ?? null
  const introTypeList = hospital.introTypes ?? []
  // 판매상품유형 — 이 병원 딜들의 productType 합집합 (일반/라이트 공존 시 둘 다 표시)
  const productTypes = ['일반', '라이트'].filter((t) => dealProductTypes.some((d) => d.productType === t))

  const siteVisitsData = siteVisits.map((sv) => ({
    id: sv.id,
    requestDate: sv.requestDate ? sv.requestDate.toISOString() : null,
    visitDate: sv.visitDate ? sv.visitDate.toISOString() : null,
    replyDate: sv.replyDate ? sv.replyDate.toISOString() : null,
    status: sv.status ?? null,
    daewoongUser: sv.daewoongUser ?? null,
    assignees: sv.assignees ?? [],
  }))

  const installPlansData = installPlans.map((ip) => ({
    id: ip.id,
    planCode: ip.planCode ?? null,
    requestDate: ip.requestDate ? ip.requestDate.toISOString() : null,
    status: ip.status ?? null,
    replyDate: ip.replyDate ? ip.replyDate.toISOString() : null,
    assignees: ip.assignees ?? [],
  }))

  const maintenancesData = maintenances.map((m) => ({
    id: m.id,
    reportedAt: m.reportedAt ? m.reportedAt.toISOString() : null,
    resolvedAt: m.resolvedAt ? m.resolvedAt.toISOString() : null,
    title: m.title,
    priority: m.priority,
    isRemote: m.isRemote,
    type: m.type ?? null,
    status: m.status ?? null,
    assignees: m.assignees ?? [],
  }))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/hospitals"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
            >
              ← 목록으로
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{hospital.hospitalName}</h1>
              <p className="mt-0.5 font-mono text-sm text-gray-400">{hospital.hospitalCode}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/hospitals/${hospital.hospitalCode}/edit`}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              수정
            </Link>
            <TransferAllWorkButton
              fromHospitalCode={hospital.hospitalCode}
              fromHospitalName={hospital.hospitalName}
              canTransfer={user?.role === 'SUPER_ADMIN'}
            />
            <DeleteButton code={hospital.hospitalCode} />
          </div>
        </div>

        {/* 기본 정보 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">기본 정보</h2>
          </div>
          <dl className="grid grid-cols-1 gap-6 px-6 py-5 sm:grid-cols-3">
            <Field label="병원코드" value={<span className="font-mono">{hospital.hospitalCode}</span>} />
            <Field label="심평원 병원명" value={hospital.hiraHospitalName} />
            <Field label="병원명" value={hospital.hospitalName} />
          </dl>
          <dl className="grid grid-cols-1 gap-6 border-t border-gray-100 px-6 py-5 sm:grid-cols-3">
            <Field label="종별" value={hospital.type || <span className="text-gray-400">-</span>} />
            <Field
              label="전체 병상수 (심평원)"
              value={
                hospital.hiraHospital?.permSbdCnt != null
                  ? `${hospital.hiraHospital.permSbdCnt.toLocaleString()}병상`
                  : null
              }
            />
            <Field label="주소" value={hospital.address} />
          </dl>
        </div>

        {/* 대웅제약 담당자 */}
        <div className="mt-4">
          <DaewoongStaffTab hospitalCode={hospital.hospitalCode} isAdmin={isAdmin} />
        </div>

        {/* thynC 도입현황 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">thynC 현황</h2>
          </div>
          <dl className="grid grid-cols-1 gap-6 px-6 py-5 sm:grid-cols-4">
            <Field
              label="상태"
              value={<StatusBadge label={hospital.status} color={statusColor} />}
            />
            <Field
              label="판매상품유형"
              value={
                productTypes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {productTypes.map((t) => (
                      <span
                        key={t}
                        className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: t === '라이트' ? '#0ea5e9' : '#64748b' }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null
              }
            />
            <Field
              label="도입형태"
              value={
                introTypeList.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {introTypeList.map((it) => (
                      <span key={it.id} className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                        {it.statusCode.name}
                      </span>
                    ))}
                  </div>
                ) : null
              }
            />
            <Field
              label="(최초)계약일"
              value={hospital.contractDate ? new Date(hospital.contractDate).toLocaleDateString('ko-KR') : null}
            />
          </dl>
          {/* 도입 현황 — 디바이스 원장 요약(D12, P1 임시 플레이스홀더 → P4에서 실데이터) */}
          <div className="border-t border-gray-100 px-6 py-5">
            <HospitalDeviceSummary hospitalCode={hospital.hospitalCode} introBeds={hospital.introBeds} />
          </div>
        </div>

        {/* 영업 정보 (영업/CRM v4 — ADMIN 이상+SEERS만 렌더, API에서 재검증) */}
        {showSales && <SalesSection hospitalCode={hospital.hospitalCode} currentUserId={user?.userId ?? null} />}

        {/* thynC 시스템 현황 — 서버 현황 + EMR 연동 정보 (2026-08-16) */}
        <SystemStatusCard hospitalCode={hospital.hospitalCode} canWrite={isAdmin} />

        {/* 답사 관리 */}
        <SiteVisitsCard
          hospitalCode={hospital.hospitalCode}
          siteVisits={siteVisitsData}
          isAdmin={isAdmin}
        />

        {/* 설치계획(가안) 관리 */}
        <InstallPlansCard
          hospitalCode={hospital.hospitalCode}
          installPlans={installPlansData}
          isAdmin={isAdmin}
        />

        {/* 유지보수 */}
        <MaintenancesCard
          hospitalCode={hospital.hospitalCode}
          maintenances={maintenancesData}
          isAdmin={isAdmin}
        />

        {/* 구축 프로젝트 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">구축 프로젝트</h2>
            {isAdmin && (
              <Link
                href={`/projects/new?hospitalCode=${hospital.hospitalCode}`}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                프로젝트 등록
              </Link>
            )}
          </div>
          {projects.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-gray-400">등록된 프로젝트가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['차수', '프로젝트 코드', '계약일', '구축 담당자', '진행상태'].map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {projects.map((p) => (
                    <tr key={p.id} className="cursor-pointer transition-colors hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{p.orderNumber}차</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link href={`/projects/${p.projectCode}`} className="font-mono text-xs text-blue-600 hover:underline">
                          {p.projectCode}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {p.contractDate ? new Date(p.contractDate).toLocaleDateString('ko-KR') : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {p.assignees?.length > 0 ? p.assignees.map((a: { user: { name: string } }) => a.user.name).join(', ') : p.builderNameManual ?? <span className="text-gray-400">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {p.buildStatus
                          ? <StatusBadge label={p.buildStatus.label} color={p.buildStatus.color} />
                          : <span className="text-gray-400 text-sm">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 상담이력 — AI 어시스턴트 상담 정리 산출물 (SEERS 소속만 조회, 서버에서 강제) */}
        <ConsultationsCard
          hospitalCode={hospital.hospitalCode}
          currentUserId={user?.userId ?? null}
          isAdmin={isAdminOrAbove(user?.role ?? '')}
        />

        {/* 병원 노트 — 위키 '병원 노트' 페이지 임베드 (사람이 쓰는 병원 특이사항 메모) */}
        <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">🗒️ 병원 노트</h2>
          <HospitalNotePanel hospitalCode={hospital.hospitalCode} />
        </div>

        <RelatedWikiPagesCard hospitalCode={hospital.hospitalCode} />

      </div>
    </div>
  )
}
