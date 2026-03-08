import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import CopyButton from '../_components/CopyButton'

export const dynamic = 'force-dynamic'

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm text-gray-900">
        {value ?? <span className="text-gray-400">-</span>}
      </dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      </div>
      <dl className="grid grid-cols-1 gap-6 px-6 py-5 sm:grid-cols-2">
        {children}
      </dl>
    </div>
  )
}

export default async function HiraHospitalDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (isNaN(id)) notFound()

  const h = await prisma.hiraHospital.findUnique({ where: { id } })
  if (!h) notFound()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/hira-hospitals"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
          >
            ← 목록으로
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{h.name}</h1>
            <p className="mt-0.5 text-sm text-gray-400">{h.typeName}</p>
          </div>
        </div>

        <div className="space-y-4">

          {/* 기본 정보 */}
          <Section title="기본 정보">
            <Field label="병원명" value={h.name} />
            <Field label="개설일" value={h.openedAt} />
            <Field label="종별코드" value={<span className="font-mono">{h.typeCode}</span>} />
            <Field label="종별명" value={h.typeName} />
          </Section>

          {/* 위치 정보 */}
          <Section title="위치 정보">
            <Field label="시도코드" value={h.sidoCode} />
            <Field label="시도명" value={h.sidoName} />
            <Field label="시군구코드" value={h.sigunguCode} />
            <Field label="시군구명" value={h.sigunguName} />
            <Field label="읍면동" value={h.eupmyeondong} />
            <Field label="우편번호" value={h.postalCode} />
            <div className="sm:col-span-2">
              <Field label="주소" value={h.address} />
            </div>
          </Section>

          {/* 연락처 */}
          <Section title="연락처">
            <Field label="전화번호" value={h.phone} />
          </Section>

          {/* 의료진 */}
          <Section title="의료진">
            <Field
              label="총 의사 수"
              value={h.totalDoctors != null ? `${h.totalDoctors.toLocaleString()}명` : null}
            />
          </Section>

          {/* 기타 */}
          <Section title="기타 정보">
            <Field
              label="심평원 ID"
              value={
                h.hiraId ? (
                  <span className="flex items-center">
                    <span className="truncate font-mono text-sm" title={h.hiraId}>
                      {h.hiraId}
                    </span>
                    <CopyButton value={h.hiraId} />
                  </span>
                ) : null
              }
            />
            <Field label="X 좌표" value={h.coordinateX} />
            <Field label="Y 좌표" value={h.coordinateY} />
            <Field
              label="등록일"
              value={h.createdAt.toLocaleDateString('ko-KR', {
                year: 'numeric', month: '2-digit', day: '2-digit',
              })}
            />
          </Section>

        </div>
      </div>
    </div>
  )
}
