/**
 * 사용량 지표 — 원본 DB에서 읽어 화면을 열 때 바로 계산한다 (projects/usage_collection_design.md §14)
 *
 * 병원 단위, 일별:
 *  - 측정 환자 수      그날 걸쳐 있던 측정 건수 (환자 식별값을 받지 않으므로 측정 건수로 센다)
 *  - 최대 동시측정 수   그날 어느 한 시점에 동시에 진행 중이던 측정의 최대 수
 *  - 기기 종류별        사용 횟수(그날 걸쳐 있던 "측정 × 기기"의 수), 최대 동시사용 수, 계약·공급 수량(가동률의 분모)
 *
 * 정의
 *  - 측정: 실제로 시작된 측정(상태 2 측정 중 · 3 종료 · 10 보관 기한 경과). 대기(1)는 제외.
 *    환자 수·동시측정은 부모 측정만 센다(심전도 리드 추가로 생긴 자식 행 제외).
 *    진행 중인 측정은 현재 시각까지, 병원에서 삭제된 진행 중 측정은 삭제를 확인한 시각까지.
 *  - 기기 사용 구간: (측정, 기기 종류, 시리얼) 하나가 한 단위다. 병원 DB의 측정 기기 목록은 교체하면
 *    이전 기기가 사라지므로, 기기 상태 이력에 나타난 시리얼을 함께 본다.
 *      시작 = 그 기기의 첫 상태 이력 시각 (없으면 측정 시작)
 *      끝   = 지금도 측정에 붙어 있으면 측정의 끝, 빠졌으면 마지막 상태 이력 시각
 *  - 하루의 경계는 병원 현지 자정. 국내 병원 기준 Asia/Seoul 로 본다.
 *  - 보관 기한이 지나 기기 정보가 지워진 측정(상태 10, 기기 단위 없음)이 걸친 날은 기기별 수치를 내지 않는다(null).
 *  - 가동률의 분모 = 운영관리시스템의 계약·공급 수량 (2026-11-18 사용자 결정 — 병원 서버의 기기 등록 수가 아니다).
 *    병원 상세 '도입 현황' 카드의 '계약/공급' 값과 같은 규칙: 계약완료 딜의 기기 수량(sales_deal_devices) + 비계약 공급 수량
 *    (hospital_device_supplies, 대웅 직판). 날짜별로 그날까지 계약된 딜만 센다(계약일 ≤ 그날, 계약일이 없는 딜은 전 기간).
 *    공급 수량은 이력이 없어 현재 값을 전 기간에 쓴다. 계약 수량에는 용도 구분이 없어 평가용 제외는 해당 없음.
 */
import { prisma } from '@/lib/prisma'
import { DEAL_STATUS_CATEGORY, DEAL_STATUS_CONTRACTED } from '@/lib/deviceRegistryShared'
import { usagePool } from './db'
import { DAY_SEC, average, dayLabel, dayStats, localDayStart, type Interval } from './daily'

export const USAGE_TZ = 'Asia/Seoul'
const TZ_OFFSET_HOURS = 9

/** 화면에 따로 보여 주는 기기 종류 (제품 DB device_type) */
export const USAGE_DEVICE_KINDS = [
  { type: 1, key: 'ecg', label: '심전계' },
  { type: 3, key: 'spo2', label: '산소포화도' },
  { type: 10, key: 'cart', label: '카트온' },
] as const

export const USAGE_PERIODS = [30, 90] as const

export type UsageHospital = { hospitalCode: string; servers: number; lastSuccessAt: string | null }

export type UsageDeviceDay = {
  date: string
  uses: number | null
  peak: number | null
  /** 그날의 계약·공급 수량 (가동률의 분모). 없으면 null */
  capacity: number | null
}

export type UsageCapacitySource = 'DEAL' | 'SUPPLY' | 'BOTH'

