import Link from 'next/link'
import { getHospitalDeviceSummary, type ModelSummary, type ProductTypeKey } from '@/lib/deviceRegistry'
import { DEVICE_EVENT_TYPE_LABELS, PRODUCT_TYPES, PRODUCT_TYPE_UNSET_LABEL, toYmd, type DeviceEventType } from '@/lib/deviceRegistryShared'
import HospitalDeviceSupplyModal from './HospitalDeviceSupplyModal'

/**
 * 병원 상세 '도입 현황' — 디바이스 원장 요약 (hospital_device_registry_design.md §6.2, D12)
 *
 * 서버 컴포넌트가 `getHospitalDeviceSummary(code)`를 **직접 호출**한다(API 경유 아님 — 상세 페이지 권한을 따름).
 * - 모델(serial_tracked) 행: 배치 중(계약 축 행은 평가용 제외 수 + '(평가용 n 별도)') / 계약(hard=수치·soft='참고 n'·none='—') / 차이(hard만, 평가용 제외 §9.1) / 최근 이벤트
 * - 원장 없음(activeTotal=0): 헤더·계약 열 유지 + '[디바이스 원장에서 임포트]' 링크
 * - 계약완료 딜 없음: 계약 축 모델(ECG·SpO2) 계약 열 '— (계약완료 딜 없음)'
 * - 상품유형 매트릭스(B-22): productTypeMixed면 모델 행 아래 '└ 일반 | 라이트 | 미지정' 소행(byProductType) + 하단 '교체 n건(일반 a · 라이트 b)'
 * 도입 병상 수(`hospitals.intro_beds`) 입력은 병원 수정 폼·Excel 가져오기·병원 PUT에 있으므로 여기서는 표시만 한다.
 * 비계약 공급(대웅 직판 — third_party_supply_design.md, 2026-11-02): '공급 현황 관리' 기기는 0대여도 행 상시 노출, '계약/공급' 열에 `공급(대웅) m`,
 * canWrite면 행 옆 연필 → HospitalDeviceSupplyModal(수량·파악일·비고), 값 있으면 소행(파악일·비고).
 */
const COLUMNS = ['모델', '배치 중', '계약/공급', '차이', '최근 이벤트'] as const
const PT_KEYS: readonly ProductTypeKey[] = [...PRODUCT_TYPES, PRODUCT_TYPE_UNSET_LABEL]

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
  // 비계약 공급(대웅 직판) — 공급만: '공급(대웅) m' / 딜+공급: 'a + 공급 b' (툴팁에 파악일·비고·수정자)
  if (m.supply && m.compare === 'hard' && m.expected != null) {
    const sup = m.supply
    const tip = [`${sup.supplier} 직판(비계약) 공급 수량 ${sup.quantity.toLocaleString()}대`, sup.checkedOn ? `파악 ${sup.checkedOn}` : null, sup.note ? `비고: ${sup.note}` : null, sup.updatedByName ? `수정 ${sup.updatedByName}` : null].filter(Boolean).join('\n')
    if (m.expectedSource === 'BOTH') {
      const deal = m.expected - sup.quantity
      return <span className="tabular-nums text-gray-900" title={tip}>{deal.toLocaleString()} <span className="text-xs text-violet-700">+ 공급 {sup.quantity.toLocaleString()}</span></span>
    }
    return <span className="whitespace-nowrap tabular-nums text-violet-700" title={tip}><span className="text-xs">공급({sup.supplier.replace('제약', '')})</span> <span className="font-medium">{sup.quantity.toLocaleString()}</span></span>
  }
  if (m.compare === 'hard' && m.expected != null) {
    return <span className="tabular-nums text-gray-900">{m.expected.toLocaleString()}</span>
  }
  if (m.supplyTracked) return <Dash note="공급 수량 미입력" />
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

