/**
 * 디바이스 원장 읽기 — 병원 요약(§7.1 summary)·전역 커버리지(§6.1-A)·시리얼 조회(§6.1)·목록 where 빌더(units/events/export 공용)
 *
 * GET 경로는 DB에 쓰지 않는다 — WMS 매칭은 표시용(persist:false)만 계산한다(§9.2).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  DEAL_STATUS_CATEGORY,
  DEAL_STATUS_CONTRACTED,
  normalizeSerial,
  todayKst,
  type DeviceEventType,
} from '@/lib/deviceRegistryShared'
import { RegistryError, loadTrackedModels, ymd, ymdMinusDays, ymdToDate, type DbClient } from './core'
import { matchInventoryUnits, queryWmsUnits, wmsWarning, type WmsMatch, type WmsUnitRow } from './wms'

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
  active: number
  recovered30d: number
  expected: number | null
  diff: number | null
  compare: 'hard' | 'soft' | 'none'
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
  recovered30dTotal: number
  today: string
}

export async function getHospitalDeviceSummary(hospitalCode: string, client: DbClient = prisma): Promise<HospitalDeviceSummary | null> {
  const hospital = await client.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true, hospitalName: true, introBeds: true } })
  if (!hospital) return null
  const today = todayKst()
  const since = ymdMinusDays(today, 30)
  const [expected, models, activeGroups, recRows, wmsRows, lastRows, wards, unassigned, lastEvent, lastImport] = await Promise.all([
    getExpectedDeviceCount(hospitalCode, client),
    loadTrackedModels(client),
    client.hospitalDevice.groupBy({ by: ['deviceInfoId'], where: { hospitalCode, status: 'ACTIVE' }, _count: { _all: true } }),
    client.$queryRaw<{ device_info_id: number; cnt: bigint }[]>`
      SELECT d.device_info_id, count(*) AS cnt
        FROM hospital_device_events e JOIN hospital_devices d ON d.id = e.device_id
       WHERE e.event_type = 'RECOVER' AND e.hospital_code = ${hospitalCode} AND e.occurred_on >= ${ymdToDate(since)}::date
       GROUP BY 1`,
    client.$queryRaw<{ device_info_id: number; out_cnt: bigint; in_stock: bigint; unmatched: bigint }[]>`
      SELECT d.device_info_id,
             count(*) FILTER (WHERE u.status = 'OUT') AS out_cnt,
             count(*) FILTER (WHERE u.status = 'IN_STOCK') AS in_stock,
             count(*) FILTER (WHERE d.inventory_unit_id IS NULL) AS unmatched
        FROM hospital_devices d LEFT JOIN inventory_units u ON u.id = d.inventory_unit_id
       WHERE d.hospital_code = ${hospitalCode} AND d.status = 'ACTIVE'
       GROUP BY 1`,
    client.$queryRaw<{ device_info_id: number; event_type: string; occurred_on: Date }[]>`
      SELECT DISTINCT ON (d.device_info_id) d.device_info_id, e.event_type, e.occurred_on
        FROM hospital_device_events e JOIN hospital_devices d ON d.id = e.device_id
       WHERE e.hospital_code = ${hospitalCode} AND e.event_type <> 'CORRECT'
       ORDER BY d.device_info_id, e.occurred_on DESC, e.id DESC`,
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

  const activeBy = new Map(activeGroups.map((g) => [g.deviceInfoId, g._count._all]))
  const recBy = new Map(recRows.map((r) => [r.device_info_id, n(r.cnt)]))
  const wmsBy = new Map(wmsRows.map((r) => [r.device_info_id, { out: n(r.out_cnt), inStock: n(r.in_stock), unmatched: n(r.unmatched) }]))
  const lastBy = new Map(lastRows.map((r) => [r.device_info_id, { type: r.event_type, on: ymd(r.occurred_on)! }]))

  const out: ModelSummary[] = []
  for (const m of models) {
    const active = activeBy.get(m.id) ?? 0
    const recovered30d = recBy.get(m.id) ?? 0
    if (!m.isActive && active === 0 && recovered30d === 0) continue
    let compare: ModelSummary['compare'] = 'none'
    let exp: number | null = null
    let diff: number | null = null
    if (m.onpremDeviceType === 1) {
      compare = expected.expected == null ? 'none' : 'hard'
      exp = expected.expected
      diff = exp == null ? null : active - exp
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
  activeEcg: number
  activeSpo2: number
  activeGw: number
  activeThird: number
  activeTotal: number
  diff: number | null
  recovered30d: number
  lastEvent: { type: string; on: string } | null
  lastImport: { id: number; at: string; occurredOn: string | null; rowCount: number; registeredCount: number } | null
}

export interface CoverageTotals {
  customerHospitals: number
  registeredHospitals: number
  active: { ecg: number; spo2: number; gw: number; third: number; total: number }
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
             count(*) FILTER (WHERE di.onprem_device_type = 1)::int AS ecg,
             count(*) FILTER (WHERE di.onprem_device_type = 3)::int AS spo2,
             count(*) FILTER (WHERE di.device_class = 'GATEWAY')::int AS gw,
             count(*) FILTER (WHERE di.device_class = 'THIRD_PARTY')::int AS third,
             count(*)::int AS total
        FROM hospital_devices d JOIN device_info di ON di.id = d.device_info_id
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
             coalesce(act.ecg, 0) AS ecg, coalesce(act.spo2, 0) AS spo2, coalesce(act.gw, 0) AS gw, coalesce(act.third, 0) AS third, coalesce(act.total, 0) AS total,
             CASE WHEN coalesce(dl.deals, 0) > 0 THEN coalesce(act.ecg, 0) - dl.expected END AS diff,
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
    spo2: number
    gw: number
    third: number
    total: number
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
  const [rows, countRows, totalsRows] = await Promise.all([
    client.$queryRaw<Raw[]>(Prisma.sql`${base} SELECT * FROM rows WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
    client.$queryRaw<{ cnt: bigint }[]>(Prisma.sql`${base} SELECT count(*) AS cnt FROM rows WHERE ${where}`),
    client.$queryRaw<{ customers: bigint; registered: bigint; ecg: bigint; spo2: bigint; gw: bigint; third: bigint; total: bigint; events30d: bigint; recovered30d: bigint }[]>`
      SELECT (SELECT count(*) FROM hospitals WHERE status = ANY(${statuses}::text[])) AS customers,
             (SELECT count(*) FROM (SELECT hospital_code FROM hospital_devices WHERE hospital_code IS NOT NULL
                                     UNION SELECT hospital_code FROM hospital_device_events WHERE hospital_code IS NOT NULL) x) AS registered,
             (SELECT count(*) FROM hospital_devices d JOIN device_info di ON di.id = d.device_info_id WHERE d.status = 'ACTIVE' AND di.onprem_device_type = 1) AS ecg,
             (SELECT count(*) FROM hospital_devices d JOIN device_info di ON di.id = d.device_info_id WHERE d.status = 'ACTIVE' AND di.onprem_device_type = 3) AS spo2,
             (SELECT count(*) FROM hospital_devices d JOIN device_info di ON di.id = d.device_info_id WHERE d.status = 'ACTIVE' AND di.device_class = 'GATEWAY') AS gw,
             (SELECT count(*) FROM hospital_devices d JOIN device_info di ON di.id = d.device_info_id WHERE d.status = 'ACTIVE' AND di.device_class = 'THIRD_PARTY') AS third,
             (SELECT count(*) FROM hospital_devices WHERE status = 'ACTIVE') AS total,
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
      activeSpo2: n(r.spo2),
      activeGw: n(r.gw),
      activeThird: n(r.third),
      activeTotal: n(r.total),
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
      active: { ecg: n(t?.ecg), spo2: n(t?.spo2), gw: n(t?.gw), third: n(t?.third), total: n(t?.total) },
      events30d: n(t?.events30d),
      recovered30d: n(t?.recovered30d),
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 목록 where 빌더 — units / events (목록·export 라우트 공용)
// ─────────────────────────────────────────────────────────────────────────────

export type UnitsStatusFilter = 'active' | 'recovered' | 'all'
export type UnitsWmsFilter = 'linked' | 'unlinked' | 'in_stock'
export type UnitsSort = 'ward' | 'serial' | 'placedOn' | 'lastEvent'

export interface UnitsQuery {
  hospital?: string | null
  model?: number | null
  /** 숫자 id 또는 'unassigned' */
  ward?: number | 'unassigned' | null
  /** 기본 active. recovered = 이 병원에서 회수됨(미재배치, last_hospital_code) */
  status?: UnitsStatusFilter | null
  /** 시리얼 키·원문·닉네임(ext_device_code) 부분 일치 */
  q?: string | null
  /** 영속 inventory_unit_id 기준 (§7.1) */
  wms?: UnitsWmsFilter | null
  ids?: number[] | null
}

