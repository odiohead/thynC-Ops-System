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

  const h = await prisma.hiraHospital.findUnique({
    where: { id },
    include: { depts: { orderBy: { dgsbjtCd: 'asc' } } },
  })
  if (!h) notFound()

  const fmtSynced = (d: Date | null) =>
    d ? d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : null

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
          <Section title="의료진 · 시설">
            <Field
              label="총 의사 수"
              value={h.totalDoctors != null ? `${h.totalDoctors.toLocaleString()}명` : null}
            />
            <Field
              label="허가 병상수"
              value={
                h.permSbdCnt != null
                  ? <>{h.permSbdCnt.toLocaleString()}병상 <span className="text-xs text-gray-400">({fmtSynced(h.detailSyncedAt)} 연동)</span></>
                  : null
              }
            />
          </Section>

          {/* 진료과목·전문의 (심평원 상세연동 v2) */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">진료과목 · 전문의</h2>
              <p className="text-xs text-gray-400">
                진료과목 {h.deptSyncedAt ? `${fmtSynced(h.deptSyncedAt)} 연동` : '미연동'} · 전문의수 {h.sdrSyncedAt ? `${fmtSynced(h.sdrSyncedAt)} 연동` : '미연동'}
              </p>
            </div>
            {h.depts.length === 0 ? (
              <p className="px-6 py-6 text-sm text-gray-400">연동된 진료과목 정보가 없습니다. 설정 &gt; 심평원 연동 관리에서 병원상세정보연동을 실행하세요.</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-2.5 text-left text-xs font-medium text-gray-500">진료과목</th>
                    <th className="px-6 py-2.5 text-right text-xs font-medium text-gray-500">진료과목 전문의</th>
                    <th className="px-6 py-2.5 text-right text-xs font-medium text-gray-500">전문과목 전문의</th>
                    <th className="px-6 py-2.5 text-right text-xs font-medium text-gray-500">선택진료의사</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {h.depts.map((d) => (
                    <tr key={d.id}>
                      <td className="px-6 py-2 text-sm text-gray-900">{d.dgsbjtNm} <span className="font-mono text-xs text-gray-400">{d.dgsbjtCd}</span></td>
                      <td className="px-6 py-2 text-right text-sm tabular-nums text-gray-700">{d.prSdrCnt != null ? d.prSdrCnt.toLocaleString() : <span className="text-gray-300">-</span>}</td>
                      <td className="px-6 py-2 text-right text-sm tabular-nums text-gray-700">{d.dtlSdrCnt != null ? d.dtlSdrCnt.toLocaleString() : <span className="text-gray-300">-</span>}</td>
                      <td className="px-6 py-2 text-right text-sm tabular-nums text-gray-700">{d.cdiagDrCnt != null ? d.cdiagDrCnt.toLocaleString() : <span className="text-gray-300">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

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
