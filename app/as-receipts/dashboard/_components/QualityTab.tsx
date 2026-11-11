'use client'

/**
 * AS 대시보드 ④ 기기·품질 — "어떤 기기가 얼마나, 왜 고장나고 고친 뒤에도 다시 들어오나"
 * 기기군·상품유형별 접수율 → 반복 접수(재접수율·수리 후 재접수) → 회수기기 처리 결과 → 접수사유 키워드
 */
import Link from 'next/link'
import type { AsDashQuality } from '@/lib/asDashboard'
import { Section, StatStrip, ShareRow, asListHref, useDashPalette, num, pct, th, thR, td, tdR, EmptyRow, type DashQuery } from './parts'

export default function QualityTab({ data, q, onPickHospital }: { data: AsDashQuality; q: DashQuery; onPickHospital: (h: { hospitalCode: string; hospitalName: string }) => void }) {
  const pal = useDashPalette()
  const { repeat, repair, symptoms } = data
  const faultTotal = data.byGroup.reduce((a, g) => a + g.faultDevices, 0)
  const symMax = Math.max(1, ...symptoms.items.map((s) => s.count))

  return (
    <div className="space-y-4">
      <StatStrip cells={[
        { label: '고장 접수 기기', value: num(faultTotal), unit: '대', sub: data.byGroup.filter((g) => g.group !== '기타' || g.faultDevices > 0).map((g) => `${g.group} ${num(g.faultDevices)}`).join(' · '), title: '기간 내 고장 접수 기기 (취소 접수·라인취소 제외)' },
        { label: '재접수율', value: repeat?.rate === null || !repeat ? '—' : String(repeat.rate), unit: repeat && repeat.rate !== null ? '%' : undefined, sub: repeat ? `${num(repeat.base)}대 중 ${num(repeat.repeat)}대가 과거에도 고장 접수` : '고장 접수 기준 지표 (분실 필터에서는 미표시)', title: '기간 내 고장 접수 기기 중 같은 시리얼이 이전에도 고장으로 접수된 적이 있는 비율 (전체 이력 기준)' },
        { label: `수리 후 ${repeat?.windowDays ?? 30}일 내 재접수`, value: repeat ? num(repeat.within) : '—', unit: repeat ? '대' : undefined, sub: repeat ? `기간 내 고장 접수 기기의 ${pct(repeat.withinRate)}` : '', alert: !!repeat && repeat.within > 0, title: '직전 접수에서 수리반환으로 발송된 뒤 이 기간 안에 다시 고장 접수된 기기 — 수리 품질 신호' },
        { label: '회수기기 처리', value: num(repair.total), unit: '대', sub: repair.byResult.map((r) => `${r.label} ${num(r.count)}`).join(' · '), title: '처리일(수리·문제없음·폐기)이 기간 안인 기기' },
        { label: '문제없음 비율', value: repair.noFaultRate === null ? '—' : String(repair.noFaultRate), unit: repair.noFaultRate === null ? undefined : '%', sub: '수리 + 문제없음 중 문제없음', title: '고장으로 접수됐지만 점검 결과 이상이 없던 기기의 비율 (회수기기 처리 3택은 2026-11-02 도입 — 이전 기록은 전부 수리)' },
      ]} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="기기군별" hint="기간 내 접수 기기와 현재 배치(기기현황 ACTIVE) 100대당 고장 접수 대수">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead><tr className="border-b border-gray-200"><th className={th}>기기군</th><th className={thR}>고장</th><th className={thR}>분실</th><th className={thR}>교체</th><th className={thR}>수리반환</th><th className={thR} title="교체 ÷ (교체 + 수리반환)">교체율</th><th className={thR}>배치 기기</th><th className={thR} title="기간 내 고장 접수 기기 ÷ 현재 배치 기기 × 100">100대당 고장</th></tr></thead>
              <tbody>
                {data.byGroup.filter((g) => g.group !== '기타' || g.faultDevices + g.lostDevices > 0).map((g) => (
                  <tr key={g.group} className="border-b border-gray-100">
                    <td className={`${td} font-medium text-gray-900`}>{g.group}</td>
                    <td className={`${tdR} font-semibold text-gray-900`}>{num(g.faultDevices)}</td><td className={tdR}>{num(g.lostDevices)}</td>
                    <td className={tdR}>{num(g.replace)}</td><td className={tdR}>{num(g.repairReturn)}</td><td className={tdR}>{pct(g.replaceRate)}</td>
                    <td className={`${tdR} text-gray-500`}>{num(g.deployed)}</td><td className={`${tdR} font-semibold text-gray-900`}>{g.per100 === null ? '—' : g.per100}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="상품유형별 (고장)" hint="기기현황 배치의 상품유형 기준 — 라이트형은 교체 수량에 한도가 있습니다">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead><tr className="border-b border-gray-200"><th className={th}>상품유형</th><th className={thR}>고장</th><th className={thR}>교체</th><th className={thR}>배치 기기</th><th className={thR} title="기간 내 고장 접수 기기 ÷ 현재 배치 기기 × 100">100대당 고장</th></tr></thead>
            <tbody>
              {data.byProductType.map((t) => (
                <tr key={t.productType} className="border-b border-gray-100">
                  <td className={`${td} font-medium text-gray-900`}>{t.productType}{t.productType === '미지정' && <span className="ml-1 text-xs font-normal text-gray-400">(기기현황 미연결·유형 없음)</span>}</td>
                  <td className={`${tdR} font-semibold text-gray-900`}>{num(t.faultDevices)}</td><td className={tdR}>{num(t.replace)}</td>
                  <td className={`${tdR} text-gray-500`}>{num(t.deployed)}</td><td className={`${tdR} font-semibold text-gray-900`}>{t.per100 === null ? '—' : t.per100}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="반복 접수 기기" hint="기간 내 고장 접수된 기기 중 누적 접수 횟수가 많은 순 15대 — 시리얼을 누르면 그 기기의 접수 이력을 봅니다" className="xl:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead><tr className="border-b border-gray-200"><th className={th}>시리얼</th><th className={th}>기기군</th><th className={th}>병원 (최근 접수)</th><th className={thR} title="전체 기간 고장 접수 횟수">누적 접수</th><th className={thR}>기간 내</th><th className={th}>최근 접수일</th></tr></thead>
              <tbody>
                {repeat?.top.map((r) => (
                  <tr key={r.serialNo} className="border-b border-gray-100">
                    <td className={td}><Link prefetch={false} href={`/as-receipts?q=${encodeURIComponent(r.serialNo)}&field=serial`} className="font-mono text-blue-600 hover:underline">{r.serialNo}</Link></td>
                    <td className={td}>{r.group}</td>
                    <td className={`${td} max-w-[14rem] truncate`}><button type="button" onClick={() => onPickHospital({ hospitalCode: r.hospitalCode, hospitalName: r.hospitalName })} className="text-left text-blue-600 hover:underline" title={r.hospitalName}>{r.hospitalName}</button></td>
                    <td className={`${tdR} font-semibold text-gray-900`}>{num(r.lifeCount)}회</td>
                    <td className={tdR}>{num(r.periodCount)}회</td>
                    <td className={`${td} whitespace-nowrap`}>{r.lastReceiptDate}</td>
                  </tr>
                ))}
                {!repeat && <EmptyRow cols={6} text="반복 접수는 고장 접수 기준입니다 — 구분 필터를 전체 또는 고장으로 바꾸세요" />}
                {repeat && repeat.top.length === 0 && <EmptyRow cols={6} text="기간 내 반복 접수된 기기가 없습니다" />}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">같은 시리얼의 고장 접수 횟수(취소 제외·정상 형식 시리얼만). 교체로 회수된 뒤 수리되어 다른 병원에 다시 나간 기기도 같은 시리얼로 이어 셉니다.</p>
        </Section>

        <div className="space-y-4 xl:col-span-2">
          <Section title="재접수까지 걸린 기간" hint="직전 고장 접수일 → 이번 접수일 (기간 내 재접수 기기)">
            {repeat && repeat.repeat > 0 ? repeat.gaps.map((g) => <ShareRow key={g.label} label={g.label} count={g.count} total={repeat.repeat} color={pal.fault} unit="대" />) : <p className="py-3 text-center text-xs text-gray-400">{repeat ? '기간 내 재접수 기기가 없습니다' : '고장 접수 기준 지표입니다'}</p>}
          </Section>
          <Section title="회수기기 처리자" hint="기간 안에 수리·문제없음·폐기를 기록한 사람별 대수">
            {repair.byUser.length ? repair.byUser.map((u) => <ShareRow key={u.name} label={u.name} count={u.count} total={repair.total} color={pal.fault} unit="대" />) : <p className="py-3 text-center text-xs text-gray-400">기간 내 처리 기록이 없습니다</p>}
          </Section>
          <Section title="접수사유 키워드" hint={`사유가 적힌 접수 ${num(symptoms.receipts)}건 — 자유 입력 문구를 키워드로 묶은 참고 수치 (한 접수가 여러 분류에 걸릴 수 있음)`}>
            {symptoms.receipts ? (
              <>
                {symptoms.items.map((s) => (
                  <div key={s.key} className="flex items-center gap-2 py-1 text-sm">
                    <span className="w-32 shrink-0 truncate text-gray-700">{s.label}</span>
                    <span className="h-2.5 min-w-0 flex-1 rounded-sm bg-gray-100"><span className="block h-2.5 rounded-sm" style={{ width: `${(s.count / symMax) * 100}%`, backgroundColor: pal.fault }} /></span>
                    <span className="w-24 shrink-0 text-right tabular-nums text-gray-900">{num(s.count)}건 <span className="text-xs text-gray-500">{pct(s.pct)}</span></span>
                  </div>
                ))}
                <p className="mt-2 text-xs text-gray-500">어느 분류에도 안 걸린 접수 {num(symptoms.unmatched)}건 (‘고장’, ‘미기재’ 등) · <Link prefetch={false} href={asListHref(q, { period: true })} className="text-blue-600 hover:underline">기간 내 접수 목록 →</Link></p>
              </>
            ) : <p className="py-3 text-center text-xs text-gray-400">기간 내 사유가 적힌 접수가 없습니다</p>}
          </Section>
        </div>
      </div>
    </div>
  )
}
