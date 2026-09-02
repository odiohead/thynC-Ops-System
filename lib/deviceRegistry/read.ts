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
  PRODUCT_TYPES,
  PRODUCT_TYPE_UNSET_LABEL,
  isProductType,
  normalizeSerial,
  todayKst,
  type DeviceEventType,
  type ProductType,
  type ProductTypeContext,
  type ProductTypeFilter,
  type UsageFilter,
  type UsageTypeRef,
} from '@/lib/deviceRegistryShared'
import { RegistryError, getHospitalProductTypeContext, loadTrackedModels, ymd, ymdMinusDays, ymdToDate, type DbClient } from './core'
import { matchInventoryUnits, queryWmsUnits, wmsWarning, type WmsMatch, type WmsMatchInput, type WmsUnitRow } from './wms'

const n = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0))

// ─────────────────────────────────────────────────────────────────────────────
// 딜 기대 수량 (§9.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpectedCount {
  deals: number
  /** 계약완료 딜 0건이면 null (compare none) */
  expected: number | null
  contractedDeals: { dealCode: string; count: number; roundNo: number; contractDate: string | null; productType: string | null }[]
}

export async function getExpectedDeviceCount(hospitalCode: string, client: DbClient = prisma): Promise<ExpectedCount> {
  const rows = await client.$queryRaw<{ deal_code: string; round_no: number; contract_date: Date | null; product_type: string | null; cnt: number | null }[]>`
    SELECT sd.deal_code, sd.round_no, sd.contract_date, sd.product_type, sd.daewoong_device_count AS cnt
      FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
     WHERE sd.hospital_code = ${hospitalCode} AND sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}
     ORDER BY sd.round_no`
  const contractedDeals = rows.map((r) => ({ dealCode: r.deal_code, count: n(r.cnt), roundNo: r.round_no, contractDate: ymd(r.contract_date), productType: r.product_type }))
  const deals = rows.length
  return { deals, expected: deals === 0 ? null : contractedDeals.reduce((s, d) => s + d.count, 0), contractedDeals }
}

// ─────────────────────────────────────────────────────────────────────────────
// 교체 집계 (B-22) — RECOVER 이벤트 가운데 같은 병원의 REGISTER와 교체 짝(related_device_id 또는 같은 action_group)이 있는 것
// ─────────────────────────────────────────────────────────────────────────────

/** 상품유형 축 키 — '일반' | '라이트' | '미지정' */
export type ProductTypeKey = ProductType | typeof PRODUCT_TYPE_UNSET_LABEL

export interface ReplacementCount {
  total: number
  /** RECOVER 이벤트의 상품유형 스냅샷(회수된 자리) 기준 */
  byType: Record<ProductTypeKey, number>
}

function emptyByType(): Record<ProductTypeKey, number> {
  return { 일반: 0, 라이트: 0, [PRODUCT_TYPE_UNSET_LABEL]: 0 }
}

/**
 * 교체 건수 = 이 병원 RECOVER 이벤트 e 가운데, 같은 병원 REGISTER r(다른 기기)이 `r.related_device_id = e.device_id`(교체 등록)
 * 또는 같은 action_group에서 `e.related_device_id = r.device_id`(교체 회수)로 짝지어진 것. 이관(TRANSFER) 쌍은 병원이 달라 제외된다.
 * `from`/`to`는 업무일자(occurred_on) 범위(YYYY-MM-DD, 포함).
 */
export async function countReplacements(hospitalCode: string, range?: { from?: string | null; to?: string | null }, client: DbClient = prisma): Promise<ReplacementCount> {
  const fromSql = range?.from ? Prisma.sql`AND e.occurred_on >= ${ymdToDate(range.from)}::date` : Prisma.empty
  const toSql = range?.to ? Prisma.sql`AND e.occurred_on <= ${ymdToDate(range.to)}::date` : Prisma.empty
  const rows = await client.$queryRaw<{ t: string | null; cnt: bigint }[]>(Prisma.sql`
    SELECT e.product_type AS t, count(*) AS cnt
      FROM hospital_device_events e
     WHERE e.event_type = 'RECOVER' AND e.hospital_code = ${hospitalCode} ${fromSql} ${toSql}
       AND EXISTS (SELECT 1 FROM hospital_device_events r
                    WHERE r.event_type = 'REGISTER' AND r.hospital_code = e.hospital_code AND r.device_id <> e.device_id
                      AND (r.related_device_id = e.device_id OR (e.action_group IS NOT NULL AND r.action_group = e.action_group AND e.related_device_id = r.device_id)))
     GROUP BY 1`)
  const byType = emptyByType()
  for (const r of rows) {
    const key: ProductTypeKey = r.t && (PRODUCT_TYPES as readonly string[]).includes(r.t) ? (r.t as ProductType) : PRODUCT_TYPE_UNSET_LABEL
    byType[key] += n(r.cnt)
  }
  return { total: Object.values(byType).reduce((a, b) => a + b, 0), byType }
}

/**
 * 계약건(딜)별 교체 건수(B-23) — `countReplacements`와 같은 짝 판정을 RECOVER 이벤트의 `deal_code` 스냅샷으로 그룹.
 * 키 null = 미지정(딜 없이 회수·교체된 자리).
 */