export function buildUnitsWhere(params: UnitsQuery): Prisma.HospitalDeviceWhereInput {
  const and: Prisma.HospitalDeviceWhereInput[] = []
  const status = params.status ?? 'active'
  if (params.hospital) {
    if (status === 'active') and.push({ status: 'ACTIVE', hospitalCode: params.hospital })
    else if (status === 'recovered') and.push({ status: 'RECOVERED', lastHospitalCode: params.hospital })
    else and.push({ OR: [{ status: 'ACTIVE', hospitalCode: params.hospital }, { status: 'RECOVERED', lastHospitalCode: params.hospital }] })
  } else if (status === 'active') and.push({ status: 'ACTIVE' })
  else if (status === 'recovered') and.push({ status: 'RECOVERED' })
  if (params.model != null) and.push({ deviceInfoId: Number(params.model) })
  if (params.ward === 'unassigned') and.push({ wardId: null })
  else if (params.ward != null) and.push({ wardId: Number(params.ward) })
  if (params.q && params.q.trim()) {
    const raw = params.q.trim()
    const key = normalizeSerial(raw).serialNo
    const up = raw.replace(/\s+/g, '').toUpperCase()
    and.push({
      OR: [
        { serialNo: { contains: key || up } },
        { serialRaw: { contains: up } },
        { extDeviceCode: { contains: raw, mode: 'insensitive' } },
        { memo: { contains: raw, mode: 'insensitive' } },
      ],
    })
  }
  if (params.wms === 'linked') and.push({ inventoryUnitId: { not: null } })
  else if (params.wms === 'unlinked') and.push({ inventoryUnitId: null })
  else if (params.wms === 'in_stock') and.push({ inventoryUnit: { is: { status: 'IN_STOCK' } } })
  if (params.ids && params.ids.length > 0) and.push({ id: { in: params.ids } })
  return and.length === 0 ? {} : { AND: and }
}

