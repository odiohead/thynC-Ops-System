/**
 * 사용량 지표 계산 검증 (projects/usage_collection_design.md §14)
 *
 *   npx tsx scripts/usage-metrics-test.mts                    계산 함수(순수) 검사
 *   npx tsx scripts/usage-metrics-test.mts <병원코드> [30|90]   + 원본 DB 의 실제 데이터로, 화면용 계산과 별도 SQL 계산을 대조 (읽기 전용)
 */
import { DAY_SEC, average, changeRate, dayLabel, dayStats, localDayStart, spanStats, startedIn, weekStartOf } from '../lib/usage/daily'
import { aggregateWeeks, capacityOn, countsAsMeasurement, defaultModelOf, deviceModelOf, getUsageDaily, getUsageDailyAllModels, hospitalModelOf, measurementModels, planForModel, premiumModel, typeModelOf } from '../lib/usage/metrics'
import { OVERVIEW_DAYS, planTrend, summarizeOverview, summarizeOverviewActivity, summarizeOverviewBuckets, summarizeOverviewTotal, summarizeOverviewTrend, type OverviewDay } from '../lib/usage/overview'
import { BED_PRESETS, DEFAULT_FILTERS, bedsLabel, diffFilters, filtersFromParams, filtersToParams, inBedRange, normalizeViewFilters, parseBeds, parseBedsParam, readViewFilters, sortTypes, type ViewFilters } from '../lib/usage/filters'
import { agentHospitalState } from '../lib/usage/agents'
import { statsRunMode } from '../lib/usage/stats'
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
  check('구간 걸침 수: 5일짜리 측정은 그 주 1건', spanStats([{ s: W + 3600, e: W + 5 * DAY_SEC }], W, W + 7 * DAY_SEC).count === 1)
  check('구간 걸침 수: 주를 넘긴 측정은 두 주에 각 1건', spanStats([{ s: W + 6 * DAY_SEC, e: W + 9 * DAY_SEC }], W, W + 7 * DAY_SEC).count === 1 && spanStats([{ s: W + 6 * DAY_SEC, e: W + 9 * DAY_SEC }], W + 7 * DAY_SEC, W + 14 * DAY_SEC).count === 1)
  check('측정 포함: 종료·완료인데 기기 기록 없음 → 제외', !countsAsMeasurement(3, false) && !countsAsMeasurement(8, false))
  check('측정 포함: 기기 기록 있으면 종료·완료도 셈', countsAsMeasurement(3, true) && countsAsMeasurement(8, true))
  check('측정 포함: 진행 중·상태 10 은 기기 기록이 없어도 셈', countsAsMeasurement(2, false) && countsAsMeasurement(10, false))
  check('측정 포함: 상태 이력을 아직 다 받지 못한 서버의 종료 측정은 기기 기록이 없어도 셈', countsAsMeasurement(3, false, false))
  check('신규 측정 수: 그날 시작한 것만 (전날 시작해 이어지는 측정 제외)', startedIn([{ s: h(-5), e: h(30) }, { s: h(0), e: h(2) }, { s: h(23), e: h(50) }, { s: h(24), e: h(25) }], D, D + DAY_SEC) === 2)
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
  check('주별: 신규 측정 수 — 지난주 2(월·토 시작), 이번 주 1(화 시작)', wk[0].started === 2 && wk[1].started === 1, wk.map((w) => w.started))
  check('주별: 최대 동시 평균(오늘 제외)·최고(오늘 포함)', wk[0].peakAvg === 4 && wk[0].peakMax === 7 && wk[1].peakAvg === 8.5 && wk[1].peakMax === 10, wk.map((w) => [w.peakAvg, w.peakMax]))
  check('주별: 가동률 평균은 수치 없는 날 제외', Math.abs((wk[0].devices[0].peakRateAvg ?? 0) - (1 + 2 + 4 + 5 + 6 + 7) / 6 * 10) < 1e-9 && wk[0].devices[0].peakRateMax === 70)
  check('주별: 이번 주는 전주 대비 없음, 첫 주도 없음', wk[0].startedChange === null && wk[1].startedChange === null)
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
  // 기기 하나의 판매모델 (2026-11-25 — 섞인 종류는 병원 서버의 기기 등록 값)
  check('등록 값: 1 사용량비례형 · 0 일반형 · 없음 null', premiumModel(1) === 'usage' && premiumModel(0) === 'general' && premiumModel(null) === null && premiumModel(undefined) === null)
  check('기기 모델: 종류가 한 모델뿐이면 등록 값과 무관하게 그 모델', deviceModelOf(1, 'usage', 0, 'general') === 'usage' && deviceModelOf(3, 'general', 1, 'usage') === 'general')
  check('기기 모델: 섞인 종류의 심전계는 등록 값 (문산중앙 — 계약건 연결 없음)', deviceModelOf(1, null, 1, undefined) === 'usage' && deviceModelOf(1, null, 0, undefined) === 'general')
  check('기기 모델: 등록 값이 계약건보다 먼저', deviceModelOf(3, null, 1, 'general') === 'usage' && deviceModelOf(3, null, 0, 'usage') === 'general')
  check('기기 모델: 등록 값이 없으면 계약건, 그것도 없으면 일반형', deviceModelOf(1, null, null, 'usage') === 'usage' && deviceModelOf(1, null, null, undefined) === 'general')
  check('기기 모델: 수량이 없는 종류(undefined)도 등록 값', deviceModelOf(1, undefined, 1, undefined) === 'usage')
  check('기기 모델: 카트온은 등록 값을 보지 않는다 (계약건 → 사용량비례형)', deviceModelOf(10, null, 0, undefined) === 'usage' && deviceModelOf(10, null, 0, 'general') === 'general')
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

