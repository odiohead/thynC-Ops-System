/**
 * 사용량 지표 — 원본 DB에서 읽어 화면을 열 때 바로 계산한다 (projects/usage_collection_design.md §14)
 *
 * 병원 단위, 일별:
 *  - 측정 환자 수      그날 걸쳐 있던 측정 건수 (환자 식별값을 받지 않으므로 측정 건수로 센다)
 *  - 신규 측정 수      그날 시작한 측정 건수 (날짜를 넘겨 이어지는 측정은 시작한 날에만)
 *  - 최대 동시측정 수   그날 어느 한 시점에 동시에 진행 중이던 측정의 최대 수
 *  - 기기 종류별        사용 횟수(그날 걸쳐 있던 "측정 × 기기"의 수), 최대 동시사용 수, 계약·공급 수량(가동률의 분모)
 *
 * 정의
 *  - 측정: 실제로 시작된 측정(상태 2 측정 중 · 3 종료 · 8 완료 · 10 삭제/보관 기한 경과). 대기(1)는 제외. 최소 측정 시간 없음.
 *    종료·완료(3·8)인데 붙은 기기 기록이 전혀 없는 측정(자식 측정 포함)은 제외 — 기기를 연결하지 않고 열었다 닫은 측정
 *    (2026-11-18 사용자 결정). 진행 중(2)과 상태 10(보관 기한이 지나 기기 기록이 지워짐)은 기기 기록이 없어도 센다.
 *    그 서버의 기기 상태 이력을 측정 끝까지 아직 다 받지 못했으면(Agent 가 따라잡는 중) 제외하지 않는다.
 *    환자 수·동시측정은 부모 측정만 센다(심전도 리드 추가로 생긴 자식 행 제외).
 *    진행 중인 측정은 현재 시각까지, 병원에서 삭제된 진행 중 측정은 삭제를 확인한 시각까지.
 *    상태 10 은 두 가지다 (2026-11-18 PROD 화순성심병원 실데이터로 확인):
 *      · 보관 기한 경과 — 종료 뒤 약 90일에 10 으로 바뀐다(수정 시각 ≥ 예정 종료). 종료 시각 그대로 센다
 *      · 중간 삭제 — 수정 시각 < 예정 종료. 시작 시각 = 생성 시각이면 게이트웨이가 한 번도 시작하지 않은
 *        측정(대기 중 삭제)이라 제외하고, 시작된 적 있으면 삭제(수정) 시각까지 센다
 *        (정상 측정은 게이트웨이가 시작 시각을 실제 값으로 덮어써 생성 시각과 다르다 — PROD 882건 중 880건)
 *  - 기기 사용 구간: (측정, 기기 종류, 시리얼) 하나가 한 단위다. 병원 DB의 측정 기기 목록은 교체하면
 *    이전 기기가 사라지므로, 기기 상태 이력에 나타난 시리얼을 함께 본다.
 *      시작 = 그 기기의 첫 상태 이력 시각 (없으면 측정 시작)
 *      끝   = 지금도 측정에 붙어 있으면 측정의 끝, 빠졌으면 마지막 상태 이력 시각
 *  - 하루의 경계는 병원 현지 자정. 국내 병원 기준 Asia/Seoul 로 본다.
 *  - 보관 기한이 지나 기기 정보가 지워진 측정(상태 10, 기기 단위 없음)이 걸친 날은 기기별 수치를 내지 않는다(null).
 *  - 가동률의 분모 = 운영관리시스템의 계약·공급 수량 (2026-11-18 사용자 결정 — 병원 서버의 기기 등록 수가 아니다).
 *    병원 상세 '도입 현황' 카드의 '계약/공급' 값과 같은 규칙: 계약완료 딜의 기기 수량(sales_deal_devices) + 비계약 공급 수량
 *    (hospital_device_supplies, 대웅 직판). 날짜별로 그날까지 도입된 딜만 센다 — 딜의 도입일 ≤ 그날.
 *    도입일 = 연결 프로젝트의 구축 종료일(예상) → 없으면 프로젝트 시작일 → 없으면 딜 계약일, 셋 다 없으면 전 기간
 *    (2026-11-18 사용자 결정 — 계약일 기준이면 계약~설치 사이 가동률이 낮게 나온다. 예: 문산중앙 3차 계약 9/29·구축 12/22).
 *    공급 수량은 이력이 없어 현재 값을 전 기간에 쓴다. 계약 수량에는 용도 구분이 없어 평가용 제외는 해당 없음.
 *  - 판매모델 (2026-11-18 사용자 결정): 딜의 '판매모델 구분'(daewoong_model_kind)이 '사용량'으로 시작하면 사용량비례형, 그 밖(일반·미입력)은 일반형.
 *      분모: 계약 수량을 딜의 판매모델로 나눈다. 비계약 공급 수량(대웅 직판)은 일반형, 단 카트온은 사용량비례형(2026-11-18 사용자 지시).
 *      사용량: 기기 종류의 도입 수량(계약 딜 + 공급)이 한 판매모델뿐이면 그 종류의 기기는 모두 그 모델 (2026-11-18 사용자 지시 —
 *              공식 도입 수량이 기준. 예: 화순성심 심전계 150·산소포화도 150 = 사용량 딜 → 시리얼 등록 여부와 무관하게 사용량비례형).
 *              두 모델이 섞인 종류만 기기 시리얼 → 기기 현황(hospital_devices)의 계약건(deal_code) → 그 딜의 판매모델로 가르고,
 *              기기 현황에 없거나 계약건이 연결되지 않은 기기는 일반형, 카트온은 사용량비례형 (사용자 지시 — 연결은 담당자가 맞춘다).
 *      측정(환자 수·동시측정)은 심전계·산소포화도의 판매모델로 나눈다. 둘 다 없는 측정만 카트온의 모델,
 *      기기 정보가 없는 측정은 병원의 판매모델(모든 도입 수량이 한 모델뿐이면 그 모델, 아니면 일반형).
 *      (카트온·체온계 등이 함께 붙었다고 다른 모델에 중복으로 세지 않는다. 심전계·산소포화도 모델이 섞인 측정은 양쪽에 센다)
 */
