import Link from 'next/link'
import { getHospitalAsSummary, type AsHospitalCategoryStat } from '@/lib/asHospitalSummary'
import type { AsLostQuota } from '@/lib/asReceiptShared'

/**
 * 병원 상세 'thynC 현황 > AS 현황' (2026-10-30, 같은 날 단순화) — 고장 / 분실 블록 2개, 블록 전체가 AS업무(병원+구분 필터) 링크
 * 서버 컴포넌트가 getHospitalAsSummary(code)를 직접 호출(HospitalDeviceSummary 선례). 취소 접수·취소 라인 제외.
 * - 고장: 기기군별 `누적 접수 대수 / 구매수량`  · 분실: 기기군별 `교체 제공 / 구매수량 (%)` — AS 상세 '구분' 필드와 같은 산식(lib/asLostQuota)
 * - 분실 한도 초과면 빨간 테두리 깜박임 + 배지. 미완료는 있을 때만 한 줄
 */
export default async function HospitalAsSummary({ hospitalCode, hospitalName }: { hospitalCode: string; hospitalName: string }) {
  const s = await getHospitalAsSummary(hospitalCode)
  const href = (category: 'FAULT' | 'LOST') => `/as-receipts?q=${encodeURIComponent(hospitalName)}&field=hospital&category=${category}`
  return (
    <div>
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">AS 현황 <span className="normal-case tracking-normal text-gray-300">— 블록을 누르면 AS업무에서 해당 병원·구분으로 조회</span></p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CategoryBlock title="고장 AS" stat={s.fault} href={href('FAULT')} quota={s.lostQuota} mode="fault" />
        <CategoryBlock title="분실 AS" stat={s.lost} href={href('LOST')} quota={s.lostQuota} mode="lost" />
      </div>
    </div>
  )
}

function CategoryBlock({ title, stat, href, quota, mode }: { title: string; stat: AsHospitalCategoryStat; href: string; quota: AsLostQuota; mode: 'fault' | 'lost' }) {
  const over = mode === 'lost' && quota.groups.some((g) => g.overBefore)
  const purchasedOf = (group: string) => quota.groups.find((g) => g.group === group)?.purchased ?? null
  return (
    <Link href={href} className={`relative block rounded-lg border px-4 py-3 transition-colors hover:bg-gray-50 ${over ? 'border-red-300 bg-red-50/40 hover:bg-red-50' : 'border-gray-200'}`} title={`AS업무에서 ${title} 목록 보기`}>
      {over && <span aria-hidden className="pointer-events-none absolute inset-0 animate-pulse rounded-lg border-2 border-red-500" />}
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">
          {title}
          {over && <span className="ml-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">분실 제공 한도 {quota.thresholdPct}% 초과</span>}
        </p>
        <span className="text-xs text-gray-400">{stat.receipts}건 →</span>
      </div>
      <div className="space-y-1 text-sm" title={mode === 'lost' ? `교체 제공 / 구매수량(계약완료 딜 '도입 기기 수량') — 한도 ${quota.thresholdPct}%` : '누적 접수 대수 / 구매수량(계약완료 딜 \'도입 기기 수량\')'}>
        {(['심전계', '산소포화도'] as const).map((group) => {
          const purchased = purchasedOf(group)
          const q = quota.groups.find((g) => g.group === group)
          const n = mode === 'lost' ? (q?.before ?? 0) : (stat.byGroup.find((g) => g.group === group)?.count ?? 0)
          const bad = mode === 'lost' && !!q?.overBefore
          const pct = purchased ? Math.round((n / purchased) * 1000) / 10 : null
          return (
            <p key={group} className={bad ? 'font-semibold text-red-700' : 'text-gray-800'}>
              <span className="inline-block w-20 text-gray-500">{group}</span>
              {purchased === null
                ? <><span className="font-mono">{n}</span>대 <span className="text-xs text-gray-400">/ 구매수량 미등록</span></>
                : <><span className="font-mono">{n} / {purchased}</span>대{mode === 'lost' && <span className={`ml-1 text-xs ${bad ? 'text-red-700' : 'text-gray-500'}`}>({pct}%)</span>}</>}
            </p>
          )
        })}
      </div>
      {stat.open > 0 && <p className="mt-2 text-xs text-gray-500">미완료 {stat.open}건{stat.openOver7d > 0 && <span className="ml-1 text-red-600">(7일 경과 {stat.openOver7d})</span>}</p>}
    </Link>
  )
}
