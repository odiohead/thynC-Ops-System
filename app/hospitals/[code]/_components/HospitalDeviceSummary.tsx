import Link from 'next/link'
import { getHospitalDeviceSummary, type ModelSummary } from '@/lib/deviceRegistry'
import { DEVICE_EVENT_TYPE_LABELS, toYmd, type DeviceEventType } from '@/lib/deviceRegistryShared'

/**
 * 병원 상세 '도입 현황' — 디바이스 원장 요약 (hospital_device_registry_design.md §6.2, D12)
 *
 * 서버 컴포넌트가 `getHospitalDeviceSummary(code)`를 **직접 호출**한다(API 경유 아님 — 상세 페이지 권한을 따름).
 * - 모델(serial_tracked) 행: 배치 중 / 계약(hard=수치·soft='참고 n'·none='—') / 차이(hard만) / 최근 이벤트
 * - 원장 없음(activeTotal=0): 헤더·계약 열 유지 + '[디바이스 원장에서 임포트]' 링크
 * - 계약완료 딜 없음: 계약 축 모델(ECG·SpO2) 계약 열 '— (계약완료 딜 없음)'
 * 도입 병상 수(`hospitals.intro_beds`) 입력은 병원 수정 폼·Excel 가져오기·병원 PUT에 있으므로 여기서는 표시만 한다.
 */
const COLUMNS = ['모델', '배치 중', '계약', '차이', '최근 이벤트'] as const

/** 계약 축이 있는 모델(온프렘 type 1=ECG hard, 3=SpO2 soft) — 딜 0건이면 compare='none'이 되므로 타입으로 판별 */
const CONTRACT_AXIS_TYPES = new Set([1, 3])

function fmtMd(v: string | null | undefined): string | null {
  const s = toYmd(v)
  return s ? s.slice(5) : null
}

function eventLabel(ev: ModelSummary['lastEvent']): string {
  if (!ev) return '—'
  const label = DEVICE_EVENT_TYPE_LABELS[ev.type as DeviceEventType] ?? ev.type
  return `${fmtMd(ev.on) ?? '?'} ${label}`
}

function Dash({ note }: { note?: string }) {
  return (
    <span className="text-gray-400">
      —{note ? <span className="ml-1 text-xs">({note})</span> : null}
    </span>
  )
}

function ContractCell({ m, noDeals }: { m: ModelSummary; noDeals: boolean }) {
  if (m.compare === 'hard' && m.expected != null) {
    return <span className="tabular-nums text-gray-900">{m.expected.toLocaleString()}</span>
  }
  if (m.compare === 'soft' && m.expected != null) {
    return (
      <span className="tabular-nums text-gray-600" title="심전계 계약 수량과 동수로 가정한 참고값">
        참고 {m.expected.toLocaleString()}
      </span>
    )
  }
  if (noDeals && m.onpremDeviceType != null && CONTRACT_AXIS_TYPES.has(m.onpremDeviceType)) {
    return <Dash note="계약완료 딜 없음" />
  }
  return <Dash />
}

function DiffCell({ m }: { m: ModelSummary }) {
  if (m.compare !== 'hard' || m.diff == null) return <Dash />
  if (m.diff === 0) return <span className="tabular-nums text-green-700">0</span>
  const short = m.diff < 0
  return (
    <span
      className={`tabular-nums font-medium ${short ? 'text-red-600' : 'text-amber-600'}`}
      title={short ? '계약 수량보다 적게 배치됨' : '계약 수량보다 많이 배치됨'}
    >
      {short ? `−${Math.abs(m.diff).toLocaleString()}` : `+${m.diff.toLocaleString()}`}
      <span className="ml-1 text-xs">▲</span>
    </span>
  )
}

export default async function HospitalDeviceSummary({
  hospitalCode,
  introBeds,
}: {
  hospitalCode: string
  introBeds: number | null
}) {
  const ledgerHref = `/devices?hospital=${encodeURIComponent(hospitalCode)}`
  const importHref = `${ledgerHref}&tab=import`
  const editHref = `/hospitals/${encodeURIComponent(hospitalCode)}/edit`

  let summary: Awaited<ReturnType<typeof getHospitalDeviceSummary>> = null
  let loadError = false
  try {
    summary = await getHospitalDeviceSummary(hospitalCode)
  } catch (err) {
    console.error('[HospitalDeviceSummary] getHospitalDeviceSummary failed:', err)
    loadError = true
  }

  // 제3자 기기(링BP·참BP·RTLS)는 배치가 있을 때만 행 노출 — 계약 축 모델(웨어러블·GW)은 0대여도 헤더·계약 열 유지(§6.2)
  const models = (summary?.models ?? []).filter((m) => m.deviceClass !== 'THIRD_PARTY' || m.active > 0)
  const noDeals = (summary?.contractedDeals.length ?? 0) === 0
  const empty = !summary || summary.activeTotal === 0
  const lastImportMd = summary?.lastImport ? fmtMd(summary.lastImport.createdAt) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400">도입 현황</p>
        <Link
          href={ledgerHref}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
        >
          디바이스 원장 열기 →
        </Link>
      </div>

      <p className="text-sm text-gray-700">
        도입 병상 수{' '}
        <span className="font-medium tabular-nums text-gray-900">
          {introBeds != null ? `${introBeds.toLocaleString()}병상` : '-'}
        </span>
        <span className="ml-1.5 text-xs text-gray-400">
          (수정은{' '}
          <Link href={editHref} className="underline decoration-gray-300 underline-offset-2 hover:text-gray-600">
            병원 수정
          </Link>{' '}
          폼)
        </span>
      </p>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {COLUMNS.map((col, i) => (
                <th
                  key={col}
                  className={`whitespace-nowrap px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 ${
                    i === 1 || i === 2 || i === 3 ? 'text-right' : 'text-left'
                  }`}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {loadError ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-3 text-sm text-red-600">
                  도입 현황을 불러오지 못했습니다.
                </td>
              </tr>
            ) : models.length === 0 ? (
              <tr>
                {COLUMNS.map((col) => (
                  <td key={col} className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-400">
                    —
                  </td>
                ))}
              </tr>
            ) : (
              models.map((m) => (
                <tr key={m.deviceInfoId}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-900">
                    {m.deviceName}
                    <span className="ml-1.5 font-mono text-xs text-gray-400">{m.deviceModel}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm">
                    {empty ? (
                      <Dash />
                    ) : (
                      <span className="tabular-nums font-medium text-gray-900">{m.active.toLocaleString()}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm">
                    <ContractCell m={m} noDeals={noDeals} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm">
                    {empty ? <Dash /> : <DiffCell m={m} />}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">
                    {m.lastEvent ? eventLabel(m.lastEvent) : <Dash />}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loadError && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
          <span>
            최근 30일 회수{' '}
            <span className="tabular-nums font-medium text-gray-700">{summary?.recovered30dTotal ?? 0}</span>건
          </span>
          <span aria-hidden>·</span>
          <span>
            마지막 임포트{' '}
            <span className="tabular-nums font-medium text-gray-700">{lastImportMd ?? '없음'}</span>
          </span>
          {empty && (
            <>
              <span aria-hidden>·</span>
              <span className="text-gray-400">원장에 등록된 기기가 없습니다.</span>
              <Link href={importHref} className="font-medium text-blue-600 hover:text-blue-700 hover:underline">
                디바이스 원장에서 임포트 →
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  )
}
