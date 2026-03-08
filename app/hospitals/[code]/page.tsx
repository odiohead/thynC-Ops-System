import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import DeleteButton from './_components/DeleteButton'
import DaewoongStaffTab from './_components/DaewoongStaffTab'

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
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code } })
  if (!hospital) notFound()

  const statusStyle = STATUS_STYLE[hospital.status] ?? 'bg-gray-100 text-gray-600'

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
              <h1 className="text-2xl font-bold text-gray-900">{hospital.name}</h1>
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
          <dl className="grid grid-cols-1 gap-6 px-6 py-5 sm:grid-cols-2">
            <Field label="병원코드" value={<span className="font-mono">{hospital.hospitalCode}</span>} />
            <Field label="병원 이름" value={hospital.name} />
            <Field
              label="상태"
              value={
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle}`}>
                  {hospital.status}
                </span>
              }
            />
            <Field label="종별" value={hospital.type} />
            <div className="sm:col-span-2">
              <Field label="주소" value={hospital.address} />
            </div>
          </dl>
        </div>

        {/* 대웅제약 담당자 */}
        <div className="mt-4">
          <DaewoongStaffTab hospitalCode={hospital.hospitalCode} />
        </div>

      </div>
    </div>
  )
}
