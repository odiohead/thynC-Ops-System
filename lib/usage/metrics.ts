/**
 * 사용량 지표 — 원본 DB에서 읽어 화면을 열 때 바로 계산한다 (projects/usage_collection_design.md §14)
 *
 * 병원 단위, 일별:
 *  - 측정 환자 수      그날 걸쳐 있던 측정 건수 (환자 식별값을 받지 않으므로 측정 건수로 센다)
 *  - 최대 동시측정 수   그날 어느 한 시점에 동시에 진행 중이던 측정의 최대 수
 *  - 기기 종류별        사용 횟수(그날 걸쳐 있던 "측정 × 기기"의 수), 최대 동시사용 수, 등록 기기 수
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
 */
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

export type UsageDeviceDay = { date: string; uses: number | null; peak: number | null }

export type UsageDevice = {
  type: number
  key: string
  label: string
  registered: number
  /** 기간 평균(오늘·수치 없는 날 제외), % — 등록 기기가 없으면 null */
  avgPeakRate: number | null
  avgUseRate: number | null
  days: UsageDeviceDay[]
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

  const [receive, measurements, units, registered] = await Promise.all([
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
    pool.query(
      `SELECT device_type, count(*)::int AS n FROM raw_device_registers
       WHERE hospital_code = $1 AND gone_at IS NULL AND COALESCE(return_status, 0) = 0 AND device_type = ANY($2::int[])
       GROUP BY device_type`,
      [hospitalCode, kinds],
    ),
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
  const registeredByType = new Map<number, number>(registered.rows.map((r) => [Number(r.device_type), Number(r.n)]))

  const dayStarts = Array.from({ length: days }, (_, i) => first + i * DAY_SEC)
  const dayRows = dayStarts.map((d) => {
    const st = dayStats(parents, d)
    return { date: dayLabel(d), measured: st.count, peak: st.peak, today: d === today }
  })
  const deviceKnown = dayStarts.map((d) => dayStats(purged, d).count === 0)
  const firstKnown = deviceKnown.indexOf(true)

  const devices: UsageDevice[] = USAGE_DEVICE_KINDS.map((k) => {
    const ivs = unitsByType.get(k.type) ?? []
    const reg = registeredByType.get(k.type) ?? 0
    const rows: UsageDeviceDay[] = dayStarts.map((d, i) => {
      if (!deviceKnown[i]) return { date: dayLabel(d), uses: null, peak: null }
      const st = dayStats(ivs, d)
      return { date: dayLabel(d), uses: st.count, peak: st.peak }
    })
    const past = rows.filter((_, i) => dayStarts[i] !== today)
    const rate = (v: number | null) => (v === null || reg === 0 ? null : (v / reg) * 100)
    return {
      type: k.type,
      key: k.key,
      label: k.label,
      registered: reg,
      avgPeakRate: average(past.map((r) => rate(r.peak))),
      avgUseRate: average(past.map((r) => rate(r.uses))),
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
