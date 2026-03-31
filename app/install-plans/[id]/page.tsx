import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { verifyToken, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import InstallPlanDetailClient from './DetailClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: '설치계획(가안) 상세' }

interface Props { params: { id: string } }

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
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      author: { select: { id: true, name: true } },
    },
  })

  if (!installPlan) notFound()

  const canAdmin = isAdminOrAbove(user.role)

  const data = {
    id: installPlan.id,
    hospitalCode: installPlan.hospitalCode,
    hospital: installPlan.hospital,
    requestDate: installPlan.requestDate ? installPlan.requestDate.toISOString() : null,
    writeStatus: installPlan.writeStatus,
    replyStatus: installPlan.replyStatus,
    authorId: installPlan.authorId,
    author: installPlan.author,
    replyDate: installPlan.replyDate ? installPlan.replyDate.toISOString() : null,
    note: installPlan.note,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">설치계획(가안) 상세</h1>
          {installPlan.planCode && (
            <p className="mt-1 font-mono text-sm text-gray-400">{installPlan.planCode}</p>
          )}
        </div>
        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <InstallPlanDetailClient initialData={data} canAdmin={canAdmin} />
        </div>
      </div>
    </div>
  )
}
