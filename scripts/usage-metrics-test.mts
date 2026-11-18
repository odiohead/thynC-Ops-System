/**
 * 사용량 지표 계산 검증 (projects/usage_collection_design.md §14)
 *
 *   npx tsx scripts/usage-metrics-test.mts                    계산 함수(순수) 검사
 *   npx tsx scripts/usage-metrics-test.mts <병원코드> [30|90]   + 원본 DB 의 실제 데이터로, 화면용 계산과 별도 SQL 계산을 대조 (읽기 전용)
 */
import { DAY_SEC, average, changeRate, dayLabel, dayStats, localDayStart, spanStats, weekStartOf } from '../lib/usage/daily'
import { aggregateWeeks, capacityOn, countsAsMeasurement, defaultModelOf, getUsageDaily, hospitalModelOf, measurementModels, planForModel, typeModelOf } from '../lib/usage/metrics'
import { fmtTime, positional, usageDb } from './usage-lib.mts'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}

console.log('■ 계산 함수')
const D = Date.UTC(2026, 10, 10) / 1000 // 2026-11-10 00:00 (현지 시각을 숫자로 본 값)
const h = (n: number) => D + n * 3600
{
  check('구간이 없으면 0, 0', JSON.stringify(dayStats([], D)) === '{"count":0,"peak":0}')
  check('하루 안의 한 구간 → 1건, 동시 1', JSON.stringify(dayStats([{ s: h(9), e: h(15) }], D)) === '{"count":1,"peak":1}')
  check('겹치지 않는 두 구간 → 2건, 동시 1', JSON.stringify(dayStats([{ s: h(1), e: h(5) }, { s: h(6), e: h(9) }], D)) === '{"count":2,"peak":1}')
  check('겹치는 두 구간 → 2건, 동시 2', JSON.stringify(dayStats([{ s: h(1), e: h(8) }, { s: h(6), e: h(9) }], D)) === '{"count":2,"peak":2}')
  check('같은 시각에 끝나고 시작 → 동시 1 (교대)', dayStats([{ s: h(1), e: h(6) }, { s: h(6), e: h(9) }], D).peak === 1)
  check('전날부터 다음 날까지 이어지는 구간 → 그날 1건', dayStats([{ s: h(-30), e: h(40) }], D).count === 1)
  check('자정에 정확히 끝난 구간은 그날에 세지 않는다', dayStats([{ s: h(-10), e: h(0) }], D).count === 0)
  check('자정에 시작한 구간은 그날에 센다', dayStats([{ s: h(0), e: h(2) }], D).count === 1)
  check('다음 날 자정에 시작한 구간은 세지 않는다', dayStats([{ s: h(24), e: h(30) }], D).count === 0)
  check('길이가 0인 구간도 그날 1건으로 센다', dayStats([{ s: h(3), e: h(3) }], D).count === 1)
  check('끝이 시작보다 이른 구간도 1건 (1초로 본다)', dayStats([{ s: h(3), e: h(1) }], D).count === 1)
  const many = Array.from({ length: 12 }, (_, i) => ({ s: h(i), e: h(i + 3) }))
  check('3시간짜리가 1시간 간격으로 12개 → 12건, 동시 3', JSON.stringify(dayStats(many, D)) === '{"count":12,"peak":3}')
  check('날짜 표기', dayLabel(D) === '2026-11-10' && dayLabel(D + DAY_SEC) === '2026-11-11')
  // 2026-11-17 23:30 KST = 14:30 UTC → 현지 오늘은 11-17, 00:30 KST(= 전날 15:30 UTC) → 11-18
  check('현지 오늘: 23:30 KST', dayLabel(localDayStart(Date.UTC(2026, 10, 17, 14, 30), 9)) === '2026-11-17')
  check('현지 오늘: 00:30 KST', dayLabel(localDayStart(Date.UTC(2026, 10, 17, 15, 30), 9)) === '2026-11-18')
  check('평균은 없는 값을 뺀다', average([10, null, 20]) === 15 && average([null]) === null && average([]) === null)

  // 주간 — 월~일, 2026-11-10(화)이 속한 주의 월요일은 11-09, 11-16(월)은 그날
  check('주 시작: 화요일 → 그 주 월요일', dayLabel(weekStartOf(D)) === '2026-11-09')
  check('주 시작: 월요일 → 그날, 일요일 → 6일 전', dayLabel(weekStartOf(D + 6 * DAY_SEC)) === '2026-11-16' && dayLabel(weekStartOf(D + 5 * DAY_SEC)) === '2026-11-09')
  const W = weekStartOf(D)
  check('주간 실측정 수: 5일짜리 측정은 그 주 1건', spanStats([{ s: W + 3600, e: W + 5 * DAY_SEC }], W, W + 7 * DAY_SEC).count === 1)
  check('주간 실측정 수: 주를 넘긴 측정은 두 주에 각 1건', spanStats([{ s: W + 6 * DAY_SEC, e: W + 9 * DAY_SEC }], W, W + 7 * DAY_SEC).count === 1 && spanStats([{ s: W + 6 * DAY_SEC, e: W + 9 * DAY_SEC }], W + 7 * DAY_SEC, W + 14 * DAY_SEC).count === 1)
  check('측정 포함: 종료·완료인데 기기 기록 없음 → 제외', !countsAsMeasurement(3, false) && !countsAsMeasurement(8, false))
  check('측정 포함: 기기 기록 있으면 종료·완료도 셈', countsAsMeasurement(3, true) && countsAsMeasurement(8, true))
  check('측정 포함: 진행 중·상태 10 은 기기 기록이 없어도 셈', countsAsMeasurement(2, false) && countsAsMeasurement(10, false))
  check('증감률: 10 → 15 = +50%, 이전 0이면 null', changeRate(15, 10) === 50 && changeRate(3, 0) === null)

  // aggregateWeeks — 지난주(11-09~15) + 이번 주(11-16 월 ~ 오늘 11-18 수)
  const today = W + 9 * DAY_SEC // 11-18
  const dates = Array.from({ length: 10 }, (_, i) => W + i * DAY_SEC)
  const daily = {
    days: dates.map((d, i) => ({ date: dayLabel(d), measured: 0, peak: i + 1, today: d === today })),
    devices: [{ key: 'ecg', label: '심전계', days: dates.map((d, i) => ({ date: dayLabel(d), uses: 1, peak: i === 2 ? null : i + 1, capacity: 10 })) }],
  } as unknown as Parameters<typeof aggregateWeeks>[0]
  const parents = [{ s: W + 3600, e: W + 2 * DAY_SEC }, { s: W + 6 * DAY_SEC, e: W + 8 * DAY_SEC }, { s: W + 8 * DAY_SEC, e: W + 9 * DAY_SEC + 3600 }]
  const wk = aggregateWeeks(daily, parents, today, 2)
  check('주별: 2주, 이번 주가 마지막·진행 중', wk.length === 2 && wk[0].weekStart === '2026-11-09' && wk[0].weekEnd === '2026-11-15' && wk[1].current && !wk[0].current)
  check('주별: 실측정 수 — 지난주 2, 이번 주 2', wk[0].measured === 2 && wk[1].measured === 2, wk.map((w) => w.measured))
  check('주별: 최대 동시 평균(오늘 제외)·최고(오늘 포함)', wk[0].peakAvg === 4 && wk[0].peakMax === 7 && wk[1].peakAvg === 8.5 && wk[1].peakMax === 10, wk.map((w) => [w.peakAvg, w.peakMax]))
  check('주별: 가동률 평균은 수치 없는 날 제외', Math.abs((wk[0].devices[0].peakRateAvg ?? 0) - (1 + 2 + 4 + 5 + 6 + 7) / 6 * 10) < 1e-9 && wk[0].devices[0].peakRateMax === 70)
  check('주별: 이번 주는 전주 대비 없음, 첫 주도 없음', wk[0].measuredChange === null && wk[1].measuredChange === null)
  // 계약·공급 수량 (가동률의 분모)
  const plan = { deals: [{ date: '2025-05-21', qty: 20 }, { date: '2026-11-15', qty: 10 }, { date: null, qty: 3 }], supply: null }
  check('계약일 전에는 그 딜을 세지 않는다', capacityOn(plan, '2026-11-14').capacity === 23)
  check('계약일부터 센다', capacityOn(plan, '2026-11-15').capacity === 33)
  check('계약일 없는 딜은 전 기간', capacityOn(plan, '2020-01-01').capacity === 3)
  check('공급만 있으면 공급 수량', JSON.stringify(capacityOn({ deals: [], supply: 7 }, '2026-11-18')) === '{"capacity":7,"contract":null,"supply":7}')
  check('계약 + 공급은 합산', capacityOn({ deals: [{ date: '2025-01-01', qty: 5 }], supply: 2 }, '2026-11-18').capacity === 7)
  const mixed = { deals: [{ date: '2025-01-01', qty: 20, model: 'general' as const }, { date: '2025-06-01', qty: 50, model: 'usage' as const }], supply: 5 }
  check('판매모델: 합산 = 일반 + 사용량 + 공급', capacityOn(planForModel(mixed, 'all'), '2026-01-01').capacity === 75)
  check('판매모델: 일반형 = 일반 딜 + 공급', capacityOn(planForModel(mixed, 'general'), '2026-01-01').capacity === 25)
  check('판매모델: 사용량비례형 = 사용량 딜만 (공급 제외)', capacityOn(planForModel(mixed, 'usage'), '2026-01-01').capacity === 50)
  check('판매모델: 사용량 딜 계약일 전에는 없음', capacityOn(planForModel(mixed, 'usage'), '2025-05-31').capacity === null)
  check('둘 다 없으면 null', capacityOn(undefined, '2026-11-18').capacity === null && capacityOn({ deals: [{ date: '2027-01-01', qty: 5 }], supply: null }, '2026-11-18').capacity === null)

  // 기기 종류의 판매모델 = 도입 수량이 한 모델뿐이면 그 모델 (화순성심: 심전계 150 사용량 딜)
  check('종류 모델: 사용량 딜만 → 사용량비례형', typeModelOf({ deals: [{ date: '2025-05-28', qty: 150, model: 'usage' }], supply: null }) === 'usage')
  check('종류 모델: 공급만 → 일반형', typeModelOf({ deals: [], supply: 100 }) === 'general')
  // 카트온은 사용량비례형 (공급 수량·연결 안 된 기기)
  check('기본 모델: 카트온 사용량비례형, 심전계 일반형', defaultModelOf(10) === 'usage' && defaultModelOf(1) === 'general' && defaultModelOf(3) === 'general')
  const cartSupply = { deals: [], supply: 100, supplyModel: defaultModelOf(10) }
  check('종류 모델: 카트온 공급만 → 사용량비례형', typeModelOf(cartSupply) === 'usage')
  check('카트온 공급은 사용량비례형 분모', capacityOn(planForModel(cartSupply, 'usage'), '2026-11-18').capacity === 100 && capacityOn(planForModel(cartSupply, 'general'), '2026-11-18').capacity === null)
  check('카트온 사용량 딜 + 공급 → 한 모델(사용량비례형)', typeModelOf({ deals: [{ date: null, qty: 10, model: 'usage' }], supply: 3, supplyModel: 'usage' }) === 'usage')
  check('종류 모델: 사용량 딜 + 공급 → 섞임(null, 시리얼로)', typeModelOf({ deals: [{ date: null, qty: 10, model: 'usage' }], supply: 3 }) === null)
  check('종류 모델: 일반·사용량 딜 → 섞임(null)', typeModelOf(mixed) === null)
  check('종류 모델: 수량 없음 → null', typeModelOf(undefined) === null)
  // 측정의 판매모델 = 심전계·산소포화도 우선, 없으면 카트온, 둘 다 없으면 일반형
  const S = (...m: ('general' | 'usage')[]) => new Set(m)
  const eq = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x))
  check('측정 모델: 사용량 심전계 + 일반 카트온 → 사용량만', eq(measurementModels(S('usage'), S('general')), ['usage']))
  check('측정 모델: 카트온만 → 카트온의 모델', eq(measurementModels(undefined, S('general')), ['general']))
  check('측정 모델: 심전계 모델이 섞이면 양쪽', eq(measurementModels(S('usage', 'general'), undefined), ['usage', 'general']))
  check('측정 모델: 기기 정보 없음 → 일반형', eq(measurementModels(undefined, undefined), ['general']))
  check('측정 모델: 기기 정보 없음 + 병원이 사용량비례형뿐 → 사용량', eq(measurementModels(undefined, undefined, 'usage'), ['usage']))
  const hwasun = [{ deals: [{ date: '2025-05-28', qty: 150, model: 'usage' as const }], supply: null }, { deals: [], supply: 100, supplyModel: defaultModelOf(10) }]
  check('병원 모델: 화순성심(사용량 딜 + 카트온 공급) → 사용량비례형', hospitalModelOf(hwasun) === 'usage')
  check('병원 모델: 섞이면 일반형', hospitalModelOf([...hwasun, { deals: [], supply: 5 }]) === 'general' && hospitalModelOf([]) === 'general')
}