export async function countReplacementsByDeal(hospitalCode: string, client: DbClient = prisma): Promise<Map<string | null, number>> {
  const rows = await client.$queryRaw<{ d: string | null; cnt: bigint }[]>(Prisma.sql`
    SELECT e.deal_code AS d, count(*) AS cnt
      FROM hospital_device_events e
     WHERE e.event_type = 'RECOVER' AND e.hospital_code = ${hospitalCode}
       AND EXISTS (SELECT 1 FROM hospital_device_events r
                    WHERE r.event_type = 'REGISTER' AND r.hospital_code = e.hospital_code AND r.device_id <> e.device_id
                      AND (r.related_device_id = e.device_id OR (e.action_group IS NOT NULL AND r.action_group = e.action_group AND e.related_device_id = r.device_id)))
     GROUP BY 1`)
  return new Map(rows.map((r) => [r.d, n(r.cnt)]))
}

// ─────────────────────────────────────────────────────────────────────────────
// 계약 수량 — 딜 모델별 수량(sales_deal_devices) 1순위 · 대웅 디바이스수 폴백 (B-25, 2026-09-02)
// sales_* 테이블은 읽기 전용. 대조 축(ECG 1 · SpO2 3 · 링BP 10) 밖 모델 행(GW·기타)은 **무시**한다(§9.1).
// ─────────────────────────────────────────────────────────────────────────────

export type ExpectedSource = 'models' | 'fallback'

export interface DealModelExpected {
  ecg: number | null
  spo2: number | null
  bp: number | null
}

export interface HospitalContractExpected {
  /** 계약완료 딜 코드 → 모델별 도입 수량 + 출처(models=딜 모델 행 / fallback=daewoong_device_count) */
  byDeal: Map<string, { byModel: DealModelExpected; source: ExpectedSource }>
  /** ECG 기대 = Σ(모델 행 딜의 ECG 행) + Σ(행 없는 딜의 디바이스수). 딜 0건이면 null — 항상 hard */
  ecgExpected: number | null
  /** SpO2 — SpO2 행이 하나라도 있으면 hard(Σ SpO2 행 — 폴백 딜은 기여 없음), 아니면 구 규칙 soft(Σ 디바이스수, ECG 동수 가정) */
  spo2: { expected: number | null; hard: boolean }
  /** 링BP — BP 행이 있을 때만 hard(Σ BP 행), 없으면 null(compare none) */
  bpExpected: number | null
  /** product_type별 같은 규칙(spo2는 병원 hard 여부를 따라 행 합/디바이스수 합) */
  byType: Map<ProductType, { ecg: number; spo2: number; bp: number | null }>
}

type DealModelAgg = DealModelExpected & { hasAnyRow: boolean }

/** 계약완료 딜의 sales_deal_devices 행(모델별 수량) 집계 — 읽기 전용 */
async function fetchDealModelAgg(hospitalCode: string, client: DbClient): Promise<Map<string, DealModelAgg>> {
  const rows = await client.$queryRaw<{ deal_code: string; t: number | null; qty: number | null }[]>`
    SELECT sd.deal_code, di.onprem_device_type AS t, sum(sdd.quantity)::int AS qty
      FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
      JOIN sales_deal_devices sdd ON sdd.deal_id = sd.id
      JOIN device_info di ON di.id = sdd.device_info_id
     WHERE sd.hospital_code = ${hospitalCode} AND sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}
     GROUP BY 1, 2`
  const map = new Map<string, DealModelAgg>()
  for (const r of rows) {
    const agg = map.get(r.deal_code) ?? { ecg: null, spo2: null, bp: null, hasAnyRow: false }
    agg.hasAnyRow = true // 축 밖 모델 행만 있어도 '모델 행 있는 딜'로 본다(폴백 미적용 — 소유자가 명시 입력)
    if (r.t === 1) agg.ecg = (agg.ecg ?? 0) + n(r.qty)
    else if (r.t === 3) agg.spo2 = (agg.spo2 ?? 0) + n(r.qty)
    else if (r.t === 10) agg.bp = (agg.bp ?? 0) + n(r.qty)
    map.set(r.deal_code, agg)
  }
  return map
}

