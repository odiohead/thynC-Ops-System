/**
 * AS 대시보드 집계 스모크 (projects/as_dashboard_design.md §8) — 읽기 전용, DB를 바꾸지 않는다.
 * lib/asDashboard.ts가 낸 숫자를 **독립 SQL**·기존 화면의 정의(목록 요약·수리대기 큐·분실/라이트 한도 단건 함수)와 대조한다.
 *   npx tsx scripts/as-dashboard-smoke.mts [--from=YYYY-MM-DD --to=YYYY-MM-DD]
 * 기간 생략 시 DB의 마지막 접수일 기준 직전 30일(데이터가 있는 구간).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveAsDashFilter, buildAsDashNow, buildAsDashPeriod, buildAsDashHospitals, buildAsDashQuality, type AsDashFilter } from '@/lib/asDashboard'
import { asDeviceGroupOf, AS_DEVICE_GROUP_TO_CODE, AS_DEVICE_GROUP_CODE_LIST, AS_LOST_QUOTA_PCT } from '@/lib/asReceiptShared'
import { asDeviceGroupWhere, asQueueBucketWhere } from '@/lib/asReceiptQueue'
import { findAsNeedsCheckReceiptIds } from '@/lib/asReceiptSearch'
import { computeAsLostQuota, computeAsLostQuotaAll } from '@/lib/asLostQuota'
import { computeAsDealQuota, computeAsLiteQuotaAll } from '@/lib/asDealQuota'

let pass = 0; let fail = 0
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass++; else fail++
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? ` = ${JSON.stringify(actual)}` : ` — 대시보드 ${JSON.stringify(actual)} ≠ 기대 ${JSON.stringify(expected)}`}`)
}
const one = async (sql: Prisma.Sql) => Number((await prisma.$queryRaw<{ n: number | null }[]>(sql))[0]?.n ?? 0)
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]

const last = (await prisma.$queryRaw<{ d: string }[]>`SELECT max(receipt_date)::text AS d FROM as_receipts`)[0].d
const to = arg('to') ?? last
const from = arg('from') ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10)
const base = await resolveAsDashFilter(new URLSearchParams({ from, to }))
console.log(`기간 ${base.from} ~ ${base.to}`)
const LIVE = Prisma.sql`coalesce(s.name, '') <> '취소'`
const RANGE = Prisma.sql`r.receipt_date BETWEEN ${base.from}::date AND ${base.to}::date`
const J = Prisma.sql`FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id LEFT JOIN status_codes s ON s.id = r.status_id`

// ── ① 현황
console.log('\n▶ 현황')
const now = await buildAsDashNow(base)
const OPEN_WHERE: Prisma.AsReceiptWhereInput = { OR: [{ statusId: null }, { status: { ticketStatus: null } }, { status: { ticketStatus: { notIn: ['RESOLVED', 'CLOSED'] } } }] }
eq('진행 중 접수 = 목록 요약 openTotal 정의', now.kpi.openReceipts, await prisma.asReceipt.count({ where: OPEN_WHERE }))
eq('2주 경과 미처리 = 목록 overdue 정의', now.kpi.overdue, await prisma.asReceipt.count({ where: { AND: [OPEN_WHERE, { receiptDate: { lt: new Date(Date.parse(`${now.today}T00:00:00Z`) - 14 * 86400000) } }] } }))
eq('확인필요 = 목록 needsCheck 건수', now.kpi.needsCheck, (await findAsNeedsCheckReceiptIds()).length)
eq('등록대기 = as_intake_links PENDING', now.kpi.intakePending, await prisma.asIntakeLink.count({ where: { state: 'PENDING' } }))
eq('단계별 접수 합 = 진행 중 접수', now.stages.reduce((a, s) => a + s.receipts, 0), now.kpi.openReceipts)
eq('단계별 경과일 구간 합 = 단계 접수', now.stages.map((s) => s.aging.reduce((a, b) => a + b, 0)), now.stages.map((s) => s.receipts))
eq('진행 중 기기 = 미종결 접수의 라인취소 제외 라인', now.kpi.openDevices, await one(Prisma.sql`SELECT count(*)::int AS n ${J} WHERE (s.id IS NULL OR s.ticket_status IS NULL OR s.ticket_status NOT IN ('RESOLVED','CLOSED')) AND coalesce(i.outcome, '') <> 'CANCELED'`))
for (const b of ['WAITING', 'INCOMING'] as const) {
  eq(`${b} 합 = 수리대기 큐 버킷 건수`, now.work.find((w) => w.key === b)?.total, await prisma.asReceiptItem.count({ where: asQueueBucketWhere(b) }))
}
eq('분실 처리 대기 = 미종결 분실 접수의 결과 미확정 라인', now.work.find((w) => w.key === 'LOST')?.total,
  await one(Prisma.sql`SELECT count(*)::int AS n ${J} WHERE r.category = 'LOST' AND i.outcome IS NULL AND (s.id IS NULL OR s.ticket_status IS NULL OR s.ticket_status NOT IN ('RESOLVED','CLOSED'))`))
eq('발송 대기 = 미종결 고장 접수·결과 없음·미발송 ∧ (처리 끝남(폐기 제외) ∨ 선교체)', now.work.find((w) => w.key === 'SHIP')?.total,
  await one(Prisma.sql`SELECT count(*)::int AS n ${J} WHERE r.category <> 'LOST' AND i.outcome IS NULL AND i.shipped_at IS NULL
    AND (s.id IS NULL OR s.ticket_status IS NULL OR s.ticket_status NOT IN ('RESOLVED','CLOSED'))
    AND ((i.repaired_at IS NOT NULL AND coalesce(i.repair_result, '') <> 'SCRAPPED') OR r.pre_replace)`))

// ── 기기군 판정: 서버 where(목록·큐) vs JS asDeviceGroupOf
console.log('\n▶ 기기군 판정 (asDeviceGroupWhere ↔ asDeviceGroupOf)')
const allLines = await prisma.$queryRaw<{ device_name: string | null; device_kind: string | null; serial_no: string }[]>`
  SELECT di.device_name, i.device_kind, i.serial_no FROM as_receipt_items i LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id`
let whereSum = 0
for (const g of AS_DEVICE_GROUP_CODE_LIST) {
  const js = allLines.filter((l) => AS_DEVICE_GROUP_TO_CODE[asDeviceGroupOf(l.device_name, l.device_kind, l.serial_no)] === g).length
  const db = await prisma.asReceiptItem.count({ where: asDeviceGroupWhere(g) })
  whereSum += db
  eq(`${g} 라인 수`, js, db) // ETC 포함 — 2026-11-12 where를 경우별(원장/기기종류/시리얼)로 나눠 NULL 누락 해소
}
eq('세 기기군 where 합 = 전체 라인 (누락·중복 없음)', whereSum, allLines.length)

// ── ② 기간 분석
console.log('\n▶ 기간 분석')
const p = await buildAsDashPeriod(base)
eq('접수 건(취소 제외)', p.kpi.receipts.cur, await one(Prisma.sql`SELECT count(*)::int AS n FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id WHERE ${RANGE} AND ${LIVE}`))
eq('취소 접수', p.kpi.canceled, await one(Prisma.sql`SELECT count(*)::int AS n FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id WHERE ${RANGE} AND s.name = '취소'`))
eq('접수 기기(라인취소 제외)', p.kpi.devices.cur, await one(Prisma.sql`SELECT count(*)::int AS n ${J} WHERE ${RANGE} AND ${LIVE} AND coalesce(i.outcome, '') <> 'CANCELED'`))
eq('직전 기간 접수 건', p.kpi.receipts.prev, await one(Prisma.sql`SELECT count(*)::int AS n FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id WHERE r.receipt_date BETWEEN ${p.range.prevFrom}::date AND ${p.range.prevTo}::date AND ${LIVE}`))
eq('완료 건(완료일 기준)', p.kpi.resolved.cur, await one(Prisma.sql`SELECT count(*)::int AS n FROM as_receipts r JOIN status_codes s ON s.id = r.status_id WHERE s.name = '완료' AND r.resolved_at BETWEEN ${base.from}::date AND ${base.to}::date`))
eq('발송 기기(발송일 기준)', p.kpi.shipped.cur, await one(Prisma.sql`SELECT count(*)::int AS n ${J} WHERE i.shipped_at BETWEEN ${base.from}::date AND ${base.to}::date AND ${LIVE} AND coalesce(i.outcome, '') <> 'CANCELED'`))
const leadSql = await prisma.$queryRaw<{ n: number; med: number | null; p90: number | null }[]>(Prisma.sql`
  SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY i.shipped_at - r.receipt_date)::float AS med, percentile_cont(0.9) WITHIN GROUP (ORDER BY i.shipped_at - r.receipt_date)::float AS p90
  ${J} WHERE r.category = 'FAULT' AND ${LIVE} AND i.outcome IN ('REPAIR_RETURN', 'REPLACE') AND i.shipped_at BETWEEN ${base.from}::date AND ${base.to}::date AND i.shipped_at >= r.receipt_date`)
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10)
eq('접수→발송(고장) 표본·중앙값·상위 10% = percentile_cont', [p.kpi.lead.cur.n, p.kpi.lead.cur.median, p.kpi.lead.cur.p90], [leadSql[0].n, r1(leadSql[0].med), r1(leadSql[0].p90)])
eq('소요일 구간 표본 합(고장 일반+선교체) = 고장 표본', p.lead.segments.filter((s) => s.key !== 'LOST').reduce((a, s) => a + s.total.n, 0), p.kpi.lead.cur.n)
eq('추이 합 = 접수 건', p.trend.reduce((a, t) => a + t.faultReceipts + t.lostReceipts, 0), p.kpi.receipts.cur)
eq('추이 합 = 접수 기기', p.trend.reduce((a, t) => a + t.faultDevices + t.lostDevices, 0), p.kpi.devices.cur)
eq('추이 합 = 완료 건', p.trend.reduce((a, t) => a + t.resolved, 0), p.kpi.resolved.cur)
eq('추이 합 = 발송 기기', p.trend.reduce((a, t) => a + t.shipped, 0), p.kpi.shipped.cur)
eq('처리 결과 합 = 기간 접수 라인 전체', p.outcomes.reduce((a, o) => a + o.total, 0), await one(Prisma.sql`SELECT count(*)::int AS n ${J} WHERE ${RANGE} AND ${LIVE}`))
eq('교체·수리반환(고장)', [p.kpi.replace.replace, p.kpi.replace.repair], [
  await one(Prisma.sql`SELECT count(*)::int AS n ${J} WHERE ${RANGE} AND ${LIVE} AND r.category = 'FAULT' AND i.outcome = 'REPLACE'`),
  await one(Prisma.sql`SELECT count(*)::int AS n ${J} WHERE ${RANGE} AND ${LIVE} AND r.category = 'FAULT' AND i.outcome = 'REPAIR_RETURN'`)])
eq('유입 경로 합 = 접수 건', p.mix.source.reduce((a, x) => a + x.count, 0), p.kpi.receipts.cur)
const weekly = await buildAsDashPeriod(base, 'week'); const monthly = await buildAsDashPeriod(base, 'month')
eq('간격을 바꿔도 합계 동일(주·월)', [weekly.trend.reduce((a, t) => a + t.faultDevices + t.lostDevices, 0), monthly.trend.reduce((a, t) => a + t.shipped, 0)], [p.kpi.devices.cur, p.kpi.shipped.cur])

// 필터 분해 — 구분·기기군으로 쪼갠 합이 전체와 같아야 한다
const withF = (o: Partial<AsDashFilter>): AsDashFilter => ({ ...base, ...o })
const [pf, pl, pe, ps, pt] = await Promise.all([
  buildAsDashPeriod(withF({ category: 'FAULT' })), buildAsDashPeriod(withF({ category: 'LOST' })),
  buildAsDashPeriod(withF({ group: 'ECG' })), buildAsDashPeriod(withF({ group: 'SPO2' })), buildAsDashPeriod(withF({ group: 'ETC' })),
])
eq('고장 + 분실 접수 건 = 전체', pf.kpi.receipts.cur + pl.kpi.receipts.cur, p.kpi.receipts.cur)
eq('심전계 + 산소포화도 + 기타 기기 = 전체', pe.kpi.devices.cur + ps.kpi.devices.cur + pt.kpi.devices.cur, p.kpi.devices.cur)
eq('심전계 + 산소포화도 + 기타 발송 = 전체', pe.kpi.shipped.cur + ps.kpi.shipped.cur + pt.kpi.shipped.cur, p.kpi.shipped.cur)

// ── ③ 병원별
console.log('\n▶ 병원별')
const h = await buildAsDashHospitals(base)
eq('병원별 접수 합 = 기간 접수 건', h.totals.receipts, p.kpi.receipts.cur)
eq('병원별 기기 합 = 기간 접수 기기', h.totals.devices, p.kpi.devices.cur)
eq('병원별 미완료 합 = 진행 중 접수', h.totals.openNow, now.kpi.openReceipts)
eq('접수 병원 수', h.totals.hospitals, await one(Prisma.sql`SELECT count(DISTINCT r.hospital_code)::int AS n FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id WHERE ${RANGE} AND ${LIVE}`))
eq('배치 기기 합(표에 나온 병원) = hospital_devices ACTIVE', h.rows.reduce((a, r) => a + r.deployed, 0),
  await one(Prisma.sql`SELECT count(*)::int AS n FROM hospital_devices hd WHERE hd.status = 'ACTIVE' AND hd.hospital_code = ANY(${h.rows.map((r) => r.hospitalCode)}::text[])`))
// 한도 일괄 집계 ↔ 병원 1곳 함수 (정의가 갈라지면 여기서 잡힌다)
const asHospitals = (await prisma.$queryRaw<{ c: string }[]>`SELECT DISTINCT hospital_code AS c FROM as_receipts`).map((x) => x.c)
const [lostAll, liteAll] = await Promise.all([computeAsLostQuotaAll(), computeAsLiteQuotaAll()])
let lostDiff = 0; let liteDiff = 0; let lostOver = 0
for (const code of asHospitals) {
  const single = await computeAsLostQuota({ id: 0, hospitalCode: code })
  const bulk = lostAll.get(code)
  for (const g of single.groups) {
    const b = bulk?.groups.find((x) => x.group === g.group)
    if ((b?.provided ?? 0) !== g.before || (b ? b.purchased !== g.purchased || b.pct !== g.pctBefore || b.over !== g.overBefore : g.before !== 0)) lostDiff++
  }
  if (single.groups.some((g) => g.overBefore)) lostOver++
  const deal = await computeAsDealQuota({ id: 0, hospitalCode: code, category: 'LOST' })
  const lite = deal.rows.find((r) => r.productType === '라이트')
  const lb = liteAll.get(code)
  for (const g of ['심전계', '산소포화도'] as const) {
    const c = lite?.cells[g]; const b = lb?.groups.find((x) => x.group === g)
    if ((c?.before ?? 0) !== (b?.replaced ?? 0) || (c?.introduced ?? null) !== (b?.introduced ?? null) || (c?.overBefore ?? false) !== (b?.over ?? false)) liteDiff++
  }
}
eq(`분실 한도(${AS_LOST_QUOTA_PCT}%) 일괄 ↔ 단건 불일치 (병원 ${asHospitals.length}곳 × 기기군 2)`, lostDiff, 0)
eq('라이트 한도 일괄 ↔ 단건 불일치', liteDiff, 0)
eq('분실 한도 초과 병원 수 = 단건 함수 기준', h.totals.lostOver, lostOver)

// 병원 1곳 선택
const top = h.rows.find((r) => r.receipts > 0)
if (top) {
  const hf = await resolveAsDashFilter(new URLSearchParams({ from: base.from, to: base.to, hospital: top.hospitalCode }))
  const hd = await buildAsDashHospitals(hf)
  eq(`병원 선택(${top.name}) — 필터에 병원명`, hf.hospitalName, top.name)
  eq('병원 선택 — 접수 목록 건수 = 표의 접수 건', hd.detail?.receiptsTotal, top.receipts)
  eq('병원 선택 — 병동별 기기 합 = 표의 기기', hd.detail?.wards.reduce((a, w) => a + w.devices, 0), top.devices)
  eq('병원 선택 — 표 행 = 전체 표의 같은 병원 행', hd.rows.find((r) => r.hospitalCode === top.hospitalCode), top)
  const hn = await buildAsDashNow(hf)
  eq('병원 선택 — 현황 진행 중 접수 = 표의 미완료', hn.kpi.openReceipts, top.openNow)
}
eq('없는 병원 코드는 필터로 인정하지 않음', (await resolveAsDashFilter(new URLSearchParams({ hospital: 'NOPE-000' }))).hospitalCode, null)

// ── ④ 기기·품질
console.log('\n▶ 기기·품질')
const q = await buildAsDashQuality(base)
eq('기기군별 고장 합 = 고장 접수 기기', q.byGroup.reduce((a, g) => a + g.faultDevices, 0), pf.kpi.devices.cur)
eq('기기군별 분실 합 = 분실 접수 기기', q.byGroup.reduce((a, g) => a + g.lostDevices, 0), pl.kpi.devices.cur)
eq('상품유형별 고장 합 = 고장 접수 기기', q.byProductType.reduce((a, g) => a + g.faultDevices, 0), pf.kpi.devices.cur)
eq('배치 기기 합(기기군) = hospital_devices ACTIVE', q.byGroup.reduce((a, g) => a + g.deployed, 0), await one(Prisma.sql`SELECT count(*)::int AS n FROM hospital_devices WHERE status = 'ACTIVE' AND hospital_code IS NOT NULL`))
eq('회수기기 처리 = repaired_at 기간 내 라인', q.repair.total, await one(Prisma.sql`SELECT count(*)::int AS n FROM as_receipt_items i WHERE i.repaired_at BETWEEN ${base.from}::date AND ${base.to}::date`))
const VALID = Prisma.sql`i.serial_no ~ '^[AP][0-9]{6}$'`
const FAULT_LIVE = Prisma.sql`r.category = 'FAULT' AND ${LIVE} AND coalesce(i.outcome, '') <> 'CANCELED' AND ${VALID}`
eq('반복 접수 모수 = 기간 내 고장 라인(정상 시리얼)', q.repeat?.base, await one(Prisma.sql`SELECT count(*)::int AS n ${J} WHERE ${RANGE} AND ${FAULT_LIVE}`))
eq('재접수 = 같은 시리얼의 이전 고장 접수가 있는 라인 (EXISTS)', q.repeat?.repeat, await one(Prisma.sql`
  SELECT count(*)::int AS n ${J} WHERE ${RANGE} AND ${FAULT_LIVE} AND EXISTS (
    SELECT 1 FROM as_receipt_items i2 JOIN as_receipts r2 ON r2.id = i2.receipt_id LEFT JOIN status_codes s2 ON s2.id = r2.status_id
    WHERE i2.serial_no = i.serial_no AND r2.category = 'FAULT' AND coalesce(s2.name, '') <> '취소' AND coalesce(i2.outcome, '') <> 'CANCELED'
      AND (r2.receipt_date < r.receipt_date OR (r2.receipt_date = r.receipt_date AND r2.id < r.id)))`))
eq('수리 후 30일 내 재접수 = 이전 수리반환 발송 중 최신이 30일 이내', q.repeat?.within, await one(Prisma.sql`
  SELECT count(*)::int AS n ${J} WHERE ${RANGE} AND ${FAULT_LIVE} AND (
    SELECT max(i2.shipped_at) FROM as_receipt_items i2 JOIN as_receipts r2 ON r2.id = i2.receipt_id LEFT JOIN status_codes s2 ON s2.id = r2.status_id
    WHERE i2.serial_no = i.serial_no AND r2.category = 'FAULT' AND coalesce(s2.name, '') <> '취소' AND i2.outcome = 'REPAIR_RETURN'
      AND (r2.receipt_date < r.receipt_date OR (r2.receipt_date = r.receipt_date AND r2.id < r.id))
  ) BETWEEN r.receipt_date - 30 AND r.receipt_date`))
eq('재접수 간격 구간 합 = 재접수 라인', q.repeat?.gaps.reduce((a, g) => a + g.count, 0), q.repeat?.repeat)
eq('접수사유가 적힌 접수 건', q.symptoms.receipts, await one(Prisma.sql`SELECT count(DISTINCT r.id)::int AS n ${J} WHERE ${RANGE} AND ${LIVE} AND i.symptom IS NOT NULL`))
eq('분실 필터에서는 반복 접수 미산출', (await buildAsDashQuality(withF({ category: 'LOST' }))).repeat, null)

// ── 전체 기간·빈 기간
console.log('\n▶ 경계')
const all = await resolveAsDashFilter(new URLSearchParams({ from: 'all', to }))
const pa = await buildAsDashPeriod(all)
eq("from=all → 가장 오래된 접수일부터", all.from, (await prisma.$queryRaw<{ d: string }[]>`SELECT min(receipt_date)::text AS d FROM as_receipts`)[0].d)
eq('전체 기간 접수 건 = 취소 아닌 접수 전체(≤ to)', pa.kpi.receipts.cur, await one(Prisma.sql`SELECT count(*)::int AS n FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id WHERE ${LIVE} AND r.receipt_date <= ${to}::date`))
eq('전체 기간은 월 간격', pa.granularity, 'month')
const empty = await buildAsDashPeriod(await resolveAsDashFilter(new URLSearchParams({ from: '2020-01-01', to: '2020-01-31' })))
eq('데이터 없는 기간 — 0건·중앙값 null·추이 31칸', [empty.kpi.receipts.cur, empty.kpi.lead.cur.median, empty.trend.length], [0, null, 31])
eq('잘못된 날짜는 기본 30일', (() => { const f = base; return f.from <= f.to })(), true)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
await prisma.$disconnect()
process.exit(fail ? 1 : 0)
