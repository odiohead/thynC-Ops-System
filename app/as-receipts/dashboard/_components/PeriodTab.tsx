'use client'

/**
 * AS 대시보드 ② 기간 분석 — "얼마나 들어오고 나갔나, 어떻게 처리됐고 얼마나 걸렸나"
 * 숫자 한 줄(직전 동기간 대비) → 접수·처리 추이 → 처리 결과 / 소요일 → 구성(유입·수거·발송·태그)
 * 귀속 기준일: 접수 = 접수일, 완료 = 완료일, 발송 = 라인 발송일. 취소 접수·라인취소는 물량에서 제외.
 */
import { useState } from 'react'
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts'
import type { AsDashPeriod, AsDashGranularity, Dist } from '@/lib/asDashboard'
import { Section, StatStrip, Delta, ShareRow, Segmented, LegendDot, useDashPalette, num, days, th, thR, td, tdR, type DashQuery } from './parts'

const GRAN_LABEL: Record<AsDashGranularity, string> = { day: '일', week: '주', month: '월' }
const distText = (d: Dist) => (d.n ? `중앙값 ${days(d.median)} · 상위 10% ${days(d.p90)}` : '—')
/** 소요일 칸 — 중앙값(굵게) 아래에 상위 10% 경계 */
function DistCell({ d, strong }: { d: Dist; strong?: boolean }) {
  if (!d.n) return <span className="text-gray-300">—</span>
  return <><span className={strong ? 'font-semibold text-gray-900' : ''}>{days(d.median)}</span><span className="block whitespace-nowrap text-[11px] font-normal text-gray-500">상위 10% {days(d.p90)}</span></>
}