console.log('\n■ 전체 병원 화면 — 기간 평균·판정')
{
  const T = Date.UTC(2026, 10, 19) / 1000 // 오늘 = 2026-11-19 (목)
  // 오늘에서 back 일 전의 하루. 기본 수량 100
  const day = (back: number, peak: number | null, capacity: number | null = 100): OverviewDay => ({ date: dayLabel(T - back * DAY_SEC), peak, capacity })
  // 최근 = 오늘 포함 30일(back 0~29), 이전 = 그 앞 30일(back 30~59)
  const series = (recentPeak: number, prevPeak: number, cap: number | null = 100) =>
    Array.from({ length: 91 }, (_, back) => day(back, back < OVERVIEW_DAYS ? recentPeak : prevPeak, cap))
  const flat = summarizeOverview(series(20, 20), T, T)
  check('최근 30일 = 오늘을 뺀 29일, 이전 = 30일', flat.validDays === 29 && flat.prevValidDays === 30)
  check('가동률 = 일별 (최대 동시 ÷ 수량)의 평균', flat.rate === 20 && flat.avgPeak === 20 && flat.avgCapacity === 100 && flat.capacity === 100)
  check('변화 0%p → 유지', flat.change === 0 && flat.verdict === 'flat' && flat.hold === null)
  check('+5%p → 증가, +4%p → 유지', summarizeOverview(series(25, 20), T, T).verdict === 'up' && summarizeOverview(series(24, 20), T, T).verdict === 'flat')
  check('−5%p → 감소, −4%p → 유지', summarizeOverview(series(15, 20), T, T).verdict === 'down' && summarizeOverview(series(16, 20), T, T).verdict === 'flat')
  check('오늘 값은 평균에 넣지 않는다', summarizeOverview([day(0, 100), ...series(20, 20).slice(1)], T, T).rate === 20)
  const none = summarizeOverview([], T, T)
  check('집계 행이 없으면 판정 보류(집계 전)', none.hold === 'pending' && none.verdict === 'hold' && none.rate === null)
  const noCap = summarizeOverview(series(20, 20, null), T, T)
  check('계약·공급 수량이 없으면 가동률 없음 · 판정 보류(수량 없음)', noCap.hold === 'no_capacity' && noCap.rate === null && noCap.capacity === null)
  check('기기 상태 이력을 따라잡는 중이면 값은 내되 판정 보류', (() => { const r = summarizeOverview(series(30, 20), T, T, true); return r.hold === 'behind' && r.rate === 30 && r.change === 10 })())
  // 이전 기간에 수치 있는 날이 13일뿐 (나머지는 기기별 수치 없음)
  const shortPrev = Array.from({ length: 91 }, (_, back) => day(back, back >= 30 && back < 60 && back >= 43 ? null : 20))
  check('어느 한 기간의 유효한 날이 14일 미만이면 판정 보류', (() => { const r = summarizeOverview(shortPrev, T, T); return r.prevValidDays === 13 && r.hold === 'short' && r.rate === 20 })())
  // 수신이 끊긴 병원: 마지막 수신일(5일 전) 자정 전까지만 유효 → 최근 기간은 back 6~29 = 24일
  const cut = summarizeOverview([...Array.from({ length: 6 }, (_, back) => day(back, 0)), ...series(20, 20).slice(6)], T, T - 5 * DAY_SEC)
  check('수신이 끊긴 병원: 마지막 수신일부터는 평균에서 뺀다', cut.validDays === 24 && cut.rate === 20 && cut.verdict === 'flat')
  // 수량이 100 → 200 으로 늘어남 (최근 10일)
  const grown = Array.from({ length: 91 }, (_, back) => day(back, 20, back < 10 ? 200 : 100))
  check('수량 변동: 처음 값 → 지금 값', JSON.stringify(summarizeOverview(grown, T, T).capacityChange) === '{"from":100,"to":200}' && summarizeOverview(series(20, 20), T, T).capacityChange === null)
  check('수량이 바뀌면 가동률은 날마다 그날 수량으로', Math.abs(summarizeOverview(grown, T, T).rate! - (9 * 10 + 20 * 20) / 29) < 1e-9)
  const w = flat.weeks
  check('12주 추이: 12개, 마지막이 이번 주(월요일 11-16)', w.length === 12 && w[11].weekStart === '2026-11-16' && w[0].weekStart === '2026-08-31')
  // 이번 주(11-16 월 ~ 11-18 수, 오늘 11-19 제외)만 30, 그 전은 20 / 집계가 60일뿐이면 그보다 앞선 주는 비운다
  const thisWeek = summarizeOverview(Array.from({ length: 91 }, (_, back) => day(back, back >= 1 && back <= 3 ? 30 : back === 0 ? 99 : 20)), T, T).weeks
  check('12주 추이: 이번 주는 오늘을 뺀 날만', thisWeek[11].rate === 30 && thisWeek[10].rate === 20)
  check('12주 추이: 집계가 없는 주는 비운다', summarizeOverview(series(20, 20).slice(0, 60), T, T).weeks[0].rate === null && w[0].rate === 20)
  // 전체: 큰 병원 30/150, 작은 병원 13/20 → (30+13)/(150+20)
  const big = summarizeOverview(series(30, 30, 150), T, T)
  const small = summarizeOverview(series(13, 10, 20), T, T)
  const total = summarizeOverviewTotal([big, small, noCap, none])
  check('전체 가동률 = Σ 평균 최대 동시 ÷ Σ 수량 (단순 평균 아님)', Math.abs(total.rate! - (43 / 170) * 100) < 1e-9 && total.peakSum === 43 && total.capacitySum === 170 && total.rated === 2)
  check('전체 변화 = 두 기간 모두 값이 있는 병원끼리', Math.abs(total.change! - ((43 / 170) * 100 - (40 / 170) * 100)) < 1e-9)
  check('판정별 병원 수', total.up === 1 && total.flat === 1 && total.hold === 2 && total.down === 0)
  check('병원이 없으면 전체 값 없음', summarizeOverviewTotal([]).rate === null && summarizeOverviewTotal([]).capacitySum === null)
}

