import Link from 'next/link'

/**
 * 병원 상세 '도입 현황' — 디바이스 원장 요약 (hospital_device_registry_design.md §6.2, D12)
 *
 * ⚠️ P1 임시 플레이스홀더(읽기 전용). 구 HospitalDevicesSection(병원×모델 수량 입력)을 대체한다.
 * P4에서 `getHospitalDeviceSummary(code)`(lib/deviceRegistry.ts) 직접 호출로 모델별 배치 중/계약/차이/최근 이벤트 행을 채운다.
 * 도입 병상 수(`hospitals.intro_beds`) 입력은 병원 수정 폼·Excel 가져오기·병원 PUT에 있으므로 여기서는 표시만 한다.
 */
const COLUMNS = ['모델', '배치 중', '계약', '차이', '최근 이벤트'] as const

export default function HospitalDeviceSummary({
  hospitalCode,
  introBeds,
}: {
  hospitalCode: string
  introBeds: number | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400">도입 현황</p>
        <Link
          href={`/devices?hospital=${encodeURIComponent(hospitalCode)}`}
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
        <span className="ml-1.5 text-xs text-gray-400">(수정은 병원 수정 폼)</span>
      </p>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col}
                  className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            <tr>
              {COLUMNS.map((col) => (
                <td key={col} className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-400">
                  —
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