export function buildUnitsOrderBy(sort: UnitsSort | null | undefined): Prisma.HospitalDeviceOrderByWithRelationInput[] {
  switch (sort) {
    case 'serial':
      return [{ serialNo: 'asc' }]
    case 'placedOn':
      return [{ placedOn: 'desc' }, { serialNo: 'asc' }]
    case 'lastEvent':
      return [{ lastEventOn: 'desc' }, { id: 'desc' }]
    case 'ward':
    default:
      return [{ ward: { sortOrder: 'asc' } }, { ward: { name: 'asc' } }, { serialNo: 'asc' }]
  }
}

export const UNITS_INCLUDE = {
  deviceInfo: { select: { id: true, deviceModel: true, deviceName: true, deviceClass: true, onpremDeviceType: true, serialPattern: true } },
  ward: { select: { id: true, name: true, isActive: true } },
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  lastHospital: { select: { hospitalCode: true, hospitalName: true } },
  recoverReason: { select: { id: true, name: true, value: true } },
  replacedBy: { select: { id: true, serialNo: true } },
  inventoryUnit: { select: { id: true, serialNo: true, status: true, item: { select: { itemCode: true, modelName: true } }, inventory: { select: { name: true } } } },
} satisfies Prisma.HospitalDeviceInclude

export type UnitListRow = Prisma.HospitalDeviceGetPayload<{ include: typeof UNITS_INCLUDE }> & {
  lastRef: { type: string; code: string } | null
  /** 영속 링크가 없을 때 표시용 임시 매칭(§9.2 — DB 쓰기 없음) */
  wmsTransient: WmsMatch | null
  wmsWarning: string | null
}

export const UNITS_MAX_LIMIT = 500
export const UNITS_IDS_MAX = 2000
export const UNITS_EXPORT_MAX = 10_000