console.log('\n■ 에이전트 관리 — 병원 상태')
{
  check('서버 2대 등록 · 2대 수집 → 수집 중', agentHospitalState(2, 2, 2, true) === 'collecting')
  check('서버 2대 등록 · 1대만 수집 → 일부 수집', agentHospitalState(2, 2, 1, true) === 'partial')
  check('서버 대수 2 · 설치 1대 · 그 1대 수집 → 일부 수집 (설치가 덜 됨)', agentHospitalState(2, 1, 1, true) === 'partial')
  check('받은 적이 있는데 지금 수집 0대 → 수신 끊김', agentHospitalState(2, 2, 0, true) === 'stopped')
  check('서버가 없으면 설치 대기', agentHospitalState(2, 0, 0, false) === 'waiting')
  check('등록만 하고 한 번도 받지 못했으면 설치 대기 (수신 끊김 아님)', agentHospitalState(2, 1, 0, false) === 'waiting')
  check('등록 없이 병원 토큰으로 수집 → 설치된 서버 수가 기준', agentHospitalState(null, 2, 2, true) === 'collecting' && agentHospitalState(null, 2, 1, true) === 'partial')
}


console.log('\n■ 일별 집계 주기 — 최근 3일 / 하루 한 번 전체 (2026-11-26)')
{
  // KST 시각 → epoch ms
  const kst = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h - 9, m)
  check('전체 집계를 한 적이 없으면 full', statsRunMode(kst(26, 14), null) === 'full')
  check('오늘 03:05 에 전체를 돌렸으면 그 뒤는 recent', statsRunMode(kst(26, 4, 1), kst(26, 3, 5)) === 'recent' && statsRunMode(kst(26, 23, 59), kst(26, 3, 5)) === 'recent')
  check('다음 날 02:59 까지 recent, 03:00 부터 full', statsRunMode(kst(27, 2, 59), kst(26, 3, 5)) === 'recent' && statsRunMode(kst(27, 3, 0), kst(26, 3, 5)) === 'full')
  check('어제 오후에 돌린 전체 → 오늘 02:30 은 recent, 03:01 은 full', statsRunMode(kst(26, 2, 30), kst(25, 14, 42)) === 'recent' && statsRunMode(kst(26, 3, 1), kst(25, 14, 42)) === 'full')
  check('새벽에 앱이 내려가 있었으면 다시 뜬 뒤 첫 주기가 full', statsRunMode(kst(26, 10, 0), kst(25, 3, 2)) === 'full')
  check('오늘 03시 이후(낮)에 돌린 전체가 있으면 recent', statsRunMode(kst(26, 15, 0), kst(26, 12, 42)) === 'recent')
  check('자정 직후(00:30)는 어제 03시가 기준 — 어제 03:10 전체면 recent', statsRunMode(kst(27, 0, 30), kst(26, 3, 10)) === 'recent')
}

