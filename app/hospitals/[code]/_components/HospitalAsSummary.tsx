import Link from 'next/link'
import { getHospitalAsSummary, type AsHospitalCategoryStat } from '@/lib/asHospitalSummary'
import type { AsLostQuota } from '@/lib/asReceiptShared'

/**
 * 병원 상세 'thynC 현황 > AS 현황' (2026-10-30) — 고장 / 분실 2열
 * 서버 컴포넌트가 getHospitalAsSummary(code)를 직접 호출(HospitalDeviceSummary 선례). 취소 접수·취소 라인 제외.
 * - 공통: 누적 접수(건·대, 기기군) · 미완료(7일 경과) · 최근 90일 · 최근 접수 3건(링크)
 * - 분실: 교체 제공 / 구매수량(%) 기기군별 — AS 상세 '구분' 필드와 같은 산식(lib/asLostQuota), 한도 초과면 빨간 강조
 */
export default async function HospitalAsSummary({ hospitalCode, hospitalName }: { hospitalCode: string; hospitalName: string }) {
  const s = await getHospitalAsSummary(hospitalCode)
  const listHref = (category: 'FAULT' | 'LOST') => `/as-receipts?q=${encodeURIComponent(hospitalName)}&field=hospital&category=${category}`
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400">AS 현황</p>
        <Link href={`/as-receipts?q=${encodeURIComponent(hospitalName)}&field=hospital`} className="text-xs text-blue-600 hover:underline">AS업무에서 보기 →</Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CategoryBlock title="고장 AS" stat={s.fault} href={listHref('FAULT')} />
        <CategoryBlock title="분실 AS" stat={s.lost} href={listHref('LOST')} quota={s.lostQuota} />
      </div>
    </div>
  )
}

function CategoryBlock({ title, stat, href, quota }: { title: string; stat: AsHospitalCategoryStat; href: string; quota?: AsLostQuota }) {
  const over = !!quota && quota.groups.some((g) => g.overBefore)
  return (
    <div className={`relative rounded-lg border px-4 py-3 ${over ? 'border-red-300 bg-red-50/40' : 'border-gray-200'}`}>
      {over && <span aria-hidden className="pointer-events-none absolute inset-0 animate-pulse rounded-lg border-2 border-red-500" />}
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">
          {title}
          {over && <span className="ml-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">분실 제공 한도 {quota!.thresholdPct}% 초과</span>}
        </p>
        <Link href={href} className="text-xs text-blue-600 hover:underline">목록 →</Link>
      </div>
      {stat.receipts === 0 ? (
        <p className="text-sm text-gray-400">접수 이력 없음</p>
      ) : (
        <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
          <div>
            <dt className="text-[11px] text-gray-400">누적 접수</dt>
            <dd className="text-gray-900"><span className="font-semibold">{stat.receipts}</span>건 · {stat.devices}대</dd>
            <dd className="text-[11px] text-gray-500">{stat.byGroup.map((g) => `${g.group} ${g.count}`).join(' · ') || '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-gray-400">미완료</dt>
            <dd className={stat.open ? 'font-semibold text-gray-900' : 'text-gray-500'}>{stat.open}건{stat.openOver7d > 0 && <span className="ml-1 text-[11px] font-normal text-red-600">7일 경과 {stat.openOver7d}</span>}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-gray-400">최근 90일</dt>
            <dd className="text-gray-900">{stat.last90d}건</dd>
            <dd className="text-[11px] text-gray-500">마지막 {stat.lastReceiptDate ?? '—'}</dd>
          </div>
        </dl>
      )}
      {quota && (
        <div className="mt-2 border-t border-gray-100 pt-2 text-xs" title={`분실 기기 신규 제공 한도 = 구매수량(계약완료 딜 '도입 기기 수량')의 ${quota.thresholdPct}%. 제공 = 분실 접수에서 교체로 확정된 대수`}>
          <p className="mb-0.5 text-[11px] text-gray-400">교체 제공 / 구매수량 (한도 {quota.thresholdPct}%)</p>
          {quota.groups.map((g) => (
            <p key={g.group} className={g.overBefore ? 'font-semibold text-red-700' : 'text-gray-700'}>
              <span className="inline-block w-16 text-gray-500">{g.group}</span>
              {g.purchased === null
                ? <span className="text-gray-400">구매수량 미등록{g.before > 0 ? ` (제공 ${g.before}대)` : ''}</span>
                : <><span className="font-mono">{g.before} / {g.purchased}</span> ({g.pctBefore}%)</>}
            </p>
          ))}
        </div>
      )}
      {stat.recent.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-gray-100 pt-2 text-xs">
          {stat.recent.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-gray-600">
              <Link href={`/as-receipts/${r.id}`} className="font-mono text-blue-600 hover:underline">{r.asCode}</Link>
              <span>{r.receiptDate}</span>
              <span>{r.devices}대</span>
              {r.status && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{r.status}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