export type UsageDevice = {
  type: number
  key: string
  label: string
  /** 오늘 기준 계약·공급 수량 — 병원 상세 '도입 현황'의 '계약/공급'과 같은 값. 없으면 null */
  capacity: number | null
  capacitySource: UsageCapacitySource | null
  /** 오늘 기준 수량의 내역 */
  contractQty: number | null
  supplyQty: number | null
  /** 기간 평균(오늘·수치 없는 날·분모 없는 날 제외), % */
  avgPeakRate: number | null
  avgUseRate: number | null
  days: UsageDeviceDay[]
}

type CapacityPlan = { deals: { date: string | null; qty: number }[]; supply: number | null }

/** 기기 종류별 계약·공급 수량 — 운영관리시스템 DB (병원 상세 '도입 현황'과 같은 원천) */
async function loadCapacityPlans(hospitalCode: string, types: number[]): Promise<Map<number, CapacityPlan>> {
  const [deals, supply] = await Promise.all([
    prisma.$queryRaw<{ t: number; contract_date: string | null; qty: number }[]>`
      SELECT di.onprem_device_type AS t, to_char(sd.contract_date, 'YYYY-MM-DD') AS contract_date, sum(sdd.quantity)::int AS qty
        FROM sales_deals sd
        JOIN status_codes sc ON sc.id = sd.status_id
        JOIN sales_deal_devices sdd ON sdd.deal_id = sd.id
        JOIN device_info di ON di.id = sdd.device_info_id
       WHERE sd.hospital_code = ${hospitalCode} AND sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}
         AND di.onprem_device_type = ANY(${types})
       GROUP BY 1, 2`,
    prisma.$queryRaw<{ t: number; qty: number }[]>`
      SELECT di.onprem_device_type AS t, sum(s.quantity)::int AS qty
        FROM hospital_device_supplies s
        JOIN device_info di ON di.id = s.device_info_id
       WHERE s.hospital_code = ${hospitalCode} AND di.onprem_device_type = ANY(${types})
       GROUP BY 1`,
  ])
  const plans = new Map<number, CapacityPlan>()
  const plan = (t: number) => {
    const p = plans.get(t) ?? { deals: [], supply: null }
    plans.set(t, p)
    return p
  }
  for (const r of deals) plan(Number(r.t)).deals.push({ date: r.contract_date, qty: Number(r.qty) })
  for (const r of supply) plan(Number(r.t)).supply = Number(r.qty)
  return plans
}

/** 그날(YYYY-MM-DD)의 계약·공급 수량. 계약 딜도 공급도 없으면 null */
export function capacityOn(plan: CapacityPlan | undefined, date: string): { capacity: number | null; contract: number | null; supply: number | null } {
  if (!plan) return { capacity: null, contract: null, supply: null }
  const signed = plan.deals.filter((d) => d.date === null || d.date <= date)
  const contract = signed.length > 0 ? signed.reduce((a, d) => a + d.qty, 0) : null
  const supply = plan.supply
  if (contract === null && supply === null) return { capacity: null, contract: null, supply: null }
  return { capacity: (contract ?? 0) + (supply ?? 0), contract, supply }
}

export type UsageDaily = {
  hospitalCode: string
  range: { from: string; to: string; days: number }
  receive: { servers: number; lastSuccessAt: string | null }
  summary: { avgMeasured: number | null; maxPeak: number | null; maxPeakDate: string | null; todayMeasured: number }
  days: { date: string; measured: number; peak: number; today: boolean }[]
  devices: UsageDevice[]
  /** 기기별 수치가 있는 첫 날 (그 전은 병원 서버에 기기 정보가 남아 있지 않다) */
  deviceDataFrom: string | null
}

export async function listUsageHospitals(): Promise<UsageHospital[]> {
  const r = await usagePool().query(
    `SELECT hospital_code, count(*)::int AS servers, max(last_success_at) AS last_success_at
     FROM agent_servers GROUP BY hospital_code ORDER BY hospital_code`,
  )
  return r.rows.map((x) => ({
    hospitalCode: x.hospital_code as string,
    servers: x.servers as number,
    lastSuccessAt: x.last_success_at ? new Date(x.last_success_at).toISOString() : null,
  }))
}

