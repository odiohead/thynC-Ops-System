import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import DeleteButton from './_components/DeleteButton'
import DaewoongStaffTab from './_components/DaewoongStaffTab'
import DriveFolderRow from './_components/DriveFolderRow'
import HospitalDevicesSection from './_components/HospitalDevicesSection'

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

const STATUS_STYLE: Record<string, string> = {
  계약: 'bg-green-100 text-green-700',
  해지: 'bg-red-100 text-red-700',
  대기: 'bg-yellow-100 text-yellow-700',
}

export default async function HospitalDetailPage({ params }: PageProps) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  const isAdmin = user?.role === 'ADMIN'

  const [hospital, projects, allDevices, hospitalDevices] = await Promise.all([
    prisma.hospital.findUnique({
      where: { hospitalCode: params.code },
      include: { meta: true },
    }),
    prisma.project.findMany({
      where: { hospitalCode: params.code },
      orderBy: { orderNumber: 'asc' },
      include: { builder: { select: { name: true } } },
    }),
    prisma.deviceInfo.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.hospitalDevice.findMany({ where: { hospitalCode: params.code } }),
  ])
  if (!hospital) notFound()

  const statusStyle = STATUS_STYLE[hospital.status] ?? 'bg-gray-100 text-gray-600'
  const introTypeList = hospital.introType ? hospital.introType.split(',') : []

  const quantityMap = new Map(hospitalDevices.map((d) => [d.deviceInfoId, d.quantity]))
  const deviceRows = allDevices.map((d) => ({
    deviceInfoId: d.id,
    deviceModel: d.deviceModel,
    deviceName: d.deviceName,
    quantity: quantityMap.get(d.id) ?? 0,
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
          <dl className="grid grid-cols-1 gap-6 border-t border-gray-100 px-6 py-5 sm:grid-cols-2">
            <Field label="종별" value={hospital.type || <span className="text-gray-400">-</span>} />
            <div className="sm:col-span-2">
              <Field label="주소" value={hospital.address} />
            </div>
          </dl>
        </div>

        {/* 대웅제약 담당자 */}
        <div className="mt-4">
          <DaewoongStaffTab hospitalCode={hospital.hospitalCode} />
        </div>

        {/* thynC 도입현황 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">thynC 현황</h2>
          </div>
          <dl className="grid grid-cols-1 gap-6 px-6 py-5 sm:grid-cols-3">
            <Field
              label="상태"
              value={
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle}`}>
                  {hospital.status}
                </span>
              }
            />
            <Field
              label="도입형태"
              value={
                introTypeList.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {introTypeList.map((t) => (
                      <span key={t} className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null
              }
            />
            <DriveFolderRow
              hospitalCode={hospital.hospitalCode}
              initialFolderId={hospital.meta?.driveProjectFolderId ?? null}
            />
          </dl>
          <div className="border-t border-gray-100 px-6 py-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">도입 현황</p>
            <HospitalDevicesSection
              hospitalCode={hospital.hospitalCode}
              initialIntroBeds={hospital.introBeds}
              initialDevices={deviceRows}
            />
          </div>
        </div>

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
                    {['차수', '프로젝트 코드', '계약일', '구축 담당자', '완료 여부'].map((col) => (
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
                        {p.builder?.name ?? p.builderNameManual ?? <span className="text-gray-400">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          p.isCompleted ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {p.isCompleted ? '완료' : '진행중'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