import { prisma } from '@/lib/prisma'
import { DEAL_STATUS_CATEGORY, DEAL_STATUS_CONTRACTED, normalizeSerial } from '@/lib/deviceRegistryShared'
import { usagePool } from './db'
import { DAY_SEC, average, changeRate, dayLabel, dayStats, localDayStart, maxOf, startedIn, weekStartOf, type Interval } from './daily'

export const USAGE_TZ = 'Asia/Seoul'
const TZ_OFFSET_HOURS = 9

/** 화면에 따로 보여 주는 기기 종류 (제품 DB device_type) */
export const USAGE_DEVICE_KINDS = [
  { type: 1, key: 'ecg', label: '심전계' },
  { type: 3, key: 'spo2', label: '산소포화도' },
  { type: 10, key: 'cart', label: '카트온' },
] as const

export const USAGE_PERIODS = [30, 90] as const

/** 판매모델 보기 — all 합산 / general 일반형 / usage 사용량비례형 */
export const USAGE_MODELS = [
  { key: 'all', label: '합산' },
  { key: 'general', label: '일반형' },
  { key: 'usage', label: '사용량비례형' },
] as const
export type UsageModel = (typeof USAGE_MODELS)[number]['key']
type SaleModel = Exclude<UsageModel, 'all'>

/** 딜의 '판매모델 구분' 값을 판매모델로 — SQL 과 같은 규칙 */
const MODEL_SQL = `CASE WHEN sd.daewoong_model_kind LIKE '사용량%' THEN 'usage' ELSE 'general' END`

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

type CapacityPlan = { deals: { date: string | null; qty: number; model: SaleModel }[]; supply: number | null; supplyModel?: SaleModel }

/**
 * 딜로 판매모델을 알 수 없는 수량·기기의 기본 판매모델 — 카트온은 사용량비례형 (2026-11-18 사용자 지시), 그 밖은 일반형.
 * 비계약 공급 수량(대웅 직판)과, 두 모델이 섞인 종류에서 기기 현황 계약건이 연결되지 않은 기기에 쓴다.
 */
const USAGE_BY_DEFAULT_TYPES = new Set([10])
export function defaultModelOf(type: number): SaleModel {
  return USAGE_BY_DEFAULT_TYPES.has(type) ? 'usage' : 'general'
}