console.log('\n■ 전체 병원 대시보드 (2026-11-25)')
{
  const T = Date.UTC(2026, 10, 25) / 1000 // 오늘 2026-11-25 (수)
  const dayOf = (offset: number) => dayLabel(T + offset * DAY_SEC)
  const mk = (peak: number, cap: number): OverviewDay[] => Array.from({ length: 84 }, (_, i) => ({ date: dayOf(-(i + 1)), peak, capacity: cap }))
  const a = summarizeOverview(mk(10, 100), T, T) // 10%
  const b = summarizeOverview(mk(30, 50), T, T) // 60%
  check('주별 값에 평균 최대 동시·평균 수량이 함께 나온다', a.weeks.length === 12 && a.weeks[5].avgPeak === 10 && a.weeks[5].avgCapacity === 100 && a.weeks[5].rate === 10)
  const trend = summarizeOverviewTrend([a, b])
  check('전체 추이: 주마다 Σ 평균 최대 동시 ÷ Σ 평균 수량 (단순 평균 35% 아님)', trend.length === 12 && Math.abs(trend[5].rate! - (40 / 150) * 100) < 1e-9 && trend[5].hospitals === 2, trend[5])
  const none = summarizeOverview([], T, T)
  const t2 = summarizeOverviewTrend([a, none])
  check('전체 추이: 값이 없는 병원은 빼고 센다', t2[5].hospitals === 1 && t2[5].rate === 10, t2[5])
  check('전체 추이: 병원이 없으면 빈 목록', summarizeOverviewTrend([]).length === 0)
  check('전체 추이: 모두 값이 없으면 null', summarizeOverviewTrend([none]).every((w) => w.rate === null && w.hospitals === 0))
  // 측정 활동: 최근 30일(오늘 제외 29일) 하루 10건, 이전 30일 하루 5건
  const days = [
    ...Array.from({ length: 29 }, (_, i) => ({ date: dayOf(-(i + 1)), started: 10, measured: 100 })),
    ...Array.from({ length: 30 }, (_, i) => ({ date: dayOf(-(i + 30)), started: 5, measured: 50 })),
    { date: dayOf(0), started: 999, measured: 999 }, // 오늘은 빠진다
    { date: dayOf(-60), started: 999, measured: 999 }, // 이전 30일보다 앞은 빠진다
  ]
  const act = summarizeOverviewActivity(days, T)
  check('측정 활동: 최근 30일 합(오늘 제외) · 이전 30일 합', act.started === 290 && act.prevStarted === 150, act)
  check('측정 활동: 증감률 · 하루 평균 측정 환자', Math.abs(act.startedChange! - ((290 - 150) / 150) * 100) < 1e-9 && act.avgMeasured === 100)
  check('측정 활동: 일별 값은 날짜순 29일', act.days.length === 29 && act.days[0].date === dayOf(-29) && act.days[28].date === dayOf(-1))
  check('측정 활동: 이전 기간이 없으면 증감률 없음', summarizeOverviewActivity(days.slice(0, 29), T).startedChange === null && summarizeOverviewActivity([], T).avgMeasured === null)
}

