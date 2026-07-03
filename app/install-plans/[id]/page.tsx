import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { verifyToken, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import InstallPlanDetailClient from './DetailClient'
import ReassignHospitalButton from '@/app/components/ReassignHospitalButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: '설치계획(가안) 상세' }

interface Props { params: { id: string } }

const labelClass = 'text-xs font-medium uppercase tracking-wider text-gray-400'

export default async function InstallPlanDetailPage({ params }: Props) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null

  if (!user) redirect('/login')

  const id = parseInt(params.id)
  if (isNaN(id)) notFound()

  const installPlan = await prisma.installPlan.findUnique({
    where: { id },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, sidoName: true, sigunguName: true, address: true, status: true } },
      assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
      files: { orderBy: { uploadedAt: 'asc' } },
    },
  })

  if (!installPlan) notFound()

  const canAdmin = isAdminOrAbove(user.role)
  const canEdit = user.role !== 'VIEWER'

  const data = {
    id: installPlan.id,
    planCode: installPlan.planCode,
    hospitalCode: installPlan.hospitalCode,
    hospital: installPlan.hospital,
    requestDate: installPlan.requestDate ? installPlan.requestDate.toISOString() : null,
    writeStatus: installPlan.writeStatus,
    replyStatus: installPlan.replyStatus,
    assignees: installPlan.assignees,
    replyDate: installPlan.replyDate ? installPlan.replyDate.toISOString() : null,
    note: installPlan.note,
    files: installPlan.files.map((f) => ({
      id: f.id,
      fileCategory: f.fileCategory,
      fileName: f.fileName,
      s3Key: f.s3Key,
    })),
  }

  const hospital = installPlan.hospital

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">설치계획(가안) 상세</h1>
          {installPlan.planCode && (
            <p className="mt-1 font-mono text-sm text-gray-400">{installPlan.planCode}</p>
          )}
        </div>

        {/* 병원 기본정보 카드 */}
        {hospital && (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm mb-4">
            <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">병원 기본정보</h2>
              <Link href={`/hospitals/${hospital.hospitalCode}`} className="text-xs text-blue-600 hover:underline">
                병원 상세 →
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-3">
              <div>
                <p className={labelClass}>병원명</p>
                <p className="mt-1 text-sm text-gray-900">{hospital.hospitalName}</p>
                {hospital.hiraHospitalName && hospital.hiraHospitalName !== hospital.hospitalName && (
                  <p className="mt-0.5 text-xs text-gray-400">{hospital.hiraHospitalName}</p>
                )}
              </div>
              <div>
                <p className={labelClass}>지역</p>
                <p className="mt-1 text-sm text-gray-900">
                  {[hospital.sidoName, hospital.sigunguName].filter(Boolean).join(' ') || '-'}
                </p>
              </div>
              <div>
                <p className={labelClass}>상태</p>
                <p className="mt-1 text-sm text-gray-900">{hospital.status || '-'}</p>
              </div>
              <div className="sm:col-span-3">
                <p className={labelClass}>주소</p>
                <p className="mt-1 text-sm text-gray-900">{hospital.address || '-'}</p>
              </div>
            </div>
          </div>
        )}

        {installPlan.planCode && canAdmin && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-gray-400">병원이 잘못 지정되었나요?</span>
            <ReassignHospitalButton
              type="INSTALL_PLAN"
              code={installPlan.planCode}
              currentHospitalCode={installPlan.hospitalCode}
              currentHospitalName={hospital?.hospitalName}
              canReassign={canAdmin}
            />
          </div>
        )}

        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <InstallPlanDetailClient initialData={data} canAdmin={canAdmin} canEdit={canEdit} />
        </div>
      </div>
    </div>
  )
}