/** 판매모델에 맞는 계획만 남긴다 (공급 수량은 supplyModel — 없으면 일반형) */
export function planForModel(plan: CapacityPlan | undefined, model: UsageModel): CapacityPlan | undefined {
  if (!plan || model === 'all') return plan
  return { ...plan, deals: plan.deals.filter((d) => d.model === model), supply: (plan.supplyModel ?? 'general') === model ? plan.supply : null }
}

/** 기기 종류별 계약·공급 수량 — 운영관리시스템 DB (병원 상세 '도입 현황'과 같은 원천), 딜별 판매모델 포함 */
async function loadCapacityPlans(hospitalCode: string, types: number[]): Promise<Map<number, CapacityPlan>> {
  const [deals, supply] = await Promise.all([
    // 수량을 세기 시작하는 날 = 연결 프로젝트의 구축 종료일(예상) → 없으면 프로젝트 시작일 → 없으면 딜 계약일 (2026-11-18 사용자 결정)
    prisma.$queryRawUnsafe<{ t: number; from_date: string | null; qty: number; m: SaleModel }[]>(
      `SELECT di.onprem_device_type AS t,
              to_char(COALESCE(p.end_date_expected, p.start_date, sd.contract_date), 'YYYY-MM-DD') AS from_date,
              sum(sdd.quantity)::int AS qty,
              ${MODEL_SQL} AS m
         FROM sales_deals sd
         JOIN status_codes sc ON sc.id = sd.status_id
         LEFT JOIN projects p ON p.project_code = sd.project_code
         JOIN sales_deal_devices sdd ON sdd.deal_id = sd.id
         JOIN device_info di ON di.id = sdd.device_info_id
        WHERE sd.hospital_code = $1 AND sc.category = $2 AND sc.name = $3
          AND di.onprem_device_type = ANY($4::int[])
        GROUP BY 1, 2, 4`,
      hospitalCode,
      DEAL_STATUS_CATEGORY,
      DEAL_STATUS_CONTRACTED,
      types,
    ),
    prisma.$queryRaw<{ t: number; qty: number }[]>`
      SELECT di.onprem_device_type AS t, sum(s.quantity)::int AS qty
        FROM hospital_device_supplies s
        JOIN device_info di ON di.id = s.device_info_id
       WHERE s.hospital_code = ${hospitalCode} AND di.onprem_device_type = ANY(${types})
       GROUP BY 1`,
  ])
  const plans = new Map<number, CapacityPlan>()
  const plan = (t: number) => {
    const p = plans.get(t) ?? { deals: [], supply: null, supplyModel: defaultModelOf(t) }
    plans.set(t, p)
    return p
  }
  for (const r of deals) plan(Number(r.t)).deals.push({ date: r.from_date, qty: Number(r.qty), model: r.m === 'usage' ? 'usage' : 'general' })
  for (const r of supply) plan(Number(r.t)).supply = Number(r.qty)
  return plans
}

/**
 * 기기 종류 → 판매모델. 운영관리시스템의 도입 수량(계약 딜 + 공급)이 한 판매모델뿐이면 그 종류의 기기는 모두 그 모델이다
 * (시리얼이 기기 현황에 없어도). 두 모델이 섞였거나 수량이 없으면 null — 시리얼별로 기기 현황의 계약건을 본다.
 */
export function typeModelOf(plan: CapacityPlan | undefined): SaleModel | null {
  if (!plan) return null
  const set = new Set<SaleModel>(plan.deals.map((d) => d.model))
  if (plan.supply !== null) set.add(plan.supplyModel ?? 'general')
  return set.size === 1 ? Array.from(set)[0] : null
}

/** 측정이 붙은 기기 종류 → 측정의 판매모델 판정에 쓰는 순위. 심전계·산소포화도가 우선, 없으면 카트온, 그 밖의 기기(체온·혈압)는 안 본다 */
const MAIN_TYPES = new Set([1, 3])
const KIND_TYPES = new Set<number>(USAGE_DEVICE_KINDS.map((k) => k.type))

