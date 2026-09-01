/**
 * 디바이스 원장 읽기 — 병원 요약(§7.1 summary)·전역 커버리지(§6.1-A)·시리얼 조회(§6.1)·목록 where 빌더(units/events/export 공용)
 *
 * 3층 구조(B-20): 목록·상세는 배치 행(`hospital_devices`, 병원 인덱스) WHERE + 유닛(`device_units`) 조인으로 읽고
 * **공개 형상으로 평탄화**한다 — `id`는 유닛 id, 식별 컬럼(serialNo·serialRaw·deviceInfoId·macAddress·memo)은 유닛에서 온다.
 * GET 경로는 DB에 쓰지 않는다 — WMS 매칭은 표시·집계용 일시 계산(§9.2, 영속 링크 없음).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  DEAL_STATUS_CATEGORY,
  DEAL_STATUS_CONTRACTED,
  normalizeSerial,
  todayKst,
  type DeviceEventType,
  type UsageFilter,
  type UsageTypeRef,
} from '@/lib/deviceRegistryShared'
import { RegistryError, loadTrackedModels, ymd, ymdMinusDays, ymdToDate, type DbClient } from './core'
import { matchInventoryUnits, queryWmsUnits, wmsWarning, type WmsMatch, type WmsMatchInput, type WmsUnitRow } from './wms'

/** 커버리지 모집단 — 고객 병원 상태(§6.1-A: 운영·계약완료·보류) ∪ 원장 보유 병원 */
export const CUSTOMER_HOSPITAL_STATUSES = ['운영', '계약완료', '보류'] as const

const n = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0))

// ─────────────────────────────────────────────────────────────────────────────
// 딜 기대 수량 (§9.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpectedCount {
  deals: number
  /** 계약완료 딜 0건이면 null (compare none) */
  expected: number | null
  contractedDeals: { dealCode: string; count: number; roundNo: number; contractDate: string | null }[]
}

export async function getExpectedDeviceCount(hospitalCode: string, client: DbClient = prisma): Promise<ExpectedCount> {
  const rows = await client.$queryRaw<{ deal_code: string; round_no: number; contract_date: Date | null; cnt: number | null }[]>`
    SELECT sd.deal_code, sd.round_no, sd.contract_date, sd.daewoong_device_count AS cnt
      FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
     WHERE sd.hospital_code = ${hospitalCode} AND sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}
     ORDER BY sd.round_no`
  const contractedDeals = rows.map((r) => ({ dealCode: r.deal_code, count: n(r.cnt), roundNo: r.round_no, contractDate: ymd(r.contract_date) }))
  const deals = rows.length
  return { deals, expected: deals === 0 ? null : contractedDeals.reduce((s, d) => s + d.count, 0), contractedDeals }
}

// ─────────────────────────────────────────────────────────────────────────────
// 병원 요약 (§7.1 summary 응답 요지 · §6.1-B 스트립 · §6.2 상세 카드)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelSummary {
  deviceInfoId: number
  deviceModel: string
  deviceName: string
  deviceClass: string
  onpremDeviceType: number | null
  /** 배치 중 전체(용도 무관) */
  active: number
  /** 배치 중 가운데 평가용(usageType value=EVAL) — 계약 대조에서 제외 */
  activeEval: number
  /** 계약 대조용 배치 수 = active − activeEval (판매용 + 미지정) */
  activeForCompare: number
  recovered30d: number
  expected: number | null
  /** hard만 activeForCompare − expected */
  diff: number | null
  compare: 'hard' | 'soft' | 'none'
  /** 배치 중 유닛의 WMS 일시 매칭 집계 — out=OUT 매치, inStock=IN_STOCK 매치, unmatched=매치 없음(그 외 상태 포함) */
  wms: { out: number; inStock: number; unmatched: number }
  lastEvent: { type: string; on: string } | null
}

export interface HospitalDeviceSummary {
  hospitalCode: string
  hospitalName: string
  introBeds: number | null
  expectedDeviceCount: number | null
  contractedDeals: ExpectedCount['contractedDeals']
  models: ModelSummary[]
  wards: { id: number; name: string; extWardCode: string | null; isActive: boolean; sortOrder: number; active: number }[]
  unassigned: number
  lastEventOn: string | null
  lastImportAt: string | null
  lastImport: { id: number; createdAt: string; occurredOn: string | null; rowCount: number; registeredCount: number } | null
  activeTotal: number
  /** 배치 중 평가용 합계(전 모델) */
  evalTotal: number
  recovered30dTotal: number
  today: string
}