/** 배치 중 — 계약 축 행은 대조 기준(평가용 제외), 평가용은 '(평가용 n 별도)'로 병기 */
function ActiveCell({ m }: { m: ModelSummary }) {
  const activeEval = m.activeEval ?? 0
  const shown = m.compare === 'none' ? m.active : (m.activeForCompare ?? m.active - activeEval)
  return (
    <span title={activeEval > 0 ? `배치 중 전체 ${m.active.toLocaleString()}대 (평가용 ${activeEval.toLocaleString()}대는 계약 대조 제외)` : undefined}>
      <span className="tabular-nums font-medium text-gray-900">{shown.toLocaleString()}</span>
      {activeEval > 0 && <span className="ml-1 whitespace-nowrap text-xs text-amber-700">(평가용 {activeEval.toLocaleString()} 별도)</span>}
    </span>
  )
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
  canWrite = false,
}: {
  hospitalCode: string
  introBeds: number | null
  /** 공급 수량(대웅 직판) 입력 가능 — USER 등급 이상(쟁점 1) */
  canWrite?: boolean
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
  // 단, '공급 현황 관리' 기기(supplyTracked)는 입력 진입점이므로 0대·미입력이어도 상시 노출 (2026-11-02)
  const models = (summary?.models ?? []).filter((m) => m.deviceClass !== 'THIRD_PARTY' || m.active > 0 || m.supplyTracked || m.supply)
  const noDeals = (summary?.contractedDeals.length ?? 0) === 0
  const empty = !summary || summary.activeTotal === 0
  const lastImportMd = summary?.lastImport ? fmtMd(summary.lastImport.createdAt) : null
  const matrix = !!summary?.productTypeMixed && !empty
  const repl = summary?.replacements ?? null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400">도입 현황</p>
        <Link
          href={ledgerHref}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
        >
          기기 현황 열기 →
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
              models.flatMap((m) => [
                <tr key={m.deviceInfoId}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-900">
                    {m.deviceName}
                    <span className="ml-1.5 font-mono text-xs text-gray-400">{m.deviceModel}</span>
                    {canWrite && (m.supplyTracked || m.supply) && (
                      <HospitalDeviceSupplyModal
                        hospitalCode={hospitalCode}
                        target={{ deviceInfoId: m.deviceInfoId, deviceName: m.deviceName, deviceModel: m.deviceModel, supplier: m.supply?.supplier ?? '대웅제약', current: m.supply ? { quantity: m.supply.quantity, checkedOn: m.supply.checkedOn, note: m.supply.note } : null }}
                      />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm">
                    {empty && !m.supply ? <Dash /> : <ActiveCell m={m} />}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm">
                    <ContractCell m={m} noDeals={noDeals} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm">
                    {empty && !m.supply ? <Dash /> : <DiffCell m={m} />}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">
                    {m.lastEvent ? eventLabel(m.lastEvent) : <Dash />}
                  </td>
                </tr>,
                ...(m.supply && (m.supply.checkedOn || m.supply.note)
                  ? [
                      <tr key={`${m.deviceInfoId}-supply`} className="bg-violet-50/40">
                        <td colSpan={COLUMNS.length} className="whitespace-nowrap px-4 py-1.5 pl-8 text-xs text-gray-500">
                          <span className="mr-1 text-gray-400">└</span>
                          {m.supply.checkedOn && <span>파악 {m.supply.checkedOn}</span>}
                          {m.supply.checkedOn && m.supply.note && <span className="mx-1.5 text-gray-300">·</span>}
                          {m.supply.note && <span className="text-gray-600">{m.supply.note}</span>}
                        </td>
                      </tr>,
                    ]
                  : []),
                ...(matrix
                  ? PT_KEYS.filter((k) => m.byProductType?.[k]).map((k) => {
                      const c = m.byProductType[k]!
                      const hard = m.compare === 'hard'
                      const unset = k === PRODUCT_TYPE_UNSET_LABEL
                      return (
                        <tr key={`${m.deviceInfoId}-${k}`} className="bg-gray-50/70">
                          <td className="whitespace-nowrap px-4 py-1.5 pl-8 text-xs text-gray-600">
                            <span className="mr-1 text-gray-400">└</span>
                            {unset ? <span className="text-amber-700">{PRODUCT_TYPE_UNSET_LABEL}</span> : <span className={k === '라이트' ? 'rounded bg-blue-50 px-1.5 py-0.5 text-blue-700' : 'rounded bg-gray-100 px-1.5 py-0.5 text-gray-700'}>{k}</span>}
                          </td>
                          <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums text-gray-800">{(m.compare === 'none' ? c.active : c.activeForCompare).toLocaleString()}</td>
                          <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums text-gray-600">
                            {unset || c.expected == null ? '—' : hard ? c.expected.toLocaleString() : `참고 ${c.expected.toLocaleString()}`}
                          </td>
                          <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs tabular-nums">
                            {hard && c.diff != null ? (
                              <span className={c.diff === 0 ? 'text-green-700' : c.diff < 0 ? 'text-red-600' : 'text-amber-600'}>{c.diff === 0 ? '0' : c.diff < 0 ? `−${Math.abs(c.diff).toLocaleString()}` : `+${c.diff.toLocaleString()}`}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-1.5 text-xs text-gray-400">—</td>
                        </tr>
                      )
                    })
                  : []),
              ])
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
          {(summary?.evalTotal ?? 0) > 0 && (
            <>
              <span aria-hidden>·</span>
              <span title="평가용(EVAL) 기기 — 배치 중이지만 계약 대조에서 제외">
                평가용 <span className="tabular-nums font-medium text-amber-700">{summary!.evalTotal}</span>대 별도
              </span>
            </>
          )}
          {summary?.productTypeContext?.mixed && (
            <>
              <span aria-hidden>·</span>
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700" title="계약완료 딜에 일반·라이트가 함께 있는 병원">
                상품유형 혼합
              </span>
            </>
          )}
          {repl && (matrix || repl.total > 0) && (
            <>
              <span aria-hidden>·</span>
              <span title="교체 = 같은 병원 회수와 짝지어진 교체 등록 건수(회수 시점 상품유형 기준)">
                교체 <span className="tabular-nums font-medium text-gray-700">{repl.total}</span>건
                {matrix ? ` (${PT_KEYS.filter((k) => k !== PRODUCT_TYPE_UNSET_LABEL || repl.byType[k] > 0).map((k) => `${k} ${repl.byType[k] ?? 0}`).join(' · ')})` : ''}
                {repl.last30d.total > 0 ? ` · 최근 30일 ${repl.last30d.total}` : ''}
              </span>
            </>
          )}
          {empty && (
            <>
              <span aria-hidden>·</span>
              <span className="text-gray-400">등록된 기기가 없습니다.</span>
              <Link href={importHref} className="font-medium text-blue-600 hover:text-blue-700 hover:underline">
                기기 현황에서 임포트 →
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  )
}