/**
 * 측정의 판매모델 — 심전계·산소포화도가 붙었으면 그 기기들의 모델, 없으면 카트온의 모델,
 * 둘 다 없으면(기기 정보 없는 측정) 병원의 판매모델(fallback — 도입 수량이 한 모델뿐이면 그 모델, 아니면 일반형).
 * (심전계·산소포화도의 모델이 섞인 측정은 양쪽에 센다)
 */
export function measurementModels(main: Set<SaleModel> | undefined, other: Set<SaleModel> | undefined, fallback: SaleModel = 'general'): Set<SaleModel> {
  if (main && main.size > 0) return main
  if (other && other.size > 0) return other
  return new Set<SaleModel>([fallback])
}

/** 병원의 판매모델 — 모든 기기 종류의 도입 수량(계약 딜 + 공급)이 한 판매모델뿐이면 그 모델, 섞였거나 없으면 일반형 */
export function hospitalModelOf(plans: CapacityPlan[]): SaleModel {
  const set = new Set<SaleModel>()
  for (const p of plans) {
    for (const d of p.deals) set.add(d.model)
    if (p.supply !== null) set.add(p.supplyModel ?? 'general')
  }
  return set.size === 1 ? Array.from(set)[0] : 'general'
}

/**
 * 측정 환자 수에 넣는 측정인가 — 종료·완료인데 기기 기록이 전혀 없으면 제외 (진행 중·상태 10 은 기기 기록이 없어도 센다).
 * 단 그 서버의 기기 상태 이력이 측정 끝까지 아직 다 들어오지 않았으면(historyComplete=false) 기기 기록이 없다고 단정하지 않고 센다
 * — Agent 가 상태 이력을 따라잡는 중(status_behind)이면 나중에 기기 기록이 생긴다 (2026-11-18 화순성심 서버 12 사례).
 */
export function countsAsMeasurement(status: number, hasDeviceRecord: boolean, historyComplete: boolean = true): boolean {
  return hasDeviceRecord || !(status === 3 || status === 8) || !historyComplete
}

/**
 * 서버별로 기기 상태 이력을 언제까지 받았는가(epoch 초, 병원 현지 시각). 마지막 성공 실행이 이력을 다 따라잡았으면 그 실행의
 * 병원 DB 시각, 따라잡는 중이면 받은 이력의 마지막 시각. 실행 기록이 없으면 목록에 없음(= 모름).
 */
async function loadStatusCoverage(hospitalCode: string): Promise<Map<string, number>> {
  const pool = usagePool()
  const runs = await pool.query(
    `SELECT s.id::text AS server, EXTRACT(EPOCH FROM r.source_now)::float8 AS source_now, COALESCE((r.stats->>'status_behind')::boolean, false) AS behind
       FROM agent_servers s
       JOIN LATERAL (SELECT source_now, stats FROM agent_runs WHERE server = s.id AND status = 'ok' ORDER BY id DESC LIMIT 1) r ON true
      WHERE s.hospital_code = $1`,
    [hospitalCode],
  )
  const cov = new Map<string, number>()
  for (const r of runs.rows) {
    if (!r.behind) {
      if (r.source_now !== null) cov.set(String(r.server), Number(r.source_now))
      continue
    }
    const m = await pool.query(
      `SELECT EXTRACT(EPOCH FROM max(event_at))::float8 AS t FROM raw_device_status WHERE hospital_code = $1 AND server = $2`,
      [hospitalCode, r.server],
    )
    if (m.rows[0]?.t != null) cov.set(String(r.server), Number(m.rows[0].t))
  }
  return cov
}