/** B-25 순수 계산 — 요약·스모크 공용. contractedDeals = `getExpectedDeviceCount().contractedDeals` */
export function computeContractExpected(
  contractedDeals: ExpectedCount['contractedDeals'],
  modelAgg: Map<string, DealModelAgg>
): HospitalContractExpected {
  const byDeal = new Map<string, { byModel: DealModelExpected; source: ExpectedSource }>()
  let ecgSum = 0
  let spo2Rows = 0
  let bpRows = 0
  let spo2Hard = false
  let bpAny = false
  const typeAcc = new Map<ProductType, { ecg: number; spo2Rows: number; bp: number; bpAny: boolean; daewoong: number }>()
  const accOf = (pt: string | null) => {
    if (!isProductType(pt)) return null
    const cur = typeAcc.get(pt) ?? { ecg: 0, spo2Rows: 0, bp: 0, bpAny: false, daewoong: 0 }
    typeAcc.set(pt, cur)
    return cur
  }
  for (const d of contractedDeals) {
    const agg = modelAgg.get(d.dealCode)
    const acc = accOf(d.productType)
    if (acc) acc.daewoong += d.count
    if (agg?.hasAnyRow) {
      byDeal.set(d.dealCode, { byModel: { ecg: agg.ecg, spo2: agg.spo2, bp: agg.bp }, source: 'models' })
      ecgSum += agg.ecg ?? 0
      if (agg.spo2 != null) {
        spo2Hard = true
        spo2Rows += agg.spo2
      }
      if (agg.bp != null) {
        bpAny = true
        bpRows += agg.bp
      }
      if (acc) {
        acc.ecg += agg.ecg ?? 0
        acc.spo2Rows += agg.spo2 ?? 0
        if (agg.bp != null) {
          acc.bpAny = true
          acc.bp += agg.bp
        }
      }
    } else {
      // 폴백(구 규칙): 디바이스수는 ECG에만 기여(SpO2 soft 의미는 병원 단위에서만 유지)
      byDeal.set(d.dealCode, { byModel: { ecg: d.count, spo2: null, bp: null }, source: 'fallback' })
      ecgSum += d.count
      if (acc) acc.ecg += d.count
    }
  }
  const deals = contractedDeals.length
  const daewoongTotal = contractedDeals.reduce((s, d) => s + d.count, 0)
  const byType = new Map<ProductType, { ecg: number; spo2: number; bp: number | null }>()
  for (const [k, a] of Array.from(typeAcc.entries())) {
    byType.set(k, { ecg: a.ecg, spo2: spo2Hard ? a.spo2Rows : a.daewoong, bp: bpAny ? (a.bpAny ? a.bp : 0) : null })
  }
  return {
    byDeal,
    ecgExpected: deals === 0 ? null : ecgSum,
    spo2: spo2Hard ? { expected: spo2Rows, hard: true } : { expected: deals === 0 ? null : daewoongTotal, hard: false },
    bpExpected: bpAny ? bpRows : null,
    byType,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 병원 요약 (§7.1 summary 응답 요지 · §6.1-B 스트립 · §6.2 상세 카드)
// ─────────────────────────────────────────────────────────────────────────────

/** 모델 × 상품유형 셀(B-22 매트릭스) — expected는 그 상품유형 계약완료 딜의 Σ daewoong_device_count(ECG hard·SpO2 soft·그 외 null) */
export interface ProductTypeCell {
  active: number
  /** 계약 대조용(평가용 제외) */
  activeForCompare: number
  expected: number | null
  /** hard(ECG)만 activeForCompare − expected */
  diff: number | null
}

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
  /** 상품유형별 소계(B-22) — 키는 계약 딜에 있는 유형 ∪ 배치에 있는 유형(+ '미지정'은 배치가 있을 때만). 모델 합계는 위 필드 그대로 */
  byProductType: Partial<Record<ProductTypeKey, ProductTypeCell>>
}

/** 계약건(딜)별 요약 행(B-23·B-25) — 병원 뷰 상단 계약별 표의 데이터 */
export interface SummaryDealRow {
  dealCode: string
  /** 계약완료 딜이 아니면(재적재로 끊긴 코드 등) null */
  roundNo: number | null
  productType: string | null
  contractDate: string | null
  /** 도입 수량(Σ daewoong_device_count — 구 축, 호환 유지) — 계약완료 딜이 아니면 null */
  expected: number | null
  /** 모델별 도입 수량(B-25) — sales_deal_devices 1순위, 행 없으면 폴백 {ecg: 디바이스수}. 계약완료 딜이 아니면 null */
  expectedByModel: DealModelExpected | null
  /** models=딜 모델 행 / fallback=디바이스수 기준(모델별 수량 미입력) */
  expectedSource: ExpectedSource | null
  contracted: boolean
  /** 등록 수량(배치 중 ACTIVE) */
  active: number
  /** 모델별 등록 수량(배치 중 — ECG/SpO2/링BP) */
  activeByModel: { ecg: number; spo2: number; bp: number }
  /** 교체 건수(RECOVER 이벤트 deal_code 스냅샷 기준 짝 수) */
  replacements: number
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
  /** 병원 계약완료 딜 기준 상품유형 문맥(등록 기본값·필수 판정 — B-22) */
  productTypeContext: ProductTypeContext
  /** 계약건(딜)별 현황(B-23) — 계약완료 딜 ∪ 배치·교체에 등장한 딜 코드(재적재로 끊긴 코드도 노출) */
  deals: SummaryDealRow[]
  /** 계약건 미지정 버킷 — active: 딜 없는 ACTIVE 배치 수(+모델별) / replacements: RECOVER 스냅샷 deal_code NULL인 교체 짝 수 */
  dealUnassigned: { active: number; activeByModel: { ecg: number; spo2: number; bp: number }; replacements: number }
  /** AS진행중(as_started_on NOT NULL) ACTIVE 배치 수(B-24) */
  asInProgress: number
  /** 계약 딜이 2종이거나 배치에 상품유형이 하나라도 있으면 true — UI가 매트릭스로 그린다 */
  productTypeMixed: boolean
  /** 병원 단위 상품유형 축(ECG hard 기준) — 계약 딜 유형 ∪ 배치 유형(+미지정은 배치 있을 때) */
  productTypes: { type: ProductTypeKey; active: number; activeForCompare: number; expected: number | null; diff: number | null }[]
  /** 교체 건수(전체·최근 30일) — RECOVER 스냅샷 상품유형 기준 */
  replacements: { total: number; byType: Record<ProductTypeKey, number>; last30d: { total: number; byType: Record<ProductTypeKey, number> } }
}

export async function getHospitalDeviceSummary(hospitalCode: string, client: DbClient = prisma): Promise<HospitalDeviceSummary | null> {
  const hospital = await client.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true, hospitalName: true, introBeds: true } })
  if (!hospital) return null
  const today = todayKst()
  const since = ymdMinusDays(today, 30)
  const [expected, models, activeUnits, recRows, lastRows, wards, unassigned, lastEvent, lastImport, ptCtx, replAll, repl30, dealActRows, replByDeal, dealModelAgg] = await Promise.all([
    getExpectedDeviceCount(hospitalCode, client),
    loadTrackedModels(client),
    client.hospitalDevice.findMany({
      where: { hospitalCode, status: 'ACTIVE' },
      select: { deviceId: true, productType: true, unit: { select: { deviceInfoId: true, serialNo: true, serialRaw: true, usageType: { select: { value: true } } } } },
    }),
    client.$queryRaw<{ device_info_id: number; cnt: bigint }[]>`
      SELECT u.device_info_id, count(*) AS cnt
        FROM hospital_device_events e JOIN device_units u ON u.id = e.device_id
       WHERE e.event_type = 'RECOVER' AND e.hospital_code = ${hospitalCode} AND e.occurred_on >= ${ymdToDate(since)}::date
       GROUP BY 1`,
    client.$queryRaw<{ device_info_id: number; event_type: string; occurred_on: Date }[]>`
      SELECT DISTINCT ON (u.device_info_id) u.device_info_id, e.event_type, e.occurred_on
        FROM hospital_device_events e JOIN device_units u ON u.id = e.device_id
       WHERE e.hospital_code = ${hospitalCode} AND e.event_type NOT IN ('CORRECT','AS_OPEN','AS_CLEAR')
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
    getHospitalProductTypeContext(hospitalCode, client),
    countReplacements(hospitalCode, undefined, client),
    countReplacements(hospitalCode, { from: since }, client),
    client.$queryRaw<{ deal_code: string | null; cnt: bigint; as_cnt: bigint; ecg: bigint; spo2: bigint; bp: bigint }[]>`
      SELECT d.deal_code, count(*) AS cnt, count(*) FILTER (WHERE d.as_started_on IS NOT NULL) AS as_cnt,
             count(*) FILTER (WHERE di.onprem_device_type = 1) AS ecg,
             count(*) FILTER (WHERE di.onprem_device_type = 3) AS spo2,
             count(*) FILTER (WHERE di.onprem_device_type = 10) AS bp
        FROM hospital_devices d JOIN device_units u ON u.id = d.device_id JOIN device_info di ON di.id = u.device_info_id
       WHERE d.hospital_code = ${hospitalCode} AND d.status = 'ACTIVE'
       GROUP BY 1`,
    countReplacementsByDeal(hospitalCode, client),
    fetchDealModelAgg(hospitalCode, client),
  ])
  // 계약 수량(B-25) — 딜 모델별 수량 1순위, 디바이스수 폴백
  const contract = computeContractExpected(expected.contractedDeals, dealModelAgg)

  // 배치 중 유닛의 모델별 수 + WMS 일시 매칭 집계(배치 1쿼리) + 상품유형별 소계(B-22)
  const modelById = new Map(models.map((m) => [m.id, m]))
  const activeBy = new Map<number, number>()
  const evalBy = new Map<number, number>()
  const ptKeyOf = (v: string | null): ProductTypeKey => (v && (PRODUCT_TYPES as readonly string[]).includes(v) ? (v as ProductType) : PRODUCT_TYPE_UNSET_LABEL)
  /** 모델 → 상품유형 → { active, eval } */
  const ptBy = new Map<number, Map<ProductTypeKey, { active: number; evalN: number }>>()
  const expectedByType = new Map<ProductTypeKey, number>(ptCtx.byType.map((b) => [b.type, b.devices]))
  const anyPlacementTyped = activeUnits.some((r) => r.productType != null)
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
    const ptm = ptBy.get(mid) ?? new Map<ProductTypeKey, { active: number; evalN: number }>()
    const cell = ptm.get(ptKeyOf(r.productType)) ?? { active: 0, evalN: 0 }
    cell.active += 1
    if (r.unit.usageType?.value === 'EVAL') cell.evalN += 1
    ptm.set(ptKeyOf(r.productType), cell)
    ptBy.set(mid, ptm)
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
      compare = contract.ecgExpected == null ? 'none' : 'hard'
      exp = contract.ecgExpected
      diff = exp == null ? null : activeForCompare - exp // 평가용(EVAL)은 계약 대조에서 제외(§9.1)
    } else if (m.onpremDeviceType === 3) {
      // B-25: 딜 모델 행(SpO2)이 있으면 실측 hard, 폴백 전용 병원만 구 soft(ECG 동수 가정)
      if (contract.spo2.hard) {
        compare = 'hard'
        exp = contract.spo2.expected
        diff = exp == null ? null : activeForCompare - exp
      } else {
        compare = contract.spo2.expected == null ? 'none' : 'soft'
        exp = contract.spo2.expected
        diff = null
      }
    } else if (m.onpremDeviceType === 10 && contract.bpExpected != null) {
      compare = 'hard'
      exp = contract.bpExpected
      diff = activeForCompare - exp
    }
    // 상품유형 소계 — 키: 계약 딜 유형 ∪ 이 모델 배치 유형(+미지정은 배치가 있을 때만)
    const ptm = ptBy.get(m.id) ?? new Map<ProductTypeKey, { active: number; evalN: number }>()
    const keys: ProductTypeKey[] = [...PRODUCT_TYPES.filter((t) => expectedByType.has(t) || ptm.has(t)), ...(ptm.has(PRODUCT_TYPE_UNSET_LABEL) ? [PRODUCT_TYPE_UNSET_LABEL as ProductTypeKey] : [])]
    const byProductType: Partial<Record<ProductTypeKey, ProductTypeCell>> = {}
    for (const k of keys) {
      const c = ptm.get(k) ?? { active: 0, evalN: 0 }
      const forCompare = c.active - c.evalN
      // B-25: 유형별 기대 수량도 모델별 — ECG/SpO2/BP 각각 그 유형 딜의 모델 행 합(폴백은 ECG에만·SpO2는 soft면 디바이스수)
      const bt = k !== PRODUCT_TYPE_UNSET_LABEL ? contract.byType.get(k as ProductType) : undefined
      const expT =
        k === PRODUCT_TYPE_UNSET_LABEL || compare === 'none'
          ? null
          : m.onpremDeviceType === 1
            ? (bt?.ecg ?? 0)
            : m.onpremDeviceType === 3
              ? (bt?.spo2 ?? 0)
              : m.onpremDeviceType === 10
                ? (bt?.bp ?? 0)
                : null
      byProductType[k] = { active: c.active, activeForCompare: forCompare, expected: expT, diff: compare === 'hard' && expT != null ? forCompare - expT : null }
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
      byProductType,
    })
  }
  // 병원 단위 상품유형 축 — ECG(hard) 기준. 계약 딜 유형 ∪ ECG 배치 유형(+미지정은 배치 있을 때)
  const ecgModel = out.find((m) => m.onpremDeviceType === 1) ?? null
  const ecgPt = ecgModel ? ecgModel.byProductType : {}
  const hospitalKeys: ProductTypeKey[] = [
    ...PRODUCT_TYPES.filter((t) => expectedByType.has(t) || ecgPt[t] != null),
    ...(ecgPt[PRODUCT_TYPE_UNSET_LABEL] ? [PRODUCT_TYPE_UNSET_LABEL as ProductTypeKey] : []),
  ]
  const productTypes = hospitalKeys.map((k) => {
    const c = ecgPt[k] ?? { active: 0, activeForCompare: 0, expected: null, diff: null }
    const expT = k !== PRODUCT_TYPE_UNSET_LABEL && contract.ecgExpected != null ? (contract.byType.get(k as ProductType)?.ecg ?? 0) : null
    return { type: k, active: c.active, activeForCompare: c.activeForCompare, expected: expT, diff: expT == null ? null : c.activeForCompare - expT }
  })
  // 계약건(딜)별 현황(B-23) — 계약완료 딜 ∪ 배치·교체에 등장한 코드. 미지정(NULL)은 별도 버킷
  const activeByDeal = new Map<string | null, { active: number; asCnt: number; ecg: number; spo2: number; bp: number }>(
    dealActRows.map((r) => [r.deal_code, { active: n(r.cnt), asCnt: n(r.as_cnt), ecg: n(r.ecg), spo2: n(r.spo2), bp: n(r.bp) }])
  )
  const activeModelOf = (code: string | null) => {
    const a = activeByDeal.get(code)
    return { ecg: a?.ecg ?? 0, spo2: a?.spo2 ?? 0, bp: a?.bp ?? 0 }
  }
  const dealKeys: string[] = expected.contractedDeals.map((d) => d.dealCode)
  for (const k of Array.from(activeByDeal.keys())) if (k != null && !dealKeys.includes(k)) dealKeys.push(k)
  for (const k of Array.from(replByDeal.keys())) if (k != null && !dealKeys.includes(k)) dealKeys.push(k)
  const dealRows: SummaryDealRow[] = dealKeys.map((code) => {
    const c = expected.contractedDeals.find((d) => d.dealCode === code) ?? null
    const be = contract.byDeal.get(code) ?? null
    return {
      dealCode: code,
      roundNo: c?.roundNo ?? null,
      productType: c?.productType ?? null,
      contractDate: c?.contractDate ?? null,
      expected: c ? c.count : null,
      expectedByModel: be?.byModel ?? null,
      expectedSource: be?.source ?? null,
      contracted: !!c,
      active: activeByDeal.get(code)?.active ?? 0,
      activeByModel: activeModelOf(code),
      replacements: replByDeal.get(code) ?? 0,
    }
  })
  const dealUnassigned = { active: activeByDeal.get(null)?.active ?? 0, activeByModel: activeModelOf(null), replacements: replByDeal.get(null) ?? 0 }
  const asInProgress = Array.from(activeByDeal.values()).reduce((s, v) => s + v.asCnt, 0)
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
    productTypeContext: ptCtx,
    deals: dealRows,
    dealUnassigned,
    asInProgress,
    productTypeMixed: ptCtx.mixed || anyPlacementTyped,
    productTypes,
    replacements: { total: replAll.total, byType: replAll.byType, last30d: { total: repl30.total, byType: repl30.byType } },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 전역 커버리지 (§6.1-A 백필 진행판) — 계약완료 딜 보유 ∪ 원장 보유 병원 (2026-09-02 모집단 축소 — 상태 기반 모집 제거)
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
  /** 계약완료 딜의 상품유형이 2종(일반+라이트) — B-22 '상품유형 혼합' 배지 */
  productTypeMixed: boolean
  /** 혼합 병원에서 상품유형 미지정 ACTIVE 배치 수(혼합이 아니면 0) */
  unassignedProductType: number
  /** 상품유형별 ACTIVE 배치 수(용도 무관 — 평가용 포함, 2026-09-02 v1 축약 표) — ecg/spo2/bp = onprem_device_type 1/3/10(bp = 링 혈압계 CART BP SL-MPF1K07). id 하드코딩 없음 */
  byProductType: Record<CoverageProductTypeKey, CoverageModelCounts>
  /** 상품유형별 계약완료 딜 대웅 디바이스 수 합(축약 표 심전계 셀 툴팁용) — 그 유형 딜이 없으면 null */
  expectedByType: Record<'일반' | '라이트', number | null>
}

export type CoverageProductTypeKey = '일반' | '라이트' | '미지정'
export interface CoverageModelCounts {
  ecg: number
  spo2: number
  bp: number
}

export interface CoverageTotals {
  /** 계약완료 딜 보유 병원 수(2026-09-02 — 구 상태(운영·계약완료·보류) 기반 고객 병원 수를 대체) */
  customerHospitals: number
  registeredHospitals: number
  active: { ecg: number; spo2: number; gw: number; third: number; total: number; eval: number }
  events30d: number
  recovered30d: number
  /** 계약완료 딜 상품유형이 혼합인 병원 수 */
  mixedProductTypeHospitals: number
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

  const base = Prisma.sql`
    WITH pop AS (
      -- 모집단(2026-09-02): 계약완료 딜 보유 ∪ 원장 보유(배치 현재/마지막 병원·이벤트·병동·임포트 배치) — 상태(운영·계약완료·보류) 기반 모집 제거.
      -- 소형 코드 유니온을 만들어 hospitals(80k+)를 PK 조인으로 좁힌다(구 형태는 전행 스캔 + 행별 EXISTS ≈ 120ms).
      SELECT h.hospital_code, h.hospital_name, h.status
        FROM hospitals h
        JOIN (SELECT sd.hospital_code FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
               WHERE sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}
              UNION SELECT d.hospital_code FROM hospital_devices d WHERE d.hospital_code IS NOT NULL
              UNION SELECT d.last_hospital_code FROM hospital_devices d WHERE d.last_hospital_code IS NOT NULL
              UNION SELECT e.hospital_code FROM hospital_device_events e WHERE e.hospital_code IS NOT NULL
              UNION SELECT w.hospital_code FROM hospital_wards w
              UNION SELECT b.hospital_code FROM hospital_device_import_batches b) c ON c.hospital_code = h.hospital_code
    ), dl AS (
      -- B-25: ECG 계약 수량 = 딜 모델별 수량(sales_deal_devices ECG 행) 1순위, 행 없는 딜은 daewoong_device_count 폴백
      SELECT sd.hospital_code, count(*)::int AS deals,
             sum(CASE WHEN m.deal_id IS NULL THEN coalesce(sd.daewoong_device_count, 0) ELSE coalesce(m.ecg, 0) END)::int AS expected,
             sum(CASE WHEN m.deal_id IS NULL THEN coalesce(sd.daewoong_device_count, 0) ELSE coalesce(m.ecg, 0) END) FILTER (WHERE sd.product_type = '일반')::int AS expected_normal,
             sum(CASE WHEN m.deal_id IS NULL THEN coalesce(sd.daewoong_device_count, 0) ELSE coalesce(m.ecg, 0) END) FILTER (WHERE sd.product_type = '라이트')::int AS expected_lite,
             count(DISTINCT sd.product_type) FILTER (WHERE sd.product_type IN ('일반','라이트'))::int AS pt_kinds
        FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
        LEFT JOIN (SELECT sdd.deal_id, sum(sdd.quantity) FILTER (WHERE di.onprem_device_type = 1)::int AS ecg
                     FROM sales_deal_devices sdd JOIN device_info di ON di.id = sdd.device_info_id
                    GROUP BY 1) m ON m.deal_id = sd.id
       WHERE sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}
       GROUP BY 1
    ), act AS (
      SELECT d.hospital_code,
             count(*) FILTER (WHERE d.product_type IS NULL)::int AS pt_unassigned,
             count(*) FILTER (WHERE di.onprem_device_type = 1 AND coalesce(ut.value, '') <> 'EVAL')::int AS ecg,
             count(*) FILTER (WHERE di.onprem_device_type = 1 AND ut.value = 'EVAL')::int AS ecg_eval,
             count(*) FILTER (WHERE di.onprem_device_type = 3)::int AS spo2,
             count(*) FILTER (WHERE di.device_class = 'GATEWAY')::int AS gw,
             count(*) FILTER (WHERE di.device_class = 'THIRD_PARTY')::int AS third,
             count(*)::int AS total,
             count(*) FILTER (WHERE ut.value = 'EVAL')::int AS eval_total,
             count(*) FILTER (WHERE di.onprem_device_type = 1 AND d.product_type = '일반')::int AS pt_n_ecg,
             count(*) FILTER (WHERE di.onprem_device_type = 3 AND d.product_type = '일반')::int AS pt_n_spo2,
             count(*) FILTER (WHERE di.onprem_device_type = 10 AND d.product_type = '일반')::int AS pt_n_bp,
             count(*) FILTER (WHERE di.onprem_device_type = 1 AND d.product_type = '라이트')::int AS pt_l_ecg,
             count(*) FILTER (WHERE di.onprem_device_type = 3 AND d.product_type = '라이트')::int AS pt_l_spo2,
             count(*) FILTER (WHERE di.onprem_device_type = 10 AND d.product_type = '라이트')::int AS pt_l_bp,
             count(*) FILTER (WHERE di.onprem_device_type = 1 AND d.product_type IS NULL)::int AS pt_u_ecg,
             count(*) FILTER (WHERE di.onprem_device_type = 3 AND d.product_type IS NULL)::int AS pt_u_spo2,
             count(*) FILTER (WHERE di.onprem_device_type = 10 AND d.product_type IS NULL)::int AS pt_u_bp
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
       WHERE hospital_code IS NOT NULL AND event_type NOT IN ('CORRECT','AS_OPEN','AS_CLEAR')
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
             coalesce(act.pt_n_ecg, 0) AS pt_n_ecg, coalesce(act.pt_n_spo2, 0) AS pt_n_spo2, coalesce(act.pt_n_bp, 0) AS pt_n_bp,
             coalesce(act.pt_l_ecg, 0) AS pt_l_ecg, coalesce(act.pt_l_spo2, 0) AS pt_l_spo2, coalesce(act.pt_l_bp, 0) AS pt_l_bp,
             coalesce(act.pt_u_ecg, 0) AS pt_u_ecg, coalesce(act.pt_u_spo2, 0) AS pt_u_spo2, coalesce(act.pt_u_bp, 0) AS pt_u_bp,
             dl.expected_normal, dl.expected_lite,
             CASE WHEN coalesce(dl.deals, 0) > 0 THEN coalesce(act.ecg, 0) - dl.expected END AS diff,   -- ecg는 평가용 제외(§9.1)
             coalesce(rec.recovered30d, 0) AS recovered30d,
             coalesce(dl.pt_kinds, 0) >= 2 AS product_type_mixed,
             CASE WHEN coalesce(dl.pt_kinds, 0) >= 2 THEN coalesce(act.pt_unassigned, 0) ELSE 0 END AS unassigned_product_type,
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
    pt_n_ecg: number
    pt_n_spo2: number
    pt_n_bp: number
    pt_l_ecg: number
    pt_l_spo2: number
    pt_l_bp: number
    pt_u_ecg: number
    pt_u_spo2: number
    pt_u_bp: number
    expected_normal: number | null
    expected_lite: number | null
    diff: number | null
    recovered30d: number
    product_type_mixed: boolean
    unassigned_product_type: number
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
    client.$queryRaw<{ customers: bigint; registered: bigint; ecg: bigint; spo2: bigint; gw: bigint; third: bigint; total: bigint; eval_total: bigint; events30d: bigint; recovered30d: bigint; mixed_pt: bigint }[]>`
      SELECT (SELECT count(DISTINCT sd.hospital_code) FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
                     WHERE sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}) AS customers,
             (SELECT count(*) FROM (SELECT sd.hospital_code FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
                                     WHERE sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED} AND sd.product_type IN ('일반','라이트')
                                     GROUP BY 1 HAVING count(DISTINCT sd.product_type) >= 2) m) AS mixed_pt,
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
      byProductType: {
        일반: { ecg: n(r.pt_n_ecg), spo2: n(r.pt_n_spo2), bp: n(r.pt_n_bp) },
        라이트: { ecg: n(r.pt_l_ecg), spo2: n(r.pt_l_spo2), bp: n(r.pt_l_bp) },
        미지정: { ecg: n(r.pt_u_ecg), spo2: n(r.pt_u_spo2), bp: n(r.pt_u_bp) },
      },
      expectedByType: {
        일반: r.expected_normal == null ? null : n(r.expected_normal),
        라이트: r.expected_lite == null ? null : n(r.expected_lite),
      },
      diff: r.diff == null ? null : n(r.diff),
      recovered30d: n(r.recovered30d),
      lastEvent: r.last_event_type ? { type: r.last_event_type, on: ymd(r.last_event_on)! } : null,
      lastImport: r.imp_id != null ? { id: r.imp_id, at: r.imp_at!.toISOString(), occurredOn: ymd(r.imp_on), rowCount: n(r.imp_rows), registeredCount: n(r.imp_reg) } : null,
      productTypeMixed: !!r.product_type_mixed,
      unassignedProductType: n(r.unassigned_product_type),
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
      mixedProductTypeHospitals: n(t?.mixed_pt),
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
  /** 시리얼 키·원문·닉네임(ext_device_code)·메모 부분 일치. `hospital` 미지정(전역 디바이스 목록)이면 현재/마지막 병원명(ILIKE)도 매치 */
  q?: string | null
  /** WMS 일시 매칭 기준(§7.1) — 후보 집합을 먼저 매칭한 뒤 id로 좁힌다 */
  wms?: UnitsWmsFilter | null
  /** 용도 — SALE/EVAL(usageType.value) 또는 none(미지정) */
  usage?: UsageFilter | null
  /** 상품유형 — 일반/라이트(배치 product_type) 또는 none(미지정) */
  productType?: ProductTypeFilter | null
  /** 계약건(B-23) — 딜 코드 또는 'none'(미지정) */
  deal?: string | null
  /** AS진행중만(as_started_on NOT NULL — B-24) */
  as?: boolean | null
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
  if (params.productType === 'none') and.push({ productType: null })
  else if (params.productType) and.push({ productType: params.productType })
  if (params.deal === 'none') and.push({ dealCode: null })
  else if (params.deal && params.deal.trim()) and.push({ dealCode: params.deal.trim() })
  if (params.as) and.push({ asStartedOn: { not: null } })
  if (params.ward === 'unassigned') and.push({ wardId: null })
  else if (params.ward != null) and.push({ wardId: Number(params.ward) })
  if (params.q && params.q.trim()) {
    const raw = params.q.trim()
    const key = normalizeSerial(raw).serialNo
    const up = raw.replace(/\s+/g, '').toUpperCase()
    const or: Prisma.HospitalDeviceWhereInput[] = [
      { unit: { serialNo: { contains: key || up } } },
      { unit: { serialRaw: { contains: up } } },
      { extDeviceCode: { contains: raw, mode: 'insensitive' } },
      { unit: { memo: { contains: raw, mode: 'insensitive' } } },
    ]
    // 전역(병원 미지정) 목록의 '시리얼/병원명' 검색 — 현재 병원(ACTIVE) 또는 마지막 병원(RECOVERED) 이름
    if (!params.hospital) {
      or.push({ hospital: { is: { hospitalName: { contains: raw, mode: 'insensitive' } } } }, { lastHospital: { is: { hospitalName: { contains: raw, mode: 'insensitive' } } } })
    }
    and.push({ OR: or })
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
  /** 현재 병원명(ACTIVE) — `hospital.hospitalName` 평탄화(전역 목록 표시용, 추가 필드) */
  hospitalName: string | null
  wardId: number | null
  placedOn: Date | null
  lastHospitalCode: string | null
  /** 마지막 병원명(RECOVERED '회수 전 X') — `lastHospital.hospitalName` 평탄화 */
  lastHospitalName: string | null
  recoveredOn: Date | null
  recoverReasonId: number | null
  lastEventType: string | null
  lastEventOn: Date | null
  replacedById: number | null
  /** 상품유형(일반/라이트) — 배치 속성(B-22), null=미지정 */
  productType: string | null
  /** 계약건(딜 코드) 소프트 참조(B-23), null=미지정. RECOVERED 행은 회수 전 마지막 값 */
  dealCode: string | null
  /** AS진행중 플래그 시작일(B-24) — ACTIVE에서만 값이 있다 */
  asStartedOn: Date | null
  /** AS 연결 유지보수 코드 */
  asRefCode: string | null
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
    hospitalName: placement.hospital?.hospitalName ?? null,
    wardId: placement.wardId,
    placedOn: placement.placedOn,
    lastHospitalCode: placement.lastHospitalCode,
    lastHospitalName: placement.lastHospital?.hospitalName ?? null,
    recoveredOn: placement.recoveredOn,
    recoverReasonId: placement.recoverReasonId,
    lastEventType: placement.lastEventType,
    lastEventOn: placement.lastEventOn,
    replacedById: placement.replacedById,
    productType: placement.productType,
    dealCode: placement.dealCode,
    asStartedOn: placement.asStartedOn,
    asRefCode: placement.asRefCode,
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
      placement: { select: { status: true, hospitalCode: true, productType: true } },
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
    /** 현재 배치의 상품유형(이벤트 행 `productType` 스냅샷과 비교용) */
    productType: string | null
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
      productType: device.placement?.productType ?? null,
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