export async function getHospitalDeviceSummary(hospitalCode: string, client: DbClient = prisma): Promise<HospitalDeviceSummary | null> {
  const hospital = await client.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true, hospitalName: true, introBeds: true } })
  if (!hospital) return null
  const today = todayKst()
  const since = ymdMinusDays(today, 30)
  const [expected, models, activeUnits, recRows, lastRows, wards, unassigned, lastEvent, lastImport] = await Promise.all([
    getExpectedDeviceCount(hospitalCode, client),
    loadTrackedModels(client),
    client.hospitalDevice.findMany({
      where: { hospitalCode, status: 'ACTIVE' },
      select: { deviceId: true, unit: { select: { deviceInfoId: true, serialNo: true, serialRaw: true, usageType: { select: { value: true } } } } },
    }),
    client.$queryRaw<{ device_info_id: number; cnt: bigint }[]>`
      SELECT u.device_info_id, count(*) AS cnt
        FROM hospital_device_events e JOIN device_units u ON u.id = e.device_id
       WHERE e.event_type = 'RECOVER' AND e.hospital_code = ${hospitalCode} AND e.occurred_on >= ${ymdToDate(since)}::date
       GROUP BY 1`,
    client.$queryRaw<{ device_info_id: number; event_type: string; occurred_on: Date }[]>`
      SELECT DISTINCT ON (u.device_info_id) u.device_info_id, e.event_type, e.occurred_on
        FROM hospital_device_events e JOIN device_units u ON u.id = e.device_id
       WHERE e.hospital_code = ${hospitalCode} AND e.event_type <> 'CORRECT'
       ORDER BY u.device_info_id, e.occurred_on DESC, e.id DESC`,
    client.hospitalWard.findMany({
      where: { hospitalCode },
      select: { id: true, name: true, extWardCode: true, isActive: true, sortOrder: true, _count: { select: { devices: { where: { status: 'ACTIVE' } } } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    client.hospitalDevice.count({ where: { hospitalCode, status: 'ACTIVE', wardId: null } }),
    client.hospitalDeviceEvent.aggregate({ where: { hospitalCode }, _max: { occurredOn: true } }),
    client.hospitalDeviceImportBatch.findFirst({
      where: { hospitalCode, cancelledAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, occurredOn: true, rowCount: true, registeredCount: true },
    }),
  ])

  // 배치 중 유닛의 모델별 수 + WMS 일시 매칭 집계(배치 1쿼리)
  const modelById = new Map(models.map((m) => [m.id, m]))
  const activeBy = new Map<number, number>()
  const evalBy = new Map<number, number>()
  const wmsBy = new Map<number, { out: number; inStock: number; unmatched: number }>()
  const wmsInputs: WmsMatchInput[] = activeUnits.map((r) => ({
    id: r.deviceId,
    serialNo: r.unit.serialNo,
    serialRaw: r.unit.serialRaw,
    deviceInfoId: r.unit.deviceInfoId,
    deviceModel: modelById.get(r.unit.deviceInfoId)?.deviceModel ?? null,
  }))
  const matches = await matchInventoryUnits(client, wmsInputs)
  for (const r of activeUnits) {
    const mid = r.unit.deviceInfoId
    activeBy.set(mid, (activeBy.get(mid) ?? 0) + 1)
    if (r.unit.usageType?.value === 'EVAL') evalBy.set(mid, (evalBy.get(mid) ?? 0) + 1)
    const agg = wmsBy.get(mid) ?? { out: 0, inStock: 0, unmatched: 0 }
    const m = matches.get(r.deviceId) ?? null
    if (!m) agg.unmatched += 1
    else if (m.status === 'OUT') agg.out += 1
    else if (m.status === 'IN_STOCK') agg.inStock += 1
    else agg.unmatched += 1
    wmsBy.set(mid, agg)
  }
  const recBy = new Map(recRows.map((r) => [r.device_info_id, n(r.cnt)]))
  const lastBy = new Map(lastRows.map((r) => [r.device_info_id, { type: r.event_type, on: ymd(r.occurred_on)! }]))

  const out: ModelSummary[] = []
  for (const m of models) {
    const active = activeBy.get(m.id) ?? 0
    const activeEval = evalBy.get(m.id) ?? 0
    const activeForCompare = active - activeEval
    const recovered30d = recBy.get(m.id) ?? 0
    if (!m.isActive && active === 0 && recovered30d === 0) continue
    let compare: ModelSummary['compare'] = 'none'
    let exp: number | null = null
    let diff: number | null = null
    if (m.onpremDeviceType === 1) {
      compare = expected.expected == null ? 'none' : 'hard'
      exp = expected.expected
      diff = exp == null ? null : activeForCompare - exp // 평가용(EVAL)은 계약 대조에서 제외(§9.1)
    } else if (m.onpremDeviceType === 3) {
      compare = expected.expected == null ? 'none' : 'soft'
      exp = expected.expected
      diff = null
    }
    out.push({
      deviceInfoId: m.id,
      deviceModel: m.deviceModel,
      deviceName: m.deviceName,
      deviceClass: m.deviceClass,
      onpremDeviceType: m.onpremDeviceType,
      active,
      activeEval,
      activeForCompare,
      recovered30d,
      expected: exp,
      diff,
      compare,
      wms: wmsBy.get(m.id) ?? { out: 0, inStock: 0, unmatched: active },
      lastEvent: lastBy.get(m.id) ?? null,
    })
  }
  return {
    hospitalCode: hospital.hospitalCode,
    hospitalName: hospital.hospitalName,
    introBeds: hospital.introBeds,
    expectedDeviceCount: expected.expected,
    contractedDeals: expected.contractedDeals,
    models: out,
    wards: wards.map((w) => ({ id: w.id, name: w.name, extWardCode: w.extWardCode, isActive: w.isActive, sortOrder: w.sortOrder, active: w._count.devices })),
    unassigned,
    lastEventOn: ymd(lastEvent._max.occurredOn),
    lastImportAt: lastImport ? lastImport.createdAt.toISOString() : null,
    lastImport: lastImport
      ? { id: lastImport.id, createdAt: lastImport.createdAt.toISOString(), occurredOn: ymd(lastImport.occurredOn), rowCount: lastImport.rowCount, registeredCount: lastImport.registeredCount }
      : null,
    activeTotal: out.reduce((s, m) => s + m.active, 0),
    evalTotal: out.reduce((s, m) => s + m.activeEval, 0),
    recovered30dTotal: out.reduce((s, m) => s + m.recovered30d, 0),
    today,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 전역 커버리지 (§6.1-A 백필 진행판) — 고객 병원 ∪ 원장 보유 병원
// ─────────────────────────────────────────────────────────────────────────────

export type CoverageFilter = 'all' | 'unregistered' | 'diff' | 'complete'
export type CoverageSort = 'diff' | 'name' | 'lastEvent'

export interface CoverageParams {
  page?: number
  limit?: number
  filter?: CoverageFilter | null
  q?: string | null
  sort?: CoverageSort | null
}

export interface CoverageRow {
  hospitalCode: string
  hospitalName: string
  status: string
  deals: number
  expected: number | null
  registered: boolean
  /** 배치 중 ECG 가운데 계약 대조 대상(평가용 제외) */
  activeEcg: number
  /** 배치 중 ECG 평가용 */
  activeEcgEval: number
  activeSpo2: number
  activeGw: number
  activeThird: number
  activeTotal: number
  /** 배치 중 평가용 합계(전 모델) */
  evalTotal: number
  /** activeEcg(평가용 제외) − expected */
  diff: number | null
  recovered30d: number
  lastEvent: { type: string; on: string } | null
  lastImport: { id: number; at: string; occurredOn: string | null; rowCount: number; registeredCount: number } | null
}

export interface CoverageTotals {
  customerHospitals: number
  registeredHospitals: number
  active: { ecg: number; spo2: number; gw: number; third: number; total: number; eval: number }
  events30d: number
  recovered30d: number
}

export interface CoverageResult {
  data: CoverageRow[]
  total: number
  page: number
  limit: number
  totals: CoverageTotals
}

export const COVERAGE_MAX_LIMIT = 1000

export async function getGlobalCoverage(params: CoverageParams, client: DbClient = prisma): Promise<CoverageResult> {
  const page = Math.max(1, Number(params.page) || 1)
  const limit = Math.min(COVERAGE_MAX_LIMIT, Math.max(1, Number(params.limit) || 50))
  const filter: CoverageFilter = params.filter && ['all', 'unregistered', 'diff', 'complete'].includes(params.filter) ? params.filter : 'all'
  const sort: CoverageSort = params.sort && ['diff', 'name', 'lastEvent'].includes(params.sort) ? params.sort : 'diff'
  const q = (params.q ?? '').trim()
  const since = ymdToDate(ymdMinusDays(todayKst(), 30))
  const statuses = [...CUSTOMER_HOSPITAL_STATUSES]

  const base = Prisma.sql`
    WITH pop AS (
      SELECT h.hospital_code, h.hospital_name, h.status
        FROM hospitals h
       WHERE h.status = ANY(${statuses}::text[])
          OR EXISTS (SELECT 1 FROM hospital_devices d WHERE d.hospital_code = h.hospital_code OR d.last_hospital_code = h.hospital_code)
          OR EXISTS (SELECT 1 FROM hospital_device_events e WHERE e.hospital_code = h.hospital_code)
    ), dl AS (
      SELECT sd.hospital_code, count(*)::int AS deals, sum(coalesce(sd.daewoong_device_count, 0))::int AS expected
        FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
       WHERE sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}
       GROUP BY 1
    ), act AS (
      SELECT d.hospital_code,
             count(*) FILTER (WHERE di.onprem_device_type = 1 AND coalesce(ut.value, '') <> 'EVAL')::int AS ecg,
             count(*) FILTER (WHERE di.onprem_device_type = 1 AND ut.value = 'EVAL')::int AS ecg_eval,
             count(*) FILTER (WHERE di.onprem_device_type = 3)::int AS spo2,
             count(*) FILTER (WHERE di.device_class = 'GATEWAY')::int AS gw,
             count(*) FILTER (WHERE di.device_class = 'THIRD_PARTY')::int AS third,
             count(*)::int AS total,
             count(*) FILTER (WHERE ut.value = 'EVAL')::int AS eval_total
        FROM hospital_devices d JOIN device_units u ON u.id = d.device_id JOIN device_info di ON di.id = u.device_info_id
        LEFT JOIN status_codes ut ON ut.id = u.usage_type_id
       WHERE d.status = 'ACTIVE'
       GROUP BY 1
    ), rec AS (
      SELECT hospital_code, count(*)::int AS recovered30d
        FROM hospital_device_events
       WHERE event_type = 'RECOVER' AND occurred_on >= ${since}::date
       GROUP BY 1
    ), lev AS (
      SELECT DISTINCT ON (hospital_code) hospital_code, event_type, occurred_on
        FROM hospital_device_events
       WHERE hospital_code IS NOT NULL AND event_type <> 'CORRECT'
       ORDER BY hospital_code, occurred_on DESC, id DESC
    ), limp AS (
      SELECT DISTINCT ON (hospital_code) hospital_code, id, created_at, occurred_on, row_count, registered_count
        FROM hospital_device_import_batches
       WHERE cancelled_at IS NULL
       ORDER BY hospital_code, created_at DESC
    ), rows AS (
      SELECT p.hospital_code, p.hospital_name, p.status,
             coalesce(dl.deals, 0) AS deals, dl.expected,
             (act.total IS NOT NULL OR lev.hospital_code IS NOT NULL) AS registered,
             coalesce(act.ecg, 0) AS ecg, coalesce(act.ecg_eval, 0) AS ecg_eval, coalesce(act.spo2, 0) AS spo2, coalesce(act.gw, 0) AS gw, coalesce(act.third, 0) AS third,
             coalesce(act.total, 0) AS total, coalesce(act.eval_total, 0) AS eval_total,
             CASE WHEN coalesce(dl.deals, 0) > 0 THEN coalesce(act.ecg, 0) - dl.expected END AS diff,   -- ecg는 평가용 제외(§9.1)
             coalesce(rec.recovered30d, 0) AS recovered30d,
             lev.event_type AS last_event_type, lev.occurred_on AS last_event_on,
             limp.id AS imp_id, limp.created_at AS imp_at, limp.occurred_on AS imp_on, limp.row_count AS imp_rows, limp.registered_count AS imp_reg
        FROM pop p
        LEFT JOIN dl ON dl.hospital_code = p.hospital_code
        LEFT JOIN act ON act.hospital_code = p.hospital_code
        LEFT JOIN rec ON rec.hospital_code = p.hospital_code
        LEFT JOIN lev ON lev.hospital_code = p.hospital_code
        LEFT JOIN limp ON limp.hospital_code = p.hospital_code
    )`
  const whereParts: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (filter === 'unregistered') whereParts.push(Prisma.sql`NOT registered`)
  if (filter === 'diff') whereParts.push(Prisma.sql`deals > 0 AND diff <> 0`)
  if (filter === 'complete') whereParts.push(Prisma.sql`registered AND (deals = 0 OR diff = 0)`)
  if (q) whereParts.push(Prisma.sql`(hospital_name ILIKE ${'%' + q + '%'} OR hospital_code ILIKE ${'%' + q + '%'})`)
  const where = Prisma.join(whereParts, ' AND ')
  const orderBy =
    sort === 'name'
      ? Prisma.sql`hospital_name ASC`
      : sort === 'lastEvent'
        ? Prisma.sql`last_event_on DESC NULLS LAST, hospital_name ASC`
        : Prisma.sql`abs(diff) DESC NULLS LAST, expected DESC NULLS LAST, hospital_name ASC`

  type Raw = {
    hospital_code: string
    hospital_name: string
    status: string
    deals: number
    expected: number | null
    registered: boolean
    ecg: number
    ecg_eval: number
    spo2: number
    gw: number
    third: number
    total: number
    eval_total: number
    diff: number | null
    recovered30d: number
    last_event_type: string | null
    last_event_on: Date | null
    imp_id: number | null
    imp_at: Date | null
    imp_on: Date | null
    imp_rows: number | null
    imp_reg: number | null
  }
  const activeJoin = Prisma.sql`FROM hospital_devices d JOIN device_units u ON u.id = d.device_id JOIN device_info di ON di.id = u.device_info_id LEFT JOIN status_codes ut ON ut.id = u.usage_type_id WHERE d.status = 'ACTIVE'`
  const [rows, countRows, totalsRows] = await Promise.all([
    client.$queryRaw<Raw[]>(Prisma.sql`${base} SELECT * FROM rows WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
    client.$queryRaw<{ cnt: bigint }[]>(Prisma.sql`${base} SELECT count(*) AS cnt FROM rows WHERE ${where}`),
    client.$queryRaw<{ customers: bigint; registered: bigint; ecg: bigint; spo2: bigint; gw: bigint; third: bigint; total: bigint; eval_total: bigint; events30d: bigint; recovered30d: bigint }[]>`
      SELECT (SELECT count(*) FROM hospitals WHERE status = ANY(${statuses}::text[])) AS customers,
             (SELECT count(*) FROM (SELECT hospital_code FROM hospital_devices WHERE hospital_code IS NOT NULL
                                     UNION SELECT hospital_code FROM hospital_device_events WHERE hospital_code IS NOT NULL) x) AS registered,
             (SELECT count(*) ${activeJoin} AND di.onprem_device_type = 1 AND coalesce(ut.value, '') <> 'EVAL') AS ecg,
             (SELECT count(*) ${activeJoin} AND di.onprem_device_type = 3) AS spo2,
             (SELECT count(*) ${activeJoin} AND di.device_class = 'GATEWAY') AS gw,
             (SELECT count(*) ${activeJoin} AND di.device_class = 'THIRD_PARTY') AS third,
             (SELECT count(*) FROM hospital_devices WHERE status = 'ACTIVE') AS total,
             (SELECT count(*) ${activeJoin} AND ut.value = 'EVAL') AS eval_total,
             (SELECT count(*) FROM hospital_device_events WHERE occurred_on >= ${since}::date AND event_type <> 'CORRECT') AS events30d,
             (SELECT count(*) FROM hospital_device_events WHERE event_type = 'RECOVER' AND occurred_on >= ${since}::date) AS recovered30d`,
  ])
  const t = totalsRows[0]
  return {
    data: rows.map((r) => ({
      hospitalCode: r.hospital_code,
      hospitalName: r.hospital_name,
      status: r.status,
      deals: n(r.deals),
      expected: r.expected == null ? null : n(r.expected),
      registered: !!r.registered,
      activeEcg: n(r.ecg),
      activeEcgEval: n(r.ecg_eval),
      activeSpo2: n(r.spo2),
      activeGw: n(r.gw),
      activeThird: n(r.third),
      activeTotal: n(r.total),
      evalTotal: n(r.eval_total),
      diff: r.diff == null ? null : n(r.diff),
      recovered30d: n(r.recovered30d),
      lastEvent: r.last_event_type ? { type: r.last_event_type, on: ymd(r.last_event_on)! } : null,
      lastImport: r.imp_id != null ? { id: r.imp_id, at: r.imp_at!.toISOString(), occurredOn: ymd(r.imp_on), rowCount: n(r.imp_rows), registeredCount: n(r.imp_reg) } : null,
    })),
    total: n(countRows[0]?.cnt),
    page,
    limit,
    totals: {
      customerHospitals: n(t?.customers),
      registeredHospitals: n(t?.registered),
      active: { ecg: n(t?.ecg), spo2: n(t?.spo2), gw: n(t?.gw), third: n(t?.third), total: n(t?.total), eval: n(t?.eval_total) },
      events30d: n(t?.events30d),
      recovered30d: n(t?.recovered30d),
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 목록 where 빌더 — units / events (목록·export 라우트 공용)
// ─────────────────────────────────────────────────────────────────────────────

export type UnitsStatusFilter = 'active' | 'recovered' | 'all'
/** WMS 일시 매칭 기준 — linked=매치 있음 · unlinked=매치 없음 · in_stock=매치가 IN_STOCK */
export type UnitsWmsFilter = 'linked' | 'unlinked' | 'in_stock'
export type UnitsSort = 'ward' | 'serial' | 'placedOn' | 'lastEvent'

export interface UnitsQuery {
  hospital?: string | null
  model?: number | null
  /** 숫자 id 또는 'unassigned' */
  ward?: number | 'unassigned' | null
  /** 기본 active. recovered = 이 병원에서 회수됨(미재배치, last_hospital_code) */
  status?: UnitsStatusFilter | null
  /** 시리얼 키·원문·닉네임(ext_device_code)·메모 부분 일치 */
  q?: string | null
  /** WMS 일시 매칭 기준(§7.1) — 후보 집합을 먼저 매칭한 뒤 id로 좁힌다 */
  wms?: UnitsWmsFilter | null
  /** 용도 — SALE/EVAL(usageType.value) 또는 none(미지정) */
  usage?: UsageFilter | null
  /** 공개 device id(유닛 id) */
  ids?: number[] | null
}

/** `wms` 필터를 제외한 where — 배치 행 기준, 식별 조건은 `unit` 관계로 */
export function buildUnitsWhere(params: UnitsQuery): Prisma.HospitalDeviceWhereInput {
  const and: Prisma.HospitalDeviceWhereInput[] = []
  const status = params.status ?? 'active'
  if (params.hospital) {
    if (status === 'active') and.push({ status: 'ACTIVE', hospitalCode: params.hospital })
    else if (status === 'recovered') and.push({ status: 'RECOVERED', lastHospitalCode: params.hospital })
    else and.push({ OR: [{ status: 'ACTIVE', hospitalCode: params.hospital }, { status: 'RECOVERED', lastHospitalCode: params.hospital }] })
  } else if (status === 'active') and.push({ status: 'ACTIVE' })
  else if (status === 'recovered') and.push({ status: 'RECOVERED' })
  if (params.model != null) and.push({ unit: { deviceInfoId: Number(params.model) } })
  if (params.usage === 'none') and.push({ unit: { usageTypeId: null } })
  else if (params.usage) and.push({ unit: { usageType: { is: { value: params.usage } } } })
  if (params.ward === 'unassigned') and.push({ wardId: null })
  else if (params.ward != null) and.push({ wardId: Number(params.ward) })
  if (params.q && params.q.trim()) {
    const raw = params.q.trim()
    const key = normalizeSerial(raw).serialNo
    const up = raw.replace(/\s+/g, '').toUpperCase()
    and.push({
      OR: [
        { unit: { serialNo: { contains: key || up } } },
        { unit: { serialRaw: { contains: up } } },
        { extDeviceCode: { contains: raw, mode: 'insensitive' } },
        { unit: { memo: { contains: raw, mode: 'insensitive' } } },
      ],
    })
  }
  if (params.ids && params.ids.length > 0) and.push({ deviceId: { in: params.ids } })
  return and.length === 0 ? {} : { AND: and }
}

export function buildUnitsOrderBy(sort: UnitsSort | null | undefined): Prisma.HospitalDeviceOrderByWithRelationInput[] {
  switch (sort) {
    case 'serial':
      return [{ unit: { serialNo: 'asc' } }]
    case 'placedOn':
      return [{ placedOn: 'desc' }, { unit: { serialNo: 'asc' } }]
    case 'lastEvent':
      return [{ lastEventOn: 'desc' }, { deviceId: 'desc' }]
    case 'ward':
    default:
      return [{ ward: { sortOrder: 'asc' } }, { ward: { name: 'asc' } }, { unit: { serialNo: 'asc' } }]
  }
}

export const UNIT_SELECT = {
  id: true,
  deviceInfoId: true,
  serialNo: true,
  serialRaw: true,
  macAddress: true,
  memo: true,
  source: true,
  usageTypeId: true,
  createdAt: true,
  updatedAt: true,
  deviceInfo: { select: { id: true, deviceModel: true, deviceName: true, deviceClass: true, onpremDeviceType: true, serialPattern: true } },
  usageType: { select: { id: true, name: true, value: true } },
} satisfies Prisma.DeviceUnitSelect

export const UNITS_INCLUDE = {
  unit: { select: UNIT_SELECT },
  ward: { select: { id: true, name: true, isActive: true } },
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  lastHospital: { select: { hospitalCode: true, hospitalName: true } },
  recoverReason: { select: { id: true, name: true, value: true } },
  replacedBy: { select: { id: true, serialNo: true } },
} satisfies Prisma.HospitalDeviceInclude

type PlacementWithUnit = Prisma.HospitalDeviceGetPayload<{ include: typeof UNITS_INCLUDE }>

/** 공개 기기 형상(조인 포함) — `id`는 유닛 id, `placementId`는 내부 배치 행 id */
export interface UnitView {
  id: number
  placementId: number
  deviceInfoId: number
  serialNo: string
  serialRaw: string | null
  macAddress: string | null
  memo: string | null
  source: string
  usageTypeId: number | null
  usageType: UsageTypeRef | null
  extDeviceCode: string | null
  extLastSeenAt: Date | null
  extSyncedAt: Date | null
  status: string
  hospitalCode: string | null
  wardId: number | null
  placedOn: Date | null
  lastHospitalCode: string | null
  recoveredOn: Date | null
  recoverReasonId: number | null
  lastEventType: string | null
  lastEventOn: Date | null
  replacedById: number | null
  createdAt: Date
  updatedAt: Date
  deviceInfo: PlacementWithUnit['unit']['deviceInfo']
  ward: PlacementWithUnit['ward']
  hospital: PlacementWithUnit['hospital']
  lastHospital: PlacementWithUnit['lastHospital']
  recoverReason: PlacementWithUnit['recoverReason']
  replacedBy: PlacementWithUnit['replacedBy']
}

export function toUnitView(p: PlacementWithUnit): UnitView {
  const { unit, ...placement } = p
  return {
    id: unit.id,
    placementId: placement.id,
    deviceInfoId: unit.deviceInfoId,
    serialNo: unit.serialNo,
    serialRaw: unit.serialRaw,
    macAddress: unit.macAddress,
    memo: unit.memo,
    source: unit.source,
    usageTypeId: unit.usageTypeId,
    usageType: unit.usageType,
    extDeviceCode: placement.extDeviceCode,
    extLastSeenAt: placement.extLastSeenAt,
    extSyncedAt: placement.extSyncedAt,
    status: placement.status,
    hospitalCode: placement.hospitalCode,
    wardId: placement.wardId,
    placedOn: placement.placedOn,
    lastHospitalCode: placement.lastHospitalCode,
    recoveredOn: placement.recoveredOn,
    recoverReasonId: placement.recoverReasonId,
    lastEventType: placement.lastEventType,
    lastEventOn: placement.lastEventOn,
    replacedById: placement.replacedById,
    createdAt: placement.createdAt,
    updatedAt: placement.updatedAt,
    deviceInfo: unit.deviceInfo,
    ward: placement.ward,
    hospital: placement.hospital,
    lastHospital: placement.lastHospital,
    recoverReason: placement.recoverReason,
    replacedBy: placement.replacedBy,
  }
}

export type UnitListRow = UnitView & {
  lastRef: { type: string; code: string } | null
  /** WMS 표시용 일시 매칭(§9.2 — 영속 링크 없음, DB 쓰기 없음) */
  wms: WmsMatch | null
  /** = `wms` (구 필드명 호환) */
  wmsTransient: WmsMatch | null
  wmsWarning: string | null
}

export const UNITS_MAX_LIMIT = 500
export const UNITS_IDS_MAX = 2000
export const UNITS_EXPORT_MAX = 10_000
/** `wms` 필터의 후보 매칭 상한 — 이보다 큰 집합은 필터를 좁히라고 400 */
export const UNITS_WMS_FILTER_MAX = 10_000

function wmsInputOf(p: { deviceId: number; unit: { serialNo: string; serialRaw: string | null; deviceInfoId: number; deviceInfo: { deviceModel: string } } }): WmsMatchInput {
  return { id: p.deviceId, serialNo: p.unit.serialNo, serialRaw: p.unit.serialRaw, deviceInfoId: p.unit.deviceInfoId, deviceModel: p.unit.deviceInfo.deviceModel }
}

/**
 * `wms` 필터 해석 — 나머지 조건으로 후보를 뽑아 배치 매칭한 뒤 통과한 유닛 id 목록을 돌려준다(없으면 null = 필터 없음).
 * 목록·건수·idsOnly·export가 같은 함수를 써서 결과가 일치한다.
 */
async function resolveWmsFilter(params: UnitsQuery, client: DbClient): Promise<number[] | null> {
  if (!params.wms) return null
  const where = buildUnitsWhere({ ...params, wms: null })
  const total = await client.hospitalDevice.count({ where })
  if (total > UNITS_WMS_FILTER_MAX) throw new RegistryError(400, `창고 필터는 ${UNITS_WMS_FILTER_MAX.toLocaleString()}대 이하에서만 가능합니다 — 병원·모델로 먼저 좁히세요`)
  const cands = await client.hospitalDevice.findMany({
    where,
    select: { deviceId: true, unit: { select: { serialNo: true, serialRaw: true, deviceInfoId: true, deviceInfo: { select: { deviceModel: true } } } } },
  })
  const matches = await matchInventoryUnits(client, cands.map(wmsInputOf))
  const ids = cands
    .filter((c) => {
      const m = matches.get(c.deviceId) ?? null
      if (params.wms === 'linked') return !!m
      if (params.wms === 'unlinked') return !m
      return m?.status === 'IN_STOCK'
    })
    .map((c) => c.deviceId)
  return ids
}

/** 최종 where — `wms` 필터가 있으면 id 집합으로 좁힌다(빈 집합이면 어떤 행도 매치하지 않는 조건) */
export async function resolveUnitsWhere(params: UnitsQuery, client: DbClient = prisma): Promise<Prisma.HospitalDeviceWhereInput> {
  const ids = await resolveWmsFilter(params, client)
  if (ids == null) return buildUnitsWhere(params)
  return buildUnitsWhere({ ...params, wms: null, ids: ids.length > 0 ? (params.ids?.length ? ids.filter((i) => params.ids!.includes(i)) : ids) : [-1] })
}

/** 목록 페이지 — 총건수·행(+마지막 연결 ref·표시용 WMS 매칭) */
export async function listUnits(
  params: UnitsQuery,
  paging: { page?: number; limit?: number; sort?: UnitsSort | null; maxLimit?: number },
  client: DbClient = prisma
): Promise<{ data: UnitListRow[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, Number(paging.page) || 1)
  const limit = Math.min(paging.maxLimit ?? UNITS_MAX_LIMIT, Math.max(1, Number(paging.limit) || 50))
  const where = await resolveUnitsWhere(params, client)
  const [total, rows] = await Promise.all([
    client.hospitalDevice.count({ where }),
    client.hospitalDevice.findMany({ where, include: UNITS_INCLUDE, orderBy: buildUnitsOrderBy(paging.sort), skip: (page - 1) * limit, take: limit }),
  ])
  const data = await decorateUnits(rows, client)
  return { data, total, page, limit }
}

/** 검색 결과 전체 id(일괄 선택 ≤2,000) — 공개 device id(유닛 id) */
export async function listUnitIds(params: UnitsQuery, client: DbClient = prisma): Promise<{ ids: number[]; total: number; truncated: boolean }> {
  const where = await resolveUnitsWhere(params, client)
  const total = await client.hospitalDevice.count({ where })
  const rows = await client.hospitalDevice.findMany({ where, select: { deviceId: true }, orderBy: buildUnitsOrderBy('ward'), take: UNITS_IDS_MAX })
  return { ids: rows.map((r) => r.deviceId), total, truncated: total > rows.length }
}

async function decorateUnits(rows: PlacementWithUnit[], client: DbClient): Promise<UnitListRow[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.deviceId)
  const refRows = await client.$queryRaw<{ device_id: number; ref_type: string | null; ref_code: string | null }[]>`
    SELECT DISTINCT ON (device_id) device_id, ref_type, ref_code
      FROM hospital_device_events
     WHERE device_id = ANY(${ids}::int[]) AND event_type <> 'CORRECT' AND ref_type IS NOT NULL
     ORDER BY device_id, occurred_on DESC, id DESC`
  const refBy = new Map(refRows.map((r) => [r.device_id, r.ref_type && r.ref_code ? { type: r.ref_type, code: r.ref_code } : null]))
  const matches = await matchInventoryUnits(client, rows.map(wmsInputOf))
  return rows.map((r) => {
    const view = toUnitView(r)
    const wms = matches.get(r.deviceId) ?? null
    return { ...view, lastRef: refBy.get(r.deviceId) ?? null, wms, wmsTransient: wms, wmsWarning: wmsWarning(wms, r.status) }
  })
}

export interface EventsQuery {
  hospital?: string | null
  /** 공개 device id(유닛 id) */
  device?: number | null
  type?: DeviceEventType | string | null
  /** YYYY-MM-DD (occurred_on 기준) */
  from?: string | null
  to?: string | null
  refType?: string | null
  refCode?: string | null
  batch?: number | null
  actionGroup?: string | null
  source?: string | null
  /** 시리얼 부분 일치 */
  q?: string | null
}

export function buildEventsWhere(params: EventsQuery): Prisma.HospitalDeviceEventWhereInput {
  const and: Prisma.HospitalDeviceEventWhereInput[] = []
  if (params.hospital) and.push({ hospitalCode: params.hospital })
  if (params.device != null) and.push({ deviceId: Number(params.device) })
  if (params.type) and.push({ eventType: String(params.type) })
  if (params.from) and.push({ occurredOn: { gte: ymdToDate(params.from) } })
  if (params.to) and.push({ occurredOn: { lte: ymdToDate(params.to) } })
  if (params.refType) and.push({ refType: params.refType })
  if (params.refCode) and.push({ refCode: params.refCode })
  if (params.batch != null) and.push({ importBatchId: Number(params.batch) })
  if (params.actionGroup) and.push({ actionGroup: params.actionGroup })
  if (params.source) and.push({ source: params.source })
  if (params.q && params.q.trim()) {
    const key = normalizeSerial(params.q).serialNo
    and.push({ device: { OR: [{ serialNo: { contains: key } }, { serialRaw: { contains: key } }] } })
  }
  return and.length === 0 ? {} : { AND: and }
}

/** 이벤트 행의 `device` — 유닛 + 현재 배치 상태(status·hospitalCode는 배치 프로젝션에서, 없으면 null) */
export const EVENTS_INCLUDE = {
  device: {
    select: {
      id: true,
      serialNo: true,
      serialRaw: true,
      deviceInfo: { select: { id: true, deviceModel: true, deviceName: true, deviceClass: true } },
      usageType: { select: { id: true, name: true, value: true } },
      placement: { select: { status: true, hospitalCode: true } },
    },
  },
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  fromWard: { select: { id: true, name: true } },
  toWard: { select: { id: true, name: true } },
  reasonCode: { select: { id: true, name: true, value: true } },
  relatedDevice: { select: { id: true, serialNo: true } },
  importBatch: { select: { id: true, mode: true, fileName: true, cancelledAt: true } },
} satisfies Prisma.HospitalDeviceEventInclude

type EventRawRow = Prisma.HospitalDeviceEventGetPayload<{ include: typeof EVENTS_INCLUDE }>

/** 공개 이벤트 행 — `device.status`/`device.hospitalCode`를 평탄화(구 단일 테이블 형상 유지) */
export type EventListRow = Omit<EventRawRow, 'device'> & {
  device: {
    id: number
    serialNo: string
    serialRaw: string | null
    status: string | null
    hospitalCode: string | null
    deviceInfo: EventRawRow['device']['deviceInfo']
    usageType: UsageTypeRef | null
  }
}

export function toEventListRow(e: EventRawRow): EventListRow {
  const { device, ...rest } = e
  return {
    ...rest,
    device: {
      id: device.id,
      serialNo: device.serialNo,
      serialRaw: device.serialRaw,
      status: device.placement?.status ?? null,
      hospitalCode: device.placement?.hospitalCode ?? null,
      deviceInfo: device.deviceInfo,
      usageType: device.usageType,
    },
  }
}

export const EVENTS_MAX_LIMIT = 500
export const EVENTS_EXPORT_MAX = 10_000

export async function listEvents(
  params: EventsQuery,
  paging: { page?: number; limit?: number; maxLimit?: number },
  client: DbClient = prisma
): Promise<{ data: EventListRow[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, Number(paging.page) || 1)
  const limit = Math.min(paging.maxLimit ?? EVENTS_MAX_LIMIT, Math.max(1, Number(paging.limit) || 50))
  const where = buildEventsWhere(params)
  const [total, rows] = await Promise.all([
    client.hospitalDeviceEvent.count({ where }),
    client.hospitalDeviceEvent.findMany({ where, include: EVENTS_INCLUDE, orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
  ])
  return { data: rows.map(toEventListRow), total, page, limit }
}

// ─────────────────────────────────────────────────────────────────────────────
// 개체 상세(드로어) · 시리얼 조회 · 임포트 배치 목록
// ─────────────────────────────────────────────────────────────────────────────

const DETAIL_EVENT_INCLUDE = {
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  fromWard: { select: { id: true, name: true } },
  toWard: { select: { id: true, name: true } },
  reasonCode: { select: { id: true, name: true, value: true } },
  relatedDevice: { select: { id: true, serialNo: true } },
  importBatch: { select: { id: true, mode: true, fileName: true, cancelledAt: true } },
} satisfies Prisma.HospitalDeviceEventInclude

export const UNIT_DETAIL_INCLUDE = {
  ...UNITS_INCLUDE,
  unit: {
    select: {
      ...UNIT_SELECT,
      // 이 유닛이 교체기로 들어간 구기기 배치들 → replaces[] (구기기 유닛 id·시리얼)
      replacedPlacements: { select: { unit: { select: { id: true, serialNo: true } } } },
      events: { include: DETAIL_EVENT_INCLUDE, orderBy: [{ occurredOn: 'desc' as const }, { id: 'desc' as const }] },
    },
  },
} satisfies Prisma.HospitalDeviceInclude

type DetailRaw = Prisma.HospitalDeviceGetPayload<{ include: typeof UNIT_DETAIL_INCLUDE }>

export type UnitDetailEvent = DetailRaw['unit']['events'][number]

export type UnitDetail = UnitView & {
  /** 이 개체가 대체한 구기기들(유닛 id·시리얼) */
  replaces: { id: number; serialNo: string }[]
  /** 병원 경계 무관 전체 이벤트 — 최신순 */
  events: UnitDetailEvent[]
  wms: WmsMatch | null
  wmsTransient: WmsMatch | null
  wmsWarning: string | null
}

/** 공개 device id(유닛 id) → 상세. 배치 행이 없는 유닛(이벤트 0)은 null */
export async function getUnitDetail(deviceId: number, client: DbClient = prisma): Promise<UnitDetail | null> {
  const d = await client.hospitalDevice.findUnique({ where: { deviceId }, include: UNIT_DETAIL_INCLUDE })
  if (!d) return null
  const { replacedPlacements, events, ...unitCore } = d.unit
  const view = toUnitView({ ...d, unit: unitCore })
  const wms = (await matchInventoryUnits(client, [wmsInputOf(d)])).get(d.deviceId) ?? null
  return { ...view, replaces: replacedPlacements.map((r) => r.unit), events, wms, wmsTransient: wms, wmsWarning: wmsWarning(wms, d.status) }
}

export interface LookupResult {
  input: { serialNo: string; serialRaw: string | null }
  /** 정확 일치 개체(키 또는 원문) — 배치 행이 있는 유닛만 */
  device: UnitView | null
  /** 0건일 때 — 원장 접두 일치 ≤10 */
  candidates: UnitView[]
  /** 0건일 때 — WMS 정확·접미 일치 ≤10. `linkedDeviceId`는 영속 링크가 없어 항상 null(호환 유지) */
  wmsCandidates: { unitId: number; serialNo: string; status: string; inventoryName: string; itemCode: string; modelName: string | null; linkedDeviceId: number | null }[]
}

/** 헤더 '시리얼 조회' (§6.1) — 정규화 키 또는 원문 정확 일치, 없으면 접두·WMS 후보 */
export async function lookupDevice(serialInput: string, client: DbClient = prisma): Promise<LookupResult> {
  const ns = normalizeSerial(serialInput)
  if (!ns.serialNo) throw new RegistryError(400, '시리얼을 입력하세요')
  const compact = (serialInput ?? '').replace(/\s+/g, '').toUpperCase()
  const device = await client.hospitalDevice.findFirst({
    where: { unit: { OR: [{ serialNo: ns.serialNo }, { serialRaw: compact }, ...(ns.serialRaw ? [{ serialRaw: ns.serialRaw }] : [])] } },
    include: UNITS_INCLUDE,
  })
  if (device) return { input: { serialNo: ns.serialNo, serialRaw: ns.serialRaw }, device: toUnitView(device), candidates: [], wmsCandidates: [] }
  const prefix = ns.serialNo.slice(0, Math.min(5, ns.serialNo.length))
  const [candidates, wms] = await Promise.all([
    client.hospitalDevice.findMany({ where: { unit: { serialNo: { startsWith: prefix } } }, include: UNITS_INCLUDE, orderBy: { unit: { serialNo: 'asc' } }, take: 10 }),
    queryWmsUnits(client, { keys: [ns.serialNo], raws: ns.serialRaw ? [ns.serialRaw, compact] : [compact], limit: 10 }),
  ])
  return {
    input: { serialNo: ns.serialNo, serialRaw: ns.serialRaw },
    device: null,
    candidates: candidates.map(toUnitView),
    wmsCandidates: wms.map((u: WmsUnitRow) => ({ unitId: u.id, serialNo: u.serial_no, status: u.status, inventoryName: u.inventory_name, itemCode: u.item_code, modelName: u.model_name, linkedDeviceId: null })),
  }
}

export const IMPORT_BATCH_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
} satisfies Prisma.HospitalDeviceImportBatchInclude

export type ImportBatchRow = Prisma.HospitalDeviceImportBatchGetPayload<{ include: typeof IMPORT_BATCH_INCLUDE }>

export async function listImportBatches(
  hospitalCode: string,
  paging: { page?: number; limit?: number },
  client: DbClient = prisma
): Promise<{ data: ImportBatchRow[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, Number(paging.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(paging.limit) || 20))
  const where = { hospitalCode }
  const [total, data] = await Promise.all([
    client.hospitalDeviceImportBatch.count({ where }),
    client.hospitalDeviceImportBatch.findMany({ where, include: IMPORT_BATCH_INCLUDE, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ])
  return { data, total, page, limit }
}