/** 기기 시리얼(정규화) → 판매모델. 운영관리시스템 기기 현황에서 이 병원에 있거나 있었던 기기의 계약건 기준. 없으면 목록에 없음(= 일반형) */
async function loadModelBySerial(hospitalCode: string): Promise<Map<string, SaleModel>> {
  const rows = await prisma.$queryRawUnsafe<{ serial_no: string; m: SaleModel }[]>(
    `SELECT u.serial_no, ${MODEL_SQL} AS m
       FROM hospital_devices d
       JOIN device_units u ON u.id = d.device_id
       LEFT JOIN sales_deals sd ON sd.deal_code = d.deal_code
      WHERE d.hospital_code = $1 OR d.last_hospital_code = $1`,
    hospitalCode,
  )
  return new Map(rows.map((r) => [r.serial_no, r.m === 'usage' ? 'usage' : 'general']))
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
  model: UsageModel
  /** 판매모델별로 이 병원에 계약 수량이나 기간 내 사용이 있는지 — 화면이 고를 수 있는 판매모델 */
  models: { key: UsageModel; label: string; available: boolean }[]
  receive: { servers: number; lastSuccessAt: string | null }
  summary: { avgMeasured: number | null; avgStarted: number | null; maxPeak: number | null; maxPeakDate: string | null; todayMeasured: number }
  /** measured = 그날 진행 중이던 측정 수, started = 그날 시작한 측정 수(신규) */
  days: { date: string; measured: number; started: number; peak: number; today: boolean }[]
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
    SELECT r.server, r.measurement_code, COALESCE(r.parent_type, 0) AS parent_type, r.parent_measurement_code, r.measurement_status,
           r.start_at AS s_ts,
           CASE WHEN r.measurement_status = 2
                THEN LEAST(r.end_at, COALESCE(r.source_gone_at AT TIME ZONE '${USAGE_TZ}', now() AT TIME ZONE '${USAGE_TZ}'))
                WHEN r.measurement_status = 10 AND r.source_modified_at < r.end_at
                THEN r.source_modified_at
                ELSE r.end_at END AS e_ts
    FROM raw_measurements r
    WHERE r.hospital_code = $1 AND r.measurement_status IN (2, 3, 8, 10)
      AND r.start_at IS NOT NULL AND r.end_at IS NOT NULL
      AND NOT (r.measurement_status = 10 AND r.source_modified_at < r.end_at AND r.start_at = r.source_created_at)
      AND r.start_at < $3::timestamp
      AND (r.measurement_status = 2 OR r.end_at >= $2::timestamp)
  )`

export async function getUsageDaily(hospitalCode: string, days: number, model: UsageModel = 'all', nowMs: number = Date.now()): Promise<UsageDaily> {
  return (await buildUsage(hospitalCode, days, model, nowMs)).daily
}

/**
 * 판매모델 3종(합산·일반형·사용량비례형)의 일별 지표를 원본을 한 번만 읽어 함께 낸다 — 전체 병원 화면의 일별 집계용
 * (lib/usage/stats.ts). 각 값은 getUsageDaily(…, model) 과 같다.
 */
export async function getUsageDailyAllModels(hospitalCode: string, days: number, nowMs: number = Date.now()): Promise<Record<UsageModel, UsageDaily>> {
  const loaded = await loadUsage(hospitalCode, days, nowMs)
  return { all: computeUsage(loaded, 'all').daily, general: computeUsage(loaded, 'general').daily, usage: computeUsage(loaded, 'usage').daily }
}

/** 일별 지표 + (주간 집계용) 선택한 판매모델의 부모 측정 구간 */
async function buildUsage(
  hospitalCode: string,
  days: number,
  model: UsageModel,
  nowMs: number,
): Promise<{ daily: UsageDaily; parents: Interval[]; today: number }> {
  return computeUsage(await loadUsage(hospitalCode, days, nowMs), model)
}

type UsageUnit = { key: string; type: number; model: SaleModel; iv: Interval }

/** 원본에서 읽어 판매모델과 무관하게 정리해 둔 것 — computeUsage 가 판매모델별로 센다 */
type LoadedUsage = {
  hospitalCode: string
  days: number
  today: number
  first: number
  from: string
  receive: { servers: number; lastSuccessAt: string | null }
  plans: Map<number, CapacityPlan>
  unitList: UsageUnit[]
  /** 측정 환자 수에 넣는 부모 측정 (기기 기록 없는 종료 측정 제외 뒤) */
  parentCands: { key: string; iv: Interval }[]
  /** 보관 기한이 지나 기기 정보가 지워진 측정 — 이 측정이 걸친 날은 기기별 수치를 알 수 없다 */
  purged: Interval[]
  inModel: (key: string, sel: UsageModel) => boolean
  models: UsageDaily['models']
}

/** 원본 DB·운영관리시스템 DB 를 읽는다 (병원 하나, 판매모델과 무관) */
async function loadUsage(hospitalCode: string, days: number, nowMs: number): Promise<LoadedUsage> {
  const pool = usagePool()
  const today = localDayStart(nowMs, TZ_OFFSET_HOURS)
  const first = today - (days - 1) * DAY_SEC
  const from = dayLabel(first)
  const toExclusive = dayLabel(today + DAY_SEC)
  const kinds = USAGE_DEVICE_KINDS.map((k) => k.type)

  const [receive, measurements, units, plans, modelBySerial, statusCoverage] = await Promise.all([
    getUsageReceive(hospitalCode),
    pool.query(
      `WITH ${MEASUREMENT_CTE}
       SELECT m.server, m.measurement_code, m.parent_type, m.parent_measurement_code, m.measurement_status,
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
         -- 측정 코드 목록으로 먼저 좁힌다(색인 hospital_code·measurement_code 사용). m 과 바로 JOIN 하면 통계에 따라 서버 번호만으로
         -- 병합 조인을 골라 수억 행을 비교한다(2026-11-19 DEV 화순성심 25초 → 0.6초). 다른 서버의 같은 코드는 아래 m 과의 JOIN 에서 빠진다
         WHERE ds.hospital_code = $1 AND ds.measurement_code = ANY (ARRAY(SELECT measurement_code FROM m))
           AND ds.event_at >= timestamp '2000-01-01'
         GROUP BY ds.server, ds.measurement_code, ds.device_type, COALESCE(ds.serial_number, '')
       ),
       d AS (
         SELECT server, measurement_code, device_type, serial_number, removed_at
         FROM raw_measurement_devices WHERE hospital_code = $1
       )
       SELECT m.server, m.measurement_code, m.parent_measurement_code, COALESCE(st.device_type, d.device_type) AS device_type,
              COALESCE(st.serial_number, d.serial_number) AS serial_number,
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
    loadModelBySerial(hospitalCode),
    loadStatusCoverage(hospitalCode),
  ])
  // 기기 종류의 도입 수량이 한 판매모델뿐이면 그 모델, 섞였으면 시리얼의 계약건, 그래도 모르면 기본 모델(카트온 사용량비례형·그 밖 일반형)
  const hospitalModel = hospitalModelOf(Array.from(plans.values()))
  const typeModel = new Map<number, SaleModel | null>(Array.from(plans.entries()).map(([t, p]) => [t, typeModelOf(p)]))
  const modelOf = (type: number, serial: string | null): SaleModel =>
    typeModel.get(type) ?? modelBySerial.get(normalizeSerial(serial).serialNo) ?? defaultModelOf(type)

  // 기기 사용 단위 → 판매모델. 측정(과 부모 측정)마다 붙은 기기의 판매모델을 심전계·산소포화도 / 카트온으로 나눠 모은다
  const unitList: UsageUnit[] = []
  const mainModels = new Map<string, Set<SaleModel>>()
  const withDevice = new Set<string>() // 기기 기록이 하나라도 있는 측정 (자식 측정의 기기는 부모에도)
  const otherModels = new Map<string, Set<SaleModel>>()
  const addModel = (key: string, type: number, m: SaleModel) => {
    if (!KIND_TYPES.has(type)) return
    const map = MAIN_TYPES.has(type) ? mainModels : otherModels
    const set = map.get(key) ?? new Set<SaleModel>()
    set.add(m)
    map.set(key, set)
  }
  for (const r of units.rows) {
    if (r.s === null || r.e === null) continue
    const key = `${r.server}|${r.measurement_code}`
    const type = Number(r.device_type)
    const m = modelOf(type, r.serial_number)
    withDevice.add(key)
    if (r.parent_measurement_code) withDevice.add(`${r.server}|${r.parent_measurement_code}`)
    addModel(key, type, m)
    if (r.parent_measurement_code) addModel(`${r.server}|${r.parent_measurement_code}`, type, m)
    unitList.push({ key, type, model: m, iv: { s: Number(r.s), e: Number(r.e) } })
  }
  const inModel = (key: string, sel: UsageModel) =>
    sel === 'all' || measurementModels(mainModels.get(key), otherModels.get(key), hospitalModel).has(sel)

  // 측정 구간 (환자 수·동시측정은 부모 측정만)
  const parentCands: { key: string; iv: Interval }[] = []
  const all: { key: string; status: number; iv: Interval }[] = []
  const parentKeysByModel = { general: 0, usage: 0 }
  for (const r of measurements.rows) {
    if (r.s === null || r.e === null) continue
    const iv = { s: Number(r.s), e: Number(r.e) }
    if (iv.e < iv.s) continue
    const key = `${r.server}|${r.measurement_code}`
    all.push({ key, status: Number(r.measurement_status), iv })
    if (Number(r.parent_type) !== 0) continue
    const covered = statusCoverage.get(String(r.server))
    if (!countsAsMeasurement(Number(r.measurement_status), withDevice.has(key), covered !== undefined && iv.e <= covered)) continue
    if (inModel(key, 'general')) parentKeysByModel.general++
    if (inModel(key, 'usage')) parentKeysByModel.usage++
    parentCands.push({ key, iv })
  }

  // 보관 기한이 지나 기기 정보가 지워진 측정(기기 단위가 하나도 없는 상태 10) — 이 측정이 걸친 날은 기기별 수치를 알 수 없다
  const hasUnits = new Set<string>(unitList.map((u) => u.key))
  const purged = all.filter((m) => m.status === 10 && !hasUnits.has(m.key)).map((m) => m.iv)

  // 고를 수 있는 판매모델: 계약 수량이 있거나 기간 안에 그 모델의 측정이 있으면
  const hasContract = (sel: SaleModel) => Array.from(plans.values()).some((p) => (planForModel(p, sel)?.deals.length ?? 0) > 0 || planForModel(p, sel)?.supply != null)
  const models = USAGE_MODELS.map((x) => ({
    key: x.key as UsageModel,
    label: x.label,
    available: x.key === 'all' ? true : hasContract(x.key) || parentKeysByModel[x.key] > 0,
  }))

  return { hospitalCode, days, today, first, from, receive, plans, unitList, parentCands, purged, inModel, models }
}

