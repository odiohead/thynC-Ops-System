import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
import DeleteButton from './_components/DeleteButton'
import CopyButton from './_components/CopyButton'

interface PageProps {
  params: { id: string }
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
  const id = parseInt(params.id)
  if (isNaN(id)) notFound()

  const hospital = await prisma.hospital.findUnique({ where: { id } })
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
              href={`/hospitals/${hospital.id}/edit`}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              수정
            </Link>
            <DeleteButton id={hospital.id} />
          </div>
        </div>

        {/* 기본 정보 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">기본 정보</h2>
          </div>
          <dl className="grid grid-cols-1 gap-6 px-6 py-5 sm:grid-cols-2">
            <Field label="병원코드" value={<span className="font-mono">{hospital.hospitalCode}</span>} />
            <Field
              label="상태"
              value={
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle}`}>
                  {hospital.status}
                </span>
              }
            />
            <Field label="병원명" value={hospital.name} />
            <Field label="종별" value={hospital.type} />
          </dl>
        </div>

        {/* 위치 정보 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">위치 정보</h2>
          </div>
          <dl className="grid grid-cols-1 gap-6 px-6 py-5 sm:grid-cols-2">
            <Field label="시도코드" value={hospital.sidoCode} />
            <Field label="시도명" value={hospital.sidoName} />
            <Field label="시군구코드" value={hospital.sigunguCode} />
            <Field label="시군구명" value={hospital.sigunguName} />
            <Field label="읍면동" value={hospital.eupmyeondong} />
            <Field label="우편번호" value={hospital.postalCode} />
            <div className="sm:col-span-2">
              <Field label="주소" value={hospital.address} />
            </div>
          </dl>
        </div>

        {/* 기타 정보 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">기타 정보</h2>
          </div>
          <dl className="grid grid-cols-1 gap-6 px-6 py-5 sm:grid-cols-2">
            <Field
              label="심평원 ID"
              value={
                hospital.hiraId ? (
                  <span className="flex items-center">
                    <span className="truncate font-mono text-sm" title={hospital.hiraId}>
                      {hospital.hiraId}
                    </span>
                    <CopyButton value={hospital.hiraId} />
                  </span>
                ) : null
              }
            />
            <Field label="X 좌표" value={hospital.coordinateX} />
            <Field label="Y 좌표" value={hospital.coordinateY} />
            <Field
              label="등록일"
              value={hospital.createdAt.toLocaleDateString('ko-KR', {
                year: 'numeric', month: '2-digit', day: '2-digit',
              })}
            />
            <Field
              label="최종 수정일"
              value={hospital.updatedAt.toLocaleDateString('ko-KR', {
                year: 'numeric', month: '2-digit', day: '2-digit',
              })}
            />
          </dl>
        </div>

      </div>
    </div>
  )
}