/** 목록 페이지 — 총건수·행(+마지막 연결 ref·표시용 WMS 매칭) */
export async function listUnits(
  params: UnitsQuery,
  paging: { page?: number; limit?: number; sort?: UnitsSort | null; maxLimit?: number },
  client: DbClient = prisma
): Promise<{ data: UnitListRow[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, Number(paging.page) || 1)
  const limit = Math.min(paging.maxLimit ?? UNITS_MAX_LIMIT, Math.max(1, Number(paging.limit) || 50))
  const where = buildUnitsWhere(params)
  const [total, rows] = await Promise.all([
    client.hospitalDevice.count({ where }),
    client.hospitalDevice.findMany({ where, include: UNITS_INCLUDE, orderBy: buildUnitsOrderBy(paging.sort), skip: (page - 1) * limit, take: limit }),
  ])
  const data = await decorateUnits(rows, client)
  return { data, total, page, limit }
}

/** 검색 결과 전체 id(일괄 선택 ≤2,000) */
export async function listUnitIds(params: UnitsQuery, client: DbClient = prisma): Promise<{ ids: number[]; total: number; truncated: boolean }> {
  const where = buildUnitsWhere(params)
  const total = await client.hospitalDevice.count({ where })
  const rows = await client.hospitalDevice.findMany({ where, select: { id: true }, orderBy: buildUnitsOrderBy('ward'), take: UNITS_IDS_MAX })
  return { ids: rows.map((r) => r.id), total, truncated: total > rows.length }
}

async function decorateUnits(rows: Prisma.HospitalDeviceGetPayload<{ include: typeof UNITS_INCLUDE }>[], client: DbClient): Promise<UnitListRow[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const refRows = await client.$queryRaw<{ device_id: number; ref_type: string | null; ref_code: string | null }[]>`
    SELECT DISTINCT ON (device_id) device_id, ref_type, ref_code
      FROM hospital_device_events
     WHERE device_id = ANY(${ids}::int[]) AND event_type <> 'CORRECT' AND ref_type IS NOT NULL
     ORDER BY device_id, occurred_on DESC, id DESC`
  const refBy = new Map(refRows.map((r) => [r.device_id, r.ref_type && r.ref_code ? { type: r.ref_type, code: r.ref_code } : null]))
  const unlinked = rows.filter((r) => r.inventoryUnitId == null)
  const transient = await matchInventoryUnits(
    client,
    unlinked.map((r) => ({ id: r.id, serialNo: r.serialNo, serialRaw: r.serialRaw, deviceInfoId: r.deviceInfoId, deviceModel: r.deviceInfo.deviceModel })),
    { persist: false }
  )
  return rows.map((r) => {
    const wmsTransient = r.inventoryUnitId == null ? transient.get(r.id) ?? null : null
    const linked: WmsMatch | null = r.inventoryUnit
      ? { unitId: r.inventoryUnit.id, serialNo: r.inventoryUnit.serialNo, inventoryName: r.inventoryUnit.inventory.name, status: r.inventoryUnit.status, itemCode: r.inventoryUnit.item.itemCode, modelName: r.inventoryUnit.item.modelName }
      : null
    return { ...r, lastRef: refBy.get(r.id) ?? null, wmsTransient, wmsWarning: wmsWarning(linked ?? wmsTransient, r.status) }
  })
}