/** 읽어 둔 원본으로 한 판매모델의 일별 지표를 센다 (DB 를 읽지 않는다) */
function computeUsage(loaded: LoadedUsage, model: UsageModel): { daily: UsageDaily; parents: Interval[]; today: number } {
  const { hospitalCode, days, today, first, from, receive, plans, unitList, parentCands, purged, inModel, models } = loaded
  const parents = parentCands.filter((p) => inModel(p.key, model)).map((p) => p.iv)

  // 기기 사용 구간 (종류별, 선택한 판매모델만)
  const unitsByType = new Map<number, Interval[]>()
  for (const u of unitList) {
    if (!KIND_TYPES.has(u.type)) continue
    if (model !== 'all' && u.model !== model) continue
    const list = unitsByType.get(u.type) ?? []
    list.push(u.iv)
    unitsByType.set(u.type, list)
  }

  const dayStarts = Array.from({ length: days }, (_, i) => first + i * DAY_SEC)
  const dayRows = dayStarts.map((d) => {
    const st = dayStats(parents, d)
    return { date: dayLabel(d), measured: st.count, started: startedIn(parents, d, d + DAY_SEC), peak: st.peak, today: d === today }
  })
  const deviceKnown = dayStarts.map((d) => dayStats(purged, d).count === 0)
  const firstKnown = deviceKnown.indexOf(true)

  const devices: UsageDevice[] = USAGE_DEVICE_KINDS.map((k) => {
    const ivs = unitsByType.get(k.type) ?? []
    const plan = planForModel(plans.get(k.type), model)
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
  const daily: UsageDaily = {
    hospitalCode,
    range: { from, to: dayLabel(today), days },
    model,
    models,
    receive,
    summary: {
      avgMeasured: average(past.map((r) => r.measured)),
      avgStarted: average(past.map((r) => r.started)),
      maxPeak: receive.servers > 0 ? maxPeak : null,
      maxPeakDate: receive.servers > 0 ? maxPeakDate : null,
      todayMeasured: dayRows[dayRows.length - 1]?.measured ?? 0,
    },
    days: dayRows,
    devices,
    deviceDataFrom: firstKnown >= 0 ? dayLabel(dayStarts[firstKnown]) : null,
  }
  return { daily, parents, today }
}

// ─── 주간 (2026-11-18 사용자 결정: 최근 12주, 월~일, 주간 신규 측정 수 · 최대 동시/동시 가동률은 평균 + 최고) ───

export const USAGE_WEEKS = 12

export type UsageWeek = {
  /** 월요일 'YYYY-MM-DD' */
  weekStart: string
  /** 일요일 'YYYY-MM-DD' */
  weekEnd: string
  /** 이번 주(진행 중) */
  current: boolean
  /** 주간 신규 측정 수 — 그 주에 시작한 측정 수 (2026-11-18 사용자 결정: 주간 실측정 수 대신) */
  started: number
  /** 전주 대비 신규 측정 수 증감(%) — 이번 주·첫 주·전주 0건이면 null */
  startedChange: number | null
  /** 일별 최대 동시측정 수의 주 평균(오늘 제외) · 주 최고(오늘 포함) */
  peakAvg: number | null
  peakMax: number | null
  /** 기기 종류별 동시 가동률(%) 주 평균(오늘·수치 없는 날 제외) · 주 최고 */
  devices: { key: string; label: string; peakRateAvg: number | null; peakRateMax: number | null }[]
}

export type UsageWeekly = {
  hospitalCode: string
  model: UsageModel
  models: UsageDaily['models']
  receive: UsageDaily['receive']
  weeks: UsageWeek[]
  /** 기기 종류별 오늘 기준 계약·공급 수량 (없으면 가동률 열을 비운다) */
  capacities: { key: string; label: string; capacity: number | null }[]
}

/** 일별 결과 + 부모 측정 구간 → 주별 행 (순수 함수 — scripts/usage-metrics-test.mts 에서 검증) */
export function aggregateWeeks(daily: UsageDaily, parents: Interval[], today: number, weeks: number): UsageWeek[] {
  const thisMonday = weekStartOf(today)
  const dayIndex = new Map(daily.days.map((d, i) => [d.date, i]))
  const rows: UsageWeek[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = thisMonday - w * 7 * DAY_SEC
    const end = Math.min(start + 7 * DAY_SEC, today + DAY_SEC)
    const idx: number[] = []
    for (let d = start; d < end; d += DAY_SEC) {
      const i = dayIndex.get(dayLabel(d))
      if (i !== undefined) idx.push(i)
    }
    const doneIdx = idx.filter((i) => !daily.days[i].today)
    const rate = (dv: UsageDevice, i: number) => {
      const r = dv.days[i]
      return r.peak === null || !r.capacity ? null : (r.peak / r.capacity) * 100
    }
    rows.push({
      weekStart: dayLabel(start),
      weekEnd: dayLabel(start + 6 * DAY_SEC),
      current: w === 0,
      started: startedIn(parents, start, end),
      startedChange: null,
      peakAvg: average(doneIdx.map((i) => daily.days[i].peak)),
      peakMax: maxOf(idx.map((i) => daily.days[i].peak)),
      devices: daily.devices.map((dv) => ({
        key: dv.key,
        label: dv.label,
        peakRateAvg: average(doneIdx.map((i) => rate(dv, i))),
        peakRateMax: maxOf(idx.map((i) => rate(dv, i))),
      })),
    })
  }
  for (let i = 1; i < rows.length; i++) if (!rows[i].current) rows[i].startedChange = changeRate(rows[i].started, rows[i - 1].started)
  return rows
}

export async function getUsageWeekly(hospitalCode: string, model: UsageModel = 'all', weeks: number = USAGE_WEEKS, nowMs: number = Date.now()): Promise<UsageWeekly> {
  const today = localDayStart(nowMs, TZ_OFFSET_HOURS)
  const days = Math.round((today - (weekStartOf(today) - (weeks - 1) * 7 * DAY_SEC)) / DAY_SEC) + 1
  const built = await buildUsage(hospitalCode, days, model, nowMs)
  return {
    hospitalCode,
    model,
    models: built.daily.models,
    receive: built.daily.receive,
    weeks: aggregateWeeks(built.daily, built.parents, built.today, weeks),
    capacities: built.daily.devices.map((d) => ({ key: d.key, label: d.label, capacity: d.capacity })),
  }
}