export async function getUsageReceive(hospitalCode: string): Promise<{ servers: number; lastSuccessAt: string | null }> {
  const r = await usagePool().query(
    `SELECT count(*)::int AS servers, max(last_success_at) AS last_success_at FROM agent_servers WHERE hospital_code = $1`,
    [hospitalCode],
  )
  const x = r.rows[0]
  return { servers: x?.servers ?? 0, lastSuccessAt: x?.last_success_at ? new Date(x.last_success_at).toISOString() : null }
}

// 측정의 유효 구간: 진행 중이면 현재(또는 삭제 확인 시각)까지. 시각은 병원 현지 벽시계 그대로다.
const MEASUREMENT_CTE = `
  m AS (
    SELECT r.server, r.measurement_code, COALESCE(r.parent_type, 0) AS parent_type, r.measurement_status,
           r.start_at AS s_ts,
           CASE WHEN r.measurement_status = 2
                THEN LEAST(r.end_at, COALESCE(r.source_gone_at AT TIME ZONE '${USAGE_TZ}', now() AT TIME ZONE '${USAGE_TZ}'))
                ELSE r.end_at END AS e_ts
    FROM raw_measurements r
    WHERE r.hospital_code = $1 AND r.measurement_status IN (2, 3, 10)
      AND r.start_at IS NOT NULL AND r.end_at IS NOT NULL
      AND r.start_at < $3::timestamp
      AND (r.measurement_status = 2 OR r.end_at >= $2::timestamp)
  )`