export default function PeriodTab({ data, onGranularity }: { data: AsDashPeriod; q: DashQuery; onGranularity: (g: AsDashGranularity) => void }) {
  const pal = useDashPalette()
  const [unit, setUnit] = useState<'receipts' | 'devices'>('receipts')
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const { kpi, range, trend, lead } = data
  const isReceipts = unit === 'receipts'
  const rows = trend.map((t) => ({
    label: t.label, key: t.key,
    fault: isReceipts ? t.faultReceipts : t.faultDevices,
    lost: isReceipts ? t.lostReceipts : t.lostDevices,
    flow: isReceipts ? t.resolved : t.shipped,
  }))
  const flowName = isReceipts ? '완료(건)' : '발송(대)'
  const u = isReceipts ? '건' : '대'
  const leadDelta = kpi.lead.cur.median !== null && kpi.lead.prevMedian !== null ? Math.round((kpi.lead.cur.median - kpi.lead.prevMedian) * 10) / 10 : null
  const outcomeTotal = data.outcomes.reduce((a, o) => a + o.total, 0)
  const outcomeMax = Math.max(1, ...data.outcomes.map((o) => o.total))
  const histTotal = lead.histogram.reduce((a, h) => a + h.count, 0)

  return (
    <div className="space-y-4">
      <StatStrip cells={[
        { label: '접수', value: num(kpi.receipts.cur), unit: '건', sub: <><span className="text-gray-700">기기 {num(kpi.devices.cur)}대</span> · <Delta pair={kpi.receipts} unit="건" /></>, title: `접수일이 기간 안인 접수 (취소 ${kpi.canceled}건 제외)` },
        { label: '완료', value: num(kpi.resolved.cur), unit: '건', sub: <><Delta pair={kpi.resolved} unit="건" /> · <span title="기간 내 접수(취소 포함) − 종결(완료+취소). 음수면 쌓여 있던 미처리 접수가 그만큼 줄었다는 뜻">미처리 증감 {kpi.netFlow > 0 ? '+' : ''}{num(kpi.netFlow)}건</span></>, title: '완료일이 기간 안인 접수' },
        { label: '발송', value: num(kpi.shipped.cur), unit: '대', sub: <Delta pair={kpi.shipped} unit="대" />, title: '발송일이 기간 안인 기기(수리반환·교체 발송)' },
        { label: `접수→발송 (${kpi.lead.label})`, value: kpi.lead.cur.median === null ? '—' : String(kpi.lead.cur.median), unit: kpi.lead.cur.median === null ? undefined : '일', sub: kpi.lead.cur.n ? <>중앙값 · 상위 10% {days(kpi.lead.cur.p90)}{leadDelta !== null && <> · 직전 대비 {leadDelta > 0 ? '▲' : leadDelta < 0 ? '▼' : '='} {Math.abs(leadDelta)}일</>}</> : '기간 내 발송 없음', title: `기간 안에 발송된 ${kpi.lead.label} 기기 ${kpi.lead.cur.n}대의 접수일→발송일(달력일)` },
        { label: '교체율 (고장)', value: kpi.replace.pct === null ? '—' : String(kpi.replace.pct), unit: kpi.replace.pct === null ? undefined : '%', sub: `교체 ${num(kpi.replace.replace)} · 수리반환 ${num(kpi.replace.repair)}대`, title: '기간 내 고장 접수 기기 중 결과가 확정된 것 — 교체 ÷ (교체 + 수리반환)' },
        { label: '선교체 요청', value: kpi.preReplace.pct === null ? '—' : String(kpi.preReplace.pct), unit: kpi.preReplace.pct === null ? undefined : '%', sub: `고장 접수 ${num(kpi.preReplace.base)}건 중 ${num(kpi.preReplace.count)}건`, title: '기간 내 고장 접수 중 선교체 태그가 켜진 접수' },
      ]} />

      <Section
        title="접수·처리 추이"
        hint={`${range.from} ~ ${range.to} (${range.days}일) · 막대 = 접수(${isReceipts ? '접수 건' : '기기 대수'}), 선 = ${isReceipts ? '완료된 접수 건' : '발송된 기기 대수'}`}
        right={<>
          <Segmented label="단위" value={unit} onChange={setUnit} options={[{ value: 'receipts', label: '접수 건' }, { value: 'devices', label: '기기 대' }]} />
          <Segmented label="간격" value={data.granularity} onChange={onGranularity} options={(['day', 'week', 'month'] as AsDashGranularity[]).map((g) => ({ value: g, label: GRAN_LABEL[g] }))} />
          <Segmented value={view} onChange={setView} options={[{ value: 'chart', label: '차트' }, { value: 'table', label: '표' }]} />
        </>}
      >
        {view === 'chart' ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={pal.chart.grid} vertical={false} />
              <XAxis dataKey="label" {...pal.axis} minTickGap={16} />
              <YAxis allowDecimals={false} {...pal.axis} />
              <Tooltip contentStyle={pal.chart.tooltip} cursor={{ fill: pal.chart.grid, opacity: 0.5 }} formatter={(v, name) => [`${Number(v).toLocaleString()}${String(name).includes('대') ? '대' : '건'}`, name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span style={{ color: pal.chart.tick }}>{value}</span>} />
              <Bar dataKey="fault" name={`고장 접수(${u})`} stackId="in" fill={pal.fault} stroke={pal.surface} strokeWidth={1} maxBarSize={24} isAnimationActive={false} />
              <Bar dataKey="lost" name={`분실 접수(${u})`} stackId="in" fill={pal.lost} stroke={pal.surface} strokeWidth={1} maxBarSize={24} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line type="linear" isAnimationActive={false} dataKey="flow" name={flowName} stroke={pal.flow} strokeWidth={2} dot={rows.length <= 31 ? { r: 3, fill: pal.flow, stroke: pal.surface, strokeWidth: 1 } : false} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="max-h-72 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-white"><tr className="border-b border-gray-200">
                <th className={th}>{GRAN_LABEL[data.granularity]} 시작</th><th className={thR}>고장 접수(건)</th><th className={thR}>분실 접수(건)</th><th className={thR}>고장 기기(대)</th><th className={thR}>분실 기기(대)</th><th className={thR}>완료(건)</th><th className={thR}>발송(대)</th>
              </tr></thead>
              <tbody>
                {trend.map((t) => (
                  <tr key={t.key} className="border-b border-gray-100">
                    <td className={td}>{t.key}</td><td className={tdR}>{num(t.faultReceipts)}</td><td className={tdR}>{num(t.lostReceipts)}</td><td className={tdR}>{num(t.faultDevices)}</td><td className={tdR}>{num(t.lostDevices)}</td><td className={tdR}>{num(t.resolved)}</td><td className={tdR}>{num(t.shipped)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="처리 결과" hint="기간 안에 접수된 기기가 지금 어떤 결과인지 (기기 대수)" right={<><LegendDot color={pal.fault} label="고장" /><LegendDot color={pal.lost} label="분실" /></>}>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead><tr className="border-b border-gray-200"><th className={th}>결과</th><th className={`${th} w-[40%]`} /><th className={thR}>고장</th><th className={thR}>분실</th><th className={thR}>합계</th><th className={thR}>비중</th></tr></thead>
            <tbody>
              {data.outcomes.map((o) => (
                <tr key={o.key} className="border-b border-gray-100">
                  <td className={`${td} whitespace-nowrap`}>{o.label}</td>
                  <td className={td}>
                    <div className="flex h-3 gap-0.5" style={{ width: `${(o.total / outcomeMax) * 100}%` }}>
                      {o.fault > 0 && <span className="rounded-sm" style={{ flexGrow: o.fault, flexBasis: 0, minWidth: 2, backgroundColor: pal.fault }} title={`고장 ${o.fault}대`} />}
                      {o.lost > 0 && <span className="rounded-sm" style={{ flexGrow: o.lost, flexBasis: 0, minWidth: 2, backgroundColor: pal.lost }} title={`분실 ${o.lost}대`} />}
                    </div>
                  </td>
                  <td className={tdR}>{num(o.fault)}</td><td className={tdR}>{num(o.lost)}</td>
                  <td className={`${tdR} font-semibold text-gray-900`}>{num(o.total)}</td>
                  <td className={`${tdR} text-gray-500`}>{outcomeTotal ? `${Math.round((o.total / outcomeTotal) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">‘진행 중’은 아직 결과가 확정되지 않은 기기입니다. 최근 접수일수록 진행 중 비중이 큽니다.</p>
        </Section>

        <Section title="소요일" hint="기간 안에 발송된 기기 기준 · 달력일 · 중앙값(상위 10%는 가장 오래 걸린 10%의 경계)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px]">
              <thead><tr className="border-b border-gray-200"><th className={th}>구분</th><th className={thR}>접수→입고</th><th className={thR}>입고→발송</th><th className={thR}>접수→발송 (중앙값)</th><th className={thR}>발송 기기</th></tr></thead>
              <tbody>
                {lead.segments.map((s) => (
                  <tr key={s.key} className="border-b border-gray-100">
                    <td className={`${td} whitespace-nowrap font-medium text-gray-900`}>{s.label}</td>
                    <td className={tdR} title={s.toIntake.n ? `${s.toIntake.n}대 · 평균 ${s.toIntake.avg}일` : '입고일이 기록된 기기 없음'}><DistCell d={s.toIntake} /></td>
                    <td className={tdR} title={s.intakeToShip.n ? `${s.intakeToShip.n}대 · 평균 ${s.intakeToShip.avg}일` : '입고일이 기록된 기기 없음'}><DistCell d={s.intakeToShip} /></td>
                    <td className={tdR} title={s.total.n ? `평균 ${s.total.avg}일` : undefined}><DistCell d={s.total} strong /></td>
                    <td className={`${tdR} whitespace-nowrap text-gray-500`}>{num(s.total.n)}대</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">단계 분해(접수→입고→발송)는 일반 고장만 냅니다 — 선교체는 발송이 입고보다 앞서고 분실은 입고가 없습니다. 접수→완료(접수 건 기준): {lead.resolve.n ? `${distText(lead.resolve)} · ${num(lead.resolve.n)}건` : '—'}</p>
          <p className="mb-1 mt-4 text-xs font-medium text-gray-700">고장·일반 접수→발송 분포 <span className="font-normal text-gray-500">({num(histTotal)}대)</span></p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={lead.histogram} margin={{ top: 18, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={pal.chart.grid} vertical={false} />
              <XAxis dataKey="label" {...pal.axis} />
              <YAxis allowDecimals={false} {...pal.axis} />
              <Tooltip contentStyle={pal.chart.tooltip} cursor={{ fill: pal.chart.grid, opacity: 0.5 }} formatter={(v) => [`${Number(v).toLocaleString()}대${histTotal ? ` (${Math.round((Number(v) / histTotal) * 100)}%)` : ''}`, '발송 기기']} />
              <Bar dataKey="count" fill={pal.fault} maxBarSize={24} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: pal.chart.tick }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      <Section title="구성" hint={`기간 내 접수 ${num(data.mix.base.receipts)}건이 어떤 경로·방법으로 처리되는지`}>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
          {([
            { title: '유입 경로 (접수 건)', items: data.mix.source, total: data.mix.base.receipts, unit: '' },
            { title: '수거 방법 (접수 건)', items: data.mix.pickup, total: data.mix.base.receipts, unit: '' },
            { title: '발송 방법 (발송된 기기)', items: data.mix.ship, total: data.mix.base.shippedLines, unit: '' },
            { title: '태그 (접수 건, 중복 가능)', items: data.mix.tags, total: data.mix.base.receipts, unit: '' },
          ]).map((b) => (
            <div key={b.title}>
              <p className="mb-1 text-xs font-medium text-gray-700">{b.title}</p>
              {b.items.length ? b.items.map((i) => <ShareRow key={i.key} label={i.label} count={i.count} total={b.total} color={pal.fault} unit={b.unit} />) : <p className="py-2 text-xs text-gray-400">데이터 없음</p>}
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
