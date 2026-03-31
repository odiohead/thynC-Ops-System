import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import InstallPlanForm from '../InstallPlanForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: '설치계획(가안) 등록' }

interface Props {
  searchParams: { hospitalCode?: string }
}

export default async function NewInstallPlanPage({ searchParams }: Props) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null

  if (!user || !isAdminOrAbove(user.role)) redirect('/install-plans')

  const preHospitalCode = searchParams.hospitalCode ?? ''
  const preHospital = preHospitalCode
    ? await prisma.hospital.findUnique({
        where: { hospitalCode: preHospitalCode },
        select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true },
      })
    : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">설치계획(가안) 등록</h1>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <InstallPlanForm
            mode="new"
            initialHospitalCode={preHospital?.hospitalCode}
            initialHospital={preHospital ?? null}
          />
        </div>
      </div>
    </div>
  )
}