export async function getUsageDaily(hospitalCode: string, days: number, nowMs: number = Date.now()): Promise<UsageDaily> {
  const pool = usagePool()
  const today = localDayStart(nowMs, TZ_OFFSET_HOURS)
  const first = today - (days - 1) * DAY_SEC
  const from = dayLabel(first)
  const toExclusive = dayLabel(today + DAY_SEC)
  const kinds = USAGE_DEVICE_KINDS.map((k) => k.type)

  const [receive, measurements, units, plans] = await Promise.all([
    getUsageReceive(hospitalCode),
    pool.query(
      `WITH ${MEASUREMENT_CTE}
       SELECT m.server, m.measurement_code, m.parent_type, m.measurement_status,
              EXTRACT(EPOCH FROM m.s_ts)::float8 AS s, EXTRACT(EPOCH FROM m.e_ts)::float8 AS e
       FROM m`,
      [hospitalCode, from, toExclusive],
    ),
    pool.query(
      `WITH ${MEASUREMENT_CTE},
       st AS (
         SELECT ds.server, ds.measurement_code, ds.device_type::int AS device_type, COALESCE(ds.serial_number, '') AS serial_number,
                min(ds.event_at) AS fe, max(ds.event_at) AS le
         FROM raw_device_status ds
         JOIN m ON m.server = ds.server AND m.measurement_code = ds.measurement_code
         WHERE ds.hospital_code = $1 AND ds.event_at >= timestamp '2000-01-01'
         GROUP BY ds.server, ds.measurement_code, ds.device_type, COALESCE(ds.serial_number, '')
       ),
       d AS (
         SELECT server, measurement_code, device_type, serial_number, removed_at
         FROM raw_measurement_devices WHERE hospital_code = $1
       )
       SELECT m.server, m.measurement_code, COALESCE(st.device_type, d.device_type) AS device_type,
              EXTRACT(EPOCH FROM GREATEST(m.s_ts, COALESCE(st.fe, m.s_ts)))::float8 AS s,
              EXTRACT(EPOCH FROM LEAST(m.e_ts,
                CASE WHEN d.measurement_code IS NOT NULL AND d.removed_at IS NULL THEN m.e_ts
                     ELSE COALESCE(st.le, d.removed_at AT TIME ZONE '${USAGE_TZ}', m.e_ts) END))::float8 AS e
       FROM st
       FULL JOIN d ON d.server = st.server AND d.measurement_code = st.measurement_code
                  AND d.device_type = st.device_type AND d.serial_number = st.serial_number
       JOIN m ON m.server = COALESCE(st.server, d.server) AND m.measurement_code = COALESCE(st.measurement_code, d.measurement_code)`,
      [hospitalCode, from, toExclusive],
    ),
    loadCapacityPlans(hospitalCode, [...kinds]),
  ])

  // 측정 구간 (환자 수·동시측정은 부모 측정만)
  const parents: Interval[] = []
  const all: { key: string; status: number; iv: Interval }[] = []
  for (const r of measurements.rows) {
    if (r.s === null || r.e === null) continue
    const iv = { s: Number(r.s), e: Number(r.e) }
    if (iv.e < iv.s) continue
    all.push({ key: `${r.server}|${r.measurement_code}`, status: Number(r.measurement_status), iv })
    if (Number(r.parent_type) === 0) parents.push(iv)
  }

  // 기기 사용 구간 (종류별) + 기기 단위가 하나라도 있는 측정
  const unitsByType = new Map<number, Interval[]>()
  const hasUnits = new Set<string>()
  for (const r of units.rows) {
    if (r.s === null || r.e === null) continue
    hasUnits.add(`${r.server}|${r.measurement_code}`)
    const type = Number(r.device_type)
    if (!kinds.includes(type as (typeof kinds)[number])) continue
    const list = unitsByType.get(type) ?? []
    list.push({ s: Number(r.s), e: Number(r.e) })
    unitsByType.set(type, list)
  }
  // 보관 기한이 지나 기기 정보가 지워진 측정 — 이 측정이 걸친 날은 기기별 수치를 알 수 없다
  const purged = all.filter((m) => m.status === 10 && !hasUnits.has(m.key)).map((m) => m.iv)

  const dayStarts = Array.from({ length: days }, (_, i) => first + i * DAY_SEC)
  const dayRows = dayStarts.map((d) => {
    const st = dayStats(parents, d)
    return { date: dayLabel(d), measured: st.count, peak: st.peak, today: d === today }
  })
  const deviceKnown = dayStarts.map((d) => dayStats(purged, d).count === 0)
  const firstKnown = deviceKnown.indexOf(true)

  const devices: UsageDevice[] = USAGE_DEVICE_KINDS.map((k) => {
    const ivs = unitsByType.get(k.type) ?? []
    const plan = plans.get(k.type)
    const rows: UsageDeviceDay[] = dayStarts.map((d, i) => {
      const date = dayLabel(d)
      const cap = capacityOn(plan, date).capacity
      if (!deviceKnown[i]) return { date, uses: null, peak: null, capacity: cap }
      const st = dayStats(ivs, d)
      return { date, uses: st.count, peak: st.peak, capacity: cap }
    })
    const past = rows.filter((_, i) => dayStarts[i] !== today)
    const rate = (v: number | null, cap: number | null) => (v === null || !cap ? null : (v / cap) * 100)
    const now = capacityOn(plan, dayLabel(today))
    return {
      type: k.type,
      key: k.key,
      label: k.label,
      capacity: now.capacity,
      capacitySource: now.capacity === null ? null : now.contract !== null && now.supply !== null ? 'BOTH' : now.supply !== null ? 'SUPPLY' : 'DEAL',
      contractQty: now.contract,
      supplyQty: now.supply,
      avgPeakRate: average(past.map((r) => rate(r.peak, r.capacity))),
      avgUseRate: average(past.map((r) => rate(r.uses, r.capacity))),
      days: rows,
    }
  })

  const past = dayRows.filter((r) => !r.today)
  let maxPeak: number | null = null
  let maxPeakDate: string | null = null
  for (const r of dayRows) {
    if (maxPeak === null || r.peak > maxPeak) {
      maxPeak = r.peak
      maxPeakDate = r.date
    }
  }
  return {
    hospitalCode,
    range: { from, to: dayLabel(today), days },
    receive,
    summary: {
      avgMeasured: average(past.map((r) => r.measured)),
      maxPeak: receive.servers > 0 ? maxPeak : null,
      maxPeakDate: receive.servers > 0 ? maxPeakDate : null,
      todayMeasured: dayRows[dayRows.length - 1]?.measured ?? 0,
    },
    days: dayRows,
    devices,
    deviceDataFrom: firstKnown >= 0 ? dayLabel(dayStarts[firstKnown]) : null,
  }
}
