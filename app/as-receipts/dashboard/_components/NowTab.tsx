'use client'

/**
 * AS 대시보드 ① 현황 — "지금 무엇이 얼마나 쌓여 있고 어디에 막혀 있나" (조회 시점 스냅샷, 기간 필터 미적용)
 * 숫자 한 줄 → 단계별 진행 현황(경과일 분포) → 기기 단위 작업 대기 → 오래된 접수·병원
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AsDashNow } from '@/lib/asDashboard'
import { Section, StatStrip, LegendDot, asListHref, useDashPalette, CATEGORY_LABEL, CATEGORY_BADGE, num, days, th, thR, td, tdR, EmptyRow, type DashQuery } from './parts'

export default function NowTab({ data, q, onPickHospital }: { data: AsDashNow; q: DashQuery; onPickHospital: (h: { hospitalCode: string; hospitalName: string }) => void }) {
  const pal = useDashPalette()
  const router = useRouter()
  const { kpi, stages } = data
  const openStatusParams: [string, string][] = stages.filter((s) => s.statusId !== null).map((s) => ['statusId', String(s.statusId)])
  const maxReceipts = Math.max(1, ...stages.map((s) => s.receipts))
  const lastAging = data.agingLabels.length - 1

  return (
    <div className="space-y-4">
      <StatStrip cells={[
        { label: '진행 중 접수', value: num(kpi.openReceipts), unit: '건', sub: `기기 ${num(kpi.openDevices)}대 · 결과 미확정 ${num(kpi.openLines)}대`, title: '완료·취소가 아닌 접수 (목록 요약과 같은 기준)', href: asListHref(q, { extra: openStatusParams }) },
        { label: '오늘 접수', value: num(kpi.todayReceipts), unit: '건', sub: `이번 주 ${num(kpi.weekReceipts)}건 (${kpi.weekStart.slice(5).replace('-', '/')} 월요일~)`, title: '접수일 기준 · 취소 포함', href: asListHref(q, { extra: [['from', data.today], ['to', data.today]] }) },
        { label: '2주 경과 미처리', value: num(kpi.overdue), unit: '건', sub: '접수 후 14일 넘은 진행 중 접수', alert: kpi.overdue > 0, href: asListHref(q, { extra: [['overdue', '1']] }) },
        { label: '확인필요', value: num(kpi.needsCheck), unit: '건', sub: '기기현황·입고 대조가 맞지 않는 접수', title: '목록 [확인필요만]과 같은 기준 — 미등록·타병원·회수·미배치·중복접수·미입고·미식별입고', alert: kpi.needsCheck > 0, href: asListHref(q, { extra: [['needsCheck', '1']] }) },
        { label: '등록대기', value: num(kpi.intakePending), unit: '건', sub: '채널톡 자동 접수 실패 — 사람 확인 대기', title: '필터와 무관한 전체 건수', alert: kpi.intakePending > 0, href: '/as-receipts/intake' },
      ]} />

      <Section
        title="단계별 진행 현황"
        hint="진행 중 접수가 어느 단계에 얼마나 오래 머물러 있는지 — 막대 길이는 접수 건수, 색은 접수 후 경과일. 행을 누르면 해당 접수 목록으로 이동합니다."
        right={<div className="flex flex-wrap gap-x-3 gap-y-1">{data.agingLabels.map((l, i) => <LegendDot key={l} color={pal.aging[i]} label={l} />)}</div>}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-gray-200">
              <th className={th}>단계</th><th className={thR}>접수</th><th className={thR}>기기</th>
              <th className={`${th} w-[42%]`}>접수 후 경과일 분포</th>
              <th className={thR}>{data.agingLabels[lastAging]}</th>
              <th className={thR} title="현재 단계로 바뀐 뒤 지난 일수의 중앙값">단계 체류(중앙값)</th>
              <th className={thR} title="이 단계 접수 중 가장 오래된 건의 접수 후 경과일">최장 경과</th>
            </tr></thead>
            <tbody>
              {stages.map((s) => {
                const href = s.statusId !== null ? asListHref(q, { extra: [['statusId', String(s.statusId)]] }) : null
                const row = (
                  <>
                    <td className={td}>
                      <span className="inline-flex items-center gap-1.5 font-medium text-gray-900">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color ?? '#9CA3AF' }} />{s.name}
                      </span>
                    </td>
                    <td className={`${tdR} font-semibold text-gray-900`}>{num(s.receipts)}</td>
                    <td className={tdR}>{num(s.devices)}</td>
                    <td className={td}>
                      <div className="flex h-3.5 items-stretch gap-0.5" style={{ width: `${Math.max((s.receipts / maxReceipts) * 100, s.receipts ? 3 : 0)}%` }}>
                        {s.aging.map((n, i) => n > 0 && (
                          <span key={i} className="rounded-sm" style={{ flexGrow: n, flexBasis: 0, minWidth: 3, backgroundColor: pal.aging[i] }} title={`${data.agingLabels[i]} ${n}건`} />
                        ))}
                      </div>
                    </td>
                    <td className={`${tdR} ${s.aging[lastAging] > 0 ? 'font-semibold text-red-600' : 'text-gray-400'}`}>{num(s.aging[lastAging])}</td>
                    <td className={tdR}>{days(s.stayMedian)}</td>
                    <td className={tdR}>{days(s.oldestDays)}</td>
                  </>
                )
                return href
                  ? <tr key={s.name} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50" onClick={() => router.push(href)} title={`${s.name} 접수 목록 보기`}>{row}</tr>
                  : <tr key={s.name} className="border-b border-gray-100">{row}</tr>
              })}
              {stages.length === 0 && <EmptyRow cols={7} />}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="기기 단위 작업 대기" hint="접수가 아니라 기기(라인) 기준 — 수거·수리·발송 담당자가 지금 손대야 할 대수입니다. 수리 대기·입고 예정은 수리대기 화면과 같은 숫자입니다.">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-2 xl:grid-cols-4">
          {data.work.map((w) => (
            <div key={w.key} className="bg-white px-4 py-3" title={w.desc}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium text-gray-600">{w.label}</p>
                {w.href && <Link prefetch={false} href={w.href} className="text-xs text-blue-600 hover:underline">수리대기에서 보기 →</Link>}
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{num(w.total)}<span className="ml-0.5 text-sm font-medium text-gray-500">대</span></p>
              <p className="mt-0.5 text-xs text-gray-600">{w.byGroup.filter((g) => g.count > 0 || g.group !== '기타').map((g) => `${g.group} ${num(g.count)}`).join(' · ')}</p>
              {w.parts.length > 0 && <p className="mt-0.5 text-xs text-gray-500">{w.parts.map((p) => `${p.label} ${num(p.count)}`).join(' · ')}</p>}
              <p className="mt-1.5 text-[11px] leading-snug text-gray-400">{w.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="가장 오래된 진행 중 접수" hint="접수일이 오래된 순 10건" className="xl:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead><tr className="border-b border-gray-200">
                <th className={th}>접수번호</th><th className={th}>병원</th><th className={th}>구분</th><th className={th}>상태</th><th className={th}>접수일</th><th className={thR}>경과</th><th className={thR} title="결과 미확정 / 전체 기기">기기</th><th className={th}>태그</th>
              </tr></thead>
              <tbody>
                {data.oldest.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className={`${td} whitespace-nowrap`}><Link prefetch={false} href={`/as-receipts/${r.id}`} className="font-medium text-blue-600 hover:underline">{r.asCode}</Link></td>
                    <td className={`${td} max-w-[11rem] truncate`} title={r.hospitalName}>{r.hospitalName}</td>
                    <td className={`${td} whitespace-nowrap`}><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CATEGORY_BADGE[r.category] ?? 'bg-gray-100 text-gray-700'}`}>{CATEGORY_LABEL[r.category] ?? r.category}</span></td>
                    <td className={td}><span className="inline-flex items-center gap-1 whitespace-nowrap"><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.statusColor ?? '#9CA3AF' }} />{r.statusName ?? '상태 없음'}</span></td>
                    <td className={`${td} whitespace-nowrap`}>{r.receiptDate}</td>
                    <td className={`${tdR} whitespace-nowrap ${r.days > 14 ? 'font-semibold text-red-600' : ''}`}>{r.days}일</td>
                    <td className={tdR}>{r.openLines}/{r.devices}</td>
                    <td className={`${td} whitespace-nowrap text-xs text-gray-500`}>{r.tags.join(' · ') || '—'}</td>
                  </tr>
                ))}
                {data.oldest.length === 0 && <EmptyRow cols={8} text="진행 중 접수가 없습니다" />}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="진행 중 접수가 많은 병원" hint="병원명을 누르면 대시보드 전체가 그 병원 기준으로 바뀝니다" className="xl:col-span-2">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[340px]">
            <thead><tr className="border-b border-gray-200">
              <th className={th}>병원</th><th className={thR}>접수</th><th className={thR}>기기</th><th className={thR}>2주 경과</th><th className={thR}>최장 경과</th>
            </tr></thead>
            <tbody>
              {data.hospitals.map((h) => (
                <tr key={h.hospitalCode} className="border-b border-gray-100">
                  <td className={`${td} max-w-[13rem] truncate`}><button type="button" onClick={() => onPickHospital({ hospitalCode: h.hospitalCode, hospitalName: h.name })} className="text-left text-blue-600 hover:underline" title={h.name}>{h.name}</button></td>
                  <td className={`${tdR} font-semibold text-gray-900`}>{num(h.receipts)}</td>
                  <td className={tdR}>{num(h.devices)}</td>
                  <td className={`${tdR} ${h.overdue > 0 ? 'font-semibold text-red-600' : 'text-gray-400'}`}>{num(h.overdue)}</td>
                  <td className={`${tdR} whitespace-nowrap`}>{h.oldestDays}일</td>
                </tr>
              ))}
              {data.hospitals.length === 0 && <EmptyRow cols={5} text="진행 중 접수가 없습니다" />}
            </tbody>
          </table>
          </div>
        </Section>
      </div>
    </div>
  )
}