console.log('\n■ 대시보드 필터 · 추이 기간 · 저장된 보기의 조건 (2026-11-26)')
{
  const T = Date.UTC(2026, 10, 26) / 1000 // 오늘 2026-11-26 (목), 이번 주 월요일 11-23
  const dayOf = (offset: number) => dayLabel(T + offset * DAY_SEC)
  const FIRST = Date.UTC(2026, 7, 23) / 1000 // 집계 첫 날 2026-08-23 (일)
  // 추이 구간
  const p12 = planTrend({ kind: 'weeks', weeks: 12 }, T, FIRST)
  check('12주: 주 단위 12구간, 첫 구간은 11주 전 월요일(09-07), 마지막은 이번 주(11-23)부터 오늘까지', p12.unit === 'week' && p12.buckets.length === 12 && p12.buckets[0].label === '09-07' && p12.buckets[11].label === '11-23' && p12.buckets[11].end === T + DAY_SEC, p12.buckets.map((b) => b.label))
  const p26 = planTrend({ kind: 'weeks', weeks: 26 }, T, FIRST)
  check('26주: 주 단위 26구간', p26.unit === 'week' && p26.buckets.length === 26)
  const p52 = planTrend({ kind: 'weeks', weeks: 52 }, T, FIRST)
  check('52주: 월 단위(26주 초과), 달 표기 YYYY-MM — 51주 전 월요일(2025-12-01)의 달부터 2026-11 까지 12구간', p52.unit === 'month' && p52.buckets[0].label === '2025-12' && p52.buckets[p52.buckets.length - 1].label === '2026-11' && p52.buckets.length === 12, p52.buckets.map((b) => b.label))
  const pAll = planTrend({ kind: 'all' }, T, FIRST)
  check('전체: 집계 첫 날(08-23)부터 — 첫 구간은 그 주 월요일(08-17) 이름이지만 08-23 부터만 센다', pAll.unit === 'week' && pAll.from === FIRST && pAll.buckets[0].label === '08-17' && pAll.buckets[0].start === FIRST, pAll.buckets.slice(0, 2))
  check('전체: 집계가 아직 없으면 12주와 같은 범위', planTrend({ kind: 'all' }, T, null).buckets.length === 12)
  const pR = planTrend({ kind: 'range', from: '2026-10-01', to: '2026-10-31' }, T, FIRST)
  check('직접 지정 10-01 ~ 10-31: 주 단위 5구간(09-28 주 ~ 10-26 주), 양 끝은 걸친 날만', pR.unit === 'week' && pR.buckets.length === 5 && pR.buckets[0].start === Date.UTC(2026, 9, 1) / 1000 && pR.buckets[4].end === Date.UTC(2026, 10, 1) / 1000, pR.buckets)
  const pClamp = planTrend({ kind: 'range', from: '2026-01-01', to: '2027-12-31' }, T, FIRST)
  check('직접 지정이 집계 첫 날 · 오늘을 넘으면 그 안으로 맞춘다', pClamp.from === FIRST && pClamp.to === T + DAY_SEC)
  check('직접 지정이 오늘 뒤뿐이면 구간 없음', planTrend({ kind: 'range', from: '2027-01-01', to: '2027-01-31' }, T, FIRST).buckets.length === 0)
  // 구간별 전체 가동률 = 12주 추이 함수와 같은 값
  const mk = (peak: number, cap: number, n = 100): OverviewDay[] => Array.from({ length: n }, (_, i) => ({ date: dayOf(-(i + 1)), peak, capacity: cap }))
  const dA = mk(10, 100)
  const dB = mk(30, 50, 20) // 최근 20일만 값이 있는 병원
  const trendOld = summarizeOverviewTrend([summarizeOverview(dA, T, T), summarizeOverview(dB, T, T)])
  const trendNew = summarizeOverviewBuckets([{ days: dA, validBefore: T }, { days: dB, validBefore: T }], T, p12.buckets)
  check('구간별 계산(12주) = 12주 추이 계산 — 값 · 병원 수', trendNew.length === 12 && trendNew.every((p, i) => p.hospitals === trendOld[i].hospitals && (p.rate === null ? trendOld[i].rate === null : Math.abs(p.rate - trendOld[i].rate!) < 1e-9)), { trendNew, trendOld })
  const late = summarizeOverviewBuckets([{ days: dA, validBefore: T - 10 * DAY_SEC }], T, p12.buckets)
  check('수신이 끊긴 병원은 마지막 수신일 뒤의 구간에서 빠진다', late[11].hospitals === 0 && late[11].rate === null && late[9].hospitals === 1, late.slice(8))
  const monthly = summarizeOverviewBuckets([{ days: dA, validBefore: T }], T, p52.buckets)
  check('월 단위: 값이 없는 달은 null, 있는 달은 10%', monthly[0].rate === null && monthly[monthly.length - 1].rate === 10 && monthly[monthly.length - 1].label === '2026-11')
  // 조건 묶음 ↔ 주소
  const get = (qs: string) => (k: string) => new URLSearchParams(qs).get(k)
  check('주소에 적힌 것만 읽는다', JSON.stringify(filtersFromParams(get('model=usage&types=종합병원,병원'))) === JSON.stringify({ model: 'usage', types: ['종합병원', '병원'] }))
  check('추이: weeks · range=all · from/to', JSON.stringify(filtersFromParams(get('weeks=26')).trend) === '{"kind":"weeks","weeks":26}' && filtersFromParams(get('range=all')).trend?.kind === 'all' && JSON.stringify(filtersFromParams(get('from=2026-10-01&to=2026-10-31')).trend) === '{"kind":"range","from":"2026-10-01","to":"2026-10-31"}')
  check('모르는 값은 버린다 (기기 · 주 수 · 뒤집힌 날짜 · 이상한 병원 코드)', JSON.stringify(filtersFromParams(get('device=xx&weeks=7&from=2026-11-01&to=2026-10-01&hospitals=HOSP-000001,<bad>'))) === JSON.stringify({ hospitals: ['HOSP-000001'] }))
  const f: ViewFilters = { device: 'spo2', model: 'general', types: ['병원'], hospitals: ['HOSP-000001', 'HOSP-000002'], beds: { min: 51, max: 100 }, trend: { kind: 'weeks', weeks: 26 } }
  check('주소로 적었다 다시 읽으면 같은 조건', diffFilters({ ...DEFAULT_FILTERS, ...filtersFromParams(get(filtersToParams(f).toString())) }, f).length === 0)
  check('기본값은 주소에 적지 않는다', filtersToParams(DEFAULT_FILTERS).toString() === '')
  check('보기에서 바뀐 것만 적기 — 빈 값도 적는다(보기의 종별을 지운 경우)', filtersToParams({ ...f, types: [] }, ['types']).toString() === 'types=' && JSON.stringify(filtersFromParams(get('types=')).types) === '[]')
  check('다른 항목 찾기 — 순서는 보지 않는다', diffFilters(f, { ...f, hospitals: ['HOSP-000002', 'HOSP-000001'] }).length === 0 && JSON.stringify(diffFilters(f, { ...f, model: 'all', trend: { kind: 'all' } })) === '["model","trend"]')
  // 저장할 조건 검사
  const ok = normalizeViewFilters({ device: 'ecg', model: 'all', types: ['병원', '병원', ' '], hospitals: ['HOSP-000001', 'x y'], trend: { kind: 'all' } })
  check('저장 전 정리: 중복 · 빈 종별 · 이상한 코드 제거', 'filters' in ok && JSON.stringify(ok.filters) === JSON.stringify({ device: 'ecg', model: 'all', types: ['병원'], hospitals: ['HOSP-000001'], beds: null, trend: { kind: 'all' } }), ok)
  check('저장 거부: 모르는 기기 · 판매모델 · 추이', 'error' in normalizeViewFilters({ device: 'x', model: 'all' }) && 'error' in normalizeViewFilters({ device: 'ecg', model: 'x' }) && 'error' in normalizeViewFilters({ device: 'ecg', model: 'all', trend: { kind: 'weeks', weeks: 9 } }))
  check('저장 거부: 병원 500곳 초과', 'error' in normalizeViewFilters({ device: 'ecg', model: 'all', hospitals: Array.from({ length: 501 }, (_, i) => `H${i}`) }))
  check('저장돼 있던 조건이 어긋나 있어도 읽는다(기본값으로)', JSON.stringify(readViewFilters({ device: 'zzz', types: ['병원'] })) === JSON.stringify({ ...DEFAULT_FILTERS, types: ['병원'] }) && JSON.stringify(readViewFilters(null)) === JSON.stringify(DEFAULT_FILTERS))
  // 도입 병상 범위
  check('도입 병상: 주소 51-100 · 201-(이상) · -50(이하)', JSON.stringify(parseBedsParam('51-100')) === '{"min":51,"max":100}' && JSON.stringify(parseBedsParam('201-')) === '{"min":201,"max":null}' && JSON.stringify(parseBedsParam('-50')) === '{"min":0,"max":50}')
  check('도입 병상: 0 이상 전부 · 빈 값 · 뒤집힌 범위 · 모르는 모양은 범위 없음', parseBedsParam('0-') === null && parseBedsParam('') === null && parseBedsParam('100-51') === null && parseBedsParam('abc') === null && parseBedsParam('-') === null)
  check('도입 병상: 주소에 적었다 다시 읽으면 같은 범위 (상한 없음 포함)', BED_PRESETS.every((p) => JSON.stringify(filtersFromParams(get(filtersToParams({ ...DEFAULT_FILTERS, beds: p.range }).toString())).beds) === JSON.stringify(p.range)), filtersToParams({ ...DEFAULT_FILTERS, beds: BED_PRESETS[3].range }).toString())
  check('도입 병상: 주소에 없으면 건드리지 않고, 빈 값이면 보기의 범위를 지운다', !('beds' in filtersFromParams(get('model=usage'))) && filtersToParams({ ...f, beds: null }, ['beds']).toString() === 'beds=' && filtersFromParams(get('beds=')).beds === null)
  check('도입 병상: 다른 항목 찾기', JSON.stringify(diffFilters(f, { ...f, beds: null })) === '["beds"]' && JSON.stringify(diffFilters(f, { ...f, beds: { min: 51, max: null } })) === '["beds"]' && diffFilters(f, { ...f, beds: { min: 51, max: 100 } }).length === 0)
  check('도입 병상: 빠른 선택 넷은 서로 겹치지 않고 0부터 빈틈없이 이어진다', BED_PRESETS.length === 4 && BED_PRESETS[0].range.min === 0 && BED_PRESETS.every((p, i) => i === 0 || p.range.min === (BED_PRESETS[i - 1].range.max as number) + 1) && BED_PRESETS[3].range.max === null)
  check('도입 병상: 범위에 드는가 — 끝 포함, 상한 없음, 값이 빈 병원은 범위가 있으면 빠진다', inBedRange(51, { min: 51, max: 100 }) && inBedRange(100, { min: 51, max: 100 }) && !inBedRange(101, { min: 51, max: 100 }) && !inBedRange(50, { min: 51, max: 100 }) && inBedRange(9999, { min: 201, max: null }) && !inBedRange(200, { min: 201, max: null }) && inBedRange(0, { min: 0, max: 50 }) && !inBedRange(null, { min: 0, max: 50 }) && inBedRange(null, null))
  check('도입 병상: 저장 — 없던 보기는 범위 없음, 이상한 범위는 거부', (() => { const a = normalizeViewFilters({ device: 'ecg', model: 'all' }); const b = normalizeViewFilters({ device: 'ecg', model: 'all', beds: { min: 101, max: 200 } }); return 'filters' in a && a.filters.beds === null && 'filters' in b && JSON.stringify(b.filters.beds) === '{"min":101,"max":200}' })() && 'error' in normalizeViewFilters({ device: 'ecg', model: 'all', beds: { min: 200, max: 100 } }) && 'error' in normalizeViewFilters({ device: 'ecg', model: 'all', beds: { min: -1, max: 10 } }) && 'error' in normalizeViewFilters({ device: 'ecg', model: 'all', beds: '51-100' }))
  check('도입 병상: 저장돼 있던 범위가 어긋나 있으면 범위 없음으로 읽는다', readViewFilters({ device: 'ecg', model: 'all', beds: { min: 'x' } }).beds === null && parseBeds({ min: 0, max: null }) === null && parseBeds({ max: 50 })?.min === 0)
  check('도입 병상: 표기', bedsLabel(null) === '전체' && bedsLabel({ min: 51, max: 100 }) === '51~100병상' && bedsLabel({ min: 201, max: null }) === '201병상 이상')
  check('종별 순서: 상급종합 → 종합병원 → 병원 → 요양병원 → 그 밖', sortTypes([{ type: '의원' }, { type: '병원' }, { type: '기타' }, { type: '상급종합' }, { type: '요양병원' }, { type: '종합병원' }]).map((x) => x.type).join(',') === '상급종합,종합병원,병원,요양병원,의원,기타')
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
    // 판매모델 3종을 한 번 읽어 낸 값 = 판매모델마다 따로 낸 값 (오늘은 계산 사이에 시각이 흐르므로 뺀다)
    const trio = await getUsageDailyAllModels(hospital, days)
    const pastOf = (x: typeof daily) => JSON.stringify([x.days.filter((d) => !d.today), x.devices.map((dv) => dv.days.slice(0, -1)), x.models])
    check('판매모델 3종 일괄 계산 = 판매모델별 계산 (합산·일반형·사용량비례형)', pastOf(trio.all) === pastOf(daily) && pastOf(trio.general) === pastOf(gen) && pastOf(trio.usage) === pastOf(use))
    if (days === OVERVIEW_DAYS) {
      // 전체 병원 화면의 '최근 30일 가동률' = 이 화면의 '동시 가동률 평균'
      const todayStart = Date.parse(`${daily.range.to}T00:00:00Z`) / 1000
      for (const dv of daily.devices) {
        const o = summarizeOverview(dv.days.map((d) => ({ date: d.date, peak: d.peak, capacity: d.capacity })), todayStart, todayStart)
        const same = o.rate === null || dv.avgPeakRate === null ? o.rate === dv.avgPeakRate : Math.abs(o.rate - dv.avgPeakRate) < 1e-9
        check(`${dv.label}: 전체 병원 화면의 최근 30일 가동률 = 병원별 화면의 동시 가동률 평균`, same, { overview: o.rate, hospital: dv.avgPeakRate })
      }
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