const [hospital, daysArg] = positional
if (hospital) {
  const days = daysArg === '90' ? 90 : 30
  console.log(`\n■ 실제 데이터 대조 — ${hospital}, 최근 ${days}일`)
  const t0 = Date.now()
  const daily = await getUsageDaily(hospital, days)
  const ms = Date.now() - t0
  console.log(`  화면용 계산 ${ms}ms · 서버 ${daily.receive.servers}대 · 마지막 수신 ${fmtTime(daily.receive.lastSuccessAt)} · 기기 수치 시작 ${daily.deviceDataFrom ?? '-'}`)
  const db = usageDb()
  await db.connect()
  try {
    // 화면용 계산과 다른 방식(SQL 창 함수)으로 같은 지표를 낸다
    const sql = await db.query(
      `WITH m AS (
         SELECT start_at AS s,
                CASE WHEN measurement_status = 2
                     THEN LEAST(end_at, COALESCE(source_gone_at AT TIME ZONE 'Asia/Seoul', now() AT TIME ZONE 'Asia/Seoul'))
                     WHEN measurement_status = 10 AND source_modified_at < end_at THEN source_modified_at
                     ELSE end_at END AS e
         FROM raw_measurements
         WHERE hospital_code = $1 AND measurement_status IN (2, 3, 10) AND COALESCE(parent_type, 0) = 0
           AND start_at IS NOT NULL AND end_at IS NOT NULL
           AND NOT (measurement_status = 10 AND source_modified_at < end_at AND start_at = source_created_at)
       ), mm AS (SELECT s, GREATEST(e, s + interval '1 second') AS e FROM m WHERE e >= s),
       days AS (SELECT generate_series($2::date, $3::date, interval '1 day')::date AS d),
       ev AS (
         SELECT d.d, GREATEST(mm.s, d.d::timestamp) AS t, 1 AS delta FROM days d JOIN mm ON mm.s < d.d + 1 AND mm.e > d.d
         UNION ALL
         SELECT d.d, LEAST(mm.e, (d.d + 1)::timestamp), -1 FROM days d JOIN mm ON mm.s < d.d + 1 AND mm.e > d.d
       ), run AS (SELECT d, sum(delta) OVER (PARTITION BY d ORDER BY t, delta) AS c FROM ev)
       SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
              (SELECT count(*) FROM mm WHERE mm.s < days.d + 1 AND mm.e > days.d)::int AS measured,
              COALESCE((SELECT max(c) FROM run WHERE run.d = days.d), 0)::int AS peak
       FROM days ORDER BY days.d`,
      [hospital, daily.range.from, daily.range.to],
    )
    const byDate = new Map(sql.rows.map((r) => [r.date as string, r]))
    // 오늘은 두 계산 사이에 시각이 흐르므로 뺀다
    const diffs = daily.days.filter((d) => !d.today).filter((d) => {
      const r = byDate.get(d.date)
      return !r || r.measured !== d.measured || r.peak !== d.peak
    })
    check(`측정 환자 수·최대 동시측정 수: ${daily.days.length - 1}일 모두 별도 SQL 계산과 일치`, diffs.length === 0, diffs.slice(0, 3))
    check('측정 환자 수 ≥ 최대 동시측정 수 (모든 날)', daily.days.every((d) => d.measured >= d.peak))
    for (const dv of daily.devices) {
      const known = dv.days.filter((d) => d.uses !== null)
      check(`${dv.label}: 사용 횟수 ≥ 최대 동시사용 (수치 있는 ${known.length}일)`, known.every((d) => (d.uses as number) >= (d.peak as number)))
      check(`${dv.label}: 오늘 계약·공급 수량 = 마지막 날 분모`, dv.capacity === dv.days[dv.days.length - 1].capacity)
    }
    // 판매모델로 나눈 값의 관계
    const [gen, use] = await Promise.all([getUsageDaily(hospital, days, 'general'), getUsageDaily(hospital, days, 'usage')])
    const sumOk = daily.days.every((d, i) => d.measured <= gen.days[i].measured + use.days[i].measured && d.measured >= Math.max(gen.days[i].measured, use.days[i].measured))
    check('판매모델: 합산 측정 수는 일반형·사용량비례형 각각 이상, 둘의 합 이하 (섞인 측정은 양쪽에 셈)', sumOk)
    for (let k = 0; k < daily.devices.length; k++) {
      const a = daily.devices[k], g = gen.devices[k], u = use.devices[k]
      const usesOk = a.days.every((d, i) => d.uses === null || d.uses === (g.days[i].uses ?? 0) + (u.days[i].uses ?? 0))
      const capOk = a.days.every((d, i) => (d.capacity ?? 0) === (g.days[i].capacity ?? 0) + (u.days[i].capacity ?? 0))
      check(`${a.label}: 사용 횟수 합산 = 일반형 + 사용량비례형, 분모 합산 = 일반형 + 사용량비례형`, usesOk && capOk)
    }
    console.log(`  판매모델 선택지: ${daily.models.map((m) => `${m.label}${m.available ? '' : '(없음)'}`).join(' · ')}`)
    for (const [name, x] of [['일반형', gen], ['사용량비례형', use]] as const) {
      console.log(`  ${name}: 평균 측정 환자 수 ${x.summary.avgMeasured?.toFixed(1) ?? '-'} · ` + x.devices.map((dv) => `${dv.label} 계약 ${dv.capacity ?? '-'} 동시 가동률 ${dv.avgPeakRate === null ? '-' : Math.round(dv.avgPeakRate) + '%'}`).join(' · '))
    }
    const last = daily.days.slice(-7)
    console.log('\n  최근 7일')
    console.log('  날짜        측정환자 최대동시 | ' + daily.devices.map((d) => `${d.label}(계약 ${d.capacity ?? '-'}) 사용/동시`).join(' | '))
    last.forEach((d, i) => {
      const idx = daily.days.length - last.length + i
      const dev = daily.devices.map((x) => `${x.days[idx].uses ?? '-'}/${x.days[idx].peak ?? '-'}`.padStart(8)).join('              | ')
      console.log(`  ${d.date}  ${String(d.measured).padStart(6)} ${String(d.peak).padStart(8)} | ${dev}${d.today ? '  (오늘)' : ''}`)
    })
    console.log(`\n  요약: 평균 측정 환자 수 ${daily.summary.avgMeasured?.toFixed(1) ?? '-'} · 최대 동시측정 최고 ${daily.summary.maxPeak ?? '-'} (${daily.summary.maxPeakDate ?? '-'}) · 오늘 ${daily.summary.todayMeasured}`)
    for (const dv of daily.devices) {
      console.log(`  ${dv.label}: 계약·공급 ${dv.capacity ?? '-'}대(${dv.capacitySource ?? '-'}) · 동시 가동률 평균 ${dv.avgPeakRate === null ? '-' : Math.round(dv.avgPeakRate) + '%'} · 일 사용률 평균 ${dv.avgUseRate === null ? '-' : Math.round(dv.avgUseRate) + '%'}`)
    }
  } finally {
    await db.end()
  }
}

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`)
process.exit(failed > 0 ? 1 : 0)