export interface EventsQuery {
  hospital?: string | null
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

export const EVENTS_INCLUDE = {
  device: { select: { id: true, serialNo: true, serialRaw: true, status: true, hospitalCode: true, deviceInfo: { select: { id: true, deviceModel: true, deviceName: true, deviceClass: true } } } },
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  fromWard: { select: { id: true, name: true } },
  toWard: { select: { id: true, name: true } },
  reasonCode: { select: { id: true, name: true, value: true } },
  relatedDevice: { select: { id: true, serialNo: true } },
  importBatch: { select: { id: true, mode: true, fileName: true, cancelledAt: true } },
} satisfies Prisma.HospitalDeviceEventInclude

export type EventListRow = Prisma.HospitalDeviceEventGetPayload<{ include: typeof EVENTS_INCLUDE }>

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
  const [total, data] = await Promise.all([
    client.hospitalDeviceEvent.count({ where }),
    client.hospitalDeviceEvent.findMany({ where, include: EVENTS_INCLUDE, orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
  ])
  return { data, total, page, limit }
}

// ─────────────────────────────────────────────────────────────────────────────
// 개체 상세(드로어) · 시리얼 조회 · 임포트 배치 목록
// ─────────────────────────────────────────────────────────────────────────────

export const UNIT_DETAIL_INCLUDE = {
  ...UNITS_INCLUDE,
  replaces: { select: { id: true, serialNo: true } },
  events: {
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true } },
      fromWard: { select: { id: true, name: true } },
      toWard: { select: { id: true, name: true } },
      reasonCode: { select: { id: true, name: true, value: true } },
      relatedDevice: { select: { id: true, serialNo: true } },
      importBatch: { select: { id: true, mode: true, fileName: true, cancelledAt: true } },
    },
    orderBy: [{ occurredOn: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.HospitalDeviceInclude

export type UnitDetail = Prisma.HospitalDeviceGetPayload<{ include: typeof UNIT_DETAIL_INCLUDE }> & {
  wmsTransient: WmsMatch | null
  wmsWarning: string | null
}

export async function getUnitDetail(deviceId: number, client: DbClient = prisma): Promise<UnitDetail | null> {
  const d = await client.hospitalDevice.findUnique({ where: { id: deviceId }, include: UNIT_DETAIL_INCLUDE })
  if (!d) return null
  let wmsTransient: WmsMatch | null = null
  if (d.inventoryUnitId == null) {
    const m = await matchInventoryUnits(client, [{ id: d.id, serialNo: d.serialNo, serialRaw: d.serialRaw, deviceInfoId: d.deviceInfoId, deviceModel: d.deviceInfo.deviceModel }], { persist: false })
    wmsTransient = m.get(d.id) ?? null
  }
  const linked: WmsMatch | null = d.inventoryUnit
    ? { unitId: d.inventoryUnit.id, serialNo: d.inventoryUnit.serialNo, inventoryName: d.inventoryUnit.inventory.name, status: d.inventoryUnit.status, itemCode: d.inventoryUnit.item.itemCode, modelName: d.inventoryUnit.item.modelName }
    : null
  return { ...d, wmsTransient, wmsWarning: wmsWarning(linked ?? wmsTransient, d.status) }
}

export interface LookupResult {
  input: { serialNo: string; serialRaw: string | null }
  /** 정확 일치 개체(키 또는 원문) */
  device: Prisma.HospitalDeviceGetPayload<{ include: typeof UNITS_INCLUDE }> | null
  /** 0건일 때 — 원장 접두 일치 ≤10 */
  candidates: Prisma.HospitalDeviceGetPayload<{ include: typeof UNITS_INCLUDE }>[]
  /** 0건일 때 — WMS 정확·접미 일치 ≤10 */
  wmsCandidates: { unitId: number; serialNo: string; status: string; inventoryName: string; itemCode: string; modelName: string | null; linkedDeviceId: number | null }[]
}

/** 헤더 '시리얼 조회' (§6.1) — 정규화 키 또는 원문 정확 일치, 없으면 접두·WMS 후보 */
export async function lookupDevice(serialInput: string, client: DbClient = prisma): Promise<LookupResult> {
  const ns = normalizeSerial(serialInput)
  if (!ns.serialNo) throw new RegistryError(400, '시리얼을 입력하세요')
  const compact = (serialInput ?? '').replace(/\s+/g, '').toUpperCase()
  const device = await client.hospitalDevice.findFirst({
    where: { OR: [{ serialNo: ns.serialNo }, { serialRaw: compact }, ...(ns.serialRaw ? [{ serialRaw: ns.serialRaw }] : [])] },
    include: UNITS_INCLUDE,
  })
  if (device) return { input: { serialNo: ns.serialNo, serialRaw: ns.serialRaw }, device, candidates: [], wmsCandidates: [] }
  const prefix = ns.serialNo.slice(0, Math.min(5, ns.serialNo.length))
  const [candidates, wms] = await Promise.all([
    client.hospitalDevice.findMany({ where: { serialNo: { startsWith: prefix } }, include: UNITS_INCLUDE, orderBy: { serialNo: 'asc' }, take: 10 }),
    queryWmsUnits(client, { keys: [ns.serialNo], raws: ns.serialRaw ? [ns.serialRaw, compact] : [compact], limit: 10 }),
  ])
  return {
    input: { serialNo: ns.serialNo, serialRaw: ns.serialRaw },
    device: null,
    candidates,
    wmsCandidates: wms.map((u: WmsUnitRow) => ({ unitId: u.id, serialNo: u.serial_no, status: u.status, inventoryName: u.inventory_name, itemCode: u.item_code, modelName: u.model_name, linkedDeviceId: u.linked_device_id })),
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
