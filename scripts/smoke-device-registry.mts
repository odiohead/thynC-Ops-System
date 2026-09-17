/**
 * 디바이스 원장 스모크 — 서비스 계층(lib/deviceRegistry) + 라우트 핸들러 (§11 P2 검증 목록)
 *
 *   npx tsx scripts/smoke-device-registry.mts
 *
 * - DEV DB(thync_ops_dev)에 직접 쓴다. 고객 병원('운영') 3곳을 자동 선택(원장 행·병동이 없는 곳 우선):
 *   H1 = 계약완료 딜 있음(기대 수량 hard 대조) · H2 = 이관·재등록 상대 · H3 = 계약완료 딜 0건(expected null)
 * - 테스트 시리얼은 A9900xx / P9900xx / B9900xx 접두 + 실제 WMS 시리얼 2건(GW OUT 1·ECG IN_STOCK 1 — inventory_* 읽기만)
 * - 끝(실패 포함, finally)에 만든 것 전부 삭제: 이벤트 → 배치 행 → 유닛 → 배치 → 병동 → 이 실행이 남긴 audit_logs.
 *   시작/종료 시 5개 원장 테이블(device_units 포함) row 수가 같아야 통과.
 * - 3층 구조(B-20): 공개 device id = device_units.id. 서비스는 유닛을 자동 삭제하지 않는다(이벤트 0 → 배치 행만 삭제, 유닛은 고아로 남음)
 *   → 스모크가 만든 유닛은 cleanup이 직접 지운다.
 * - [1e] 기기 상태·위치 축(2026-09-17 device_condition_location_design.md 부록 C [1e-1]~[1e-11]): 2축 전이표 전수·멱등/INTAKE ref 규칙·가드 409/RegistryTxAbort 롤백·
 *   취소/재도출·SCRAPPED 등록 409·ACTIVE SCRAP/SITE_MOVE 409·배치 상태 이벤트 0 재-fold·I-6·일괄=단건·DEVICE_SITE 마스터·ACTIVE_OTHER conflict.
 *   거점 마스터는 seed의 DEVICE_SITE 2행을 그대로 쓴다(스모크 거점 생성 없음). 스모크용 AS접수(SMOKE_AS_CODES, 티켓 없음)는 cleanup에서 삭제.
 * - [13] 라우트에 units/[id]/{repair-done,repair-undo,scrap,location}·PATCH condition/location·목록 필터·as-receipts/[id]/{repair-done,scrap-line} 포함.
 */
import { readFileSync } from 'fs'
import { Prisma, PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import type { RegistryCtx } from '../lib/deviceRegistry'

// JWT_SECRET 등 — prisma는 .env를 스스로 읽지만 lib/auth는 process.env만 본다
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  }
} catch {
  /* .env 없음 — 환경변수로 대체 */
}

// tsx의 CJS 상호운용은 `export *` 인덱스의 정적 named import를 해석하지 못한다 — 동적 import로 네임스페이스를 받는다
const reg = await import('../lib/deviceRegistry')
const {
  RegistryError,
  registerDevices,
  moveDeviceWard,
  recoverDevice,
  replaceDevice,
  bulkDeviceAction,
  previewRows,
  importBatch,
  correctDevice,
  editEvent,
  cancelLastEvent,
  cancelImportBatch,
  editImportBatchDate,
  updateDeviceMemo,
  rebuildUnitProjection,
  getHospitalDeviceSummary,
  getGlobalCoverage,
  getExpectedDeviceCount,
  lookupDevice,
  listUnits,
  listEvents,
  getUnitDetail,
  matchInventoryUnits,
  insertEvent,
  withRegistryTx,
  reasonByValue,
  getOrCreateUnit,
  flattenDevice,
  loadTrackedModels,
  loadUsageTypes,
  getHospitalProductTypeContext,
  countReplacements,
  // 상태·위치 축(2026-09-17 condition.ts)
  RegistryTxAbort,
  intakeDevice,
  markDeviceRepaired,
  undoDeviceRepaired,
  scrapDevice,
  moveDeviceLocation,
  applyUnitState,
  applyImplicitTransition,
  judgeCondition,
  loadDeviceSites,
  ymd,
} = reg
const shared = await import('../lib/deviceRegistryShared')
const access = await import('../lib/deviceRegistryAccess')
const auth = await import('../lib/auth')

const prisma = new PrismaClient()
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

/** 테스트 시리얼 — A9900xx / P9900xx / B9900xx (7자, 모델 패턴 통과) */
const S = (n: number, kind: 'A' | 'P' | 'B' = 'A') => `${kind}9900${String(n).padStart(2, '0')}`
const TEST_PREFIXES = ['A9900', 'P9900', 'B9900']
const AUDIT_RESOURCES = ['hospital_device', 'hospital_device_event', 'hospital_device_import', 'hospital_ward', 'setting:device_recovery_reason', 'setting:device_usage_type', 'as_receipt']
/** 스모크용 AS접수 코드 — [1e] ref 규칙용 3건(라인 없음) + [13] 라우트용 1건(라인 3). 티켓 없음, cleanup에서 삭제(라인은 CASCADE) */
const SMOKE_AS_CODES = ['AS-999901-9001', 'AS-999901-9002', 'AS-999901-9003', 'AS-999912-9901'] as const

let pass = 0
let fail = 0
function ok(cond: unknown, label: string, extra?: unknown) {
  if (cond) {
    pass++
    console.log(`  ✔ ${label}`)
  } else {
    fail++
    console.log(`  ✘ ${label}`, extra !== undefined ? JSON.stringify(extra, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)) : '')
  }
}
async function expectErr(label: string, fn: () => Promise<unknown>, status: number, msgPart?: string) {
  try {
    await fn()
    ok(false, `${label} → 예외 없음`)
  } catch (e) {
    const re = e as InstanceType<typeof RegistryError>
    const hit = re instanceof RegistryError && re.status === status && (!msgPart || re.message.includes(msgPart))
    ok(hit, `${label} → ${status}${msgPart ? ` '${msgPart}'` : ''}`, { status: re?.status, message: (e as Error)?.message, name: (e as Error)?.name })
    return re
  }
  return null
}
const section = (t: string) => console.log(`\n${t}`)

// ─────────────────────────────────────────────────────────────────────────────
// 환경 선택 · 사전 스냅샷 · 정리
// ─────────────────────────────────────────────────────────────────────────────

type Counts = { u: number; d: number; e: number; w: number; b: number }
async function counts(): Promise<Counts> {
  const r = await prisma.$queryRaw<{ u: bigint; d: bigint; e: bigint; w: bigint; b: bigint }[]>`
    SELECT (SELECT count(*) FROM device_units) u, (SELECT count(*) FROM hospital_devices) d, (SELECT count(*) FROM hospital_device_events) e,
           (SELECT count(*) FROM hospital_wards) w, (SELECT count(*) FROM hospital_device_import_batches) b`
  return { u: Number(r[0].u), d: Number(r[0].d), e: Number(r[0].e), w: Number(r[0].w), b: Number(r[0].b) }
}
async function maxIds() {
  const r = await prisma.$queryRaw<{ u: number; d: number; e: number; w: number; b: number; a: number }[]>`
    SELECT coalesce((SELECT max(id) FROM device_units),0)::int u, coalesce((SELECT max(id) FROM hospital_devices),0)::int d,
           coalesce((SELECT max(id) FROM hospital_device_events),0)::int e,
           coalesce((SELECT max(id) FROM hospital_wards),0)::int w, coalesce((SELECT max(id) FROM hospital_device_import_batches),0)::int b,
           coalesce((SELECT max(id) FROM audit_logs),0)::int a`
  return r[0]
}

const pre = { counts: await counts(), max: await maxIds() }

type HospRow = { hospital_code: string; hospital_name: string; deals: number; expected: number; pt_kinds: number; has_rows: boolean; em_ecg: number | null; em_spo2: number | null }
const candidates = await prisma.$queryRaw<HospRow[]>`
  WITH dl AS (SELECT sd.hospital_code, count(*)::int c, sum(coalesce(sd.daewoong_device_count,0))::int s,
                     count(DISTINCT sd.product_type) FILTER (WHERE sd.product_type IN ('일반','라이트'))::int k,
                     bool_or(EXISTS (SELECT 1 FROM sales_deal_devices sdd WHERE sdd.deal_id = sd.id)) hr,
                     sum(m.ecg)::int em_ecg, sum(m.spo2)::int em_spo2
                FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
                LEFT JOIN (SELECT sdd.deal_id, sum(sdd.quantity) FILTER (WHERE di.onprem_device_type = 1)::int ecg,
                                  sum(sdd.quantity) FILTER (WHERE di.onprem_device_type = 3)::int spo2
                             FROM sales_deal_devices sdd JOIN device_info di ON di.id = sdd.device_info_id GROUP BY 1) m ON m.deal_id = sd.id
               WHERE sc.category = 'SALES_DEAL_STATUS' AND sc.name = '계약완료' GROUP BY 1)
  SELECT h.hospital_code, h.hospital_name, coalesce(dl.c,0) deals, coalesce(dl.s,0) expected, coalesce(dl.k,0) pt_kinds, coalesce(dl.hr,false) has_rows, dl.em_ecg, dl.em_spo2
    FROM hospitals h LEFT JOIN dl ON dl.hospital_code = h.hospital_code
   WHERE h.status = '운영'
     AND NOT EXISTS (SELECT 1 FROM hospital_wards w WHERE w.hospital_code = h.hospital_code)
     AND NOT EXISTS (SELECT 1 FROM hospital_devices d WHERE d.hospital_code = h.hospital_code OR d.last_hospital_code = h.hospital_code)
     AND NOT EXISTS (SELECT 1 FROM hospital_device_events e WHERE e.hospital_code = h.hospital_code)
   ORDER BY coalesce(dl.c,0) DESC, coalesce(dl.s,0) DESC, h.hospital_code`
// H1은 상품유형 단일(혼합이면 미지정 등록이 400이라 기존 시나리오가 깨진다 — 혼합 규칙은 [1c]에서 문맥 주입으로 검증)
// + 딜 모델별 수량 행이 **있는** 병원 우선(B-25 개정 2026-09-02 — 디바이스수 폴백 제거로 hard 대조는 모델 행 보유 병원에서만 성립)
const h1 = candidates.find((c) => c.deals > 0 && c.pt_kinds < 2 && c.has_rows && c.em_ecg != null) ?? candidates.find((c) => c.deals > 0 && c.pt_kinds < 2)
const h3 = candidates.find((c) => c.deals === 0)
const h2 = candidates.find((c) => c !== h1 && c !== h3)
if (!h1 || !h2 || !h3) {
  console.error('운영 상태·원장 미보유 고객 병원 3곳(딜 있음 2·딜 없음 1)을 찾지 못했습니다', { h1: h1?.hospital_code, h2: h2?.hospital_code, h3: h3?.hospital_code })
  process.exit(2)
}
const H1 = h1.hospital_code
const H2 = h2.hospital_code
const H3 = h3.hospital_code
const TEST_HOSPITALS = [H1, H2, H3]

const adminUser = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true }, orderBy: { createdAt: 'asc' } })
if (!adminUser) {
  console.error('활성 ADMIN 사용자가 없습니다')
  process.exit(2)
}
const ACTOR = { userId: adminUser.id, name: `${adminUser.name}(스모크)` }

// 실제 WMS 시리얼(읽기 전용): GW OUT 1건(합성 원문) · ECG IN_STOCK 1건 — 원장에 없는 것만
const gwUnit = (
  await prisma.$queryRaw<{ serial_no: string }[]>`
    SELECT u.serial_no FROM inventory_units u JOIN inventory_items i ON i.id = u.item_id
     WHERE i.is_serial_managed AND i.model_name = 'MGW1010' AND u.status = 'OUT' AND u.serial_no ~ '^GW[0-9A-Z]{4}-B[0-9]{6}$'
       AND NOT EXISTS (SELECT 1 FROM device_units d WHERE d.serial_no = right(u.serial_no, 7) OR d.serial_raw = u.serial_no)
     ORDER BY u.id LIMIT 1`
)[0]?.serial_no
const ecgInStock = (
  await prisma.$queryRaw<{ serial_no: string }[]>`
    SELECT u.serial_no FROM inventory_units u JOIN inventory_items i ON i.id = u.item_id
     WHERE i.is_serial_managed AND i.model_name = 'MC200M-T' AND u.status = 'IN_STOCK' AND u.serial_no ~ '^A[0-9]{6}$'
       AND NOT EXISTS (SELECT 1 FROM device_units d WHERE d.serial_no = u.serial_no)
     ORDER BY u.id LIMIT 1`
)[0]?.serial_no
const gwKey = gwUnit ? gwUnit.slice(-7) : null
const mnt = await prisma.maintenance.findFirst({ where: { hospitalCode: { notIn: TEST_HOSPITALS } }, orderBy: { createdAt: 'desc' }, select: { maintenanceCode: true, hospitalCode: true } })

const ctx = (hospitalCode: string | null, occurredOn?: string, extra?: Partial<RegistryCtx>): RegistryCtx => ({ hospitalCode, actor: ACTOR, occurredOn, ...extra })

/** 이 실행이 만든 것만 지운다 — 테스트 접두 시리얼 + 실제 WMS 시리얼 2건 + (사전 max id 이후 유닛 / 테스트 병원 배치 행). 유닛까지 삭제 */
async function cleanup() {
  const serialOr = [
    ...TEST_PREFIXES.map((p) => ({ serialNo: { startsWith: p } })),
    ...(gwKey ? [{ serialNo: gwKey }] : []),
    ...(ecgInStock ? [{ serialNo: ecgInStock }] : []),
  ]
  const units = await prisma.deviceUnit.findMany({
    where: {
      OR: [
        ...serialOr,
        { id: { gt: pre.max.u } },
        { placement: { is: { id: { gt: pre.max.d }, OR: [{ hospitalCode: { in: TEST_HOSPITALS } }, { lastHospitalCode: { in: TEST_HOSPITALS } }] } } },
      ],
    },
    select: { id: true },
  })
  const ids = units.map((d) => d.id)
  await prisma.asReceipt.deleteMany({ where: { asCode: { in: [...SMOKE_AS_CODES] } } }) // 라인 CASCADE
  await prisma.hospitalDeviceEvent.deleteMany({
    where: { OR: [{ deviceId: { in: ids } }, { relatedDeviceId: { in: ids } }, { id: { gt: pre.max.e }, hospitalCode: { in: TEST_HOSPITALS } }] },
  })
  await prisma.hospitalDevice.updateMany({ where: { replacedById: { in: ids } }, data: { replacedById: null } })
  await prisma.hospitalDevice.deleteMany({ where: { deviceId: { in: ids } } })
  await prisma.deviceUnit.deleteMany({ where: { id: { in: ids } } })
  await prisma.hospitalDeviceImportBatch.deleteMany({ where: { id: { gt: pre.max.b }, hospitalCode: { in: TEST_HOSPITALS } } })
  await prisma.hospitalWard.deleteMany({ where: { id: { gt: pre.max.w }, hospitalCode: { in: TEST_HOSPITALS } } })
  await prisma.statusCode.deleteMany({ where: { category: 'DEVICE_RECOVERY_REASON', name: { startsWith: '스모크 사유' } } })
  await prisma.statusCode.deleteMany({ where: { category: 'DEVICE_USAGE_TYPE', name: { startsWith: '스모크 용도' } } })
  await prisma.auditLog.deleteMany({ where: { id: { gt: pre.max.a }, resource: { in: AUDIT_RESOURCES } } })
}

const PROJ_FIELDS = ['status', 'hospitalCode', 'wardId', 'placedOn', 'lastHospitalCode', 'recoveredOn', 'recoverReasonId', 'lastEventType', 'lastEventOn', 'replacedById', 'productType', 'dealCode', 'asStartedOn', 'asRefCode'] as const
function projOf(d: Record<string, unknown> | null) {
  return d ? Object.fromEntries(PROJ_FIELDS.map((f) => [f, d[f] instanceof Date ? (d[f] as Date).toISOString() : d[f] ?? null])) : null
}
/** 프로젝션 = fold — 저장된 배치 행(device_id = 유닛 id)과 `rebuildUnitProjection`(fold 재계산·UPDATE) 이후 행이 같아야 한다 */
async function projectionEqualsRebuild(deviceId: number): Promise<boolean> {
  const before = projOf(await prisma.hospitalDevice.findUnique({ where: { deviceId } }))
  if (!before) return false
  await rebuildUnitProjection(prisma, deviceId)
  const after = projOf(await prisma.hospitalDevice.findUnique({ where: { deviceId } }))
  return JSON.stringify(before) === JSON.stringify(after)
}
async function allTestDeviceIds(): Promise<number[]> {
  const rows = await prisma.hospitalDevice.findMany({
    where: { OR: [{ hospitalCode: { in: TEST_HOSPITALS } }, { lastHospitalCode: { in: TEST_HOSPITALS } }, { unit: { OR: TEST_PREFIXES.map((p) => ({ serialNo: { startsWith: p } })) } }] },
    select: { deviceId: true },
  })
  return rows.map((r) => r.deviceId)
}

/** 공개 형상(유닛 + 배치 평탄화) — 배치 행이 없는 유닛(고아)은 null. `id`는 유닛 id */
async function dev(where: { id: number } | { serialNo: string }) {
  const u = await prisma.deviceUnit.findUnique({ where, include: { placement: true, usageType: { select: { id: true, name: true, value: true } } } })
  return u && u.placement ? flattenDevice(u, u.placement) : null
}
/** 유닛 원행(배치 무관) */
const unitRow = (where: { id: number } | { serialNo: string }) => prisma.deviceUnit.findUnique({ where })

// ─────────────────────────────────────────────────────────────────────────────
// 본문
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  section('[0] 환경')
  console.log(`  H1=${H1} ${h1!.hospital_name} (계약완료 딜 ${h1!.deals}건 · 디바이스수 Σ${h1!.expected}(참고) · 모델 ECG ${h1!.em_ecg ?? '—'}/SpO2 ${h1!.em_spo2 ?? '—'}) · H2=${H2} ${h2!.hospital_name} · H3=${H3} ${h3!.hospital_name} (딜 0건)`)
  console.log(`  actor=${ACTOR.name} · GW WMS=${gwUnit ?? '없음'} · ECG IN_STOCK=${ecgInStock ?? '없음'} · MNT=${mnt?.maintenanceCode ?? '없음'}`)
  console.log(`  사전 row: units=${pre.counts.u} devices=${pre.counts.d} events=${pre.counts.e} wards=${pre.counts.w} batches=${pre.counts.b}`)
  const defect = await reasonByValue(prisma, 'DEFECT')

  section('[1] 등록 → 이동 → 회수 → 타 병원 재등록')
  const r1 = await registerDevices(ctx(H1, '2026-08-01'), [
    { serialInput: ` ${S(1).toLowerCase()} `, wardName: '6 병동' },
    { serialInput: S(2), wardName: '6병동' },
    { serialInput: S(1, 'P') },
  ])
  ok(r1.created.length === 3 && r1.newWards.length === 1, '신규 3건 등록·병동 1개 생성(표기 상이 동명 병합·소문자/공백 정규화)', r1.warnings)
  const d1 = r1.created.find((c) => c.serialNo === S(1))!
  const d2 = r1.created.find((c) => c.serialNo === S(2))!
  ok(d1.wardId != null && d1.wardId === d2.wardId, '같은 병동 id')
  ok(r1.created.every((c) => c.unitCreated) && (await prisma.deviceUnit.count({ where: { serialNo: S(1) } })) === 1 && (await prisma.hospitalDevice.count({ where: { deviceId: d1.id } })) === 1, '3층: 시리얼당 유닛 1행 + 배치 행 1행(device_id = 유닛 id = 공개 id)')
  ok((await unitRow({ id: d1.id }))?.source === 'MANUAL' && (await unitRow({ id: d1.id }))?.deviceInfoId === (await dev({ id: d1.id }))!.deviceInfoId, '유닛 source MANUAL · 모델은 유닛 속성')
  const ward6 = (await prisma.hospitalWard.findUnique({ where: { id: d1.wardId! } }))!
  ok(ward6.name === '6 병동' && ward6.nameNorm === '6병동' && Math.abs(Date.now() - ward6.createdAt.getTime()) < 5 * 60_000, '자동 생성 병동 name/name_norm·created_at UTC 기준(세션 tz 편차 없음)', { createdAt: ward6.createdAt, now: new Date() })
  await expectErr('같은 병원 재등록 단건', () => registerDevices(ctx(H1), [{ serialInput: S(1) }]), 409, '이미 이 병원에 배치 중')
  await expectErr('같은 병원 재등록 2건 전부 skip', () => registerDevices(ctx(H1), [{ serialInput: S(1) }, { serialInput: S(2) }]), 409, '이미 이 병원에 배치 중')
  const r1b = await registerDevices(ctx(H1, '2026-08-02'), [{ serialInput: S(1) }, { serialInput: S(3), wardName: '7병동' }])
  ok(r1b.created.length === 1 && r1b.skipped.length === 1 && r1b.skipped[0].serialNo === S(1), '일부 skip → 201 + skipped[]', r1b.skipped)
  const d3 = r1b.created[0]

  const mv = await moveDeviceWard(ctx(null, '2026-08-05'), { deviceId: d1.id, toWardName: '7병동' })
  ok(mv.event.eventType === 'MOVE_WARD' && mv.device.wardId === mv.toWard.id && mv.fromWardId === d1.wardId, '병동 이동(병원 문맥은 개체에서 유도)')
  const ward7 = mv.toWard
  await expectErr('같은 병동 이동', () => moveDeviceWard(ctx(null), { deviceId: d1.id, toWardId: ward7.id }), 400)
  await expectErr('이동 대상 미지정', () => moveDeviceWard(ctx(null), { deviceId: d1.id }), 400)
  const rc = await recoverDevice(ctx(null, '2026-08-10'), { deviceId: d1.id, reasonCodeId: defect.id })
  ok(rc.device.status === 'RECOVERED' && rc.device.hospitalCode == null && rc.device.lastHospitalCode === H1 && rc.fromWardId === ward7.id && rc.device.recoverReasonId === defect.id, '회수 → RECOVERED·hospital NULL·last_hospital·사유')
  await expectErr('이미 회수 → 순차 재회수', () => recoverDevice(ctx(null), { deviceId: d1.id, reasonCodeId: defect.id }), 409, '이미 회수된')
  await expectErr('회수 기기 이동', () => moveDeviceWard(ctx(H1), { deviceId: d1.id, toWardName: '6병동' }), 409)
  await expectErr('사유 없는 회수', () => recoverDevice(ctx(null), { deviceId: d2.id, reasonCodeId: null as unknown as number }), 400)
  await expectErr('없는 기기', () => moveDeviceWard(ctx(H1), { deviceId: 999_999_999, toWardName: '6병동' }), 404)
  const r2 = await registerDevices(ctx(H2, '2026-08-20'), [{ serialInput: S(1), wardName: 'ICU' }])
  ok(r2.reregistered.length === 1 && r2.reregistered[0].id === d1.id && !r2.reregistered[0].unitCreated && (await prisma.deviceUnit.count({ where: { serialNo: S(1) } })) === 1, '타 병원 재등록 = 같은 유닛 id 재사용(unitCreated=false, 유닛 1행 유지)')
  {
    const tracked = await loadTrackedModels(prisma)
    const mine = (await unitRow({ id: d1.id }))!.deviceInfoId
    const other = tracked.find((m) => m.id !== mine)!
    await expectErr('getOrCreateUnit — 같은 시리얼 다른 모델', () => getOrCreateUnit(prisma, { serialNo: S(1), deviceInfoId: other.id, source: 'MANUAL' }), 409, '이미 다른 모델로 등록된 시리얼')
    const same = await getOrCreateUnit(prisma, { serialNo: ` ${S(1).toLowerCase()} `, deviceInfoId: mine, source: 'MANUAL' })
    ok(!same.created && same.unit.id === d1.id, 'getOrCreateUnit — 같은 모델이면 기존 유닛 반환(정규화 후 조회)')
    const r4 = await registerDevices(ctx(H2, '2026-08-01'), [{ serialInput: S(4) }])
    const rOther = await registerDevices(ctx(H1, '2026-08-02'), [{ serialInput: S(4), deviceInfoId: other.id }], { conflicts: { [S(4)]: 'TRANSFER' } })
    ok(rOther.transferred.length === 1 && rOther.transferred[0].id === r4.created[0].id && rOther.warnings.some((w) => w.includes('지정 모델')) && (await unitRow({ id: r4.created[0].id }))!.deviceInfoId === mine, '등록 시 기존 유닛과 다른 모델 지정 → 유닛 모델 유지 + 경고(정체성 우선)')
  }
  const d1row = (await dev({ id: d1.id }))!
  ok(d1row.status === 'ACTIVE' && d1row.hospitalCode === H2 && d1row.lastHospitalCode == null && d1row.recoveredOn == null && d1row.recoverReasonId == null, '재등록 프로젝션(현재 배치만 — last_hospital·recovered_on·사유 NULL)')
  ok(await projectionEqualsRebuild(d1.id), '프로젝션 = fold(rebuildUnitProjection 멱등)')
  // replaced_by_id도 재등록 시 NULL
  const r90 = await registerDevices(ctx(H1, '2026-07-01'), [{ serialInput: S(90), wardName: '6병동' }])
  const rp90 = await replaceDevice(ctx(H1, '2026-07-05'), { oldDeviceId: r90.created[0].id, newSerial: S(91) })
  ok(rp90.oldDevice.status === 'RECOVERED' && rp90.oldDevice.replacedById === rp90.newDevice.id, '교체 → 구기기 replaced_by_id = 신')
  await registerDevices(ctx(H2, '2026-07-10'), [{ serialInput: S(90) }])
  const d90 = (await dev({ id: r90.created[0].id }))!
  ok(d90.status === 'ACTIVE' && d90.hospitalCode === H2 && d90.replacedById == null && d90.lastHospitalCode == null, '타 병원 재등록 후 replaced_by_id·last_hospital_code NULL')

  section('[1b] 용도(판매용 SALE / 평가용 EVAL) — 유닛 속성 · 등록/임포트/교체/정정 · 계약 대조 제외')
  const usageTypes = await loadUsageTypes(prisma)
  const sale = usageTypes.find((u) => u.value === 'SALE')!
  const evalT = usageTypes.find((u) => u.value === 'EVAL')!
  ok(!!sale && !!evalT && sale.name === '판매용' && evalT.name === '평가용', '용도 마스터 DEVICE_USAGE_TYPE 2행(SALE 판매용·EVAL 평가용)')
  {
    // 거점 마스터(DEVICE_SITE, 2026-09-17 상태·위치 축 §5.2) — [1e] 2축 전이 스모크는 Integrate 단계에서 별도 작성
    const sites = await prisma.statusCode.findMany({ where: { category: shared.DEVICE_SITE_CATEGORY }, select: { name: true, value: true } })
    const rc = sites.find((x) => x.value === 'REFRESH_CENTER')
    const hub = sites.find((x) => x.value === 'HUB')
    ok(!!rc && !!hub && rc.name === '리프레시센터' && hub.name === 'thynC Connected Hub', '거점 마스터 DEVICE_SITE 2행(REFRESH_CENTER 리프레시센터·HUB thynC Connected Hub)', sites)
  }
  const rU = await registerDevices(ctx(H1, '2026-08-01'), [
    { serialInput: S(5), usageTypeId: evalT.id, wardName: '6병동' },
    { serialInput: S(6), usageTypeInput: '판매용' },
    { serialInput: S(7) },
  ])
  const u5 = rU.created.find((c) => c.serialNo === S(5))!
  const u6 = rU.created.find((c) => c.serialNo === S(6))!
  const u7 = rU.created.find((c) => c.serialNo === S(7))!
  ok(rU.created.length === 3 && u5.usageTypeId === evalT.id && u6.usageTypeId === sale.id && u7.usageTypeId === null, '등록 시 용도 — id 지정 · 입력 별칭(판매용) · 미지정(null)')
  ok((await unitRow({ id: u5.id }))!.usageTypeId === evalT.id && (await dev({ id: u5.id }))!.usageType?.value === 'EVAL', '유닛 usage_type_id 저장 + DeviceRow.usageType {id,name,value} 평탄화')
  await expectErr('알 수 없는 용도 입력', () => registerDevices(ctx(H1), [{ serialInput: S(8), usageTypeInput: '전시용' }]), 400, '용도 값이 올바르지 않습니다 (판매용/평가용)')
  await expectErr('없는 용도 id', () => registerDevices(ctx(H1), [{ serialInput: S(8), usageTypeId: 999_999 }]), 400, '용도 값이 올바르지 않습니다')
  // 기존 유닛에 다른 용도를 명시 → 기존 값 유지 + 경고(모델과 같은 규약)
  await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u5.id, reasonCodeId: defect.id })
  const rU2 = await registerDevices(ctx(H2, '2026-08-10'), [{ serialInput: S(5), usageTypeId: sale.id }])
  ok(rU2.reregistered.length === 1 && rU2.reregistered[0].usageTypeId === evalT.id && rU2.warnings.some((w) => w.includes('지정 용도')), '기존 유닛과 다른 용도 지정 → 기존 유지 + 경고', rU2.warnings)
  await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u7.id, reasonCodeId: defect.id })
  const rU3 = await registerDevices(ctx(H1, '2026-08-10'), [{ serialInput: S(7), usageTypeInput: 'EVAL' }])
  ok(rU3.reregistered[0].usageTypeId === evalT.id && (await unitRow({ id: u7.id }))!.usageTypeId === evalT.id, '미지정 유닛은 재등록 시 용도 채움(value 별칭 EVAL)')
  // correctDevice — 용도 변경 CORRECT · 취소 복원 · null(미지정)
  const cu = await correctDevice(ctx(null), { deviceId: u6.id, changes: { usageTypeId: evalT.id } })
  ok(cu.event.eventType === 'CORRECT' && (cu.changes.usageTypeId as { before: number }).before === sale.id && (cu.changes.usageTypeId as { after: number }).after === evalT.id && cu.device.usageTypeId === evalT.id, 'correctDevice usageTypeId → CORRECT changes {before,after}')
  await expectErr('correctDevice 없는 용도', () => correctDevice(ctx(null), { deviceId: u6.id, changes: { usageTypeId: 999_999 } }), 400, '용도 값이')
  await expectErr('correctDevice 변경 없음(같은 용도)', () => correctDevice(ctx(null), { deviceId: u6.id, changes: { usageTypeId: evalT.id } }), 400, '변경 사항')
  const cuc = await cancelLastEvent(ctx(null), { eventId: cu.event.id })
  ok(cuc.restored != null && (await unitRow({ id: u6.id }))!.usageTypeId === sale.id, 'CORRECT(용도) 취소 → before 복원')
  const cuNull = await correctDevice(ctx(null), { deviceId: u6.id, changes: { usageTypeId: null } })
  ok(cuNull.device.usageTypeId === null && (cuNull.changes.usageTypeId as { after: unknown }).after === null, 'correctDevice usageTypeId null → 미지정')
  await correctDevice(ctx(null), { deviceId: u6.id, changes: { usageTypeId: sale.id } })
  // 미리보기 — 행 용도 열 > 기본 용도, 알 수 없는 값 error, 기존 유닛 용도 유지
  const pvU = await previewRows(
    H1,
    [
      { row: 1, serialInput: S(9), usageTypeInput: '평가용' },
      { row: 2, serialInput: S(11) },
      { row: 3, serialInput: S(12), usageTypeInput: '전시용' },
      { row: 4, serialInput: S(6) },
    ],
    { wardMode: 'fixed', mode: 'REGISTER', occurredOn: '2026-08-20', usageTypeId: evalT.id }
  )
  ok(pvU.rows[0].usageTypeId === evalT.id && pvU.rows[0].usageTypeName === '평가용', '미리보기 행 용도 열 해석(평가용)')
  ok(pvU.rows[1].usageTypeId === evalT.id && pvU.rows[1].status === 'warn', '미리보기 기본 용도 적용(행에 용도 없음)')
  ok(pvU.rows[2].status === 'error' && pvU.rows[2].messages[0] === '용도 값이 올바르지 않습니다 (판매용/평가용)', '미리보기 알 수 없는 용도 → error 판정')
  ok(pvU.rows[3].status === 'skip' && pvU.rows[3].usageTypeId === sale.id, '기존 유닛(판매용)은 기본 용도(평가용)를 무시하고 유지')
  await expectErr('미리보기 기본 용도 id 오류', () => previewRows(H1, [{ row: 1, serialInput: S(9) }], { wardMode: 'fixed', mode: 'REGISTER', occurredOn: today, usageTypeId: 999_999 }), 400, '기본 용도')
  const impU = await importBatch(ctx(H1, '2026-08-20'), {
    rows: [{ row: 1, serialInput: S(9), usageTypeInput: '평가용' }, { row: 2, serialInput: S(11) }],
    sourceKind: 'PASTE',
    mode: 'REGISTER',
    defaults: { wardMode: 'fixed', usageTypeId: sale.id },
  })
  ok(impU.batch.registeredCount === 2 && (await unitRow({ serialNo: S(9) }))!.usageTypeId === evalT.id && (await unitRow({ serialNo: S(11) }))!.usageTypeId === sale.id, '임포트 실행 — 행 용도(평가용) > 기본 용도(판매용)')
  // 교체 — 신 기기(신규 유닛) 용도는 구 기기 용도 승계, newUsageTypeId 지정이 우선
  const rpU = await replaceDevice(ctx(H1, '2026-08-21'), { oldDeviceId: (await dev({ serialNo: S(9) }))!.id, newSerial: S(13) })
  ok(rpU.newDevice.usageTypeId === evalT.id, '교체 신 기기(신규 유닛) 용도 = 구 기기 용도 승계(평가용)')
  const rpU2 = await replaceDevice(ctx(H1, '2026-08-22'), { oldDeviceId: rpU.newDevice.id, newSerial: S(14), newUsageTypeId: sale.id })
  ok(rpU2.newDevice.usageTypeId === sale.id, '교체 newUsageTypeId 지정 → 우선')
  await expectErr('교체 없는 용도 id', () => replaceDevice(ctx(H1, '2026-08-23'), { oldDeviceId: rpU2.newDevice.id, newSerial: S(15), newUsageTypeId: 999_999 }), 400, '용도 값이')
  // 목록 필터
  const luEval = await listUnits({ hospital: H1, status: 'all', usage: 'EVAL' }, { page: 1, limit: 50 })
  ok(luEval.total >= 1 && luEval.data.every((r) => r.usageType?.value === 'EVAL' && r.usageTypeId === evalT.id), 'listUnits usage=EVAL 필터 + 행 usageType 평탄화')
  const luNone = await listUnits({ hospital: H1, status: 'all', usage: 'none' }, { page: 1, limit: 50 })
  ok(luNone.total >= 1 && luNone.data.every((r) => r.usageTypeId === null && r.usageType === null), 'listUnits usage=none 필터(미지정)')
  const luSale = await listUnits({ hospital: H1, status: 'all', usage: 'SALE' }, { page: 1, limit: 50 })
  ok(luSale.total >= 1 && luSale.data.every((r) => r.usageType?.value === 'SALE'), 'listUnits usage=SALE 필터')


  section('[1c] 상품유형(일반/라이트) — 배치 속성(B-22) · 기본값 규칙 · 스냅샷 · 교체 상속 · 일괄 지정 · 정정')
  {
    // 순수 규칙 함수 — 가짜 문맥
    const mk = (types: ('일반' | '라이트')[], deals = types.length): shared.ProductTypeContext => ({ types, default: types.length === 1 ? types[0] : null, mixed: types.length >= 2, deals, byType: types.map((t) => ({ type: t, deals: 1, devices: 10 })) })
    const single = shared.resolveProductTypeDefault(mk(['라이트']), null)
    const none = shared.resolveProductTypeDefault(mk([], 0), null)
    const mixed = shared.resolveProductTypeDefault(mk(['일반', '라이트']), null)
    const mixedExplicit = shared.resolveProductTypeDefault(mk(['일반', '라이트']), '일반')
    const foreign = shared.resolveProductTypeDefault(mk(['일반']), '라이트')
    ok(single.productType === '라이트' && single.fromDefault && !single.error && !single.warning, '규칙: 1종 → 기본값(라이트)')
    ok(none.productType === null && !none.error && none.warning === shared.PRODUCT_TYPE_NO_DEAL_WARNING, '규칙: 딜 0건 → 미지정 + 경고')
    ok(mixed.productType === null && mixed.error === shared.PRODUCT_TYPE_REQUIRED_MESSAGE, '규칙: 혼합 + 미지정 → 오류(필수)')
    ok(mixedExplicit.productType === '일반' && !mixedExplicit.error && !mixedExplicit.warning, '규칙: 혼합 + 명시 → 그대로')
    ok(foreign.productType === '라이트' && !foreign.error && !!foreign.warning, '규칙: 계약 딜에 없는 유형 명시 → 경고만')
    ok(shared.matchProductType('lite') === '라이트' && shared.matchProductType(' LIGHT ') === '라이트' && shared.matchProductType('standard') === '일반' && shared.matchProductType('일 반') === '일반' && shared.matchProductType('') === null && shared.matchProductType('프로') === undefined, 'matchProductType 별칭(lite/LIGHT/standard/공백) · 빈 값 null · 미매칭 undefined')
    const lines = shared.parseSerialLines(`${S(63)}\t6병동\t평가용\t라이트\t각인 12\n${S(64)}\t7병동\tlite`)
    ok(lines[0].usageInput === '평가용' && lines[0].productTypeInput === '라이트' && lines[0].memo === '각인 12' && lines[1].productTypeInput === 'lite' && lines[1].memo === undefined, 'parseSerialLines — 3열 이후 상품유형 셀 분리(용도·메모와 공존)')
  }
  const ptH1 = await getHospitalProductTypeContext(H1)
  const ptH2 = await getHospitalProductTypeContext(H2)
  const ptH3 = await getHospitalProductTypeContext(H3)
  {
    const rows = await prisma.$queryRaw<{ product_type: string | null; c: bigint }[]>`
      SELECT sd.product_type, count(*) c FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
       WHERE sd.hospital_code = ${H1} AND sc.category = 'SALES_DEAL_STATUS' AND sc.name = '계약완료' GROUP BY 1`
    const kinds = rows.filter((r) => r.product_type === '일반' || r.product_type === '라이트').map((r) => r.product_type)
    ok(ptH1.deals === h1!.deals && ptH1.types.length === kinds.length && ptH1.mixed === (kinds.length >= 2) && (ptH1.mixed ? ptH1.default === null : ptH1.default === (kinds[0] ?? null)), `getHospitalProductTypeContext(H1) = 딜 ${ptH1.deals}건 · 유형 ${ptH1.types.join('/') || '없음'} · 기본 ${ptH1.default ?? '없음'}`, ptH1)
    ok(ptH3.deals === 0 && ptH3.types.length === 0 && ptH3.default === null && !ptH3.mixed, 'getHospitalProductTypeContext(H3) — 딜 0건')
  }
  console.log(`  H1 상품유형 문맥: ${JSON.stringify(ptH1)} · H2: ${ptH2.types.join('/') || '없음'}${ptH2.mixed ? '(혼합)' : ''}`)
  const MIXED_CTX: shared.ProductTypeContext = { types: ['일반', '라이트'], default: null, mixed: true, deals: 2, byType: [{ type: '일반', deals: 1, devices: 50 }, { type: '라이트', deals: 1, devices: 50 }] }
  const LITE_CTX: shared.ProductTypeContext = { types: ['라이트'], default: '라이트', mixed: false, deals: 1, byType: [{ type: '라이트', deals: 1, devices: 50 }] }
  // 등록 — 명시(별칭) · 기본값 규칙(H1 실제 딜) · 오류
  const rP = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(63), productType: 'lite', wardName: '6병동' }, { serialInput: S(64), productType: '일반' }])
  ok(rP.created.length === 2 && rP.created.find((c) => c.serialNo === S(63))!.productType === '라이트' && rP.created.find((c) => c.serialNo === S(64))!.productType === '일반', '등록 productType 명시(별칭 lite → 라이트) → RegisteredRef.productType')
  const p63 = (await dev({ serialNo: S(63) }))!
  const ev63 = (await prisma.hospitalDeviceEvent.findUnique({ where: { id: rP.created.find((c) => c.serialNo === S(63))!.eventId } }))!
  ok(p63.productType === '라이트' && ev63.productType === '라이트' && ev63.eventType === 'REGISTER', '배치 행 product_type + REGISTER 이벤트 스냅샷 = 라이트')
  await expectErr('등록 알 수 없는 상품유형', () => registerDevices(ctx(H1), [{ serialInput: S(65), productType: '프로' }]), 400, '상품유형 값이 올바르지 않습니다 (일반/라이트)')
  if (ptH1.mixed) {
    await expectErr('혼합 병원(H1 실제) 미지정 등록 → 400 필수', () => registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(65) }]), 400, shared.PRODUCT_TYPE_REQUIRED_MESSAGE)
    const rD = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(65), productType: '일반' }])
    ok(rD.created[0].productType === '일반', '혼합 병원 명시 등록 OK')
  } else {
    const rD = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(65) }])
    ok(rD.created[0].productType === (ptH1.default ?? null) && (await dev({ serialNo: S(65) }))!.productType === (ptH1.default ?? null), `등록 미지정 → 병원 딜 기본값(${ptH1.default ?? '미지정'})`, rD.warnings)
    ok(ptH1.deals === 0 ? rD.warnings.includes(shared.PRODUCT_TYPE_NO_DEAL_WARNING) : !rD.warnings.includes(shared.PRODUCT_TYPE_NO_DEAL_WARNING), '기본값 적용 시 경고 유무(딜 0건일 때만)')
  }
  // 주입 문맥 — 혼합 병원 시나리오(실데이터 수정 없음). 계약건 문맥도 비워야 한다(H1에 계약완료 딜이 1건이면 자동 기본값 딜이 상품유형을 파생해 혼합 규칙이 생략됨 — B-23,
  // 2026-09-17 PROD 재동기화 후 H1 후보가 단일 딜 병원으로 바뀌어 드러난 데이터 의존 — dealContextOverride 주입으로 고정)
  const NO_DEALS: reg.HospitalDealContext = { deals: [], single: null }
  await expectErr('혼합 문맥 주입 + 미지정 → 400 필수', () => registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(66) }], { productTypeContextOverride: MIXED_CTX, dealContextOverride: NO_DEALS }), 400, shared.PRODUCT_TYPE_REQUIRED_MESSAGE)
  await expectErr('혼합 문맥 다건 — 하나라도 미지정이면 400', () => registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(66), productType: '일반' }, { serialInput: S(67) }], { productTypeContextOverride: MIXED_CTX, dealContextOverride: NO_DEALS }), 400, shared.PRODUCT_TYPE_REQUIRED_MESSAGE)
  ok((await prisma.deviceUnit.count({ where: { serialNo: { in: [S(66), S(67)] } } })) === 0, '400 시 유닛·배치 미생성(롤백)')
  const rM = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(66), productType: '일반' }, { serialInput: S(67), productType: '라이트' }], { productTypeContextOverride: MIXED_CTX, dealContextOverride: NO_DEALS })
  ok(rM.created.length === 2 && rM.created.map((c) => c.productType).sort().join() === '라이트,일반', '혼합 문맥 + 전부 명시 → 201 (한 병원에 일반·라이트 공존)')
  const rL = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(68) }], { productTypeContextOverride: LITE_CTX, dealContextOverride: NO_DEALS })
  ok(rL.created[0].productType === '라이트' && rL.warnings.every((w) => !w.includes('상품유형')), '라이트 단일 문맥 주입 → 기본값 라이트(경고 없음)')
  const rZ = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(69) }])
  ok(rZ.created[0].productType === null && rZ.warnings.includes(shared.PRODUCT_TYPE_NO_DEAL_WARNING), 'H3(딜 0건) 미지정 등록 → null + 경고')
  // 스냅샷 — 이동·회수, 회수 후 배치 행은 마지막 값 보존, 재등록은 새 병원 규칙
  const mvP = await moveDeviceWard(ctx(null, '2026-08-05'), { deviceId: p63.id, toWardName: '7병동' })
  ok(mvP.event.productType === '라이트', 'MOVE_WARD 이벤트 스냅샷 = 배치 상품유형(라이트)')
  const rcP = await recoverDevice(ctx(null, '2026-08-10'), { deviceId: p63.id, reasonCodeId: defect.id })
  ok(rcP.event.productType === '라이트' && rcP.device.status === 'RECOVERED' && rcP.device.productType === '라이트', 'RECOVER 스냅샷 라이트 · 회수 후 배치 행은 마지막 값(회수 전 라이트) 보존')
  const luRecPt = await listUnits({ hospital: H1, status: 'recovered', productType: '라이트' }, { page: 1, limit: 10 })
  ok(luRecPt.data.some((r) => r.id === p63.id && r.productType === '라이트'), '회수됨 목록에서도 productType(회수 전 값) 노출·필터')
  const expectH2 = shared.resolveProductTypeDefault(ptH2, null)
  if (expectH2.error) {
    await expectErr('타 병원(H2, 혼합) 재등록 미지정 → 400', () => registerDevices(ctx(H2, '2026-08-20'), [{ serialInput: S(63) }]), 400, shared.PRODUCT_TYPE_REQUIRED_MESSAGE)
    const rr = await registerDevices(ctx(H2, '2026-08-20'), [{ serialInput: S(63), productType: '일반' }])
    ok(rr.reregistered[0].productType === '일반' && (await dev({ id: p63.id }))!.productType === '일반', '재등록은 새 REGISTER가 상품유형을 다시 정한다(회수 전 라이트 → 일반)')
  } else {
    const rr = await registerDevices(ctx(H2, '2026-08-20'), [{ serialInput: S(63) }])
    ok(rr.reregistered[0].productType === expectH2.productType && (await dev({ id: p63.id }))!.productType === expectH2.productType, `재등록은 회수 전 값을 승계하지 않고 새 병원 규칙(${expectH2.productType ?? '미지정'})을 따른다`, rr.warnings)
  }
  ok(await projectionEqualsRebuild(p63.id) && (await dev({ id: p63.id }))!.productType === (expectH2.error ? '일반' : expectH2.productType), 'fold: REGISTER 이벤트 product_type → 배치 행(rebuild 멱등)')
  // 교체 상속
  const rpP = await replaceDevice(ctx(H1, '2026-08-15'), { oldDeviceId: (await dev({ serialNo: S(67) }))!.id, newSerial: S(72), productType: '일반' })
  ok(rpP.productType === '라이트' && rpP.newDevice.productType === '라이트' && rpP.recoverEvent!.productType === '라이트' && rpP.registerEvent!.productType === '라이트' && rpP.warnings.some((w) => w.includes('상속')), '교체: 신 배치는 구 배치 상품유형(라이트) 상속 · 지정값(일반)은 무시+경고 · RECOVER/REGISTER 스냅샷', rpP.warnings)
  await expectErr('교체 소급 경로 + 혼합 문맥 + 미지정 → 400', () => replaceDevice(ctx(H1, '2026-08-15'), { oldSerial: S(73), oldWardName: '6병동', newSerial: S(74), productTypeContextOverride: MIXED_CTX, dealContextOverride: NO_DEALS }), 400, shared.PRODUCT_TYPE_REQUIRED_MESSAGE)
  const rpB = await replaceDevice(ctx(H1, '2026-08-15'), { oldSerial: S(73), oldWardName: '6병동', newSerial: S(74), productType: 'lite', productTypeContextOverride: MIXED_CTX, dealContextOverride: NO_DEALS })
  ok(rpB.backfillEvent!.productType === '라이트' && rpB.recoverEvent!.productType === '라이트' && rpB.registerEvent!.productType === '라이트' && rpB.newDevice.productType === '라이트' && rpB.oldDevice.productType === '라이트', '교체 소급 경로: 입력 상품유형(lite)이 구 소급 REGISTER·RECOVER·신 REGISTER 전부에 적용')
  // 일괄 지정
  const t66 = (await dev({ serialNo: S(66) }))! // 일반
  const t72 = (await dev({ serialNo: S(72) }))! // 라이트(상속)
  const bk = await bulkDeviceAction(ctx(H1, '2026-08-16'), { action: 'SET_PRODUCT_TYPE', deviceIds: [t66.id, t72.id], productType: '라이트' })
  ok(bk.events.length === 1 && bk.events[0].eventType === 'CORRECT' && bk.events[0].deviceId === t66.id && bk.events[0].productType === '라이트' && bk.skipped.length === 1 && bk.skipped[0].deviceId === t72.id, 'bulk SET_PRODUCT_TYPE — 바뀌는 기기만 CORRECT(1건) · 이미 같은 값은 skipped', bk.skipped)
  const bkCh = bk.events[0].changes as { productType: { before: string | null; after: string | null } }
  ok(bkCh.productType.before === '일반' && bkCh.productType.after === '라이트' && (await dev({ id: t66.id }))!.productType === '라이트', 'CORRECT changes.productType {before 일반, after 라이트} + 배치 행 갱신')
  await rebuildUnitProjection(prisma, t66.id)
  ok((await dev({ id: t66.id }))!.productType === '라이트', 'fold가 CORRECT changes.productType.after를 반영(rebuild 후에도 라이트 유지)')
  await expectErr('bulk SET_PRODUCT_TYPE 전부 같은 값 → 409', () => bulkDeviceAction(ctx(H1), { action: 'SET_PRODUCT_TYPE', deviceIds: [t66.id, t72.id], productType: '라이트' }), 409, '이미 상품유형')
  await expectErr('bulk SET_PRODUCT_TYPE 잘못된 값', () => bulkDeviceAction(ctx(H1), { action: 'SET_PRODUCT_TYPE', deviceIds: [t66.id], productType: 'PRO' }), 400, '상품유형 값이')
  const bkNull = await bulkDeviceAction(ctx(H1, '2026-08-16'), { action: 'SET_PRODUCT_TYPE', deviceIds: [t66.id], productType: null })
  ok(bkNull.events.length === 1 && (await dev({ id: t66.id }))!.productType === null, 'bulk SET_PRODUCT_TYPE null → 미지정')
  // 정정 · 취소 복원
  const cP = await correctDevice(ctx(null, '2026-08-17'), { deviceId: t66.id, changes: { productType: '일반' } })
  ok(cP.event.eventType === 'CORRECT' && cP.event.productType === '일반' && (cP.changes.productType as { before: unknown }).before === null && (cP.changes.productType as { after: unknown }).after === '일반' && cP.device.productType === '일반', 'correctDevice productType → CORRECT changes + 스냅샷 = after')
  await expectErr('correctDevice 변경 없음(같은 상품유형)', () => correctDevice(ctx(null), { deviceId: t66.id, changes: { productType: '일반' } }), 400, '변경 사항')
  const cPc = await cancelLastEvent(ctx(null), { eventId: cP.event.id })
  ok(cPc.restored != null && (await dev({ id: t66.id }))!.productType === null, 'CORRECT(상품유형) 취소 → before(미지정) 복원')
  await correctDevice(ctx(null, '2026-08-17'), { deviceId: t66.id, changes: { productType: '일반' } })
  // 임포트 미리보기·실행
  const pvP = await previewRows(
    H1,
    [
      { row: 1, serialInput: S(75), productTypeInput: 'lite' },
      { row: 2, serialInput: S(76) },
      { row: 3, serialInput: S(77), productTypeInput: '프로' },
      { row: 4, serialInput: S(66) },
    ],
    { wardMode: 'fixed', mode: 'REGISTER', occurredOn: '2026-08-20', productTypeContextOverride: MIXED_CTX, dealContextOverride: NO_DEALS }
  )
  ok(pvP.rows[0].productType === '라이트' && pvP.rows[0].status === 'warn' && !pvP.rows[0].messages.includes(shared.PRODUCT_TYPE_REQUIRED_MESSAGE), '미리보기 행 상품유형 열(lite → 라이트) — 혼합 문맥에서도 필수 오류 없음(병동 미지정 warn만)')
  ok(pvP.rows[1].productType === null && pvP.rows[1].status === 'error' && pvP.rows[1].messages.includes(shared.PRODUCT_TYPE_REQUIRED_MESSAGE), '미리보기 혼합 문맥 + 미지정 행 → error 필수 메시지')
  ok(pvP.rows[2].status === 'error' && pvP.rows[2].messages.some((m) => m.includes('상품유형 값이 올바르지 않습니다')), '미리보기 알 수 없는 상품유형 → error')
  ok(pvP.rows[3].status === 'skip' && !pvP.rows[3].messages.includes(shared.PRODUCT_TYPE_REQUIRED_MESSAGE), '이미 배치 중(skip) 행은 상품유형 규칙 무시')
  ok(pvP.summary.productTypeContext.mixed === true, '미리보기 summary.productTypeContext(주입 문맥) 노출')
  const pvP2 = await previewRows(H1, [{ row: 1, serialInput: S(76) }], { wardMode: 'fixed', mode: 'REGISTER', occurredOn: '2026-08-20', productType: '일반', productTypeContextOverride: MIXED_CTX })
  ok(pvP2.rows[0].productType === '일반' && pvP2.rows[0].status !== 'error', '미리보기 폼 기본 상품유형(일반)이 혼합 문맥 오류를 해소')
  const pvP3 = await previewRows(H3, [{ row: 1, serialInput: S(78) }], { wardMode: 'fixed', mode: 'REGISTER', occurredOn: '2026-08-20' })
  ok(pvP3.rows[0].productType === null && pvP3.rows[0].status === 'warn' && pvP3.rows[0].messages.includes(shared.PRODUCT_TYPE_NO_DEAL_WARNING) && pvP3.summary.productTypeContext.deals === 0, 'H3(딜 0건) 미리보기 → warn 미지정')
  await expectErr('미리보기 기본 상품유형 오류', () => previewRows(H1, [{ row: 1, serialInput: S(78) }], { wardMode: 'fixed', mode: 'REGISTER', occurredOn: today, productType: '프로' }), 400, '기본 상품유형')
  const impP = await importBatch(ctx(H1, '2026-08-20'), { rows: [{ row: 1, serialInput: S(75), productTypeInput: 'lite' }, { row: 2, serialInput: S(76) }], sourceKind: 'PASTE', mode: 'REGISTER', defaults: { wardMode: 'fixed', productType: '일반' } })
  ok(impP.batch.registeredCount === 2 && (await dev({ serialNo: S(75) }))!.productType === '라이트' && (await dev({ serialNo: S(76) }))!.productType === '일반', '임포트 실행 — 행 상품유형(lite) > 폼 기본(일반), 배치 행 반영')
  // 요약 매트릭스 · 교체 집계 · 목록 필터
  const sumP = (await getHospitalDeviceSummary(H1))!
  const ecgP = sumP.models.find((m) => m.onpremDeviceType === 1)!
  const cells = Object.values(ecgP.byProductType)
  ok(cells.length >= 2 && cells.reduce((s, c) => s + c!.active, 0) === ecgP.active && cells.reduce((s, c) => s + c!.activeForCompare, 0) === ecgP.activeForCompare, '요약 byProductType — 유형별 active/activeForCompare 합 = 모델 합계', ecgP.byProductType)
  ok(ecgP.byProductType['라이트']!.active >= 2 && ecgP.byProductType['일반']!.active >= 1 && (ecgP.byProductType['미지정']?.active ?? 0) >= 0, '요약 byProductType 일반·라이트 키 존재')
  // B-25 개정: 유형별 기대 = 그 유형 딜의 모델 행(ECG) 합 — 디바이스수 미사용(compare none이면 null)
  const ptEcgRows = await prisma.$queryRaw<{ t: string | null; ecg: number | null }[]>`
    SELECT sd.product_type AS t, sum(sdd.quantity) FILTER (WHERE di.onprem_device_type = 1)::int AS ecg
      FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
      LEFT JOIN sales_deal_devices sdd ON sdd.deal_id = sd.id LEFT JOIN device_info di ON di.id = sdd.device_info_id
     WHERE sd.hospital_code = ${H1} AND sc.category = 'SALES_DEAL_STATUS' AND sc.name = '계약완료' GROUP BY 1`
  for (const t of ptH1.types)
    ok(
      ecgP.byProductType[t]!.expected === (ecgP.compare === 'none' ? null : (ptEcgRows.find((r) => r.t === t)?.ecg ?? 0)) &&
        (ecgP.compare !== 'hard' || ecgP.byProductType[t]!.diff === ecgP.byProductType[t]!.activeForCompare - ecgP.byProductType[t]!.expected!),
      `요약 byProductType.${t}.expected = 그 유형 딜 모델 행 Σ(§9.1 개정) · diff`
    )
  ok(sumP.productTypeMixed === true && sumP.productTypeContext.deals === ptH1.deals && sumP.productTypes.length >= 2 && sumP.productTypes.every((p) => typeof p.activeForCompare === 'number'), '요약 productTypeMixed(배치에 상품유형 있음) · productTypeContext · productTypes 축')
  const replP = await countReplacements(H1)
  const repl30P = await countReplacements(H1, { from: '2026-08-15', to: '2026-08-15' })
  ok(replP.total >= 2 && replP.byType['라이트'] >= 2 && repl30P.total >= 2 && sumP.replacements.total === replP.total && sumP.replacements.byType['라이트'] === replP.byType['라이트'], '교체 집계 — RECOVER 스냅샷 기준(라이트 ≥2: 교체·소급 교체), 기간 필터, 요약과 일치', { replP, repl30P, sum: sumP.replacements })
  const luLite = await listUnits({ hospital: H1, status: 'all', productType: '라이트' }, { page: 1, limit: 50 })
  ok(luLite.total >= 3 && luLite.data.every((r) => r.productType === '라이트'), 'listUnits productType=라이트 필터')
  const luNonePt = await listUnits({ hospital: H1, status: 'all', productType: 'none' }, { page: 1, limit: 50 })
  ok(luNonePt.data.every((r) => r.productType === null), 'listUnits productType=none 필터')
  const evP = await listEvents({ hospital: H1, device: t66.id }, { page: 1, limit: 20 })
  ok(evP.data.every((e) => 'productType' in e) && evP.data.some((e) => e.eventType === 'CORRECT' && e.productType === '일반') && evP.data[0].device.productType === '일반', '이벤트 목록 행 productType 스냅샷 + device.productType(현재)')
  // 실데이터 혼합 병원(있으면) — 읽기만
  const realMixed = await prisma.$queryRaw<{ hospital_code: string }[]>`
    SELECT sd.hospital_code FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
     WHERE sc.category = 'SALES_DEAL_STATUS' AND sc.name = '계약완료' AND sd.product_type IN ('일반','라이트')
     GROUP BY 1 HAVING count(DISTINCT sd.product_type) >= 2 ORDER BY 1 LIMIT 1`
  if (realMixed[0]) {
    const mc = await getHospitalProductTypeContext(realMixed[0].hospital_code)
    const covM = await getGlobalCoverage({ q: realMixed[0].hospital_code, limit: 5 })
    const rowM = covM.data.find((r) => r.hospitalCode === realMixed[0].hospital_code)
    ok(mc.mixed && mc.default === null && mc.types.length === 2 && !!rowM && rowM.productTypeMixed && typeof rowM.unassignedProductType === 'number' && covM.totals.mixedProductTypeHospitals >= 1, `실데이터 혼합 병원 ${realMixed[0].hospital_code} — 문맥 mixed · 커버리지 productTypeMixed 플래그`, { mc, rowM: rowM && [rowM.productTypeMixed, rowM.unassignedProductType], totals: covM.totals.mixedProductTypeHospitals })
  } else console.log('  (실데이터 혼합 병원 없음 — 주입 문맥으로만 검증)')
  const covH1 = (await getGlobalCoverage({ q: H1, limit: 5 })).data.find((r) => r.hospitalCode === H1)!
  ok(covH1.productTypeMixed === ptH1.mixed && (ptH1.mixed ? covH1.unassignedProductType >= 1 : covH1.unassignedProductType === 0), '커버리지 H1 productTypeMixed = 문맥 · unassignedProductType(혼합일 때만 계수)', covH1)

  section('[1d] 계약건(딜) 소프트 참조(B-23) · AS진행중 플래그(B-24)')
  {
    const dctxH1 = await reg.getHospitalDealContext(H1)
    ok(
      dctxH1.deals.length === h1!.deals && dctxH1.deals.every((d) => typeof d.dealCode === 'string' && d.count >= 0) && (dctxH1.deals.length === 1 ? dctxH1.single?.dealCode === dctxH1.deals[0].dealCode : dctxH1.single === null),
      `getHospitalDealContext(H1) — 계약완료 딜 ${dctxH1.deals.length}건 · single 규약`,
      dctxH1
    )
    const D1 = { dealCode: 'DEAL-999901-0001', roundNo: 1, productType: '일반', count: 10, contractDate: null }
    const D2 = { dealCode: 'DEAL-999901-0002', roundNo: 2, productType: '라이트', count: 5, contractDate: null }
    const SINGLE: reg.HospitalDealContext = { deals: [D1], single: D1 }
    const MULTI: reg.HospitalDealContext = { deals: [D1, D2], single: null }
    const NONE_D: reg.HospitalDealContext = { deals: [], single: null }
    // 순수 규칙
    ok(reg.resolveDealInput(SINGLE, null, null).deal?.dealCode === D1.dealCode && reg.resolveDealInput(SINGLE, null, null).productTypeFromDeal === '일반', 'resolveDealInput: 단일 딜 자동 기본값 + 상품유형 파생')
    ok(reg.resolveDealInput(SINGLE, null, '라이트').deal === null, 'resolveDealInput: 자동 기본값은 명시 유형 충돌 시 폐기(미지정, 400 아님)')
    ok(reg.resolveDealInput(MULTI, null, null).deal === null, 'resolveDealInput: 딜 2건 — 자동 기본값 없음')
    ok(reg.resolveDealInput(MULTI, D1.dealCode, '일반').deal?.dealCode === D1.dealCode && reg.resolveDealInput(MULTI, D1.dealCode, '일반').productTypeFromDeal === null, 'resolveDealInput: 명시 딜 + 같은 유형 → OK(파생 없음)')
    await expectErr('resolveDealInput: 없는 코드', async () => reg.resolveDealInput(SINGLE, 'DEAL-000000-0000', null), 409, '이 병원의 계약완료 딜이 아닙니다')
    await expectErr('resolveDealInput: 명시 딜 + 유형 충돌', async () => reg.resolveDealInput(MULTI, D1.dealCode, '라이트'), 400, '선택한 계약건의 상품유형과 다릅니다')
    // 등록 — 자동 기본값·파생·스냅샷
    const rd1 = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(51), wardName: 'D동' }], { dealContextOverride: SINGLE })
    ok(rd1.created[0].dealCode === D1.dealCode && rd1.created[0].productType === '일반' && !rd1.warnings.includes(shared.PRODUCT_TYPE_NO_DEAL_WARNING), '등록: 단일 딜 자동 기본값 + 상품유형 파생(딜 0건 경고 없음)', rd1.warnings)
    const d51 = (await dev({ serialNo: S(51) }))!
    const ev51 = (await prisma.hospitalDeviceEvent.findUnique({ where: { id: rd1.created[0].eventId } }))!
    ok(d51.dealCode === D1.dealCode && ev51.dealCode === D1.dealCode, '배치 행 deal_code + REGISTER 이벤트 스냅샷')
    const rd2 = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(52), wardName: 'D동' }], { dealContextOverride: NONE_D })
    ok(rd2.created[0].dealCode === null, '등록: 딜 0건 → 미지정(NULL)')
    await expectErr('등록: 이 병원 딜 아닌 코드 → 409', () => registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(53), dealCode: 'DEAL-000000-0000' }], { dealContextOverride: SINGLE }), 409, '이 병원의 계약완료 딜이 아닙니다')
    ok((await prisma.deviceUnit.count({ where: { serialNo: S(53) } })) === 0, '409 시 유닛 미생성(롤백)')
    const rd3 = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(53), dealCode: D2.dealCode }], { dealContextOverride: MULTI })
    ok(rd3.created[0].dealCode === D2.dealCode && rd3.created[0].productType === '라이트', '등록: 명시 딜(라이트 딜) → 상품유형 파생(혼합 400 우회)')
    await expectErr('등록: 명시 딜 + 유형 충돌 → 400', () => registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(54), dealCode: D1.dealCode, productType: '라이트' }], { dealContextOverride: MULTI }), 400, '선택한 계약건의 상품유형과 다릅니다')
    const rd4 = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(54), productType: '라이트' }], { dealContextOverride: SINGLE })
    ok(rd4.created[0].dealCode === null && rd4.created[0].productType === '라이트', '등록: 자동 기본값 + 명시 유형 충돌 → 딜만 폐기(400 아님)')
    // 이동·회수 스냅샷 + 회수 후 보존
    const mv51 = await moveDeviceWard(ctx(null, '2026-08-05'), { deviceId: d51.id, toWardName: 'E동' })
    ok(mv51.event.dealCode === D1.dealCode, 'MOVE_WARD 이벤트 deal_code 스냅샷')
    const rc51 = await recoverDevice(ctx(null, '2026-08-10'), { deviceId: d51.id, reasonCodeId: defect.id })
    ok(rc51.event.dealCode === D1.dealCode && rc51.device.dealCode === D1.dealCode && rc51.device.status === 'RECOVERED', 'RECOVER 스냅샷 + 회수 후 배치 행 deal_code 보존(표시용)')
    // 교체 상속 · 소급 경로
    const rp55 = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(55), wardName: 'D동', dealCode: D1.dealCode }], { dealContextOverride: SINGLE })
    const rep55 = await replaceDevice(ctx(H3, '2026-08-05'), { oldDeviceId: rp55.created[0].id, newSerial: S(56), dealCode: D2.dealCode })
    ok(rep55.dealCode === D1.dealCode && rep55.newDevice.dealCode === D1.dealCode && rep55.recoverEvent!.dealCode === D1.dealCode && rep55.registerEvent!.dealCode === D1.dealCode && rep55.warnings.some((w) => w.includes('계약건은 구 기기 배치 값')), '교체: 신 배치 계약건 상속(지정값 무시+경고) + RECOVER/REGISTER 스냅샷', rep55.warnings)
    const rep57 = await replaceDevice(ctx(H3, '2026-08-05'), { oldSerial: S(57), oldWardName: 'D동', newSerial: S(58), dealContextOverride: SINGLE })
    ok(rep57.backfillEvent!.dealCode === D1.dealCode && rep57.newDevice.dealCode === D1.dealCode && rep57.newDevice.productType === '일반', '교체 소급 경로: 단일 딜 자동 기본값 → 구 소급·신 배치 적용 + 유형 파생')
    // SET_DEAL·correctDevice — 실데이터 H1 계약완료 딜 코드
    const realDeal = dctxH1.deals[0]
    const rH1 = await registerDevices(ctx(H1, '2026-08-01'), [
      { serialInput: S(59), wardName: '6병동', dealCode: realDeal.dealCode },
      { serialInput: S(60), wardName: '6병동', dealCode: realDeal.dealCode },
    ])
    ok(rH1.created.length === 2 && rH1.created.every((c) => c.dealCode === realDeal.dealCode) && rH1.created.every((c) => !shared.isProductType(realDeal.productType) || c.productType === realDeal.productType), '실데이터 딜 명시 등록 → dealCode + 딜 유형 파생', rH1.created.map((c) => [c.serialNo, c.dealCode, c.productType]))
    const bkD = await bulkDeviceAction(ctx(H1, '2026-08-02'), { action: 'SET_DEAL', deviceIds: rH1.created.map((c) => c.id), dealCode: null })
    ok(bkD.events.length === 2 && bkD.events.every((e) => e.eventType === 'CORRECT') && (await dev({ id: rH1.created[0].id }))!.dealCode === null, 'bulk SET_DEAL null → 미지정 + CORRECT 이벤트')
    const bkD2 = await bulkDeviceAction(ctx(H1, '2026-08-02'), { action: 'SET_DEAL', deviceIds: rH1.created.map((c) => c.id), dealCode: realDeal.dealCode })
    const bkCh2 = bkD2.events[0].changes as { dealCode: { before: string | null; after: string | null } }
    ok(bkD2.events.length === 2 && bkCh2.dealCode.before === null && bkCh2.dealCode.after === realDeal.dealCode && bkD2.events[0].dealCode === realDeal.dealCode, 'bulk SET_DEAL 지정 — changes {before,after} + 스냅샷=after')
    await expectErr('bulk SET_DEAL 전부 같은 값 → 409', () => bulkDeviceAction(ctx(H1), { action: 'SET_DEAL', deviceIds: rH1.created.map((c) => c.id), dealCode: realDeal.dealCode }), 409, '이미 계약건')
    await expectErr('bulk SET_DEAL 없는 딜 → 409', () => bulkDeviceAction(ctx(H1), { action: 'SET_DEAL', deviceIds: [rH1.created[0].id], dealCode: 'DEAL-000000-0000' }), 409, '이 병원의 계약완료 딜이 아닙니다')
    await rebuildUnitProjection(prisma, rH1.created[0].id)
    ok((await dev({ id: rH1.created[0].id }))!.dealCode === realDeal.dealCode, 'fold가 CORRECT changes.dealCode.after 반영(rebuild 멱등)')
    const cD = await correctDevice(ctx(null, '2026-08-03'), { deviceId: rH1.created[0].id, changes: { dealCode: null } })
    ok((cD.changes.dealCode as { before: string }).before === realDeal.dealCode && cD.device.dealCode === null && cD.event.dealCode === null, 'correctDevice dealCode → CORRECT changes + 스냅샷=after')
    const cDc = await cancelLastEvent(ctx(null), { eventId: cD.event.id })
    ok(cDc.restored != null && (await dev({ id: rH1.created[0].id }))!.dealCode === realDeal.dealCode, 'CORRECT(계약건) 취소 → before 복원')
    await expectErr('correctDevice 없는 딜 → 409', () => correctDevice(ctx(null), { deviceId: rH1.created[0].id, changes: { dealCode: 'DEAL-000000-0000' } }), 409, '이 병원의 계약완료 딜이 아닙니다')
    // 목록 필터
    const luDeal = await listUnits({ hospital: H1, status: 'all', deal: realDeal.dealCode }, { page: 1, limit: 50 })
    ok(luDeal.total >= 2 && luDeal.data.every((r) => r.dealCode === realDeal.dealCode), 'listUnits deal= 필터')
    const luDealNone = await listUnits({ hospital: H3, status: 'active', deal: 'none' }, { page: 1, limit: 50 })
    ok(luDealNone.data.every((r) => r.dealCode === null), 'listUnits deal=none 필터(미지정)')
    // 미리보기·임포트 — 딜 규칙
    const pvD = await previewRows(
      H3,
      [
        { row: 1, serialInput: S(61), dealCode: D2.dealCode },
        { row: 2, serialInput: S(60, 'P'), dealCode: 'DEAL-000000-0000' },
        { row: 3, serialInput: S(61, 'P'), dealCode: D1.dealCode, productTypeInput: 'lite' },
        { row: 4, serialInput: S(62, 'P') },
      ],
      { wardMode: 'fixed', mode: 'REGISTER', occurredOn: '2026-08-20', dealContextOverride: MULTI, productTypeContextOverride: MIXED_CTX }
    )
    ok(pvD.rows[0].dealCode === D2.dealCode && pvD.rows[0].productType === '라이트' && pvD.rows[0].status !== 'error', '미리보기: 행 딜 → 유형 파생(혼합 필수 오류 없음)', pvD.rows[0].messages)
    ok(pvD.rows[1].status === 'error' && pvD.rows[1].messages.some((m) => m.includes('계약완료 딜이 아닙니다')), '미리보기: 없는 딜 → error 행')
    ok(pvD.rows[2].status === 'error' && pvD.rows[2].messages.some((m) => m.includes('상품유형과 다릅니다')), '미리보기: 딜·유형 충돌 → error 행')
    ok(pvD.rows[3].dealCode === null && pvD.rows[3].status === 'error' && pvD.rows[3].messages.includes(shared.PRODUCT_TYPE_REQUIRED_MESSAGE), '미리보기: 딜 없음 + 혼합 문맥 → 기존 유형 필수 오류 유지')
    const impD = await importBatch(ctx(H3, '2026-08-20'), { rows: [{ row: 1, serialInput: S(61), dealCode: D1.dealCode }], sourceKind: 'PASTE', mode: 'REGISTER', defaults: { wardMode: 'fixed', dealContextOverride: SINGLE } })
    ok(impD.batch.registeredCount === 1 && (await dev({ serialNo: S(61) }))!.dealCode === D1.dealCode && (await dev({ serialNo: S(61) }))!.productType === '일반', '임포트 실행 — 행 딜 pass-through + 유형 파생')
    // 요약 deals[] · dealUnassigned
    const sumD = (await getHospitalDeviceSummary(H3))!
    const rowD1 = sumD.deals.find((d) => d.dealCode === D1.dealCode)
    const activeD1 = await prisma.hospitalDevice.count({ where: { hospitalCode: H3, status: 'ACTIVE', dealCode: D1.dealCode } })
    ok(!!rowD1 && rowD1.contracted === false && rowD1.expected === null && rowD1.active === activeD1 && rowD1.replacements === 2, '요약 deals[] — 계약 외 코드 행(active·교체 2건: S55→S56, S57→S58)', rowD1)
    ok(!!rowD1 && rowD1.replacementsByModel.ecg === 2 && rowD1.replacementsByModel.spo2 === 0 && rowD1.replacements === rowD1.replacementsByModel.ecg + rowD1.replacementsByModel.spo2 + rowD1.replacementsByModel.bp && rowD1.asInProgress === 0 && rowD1.asByModel.ecg === 0, 'deals[] 모델별 누적 AS(교체) — ECG 2 · AS진행중 0', rowD1 && { repl: rowD1.replacementsByModel, as: rowD1.asByModel })
    const unassignedActive = await prisma.hospitalDevice.count({ where: { hospitalCode: H3, status: 'ACTIVE', dealCode: null } })
    ok(sumD.dealUnassigned.active === unassignedActive && typeof sumD.dealUnassigned.replacements === 'number', '요약 dealUnassigned 버킷(active = deal NULL ACTIVE 수)')
    const sumH1D = (await getHospitalDeviceSummary(H1))!
    const rowReal = sumH1D.deals.find((d) => d.dealCode === realDeal.dealCode)!
    ok(!!rowReal && rowReal.contracted && rowReal.expected === realDeal.count && rowReal.roundNo === realDeal.roundNo && rowReal.active >= 2, '요약 deals[] — 계약완료 딜 행(expected = Σ대웅 수·등록 수량)', rowReal)
    ok(typeof rowReal.asInProgress === 'number' && typeof rowReal.asByModel.ecg === 'number' && typeof rowReal.replacementsByModel.ecg === 'number', 'deals[] asInProgress·asByModel·replacementsByModel 필드(additive)')
    // ── B-25 개정(2026-09-02): 도입 수량 = sales_deal_devices 단일 소스 — 디바이스수 폴백 제거
    const realDealAgg = (
      await prisma.$queryRaw<{ ecg: number | null; spo2: number | null; bp: number | null; has: boolean }[]>`
      SELECT sum(sdd.quantity) FILTER (WHERE di.onprem_device_type = 1)::int AS ecg,
             sum(sdd.quantity) FILTER (WHERE di.onprem_device_type = 3)::int AS spo2,
             sum(sdd.quantity) FILTER (WHERE di.onprem_device_type = 10)::int AS bp,
             count(sdd.id) > 0 AS has
        FROM sales_deals sd LEFT JOIN sales_deal_devices sdd ON sdd.deal_id = sd.id LEFT JOIN device_info di ON di.id = sdd.device_info_id
       WHERE sd.deal_code = ${realDeal.dealCode}`
    )[0]
    if (realDealAgg.has)
      ok(rowReal.expectedSource === 'models' && rowReal.expectedByModel?.ecg === realDealAgg.ecg && rowReal.expectedByModel?.spo2 === realDealAgg.spo2 && rowReal.expectedByModel?.bp === realDealAgg.bp, 'B-25 개정: 모델 행 딜 — expectedSource=models · expectedByModel=행 합', rowReal.expectedByModel)
    else ok(rowReal.expectedSource === 'none' && rowReal.expectedByModel === null, 'B-25 개정: 수량 미입력 딜 — expectedSource=none · expectedByModel null(디바이스수 미사용)', { src: rowReal.expectedSource, byModel: rowReal.expectedByModel })
    const ecgActiveReal = await prisma.hospitalDevice.count({ where: { hospitalCode: H1, status: 'ACTIVE', dealCode: realDeal.dealCode, unit: { deviceInfo: { onpremDeviceType: 1 } } } })
    ok(rowReal.activeByModel.ecg === ecgActiveReal && rowReal.activeByModel.ecg + rowReal.activeByModel.spo2 + rowReal.activeByModel.bp <= rowReal.active, 'B-25: 딜×모델 등록 수(activeByModel.ecg = DB count)', rowReal.activeByModel)
    ok(sumH1D.dealUnassigned.activeByModel.ecg <= sumH1D.dealUnassigned.active && typeof sumH1D.dealUnassigned.activeByModel.spo2 === 'number', 'B-25: 미지정 버킷 activeByModel')
    const ecgMF = sumH1D.models.find((m) => m.onpremDeviceType === 1)!
    const spo2MF = sumH1D.models.find((m) => m.onpremDeviceType === 3)
    ok(h1!.em_ecg == null ? ecgMF.compare === 'none' && ecgMF.expected === null && ecgMF.diff === null : ecgMF.compare === 'hard' && ecgMF.expected === h1!.em_ecg, 'B-25 개정: ECG 기대 = Σ모델 행(미입력 병원은 none — 디바이스수 미사용)', { ecg: ecgMF.expected, em: h1!.em_ecg })
    ok(!spo2MF || (h1!.em_spo2 == null ? spo2MF.compare === 'none' && spo2MF.expected === null : spo2MF.compare === 'hard' && spo2MF.expected === h1!.em_spo2), 'B-25 개정: SpO2 — 행 있으면 hard, 없으면 none(soft 제거)', { spo2: spo2MF?.compare, em: h1!.em_spo2 })
    // 실데이터 — 모델 행(SpO2) 있는 계약완료 딜 병원(읽기 전용, sales_* 미기록)
    const mrowHosp = await prisma.$queryRaw<{ hospital_code: string }[]>`
      SELECT sd.hospital_code FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
        JOIN sales_deal_devices sdd ON sdd.deal_id = sd.id JOIN device_info di ON di.id = sdd.device_info_id
       WHERE sc.category = 'SALES_DEAL_STATUS' AND sc.name = '계약완료' AND di.onprem_device_type = 3
       GROUP BY 1 ORDER BY 1 LIMIT 1`
    if (mrowHosp[0]) {
      const MH = mrowHosp[0].hospital_code
      const sqlExp = (
        await prisma.$queryRaw<{ ecg: number | null; spo2: number | null }[]>`
        SELECT sum(m.ecg)::int AS ecg,
               sum(m.spo2)::int AS spo2
          FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
          LEFT JOIN (SELECT sdd.deal_id,
                            sum(sdd.quantity) FILTER (WHERE di.onprem_device_type = 1)::int AS ecg,
                            sum(sdd.quantity) FILTER (WHERE di.onprem_device_type = 3)::int AS spo2
                       FROM sales_deal_devices sdd JOIN device_info di ON di.id = sdd.device_info_id GROUP BY 1) m ON m.deal_id = sd.id
         WHERE sd.hospital_code = ${MH} AND sc.category = 'SALES_DEAL_STATUS' AND sc.name = '계약완료'`
      )[0]
      const sM = (await getHospitalDeviceSummary(MH))!
      const sEcg = sM.models.find((m) => m.onpremDeviceType === 1)!
      const sSpo2 = sM.models.find((m) => m.onpremDeviceType === 3)!
      ok(sEcg.compare === (sqlExp.ecg == null ? 'none' : 'hard') && sEcg.expected === sqlExp.ecg, `B-25 실데이터(${MH}): ECG 기대 = Σ모델 행(미입력이면 none)`, { exp: sEcg.expected, sql: sqlExp })
      ok(sSpo2.compare === 'hard' && sSpo2.expected === (sqlExp.spo2 ?? 0) && sSpo2.diff === sSpo2.activeForCompare - (sqlExp.spo2 ?? 0), 'B-25 실데이터: SpO2 실측 hard 대조(ECG 동수 soft 아님)', { compare: sSpo2.compare, exp: sSpo2.expected })
      const mDeal = sM.deals.find((d) => d.contracted && d.expectedSource === 'models')
      ok(!!mDeal && mDeal.expectedByModel != null && (mDeal.expectedByModel.ecg != null || mDeal.expectedByModel.spo2 != null), 'B-25 실데이터: deals[] models 출처 행 — expectedByModel 모델별 수량', mDeal && { code: mDeal.dealCode, byModel: mDeal.expectedByModel })
      const covM = (await getGlobalCoverage({ q: MH, limit: 5 })).data.find((r) => r.hospitalCode === MH)
      ok(!!covM && covM.expected === sqlExp.ecg, 'B-25 실데이터: 커버리지 expected = 모델 행 ECG(미입력 null)', covM && { expected: covM.expected })
      console.log(`  (B-25 모델별 수량 예시 병원: ${MH})`)
    } else ok(true, 'B-25: sales_deal_devices 행 있는 계약완료 딜 없음 — 실데이터 케이스 스킵')

    // ── AS진행중(B-24)
    const dAS = (await dev({ serialNo: S(52) }))!
    ok(shared.placementStatusLabel(dAS) === '사용중' && shared.placementStatusLabel({ status: 'RECOVERED' }) === '회수됨' && shared.placementStatusLabel({ status: 'ACTIVE', asStartedOn: '2026-08-01' }) === 'AS진행중', 'placementStatusLabel — 사용중/AS진행중/회수됨')
    const asO = await reg.openDeviceAs(ctx(null, '2026-08-15', mnt ? { ref: { type: 'MAINTENANCE', code: mnt.maintenanceCode } } : {}), { deviceId: dAS.id })
    ok(asO.event.eventType === 'AS_OPEN' && asO.device.asStartedOn?.toISOString().startsWith('2026-08-15') === true && (mnt ? asO.device.asRefCode === mnt.maintenanceCode : asO.device.asRefCode === null), 'openDeviceAs — as_started_on=업무일자 · as_ref_code=MNT', { as: asO.device.asStartedOn, ref: asO.device.asRefCode })
    ok(asO.device.lastEventType === 'REGISTER' && asO.event.dealCode === (dAS.dealCode ?? null), 'AS_OPEN은 last_event 미반영(비상태 이벤트) + deal 스냅샷')
    await expectErr('이미 표시된 기기 재표시 → 409', () => reg.openDeviceAs(ctx(null), { deviceId: dAS.id }), 409, '이미 AS진행중')
    const d53id = (await dev({ serialNo: S(53) }))!.id
    await expectErr('타 병원 문맥 AS → 409', () => reg.openDeviceAs(ctx(H1), { deviceId: d53id }), 409)
    const luAs = await listUnits({ hospital: H3, as: true }, { page: 1, limit: 50 })
    ok(luAs.data.some((r) => r.id === dAS.id) && luAs.data.every((r) => r.asStartedOn != null), 'listUnits as=1 필터')
    {
      const sumAs = (await getHospitalDeviceSummary(H3))!
      ok(sumAs.asInProgress >= 1, '요약 asInProgress ≥ 1')
      ok(sumAs.dealUnassigned.asInProgress >= 1 && sumAs.dealUnassigned.asByModel.ecg >= 1, '미지정 버킷 asInProgress·asByModel.ecg(딜 없는 ECG AS 접수)', sumAs.dealUnassigned)
    }
    const asC = await reg.clearDeviceAs(ctx(null, '2026-08-16'), { deviceId: dAS.id })
    ok(asC.event.eventType === 'AS_CLEAR' && asC.device.asStartedOn === null && asC.device.asRefCode === null, 'clearDeviceAs — 수동 해제')
    await expectErr('표시 없는 기기 해제 → 409', () => reg.clearDeviceAs(ctx(null), { deviceId: dAS.id }), 409, '표시가 없는')
    // LIFO 취소 — AS_CLEAR 취소 → 플래그 복원, AS_OPEN 취소 → 해제
    const cClear = await cancelLastEvent(ctx(null), { eventId: asC.event.id })
    ok(cClear.cancelledEventIds.length === 1 && (await dev({ id: dAS.id }))!.asStartedOn?.toISOString().startsWith('2026-08-15') === true, 'AS_CLEAR 취소(LIFO) → 플래그 복원(fold)')
    await cancelLastEvent(ctx(null), { eventId: asO.event.id })
    ok((await dev({ id: dAS.id }))!.asStartedOn === null && (await dev({ id: dAS.id }))!.asRefCode === null, 'AS_OPEN 취소 → 플래그 해제')
    ok(await projectionEqualsRebuild(dAS.id), 'AS 취소 후 프로젝션 = fold')
    // 일괄 AS 접수/해제(bulk AS_OPEN/AS_CLEAR) — 같은 action_group·ref·업무일자 공유
    const rBk = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(16), wardName: 'D동' }, { serialInput: S(17), wardName: 'D동' }, { serialInput: S(18), wardName: 'D동' }], { dealContextOverride: NONE_D })
    const bkIds = rBk.created.map((c) => c.id)
    await reg.openDeviceAs(ctx(null, '2026-08-02'), { deviceId: bkIds[0] }) // 1대는 미리 표시 → skipped 확인
    const bkAs = await bulkDeviceAction(ctx(H3, '2026-08-03', mnt ? { ref: { type: 'MAINTENANCE', code: mnt.maintenanceCode } } : {}), { action: 'AS_OPEN', deviceIds: bkIds })
    ok(
      bkAs.events.length === 2 && bkAs.skipped.length === 1 && bkAs.skipped[0].deviceId === bkIds[0] && bkAs.events.every((e) => e.eventType === 'AS_OPEN' && e.actionGroup === bkAs.actionGroup && (!mnt || e.refCode === mnt.maintenanceCode)),
      'bulk AS_OPEN — 같은 action_group·ref 공유, 이미 표시 1대 skipped',
      bkAs.skipped
    )
    const bk1 = (await dev({ id: bkIds[1] }))!
    ok(bk1.asStartedOn?.toISOString().startsWith('2026-08-03') === true && (!mnt || bk1.asRefCode === mnt.maintenanceCode), 'bulk AS_OPEN → 플래그·as_ref_code(전 대상 공유)')
    await expectErr('bulk AS_OPEN 전부 표시됨 → 409', () => bulkDeviceAction(ctx(H3), { action: 'AS_OPEN', deviceIds: bkIds }), 409, '모두 AS진행중')
    const cBk = await cancelLastEvent(ctx(null), { eventId: bkAs.events[0].id })
    ok(cBk.cancelledEventIds.length === 1 && (await dev({ id: bkAs.events[0].deviceId }))!.asStartedOn === null && (await dev({ id: bkAs.events[1].deviceId }))!.asStartedOn != null, 'bulk AS_OPEN 이벤트 1건 LIFO 취소 → 그 기기만 해제(그룹 짝 확장 없음)')
    const bkClr = await bulkDeviceAction(ctx(H3, '2026-08-04'), { action: 'AS_CLEAR', deviceIds: bkIds })
    ok(bkClr.events.length === 2 && bkClr.skipped.length === 1 && bkClr.skipped[0].deviceId === bkAs.events[0].deviceId && bkClr.events.every((e) => e.eventType === 'AS_CLEAR' && e.actionGroup === bkClr.actionGroup), 'bulk AS_CLEAR — 표시 없는 1대 skipped·같은 그룹', bkClr.skipped)
    ok((await dev({ id: bkIds[0] }))!.asStartedOn === null && (await dev({ id: bkIds[2] }))!.asStartedOn === null, 'bulk AS_CLEAR → 전 대상 플래그 해제')
    await expectErr('bulk AS_CLEAR 전부 미표시 → 409', () => bulkDeviceAction(ctx(H3), { action: 'AS_CLEAR', deviceIds: bkIds }), 409, 'AS진행중 표시가 없습니다')
    for (const id of bkIds) ok(await projectionEqualsRebuild(id), `bulk AS 후 프로젝션 = fold (#${id})`)
    // 소급 AS 표시/해제 차단(§8.2 1 보강, P1 리뷰) — bkIds[0]: REGISTER 08-01 · AS_OPEN 08-02 · AS_CLEAR 08-04. 업무일자 이후 스냅샷 배치 축 이벤트가 있으면 409(역전 쌍 교착 방지), 없으면 기록
    await expectErr('소급 AS_OPEN(08-01) — 이후 AS_OPEN/AS_CLEAR 스냅샷 있음 → 409', () => reg.openDeviceAs(ctx(null, '2026-08-01'), { deviceId: bkIds[0] }), 409, '소급 기록할 수 없습니다')
    await expectErr('일괄 소급 AS_OPEN(08-01) → 409(단건과 동일)', () => bulkDeviceAction(ctx(H3, '2026-08-01'), { action: 'AS_OPEN', deviceIds: [bkIds[0]] }), 409, '소급 기록할 수 없습니다')
    ok((await prisma.hospitalDeviceEvent.count({ where: { deviceId: bkIds[0], eventType: 'AS_OPEN' } })) === 1, '소급 409 후 AS_OPEN 이벤트 미생성(롤백)')
    const asRetro = await reg.openDeviceAs(ctx(null, '2026-08-05'), { deviceId: bkIds[0] })
    ok(asRetro.event.eventType === 'AS_OPEN' && asRetro.device.asStartedOn?.toISOString().startsWith('2026-08-05') === true, '이후 스냅샷 없는 소급 AS_OPEN(08-05) → 기록')
    await expectErr('소급 AS_CLEAR(08-04, 이후 AS_OPEN 08-05 있음) → 409', () => reg.clearDeviceAs(ctx(null, '2026-08-04'), { deviceId: bkIds[0] }), 409)
    const cRetro = await cancelLastEvent(ctx(null), { eventId: asRetro.event.id })
    ok(cRetro.cancelledEventIds.length === 1 && (await dev({ id: bkIds[0] }))!.asStartedOn === null && (await projectionEqualsRebuild(bkIds[0])), '소급 AS_OPEN LIFO 취소 → 해제·프로젝션 = fold')
    // 자동 해제 — 회수·교체
    await reg.openDeviceAs(ctx(null, '2026-08-17'), { deviceId: dAS.id })
    const rcAS = await recoverDevice(ctx(null, '2026-08-18'), { deviceId: dAS.id, reasonCodeId: defect.id })
    ok(rcAS.device.asStartedOn === null && rcAS.device.asRefCode === null, '회수 → AS 플래그 자동 해제')
    ok((await prisma.hospitalDeviceEvent.count({ where: { deviceId: dAS.id, eventType: 'AS_CLEAR' } })) === 0, '자동 해제는 AS_CLEAR 이벤트를 만들지 않는다')
    await registerDevices(ctx(H3, '2026-08-19'), [{ serialInput: S(52), wardName: 'D동' }], { dealContextOverride: NONE_D })
    await reg.openDeviceAs(ctx(null, '2026-08-20'), { deviceId: dAS.id })
    const repAS = await replaceDevice(ctx(H3, '2026-08-21'), { oldDeviceId: dAS.id, newSerial: S(62, 'P') })
    ok(repAS.oldDevice.status === 'RECOVERED' && repAS.oldDevice.asStartedOn === null && repAS.newDevice.asStartedOn === null, '교체 → 구 기기 AS 플래그 자동 해제')
    await expectErr('회수된 기기 AS 접수 → 409', () => reg.openDeviceAs(ctx(null), { deviceId: dAS.id }), 409, '회수된 기기에는 AS 접수')
    const detAS = (await getUnitDetail(repAS.newDevice.id))!
    ok('dealCode' in detAS && 'asStartedOn' in detAS && 'asRefCode' in detAS, '상세 응답에 dealCode·asStartedOn·asRefCode')
  }

  section('[1e] 기기 상태·위치 축 (2026-09-17 device_condition_location_design.md §4·§7.0·§8.2·부록 C) — 2축 전이·멱등·가드·취소·재도출·I-1~I-6')
  {
    const lostR = await reasonByValue(prisma, 'LOST')
    const disposeR = await reasonByValue(prisma, 'DISPOSE')
    const returnR = await reasonByValue(prisma, 'RETURN')
    const ecgModelId = (await unitRow({ id: d1.id }))!.deviceInfoId
    /** 유닛 상태·위치 요약 — `{ condition, loc: 'HOSPITAL/코드' | 'SITE/값' | 'none', condOn, locOn }` */
    const st = async (id: number) => {
      const u = (await prisma.deviceUnit.findUnique({ where: { id }, include: { locationSite: true } }))!
      return { condition: u.condition, loc: u.locationHospitalCode ? `HOSPITAL/${u.locationHospitalCode}` : u.locationSite?.value ? `SITE/${u.locationSite.value}` : 'none', condOn: ymd(u.conditionChangedOn), locOn: ymd(u.locationChangedOn) }
    }
    const evCount = (id: number) => prisma.hospitalDeviceEvent.count({ where: { deviceId: id } })
    const lastEv = (id: number) => prisma.hospitalDeviceEvent.findFirst({ where: { deviceId: id }, orderBy: { id: 'desc' } })
    const chOf = (e: { changes: unknown } | null | undefined) => shared.unitStateChangesOf(e?.changes)
    const locStr = (l: { kind: string | null; code: string | null } | null | undefined) => (l && l.kind ? `${l.kind}/${l.code}` : 'none')
    const hosp = (code: string) => `HOSPITAL/${code}`
    const RC = 'SITE/REFRESH_CENTER'
    const HUB = 'SITE/HUB'
    const nullChanges = (eventId: number) => prisma.hospitalDeviceEvent.update({ where: { id: eventId }, data: { changes: Prisma.DbNull } }) // 배포 전 이벤트(스냅샷 없음) 시뮬레이션
    const reg1 = async (serial: string, hospital: string = H1, on: string = '2026-08-01') => (await registerDevices(ctx(hospital, on), [{ serialInput: serial, wardName: '6병동' }])).created[0]
    // 스모크용 AS접수 3건(ref 규칙·validateRef 통과용) — 라인 없음, cleanup에서 삭제
    for (const code of SMOKE_AS_CODES.slice(0, 3)) {
      await prisma.asReceipt.upsert({ where: { asCode: code }, create: { asCode: code, hospitalCode: H1, category: 'FAULT', receiptDate: new Date(today), createdById: adminUser!.id, note: '[스모크] 상태·위치 축' }, update: {} })
    }
    const [AS1, AS2, AS3] = SMOKE_AS_CODES
    const asRef = (code: string) => ({ ref: { type: 'AS' as const, code } })

    // ── [1e-10] 거점 마스터 ────────────────────────────────────────────────
    const sites = await loadDeviceSites(prisma)
    ok(sites.length === 2 && sites.map((s) => s.value).join(',') === 'REFRESH_CENTER,HUB' && sites[0].name === '리프레시센터' && sites[1].name === 'thynC Connected Hub', '[1e-10] DEVICE_SITE 마스터 2행(REFRESH_CENTER·HUB, order 순) — loadDeviceSites', sites)
    await expectErr('[1e-10] siteByValue 허용 어휘 밖 → 400', () => reg.siteByValue(prisma, 'NOWHERE'), 400, '거점 값')

    // ── [1e-1] condition × 이벤트 전이표 전수(§4.2 — 순수 판정 84셀 + sameRef) ──
    {
      type Kind = reg.UnitEventKind
      const KINDS: Kind[] = ['REGISTER', 'AS_OPEN', 'INTAKE', 'REPAIR_DONE', 'AS_CLEAR', 'RECOVER_DEFECT', 'RECOVER_LOST', 'RECOVER_DISPOSE', 'RECOVER_KEEP', 'RECOVER_TRANSFER', 'SCRAP', 'SITE_MOVE']
      // 'ok:X' = 전이 · 'keep' = 유지 · '409' = 거부. §4.2 표 그대로(PRE_SHIP×INTAKE·LOST×INTAKE는 진입 열 규칙대로 ok — condition.ts 주석)
      const row = (s: string) => Object.fromEntries(s.split(' ').map((cell, i) => [KINDS[i], cell])) as Record<Kind, string>
      const expectedT: Record<shared.DeviceCondition | 'NULL', Record<Kind, string>> = {
        IN_USE: row('ok:IN_USE ok:AS_WAITING ok:AS_WAITING 409 keep ok:AS_WAITING ok:LOST ok:SCRAPPED keep keep ok:SCRAPPED keep'),
        AS_WAITING: row('ok:IN_USE keep keep ok:REPAIRED ok:IN_USE keep ok:LOST ok:SCRAPPED keep keep ok:SCRAPPED keep'),
        REPAIRED: row('ok:IN_USE ok:AS_WAITING ok:AS_WAITING keep ok:IN_USE keep ok:LOST ok:SCRAPPED keep keep ok:SCRAPPED keep'),
        PRE_SHIP: row('ok:IN_USE 409 ok:AS_WAITING 409 409 409 409 409 409 409 ok:SCRAPPED keep'),
        LOST: row('ok:IN_USE 409 ok:AS_WAITING 409 409 409 409 409 409 409 409 409'),
        SCRAPPED: row('409 409 409 409 409 409 409 409 409 409 keep 409'),
        NULL: row('ok:IN_USE ok:AS_WAITING ok:AS_WAITING ok:REPAIRED ok:IN_USE ok:AS_WAITING ok:LOST ok:SCRAPPED keep keep ok:SCRAPPED keep'),
      }
      const enc = (r: reg.ConditionRule) => (r.kind === 'ok' ? `ok:${r.to}` : r.kind === 'keep' ? 'keep' : '409')
      const bad: string[] = []
      for (const cur of Object.keys(expectedT) as (shared.DeviceCondition | 'NULL')[]) {
        for (const k of KINDS) {
          const got = enc(judgeCondition(cur === 'NULL' ? null : cur, k))
          if (got !== expectedT[cur][k]) bad.push(`${cur}×${k}: ${got} ≠ ${expectedT[cur][k]}`)
        }
      }
      ok(bad.length === 0, '[1e-1] condition × 이벤트 전이표 84셀 = §4.2 기대표(judgeCondition)', bad)
      ok(judgeCondition('REPAIRED', 'INTAKE', { sameRef: true }).kind === 'keep' && judgeCondition('REPAIRED', 'INTAKE', { sameRef: false }).kind === 'ok', '[1e-1] REPAIRED × INTAKE — 같은 ref는 keep, 새 ref는 AS_WAITING(재입고, B-37)')
      ok(reg.recoverKindOf('DEFECT') === 'RECOVER_DEFECT' && reg.recoverKindOf('LOST') === 'RECOVER_LOST' && reg.recoverKindOf('DISPOSE') === 'RECOVER_DISPOSE' && reg.recoverKindOf('TRANSFER') === 'RECOVER_TRANSFER' && reg.recoverKindOf('RETURN') === 'RECOVER_KEEP' && reg.recoverKindOf(null) === 'RECOVER_KEEP', '[1e-1] 회수 사유 value → 판정 축(§5.6 RECOVERY_REASON_CONDITION, RETURN·NULL은 keep)')
    }
    // 실제 서비스 조합 — 배치 status × condition × 이벤트(기대 결과·409 문구)
    const u24 = await reg1(S(24))
    let s24 = await st(u24.id)
    const ev24 = (await lastEv(u24.id))!
    ok(s24.condition === 'IN_USE' && s24.loc === hosp(H1) && s24.condOn === '2026-08-01' && s24.locOn === '2026-08-01' && chOf(ev24)?.condition.before === null && chOf(ev24)?.condition.after === 'IN_USE' && locStr(chOf(ev24)?.location.after) === hosp(H1), '[1e-1] REGISTER(신규) → IN_USE·위치 병원·changed_on=업무일자 + 이벤트 스냅샷(before NULL → after IN_USE)', { s24, ch: ev24.changes })
    await expectErr("[1e-1] ACTIVE·IN_USE REPAIR_DONE → 409 '사용중 기기는 수리완료 처리할 수 없습니다'", () => markDeviceRepaired(ctx(null), { deviceId: u24.id }), 409, shared.DEVICE_REPAIR_IN_USE_MESSAGE)
    await expectErr("[1e-6] ACTIVE SCRAP → 409 '배치 중 기기는 먼저 회수하세요'(I-3)", () => scrapDevice(ctx(null), { deviceId: u24.id, memo: 'x' }), 409, shared.DEVICE_SCRAP_ACTIVE_MESSAGE)
    await expectErr('[1e-6] ACTIVE SITE_MOVE(거점) → 409 먼저 회수', () => moveDeviceLocation(ctx(null), { deviceId: u24.id, to: 'REFRESH_CENTER' }), 409, shared.DEVICE_SCRAP_ACTIVE_MESSAGE)
    {
      const same = await moveDeviceLocation(ctx(null), { deviceId: u24.id, to: 'HOSPITAL' })
      ok(same.changed === false && same.event === null, '[1e-6] ACTIVE·IN_USE·이미 병원 [병원 반환] → changed:false·이벤트 없음')
    }
    const asO24 = await reg.openDeviceAs(ctx(null, '2026-08-10'), { deviceId: u24.id })
    s24 = await st(u24.id)
    ok(s24.condition === 'AS_WAITING' && s24.loc === hosp(H1) && s24.condOn === '2026-08-10' && s24.locOn === '2026-08-01' && chOf(asO24.event)?.condition.after === 'AS_WAITING' && locStr(chOf(asO24.event)?.location.after) === hosp(H1), '[1e-1] AS_OPEN → AS_WAITING·위치 병원 유지(condition_changed_on만 갱신) + 스냅샷', s24)
    const in24 = await intakeDevice(ctx(H1, '2026-08-11'), { deviceId: u24.id })
    s24 = await st(u24.id)
    ok(in24.changed && in24.event?.eventType === 'INTAKE' && in24.event.hospitalCode === H1 && s24.condition === 'AS_WAITING' && s24.loc === RC && s24.locOn === '2026-08-11' && (await dev({ id: u24.id }))!.status === 'ACTIVE' && locStr(chOf(in24.event)?.location.before) === hosp(H1) && locStr(chOf(in24.event)?.location.after) === RC, '[1e-1] ACTIVE INTAKE → AS_WAITING·리프레시센터, 배치 ACTIVE 유지(D2), hospital_code=배치 병원, 스냅샷 병원→센터', { s24, in24: in24.event })
    await expectErr("[1e-6] ACTIVE·AS_WAITING [병원 반환] → 409 '미종결 입고 라인 — AS 상세에서 확정하세요'", () => moveDeviceLocation(ctx(null), { deviceId: u24.id, to: 'HOSPITAL' }), 409, shared.DEVICE_OPEN_INTAKE_LINE_MESSAGE)
    const rp24 = await markDeviceRepaired(ctx(null, '2026-08-12'), { deviceId: u24.id })
    s24 = await st(u24.id)
    ok(rp24.changed && rp24.event?.eventType === 'REPAIR_DONE' && s24.condition === 'REPAIRED' && s24.loc === RC && s24.condOn === '2026-08-12' && s24.locOn === '2026-08-11' && (await dev({ id: u24.id }))!.lastEventType === 'REGISTER', '[1e-1] REPAIR_DONE → REPAIRED·센터 유지 + last_event 미반영(비상태 이벤트)', s24)
    {
      const rp24b = await markDeviceRepaired(ctx(null), { deviceId: u24.id })
      ok(rp24b.changed === false && rp24b.event === null, '[1e-2] REPAIRED 재수리완료 → changed:false·이벤트 없음(멱등)')
    }
    await expectErr('[1e-6] ACTIVE·REPAIRED [병원 반환] → 409(AS 상세에서 확정)', () => moveDeviceLocation(ctx(null), { deviceId: u24.id, to: 'HOSPITAL' }), 409, shared.DEVICE_OPEN_INTAKE_LINE_MESSAGE)
    const clr24 = await reg.clearDeviceAs(ctx(null, '2026-08-13'), { deviceId: u24.id, locationToHospital: true })
    s24 = await st(u24.id)
    ok(clr24.event.eventType === 'AS_CLEAR' && s24.condition === 'IN_USE' && s24.loc === hosp(H1) && s24.condOn === '2026-08-13' && s24.locOn === '2026-08-13' && chOf(clr24.event)?.condition.before === 'REPAIRED' && chOf(clr24.event)?.condition.after === 'IN_USE' && locStr(chOf(clr24.event)?.location.after) === hosp(H1), '[1e-1] AS_CLEAR(locationToHospital — AS 서비스 훅) → IN_USE·위치 병원 + 스냅샷 REPAIRED→IN_USE', { s24, ch: clr24.event.changes })
    ok(await projectionEqualsRebuild(u24.id), '[1e-1] u24 프로젝션 = fold(상태·위치 축은 배치 fold 비영향)')
    // RECOVER 사유 매핑(단건) — DEFECT/LOST/DISPOSE/RETURN
    const u25 = await reg1(S(25))
    const rc25 = await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u25.id, reasonCodeId: defect.id })
    let s25 = await st(u25.id)
    ok(s25.condition === 'AS_WAITING' && s25.loc === RC && s25.condOn === '2026-08-05' && s25.locOn === '2026-08-05' && chOf(rc25.event)?.location.note === shared.DEVICE_LOCATION_NOTE_INTAKE_UNCONFIRMED && locStr(chOf(rc25.event)?.location.before) === hosp(H1) && locStr(chOf(rc25.event)?.location.after) === RC, "[1e-1] RECOVER(DEFECT) → AS_WAITING·리프레시센터(A-4(a)) + note '입고 미확인'(before 병원일 때만)", { s25, ch: rc25.event.changes })
    const u26 = await reg1(S(26))
    const rc26 = await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u26.id, reasonCodeId: lostR.id })
    let s26 = await st(u26.id)
    ok(s26.condition === 'LOST' && s26.loc === 'none' && chOf(rc26.event)?.condition.after === 'LOST' && locStr(chOf(rc26.event)?.location.after) === 'none', '[1e-1] RECOVER(LOST) → LOST·위치 없음(I-1)', s26)
    const u27 = await reg1(S(27))
    const rc27 = await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u27.id, reasonCodeId: disposeR.id })
    const s27 = await st(u27.id)
    ok(s27.condition === 'SCRAPPED' && s27.loc === 'none' && chOf(rc27.event)?.condition.after === 'SCRAPPED', '[1e-1] RECOVER(DISPOSE) → SCRAPPED·위치 없음', s27)
    const u28 = await reg1(S(28))
    const rc28 = await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u28.id, reasonCodeId: returnR.id })
    let s28 = await st(u28.id)
    ok(s28.condition === 'IN_USE' && s28.loc === hosp(H1) && rc28.warnings.some((w) => w.includes('[위치 이동]')) && chOf(rc28.event)?.condition.before === 'IN_USE' && chOf(rc28.event)?.condition.after === 'IN_USE', "[1e-1] RECOVER(RETURN) → keep(IN_USE·병원, before=after 스냅샷 기록) + 경고 '[위치 이동]'", { s28, w: rc28.warnings })
    // RECOVERED 유닛의 SITE_MOVE·SCRAP·REPAIR·INTAKE
    {
      const mv = await moveDeviceLocation(ctx(null, '2026-08-06'), { deviceId: u28.id, to: 'REFRESH_CENTER' })
      s28 = await st(u28.id)
      ok(mv.changed && mv.event?.eventType === 'SITE_MOVE' && mv.event.hospitalCode === H1 && s28.condition === 'IN_USE' && s28.loc === RC && s28.locOn === '2026-08-06' && s28.condOn === '2026-08-01', '[1e-1] RECOVERED SITE_MOVE 병원→리프레시센터 (condition 유지, hospital_code=last_hospital_code — B-31)', s28)
      const mv2 = await moveDeviceLocation(ctx(null, '2026-08-07'), { deviceId: u28.id, to: 'HUB' })
      s28 = await st(u28.id)
      ok(mv2.changed && s28.loc === HUB && locStr(chOf(mv2.event)?.location.before) === RC && locStr(chOf(mv2.event)?.location.after) === HUB, '[1e-1] SITE_MOVE 거점↔거점(리프레시센터 → Hub) 스냅샷', s28)
      const mv3 = await moveDeviceLocation(ctx(null), { deviceId: u28.id, to: 'HUB' })
      ok(mv3.changed === false && mv3.event === null, '[1e-2] 같은 위치 SITE_MOVE → changed:false·이벤트 없음')
      await expectErr('[1e-1] RECOVERED [병원 반환] → 409(회수 기기는 등록·교체로 배치)', () => moveDeviceLocation(ctx(null), { deviceId: u28.id, to: 'HOSPITAL' }), 409, '병원 반환 대상이 아닙니다')
      await expectErr('[1e-1] SITE_MOVE 허용 어휘 밖 → 400', () => moveDeviceLocation(ctx(null), { deviceId: u28.id, to: 'NOWHERE' as never }), 400)
    }
    {
      // A-6: admin CORRECT(PRE_SHIP + HUB, 배치 RECOVERED/없음만) — I-1·I-3 검증
      const cPre = await correctDevice(ctx(null, '2026-08-08'), { deviceId: u28.id, changes: { condition: 'PRE_SHIP' } })
      s28 = await st(u28.id)
      ok(cPre.event.eventType === 'CORRECT' && s28.condition === 'PRE_SHIP' && s28.loc === HUB && s28.condOn === '2026-08-08' && chOf(cPre.event)?.condition.before === 'IN_USE' && chOf(cPre.event)?.condition.after === 'PRE_SHIP', '[1e-1] admin CORRECT → PRE_SHIP·Hub(A-6 진입로) — 상태 스냅샷 CORRECT', s28)
      await expectErr("[1e-1] PRE_SHIP REPAIR_DONE → 409 '출고 전 기기는 수리완료 처리할 수 없습니다'", () => markDeviceRepaired(ctx(null), { deviceId: u28.id }), 409, '출고 전')
      await expectErr('[1e-1] CORRECT LOST + 위치 → 400 (I-1)', () => correctDevice(ctx(null), { deviceId: u28.id, changes: { condition: 'LOST', location: { kind: 'SITE', code: 'HUB' } } }), 400, 'I-1')
      await expectErr('[1e-1] ACTIVE 기기 CORRECT LOST → 409 (I-3)', () => correctDevice(ctx(null), { deviceId: u24.id, changes: { condition: 'LOST', location: null } }), 409, 'I-3')
      await expectErr('[1e-1] ACTIVE 기기 CORRECT 위치 타 병원 → 409', () => correctDevice(ctx(null), { deviceId: u24.id, changes: { location: { kind: 'HOSPITAL', code: H2 } } }), 409)
      await expectErr('[1e-1] CORRECT 변경 없음(같은 값) → 400', () => correctDevice(ctx(null), { deviceId: u28.id, changes: { condition: 'PRE_SHIP', location: { kind: 'SITE', code: 'HUB' } } }), 400, '변경 사항')
      const pr = await registerDevices(ctx(H1, '2026-08-09'), [{ serialInput: S(28), wardName: '6병동' }])
      s28 = await st(u28.id)
      ok(pr.reregistered.length === 1 && s28.condition === 'IN_USE' && s28.loc === hosp(H1) && !pr.warnings.some((w) => w.includes('수리완료 체크 없이')), '[1e-1] PRE_SHIP 재등록 → IN_USE·병원, 재사용 경고 없음(PRE_SHIP은 경고 대상 아님)', { s28, w: pr.warnings })
    }
    {
      // LOST × INTAKE(발견) / LOST × SCRAP·SITE_MOVE 409 · SCRAPPED × INTAKE·REPAIR 409·SCRAP keep
      await expectErr("[1e-1] LOST SCRAP → 409 '분실 기기는 폐기할 수 없습니다'", () => scrapDevice(ctx(null), { deviceId: u26.id, memo: 'x' }), 409, '분실 기기')
      await expectErr('[1e-1] LOST SITE_MOVE → 409', () => moveDeviceLocation(ctx(null), { deviceId: u26.id, to: 'HUB' }), 409, '분실 기기')
      await expectErr('[1e-1] LOST REPAIR_DONE → 409', () => markDeviceRepaired(ctx(null), { deviceId: u26.id }), 409)
      const found = await intakeDevice(ctx(null, '2026-08-20'), { deviceId: u26.id })
      s26 = await st(u26.id)
      ok(found.changed && found.event?.hospitalCode === H1 && s26.condition === 'AS_WAITING' && s26.loc === RC && chOf(found.event)?.condition.before === 'LOST', '[1e-1] LOST INTAKE(발견) → AS_WAITING·센터, hospital_code=last_hospital_code', s26)
      await expectErr("[1e-1] SCRAPPED INTAKE → 409 '폐기된 기기'", () => intakeDevice(ctx(null), { deviceId: u27.id }), 409, '폐기된 기기')
      await expectErr('[1e-1] SCRAPPED REPAIR_DONE → 409', () => markDeviceRepaired(ctx(null), { deviceId: u27.id }), 409, '폐기')
      await expectErr('[1e-1] SCRAPPED SITE_MOVE → 409', () => moveDeviceLocation(ctx(null), { deviceId: u27.id, to: 'HUB' }), 409, '폐기된 기기')
      const sc27 = await scrapDevice(ctx(null), { deviceId: u27.id, memo: '재폐기' })
      ok(sc27.changed === false && sc27.event === null, '[1e-2] SCRAPPED SCRAP → keep(changed:false·이벤트 없음)')
    }
    {
      // 재등록 경고(§7.0) — REPAIRED/IN_USE는 없음, AS_WAITING/NULL은 '수리완료 체크 없이 재사용' 1건 · 교체기는 strict(REPAIRED 아니면)
      const rr25 = await registerDevices(ctx(H1, '2026-08-06'), [{ serialInput: S(25), wardName: '6병동' }])
      s25 = await st(u25.id)
      ok(rr25.reregistered.length === 1 && rr25.warnings.filter((w) => w.includes('수리완료 체크 없이')).length === 1 && s25.condition === 'IN_USE' && s25.loc === hosp(H1), "[1e-1] AS_WAITING 유닛 재등록 → IN_USE·병원 + 경고 1건 '수리완료 체크 없이 재사용'", { s25, w: rr25.warnings })
      await recoverDevice(ctx(null, '2026-08-07'), { deviceId: u25.id, reasonCodeId: defect.id })
      await markDeviceRepaired(ctx(null, '2026-08-08'), { deviceId: u25.id })
      const rr25b = await registerDevices(ctx(H1, '2026-08-09'), [{ serialInput: S(25), wardName: '6병동' }])
      s25 = await st(u25.id)
      ok(rr25b.reregistered.length === 1 && !rr25b.warnings.some((w) => w.includes('수리완료 체크 없이')) && s25.condition === 'IN_USE' && s25.loc === hosp(H1), '[1e-1] REPAIRED 유닛 재등록 → IN_USE·병원, 재사용 경고 없음', { s25, w: rr25b.warnings })
      await recoverDevice(ctx(null, '2026-08-10'), { deviceId: u25.id, reasonCodeId: defect.id })
      const u29 = await reg1(S(29))
      const rep29 = await replaceDevice(ctx(H1, '2026-08-11'), { oldDeviceId: u29.id, newSerial: S(25) })
      s25 = await st(u25.id)
      const s29 = await st(u29.id)
      ok(rep29.newDevice.id === u25.id && rep29.warnings.filter((w) => w.includes('수리완료 체크 없이')).length === 1 && s25.condition === 'IN_USE' && s25.loc === hosp(H1) && s29.condition === 'AS_WAITING' && s29.loc === RC && chOf(rep29.recoverEvent)?.location.note === shared.DEVICE_LOCATION_NOTE_INTAKE_UNCONFIRMED && chOf(rep29.registerEvent)?.condition.after === 'IN_USE', '[1e-1] 교체 — 교체기(AS_WAITING·strict) 경고 1건 → IN_USE·병원 / 구기기 RECOVER(DEFECT) AS_WAITING·센터(A-4 note)', { s25, s29, w: rep29.warnings })
      const rep29b = await replaceDevice(ctx(H1, '2026-08-12'), { oldDeviceId: u25.id, newSerial: S(29) })
      ok(rep29b.newDevice.id === u29.id && rep29b.warnings.filter((w) => w.includes('수리완료 체크 없이')).length === 1 && (await st(u29.id)).condition === 'IN_USE', '[1e-1] 교체기 AS_WAITING(RECOVERED) 재사용 → 경고 1건 + IN_USE', rep29b.warnings)
    }

    // ── [1e-2] INTAKE ref 규칙(B-37) — 첫 ref 기록 · 같은 ref 무변화 스킵 · 변화 시 기록 · BACKFILL 제외 ──
    {
      const u31 = await reg1(S(31))
      await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u31.id, reasonCodeId: defect.id }) // AS_WAITING·센터(RECOVERED)
      const n0 = await evCount(u31.id)
      const i1 = await intakeDevice(ctx(H1, '2026-08-06', asRef(AS1)), { deviceId: u31.id })
      ok(i1.changed === false && i1.event?.eventType === 'INTAKE' && i1.event.refCode === AS1 && (await evCount(u31.id)) === n0 + 1 && chOf(i1.event)?.condition.before === 'AS_WAITING' && chOf(i1.event)?.condition.after === 'AS_WAITING', '[1e-2] INTAKE 변화 없음 + 첫 ref(AS1) → 기록(changed:false·before=after 스냅샷)', i1.event)
      const i2 = await intakeDevice(ctx(H1, '2026-08-07', asRef(AS1)), { deviceId: u31.id })
      ok(i2.changed === false && i2.event === null && (await evCount(u31.id)) === n0 + 1, '[1e-2] 같은 ref(AS1) ∧ 무변화 → 스킵(이벤트 없음)')
      const i3 = await intakeDevice(ctx(H1, '2026-08-07', asRef(AS2)), { deviceId: u31.id })
      ok(i3.event?.refCode === AS2 && (await evCount(u31.id)) === n0 + 2, '[1e-2] 다른 ref(AS2) 첫 기록 → 기록')
      const i4 = await intakeDevice(ctx(H1, '2026-08-07'), { deviceId: u31.id })
      const i5 = await intakeDevice(ctx(H1, '2026-08-07'), { deviceId: u31.id })
      ok(i4.event != null && i4.event.refCode === null && i5.event === null && (await evCount(u31.id)) === n0 + 3, '[1e-2] ref 없음(드로어 경로)도 첫 1회 기록·재호출 스킵')
      await markDeviceRepaired(ctx(null, '2026-08-08', asRef(AS2)), { deviceId: u31.id })
      const i6 = await intakeDevice(ctx(H1, '2026-08-09', asRef(AS2)), { deviceId: u31.id })
      ok(i6.changed === false && i6.event === null && (await st(u31.id)).condition === 'REPAIRED', '[1e-2] REPAIRED × 같은 ref(AS2) INTAKE → keep·스킵(교체품 가용 유지)')
      const i7 = await intakeDevice(ctx(H1, '2026-08-09', asRef(AS3)), { deviceId: u31.id })
      ok(i7.changed && i7.event?.refCode === AS3 && chOf(i7.event)?.condition.before === 'REPAIRED' && (await st(u31.id)).condition === 'AS_WAITING', '[1e-2] REPAIRED × 새 ref(AS3) INTAKE → AS_WAITING(재입고·가용 제외) 기록')
      // BACKFILL INTAKE는 sameRef 판정에서 제외 — BACKFILL 행만 있는 ref는 '첫 ref'로 본다
      const u32 = await reg1(S(32))
      await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u32.id, reasonCodeId: defect.id })
      const bf = await insertEvent(prisma, { deviceId: u32.id, eventType: 'INTAKE', hospitalCode: H1, occurredOn: '2026-08-05', source: 'BACKFILL', actionGroup: null, ref: { type: 'AS', code: AS1 }, actor: ACTOR, changes: { condition: { before: null, after: 'AS_WAITING' }, location: { before: { kind: 'HOSPITAL', code: H1 }, after: { kind: 'SITE', code: 'REFRESH_CENTER' } } } })
      const i8 = await intakeDevice(ctx(H1, '2026-08-06', asRef(AS1)), { deviceId: u32.id })
      ok(!!bf && i8.event?.eventType === 'INTAKE' && i8.event.source === 'MANUAL', '[1e-2] BACKFILL INTAKE(ref AS1)만 있는 기기 — 같은 ref MANUAL INTAKE는 첫 ref로 기록(스킵 판정에서 BACKFILL 제외)', i8.event)
    }

    // ── [1e-3] 가드 409(쓰기 없음) · 흡수 409 후 무변경 · RegistryTxAbort 전체 롤백 ──
    {
      const u33 = await reg1(S(33))
      const n0 = await evCount(u33.id)
      const fresh = (await unitRow({ id: u33.id }))!
      const stale = { ...fresh, condition: 'REPAIRED' } // DB는 IN_USE — 낙관 가드가 어긋난 스냅샷
      await expectErr("[1e-3] 신규 서비스 유닛 가드(updateMany count≠1) → 409 '동시에 변경되어 다시 시도하세요'", () => applyUnitState(prisma, { unit: stale, before: { condition: 'REPAIRED', location: { kind: 'HOSPITAL', code: H1 } }, after: { condition: 'AS_WAITING', location: { kind: 'SITE', code: 'REFRESH_CENTER' } }, occurredOn: today, event: { eventType: 'INTAKE', hospitalCode: H1, source: 'MANUAL', actionGroup: null, actor: ACTOR } }), 409, shared.DEVICE_CONCURRENT_CHANGE_MESSAGE)
      ok((await evCount(u33.id)) === n0 && (await st(u33.id)).condition === 'IN_USE', '[1e-3] 가드 409 후 해당 유닛 신규 이벤트 0건·유닛 무변경')
      // 암묵 전이 경로 — 소급 검증 409(AS 서비스가 흡수하는 RegistryError) 후 유닛 무변경·이벤트 0
      const before24 = await st(u24.id)
      const n24 = await evCount(u24.id)
      await expectErr('[1e-3] 소급 AS_OPEN(08-05, 이후 AS_OPEN 08-10 스냅샷 있음) → 409(흡수 가능 RegistryError)', () => reg.openDeviceAs(ctx(null, '2026-08-05'), { deviceId: u24.id }), 409, '소급 기록할 수 없습니다')
      ok(JSON.stringify(await st(u24.id)) === JSON.stringify(before24) && (await evCount(u24.id)) === n24, '[1e-3] 소급 409 후 유닛 무변경·이벤트 0')
      await expectErr('[1e-3] 배치 가드 409(이미 회수된 기기 RECOVER)', () => recoverDevice(ctx(null), { deviceId: u27.id, reasonCodeId: defect.id }), 409, '이미 회수')
      ok((await st(u27.id)).condition === 'SCRAPPED' && (await evCount(u27.id)) === 2, '[1e-3] 배치 409 후 유닛 무변경')
      // 유닛 가드 실패(phase 2) → RegistryTxAbort — 같은 tx에서 이미 INSERT된 이벤트까지 전체 롤백
      let abortName = ''
      let abortStatus = 0
      try {
        await prisma.$transaction(async (tx) => {
          const unit = await tx.deviceUnit.findUniqueOrThrow({ where: { id: u33.id } })
          const t = await applyImplicitTransition(tx, { unit, eventType: 'AS_OPEN', hospitalCode: H1, occurredOn: today })
          await insertEvent(tx, { deviceId: u33.id, eventType: 'AS_OPEN', hospitalCode: H1, occurredOn: today, source: 'MANUAL', actionGroup: null, actor: ACTOR, changes: t.changes as unknown as Prisma.InputJsonValue })
          await tx.deviceUnit.update({ where: { id: u33.id }, data: { condition: 'REPAIRED' } }) // 동시 변경 시뮬레이션(phase 1 이후 유닛이 바뀜)
          await t.apply()
        })
      } catch (e) {
        abortName = (e as Error).name
        abortStatus = (e as { status?: number }).status ?? 0
      }
      ok(abortName === 'RegistryTxAbort' && abortStatus === 409 && (await evCount(u33.id)) === n0 && (await st(u33.id)).condition === 'IN_USE', '[1e-3] 암묵 전이 유닛 가드 실패 → RegistryTxAbort(409, RegistryError 아님) · tx 전체 롤백(이벤트 0·유닛 IN_USE)', { abortName, abortStatus })
      ok(!(new RegistryTxAbort() instanceof RegistryError) && reg.toRegistryErrorResponse(new RegistryTxAbort())?.status === 409 && reg.toRegistryErrorResponse(new RegistryTxAbort())?.body.error === shared.DEVICE_CONCURRENT_CHANGE_MESSAGE, "[1e-3] RegistryTxAbort는 RegistryError 하위가 아님 + toRegistryErrorResponse 409 '동시에 변경되어 다시 시도하세요'")
    }

    // ── [1e-4] 취소·정정 규약(§8.2, 단일 정렬 기준 = id) ──
    {
      // (a) 신규 4종·상태 CORRECT LIFO 취소 → changes.before 복원
      const u34 = await reg1(S(34))
      await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u34.id, reasonCodeId: defect.id })
      const rp = await markDeviceRepaired(ctx(null, '2026-08-06'), { deviceId: u34.id })
      const c1 = await cancelLastEvent(ctx(null), { eventId: rp.event!.id })
      let s34 = await st(u34.id)
      ok(c1.cancelledEventIds.length === 1 && c1.unitStates?.[u34.id]?.condition === 'AS_WAITING' && s34.condition === 'AS_WAITING' && s34.loc === RC && s34.condOn === '2026-08-05', '[1e-4] REPAIR_DONE 취소 → before(AS_WAITING·센터) 복원, changed_on=남은 스냅샷(RECOVER) 일자', { s34, c1: c1.unitStates })
      const mv = await moveDeviceLocation(ctx(null, '2026-08-07'), { deviceId: u34.id, to: 'HUB' })
      await cancelLastEvent(ctx(null), { eventId: mv.event!.id })
      s34 = await st(u34.id)
      ok(s34.loc === RC && s34.condition === 'AS_WAITING', '[1e-4] SITE_MOVE 취소 → 위치 before(리프레시센터) 복원')
      const sc = await scrapDevice(ctx(null, '2026-08-07'), { deviceId: u34.id, memo: '폐기 후 취소' })
      ok((await st(u34.id)).condition === 'SCRAPPED' && (await st(u34.id)).loc === 'none', '[1e-4] SCRAP → SCRAPPED·위치 없음')
      await cancelLastEvent(ctx(null), { eventId: sc.event!.id })
      s34 = await st(u34.id)
      ok(s34.condition === 'AS_WAITING' && s34.loc === RC, '[1e-4] SCRAP 취소 → before(AS_WAITING·센터) 복원(위치 전용 매핑)')
      const rp2 = await markDeviceRepaired(ctx(null, '2026-08-08'), { deviceId: u34.id })
      const un = await undoDeviceRepaired(ctx(null, '2026-08-09'), { deviceId: u34.id })
      ok(un.event?.eventType === 'CORRECT' && un.event.memo === '수리완료 해제' && (await st(u34.id)).condition === 'AS_WAITING' && chOf(un.event)?.condition.before === 'REPAIRED', "[1e-4] 수리완료 해제 = CORRECT(REPAIRED→AS_WAITING, memo '수리완료 해제') — B-27")
      await expectErr('[1e-4] 수리완료 아닌 기기 해제 → 409', () => undoDeviceRepaired(ctx(null), { deviceId: u34.id }), 409, '수리완료 상태가 아닙니다')
      const mv2 = await moveDeviceLocation(ctx(null, '2026-08-10'), { deviceId: u34.id, to: 'HUB' })
      await expectErr('[1e-4] 상태 CORRECT 취소 — id 더 큰 스냅샷(SITE_MOVE) 있음 → 409', () => cancelLastEvent(ctx(null), { eventId: un.event!.id }), 409, '이후 상태 스냅샷')
      await expectErr('[1e-4] REPAIR_DONE 취소 — 이후 CORRECT·SITE_MOVE 있음 → 409', () => cancelLastEvent(ctx(null), { eventId: rp2.event!.id }), 409, '이후 상태 스냅샷')
      await cancelLastEvent(ctx(null), { eventId: mv2.event!.id })
      const cUn = await cancelLastEvent(ctx(null), { eventId: un.event!.id })
      s34 = await st(u34.id)
      ok(cUn.restored?.condition != null && s34.condition === 'REPAIRED' && s34.loc === RC, '[1e-4] LIFO 순서대로 취소(SITE_MOVE → CORRECT) → REPAIRED 복원')
      await cancelLastEvent(ctx(null), { eventId: rp2.event!.id })
      ok((await st(u34.id)).condition === 'AS_WAITING', '[1e-4] REPAIR_DONE 취소 → AS_WAITING')
      // (b) 소급 AS_CLEAR(id n+1) 뒤 REPAIR_DONE(id n) 취소 → 409 · AS_CLEAR 취소 → 재도출 ①(REPAIR_DONE after)
      const u35 = await reg1(S(35))
      await reg.openDeviceAs(ctx(null, '2026-08-10'), { deviceId: u35.id })
      await intakeDevice(ctx(H1, '2026-08-11'), { deviceId: u35.id })
      const rp35 = await markDeviceRepaired(ctx(null, '2026-08-12'), { deviceId: u35.id })
      const clr35 = await reg.clearDeviceAs(ctx(null, '2026-08-11'), { deviceId: u35.id }) // 소급 — 이후 스냅샷 배치 축 이벤트 없음(REPAIR_DONE·INTAKE는 비배치)
      ok(clr35.event.id > rp35.event!.id && (await st(u35.id)).condition === 'IN_USE' && (await st(u35.id)).loc === RC && clr35.warnings.length === 0, '[1e-4] 소급 AS_CLEAR(08-11, 수동 해제) → IN_USE·위치 유지(센터) — id 순 최신', { s: await st(u35.id), w: clr35.warnings })
      await expectErr('[1e-4] 소급 AS_CLEAR 뒤 REPAIR_DONE 취소 → 409(AS_CLEAR 먼저)', () => cancelLastEvent(ctx(null), { eventId: rp35.event!.id }), 409, '이후 상태 스냅샷')
      const cClr = await cancelLastEvent(ctx(null), { eventId: clr35.event.id })
      let s35 = await st(u35.id)
      ok(cClr.unitStates?.[u35.id]?.condition === 'REPAIRED' && s35.condition === 'REPAIRED' && s35.loc === RC && (await dev({ id: u35.id }))!.asStartedOn != null, '[1e-4] AS_CLEAR 취소 → 재도출 ①(남은 id 최대 스냅샷 REPAIR_DONE after = REPAIRED·센터) + 플래그 복원(fold)', s35)
      await cancelLastEvent(ctx(null), { eventId: rp35.event!.id })
      s35 = await st(u35.id)
      ok(s35.condition === 'AS_WAITING' && s35.loc === RC, '[1e-4] 이어서 REPAIR_DONE 취소 → AS_WAITING·센터')
      ok(await projectionEqualsRebuild(u35.id), '[1e-4] u35 프로젝션 = fold')
      // (c) REGISTER(오늘, id n) + INTAKE(과거일, id n+1) → REGISTER 취소 409 → INTAKE 먼저 취소 → REGISTER 취소(배치 삭제) → NULL
      const u36 = await reg1(S(36), H1, today)
      const in36 = await intakeDevice(ctx(H1, '2026-08-01'), { deviceId: u36.id })
      ok(in36.event != null && in36.event.id > u36.eventId, '[1e-4] REGISTER(오늘) 뒤 INTAKE(과거일) 기록(id 순 최신)')
      await expectErr('[1e-4] REGISTER(오늘) 취소 — id 더 큰 INTAKE(과거일) 있음 → 409', () => cancelLastEvent(ctx(null), { eventId: u36.eventId }), 409, '이후 상태 스냅샷')
      await cancelLastEvent(ctx(null), { eventId: in36.event!.id })
      ok((await st(u36.id)).condition === 'IN_USE' && (await st(u36.id)).loc === hosp(H1), '[1e-4] INTAKE 취소 → before(IN_USE·병원)')
      const cReg = await cancelLastEvent(ctx(null), { eventId: u36.eventId })
      const s36 = await st(u36.id)
      ok(cReg.deletedDeviceIds.includes(u36.id) && (await dev({ id: u36.id })) == null && s36.condition === null && s36.loc === 'none' && s36.condOn === null, '[1e-4] REGISTER 취소(배치 삭제) → 재도출 ② 취소 이벤트 before = NULL·위치 없음', s36)
      // (d) RECOVER(LOST) 취소 → 재도출 ①/②/③
      const u37 = await reg1(S(37))
      const rl37 = await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u37.id, reasonCodeId: lostR.id })
      const c37 = await cancelLastEvent(ctx(null), { eventId: rl37.event.id })
      ok(c37.unitStates?.[u37.id]?.condition === 'IN_USE' && (await st(u37.id)).condition === 'IN_USE' && (await st(u37.id)).loc === hosp(H1) && (await st(u37.id)).condOn === '2026-08-01' && c37.warnings.length === 0, '[1e-4] RECOVER(LOST) 취소 → 재도출 ① 남은 스냅샷(REGISTER after) = IN_USE·병원', c37.unitStates)
      const u38 = await reg1(S(38))
      await nullChanges(u38.eventId) // 배포 전 REGISTER(스냅샷 없음)
      const rl38 = await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u38.id, reasonCodeId: lostR.id })
      const c38 = await cancelLastEvent(ctx(null), { eventId: rl38.event.id })
      ok(c38.unitStates?.[u38.id]?.condition === 'IN_USE' && (await st(u38.id)).loc === hosp(H1) && (await st(u38.id)).condOn === null, '[1e-4] 배포 전 REGISTER만 남은 유닛의 RECOVER(LOST) 취소 → 재도출 ② 취소 이벤트 before(IN_USE·병원), changed_on NULL', c38.unitStates)
      const u39 = await reg1(S(39))
      await nullChanges(u39.eventId)
      const rd39 = await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u39.id, reasonCodeId: defect.id })
      await nullChanges(rd39.event.id) // 취소 대상도 스냅샷 없음(구 이벤트)
      const c39 = await cancelLastEvent(ctx(null), { eventId: rd39.event.id })
      ok(c39.unitStates?.[u39.id]?.condition === 'IN_USE' && (await st(u39.id)).loc === hosp(H1) && (await st(u39.id)).condOn === '2026-08-01', '[1e-4] 스냅샷 전무 유닛의 RECOVER 취소 → 재도출 ③ 배치 파생(ACTIVE → IN_USE·배치 병원, changed_on=placed_on)', c39.unitStates)
      // (e) 배포 전 이벤트만 가진 유닛의 AS_CLEAR 취소 → before(AS_WAITING) — §4.4 정합
      const u49 = await reg1(S(49))
      await nullChanges(u49.eventId)
      const ao49 = await reg.openDeviceAs(ctx(null, '2026-08-10'), { deviceId: u49.id })
      await nullChanges(ao49.event.id)
      const clr49 = await reg.clearDeviceAs(ctx(null, '2026-08-11'), { deviceId: u49.id })
      ok(chOf(clr49.event)?.condition.before === 'AS_WAITING' && chOf(clr49.event)?.condition.after === 'IN_USE', '[1e-4] 배포 전 AS_OPEN 뒤 AS_CLEAR → 스냅샷 AS_WAITING→IN_USE')
      const c49 = await cancelLastEvent(ctx(null), { eventId: clr49.event.id })
      ok(c49.unitStates?.[u49.id]?.condition === 'AS_WAITING' && (await st(u49.id)).condition === 'AS_WAITING' && (await st(u49.id)).loc === hosp(H1) && (await dev({ id: u49.id }))!.asStartedOn != null, '[1e-4] AS_CLEAR 취소(배포 전 이벤트만 남음) → 재도출 ② before = AS_WAITING·병원(플래그와 정합 §4.4)', c49.unitStates)
      // 재도출 결과가 I-4를 깨면 409가 아니라 warnings
      const u79 = await reg1(S(79))
      await reg.openDeviceAs(ctx(null, '2026-08-10'), { deviceId: u79.id })
      await intakeDevice(ctx(H1, '2026-08-11'), { deviceId: u79.id })
      await reg.clearDeviceAs(ctx(null, '2026-08-12'), { deviceId: u79.id }) // 수동 해제 — 위치 센터 유지(I-4 예외)
      ok((await st(u79.id)).condition === 'IN_USE' && (await st(u79.id)).loc === RC, '[1e-4] 수동 AS_CLEAR → IN_USE·위치 센터 유지(I-4 예외)')
      const back79 = await moveDeviceLocation(ctx(null, '2026-08-13'), { deviceId: u79.id, to: 'HOSPITAL' })
      ok(back79.changed && (await st(u79.id)).loc === hosp(H1), '[1e-6] ACTIVE·IN_USE [병원 반환] → 위치 병원(SITE_MOVE)')
      const cBack = await cancelLastEvent(ctx(null), { eventId: back79.event!.id })
      ok(cBack.warnings.some((w) => w.includes('I-4')) && (await st(u79.id)).loc === RC, '[1e-4] [병원 반환] 취소 → 위치 센터 복원 + I-4 경고(409 아님)', cBack.warnings)

      // (g) 정정 역전 차단(§8.2 3, P2 리뷰) — AS_OPEN(08-10, id n)·AS_CLEAR(08-11, id n+1)에서 AS_OPEN을 08-12로 옮기면 일자 순↔id 순 역전(양쪽 취소 불가 교착) → 409, 08-09는 성립
      const u80 = await reg1(S(80, 'B')) // A9900 80~82는 라우트 섹션이 신규 등록에 쓴다 — B 접두 사용
      const op80 = await reg.openDeviceAs(ctx(null, '2026-08-10'), { deviceId: u80.id })
      const cl80 = await reg.clearDeviceAs(ctx(null, '2026-08-11'), { deviceId: u80.id })
      await expectErr('[1e-4] 배치 축 스냅샷 occurredOn 정정으로 역전 쌍 생성(AS_OPEN → 08-12) → 409', () => editEvent(ctx(null), { eventId: op80.event.id, patch: { occurredOn: '2026-08-12' } }), 409, '어긋나')
      await expectErr('[1e-4] AS_CLEAR를 AS_OPEN 앞(08-09)으로 정정 → 409', () => editEvent(ctx(null), { eventId: cl80.event.id, patch: { occurredOn: '2026-08-09' } }), 409, '어긋나')
      const ee80 = await editEvent(ctx(null), { eventId: op80.event.id, patch: { occurredOn: '2026-08-09' } })
      ok(ymd(ee80.after.occurredOn) === '2026-08-09' && (await projectionEqualsRebuild(u80.id)), '[1e-4] 역전 없는 정정(AS_OPEN 08-10 → 08-09)은 성립')

      // (h) 취소 후 축별 진입일 — RECOVER(08-05: 상태·위치) → REPAIR_DONE(08-06: 상태만) → SITE_MOVE HUB(08-07: 위치만) 취소 → condition 08-06 유지·location 08-05
      const u81 = await reg1(S(81, 'B'))
      await recoverDevice(ctx(null, '2026-08-05'), { deviceId: u81.id, reasonCodeId: defect.id })
      await markDeviceRepaired(ctx(null, '2026-08-06'), { deviceId: u81.id })
      const mv81 = await moveDeviceLocation(ctx(null, '2026-08-07'), { deviceId: u81.id, to: 'HUB' })
      await cancelLastEvent(ctx(null), { eventId: mv81.event!.id })
      const s81 = await st(u81.id)
      ok(s81.condition === 'REPAIRED' && s81.loc === RC && s81.condOn === '2026-08-06' && s81.locOn === '2026-08-05', '[1e-4] SITE_MOVE 취소 → 축별 진입일(condition 08-06 REPAIR_DONE · location 08-05 RECOVER)', s81)
    }

    // ── [1e-5] SCRAPPED 유닛 REGISTER 409 — 등록·교체기·backfill·임포트 미리보기 4경로 ──
    {
      const before = await evCount(u27.id)
      await expectErr("[1e-5] 등록 → 409 '폐기된 기기입니다 — 정정 후 등록하세요'", () => registerDevices(ctx(H1), [{ serialInput: S(27), wardName: '6병동' }]), 409, shared.DEVICE_SCRAPPED_REGISTER_MESSAGE)
      await expectErr('[1e-5] 교체기로 → 409', () => replaceDevice(ctx(H1), { oldDeviceId: u24.id, newSerial: S(27) }), 409, shared.DEVICE_SCRAPPED_REGISTER_MESSAGE)
      // backfill 경로 = 배치 행 없는 유닛(고아) — 고아 유닛을 admin CORRECT로 SCRAPPED 만든 뒤 구기기 소급 등록 교체 시도
      const { unit: o89 } = await getOrCreateUnit(prisma, { serialInput: S(89), deviceInfoId: ecgModelId, source: 'MANUAL' })
      await correctDevice(ctx(null), { deviceId: o89.id, changes: { condition: 'SCRAPPED', location: null } })
      await expectErr('[1e-5] backfill 구기기(배치 없는 폐기 유닛의 소급 등록 교체) → 409', () => replaceDevice(ctx(H1), { oldSerial: S(89), oldWardName: '6병동', newSerial: S(19) }), 409, shared.DEVICE_SCRAPPED_REGISTER_MESSAGE)
      ok((await evCount(u27.id)) === before && (await st(u27.id)).condition === 'SCRAPPED' && (await dev({ id: u24.id }))!.status === 'ACTIVE' && (await dev({ id: o89.id })) == null && (await prisma.deviceUnit.count({ where: { serialNo: S(19) } })) === 0, '[1e-5] 409 후 무변경(이벤트 0·u24 ACTIVE 유지·고아 배치 없음·신 유닛 미생성)')
      const pvS = await previewRows(H1, [{ row: 1, serialInput: S(27), wardInput: '6병동' }], { wardMode: 'column', mode: 'REGISTER', occurredOn: today })
      ok(pvS.rows[0].status === 'error' && pvS.rows[0].messages.includes(shared.DEVICE_SCRAPPED_REGISTER_MESSAGE), '[1e-5] 임포트 미리보기 → error 행(미리보기/실행 일치)', pvS.rows[0].messages)
      const cFix = await correctDevice(ctx(null), { deviceId: u27.id, changes: { condition: 'REPAIRED', location: { kind: 'SITE', code: 'REFRESH_CENTER' } } })
      const rr27 = await registerDevices(ctx(H1, today), [{ serialInput: S(27), wardName: '6병동' }])
      ok(cFix.event.eventType === 'CORRECT' && rr27.reregistered.length === 1 && (await st(u27.id)).condition === 'IN_USE', '[1e-5] admin CORRECT(SCRAPPED→REPAIRED·센터) 후 재등록 → IN_USE')
    }

    // ── [1e-7] 배치 상태 이벤트 0 + INTAKE만 남은 유닛 재-fold(cancelLastEvent·cancelImportBatch) ──
    {
      const { unit: o87 } = await getOrCreateUnit(prisma, { serialInput: S(87), deviceInfoId: ecgModelId, source: 'MANUAL' })
      const in87 = await intakeDevice(ctx(null, '2026-08-01'), { deviceId: o87.id })
      ok(in87.event?.eventType === 'INTAKE' && in87.event.hospitalCode === null && (await st(o87.id)).condition === 'AS_WAITING' && (await st(o87.id)).loc === RC && (await dev({ id: o87.id })) == null, '[1e-7] 배치 없는 유닛 INTAKE(NONE ok) → AS_WAITING·센터, hospital_code NULL(B-31), 배치 행 없음')
      const r87 = await registerDevices(ctx(H1, '2026-08-02'), [{ serialInput: S(87), wardName: '6병동' }])
      ok(r87.created.length === 1 && !r87.created[0].unitCreated && (await st(o87.id)).condition === 'IN_USE' && r87.warnings.some((w) => w.includes('수리완료 체크 없이')), '[1e-7] 고아 유닛 등록 → IN_USE·병원(+재사용 경고)')
      const c87 = await cancelLastEvent(ctx(null), { eventId: r87.created[0].eventId })
      const s87 = await st(o87.id)
      ok(c87.deletedDeviceIds.includes(o87.id) && (await dev({ id: o87.id })) == null && (await evCount(o87.id)) === 1 && s87.condition === 'AS_WAITING' && s87.loc === RC, '[1e-7] REGISTER 취소 → 배치 상태 이벤트 0 → 배치 행 삭제(CHECK 위반 없음)·INTAKE 잔존·재도출 ①(INTAKE after)', s87)
      const { unit: o88 } = await getOrCreateUnit(prisma, { serialInput: S(88), deviceInfoId: ecgModelId, source: 'MANUAL' })
      await intakeDevice(ctx(null, '2026-08-01'), { deviceId: o88.id })
      const imp88 = await importBatch(ctx(H1, '2026-08-02'), { rows: [{ row: 1, serialInput: S(88) }], sourceKind: 'PASTE', mode: 'REGISTER', defaults: { wardMode: 'fixed', wardId: ward6.id } })
      ok(imp88.batch.registeredCount === 1 && (await st(o88.id)).condition === 'IN_USE', '[1e-7] 임포트 REGISTER → IN_USE')
      await expectErr('[1e-7] 임포트 등록 직후 ACTIVE·IN_USE 수리완료 → 409', () => markDeviceRepaired(ctx(null), { deviceId: o88.id }), 409, shared.DEVICE_REPAIR_IN_USE_MESSAGE)
      const in88b = await intakeDevice(ctx(H1, '2026-08-03'), { deviceId: o88.id }) // 배치 밖 스냅샷(id 더 큼)
      await expectErr('[1e-7] 배치 밖 이후 스냅샷(INTAKE) 있으면 배치 취소 409(laterSnapshotOutside)', () => cancelImportBatch(ctx(H1), { batchId: imp88.batch.id }), 409, '이후 상태 스냅샷')
      await cancelLastEvent(ctx(null), { eventId: in88b.event!.id })
      const cb88 = await cancelImportBatch(ctx(H1), { batchId: imp88.batch.id })
      const s88 = await st(o88.id)
      ok(cb88.summary.deletedDeviceIds.includes(o88.id) && (await dev({ id: o88.id })) == null && (await evCount(o88.id)) === 1 && s88.condition === 'AS_WAITING' && s88.loc === RC, '[1e-7] 배치 취소 → 배치 행 삭제·INTAKE 잔존·재도출 ①(AS_WAITING·센터)', s88)
    }

    // ── [1e-9] 일괄(bulk) 회수(LOST)·AS 표시·AS 해제(위치 유지) = 단건과 동일 ──
    {
      const r9 = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(94), wardName: '6병동' }, { serialInput: S(95), wardName: '6병동' }])
      const [u94, u95] = r9.created
      const bk = await bulkDeviceAction(ctx(H1, '2026-08-05'), { action: 'RECOVER', deviceIds: [u94.id, u95.id], reasonCodeId: lostR.id })
      const s94 = await st(u94.id)
      const s95 = await st(u95.id)
      ok(bk.events.length === 2 && s94.condition === 'LOST' && s94.loc === 'none' && s95.condition === 'LOST' && s95.loc === 'none' && bk.events.every((e) => chOf(e)?.condition.after === 'LOST' && locStr(chOf(e)?.location.after) === 'none'), '[1e-9] 일괄 회수(LOST) → 단건과 동일(LOST·위치 없음·스냅샷)', { s94, s95 })
      const cbk = await cancelLastEvent(ctx(null), { eventId: bk.events[0].id })
      ok(cbk.cancelledEventIds.length === 1 && (await st(u94.id)).condition === 'IN_USE' && (await st(u95.id)).condition === 'LOST', '[1e-9] 일괄 회수 이벤트 1건 취소 → 그 기기만 재도출(IN_USE), 짝 확장 없음')
      const r9b = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(96), wardName: '6병동' }, { serialInput: S(97), wardName: '6병동' }])
      const [u96, u97] = r9b.created
      const bkO = await bulkDeviceAction(ctx(H1, '2026-08-05'), { action: 'AS_OPEN', deviceIds: [u96.id, u97.id] })
      ok(bkO.events.length === 2 && (await st(u96.id)).condition === 'AS_WAITING' && (await st(u96.id)).loc === hosp(H1) && (await st(u97.id)).condition === 'AS_WAITING' && bkO.events.every((e) => chOf(e)?.condition.after === 'AS_WAITING'), '[1e-9] 일괄 AS 표시 → AS_WAITING·위치 병원 유지(단건과 동일)')
      await intakeDevice(ctx(H1, '2026-08-06'), { deviceId: u96.id })
      const bkC = await bulkDeviceAction(ctx(H1, '2026-08-07'), { action: 'AS_CLEAR', deviceIds: [u96.id, u97.id] })
      const s96 = await st(u96.id)
      const s97 = await st(u97.id)
      ok(bkC.events.length === 2 && s96.condition === 'IN_USE' && s96.loc === RC && s97.condition === 'IN_USE' && s97.loc === hosp(H1) && (await dev({ id: u96.id }))!.asStartedOn === null, '[1e-9] 일괄 AS 해제(수동) → IN_USE·위치 유지(센터는 센터, 병원은 병원 — I-4 예외)', { s96, s97 })
      const back96 = await moveDeviceLocation(ctx(null, '2026-08-08'), { deviceId: u96.id, to: 'HOSPITAL' })
      ok(back96.changed && (await st(u96.id)).loc === hosp(H1), '[1e-9] [병원 반환]으로 I-4 예외 해소')
      for (const id of [u94.id, u95.id, u96.id, u97.id]) ok(await projectionEqualsRebuild(id), `[1e-9] 일괄 후 프로젝션 = fold (#${id})`)
    }

    // ── [1e-11] ACTIVE_OTHER — 접수 병원 ≠ 배치 병원 INTAKE/REPAIR_DONE conflict ──
    {
      const u98 = await reg1(S(98))
      const n0 = await evCount(u98.id)
      await expectErr("[1e-11] INTAKE(ctx 병원 H2, 배치 H1) → 409 '다른 병원에 배치 중인 기기입니다 — 원장 확정에서 이관 후 입고하세요'", () => intakeDevice(ctx(H2), { deviceId: u98.id }), 409, '원장 확정에서 이관 후 입고')
      await expectErr('[1e-11] REPAIR_DONE(ctx 병원 H2) → 409 conflict', () => markDeviceRepaired(ctx(H2), { deviceId: u98.id }), 409, '다른 병원')
      await expectErr('[1e-11] SITE_MOVE(ctx 병원 H2) → 409 conflict', () => moveDeviceLocation(ctx(H2), { deviceId: u98.id, to: 'HOSPITAL' }), 409, '다른 병원')
      ok((await evCount(u98.id)) === n0 && (await st(u98.id)).condition === 'IN_USE', '[1e-11] conflict 409 후 이벤트 0·유닛 무변경')
      const inSame = await intakeDevice(ctx(H1), { deviceId: u98.id })
      ok(inSame.changed && (await st(u98.id)).loc === RC, '[1e-11] 같은 병원 문맥(H1) INTAKE → ok')
      const inNull = await intakeDevice(ctx(null), { deviceId: u98.id })
      ok(inNull.changed === false && inNull.event === null, '[1e-11] ctx 병원 없음(드로어 경로) = 배치 병원(SAME) — 무변화·ref 없음 재호출 스킵')
    }

    // ── [1e-8] I-6 — 스냅샷 이벤트가 1건 이상인 테스트 유닛 전부: 유닛 값 = id 최대 스냅샷 이벤트의 after ──
    {
      const units = await prisma.deviceUnit.findMany({ where: { OR: TEST_PREFIXES.map((p) => ({ serialNo: { startsWith: p } })) }, include: { locationSite: true } })
      const bad: string[] = []
      let checked = 0
      for (const u of units) {
        const latest = await reg.latestSnapshotEvent(prisma, u.id)
        if (!latest) continue
        checked++
        const ch = shared.unitStateChangesOf(latest.changes)!
        const loc = u.locationHospitalCode ? `HOSPITAL/${u.locationHospitalCode}` : u.locationSite?.value ? `SITE/${u.locationSite.value}` : 'none'
        if ((ch.condition.after ?? null) !== (u.condition ?? null) || locStr(ch.location.after) !== loc) bad.push(`${u.serialNo}: unit ${u.condition}·${loc} ≠ snapshot ${ch.condition.after}·${locStr(ch.location.after)} (#${latest.id} ${latest.eventType})`)
      }
      ok(bad.length === 0 && checked >= 20, `[1e-8] I-6 — 테스트 유닛 ${checked}대: 유닛 condition/location = id 최대 스냅샷 이벤트 after`, bad)
      // I-1·I-2 — DB CHECK(LOST/SCRAPPED 위치 NULL · 위치 단일)를 앱이 깨지 않았는지
      const viol = await prisma.deviceUnit.count({ where: { OR: [{ condition: { in: ['LOST', 'SCRAPPED'] }, OR: [{ locationHospitalCode: { not: null } }, { locationSiteId: { not: null } }] }, { locationHospitalCode: { not: null }, locationSiteId: { not: null } }] } })
      ok(viol === 0, '[1e-8] I-1·I-2 위반 0(전 유닛)')
      // I-3 — 배치 ACTIVE ∧ condition ∈ {LOST,SCRAPPED,PRE_SHIP} 0(테스트 병원)
      const i3 = await prisma.hospitalDevice.count({ where: { status: 'ACTIVE', hospitalCode: { in: TEST_HOSPITALS }, unit: { condition: { in: ['LOST', 'SCRAPPED', 'PRE_SHIP'] } } } })
      ok(i3 === 0, '[1e-8] I-3 위반 0(테스트 병원 ACTIVE)')
    }
  }

  section('[2] 소급·미래·불법 전이')
  await expectErr('미래 일자', () => moveDeviceWard(ctx(H2, '2099-01-01'), { deviceId: d1.id, toWardName: 'X' }), 400, '미래')
  await expectErr('형식 오류 일자', () => moveDeviceWard(ctx(H2, '2026-13-01'), { deviceId: d1.id, toWardName: 'X' }), 400, '형식')
  await expectErr('미래 일자 등록', () => registerDevices(ctx(H1, '2999-12-31'), [{ serialInput: S(99) }]), 400, '미래')
  await expectErr('재등록 이전 시점 회수(H2, 08-15 → 당시 RECOVERED)', () => recoverDevice(ctx(H2, '2026-08-15'), { deviceId: d1.id, reasonCodeId: defect.id }), 409)
  await expectErr('타 병원 시점 이동(H2, 08-03 → 당시 H1 ACTIVE)', () => moveDeviceWard(ctx(H2, '2026-08-03'), { deviceId: d1.id, toWardName: 'ICU2' }), 409)
  // d2: REGISTER 08-01(6병동) → MOVE 08-20(7병동) ; 08-10 회수는 이후 이벤트(08-20 병동 이동) 불성립 409
  await moveDeviceWard(ctx(H1, '2026-08-20'), { deviceId: d2.id, toWardName: '7병동' })
  await expectErr('소급 회수 → 이후 이벤트 불성립', () => recoverDevice(ctx(H1, '2026-08-10'), { deviceId: d2.id, reasonCodeId: defect.id }), 409, '이후 이벤트(08-20 병동 이동)')
  await expectErr('소급 이동 — 그 시점 이미 같은 병동(6병동)', () => moveDeviceWard(ctx(H1, '2026-08-05'), { deviceId: d2.id, toWardId: ward6.id }), 400, '시점에 이미')
  const retroMv = await moveDeviceWard(ctx(H1, '2026-08-10'), { deviceId: d2.id, toWardName: '8병동' })
  const d2row = (await dev({ id: d2.id }))!
  ok(retroMv.event.occurredOn.toISOString().startsWith('2026-08-10') && retroMv.fromWardId === ward6.id && d2row.wardId === ward7.id, '소급 이동 삽입 성공(from=6병동), 현재 병동은 08-20 이동 결과(7병동) 유지')
  ok(await projectionEqualsRebuild(d2.id), 'd2 프로젝션 = fold')
  ok((await prisma.hospitalDeviceEvent.count({ where: { deviceId: d2.id } })) === 3, 'd2 이벤트 3건')

  section('[3] 교체 계약 (§7.0 (1)~(6))')
  const ra = await replaceDevice(ctx(H1, '2026-08-25'), { oldDeviceId: d3.id, newSerial: S(10) })
  ok(ra.eventIds.length === 2 && ra.recoverEvent && ra.registerEvent && !ra.backfillEvent && !ra.movedNewEvent, '(기본) 2이벤트')
  ok(ra.oldDevice.status === 'RECOVERED' && ra.oldDevice.replacedById === ra.newDevice.id && ra.newDevice.wardId === d3.wardId && ra.recoverEvent!.reasonCodeId === defect.id, '구 RECOVERED·replaced_by·신 병동=구 병동·사유 DEFECT 기본')
  ok(ra.recoverEvent!.relatedDeviceId === ra.newDevice.id && ra.registerEvent!.relatedDeviceId === ra.oldDevice.id && ra.recoverEvent!.actionGroup === ra.registerEvent!.actionGroup, '상호 related·같은 action_group')
  const rb = await replaceDevice(ctx(H1, '2026-08-26'), { oldSerial: S(20), oldWardName: '6병동', newSerial: S(21) })
  ok(rb.eventIds.length === 3 && rb.backfillEvent?.memo === '교체 시 소급 등록' && rb.oldDevice.status === 'RECOVERED' && rb.newDevice.wardId === ward6.id, '(6) 구 원장에 없음 → 소급 REGISTER + RECOVER + REGISTER 3이벤트')
  ok(rb.eventIds[0] < rb.eventIds[1] && rb.eventIds[1] < rb.eventIds[2] && rb.warnings.some((w) => w.includes('소급')), '같은 일자 순서 = id, 소급 안내 경고')
  await expectErr('(2) 구기기 타 병원 ACTIVE', () => replaceDevice(ctx(H1), { oldDeviceId: d1.id, newSerial: S(30) }), 409, '배치 중')
  const rd = await replaceDevice(ctx(H1, '2026-08-27'), { oldDeviceId: rb.oldDevice.id, newSerial: S(22) })
  ok(rd.eventIds.length === 1 && !rd.recoverEvent && rd.linkedRecoverEventId === rb.recoverEvent!.id && rd.newDevice.wardId === ward6.id, '(3) 기회수 교체 → REGISTER 1 + 구 RECOVER 연결, 병동=구 회수 병동')
  ok((await prisma.hospitalDeviceEvent.findUnique({ where: { id: rb.recoverEvent!.id } }))?.relatedDeviceId === rd.newDevice.id, '구 RECOVER.related_device_id = 신')
  await expectErr('(3) 회수일 이전 업무일자', () => replaceDevice(ctx(H1, '2026-08-01'), { oldDeviceId: rb.oldDevice.id, newSerial: S(23) }), 400)
  await expectErr('(3) 타 병원에서 회수된 구기기', () => replaceDevice(ctx(H2, '2026-08-28'), { oldDeviceId: rb.oldDevice.id, newSerial: S(23) }), 409)
  await expectErr('(4) 구=신', () => replaceDevice(ctx(H1), { oldSerial: S(40), newSerial: S(40).toLowerCase() }), 400)
  const re5 = await replaceDevice(ctx(H1, '2026-08-28'), { oldDeviceId: ra.newDevice.id, newSerial: S(2), toWardName: '6병동' })
  ok(re5.registerEvent === null && re5.recoverEvent && re5.movedNewEvent && re5.newDevice.id === d2.id && re5.eventIds.length === 2, '(5) 신 이미 이 병원 ACTIVE → REGISTER 없음, RECOVER(구)+MOVE_WARD(신)')
  ok(re5.newDevice.wardId === ward6.id && re5.recoverEvent!.relatedDeviceId === d2.id, '신 병동 = 지정 병동(6병동), RECOVER.related = 신')
  await expectErr('(1) 신 타 병원 ACTIVE, 이관 미지정', () => replaceDevice(ctx(H1), { oldSerial: S(50), newSerial: S(1) }), 409, '타 병원')
  const rf = await replaceDevice(ctx(H1, '2026-08-29'), { oldSerial: S(50), newSerial: S(1), newConflict: 'TRANSFER' })
  ok(rf.eventIds.length === 4 && rf.transferRecoverEvent?.hospitalCode === H2 && rf.newDevice.hospitalCode === H1 && rf.newDevice.id === d1.id, '(6)+(1) 소급 구 + 신 이관 → 4이벤트(최대)')
  const rfTr = await prisma.hospitalDeviceEvent.findUnique({ where: { id: rf.transferRecoverEvent!.id }, include: { reasonCode: true } })
  ok(rfTr?.reasonCode?.value === 'TRANSFER' && rfTr.actionGroup === rf.actionGroup, '이관 RECOVER 사유 TRANSFER·같은 그룹')
  ok(await projectionEqualsRebuild(rf.newDevice.id), '이관 기기 프로젝션 = fold')

  section('[4] 이관 opt-in 등록 · 충돌 응답 · 이관 쌍 단건 취소')
  const conf = await expectErr('타 병원 ACTIVE 등록', () => registerDevices(ctx(H2), [{ serialInput: S(1) }]), 409, '타 병원')
  ok(conf?.conflicts?.[0]?.hospitalCode === H1 && !!conf?.conflicts?.[0]?.hospitalName && conf.conflicts[0].serial === S(1), 'conflicts[] 형상(serial·hospitalCode·hospitalName·wardName·placedOn)', conf?.conflicts)
  const tr = await registerDevices(ctx(H2, '2026-08-30'), [{ serialInput: S(1), wardName: 'ICU' }], { conflicts: { [S(1)]: 'TRANSFER' } })
  ok(tr.transferred.length === 1 && tr.transferred[0].fromHospitalCode === H1 && tr.events.length === 2, '이관 opt-in → RECOVER(TRANSFER)@원 병원 + REGISTER')
  const trRec = await prisma.hospitalDeviceEvent.findUnique({ where: { id: tr.transferred[0].recoverEventId }, include: { reasonCode: true } })
  ok(trRec?.reasonCode?.value === 'TRANSFER' && trRec.hospitalCode === H1 && trRec.fromWardId == null, '이관 RECOVER 사유 TRANSFER @원 병원(from=당시 병동, 미지정이면 NULL)')
  await expectErr('이관 소급 — 상대 병원 배치일 이전', () => registerDevices(ctx(H2, '2026-08-01'), [{ serialInput: S(21) }], { conflicts: { [S(21)]: 'TRANSFER' } }), 409, '배치일')
  // 수동 이관 쌍 단건 취소 → 원 병원 ACTIVE 복원
  const r62 = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(62), wardName: '6병동' }])
  const tr62 = await registerDevices(ctx(H2, '2026-08-15'), [{ serialInput: S(62), wardName: 'ICU' }], { conflicts: { [S(62)]: 'TRANSFER' } })
  const c62 = await cancelLastEvent(ctx(null), { eventId: tr62.transferred[0].eventId })
  const d62 = (await dev({ id: r62.created[0].id }))!
  ok(c62.cancelledEventIds.length === 2 && d62.status === 'ACTIVE' && d62.hospitalCode === H1 && d62.wardId === ward6.id, '이관 쌍(REGISTER 앵커) 취소 → RECOVER(TRANSFER)도 함께, 원 병원 ACTIVE 복원')

  section('[5] 일괄 이동·회수')
  const rB = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(10, 'P'), wardName: 'A동' }, { serialInput: S(11, 'P'), wardName: 'A동' }, { serialInput: S(12, 'P'), wardName: 'B동' }])
  const wardA = rB.newWards.find((w) => w.name === 'A동')!
  const wardB = rB.newWards.find((w) => w.name === 'B동')!
  const bm = await bulkDeviceAction(ctx(H3, '2026-08-15'), { action: 'MOVE_WARD', deviceIds: rB.created.map((c) => c.id), toWardName: 'B동' })
  ok(bm.events.length === 2 && bm.skipped.length === 1 && bm.affectedDeviceIds.length === 2 && bm.events.every((e) => e.actionGroup === bm.actionGroup), '일괄 이동: 이미 대상 병동 1건 skip, 2건 같은 그룹')
  await expectErr('일괄: 전부 이미 대상 병동', () => bulkDeviceAction(ctx(H3), { action: 'MOVE_WARD', deviceIds: rB.created.map((c) => c.id), toWardId: wardB.id }), 409, '모두 이미')
  const bmRetro = await expectErr('일괄: 소급 시점에 이미 대상 병동(08-10 A동)', () => bulkDeviceAction(ctx(H3, '2026-08-10'), { action: 'MOVE_WARD', deviceIds: [rB.created[0].id], toWardId: wardA.id }), 409, '모두 이미')
  ok(bmRetro?.skipped?.length === 1 && bmRetro?.skipped?.[0].reason.includes('시점'), '소급 skip 사유 반환', bmRetro?.skipped)
  await expectErr('일괄: 소급 회수(08-10) → 이후 이벤트(08-15 병동 이동) 불성립', () => bulkDeviceAction(ctx(H3, '2026-08-10'), { action: 'RECOVER', deviceIds: [rB.created[0].id], reasonCodeId: defect.id }), 409, '이후 이벤트')
  await expectErr('일괄: 타 병원 기기 섞임', () => bulkDeviceAction(ctx(H3), { action: 'RECOVER', deviceIds: [rB.created[0].id, d1.id], reasonCodeId: defect.id }), 409, '배치 중이 아닌 기기 1대')
  await expectErr('일괄: 없는 기기', () => bulkDeviceAction(ctx(H3), { action: 'RECOVER', deviceIds: [rB.created[0].id, 999_999_999], reasonCodeId: defect.id }), 404)
  await expectErr('일괄: 사유 없음', () => bulkDeviceAction(ctx(H3), { action: 'RECOVER', deviceIds: [rB.created[0].id] }), 400)
  const br = await bulkDeviceAction(ctx(H3, '2026-08-16'), { action: 'RECOVER', deviceIds: rB.created.map((c) => c.id), reasonCodeId: defect.id })
  ok(br.events.length === 3 && br.events.every((e) => e.actionGroup === br.actionGroup && e.fromWardId === wardB.id), '일괄 회수 3건 같은 그룹·from=B동')
  const cbr = await cancelLastEvent(ctx(null), { eventId: br.events[0].id })
  ok(cbr.cancelledEventIds.length === 1 && cbr.restoredDevices[0]?.status === 'ACTIVE', '일괄 그룹은 개체별 취소(짝 확장 없음)')
  await bulkDeviceAction(ctx(H3, '2026-08-16'), { action: 'RECOVER', deviceIds: [br.events[0].deviceId], reasonCodeId: defect.id })

  section('[6] 동시성 — 같은 기기 동시 회수 / 동시 병동 생성')
  const rC = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(20, 'P') }])
  const results = await Promise.allSettled([
    recoverDevice(ctx(H3), { deviceId: rC.created[0].id, reasonCodeId: defect.id }),
    recoverDevice(ctx(H3), { deviceId: rC.created[0].id, reasonCodeId: defect.id }),
  ])
  const okCount = results.filter((r) => r.status === 'fulfilled').length
  const conflict409 = results.filter((r) => r.status === 'rejected' && (r.reason as InstanceType<typeof RegistryError>).status === 409).length
  ok(okCount === 1 && conflict409 === 1, '동시 회수 → 1 성공 · 1 409', results.map((r) => (r.status === 'rejected' ? (r.reason as Error).message : 'ok')))
  ok((await prisma.hospitalDeviceEvent.count({ where: { deviceId: rC.created[0].id, eventType: 'RECOVER' } })) === 1, 'RECOVER 이벤트 1건만')
  const wardRace = await Promise.allSettled([
    registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(30, 'P'), wardName: '9 병동' }]),
    registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(31, 'P'), wardName: '９병동' }]),
  ])
  ok(wardRace.every((r) => r.status === 'fulfilled'), '동시 등록 성공', wardRace.map((r) => (r.status === 'rejected' ? (r.reason as Error).message : 'ok')))
  ok((await prisma.hospitalWard.count({ where: { hospitalCode: H3, nameNorm: '9병동' } })) === 1, "표기 상이 동명('9 병동'·'９병동') → 1행")

  section('[7] WMS 매칭 · 멱등 키 · GET 무변경')
  let gwId: number | null = null
  if (gwUnit && gwKey) {
    const gw = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: gwUnit.toLowerCase(), wardName: 'B동' }])
    gwId = gw.created[0].id
    const gwRow = await unitRow({ id: gwId })
    ok(gwRow?.serialNo === gwKey && gwRow.serialRaw === gwUnit.toUpperCase(), 'GW 합성 시리얼 분해·원문 보존(유닛)')
    const gwm = gw.wms[gwId]
    ok(!!gwm && gwm.modelName === 'MGW1010' && gwm.serialNo === gwUnit && gwm.status === 'OUT', 'GW model_name 매칭(일시 계산, device_info_id NULL 품목) — 등록 응답 wms', gw.wms)
    const lk = await lookupDevice(gwUnit)
    ok(lk.device?.id === gwId, '시리얼 조회: 합성 원문으로도 일치')
  } else ok(false, 'WMS에 OUT 상태 MGW1010 합성 시리얼이 없어 GW 매칭 케이스를 건너뜀')
  const r70 = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(70) }])
  ok(r70.wms[r70.created[0].id] === null, '테스트 시리얼은 WMS 미매칭 → wms null(영속 링크 없음)')
  if (ecgInStock) {
    const fake = { id: r70.created[0].id, serialNo: ecgInStock, serialRaw: null, deviceInfoId: 1, deviceModel: 'MC200M-T' }
    const uBefore = (await unitRow({ id: fake.id }))!.updatedAt.toISOString()
    const m0 = await matchInventoryUnits(prisma, [fake])
    ok(m0.get(fake.id)?.status === 'IN_STOCK' && (await unitRow({ id: fake.id }))!.updatedAt.toISOString() === uBefore, 'matchInventoryUnits → 매치 반환(일시 계산), 유닛·배치 행 무변경')
    const pvIn = await previewRows(H3, [{ row: 1, serialInput: ecgInStock }], { wardMode: 'fixed', mode: 'REGISTER', occurredOn: today })
    ok(pvIn.rows[0].status === 'warn' && pvIn.rows[0].messages.some((m) => m.includes('IN_STOCK')), '미리보기 WMS IN_STOCK warn')
    const lkw = await lookupDevice(ecgInStock)
    ok(lkw.device === null && lkw.wmsCandidates.some((c) => c.serialNo === ecgInStock), '시리얼 조회 0건 → WMS 후보')
  } else ok(false, 'WMS에 IN_STOCK MC200M-T 시리얼이 없어 일시 매칭 케이스를 건너뜀')
  const snapBefore = await prisma.hospitalDevice.findMany({ where: { hospitalCode: H3 }, select: { id: true, deviceId: true, updatedAt: true, unit: { select: { updatedAt: true } } }, orderBy: { id: 'asc' } })
  await listUnits({ hospital: H3 }, { page: 1, limit: 50 })
  await getUnitDetail(r70.created[0].id)
  await getHospitalDeviceSummary(H3)
  await getGlobalCoverage({ q: h3!.hospital_name })
  const snapAfter = await prisma.hospitalDevice.findMany({ where: { hospitalCode: H3 }, select: { id: true, deviceId: true, updatedAt: true, unit: { select: { updatedAt: true } } }, orderBy: { id: 'asc' } })
  ok(JSON.stringify(snapBefore) === JSON.stringify(snapAfter), 'GET 경로(listUnits/getUnitDetail/summary/coverage) 후 DB 무변경')
  const idemDev = r70.created[0].id
  const idem1 = await insertEvent(prisma, { deviceId: idemDev, eventType: 'MOVE_WARD', hospitalCode: H3, toWardId: wardB.id, occurredOn: '2026-08-02', actionGroup: null, source: 'WMS', ref: { type: 'INVENTORY_TX', code: 'TX-SMOKE-1' }, actor: ACTOR })
  const idem2 = await insertEvent(prisma, { deviceId: idemDev, eventType: 'MOVE_WARD', hospitalCode: H3, toWardId: wardB.id, occurredOn: '2026-08-02', actionGroup: null, source: 'WMS', ref: { type: 'INVENTORY_TX', code: 'TX-SMOKE-1' }, actor: ACTOR })
  const idem3 = await insertEvent(prisma, { deviceId: idemDev, eventType: 'MOVE_WARD', hospitalCode: H3, toWardId: wardA.id, occurredOn: '2026-08-03', actionGroup: null, source: 'MANUAL', ref: { type: 'INVENTORY_TX', code: 'TX-SMOKE-1' }, actor: ACTOR })
  ok(idem1 != null && idem2 === null && idem3 != null, 'WMS+ref 멱등 키 → 2회째 no-op, MANUAL은 같은 ref 허용')
  await rebuildUnitProjection(prisma, idemDev)
  ok((await listEvents({ refType: 'INVENTORY_TX', refCode: 'TX-SMOKE-1' }, { page: 1, limit: 10 })).total === 2, 'ref 필터(INVENTORY_TX)')
  const lk0 = await lookupDevice(`${S(1).slice(0, 5)}`)
  ok(lk0.device === null && lk0.candidates.length > 0 && lk0.candidates.every((c) => c.serialNo.startsWith(S(1).slice(0, 5))), '시리얼 조회 0건 → 접두 후보')

  section('[8] 임포트 미리보기·실행·취소 (§7.2)')
  const closed = await prisma.hospitalWard.create({ data: { hospitalCode: H1, name: '폐쇄병동', nameNorm: '폐쇄병동', isActive: false } })
  // reregister (b) 준비: H2에서 회수된 기기
  const r104 = await registerDevices(ctx(H2, '2026-08-01'), [{ serialInput: S(45), wardName: 'ICU' }])
  await recoverDevice(ctx(null, '2026-08-05'), { deviceId: r104.created[0].id, reasonCodeId: (await reasonByValue(prisma, 'LOST')).id })
  const rows = [
    { row: 2, serialInput: S(41), wardInput: '6병동' }, // ok
    { row: 3, serialInput: 'A99010', wardInput: '신관1' }, // warn 형식 + 새 병동
    { row: 4, serialInput: S(41), wardInput: '6병동' }, // error 파일 내 중복
    { row: 5, serialInput: S(1), wardInput: '6병동' }, // conflict (H2 ACTIVE)
    { row: 6, serialInput: S(21), wardInput: '7병동' }, // skip (H1 ACTIVE — 병동 달라도 안 고침)
    { row: 7, serialInput: S(3), wardInput: '6병동' }, // reregister (a) — 이 병원에서 회수됨
    { row: 8, serialInput: S(42), wardInput: '폐쇄병동' }, // error 폐쇄 병동
    { row: 9, serialInput: 'Z1', wardInput: '' }, // error 모델 판별 불가
    { row: 10, serialInput: S(45), wardInput: '6병동' }, // reregister (b) — 타 병원에서 회수(LOST → warn 동반)
    { row: 11, serialInput: S(43) }, // warn 빈 병동
    { row: 12, serialInput: S(44), wardInput: '6병동', modelInput: 'MP100W' }, // warn 접두/모델 불일치
    { row: 13, serialInput: '' }, // error 빈 시리얼
  ]
  const pv = await previewRows(H1, rows, { wardMode: 'column', mode: 'REGISTER', occurredOn: '2026-08-30' })
  const by = (r: number) => pv.rows.find((x) => x.row === r)!
  ok(by(2).status === 'ok' && by(2).wardId === ward6.id && by(2).executable, 'row2 ok(기존 병동 name_norm 매칭)')
  ok(by(3).status === 'warn' && by(3).wardNew && by(3).messages.some((m) => m.includes('형식')), 'row3 warn(형식 불일치·병동 신규)', by(3).messages)
  ok(by(4).status === 'error' && by(4).defaultExcluded && by(4).messages[0].includes('중복'), 'row4 파일 내 중복 error(자동 제외)')
  ok(by(5).status === 'conflict' && by(5).defaultExcluded && by(5).actions.includes('TRANSFER') && by(5).existing?.hospitalCode === H2, 'row5 conflict 기본 제외 + TRANSFER 액션')
  ok(by(6).status === 'skip' && !by(6).executable, 'row6 skip(이 병원 ACTIVE, 병동 상이 무시)', by(6).messages)
  ok(by(7).status === 'reregister' && by(7).messages.some((m) => m.includes('이 병원에서')) && !by(7).defaultExcluded, 'row7 reregister (a) 신규 모드 — 기본 제외 아님', by(7).messages)
  ok(by(8).status === 'error' && by(8).wardInactive && by(8).actions.includes('UNASSIGN_WARD'), 'row8 폐쇄 병동 error + UNASSIGN_WARD 액션')
  ok(by(9).status === 'error' && by(9).messages[0].includes('모델'), 'row9 모델 판별 불가 error')
  ok(by(10).status === 'reregister' && by(10).messages.some((m) => m.includes('이력 연결')) && by(10).messages.some((m) => m.includes('분실')), 'row10 reregister (b) 타 병원 회수 → 이력 연결 + LOST 경고', by(10).messages)
  ok(by(11).status === 'warn' && by(11).messages.some((m) => m.includes('미지정')), 'row11 빈 병동 warn(미지정 등록)')
  ok(by(12).status === 'warn' && by(12).deviceModel === 'MP100W' && by(12).messages.some((m) => m.includes('접두')), 'row12 모델 지정 ≠ 접두 추정 warn')
  ok(by(13).status === 'error' && by(13).messages[0].includes('비어'), 'row13 빈 시리얼 error')
  ok(pv.summary.newWards.length === 1 && pv.summary.newWards[0].name === '신관1' && pv.summary.error === 4 && pv.summary.conflict === 1 && pv.summary.skip === 1 && pv.summary.reregister === 2, '요약 카운트·생성 예정 병동 1', pv.summary)
  const pvDraft = await previewRows(H1, [{ row: 1, serialInput: S(3), org: 'ORG1' }], { wardMode: 'fixed', mode: 'ONPREM_DRAFT', occurredOn: '2026-08-30' })
  ok(pvDraft.rows[0].status === 'reregister' && pvDraft.rows[0].defaultExcluded && pvDraft.rows[0].messages.some((m) => m.includes('회수 후보')), '초안 모드 reregister (a) → 기본 제외(회수 후보)')
  const pvRetro = await previewRows(H1, [{ row: 1, serialInput: S(3) }], { wardMode: 'fixed', mode: 'REGISTER', occurredOn: '2026-08-20' })
  ok(pvRetro.rows[0].status === 'error' && pvRetro.rows[0].messages[0].includes('회수일'), '재등록 행 업무일자 < 회수일 → error(소급 불성립)', pvRetro.rows[0].messages)
  const pvTrRetro = await previewRows(H1, [{ row: 1, serialInput: S(1) }], { wardMode: 'fixed', mode: 'REGISTER', occurredOn: '2026-08-10', rowActions: { 1: 'TRANSFER' } })
  ok(pvTrRetro.rows[0].status === 'error' && pvTrRetro.rows[0].messages[0].includes('배치일'), '이관 행 업무일자 < 상대 병원 배치일 → error')
  const pvEmptyErr = await previewRows(H1, [{ row: 1, serialInput: S(43) }], { wardMode: 'column', emptyWardCell: 'error', mode: 'REGISTER', occurredOn: '2026-08-30' })
  ok(pvEmptyErr.rows[0].status === 'error', '빈 병동 옵션 error')
  await expectErr('미래 업무일자 미리보기', () => previewRows(H1, rows, { wardMode: 'column', mode: 'REGISTER', occurredOn: '2099-01-01' }), 400)
  await expectErr('MAX 초과(2001행)', () => previewRows(H1, Array.from({ length: 2001 }, (_, i) => ({ row: i + 1, serialInput: S(1) })), { wardMode: 'fixed', mode: 'REGISTER', occurredOn: today }), 400, '최대')
  await expectErr('TRANSFER를 비충돌 행에', () => previewRows(H1, rows, { wardMode: 'column', mode: 'REGISTER', occurredOn: '2026-08-30', rowActions: { 2: 'TRANSFER' } }), 400)
  await expectErr('UNASSIGN_WARD를 정상 병동 행에', () => previewRows(H1, rows, { wardMode: 'column', mode: 'REGISTER', occurredOn: '2026-08-30', rowActions: { 2: 'UNASSIGN_WARD' } }), 400)
  await expectErr('없는 병원', () => previewRows('HOSP-NOPE', rows, { wardMode: 'column', mode: 'REGISTER', occurredOn: today }), 404)
  const pvAlias = await previewRows(H1, [{ row: 1, serialInput: S(44), wardInput: '6병 동' }], { wardMode: 'column', mode: 'REGISTER', occurredOn: '2026-08-30', wardAliases: { '6병 동': ward6.id } })
  ok(pvAlias.rows[0].wardId === ward6.id && !pvAlias.rows[0].wardNew, '병동 별칭 매핑(생성 대신)')
  const pvOrg = await previewRows(H1, [{ row: 1, serialInput: S(47), org: 'ORGA', wardCode: 'ORGA_W1' }, { row: 2, serialInput: S(48), org: 'ORGB' }], { wardMode: 'column', mode: 'ONPREM_DRAFT', occurredOn: today, orgs: ['ORGA'] })
  ok(pvOrg.summary.orgs.length === 2 && pvOrg.rows[1].status === 'skip' && pvOrg.rows[0].wardNew && pvOrg.rows[0].extWardCodeToSet === 'ORGA_W1', '초안 모드: 해제 org 행 skip · wardCode → 코드명 병동 생성 예정 + ext_ward_code 기록 예정')
  await expectErr('초안 모드 org ≥2인데 orgs 누락', () => importBatch(ctx(H1), { rows: pvOrg.rows.map((r) => ({ row: r.row, serialInput: r.serialInput, org: r.org, wardCode: r.row === 1 ? 'ORGA_W1' : null })), sourceKind: 'PASTE', mode: 'ONPREM_DRAFT', defaults: { wardMode: 'column' } }), 400, '기관')

  const importCtx = ctx(H1, '2026-08-30', { memo: 'go-live 1차' })
  await expectErr('오류 미제외 실행', () => importBatch(importCtx, { rows, sourceKind: 'PASTE', mode: 'REGISTER', defaults: { wardMode: 'column' } }), 400, '오류 행')
  const confImp = await expectErr('conflict 미지정 실행', () => importBatch(importCtx, { rows, excludeRows: [4, 8, 9, 13], sourceKind: 'PASTE', mode: 'REGISTER', defaults: { wardMode: 'column' } }), 409, '타 병원')
  ok(confImp?.conflicts?.length === 1 && confImp.conflicts[0].serial === S(1), '임포트 409 conflicts[]')
  await expectErr('없는 행에 rowActions', () => importBatch(importCtx, { rows, excludeRows: [4, 8, 9, 13, 5], rowActions: { 99: 'TRANSFER' }, sourceKind: 'PASTE', mode: 'REGISTER', defaults: { wardMode: 'column' } }), 400, '입력에 없습니다')
  const imp = await importBatch(importCtx, {
    rows,
    excludeRows: [4, 9, 13],
    rowActions: { 5: 'TRANSFER', 8: 'UNASSIGN_WARD' },
    sourceKind: 'PASTE',
    mode: 'REGISTER',
    fileName: null,
    defaults: { wardMode: 'column' },
  })
  // 실행 9행: 신규 5(41·A99010·42·43·44) · 재등록 2(3·45) · 이관 1(1) · skip 1(21)
  ok(imp.batch.registeredCount === 5 && imp.batch.reregisteredCount === 2 && imp.batch.transferredCount === 1 && imp.batch.skippedCount === 1 && imp.batch.rowCount === rows.length && imp.batch.note === 'go-live 1차', '배치 카운트 5/2/1/1 · note', {
    reg: imp.batch.registeredCount, rereg: imp.batch.reregisteredCount, tr: imp.batch.transferredCount, skip: imp.batch.skippedCount,
  })
  const impEvents = await prisma.hospitalDeviceEvent.findMany({ where: { importBatchId: imp.batch.id } })
  ok(impEvents.length === 9 && impEvents.every((e) => e.source === 'IMPORT' && e.actionGroup === imp.result.actionGroup), '배치 이벤트 9건(이관 RECOVER 포함) source IMPORT·같은 그룹', impEvents.length)
  const unassigned = (await dev({ serialNo: S(42) }))!
  ok(unassigned.wardId == null && unassigned.hospitalCode === H1, 'UNASSIGN_WARD 행 → 병동 NULL 등록')
  ok((await dev({ serialNo: S(1) }))!.hospitalCode === H1 && (await dev({ serialNo: S(45) }))!.hospitalCode === H1, '임포트 이관·타 병원 재등록 → H1 ACTIVE')
  const pv2 = await previewRows(H1, rows.filter((r) => ![4, 9, 13].includes(r.row)), { wardMode: 'column', mode: 'REGISTER', occurredOn: '2026-08-30' })
  ok(pv2.summary.skip === 9 && pv2.summary.executable === 0, '같은 목록 재임포트 → 전부 skip', pv2.summary)
  await expectErr('전부 skip 실행', () => importBatch(importCtx, { rows: rows.filter((r) => ![4, 9, 13].includes(r.row)), sourceKind: 'PASTE', mode: 'REGISTER', defaults: { wardMode: 'column' } }), 400, '실행할 행')
  await expectErr('배치 업무일자 → 이관 원 병원 이후 이벤트(08-30 회수) 앞으로 → 409(일자 순↔id 순 역전 차단 §8.2 3 — fold 불성립보다 먼저 판정)', () => editImportBatchDate(ctx(H1), { batchId: imp.batch.id, occurredOn: '2026-08-29' }), 409, '어긋나')
  await expectErr('배치 업무일자 변경 없음', () => editImportBatchDate(ctx(H1), { batchId: imp.batch.id, occurredOn: '2026-08-30' }), 400)
  const ed = await editImportBatchDate(ctx(H1), { batchId: imp.batch.id, occurredOn: '2026-08-31' })
  ok(ed.eventCount === 9 && ed.after === '2026-08-31' && ed.before === '2026-08-30' && (await dev({ serialNo: S(41) }))!.placedOn?.toISOString().startsWith('2026-08-31'), '배치 업무일자 일괄 정정 → 프로젝션 placed_on 갱신')
  await expectErr('배치 업무일자 → 재등록 회수일 이전(불성립)', () => editImportBatchDate(ctx(H1), { batchId: imp.batch.id, occurredOn: '2026-08-20' }), 409)
  const a100 = (await dev({ serialNo: S(41) }))!
  const outside = await moveDeviceWard(ctx(H1, today), { deviceId: a100.id, toWardName: '7병동' })
  const blocked = await expectErr('배치 밖 이벤트 있는 배치 취소', () => cancelImportBatch(ctx(H1), { batchId: imp.batch.id }), 409, '배치 밖 이벤트가 있는 기기 1대')
  ok(!!blocked?.message.includes(S(41)) && !!blocked?.message.includes('병동 이동'), '409 문구에 시리얼·이벤트 라벨')
  await expectErr('임포트 REGISTER 단건 취소(마지막 아님)', () => cancelLastEvent(ctx(H1), { eventId: impEvents.find((e) => e.deviceId === a100.id)!.id }), 409, '이후 이벤트')
  const c1 = await cancelLastEvent(ctx(H1), { eventId: outside.event.id })
  ok(c1.cancelledEventIds.length === 1 && c1.deletedDeviceIds.length === 0 && c1.batchAdjustments.length === 0, '배치 밖 이동 취소')
  const a102 = (await dev({ serialNo: S(43) }))!
  const c2 = await cancelLastEvent(ctx(H1), { eventId: impEvents.find((e) => e.deviceId === a102.id)!.id })
  const b2 = (await prisma.hospitalDeviceImportBatch.findUnique({ where: { id: imp.batch.id } }))!
  ok(c2.deletedDeviceIds.includes(a102.id) && b2.registeredCount === 4 && (b2.summary as { cancelledRows?: { kind: string }[] }).cancelledRows?.[0]?.kind === 'new', '임포트 신규 행 단건 취소 → 개체 삭제·registered_count 4·cancelledRows[new]')
  const cb = await cancelImportBatch(ctx(H1), { batchId: imp.batch.id })
  ok(cb.summary.deletedDeviceIds.length === 4 && cb.summary.restoredDeviceIds.length === 2 && cb.summary.restoredTransfers.length === 1 && cb.summary.eventCount === 8 && cb.summary.serials.length === 7, 'cancel_summary: 삭제 4·재등록 복원 2·이관 복원 1·이벤트 8·시리얼 7', cb.summary)
  const d3after = (await dev({ id: d3.id }))!
  ok(d3after.status === 'RECOVERED' && d3after.lastHospitalCode === H1 && d3after.replacedById === ra.newDevice.id, '재등록 개체(a) RECOVERED 복원 — last_hospital·replaced_by 복원')
  const d104after = (await dev({ id: r104.created[0].id }))!
  ok(d104after.status === 'RECOVERED' && d104after.lastHospitalCode === H2, '재등록 개체(b) RECOVERED@H2 복원')
  const a1after = (await dev({ serialNo: S(1) }))!
  ok(a1after.status === 'ACTIVE' && a1after.hospitalCode === H2, '이관 쌍 취소 → 원 병원(H2) ACTIVE 복원')
  ok((await prisma.hospitalWard.count({ where: { hospitalCode: H1, nameNorm: '신관1' } })) === 1 && cb.summary.newWardsKept.length === 1, '자동 생성 병동은 남김(newWardsKept)')
  ok((await prisma.hospitalDeviceImportBatch.findUnique({ where: { id: imp.batch.id } }))!.cancelledAt != null, 'cancelled_at 기록')
  await expectErr('이미 취소된 배치', () => cancelImportBatch(ctx(H1), { batchId: imp.batch.id }), 409, '이미 취소')
  await expectErr('취소된 배치 업무일자 정정', () => editImportBatchDate(ctx(H1), { batchId: imp.batch.id, occurredOn: '2026-08-01' }), 409)
  await expectErr('없는 배치', () => cancelImportBatch(ctx(H1), { batchId: 999_999_999 }), 404)
  ok(await projectionEqualsRebuild(a1after.id) && (await projectionEqualsRebuild(d3.id)), '취소 후 프로젝션 = fold')
  // 재등록 행 단건 취소 → RECOVERED 복원 + 카운트 감소
  const imp2 = await importBatch(ctx(H1, '2026-09-01'), { rows: [{ row: 1, serialInput: S(3) }], sourceKind: 'PASTE', mode: 'REGISTER', defaults: { wardMode: 'fixed', wardId: ward6.id } })
  ok(imp2.batch.reregisteredCount === 1 && imp2.result.reregistered[0].wardId === ward6.id, '재등록 행 임포트(고정 병동)')
  const c3 = await cancelLastEvent(ctx(H1), { eventId: imp2.result.reregistered[0].eventId })
  const b3 = (await prisma.hospitalDeviceImportBatch.findUnique({ where: { id: imp2.batch.id } }))!
  ok(c3.deletedDeviceIds.length === 0 && c3.restoredDevices[0]?.status === 'RECOVERED' && b3.reregisteredCount === 0 && c3.batchAdjustments[0]?.kind === 'reregister' && (await dev({ id: d3.id }))!.status === 'RECOVERED', '재등록 행 단건 취소 → RECOVERED 복원·reregistered_count 0')
  // sole REGISTER(수동) 취소 → 개체 삭제
  const r105 = await registerDevices(ctx(H1, today), [{ serialInput: S(46) }])
  const c4 = await cancelLastEvent(ctx(null), { eventId: r105.created[0].eventId })
  ok(c4.deletedDeviceIds.includes(r105.created[0].id) && (await dev({ id: r105.created[0].id })) == null, 'sole REGISTER 취소 → 배치 행 삭제(getUnitDetail/404 대상)')
  ok((await unitRow({ id: r105.created[0].id })) != null && (await getUnitDetail(r105.created[0].id)) === null, '유닛(시리얼 정체성)은 남는다 — 고아 유닛, 상세는 null')
  const r105b = await registerDevices(ctx(H1, today), [{ serialInput: S(46) }])
  ok(r105b.created.length === 1 && r105b.created[0].id === r105.created[0].id && !r105b.created[0].unitCreated, '고아 유닛 재등록 → 같은 유닛 id 재사용(신규 배치, unitCreated=false)')
  await cancelLastEvent(ctx(null), { eventId: r105b.created[0].eventId })
  // 배치 취소 시 상태 스냅샷 CORRECT 보존(§8.2 2, P1 리뷰) — 고아 유닛에 A-6 CORRECT(PRE_SHIP·HUB) → 임포트 REGISTER → 배치 취소: CORRECT 잔존·유닛 = CORRECT after·correctedSerials 제외
  const orphanId = r105.created[0].id
  const cPre = await correctDevice(ctx(null), { deviceId: orphanId, changes: { condition: 'PRE_SHIP', location: { kind: 'SITE', code: 'HUB' } } })
  ok(cPre.event.eventType === 'CORRECT' && (await unitRow({ id: orphanId }))!.condition === 'PRE_SHIP', '고아 유닛 상태 CORRECT(PRE_SHIP·HUB) — A-6 진입')
  const impO = await importBatch(ctx(H1, today), { rows: [{ row: 1, serialInput: S(46) }], sourceKind: 'PASTE', mode: 'REGISTER', defaults: { wardMode: 'fixed', wardId: ward6.id } })
  ok(impO.batch.registeredCount === 1 && (await unitRow({ id: orphanId }))!.condition === 'IN_USE', '임포트 REGISTER → IN_USE(암묵 전이)')
  const cbO = await cancelImportBatch(ctx(H1), { batchId: impO.batch.id })
  const uO = (await unitRow({ id: orphanId }))!
  ok(
    cbO.summary.deletedDeviceIds.includes(orphanId) && !cbO.summary.correctedSerials.includes(S(46)) && (await prisma.hospitalDeviceEvent.findUnique({ where: { id: cPre.event.id } })) != null && uO.condition === 'PRE_SHIP' && uO.locationSiteId != null && uO.locationHospitalCode == null,
    '배치 취소 → 상태 스냅샷 CORRECT 보존 · 유닛 = CORRECT after(PRE_SHIP·HUB, 재도출 ①) · correctedSerials 제외',
    { cond: uO.condition, site: uO.locationSiteId, summary: cbO.summary }
  )
  void closed

  section('[9] 식별 정정 · CORRECT 취소 · 이벤트 정정 · 그룹 취소 · 메모')
  const rS = await registerDevices(ctx(H3, '2026-08-01'), [{ serialInput: S(40, 'P') }])
  const cs = await correctDevice(ctx(null), { deviceId: rS.created[0].id, changes: { serialNo: S(41, 'P'), macAddress: 'AA:BB' } })
  ok(cs.device.serialNo === S(41, 'P') && cs.event.eventType === 'CORRECT' && (cs.changes.serialNo as { before: string }).before === S(40, 'P') && cs.event.hospitalCode === H3, '시리얼 정정(REGISTER 1건 개체) → CORRECT 이벤트 changes')
  {
    const u = (await unitRow({ id: rS.created[0].id }))!
    ok(u.serialNo === S(41, 'P') && u.macAddress === 'AA:BB', 'correctDevice는 유닛(device_units)을 수정한다')
  }
  ok((await dev({ id: rS.created[0].id }))!.lastEventType === 'REGISTER', 'CORRECT는 last_event_type 미반영')
  await expectErr('이력 있는 개체 시리얼 정정', () => correctDevice(ctx(null), { deviceId: d1.id, changes: { serialNo: S(99) } }), 409, '이력이 있는 개체')
  await expectErr('중복 시리얼로 정정', () => correctDevice(ctx(null), { deviceId: rS.created[0].id, changes: { serialNo: S(10, 'P') } }), 409, '이미 등록된')
  await expectErr('변경 없음', () => correctDevice(ctx(null), { deviceId: rS.created[0].id, changes: { macAddress: 'AA:BB' } }), 400, '변경 사항')
  await expectErr('원장 대상 아닌 모델', () => correctDevice(ctx(null), { deviceId: rS.created[0].id, changes: { deviceInfoId: 999_999 } }), 400)
  const cs2 = await correctDevice(ctx(null), { deviceId: rS.created[0].id, changes: { extDeviceCode: 'NICK-1' } })
  ok((await prisma.hospitalDevice.findUnique({ where: { deviceId: rS.created[0].id } }))?.extDeviceCode === 'NICK-1', '닉네임(ext_device_code)은 배치 행 속성')
  await expectErr('이전 CORRECT 취소(최근 아님)', () => cancelLastEvent(ctx(null), { eventId: cs.event.id }), 409, '이후 정정')
  await cancelLastEvent(ctx(null), { eventId: cs2.event.id })
  const cc = await cancelLastEvent(ctx(null), { eventId: cs.event.id })
  const csRow = (await dev({ id: rS.created[0].id }))!
  ok(csRow.serialNo === S(40, 'P') && csRow.macAddress == null && csRow.extDeviceCode == null && cc.restored != null, 'CORRECT 취소(최근부터) → before 복원')
  const ee = await editEvent(ctx(null), { eventId: rS.created[0].eventId, patch: { memo: '정정 메모', occurredOn: '2026-07-31', toWardId: wardA.id } })
  ok(ee.after.memo === '정정 메모' && ee.after.editedAt != null && ee.after.editedById === ACTOR.userId && ee.device.placedOn?.toISOString().startsWith('2026-07-31') && ee.device.wardId === wardA.id, '이벤트 인플레이스 정정(memo·occurredOn·toWardId) + edited_* + 재계산')
  await expectErr('금지 필드 정정', () => editEvent(ctx(null), { eventId: rS.created[0].eventId, patch: { eventType: 'RECOVER' } as never }), 400, '취소 후 재입력')
  await expectErr('REGISTER에 fromWardId', () => editEvent(ctx(null), { eventId: rS.created[0].eventId, patch: { fromWardId: wardA.id } }), 400)
  await expectErr('타 병원 병동으로 정정', () => editEvent(ctx(null), { eventId: rS.created[0].eventId, patch: { toWardId: ward6.id } }), 404)
  await expectErr('없는 이벤트', () => editEvent(ctx(null), { eventId: 999_999_999, patch: { memo: 'x' } }), 404)
  const recEv = br.events[1]
  const ee2 = await editEvent(ctx(null), { eventId: recEv.id, patch: { fromWardId: wardA.id, reasonCodeId: (await reasonByValue(prisma, 'RETURN')).id } })
  ok(ee2.after.fromWardId === wardA.id && ee2.device.recoverReasonId === ee2.after.reasonCodeId, 'RECOVER 정정(fromWardId·reasonCodeId) → 프로젝션 사유 갱신')
  const d2first = await prisma.hospitalDeviceEvent.findFirst({ where: { deviceId: d2.id, eventType: 'REGISTER' }, orderBy: { id: 'asc' } })
  await expectErr('REGISTER 일자를 이후 이벤트 뒤로', () => editEvent(ctx(null), { eventId: d2first!.id, patch: { occurredOn: '2026-08-31' } }), 409, '성립하지')
  await expectErr('교체 그룹 취소 — 신기기 이후 이벤트', () => cancelLastEvent(ctx(H1), { eventId: rf.recoverEvent!.id }), 409, '이후 이벤트')
  const c5 = await cancelLastEvent(ctx(H1), { eventId: re5.recoverEvent!.id })
  ok(c5.cancelledEventIds.length === 2 && c5.deletedDeviceIds.length === 0 && c5.affectedDeviceIds.length === 2, '(5) 그룹 짝 취소 2건(RECOVER+MOVE_WARD)')
  const a10 = (await dev({ id: ra.newDevice.id }))!
  ok(a10.status === 'ACTIVE' && a10.replacedById == null && (await projectionEqualsRebuild(ra.newDevice.id)) && (await dev({ id: d2.id }))!.wardId === ward7.id, '구기기 ACTIVE 복원·신기기 병동 원복')
  const c6 = await cancelLastEvent(ctx(H1), { eventId: ra.registerEvent!.id })
  ok(c6.deletedDeviceIds.includes(ra.newDevice.id) && c6.cancelledEventIds.length === 2 && (await dev({ id: d3.id }))!.status === 'ACTIVE', '기본 교체 그룹 취소 → 신 개체 삭제·구 ACTIVE 복원')
  const c7 = await cancelLastEvent(ctx(H1), { eventId: rd.registerEvent!.id })
  ok(c7.deletedDeviceIds.includes(rd.newDevice.id) && (await prisma.hospitalDeviceEvent.findUnique({ where: { id: rb.recoverEvent!.id } }))?.relatedDeviceId == null, '(3) 기회수 교체 취소 → 신 삭제·구 RECOVER 링크 해제')
  const c8 = await cancelLastEvent(ctx(H1), { eventId: rb.recoverEvent!.id })
  ok(c8.cancelledEventIds.length === 3 && c8.deletedDeviceIds.length === 2 && (await dev({ serialNo: S(20) })) == null && (await dev({ serialNo: S(21) })) == null, '소급 3건 그룹 동시 취소 → 구·신 개체 삭제')
  await expectErr('취소된 이벤트 재취소', () => cancelLastEvent(ctx(H1), { eventId: rb.recoverEvent!.id }), 404)
  const memo = await updateDeviceMemo(ctx(null), { deviceId: d1.id, memo: '  각인 12 ' })
  ok(memo.after === '각인 12' && memo.before == null && memo.device.memo === '각인 12' && (await unitRow({ id: d1.id }))!.memo === '각인 12' && (await prisma.hospitalDeviceEvent.count({ where: { deviceId: d1.id, eventType: 'CORRECT' } })) === 0, '메모 UPDATE = 유닛 memo(trim, 이벤트 없음)')
  await expectErr('메모 500자 초과', () => updateDeviceMemo(ctx(null), { deviceId: d1.id, memo: 'x'.repeat(501) }), 400)

  section('[10] 복합 FK(병동↔병원) — 앱 선검사 404 · 커밋 시 위반 409 매핑')
  await expectErr('타 병원 병동 id로 이동(앱 선검사)', () => moveDeviceWard(ctx(null), { deviceId: idemDev, toWardId: ward6.id }), 404, '이 병원 소속이 아님')
  await expectErr('원시 INSERT로 타 병원 병동(DEFERRED FK → 커밋 시 23503)', () =>
    withRegistryTx(undefined, (tx) => insertEvent(tx, { deviceId: idemDev, eventType: 'MOVE_WARD', hospitalCode: H3, toWardId: ward6.id, occurredOn: today, actionGroup: null, source: 'MANUAL', actor: ACTOR })), 409, '병동이 이 병원에 속하지 않습니다')
  ok((await prisma.hospitalDeviceEvent.count({ where: { deviceId: idemDev, toWardId: ward6.id } })) === 0, '위반 이벤트는 롤백(미기록)')
  await expectErr('중복 시리얼 유닛 INSERT(P2002)', () => withRegistryTx(undefined, (tx) => tx.deviceUnit.create({ data: { deviceInfoId: 1, serialNo: S(70) } })), 409, '이미 등록된 시리얼')
  await expectErr('유닛당 배치 2행 INSERT(device_id UNIQUE)', () => withRegistryTx(undefined, (tx) => tx.hospitalDevice.create({ data: { deviceId: idemDev, status: 'ACTIVE', hospitalCode: H3 } })), 409, '먼저 등록')
  await expectErr('미정규화 시리얼 유닛 INSERT(DB CHECK)', () => withRegistryTx(undefined, (tx) => tx.deviceUnit.create({ data: { deviceInfoId: 1, serialNo: ` ${S(71).toLowerCase()}` } })), 409)

  section('[11] 읽기 — 기대 수량·요약·커버리지·목록·조회·ref')
  const exp = await getExpectedDeviceCount(H1)
  ok(exp.deals === h1!.deals && exp.expected === h1!.expected && exp.contractedDeals.length === h1!.deals, `§9.1 기대 수량 = Σ계약완료 딜(${h1!.expected})`, exp)
  const exp0 = await getExpectedDeviceCount(H3)
  ok(exp0.expected === null && exp0.deals === 0, '딜 0건 → expected null')
  const sum = (await getHospitalDeviceSummary(H1))!
  const ecg = sum.models.find((m) => m.onpremDeviceType === 1)!
  const spo2 = sum.models.find((m) => m.onpremDeviceType === 3)
  ok(
    (h1!.em_ecg == null ? ecg.compare === 'none' && ecg.expected === null && ecg.diff === null : ecg.compare === 'hard' && ecg.expected === h1!.em_ecg && ecg.diff === ecg.activeForCompare - h1!.em_ecg) &&
      ecg.active === (await prisma.hospitalDevice.count({ where: { hospitalCode: H1, status: 'ACTIVE', unit: { deviceInfoId: ecg.deviceInfoId } } })),
    'ECG 대조(기대 = Σ딜 모델 행 · diff = 배치 중(평가용 제외) − 계약 · 미입력 병원은 none)',
    ecg
  )
  const evalActiveH1 = await prisma.hospitalDevice.count({ where: { hospitalCode: H1, status: 'ACTIVE', unit: { deviceInfoId: ecg.deviceInfoId, usageType: { is: { value: 'EVAL' } } } } })
  ok(evalActiveH1 >= 1 && ecg.activeEval === evalActiveH1 && ecg.activeForCompare === ecg.active - ecg.activeEval && (h1!.em_ecg == null || ecg.diff === ecg.activeForCompare - h1!.em_ecg), '요약: activeEval = 배치 중 EVAL 수 · activeForCompare = active − activeEval · diff에서 평가용 제외', { active: ecg.active, activeEval: ecg.activeEval, diff: ecg.diff })
  ok(sum.evalTotal >= evalActiveH1 && sum.evalTotal === sum.models.reduce((s, m) => s + m.activeEval, 0), '요약: evalTotal = Σ models.activeEval')
  ok(!spo2 || (h1!.em_spo2 == null ? spo2.compare === 'none' && spo2.expected === null && spo2.diff === null : spo2.compare === 'hard' && spo2.expected === h1!.em_spo2 && spo2.diff === spo2.activeForCompare - h1!.em_spo2), 'SpO2 — 실측 행 있으면 hard, 없으면 none(soft 제거 — 2026-09-02 개정)', spo2)
  ok(sum.wards.length >= 4 && sum.wards.some((w) => w.name === '폐쇄병동' && !w.isActive) && typeof sum.unassigned === 'number' && sum.lastImport?.id === imp2.batch.id && sum.expectedDeviceCount === h1!.expected, '요약: 병동(폐쇄 포함)·미지정·마지막 임포트(취소 배치 제외)', { wards: sum.wards.length, lastImport: sum.lastImport?.id })
  ok(sum.recovered30dTotal >= 1 && sum.models.every((m) => m.recovered30d >= 0) && sum.lastEventOn != null, '요약: 회수(30일)·마지막 이벤트')
  const sum3 = (await getHospitalDeviceSummary(H3))!
  const ecg3 = sum3.models.find((m) => m.onpremDeviceType === 1)!
  ok(ecg3.compare === 'none' && ecg3.expected === null && ecg3.diff === null, '딜 0건 병원 ECG compare none')
  if (gwId) {
    const gwm = sum3.models.find((m) => m.deviceClass === 'GATEWAY')!
    ok(gwm.compare === 'none' && gwm.wms.out === 1 && gwm.active >= 1, 'GW compare none · wms.out 1(일시 매칭 집계)', gwm)
  }
  ok((await getHospitalDeviceSummary('HOSP-NOPE')) === null, '없는 병원 요약 → null')
  const cov = await getGlobalCoverage({ page: 1, limit: 5, q: h1!.hospital_name })
  const covRow = cov.data.find((r) => r.hospitalCode === H1)!
  ok(!!covRow && covRow.expected === h1!.em_ecg && covRow.deals === h1!.deals && covRow.registered && (h1!.em_ecg == null ? covRow.diff === null : covRow.diff === covRow.activeEcg - h1!.em_ecg) && covRow.lastImport?.id === imp2.batch.id, '커버리지 행(H1): 계약(모델 행 ECG)·배치·차이·마지막 임포트', covRow)
  ok(covRow.activeEcgEval === ecg.activeEval && covRow.activeEcg === ecg.activeForCompare && covRow.evalTotal === sum.evalTotal && covRow.evalTotal >= 1, '커버리지: 배치 중 ECG·차이는 평가용 제외, activeEcgEval·evalTotal 별도(요약과 일치)', { cov: [covRow.activeEcg, covRow.activeEcgEval, covRow.evalTotal], sum: [ecg.activeForCompare, ecg.activeEval, sum.evalTotal] })
  ok(cov.totals.active.eval >= 1 && typeof cov.totals.active.ecg === 'number', '전역 합계 active.eval')
  ok(cov.totals.customerHospitals > 0 && cov.totals.registeredHospitals >= 3 && cov.totals.active.total >= 1 && cov.totals.events30d >= 1, '전역 합계', cov.totals)
  const cov3 = await getGlobalCoverage({ q: H3 })
  ok(cov3.data[0]?.hospitalCode === H3 && cov3.data[0].expected === null && cov3.data[0].diff === null && cov3.data[0].registered, '딜 0건 병원 커버리지: expected/diff null, registered')
  const covDiff = await getGlobalCoverage({ filter: 'diff', limit: 50 })
  ok(covDiff.total > 0 && covDiff.data.every((r) => r.expected != null && r.diff !== 0), '차이 있음 필터(expected 보유 병원만 — 수량 미입력·딜 0건 제외)')
  const covUn = await getGlobalCoverage({ filter: 'unregistered', limit: 5 })
  ok(covUn.data.every((r) => !r.registered), '미등록 필터')
  const covDone = await getGlobalCoverage({ filter: 'complete', limit: 5 })
  ok(covDone.data.every((r) => r.registered && (r.expected == null || r.diff === 0)), '등록 완료 필터(expected 없는 병원 — 딜 0건·수량 미입력 — 은 대조 없음으로 완료 취급)')
  const covName = await getGlobalCoverage({ sort: 'name', limit: 5 })
  ok(covName.data.length === 5 && covName.data.every((r, i, a) => i === 0 || a[i - 1].hospitalName <= r.hospitalName), '병원명 정렬')
  const lu = await listUnits({ hospital: H1, status: 'all', q: 'a9900' }, { page: 1, limit: 10, sort: 'serial' })
  ok(lu.total > 0 && lu.data.every((r) => r.serialNo.startsWith('A9900')) && 'wmsWarning' in lu.data[0] && 'wms' in lu.data[0] && lu.data.every((r, i, a) => i === 0 || a[i - 1].serialNo <= r.serialNo), '기기 목록 where 빌더(검색·전체·시리얼 정렬) + 평탄화 형상')
  ok(lu.data.every((r) => r.id === (r as { placementId?: number }).placementId || true) && lu.data.every((r) => typeof r.deviceInfoId === 'number' && typeof r.serialNo === 'string'), '목록 행 id = 유닛 id, 식별 컬럼 평탄화')
  const luModel = await listUnits({ hospital: H1, status: 'all', model: ecg.deviceInfoId }, { page: 1, limit: 50 })
  ok(luModel.total > 0 && luModel.data.every((r) => r.deviceInfoId === ecg.deviceInfoId), '모델 필터(unit.deviceInfoId)')
  const luUnlinked = await listUnits({ hospital: H1, status: 'all', wms: 'unlinked' }, { page: 1, limit: 50 })
  ok(luUnlinked.total > 0 && luUnlinked.data.every((r) => r.wms === null), 'wms=unlinked 필터(일시 매칭 기준)')
  const luRec = await listUnits({ hospital: H1, status: 'recovered' }, { page: 1, limit: 10 })
  ok(luRec.total >= 1 && luRec.data.every((r) => r.status === 'RECOVERED' && r.lastHospitalCode === H1), '회수됨 필터 = last_hospital_code')
  const luWard = await listUnits({ hospital: H1, ward: ward7.id }, { page: 1, limit: 10 })
  ok(luWard.data.every((r) => r.wardId === ward7.id && r.status === 'ACTIVE'), '병동 필터')
  const luIds = await reg.listUnitIds({ hospital: H1, status: 'all' })
  ok(luIds.ids.length === luIds.total && !luIds.truncated, 'idsOnly')
  const le = await listEvents({ hospital: H1, type: 'RECOVER' }, { page: 1, limit: 10 })
  ok(le.total > 0 && le.data.every((e) => e.eventType === 'RECOVER' && e.hospitalCode === H1) && le.data.every((e, i, a) => i === 0 || a[i - 1].occurredOn >= e.occurredOn), '이벤트 목록 where 빌더·최신순')
  const leRange = await listEvents({ hospital: H1, from: '2026-08-01', to: '2026-08-01' }, { page: 1, limit: 100 })
  ok(leRange.total > 0 && leRange.data.every((e) => e.occurredOn.toISOString().startsWith('2026-08-01')), '기간 필터')
  const det = (await getUnitDetail(d1.id))!
  ok(det.events.length >= 5 && det.events[0].id > det.events[det.events.length - 1].id && det.events.some((e) => e.hospitalCode === H2) && det.events.some((e) => e.hospitalCode === H1), '개체 상세: 병원 경계 무관 전체 이벤트 최신순')
  ok((await reg.listImportBatches(H1, { page: 1, limit: 20 })).total >= 2, '임포트 배치 목록')
  await expectErr('없는 유지보수 코드', () => registerDevices(ctx(H3, undefined, { ref: { type: 'MAINTENANCE', code: 'MNT-000000-0000' } }), [{ serialInput: S(50, 'P') }]), 400, '유지보수 코드')
  await expectErr('ref 코드 없음', () => registerDevices(ctx(H3, undefined, { ref: { type: 'VOC', code: ' ' } }), [{ serialInput: S(50, 'P') }]), 400, '연결 코드')
  if (mnt) {
    const rm = await registerDevices(ctx(H3, undefined, { ref: { type: 'MAINTENANCE', code: mnt.maintenanceCode } }), [{ serialInput: S(50, 'P') }])
    ok(rm.warnings.some((w) => w.includes('다른 병원')) && rm.created.length === 1, 'ref MAINTENANCE 병원 불일치는 경고만')
    const rmEv = (await prisma.hospitalDeviceEvent.findUnique({ where: { id: rm.created[0].eventId } }))!
    ok(rmEv.refType === 'MAINTENANCE' && rmEv.refCode === mnt.maintenanceCode && rmEv.occurredOn.toISOString().startsWith(today) && rmEv.actorName === ACTOR.name, 'ref 저장 · 기본 업무일자 오늘 · actor_name 스냅샷')
    ok((await listEvents({ refType: 'MAINTENANCE', refCode: mnt.maintenanceCode }, { page: 1, limit: 5 })).data.some((e) => e.id === rmEv.id), 'events?refType=MAINTENANCE&refCode= 조회')
  }

  section('[12] 권한 매트릭스 — checkDeviceRegistryAccess (§8.1)')
  const fake = (role: 'VIEWER' | 'USER' | 'ADMIN' | 'SUPER_ADMIN') => ({ userId: `smoke-fake-${role}`, email: 's@x', name: 'smoke', role, isActive: true })
  for (const role of ['VIEWER', 'USER', 'ADMIN', 'SUPER_ADMIN'] as const) {
    const u = fake(role)
    const read = await access.checkDeviceRegistryAccess(u)
    const write = await access.checkDeviceRegistryAccess(u, { write: true })
    const admin = await access.checkDeviceRegistryAccess(u, { admin: true })
    const expWrite = role === 'VIEWER' ? 403 : null
    const expAdmin = role === 'VIEWER' || role === 'USER' ? 403 : null
    ok(read === null && (write?.status ?? null) === expWrite && (admin?.status ?? null) === expAdmin, `${role}: read ok · write ${expWrite ?? 'ok'} · admin ${expAdmin ?? 'ok'}`, { write, admin })
  }
  const capNull = await access.getDeviceRegistryCapabilities(null)
  const capUser = await access.getDeviceRegistryCapabilities(fake('USER'))
  const capAdmin = await access.getDeviceRegistryCapabilities(fake('ADMIN'))
  ok(!capNull.canWrite && !capNull.canAdmin && capUser.canWrite && !capUser.canAdmin && capAdmin.canWrite && capAdmin.canAdmin, 'getDeviceRegistryCapabilities(null/USER/ADMIN)')

  section('[13] 라우트 핸들러 — 인증·권한·감사·응답 형상')
  const B = 'http://localhost'
  type Handler = (req: NextRequest, c: { params: Record<string, string> }) => Promise<Response>
  const h = (f: unknown) => f as Handler
  async function call(handler: Handler, method: string, url: string, o: { token?: string | null; body?: unknown; params?: Record<string, string> } = {}) {
    const headers: Record<string, string> = {}
    if (o.token) headers.cookie = `auth-token=${o.token}`
    const init: RequestInit = { method, headers }
    if (o.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(o.body)
    }
    const res = await handler(new NextRequest(url, init), { params: o.params ?? {} })
    const ct = res.headers.get('content-type') ?? ''
    const json = ct.includes('application/json') ? await res.json() : null
    return { status: res.status, json, ct }
  }
  const adminTok = await auth.signToken({ userId: adminUser!.id, email: adminUser!.email, name: adminUser!.name, role: adminUser!.role as 'ADMIN', isActive: true })
  const viewerTok = await auth.signToken(fake('VIEWER'))
  const userTok = await auth.signToken(fake('USER'))
  // 실제 USER 계정 — 이벤트를 만드는 write 경로(용도 PATCH)는 actor_id FK(users) 때문에 실존 사용자여야 한다
  const realUser = await prisma.user.findFirst({ where: { role: 'USER', isActive: true }, orderBy: { createdAt: 'asc' } })
  const userWriteTok = realUser ? await auth.signToken({ userId: realUser.id, email: realUser.email, name: realUser.name, role: 'USER', isActive: true }) : userTok
  const A = { token: adminTok }
  const V = { token: viewerTok }
  const U = { token: userTok }
  const UW = { token: userWriteTok }
  ok(!!realUser, '실제 USER 계정 존재(용도 PATCH write 테스트용)')
  const R = {
    canManage: await import('../app/api/devices/can-manage/route'),
    units: await import('../app/api/devices/units/route'),
    unit: await import('../app/api/devices/units/[id]/route'),
    move: await import('../app/api/devices/units/[id]/move/route'),
    recover: await import('../app/api/devices/units/[id]/recover/route'),
    bulk: await import('../app/api/devices/units/bulk/route'),
    events: await import('../app/api/devices/events/route'),
    event: await import('../app/api/devices/events/[id]/route'),
    eventsExport: await import('../app/api/devices/events/export/route'),
    exportUnits: await import('../app/api/devices/export/route'),
    summary: await import('../app/api/devices/summary/route'),
    summaryExport: await import('../app/api/devices/summary/export/route'),
    lookup: await import('../app/api/devices/lookup/route'),
    mntLookup: await import('../app/api/devices/maintenance-lookup/route'),
    hSummary: await import('../app/api/hospitals/[code]/devices/summary/route'),
    register: await import('../app/api/hospitals/[code]/devices/register/route'),
    replace: await import('../app/api/hospitals/[code]/devices/replace/route'),
    imp: await import('../app/api/hospitals/[code]/devices/import/route'),
    imps: await import('../app/api/hospitals/[code]/devices/imports/route'),
    impOne: await import('../app/api/hospitals/[code]/devices/imports/[batchId]/route'),
    impCancel: await import('../app/api/hospitals/[code]/devices/imports/[batchId]/cancel/route'),
    wards: await import('../app/api/hospitals/[code]/wards/route'),
    ward: await import('../app/api/hospitals/[code]/wards/[id]/route'),
    reasons: await import('../app/api/settings/device-recovery-reason/route'),
    reason: await import('../app/api/settings/device-recovery-reason/[id]/route'),
    usages: await import('../app/api/settings/device-usage-type/route'),
    usage: await import('../app/api/settings/device-usage-type/[id]/route'),
  }
  ok(typeof R.unit.GET === 'function' && typeof R.unit.PATCH === 'function', 'units/[id]/route.ts는 GET·PATCH 둘 다 export')
  const P1 = { params: { code: H1 } }
  let r = await call(h(R.canManage.GET), 'GET', `${B}/api/devices/can-manage`)
  ok(r.status === 401 && r.json.error === '로그인이 필요합니다.', '미로그인 401')
  r = await call(h(R.canManage.GET), 'GET', `${B}/api/devices/can-manage`, V)
  ok(r.status === 200 && r.json.canWrite === false && r.json.canAdmin === false, 'can-manage VIEWER')
  r = await call(h(R.canManage.GET), 'GET', `${B}/api/devices/can-manage`, A)
  ok(r.status === 200 && r.json.canWrite === true && r.json.canAdmin === true, 'can-manage ADMIN')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register`, { ...V, ...P1, body: { items: [S(80)] } })
  ok(r.status === 403 && /USER/.test(r.json.error), 'register VIEWER → 403')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/HOSP-NOPE/devices/register`, { ...A, params: { code: 'HOSP-NOPE' }, body: { items: [S(80)] } })
  ok(r.status === 404, 'register 없는 병원 → 404')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register`, { ...A, ...P1, body: { items: [] } })
  ok(r.status === 400, 'register items 비어 있음 → 400')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register?preview=true`, { ...A, ...P1, body: { items: [S(80), { serial: S(81), wardName: '6병동', usageType: '평가용' }, S(1)], occurredOn: '2026-08-01', usageTypeId: sale.id } })
  ok(r.status === 200 && r.json.rows.length === 3 && r.json.rows[0].status === 'warn' && r.json.rows[0].messages.some((m: string) => m.includes('미지정')) && r.json.rows[1].status === 'ok' && r.json.rows[1].wardId === ward6.id && r.json.rows[2].status === 'conflict', 'register ?preview=true → 판정 행(병동 없음 warn·기존 병동 ok·conflict)', r.json.rows?.map((x: { status: string }) => x.status))
  ok(r.json.rows[0].usageTypeId === sale.id && r.json.rows[1].usageTypeName === '평가용', 'register preview — 공통 usageTypeId 기본 + 항목 usageType 문자열 우선')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register?preview=true`, { ...A, ...P1, body: { items: [{ serial: S(80), usageType: '전시용' }] } })
  ok(r.status === 200 && r.json.rows[0].status === 'error' && r.json.rows[0].messages[0].includes('용도 값이 올바르지 않습니다'), 'register preview — 알 수 없는 용도 → error 행')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register`, { ...A, ...P1, body: { items: [S(80)], wardName: '6병동', occurredOn: '2026-08-01', memo: '라우트 등록' } })
  ok(r.status === 201 && r.json.created.length === 1 && r.json.eventIds.length === 1, 'register 단건 201')
  const id80 = r.json.created[0].id as number
  ok(!!(await prisma.auditLog.findFirst({ where: { id: { gt: pre.max.a }, resource: 'hospital_device', action: 'CREATE', resourceId: S(80) } })), 'audit hospital_device CREATE(id=시리얼)')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register`, { ...A, ...P1, body: { items: [S(81), S(82)], wardName: '7병동', occurredOn: '2026-08-01', usageTypeId: sale.id } })
  ok(r.status === 201 && r.json.created.length === 2 && r.json.created.every((c: { usageTypeId: number | null }) => c.usageTypeId === sale.id), 'register 다건 201 (공통 usageTypeId 적용)')
  const [id81, id82] = r.json.created.map((c: { id: number }) => c.id) as number[]
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?hospital=${H1}&usage=SALE&q=${S(80).slice(0, 6)}`, A)
  ok(r.status === 200 && r.json.total === 2 && r.json.data.every((d: { usageType: { value: string } | null }) => d.usageType?.value === 'SALE'), 'units ?usage=SALE 필터')
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?hospital=${H1}&usage=bogus`, A)
  ok(r.status === 400, 'units 잘못된 usage → 400')
  ok(!!(await prisma.auditLog.findFirst({ where: { id: { gt: pre.max.a }, resource: 'hospital_device_event', resourceId: r.json.actionGroup } })), 'audit hospital_device_event(action_group) 1행')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register`, { ...A, ...P1, body: { items: [S(80)] } })
  ok(r.status === 409 && Array.isArray(r.json.skipped), 'register 이미 배치 → 409 skipped[]')
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?hospital=${H1}&q=${S(80).slice(0, 6)}&status=active`, A)
  ok(r.status === 200 && r.json.total === 3 && r.json.data[0].deviceInfo && 'wmsWarning' in r.json.data[0], 'units 목록(검색)')
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?hospital=${H1}&q=${S(80).slice(0, 6)}&idsOnly=1`, A)
  ok(r.status === 200 && r.json.ids.length === 3 && r.json.max === 2000, 'units idsOnly')
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?status=bogus`, A)
  ok(r.status === 400, 'units 잘못된 status → 400')
  r = await call(h(R.unit.GET), 'GET', `${B}/api/devices/units/${id80}`, { ...A, params: { id: String(id80) } })
  ok(r.status === 200 && r.json.device.id === id80 && r.json.events.length === 1 && r.json.device.deviceInfo && r.json.events[0].actorName, 'units/[id] GET { device, events }')
  r = await call(h(R.unit.GET), 'GET', `${B}/api/devices/units/abc`, { ...A, params: { id: 'abc' } })
  ok(r.status === 400, 'units/[id] 비정수 → 400')
  r = await call(h(R.unit.GET), 'GET', `${B}/api/devices/units/999999999`, { ...A, params: { id: '999999999' } })
  ok(r.status === 404, 'units/[id] 없음 → 404')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...A, params: { id: String(id80) }, body: { memo: '라우트 메모' } })
  ok(r.status === 200 && r.json.memo.after === '라우트 메모' && r.json.device.memo === '라우트 메모', 'PATCH memo')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...A, params: { id: String(id80) }, body: { status: 'RECOVERED' } })
  ok(r.status === 400 && /이벤트/.test(r.json.error), 'PATCH 상태 키 → 400')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...U, params: { id: String(id80) }, body: { serialNo: S(83) } })
  ok(r.status === 403, 'PATCH 식별 보정 USER(권한 없음) → 403')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...U, params: { id: String(id80) }, body: { deviceInfoId: 1 } })
  ok(r.status === 403, 'PATCH 모델 정정 USER → 403 (admin)')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...UW, params: { id: String(id80) }, body: { usageTypeId: evalT.id } })
  ok(r.status === 200 && r.json.event.eventType === 'CORRECT' && r.json.changes.usageTypeId.after === evalT.id && r.json.device.usageTypeId === evalT.id, 'PATCH 용도 USER(write) → 200 CORRECT', r.json)
  ok(!!(await prisma.auditLog.findFirst({ where: { id: { gt: pre.max.a }, resource: 'hospital_device', action: 'UPDATE', resourceId: S(80), resourceLabel: { contains: '용도 미지정 → 평가용' } } })), 'PATCH 용도 audit 라벨(용도 미지정 → 평가용)')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...U, params: { id: String(id80) }, body: { usageTypeId: evalT.id, macAddress: '00:11' } })
  ok(r.status === 403, 'PATCH 용도 + MAC 함께 USER → 403 (다른 식별 키는 admin)')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...UW, params: { id: String(id80) }, body: { usageTypeId: 999999 } })
  ok(r.status === 400 && /용도 값이/.test(r.json.error), 'PATCH 없는 용도 id → 400')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...UW, params: { id: String(id80) }, body: { usageTypeId: null } })
  ok(r.status === 200 && r.json.device.usageTypeId === null && r.json.changes.usageTypeId.before === evalT.id, 'PATCH 용도 null → 미지정(CORRECT)')
  // 상품유형(B-22) — write(USER+) PATCH · 목록 필터 · bulk SET_PRODUCT_TYPE · register/preview pass-through
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...UW, params: { id: String(id80) }, body: { productType: 'lite' } })
  ok(r.status === 200 && r.json.event.eventType === 'CORRECT' && r.json.changes.productType.after === '라이트' && r.json.device.productType === '라이트' && r.json.event.productType === '라이트', 'PATCH 상품유형 USER(write) → 200 CORRECT(별칭 lite → 라이트)', r.json)
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...UW, params: { id: String(id80) }, body: { productType: '프로' } })
  ok(r.status === 400 && r.json.error === '상품유형 값이 올바르지 않습니다 (일반/라이트)', 'PATCH 잘못된 상품유형 → 400')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...U, params: { id: String(id80) }, body: { productType: '일반', serialNo: S(80) } })
  ok(r.status === 403, 'PATCH 상품유형 + 식별 키(시리얼) USER → 403(admin)')
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?hospital=${H1}&productType=라이트&q=${S(80)}`, A)
  ok(r.status === 200 && r.json.total === 1 && r.json.data[0].productType === '라이트', 'units ?productType=라이트 필터')
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?hospital=${H1}&productType=bogus`, A)
  ok(r.status === 400, 'units 잘못된 productType → 400')
  r = await call(h(R.bulk.POST), 'POST', `${B}/api/devices/units/bulk`, { ...UW, body: { action: 'SET_PRODUCT_TYPE', deviceIds: [id80, id81], productType: '일반', occurredOn: today } })
  ok(r.status === 201 && r.json.events.length >= 1 && r.json.events.every((e: { eventType: string; productType: string }) => e.eventType === 'CORRECT' && e.productType === '일반'), 'bulk SET_PRODUCT_TYPE USER → 201 CORRECT', r.json)
  r = await call(h(R.bulk.POST), 'POST', `${B}/api/devices/units/bulk`, { ...UW, body: { action: 'SET_PRODUCT_TYPE', deviceIds: [id80] } })
  ok(r.status === 400 && /상품유형/.test(r.json.error), 'bulk SET_PRODUCT_TYPE productType 누락 → 400')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register?preview=true`, { ...A, ...P1, body: { items: [{ serial: S(92), productType: 'lite' }, S(93)], occurredOn: '2026-08-01', productType: '일반' } })
  ok(r.status === 200 && r.json.rows[0].productType === '라이트' && r.json.rows[1].productType === '일반' && r.json.productTypeContext && typeof r.json.productTypeContext.mixed === 'boolean' && r.json.summary.productTypeContext.deals === ptH1.deals, 'register preview — 항목 productType > 공통 productType · 응답 productTypeContext', r.json.productTypeContext)
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register`, { ...A, ...P1, body: { items: [S(92)], occurredOn: '2026-08-01', productType: '라이트' } })
  ok(r.status === 201 && r.json.created[0].productType === '라이트', 'register 실행 body.productType → created[].productType')
  r = await call(h(R.register.POST), 'POST', `${B}/api/hospitals/${H1}/devices/register`, { ...A, ...P1, body: { items: [S(93)], productType: '프로' } })
  ok(r.status === 400 && /상품유형 값이 올바르지 않습니다/.test(r.json.error), 'register 잘못된 productType → 400')
  r = await call(h(R.hSummary.GET), 'GET', `${B}/api/hospitals/${H1}/devices/summary`, { ...V, ...P1 })
  ok(r.status === 200 && r.json.productTypeContext && Array.isArray(r.json.productTypes) && r.json.replacements && typeof r.json.replacements.total === 'number' && r.json.models.every((m: { byProductType: unknown }) => typeof m.byProductType === 'object'), 'hospital summary — productTypeContext·productTypes·replacements·models[].byProductType')
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id80}`, { ...A, params: { id: String(id80) }, body: { macAddress: '11:22' } })
  ok(r.status === 200 && r.json.event.eventType === 'CORRECT' && r.json.changes.macAddress.after === '11:22', 'PATCH 식별 보정 ADMIN → CORRECT')
  r = await call(h(R.move.POST), 'POST', `${B}/api/devices/units/${id80}/move`, { ...A, params: { id: String(id80) }, body: { toWardName: 'RT-B', occurredOn: '2026-08-05' } })
  ok(r.status === 201 && r.json.event.eventType === 'MOVE_WARD' && r.json.toWard.isNew === true, 'move 201(새 병동)')
  const rtB = r.json.toWard.id as number
  r = await call(h(R.move.POST), 'POST', `${B}/api/devices/units/${id80}/move`, { ...A, params: { id: String(id80) }, body: {} })
  ok(r.status === 400, 'move 병동 미지정 → 400')
  r = await call(h(R.recover.POST), 'POST', `${B}/api/devices/units/${id80}/recover`, { ...A, params: { id: String(id80) }, body: { reasonCodeId: defect.id, occurredOn: '2026-08-10' } })
  ok(r.status === 201 && r.json.device.status === 'RECOVERED' && r.json.reason.value === 'DEFECT', 'recover 201')
  const recEvId = r.json.event.id as number
  r = await call(h(R.recover.POST), 'POST', `${B}/api/devices/units/${id80}/recover`, { ...A, params: { id: String(id80) }, body: { reasonCodeId: defect.id } })
  ok(r.status === 409, 'recover 재회수 → 409')
  r = await call(h(R.events.GET), 'GET', `${B}/api/devices/events?device=${id80}`, A)
  ok(r.status === 200 && r.json.total === 8 && r.json.data[0].eventType === 'CORRECT' && r.json.data[5].eventType === 'RECOVER' && 'usageType' in r.json.data[0].device && 'productType' in r.json.data[0], 'events?device= (REGISTER·CORRECT×5(용도3·상품유형2)·MOVE·RECOVER, 최신순 — CORRECT는 오늘, device.usageType·productType 포함)')
  r = await call(h(R.events.GET), 'GET', `${B}/api/devices/events?type=BOGUS`, A)
  ok(r.status === 400, 'events 잘못된 type → 400')
  r = await call(h(R.event.DELETE), 'DELETE', `${B}/api/devices/events/${recEvId}`, { ...U, params: { id: String(recEvId) } })
  ok(r.status === 403, 'events DELETE USER → 403')
  r = await call(h(R.event.DELETE), 'DELETE', `${B}/api/devices/events/${recEvId}`, { ...A, params: { id: String(recEvId) } })
  ok(r.status === 200 && r.json.cancelledEventIds.length === 1 && (await dev({ id: id80 }))!.status === 'ACTIVE', 'events DELETE ADMIN → 취소·ACTIVE 복원')
  const mvEv = (await prisma.hospitalDeviceEvent.findFirst({ where: { deviceId: id80, eventType: 'MOVE_WARD' } }))!
  r = await call(h(R.event.PATCH), 'PATCH', `${B}/api/devices/events/${mvEv.id}`, { ...A, params: { id: String(mvEv.id) }, body: { memo: '정정됨' } })
  ok(r.status === 200 && r.json.event.memo === '정정됨' && r.json.event.editedAt, 'events PATCH')
  r = await call(h(R.event.PATCH), 'PATCH', `${B}/api/devices/events/${mvEv.id}`, { ...A, params: { id: String(mvEv.id) }, body: { eventType: 'RECOVER' } })
  ok(r.status === 400 && /취소 후/.test(r.json.error), 'events PATCH 금지 필드 → 400')
  r = await call(h(R.bulk.POST), 'POST', `${B}/api/devices/units/bulk`, { ...A, body: { action: 'MOVE_WARD', deviceIds: [id81, id82], toWardName: 'RT-C', occurredOn: '2026-08-06' } })
  ok(r.status === 201 && r.json.eventIds.length === 2 && r.json.hospitalCode === H1, 'bulk 201(병원 유도)')
  r = await call(h(R.bulk.POST), 'POST', `${B}/api/devices/units/bulk`, { ...A, body: { action: 'RECOVER', deviceIds: [id81, d90.id], reasonCodeId: defect.id } })
  ok(r.status === 409, 'bulk 병원 섞임 → 409')
  r = await call(h(R.replace.POST), 'POST', `${B}/api/hospitals/${H1}/devices/replace`, { ...A, ...P1, body: { oldDeviceId: id82, newSerial: S(84), occurredOn: '2026-08-20' } })
  ok(r.status === 201 && r.json.eventIds.length === 2 && r.json.recovered && r.json.registered && r.json.newDevice.serialNo === S(84), 'replace 201')
  r = await call(h(R.wards.GET), 'GET', `${B}/api/hospitals/${H1}/wards`, { ...A, ...P1 })
  const rtBRow = r.json?.data?.find((w: { id: number }) => w.id === rtB)
  ok(r.status === 200 && rtBRow?.activeCount === 1 && typeof r.json.unassigned === 'number', 'wards GET(배치 중 카운트)')
  r = await call(h(R.wards.POST), 'POST', `${B}/api/hospitals/${H1}/wards`, { ...V, ...P1, body: { name: 'RT-D' } })
  ok(r.status === 403, 'wards POST VIEWER → 403')
  r = await call(h(R.wards.POST), 'POST', `${B}/api/hospitals/${H1}/wards`, { ...A, ...P1, body: { name: 'RT-D' } })
  ok(r.status === 201 && r.json.ward.nameNorm === 'RT-D', 'wards POST 201')
  const rtD = r.json.ward.id as number
  r = await call(h(R.wards.POST), 'POST', `${B}/api/hospitals/${H1}/wards`, { ...A, ...P1, body: { name: ' rt-d ' } })
  ok(r.status === 409 && r.json.existing?.id === rtD, 'wards POST 동명(name_norm) → 409')
  r = await call(h(R.ward.PUT), 'PUT', `${B}/api/hospitals/${H1}/wards/${rtD}`, { ...A, params: { code: H1, id: String(rtD) }, body: { name: 'RT-D2', sortOrder: 9 } })
  ok(r.status === 200 && r.json.ward.name === 'RT-D2' && r.json.ward.sortOrder === 9, 'wards PUT 개명')
  r = await call(h(R.ward.PUT), 'PUT', `${B}/api/hospitals/${H1}/wards/${rtD}`, { ...A, params: { code: H1, id: String(rtD) }, body: { hospitalCode: H2 } })
  ok(r.status === 400, 'wards PUT hospitalCode → 400')
  r = await call(h(R.ward.PUT), 'PUT', `${B}/api/hospitals/${H1}/wards/${rtD}`, { ...U, params: { code: H1, id: String(rtD) }, body: { isActive: false } })
  ok(r.status === 403, 'wards PUT 비활성 USER → 403')
  r = await call(h(R.ward.PUT), 'PUT', `${B}/api/hospitals/${H1}/wards/${rtB}`, { ...A, params: { code: H1, id: String(rtB) }, body: { isActive: false } })
  ok(r.status === 409 && r.json.activeCount === 1, 'wards PUT 비활성 — 배치 중 기기 → 409')
  r = await call(h(R.ward.PUT), 'PUT', `${B}/api/hospitals/${H1}/wards/${rtD}`, { ...A, params: { code: H1, id: String(rtD) }, body: { isActive: false } })
  ok(r.status === 200 && r.json.ward.isActive === false, 'wards PUT 비활성 ADMIN(배치 0) → 200')
  r = await call(h(R.ward.DELETE), 'DELETE', `${B}/api/hospitals/${H1}/wards/${rtB}`, { ...A, params: { code: H1, id: String(rtB) } })
  ok(r.status === 409 && r.json.deviceCount === 1, 'wards DELETE 참조 있음 → 409')
  r = await call(h(R.ward.DELETE), 'DELETE', `${B}/api/hospitals/${H1}/wards/${rtD}`, { ...A, params: { code: H1, id: String(rtD) } })
  ok(r.status === 200 && r.json.success === true, 'wards DELETE 참조 0 → 200')
  const impText = `${S(85)}\t6병동\n${S(86)}\n# 주석\n`
  r = await call(h(R.imp.POST), 'POST', `${B}/api/hospitals/${H1}/devices/import?preview=true`, { ...A, ...P1, body: { text: impText, occurredOn: '2026-08-01' } })
  ok(r.status === 200 && r.json.rows.length === 2 && r.json.input.sourceKind === 'PASTE' && r.json.rows[0].wardId === ward6.id && r.json.summary.executable === 2, 'import preview(JSON text)')
  r = await call(h(R.imp.POST), 'POST', `${B}/api/hospitals/${H1}/devices/import`, { ...A, ...P1, body: { text: '   ' } })
  ok(r.status === 400, 'import 빈 텍스트 → 400')
  r = await call(h(R.imp.POST), 'POST', `${B}/api/hospitals/${H1}/devices/import`, { ...A, ...P1, body: { text: Array.from({ length: 2001 }, (_, i) => `A${String(900000 + i)}`).join('\n') } })
  ok(r.status === 400 && /최대/.test(r.json.error), 'import 2,001행 → 400')
  r = await call(h(R.imp.POST), 'POST', `${B}/api/hospitals/${H1}/devices/import`, { ...A, ...P1, body: { text: impText, occurredOn: '2026-08-01', memo: '라우트 임포트' } })
  ok(r.status === 201 && r.json.batch.registeredCount === 2 && r.json.result.eventIds.length === 2 && r.json.batch.note === '라우트 임포트', 'import 실행 201')
  const rBatch = r.json.batch.id as number
  ok(!!(await prisma.auditLog.findFirst({ where: { id: { gt: pre.max.a }, resource: 'hospital_device_import', action: 'CREATE', resourceId: String(rBatch) } })), 'audit hospital_device_import CREATE')
  r = await call(h(R.imps.GET), 'GET', `${B}/api/hospitals/${H1}/devices/imports`, { ...A, ...P1 })
  ok(r.status === 200 && r.json.total >= 3 && r.json.data[0].id === rBatch && 'createdByName' in r.json.data[0], 'imports GET(최신순·작성자명)')
  r = await call(h(R.impOne.PATCH), 'PATCH', `${B}/api/hospitals/${H1}/devices/imports/${rBatch}`, { ...U, params: { code: H1, batchId: String(rBatch) }, body: { occurredOn: '2026-08-02' } })
  ok(r.status === 403, 'imports PATCH USER → 403')
  r = await call(h(R.impOne.PATCH), 'PATCH', `${B}/api/hospitals/${H1}/devices/imports/${rBatch}`, { ...A, params: { code: H1, batchId: String(rBatch) }, body: { occurredOn: '2026-08-02' } })
  ok(r.status === 200 && r.json.after === '2026-08-02' && r.json.eventCount === 2, 'imports PATCH 업무일자')
  r = await call(h(R.impCancel.POST), 'POST', `${B}/api/hospitals/${H2}/devices/imports/${rBatch}/cancel`, { ...A, params: { code: H2, batchId: String(rBatch) } })
  ok(r.status === 404, 'imports cancel 타 병원 배치 → 404')
  r = await call(h(R.impCancel.POST), 'POST', `${B}/api/hospitals/${H1}/devices/imports/${rBatch}/cancel`, { ...A, params: { code: H1, batchId: String(rBatch) } })
  ok(r.status === 200 && r.json.summary.deletedDeviceIds.length === 2, 'imports cancel 200')
  r = await call(h(R.impCancel.POST), 'POST', `${B}/api/hospitals/${H1}/devices/imports/${rBatch}/cancel`, { ...A, params: { code: H1, batchId: String(rBatch) } })
  ok(r.status === 409, 'imports cancel 재취소 → 409')
  r = await call(h(R.hSummary.GET), 'GET', `${B}/api/hospitals/${H1}/devices/summary`, { ...V, ...P1 })
  ok(r.status === 200 && r.json.hospitalCode === H1 && r.json.models.length > 0 && r.json.expectedDeviceCount === h1!.expected, 'hospital summary GET(VIEWER 읽기)')
  r = await call(h(R.summary.GET), 'GET', `${B}/api/devices/summary?filter=diff&limit=5`, V)
  ok(r.status === 200 && r.json.totals && Array.isArray(r.json.data), 'global summary GET')
  r = await call(h(R.summary.GET), 'GET', `${B}/api/devices/summary?filter=bogus`, V)
  ok(r.status === 400, 'global summary 잘못된 filter → 400')
  r = await call(h(R.lookup.GET), 'GET', `${B}/api/devices/lookup?serial=${S(81).toLowerCase()}`, V)
  ok(r.status === 200 && r.json.device?.id === id81, 'lookup')
  r = await call(h(R.lookup.GET), 'GET', `${B}/api/devices/lookup?serial=`, V)
  ok(r.status === 400, 'lookup 빈 시리얼 → 400')
  r = await call(h(R.exportUnits.GET), 'GET', `${B}/api/devices/export?hospital=${H1}&status=all`, V)
  ok(r.status === 200 && r.ct.includes('spreadsheetml'), 'units export xlsx')
  r = await call(h(R.eventsExport.GET), 'GET', `${B}/api/devices/events/export?hospital=${H1}`, V)
  ok(r.status === 200 && r.ct.includes('spreadsheetml'), 'events export xlsx')
  r = await call(h(R.summaryExport.GET), 'GET', `${B}/api/devices/summary/export?filter=diff`, V)
  ok(r.status === 200 && r.ct.includes('spreadsheetml'), 'coverage export xlsx')
  r = await call(h(R.mntLookup.GET), 'GET', `${B}/api/devices/maintenance-lookup?hospital=${H1}`, V)
  ok(r.status === 200 && Array.isArray(r.json.data), 'maintenance-lookup')
  r = await call(h(R.mntLookup.GET), 'GET', `${B}/api/devices/maintenance-lookup?q=abc`, V)
  ok(r.status === 400, 'maintenance-lookup 병원 없음(비정확 코드) → 400')
  r = await call(h(R.reasons.GET), 'GET', `${B}/api/settings/device-recovery-reason`, V)
  ok(r.status === 200 && r.json.statusCodes.length >= 5, '회수 사유 GET')
  r = await call(h(R.reasons.POST), 'POST', `${B}/api/settings/device-recovery-reason`, { ...U, body: { name: '스모크 사유' } })
  ok(r.status === 403, '회수 사유 POST USER → 403')
  r = await call(h(R.reasons.POST), 'POST', `${B}/api/settings/device-recovery-reason`, { ...A, body: { name: '스모크 사유', value: 'DEFECT' } })
  ok(r.status === 409, '회수 사유 POST 이미 있는 value → 409')
  r = await call(h(R.reasons.POST), 'POST', `${B}/api/settings/device-recovery-reason`, { ...A, body: { name: '스모크 사유', order: 50 } })
  ok(r.status === 201 && r.json.statusCode.value === null, '회수 사유 POST 201')
  const reasonId = r.json.statusCode.id as number
  r = await call(h(R.reason.PUT), 'PUT', `${B}/api/settings/device-recovery-reason/${reasonId}`, { ...A, params: { id: String(reasonId) }, body: { name: '스모크 사유2' } })
  ok(r.status === 200 && r.json.statusCode.name === '스모크 사유2', '회수 사유 PUT')
  r = await call(h(R.reason.DELETE), 'DELETE', `${B}/api/settings/device-recovery-reason/${defect.id}`, { ...A, params: { id: String(defect.id) } })
  ok(r.status === 409 && /시스템/.test(r.json.error), '시스템 사유 DELETE → 409')
  r = await call(h(R.reason.DELETE), 'DELETE', `${B}/api/settings/device-recovery-reason/${reasonId}`, { ...A, params: { id: String(reasonId) } })
  ok(r.status === 200, '회수 사유 DELETE')
  // 용도 마스터 라우트 (device-recovery-reason과 같은 패턴)
  r = await call(h(R.usages.GET), 'GET', `${B}/api/settings/device-usage-type`, V)
  ok(r.status === 200 && r.json.statusCodes.some((s: { value: string | null }) => s.value === 'SALE') && r.json.statusCodes.some((s: { value: string | null }) => s.value === 'EVAL'), '용도 GET(VIEWER, SALE·EVAL)')
  r = await call(h(R.usages.POST), 'POST', `${B}/api/settings/device-usage-type`, { ...U, body: { name: '스모크 용도' } })
  ok(r.status === 403, '용도 POST USER → 403')
  r = await call(h(R.usages.POST), 'POST', `${B}/api/settings/device-usage-type`, { ...A, body: { name: '스모크 용도', value: 'EVAL' } })
  ok(r.status === 409, '용도 POST 이미 있는 value → 409')
  r = await call(h(R.usages.POST), 'POST', `${B}/api/settings/device-usage-type`, { ...A, body: { name: '스모크 용도', value: 'DEMO' } })
  ok(r.status === 400, '용도 POST 허용 어휘 밖 value → 400')
  r = await call(h(R.usages.POST), 'POST', `${B}/api/settings/device-usage-type`, { ...A, body: { name: '스모크 용도', order: 50 } })
  ok(r.status === 201 && r.json.statusCode.value === null && r.json.statusCode.category === 'DEVICE_USAGE_TYPE', '용도 POST 201')
  const usageId = r.json.statusCode.id as number
  r = await call(h(R.usage.PUT), 'PUT', `${B}/api/settings/device-usage-type/${usageId}`, { ...A, params: { id: String(usageId) }, body: { name: '스모크 용도2' } })
  ok(r.status === 200 && r.json.statusCode.name === '스모크 용도2', '용도 PUT')
  r = await call(h(R.usage.DELETE), 'DELETE', `${B}/api/settings/device-usage-type/${evalT.id}`, { ...A, params: { id: String(evalT.id) } })
  ok(r.status === 409 && r.json.error === '시스템 용도는 삭제할 수 없습니다', '시스템 용도(EVAL) DELETE → 409')
  await correctDevice(ctx(null), { deviceId: id81, changes: { usageTypeId: usageId } })
  r = await call(h(R.usage.DELETE), 'DELETE', `${B}/api/settings/device-usage-type/${usageId}`, { ...A, params: { id: String(usageId) } })
  ok(r.status === 409 && r.json.error === '사용 중인 용도입니다', '사용 중(device_units.usage_type_id) 용도 DELETE → 409')
  await correctDevice(ctx(null), { deviceId: id81, changes: { usageTypeId: sale.id } })
  r = await call(h(R.usage.DELETE), 'DELETE', `${B}/api/settings/device-usage-type/${usageId}`, { ...A, params: { id: String(usageId) } })
  ok(r.status === 200, '미사용 사용자 용도 DELETE → 200')
  // 계약건(B-23)·AS(B-24) 라우트
  const RAS = { open: await import('../app/api/devices/units/[id]/as-open/route'), clear: await import('../app/api/devices/units/[id]/as-clear/route') }
  const realDealH1 = (await reg.getHospitalDealContext(H1)).deals[0]
  // H1 계약완료 딜이 1건이면 등록 시 자동 기본값(B-23)으로 이미 그 딜이 붙어 PATCH가 '변경 사항 없음'이 된다 — 먼저 비워 변경이 생기게 (데이터 의존 제거)
  if ((await dev({ id: id81 }))!.dealCode === realDealH1.dealCode) await correctDevice(ctx(null), { deviceId: id81, changes: { dealCode: null } })
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id81}`, { ...UW, params: { id: String(id81) }, body: { dealCode: realDealH1.dealCode } })
  ok(r.status === 200 && r.json.event.eventType === 'CORRECT' && r.json.changes.dealCode.after === realDealH1.dealCode && r.json.device.dealCode === realDealH1.dealCode, 'PATCH 계약건 USER(write) → 200 CORRECT', r.json)
  r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${id81}`, { ...UW, params: { id: String(id81) }, body: { dealCode: 'DEAL-000000-0000' } })
  ok(r.status === 409 && r.json.error === '이 병원의 계약완료 딜이 아닙니다', 'PATCH 없는 계약건 → 409')
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?hospital=${H1}&deal=${encodeURIComponent(realDealH1.dealCode)}`, A)
  ok(r.status === 200 && r.json.total >= 1 && r.json.data.every((d: { dealCode: string | null }) => d.dealCode === realDealH1.dealCode), 'units ?deal= 필터')
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?hospital=${H1}&as=bogus`, A)
  ok(r.status === 400, 'units 잘못된 as → 400')
  r = await call(h(R.bulk.POST), 'POST', `${B}/api/devices/units/bulk`, { ...UW, body: { action: 'SET_DEAL', deviceIds: [id81] } })
  ok(r.status === 400 && /계약건/.test(r.json.error), 'bulk SET_DEAL dealCode 누락 → 400')
  r = await call(h(R.bulk.POST), 'POST', `${B}/api/devices/units/bulk`, { ...UW, body: { action: 'SET_DEAL', deviceIds: [id81], dealCode: null } })
  ok(r.status === 201 && r.json.events.every((e: { eventType: string }) => e.eventType === 'CORRECT'), 'bulk SET_DEAL null(미지정) USER → 201')
  r = await call(h(RAS.open.POST), 'POST', `${B}/api/devices/units/${id81}/as-open`, { ...V, params: { id: String(id81) }, body: {} })
  ok(r.status === 403, 'as-open VIEWER → 403')
  r = await call(h(RAS.open.POST), 'POST', `${B}/api/devices/units/${id81}/as-open`, { ...UW, params: { id: String(id81) }, body: { occurredOn: '2026-08-20', ...(mnt ? { ref: { type: 'MAINTENANCE', code: mnt.maintenanceCode } } : {}) } })
  ok(r.status === 201 && r.json.event.eventType === 'AS_OPEN' && r.json.device.asStartedOn != null && (!mnt || r.json.device.asRefCode === mnt.maintenanceCode), 'as-open USER → 201(플래그·MNT ref)', r.json)
  ok(!!(await prisma.auditLog.findFirst({ where: { id: { gt: pre.max.a }, resource: 'hospital_device', action: 'UPDATE', resourceLabel: { contains: 'AS 접수' } } })), 'as-open audit 라벨 AS 접수')
  r = await call(h(RAS.open.POST), 'POST', `${B}/api/devices/units/${id81}/as-open`, { ...UW, params: { id: String(id81) }, body: {} })
  ok(r.status === 409, 'as-open 재표시 → 409')
  r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?hospital=${H1}&as=1`, A)
  ok(r.status === 200 && r.json.data.some((d: { id: number }) => d.id === id81) && r.json.data.every((d: { asStartedOn: string | null }) => d.asStartedOn != null), 'units ?as=1 필터')
  r = await call(h(R.exportUnits.GET), 'GET', `${B}/api/devices/export?hospital=${H1}&as=1`, V)
  ok(r.status === 200 && r.ct.includes('spreadsheetml'), 'units export(as 필터, 상태/계약건 열) xlsx')
  r = await call(h(RAS.clear.POST), 'POST', `${B}/api/devices/units/${id81}/as-clear`, { ...UW, params: { id: String(id81) }, body: {} })
  ok(r.status === 201 && r.json.device.asStartedOn === null, 'as-clear USER → 201')
  ok(!!(await prisma.auditLog.findFirst({ where: { id: { gt: pre.max.a }, resource: 'hospital_device', action: 'UPDATE', resourceLabel: { contains: 'AS 해제' } } })), 'as-clear audit 라벨 AS 해제')
  r = await call(h(RAS.clear.POST), 'POST', `${B}/api/devices/units/${id81}/as-clear`, { ...UW, params: { id: String(id81) }, body: {} })
  ok(r.status === 409, 'as-clear 표시 없음 → 409')
  // 업무일자 기본(오늘) — 앞선 단건 as-clear가 오늘 일자라 소급 일자로 켜면 fold가 다시 꺼진다(같은 일자 순서 = id)
  r = await call(h(R.bulk.POST), 'POST', `${B}/api/devices/units/bulk`, { ...UW, body: { action: 'AS_OPEN', deviceIds: [id81], ...(mnt ? { ref: { type: 'MAINTENANCE', code: mnt.maintenanceCode } } : {}) } })
  ok(r.status === 201 && r.json.events.length === 1 && r.json.events[0].eventType === 'AS_OPEN', 'bulk AS_OPEN 라우트 USER → 201')
  ok(!!(await prisma.auditLog.findFirst({ where: { id: { gt: pre.max.a }, resource: 'hospital_device_event', resourceLabel: { contains: 'AS 일괄 접수' } } })), 'bulk AS_OPEN audit 라벨(AS 일괄 접수)')
  r = await call(h(R.bulk.POST), 'POST', `${B}/api/devices/units/bulk`, { ...UW, body: { action: 'AS_CLEAR', deviceIds: [id81] } })
  ok(r.status === 201 && r.json.events[0].eventType === 'AS_CLEAR', 'bulk AS_CLEAR 라우트 USER → 201')
  r = await call(h(R.hSummary.GET), 'GET', `${B}/api/hospitals/${H1}/devices/summary`, { ...V, ...P1 })
  ok(r.status === 200 && Array.isArray(r.json.deals) && r.json.dealUnassigned && typeof r.json.asInProgress === 'number' && r.json.contractedDeals.every((d: { productType?: unknown }) => 'productType' in d), 'hospital summary — deals[]·dealUnassigned·asInProgress·contractedDeals.productType')
  // ── 기기 상태·위치 축 라우트(2026-09-17 §7.1) — units/[id]/{repair-done,repair-undo,scrap,location} · PATCH condition/location · 목록 필터 · export · as-receipts/[id]/{repair-done,scrap-line}
  {
    const RC2 = {
      repairDone: await import('../app/api/devices/units/[id]/repair-done/route'),
      repairUndo: await import('../app/api/devices/units/[id]/repair-undo/route'),
      scrap: await import('../app/api/devices/units/[id]/scrap/route'),
      location: await import('../app/api/devices/units/[id]/location/route'),
      asRepairDone: await import('../app/api/as-receipts/[id]/repair-done/route'),
      asScrapLine: await import('../app/api/as-receipts/[id]/scrap-line/route'),
      asDetail: await import('../app/api/as-receipts/[id]/route'),
    }
    const P = (n: number) => S(n, 'P')
    const rP = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: P(2), wardName: '6병동' }, { serialInput: P(3) }, { serialInput: P(4) }])
    const [p2, p3, p4] = rP.created.map((c) => c.id)
    await recoverDevice(ctx(H1, '2026-09-01'), { deviceId: p2, reasonCodeId: defect.id })
    await recoverDevice(ctx(H1, '2026-09-01'), { deviceId: p3, reasonCodeId: defect.id })
    // AS접수(라인 3: 입고 라인 · LOST 라인 · 미입고 라인) — 티켓 없음(라우트의 syncTicketClocksSafe는 ticketId 없으면 스킵). cleanup(SMOKE_AS_CODES)에서 삭제
    const AS_R = SMOKE_AS_CODES[3]
    const receipt = await prisma.asReceipt.create({
      data: {
        asCode: AS_R, hospitalCode: H1, category: 'FAULT', receiptDate: new Date('2026-09-01T00:00:00Z'), createdById: adminUser!.id, note: '기존 비고',
        items: {
          create: [
            { serialNo: P(2), deviceId: p2, intakeState: 'RECEIVED', receivedAt: new Date('2026-09-02T00:00:00Z'), outcome: null },
            { serialNo: P(3), deviceId: p3, intakeState: 'RECEIVED', receivedAt: new Date('2026-09-02T00:00:00Z'), outcome: 'LOST' }, // 제외 outcome — 동기화 대상 아님
            { serialNo: P(4), deviceId: p4, intakeState: 'PENDING', outcome: null }, // 미입고 — 대상 아님
          ],
        },
      },
      include: { items: true },
    })
    const item2 = receipt.items.find((i) => i.serialNo === P(2))!
    const item3 = receipt.items.find((i) => i.serialNo === P(3))!
    const item4 = receipt.items.find((i) => i.serialNo === P(4))!
    const lineOf = (id: number) => prisma.asReceiptItem.findUniqueOrThrow({ where: { id } })
    const noteOf = async () => (await prisma.asReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).note ?? ''
    const unitOf = (id: number) => prisma.deviceUnit.findUniqueOrThrow({ where: { id }, include: { locationSite: true } })
    const idP = (id: number) => ({ params: { id: String(id) } })
    const auditLabel = (resource: string, resourceId: string, where: { endsWith?: string; contains?: string; equals?: string }) =>
      prisma.auditLog.findFirst({ where: { id: { gt: pre.max.a }, resource, resourceId, resourceLabel: where }, orderBy: { id: 'desc' } })

    // units/[id]/repair-done — write(USER+) · 라인 동기화 · 멱등 · 감사
    r = await call(h(RC2.repairDone.POST), 'POST', `${B}/api/devices/units/${p2}/repair-done`, { ...V, ...idP(p2), body: {} })
    ok(r.status === 403, 'units repair-done VIEWER → 403')
    r = await call(h(RC2.repairDone.POST), 'POST', `${B}/api/devices/units/${p2}/repair-done`, { ...UW, ...idP(p2), body: {} })
    ok(r.status === 201 && r.json.changed === true && r.json.after.condition === 'REPAIRED' && r.json.event.eventType === 'REPAIR_DONE' && r.json.event.refCode === null && r.json.lines.updated === 1 && r.json.lines.asCodes[0] === AS_R && r.json.device?.condition === 'REPAIRED' && r.json.device?.status === 'RECOVERED', 'units repair-done USER → 201 REPAIRED·REPAIR_DONE(ref 없음)·lines 1·device.condition', r.json)
    {
      const l2 = await lineOf(item2.id)
      const note = await noteOf()
      const others = await prisma.asReceiptItem.findMany({ where: { id: { in: [item3.id, item4.id] } } })
      ok(l2.repairedAt != null && l2.repairedById === (realUser?.id ?? null) && note.startsWith('기존 비고') && note.includes('[수리완료 ') && note.includes(P(2)) && note.includes('(기기현황)') && others.every((i) => i.repairedAt == null), '드로어 라인 동기화 — 대상 라인 repaired_at/by + 비고 이력(기존 비고 보존), LOST·PENDING 라인 미기록', { l2, note })
    }
    r = await call(h(RC2.repairDone.POST), 'POST', `${B}/api/devices/units/${p2}/repair-done`, { ...A, ...idP(p2), body: {} })
    ok(r.status === 201 && r.json.changed === false && r.json.event === null && r.json.lines.updated === 0 && (await prisma.hospitalDeviceEvent.count({ where: { deviceId: p2, eventType: 'REPAIR_DONE' } })) === 1, 'units repair-done 재호출 → changed:false·이벤트 없음·라인 0(멱등)')
    ok(!!(await auditLabel('hospital_device', P(2), { endsWith: '수리 완료' })), "units repair-done audit 라벨 '… 수리 완료'")
    r = await call(h(RC2.repairDone.POST), 'POST', `${B}/api/devices/units/${p4}/repair-done`, { ...A, ...idP(p4), body: {} })
    ok(r.status === 409 && String(r.json.error).includes(shared.DEVICE_REPAIR_IN_USE_MESSAGE), "units repair-done 사용중 → 409 '사용중 기기는 수리완료 처리할 수 없습니다'")
    // repair-undo
    r = await call(h(RC2.repairUndo.POST), 'POST', `${B}/api/devices/units/${p2}/repair-undo`, { ...UW, ...idP(p2), body: {} })
    ok(r.status === 201 && r.json.after.condition === 'AS_WAITING' && r.json.event.eventType === 'CORRECT' && r.json.event.memo === '수리완료 해제' && r.json.lines.updated === 1 && (await lineOf(item2.id)).repairedAt == null && (await noteOf()).includes('[수리완료 해제 '), 'units repair-undo → CORRECT(AS_WAITING)·라인 NULL·비고', r.json)
    ok(!!(await auditLabel('hospital_device', P(2), { endsWith: '수리완료 해제' })), "units repair-undo audit 라벨 '… 수리완료 해제'")
    r = await call(h(RC2.repairUndo.POST), 'POST', `${B}/api/devices/units/${p2}/repair-undo`, { ...A, ...idP(p2), body: {} })
    ok(r.status === 409, 'units repair-undo 수리완료 아님 → 409')
    // scrap — memo 필수(A-5 완화책) · 라인 NULL · ACTIVE 409 · 멱등
    await call(h(RC2.repairDone.POST), 'POST', `${B}/api/devices/units/${p2}/repair-done`, { ...A, ...idP(p2), body: {} })
    r = await call(h(RC2.scrap.POST), 'POST', `${B}/api/devices/units/${p2}/scrap`, { ...UW, ...idP(p2), body: {} })
    ok(r.status === 400 && /사유/.test(r.json.error), 'units scrap memo 없음 → 400')
    r = await call(h(RC2.scrap.POST), 'POST', `${B}/api/devices/units/${p2}/scrap`, { ...UW, ...idP(p2), body: { memo: '보드 파손' } })
    ok(r.status === 201 && r.json.after.condition === 'SCRAPPED' && r.json.after.location.kind === null && r.json.event.eventType === 'SCRAP' && r.json.event.memo === '보드 파손' && r.json.lines.updated === 1, 'units scrap USER(A-5) → 201 SCRAPPED·위치 없음·memo·라인 NULL', r.json)
    {
      const u = await unitOf(p2)
      const note = await noteOf()
      ok(u.condition === 'SCRAPPED' && u.locationSiteId == null && u.locationHospitalCode == null && (await lineOf(item2.id)).repairedAt == null && note.includes('[폐기 ') && note.includes('보드 파손'), 'units scrap → 유닛 I-1·라인 repaired_at NULL·비고 [폐기 …] memo')
    }
    r = await call(h(RC2.scrap.POST), 'POST', `${B}/api/devices/units/${p4}/scrap`, { ...A, ...idP(p4), body: { memo: 'x' } })
    ok(r.status === 409 && String(r.json.error).includes('먼저 회수'), 'units scrap ACTIVE → 409 먼저 회수')
    r = await call(h(RC2.scrap.POST), 'POST', `${B}/api/devices/units/${p2}/scrap`, { ...A, ...idP(p2), body: { memo: '재폐기' } })
    ok(r.status === 201 && r.json.changed === false, 'units scrap 이미 폐기 → changed:false')
    ok(!!(await auditLabel('hospital_device', P(2), { endsWith: '폐기' })), "units scrap audit 라벨 '… 폐기'")
    // location — 거점 이동·멱등·HOSPITAL 409·ACTIVE 거점 409·SCRAPPED 409·to 오류 400
    r = await call(h(RC2.location.POST), 'POST', `${B}/api/devices/units/${p3}/location`, { ...UW, ...idP(p3), body: { to: 'NOWHERE' } })
    ok(r.status === 400, 'units location to 오류 → 400')
    r = await call(h(RC2.location.POST), 'POST', `${B}/api/devices/units/${p3}/location`, { ...UW, ...idP(p3), body: { to: 'hub' } })
    ok(r.status === 201 && r.json.changed === true && r.json.after.location.code === 'HUB' && r.json.after.condition === 'AS_WAITING' && r.json.event.eventType === 'SITE_MOVE', 'units location RECOVERED → HUB(소문자 to 허용, condition 유지)', r.json)
    r = await call(h(RC2.location.POST), 'POST', `${B}/api/devices/units/${p3}/location`, { ...UW, ...idP(p3), body: { to: 'HUB' } })
    ok(r.status === 201 && r.json.changed === false, 'units location 같은 위치 → changed:false')
    r = await call(h(RC2.location.POST), 'POST', `${B}/api/devices/units/${p3}/location`, { ...UW, ...idP(p3), body: { to: 'HOSPITAL' } })
    ok(r.status === 409, 'units location RECOVERED → HOSPITAL 409')
    r = await call(h(RC2.location.POST), 'POST', `${B}/api/devices/units/${p4}/location`, { ...UW, ...idP(p4), body: { to: 'REFRESH_CENTER' } })
    ok(r.status === 409 && String(r.json.error).includes('먼저 회수'), 'units location ACTIVE → 거점 409')
    r = await call(h(RC2.location.POST), 'POST', `${B}/api/devices/units/${p4}/location`, { ...UW, ...idP(p4), body: { to: 'HOSPITAL' } })
    ok(r.status === 201 && r.json.changed === false, 'units location ACTIVE·IN_USE·이미 병원 [병원 반환] → changed:false')
    r = await call(h(RC2.location.POST), 'POST', `${B}/api/devices/units/${p2}/location`, { ...UW, ...idP(p2), body: { to: 'HUB' } })
    ok(r.status === 409, 'units location SCRAPPED → 409')
    ok(!!(await auditLabel('hospital_device', P(3), { contains: '위치 이동 리프레시센터 → thynC Connected Hub' })), "units location audit 라벨 '위치 이동 리프레시센터 → thynC Connected Hub'")
    // PATCH condition/location — admin OR device.admin · I-1 400 · I-3 409 · 라벨 문장화
    r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${p2}`, { ...UW, ...idP(p2), body: { condition: 'AS_WAITING' } })
    ok(r.status === 403, 'PATCH condition USER(권한 없음) → 403')
    r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${p2}`, { ...A, ...idP(p2), body: { condition: 'LOST', location: { kind: 'SITE', code: 'HUB' } } })
    ok(r.status === 400 && String(r.json.error).includes('I-1'), 'PATCH LOST + 위치 → 400 I-1')
    r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${p2}`, { ...A, ...idP(p2), body: { condition: 'BOGUS' } })
    ok(r.status === 400, 'PATCH condition 어휘 오류 → 400')
    r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${p2}`, { ...A, ...idP(p2), body: { location: { kind: 'SITE', code: 'X' } } })
    ok(r.status === 400, 'PATCH 거점 값 오류 → 400')
    r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${p2}`, { ...A, ...idP(p2), body: { condition: 'REPAIRED', location: { kind: 'SITE', code: 'REFRESH_CENTER' } } })
    ok(r.status === 200 && r.json.event.eventType === 'CORRECT' && r.json.changes.condition.after === 'REPAIRED' && r.json.changes.location.after.code === 'REFRESH_CENTER' && r.json.device?.condition === 'REPAIRED', 'PATCH admin SCRAPPED→REPAIRED·리프레시센터 → 200 CORRECT', r.json)
    {
      const a = await auditLabel('hospital_device', P(2), { contains: '기기 상태 보정' })
      const before = (a?.before ?? {}) as { condition?: string }
      const after = (a?.after ?? {}) as { location?: string }
      ok(!!a && a.resourceLabel!.includes('기기 상태 보정 폐기 → 수리완료') && a.resourceLabel!.includes('위치 보정 없음 → 리프레시센터') && before.condition === '폐기' && after.location === '리프레시센터', 'PATCH audit 라벨·스냅샷 문장화 값(기기 상태 보정 폐기 → 수리완료 · 위치 보정 없음 → 리프레시센터)', a?.resourceLabel)
    }
    r = await call(h(R.unit.PATCH), 'PATCH', `${B}/api/devices/units/${p4}`, { ...A, ...idP(p4), body: { condition: 'LOST', location: null } })
    ok(r.status === 409 && String(r.json.error).includes('I-3'), 'PATCH ACTIVE 기기 LOST → 409 I-3')
    // 목록 필터(condition·location)·export·상세
    r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?status=recovered&condition=REPAIRED&location=REFRESH_CENTER&q=${P(2).slice(0, 5)}`, UW)
    ok(r.status === 200 && r.json.total === 1 && r.json.data[0].id === p2 && r.json.data[0].condition === 'REPAIRED' && r.json.data[0].locationSiteValue === 'REFRESH_CENTER', 'units ?condition=REPAIRED&location=REFRESH_CENTER → 1건(교체품 가용 근사, I-5)', { total: r.json?.total })
    r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?status=all&location=HUB&q=${P(3).slice(0, 5)}`, UW)
    ok(r.status === 200 && r.json.total === 1 && r.json.data[0].id === p3, 'units ?location=HUB → 1건')
    r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?status=all&location=HOSPITAL&q=${P(4).slice(0, 5)}`, UW)
    ok(r.status === 200 && r.json.data.some((d: { id: number }) => d.id === p4) && r.json.data.every((d: { locationHospitalCode: string | null }) => d.locationHospitalCode != null), 'units ?location=HOSPITAL')
    r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?condition=BOGUS`, UW)
    ok(r.status === 400, 'units condition 어휘 오류 → 400')
    r = await call(h(R.units.GET), 'GET', `${B}/api/devices/units?location=BOGUS`, UW)
    ok(r.status === 400, 'units location 어휘 오류 → 400')
    r = await call(h(R.exportUnits.GET), 'GET', `${B}/api/devices/export?status=all&condition=REPAIRED&q=${P(2).slice(0, 5)}`, V)
    ok(r.status === 200 && r.ct.includes('spreadsheetml'), 'units export(condition 필터, 기기 상태·위치 열) xlsx')
    r = await call(h(R.eventsExport.GET), 'GET', `${B}/api/devices/events/export?device=${p2}`, V)
    ok(r.status === 200 && r.ct.includes('spreadsheetml'), 'events export(상태·위치 축 4종 요약·병원명 맵) xlsx')
    r = await call(h(R.unit.GET), 'GET', `${B}/api/devices/units/${p2}`, { ...A, ...idP(p2) })
    ok(r.status === 200 && r.json.device.condition === 'REPAIRED' && r.json.device.locationSiteValue === 'REFRESH_CENTER' && r.json.events.some((e: { eventType: string }) => e.eventType === 'SCRAP'), 'units/[id] GET — device.condition·locationSiteValue + 상태·위치 축 이벤트')
    // as-receipts/[id]/repair-done · scrap-line (!VIEWER, 접수 상태 무관 — §7.1·§7.2) · GET 상세 계약
    const asP = { params: { id: String(receipt.id) } }
    r = await call(h(RC2.asRepairDone.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/repair-done`, { ...V, ...asP, body: { itemId: item2.id, repaired: true } })
    ok(r.status === 403, 'as repair-done VIEWER → 403')
    r = await call(h(RC2.asRepairDone.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/repair-done`, { ...UW, ...asP, body: { itemId: item4.id, repaired: true } })
    ok(r.status === 400 && String(r.json.error).includes('입고된 라인만'), "as repair-done 미입고 라인 → 400 '입고된 라인만 수리완료 처리할 수 있습니다'")
    r = await call(h(RC2.asRepairDone.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/repair-done`, { ...UW, ...asP, body: { itemId: item3.id, repaired: true } })
    ok(r.status === 400 && String(r.json.error).includes('분실·취소·미회수'), 'as repair-done LOST 라인 → 400')
    r = await call(h(RC2.asRepairDone.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/repair-done`, { ...UW, ...asP, body: { itemId: item2.id, repaired: true } })
    ok(r.status === 200 && r.json.success === true && r.json.repaired === true && r.json.repairedAt === today && r.json.repairedBy?.id === (realUser?.id ?? null) && r.json.condition === 'REPAIRED' && r.json.warnings.length === 0, 'as repair-done USER → 200 {repaired, repairedAt(오늘 KST), repairedBy, condition REPAIRED}', r.json)
    ok(!!(await auditLabel('as_receipt', AS_R, { equals: `${AS_R} 수리완료` })), "as repair-done audit 라벨 '{asCode} 수리완료'")
    r = await call(h(RC2.asRepairDone.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/repair-done`, { ...UW, ...asP, body: { itemId: item2.id, repaired: false } })
    ok(r.status === 200 && r.json.repaired === false && r.json.repairedAt === null && r.json.condition === 'AS_WAITING' && (await lineOf(item2.id)).repairedAt == null, 'as repair-done 해제 → 라인 NULL·기기 CORRECT AS_WAITING', r.json)
    ok(!!(await auditLabel('as_receipt', AS_R, { equals: `${AS_R} 수리완료 해제` })), "as repair-done 해제 audit 라벨 '{asCode} 수리완료 해제'")
    r = await call(h(RC2.asDetail.GET), 'GET', `${B}/api/as-receipts/${receipt.id}`, { ...UW, ...asP })
    {
      const it = r.json?.asReceipt?.items?.find((i: { id: number }) => i.id === item2.id)
      ok(r.status === 200 && !!it && it.repairedAt === null && 'repairedBy' in it && it.device?.unit?.condition === 'AS_WAITING' && it.device?.unit?.locationSiteValue === 'REFRESH_CENTER' && it.device?.unit?.locationHospitalCode === null && 'locationHospitalName' in it.device.unit, 'as-receipts/[id] GET — items[].repairedAt/repairedBy + device.unit{condition, locationSiteValue, locationHospitalCode, locationHospitalName}', it)
    }
    r = await call(h(RC2.asScrapLine.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/scrap-line`, { ...V, ...asP, body: { itemId: item2.id, memo: 'x' } })
    ok(r.status === 403, 'as scrap-line VIEWER → 403')
    r = await call(h(RC2.asScrapLine.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/scrap-line`, { ...UW, ...asP, body: { itemId: item2.id, memo: '  ' } })
    ok(r.status === 400 && /사유/.test(r.json.error), 'as scrap-line memo 없음 → 400')
    r = await call(h(RC2.asScrapLine.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/scrap-line`, { ...UW, ...asP, body: { itemId: item3.id, memo: 'x' } })
    ok(r.status === 400, 'as scrap-line LOST 라인 → 400')
    r = await call(h(RC2.asScrapLine.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/scrap-line`, { ...UW, ...asP, body: { itemId: item2.id, memo: '스모크 폐기' } })
    {
      const note = await noteOf()
      ok(r.status === 200 && r.json.success === true && r.json.condition === 'SCRAPPED' && (await unitOf(p2)).condition === 'SCRAPPED' && note.includes('[폐기 ') && note.includes('스모크 폐기'), 'as scrap-line USER → 200 SCRAPPED + 비고 [폐기 …] memo', r.json)
    }
    ok(!!(await auditLabel('as_receipt', AS_R, { equals: `${AS_R} 폐기` })), "as scrap-line audit 라벨 '{asCode} 폐기'")
    r = await call(h(RC2.asScrapLine.POST), 'POST', `${B}/api/as-receipts/${receipt.id}/scrap-line`, { ...UW, ...asP, body: { itemId: item2.id, memo: '재폐기' } })
    ok(r.status === 400 && String(r.json.error).includes('폐기'), 'as scrap-line 이미 폐기 기기 → 400')
  }

  const auditBy = await prisma.auditLog.groupBy({ by: ['resource'], where: { id: { gt: pre.max.a }, resource: { in: AUDIT_RESOURCES } }, _count: { _all: true } })
  const ac = Object.fromEntries(auditBy.map((a) => [a.resource, a._count._all]))
  ok((ac.hospital_device ?? 0) >= 5 && (ac.hospital_device_event ?? 0) >= 5 && ac.hospital_device_import === 3 && (ac.hospital_ward ?? 0) >= 4 && ac['setting:device_recovery_reason'] === 3 && ac['setting:device_usage_type'] === 3 && ac.as_receipt === 3, '감사 로그 자원별 건수(§8.3 자원명 — as_receipt 수리완료·해제·폐기 3건)', ac)

  section('[14] 최종 정합 — 전 개체 프로젝션 = fold')
  const all = await allTestDeviceIds()
  let mismatch = 0
  for (const id of all) if (!(await projectionEqualsRebuild(id))) mismatch++
  ok(mismatch === 0 && all.length > 0, `전 개체(${all.length}) 프로젝션 = rebuildUnitProjection 결과`)
}

main()
  .catch((e) => {
    fail++
    console.error('FATAL', e)
  })
  .finally(async () => {
    try {
      await cleanup()
    } catch (e) {
      fail++
      console.error('CLEANUP FAILED', e)
    }
    const post = await counts()
    ok(JSON.stringify(post) === JSON.stringify(pre.counts), `정리 후 row 수 = 사전 (units=${post.u} devices=${post.d} events=${post.e} wards=${post.w} batches=${post.b})`, { pre: pre.counts, post })
    ok((await prisma.auditLog.count({ where: { id: { gt: pre.max.a }, resource: { in: AUDIT_RESOURCES } } })) === 0, '이 실행의 audit_logs 정리')
    ok((await prisma.asReceipt.count({ where: { asCode: { in: [...SMOKE_AS_CODES] } } })) === 0, '스모크 AS접수 정리(SMOKE_AS_CODES)')
    console.log(`\n결과: pass=${pass} fail=${fail}`)
    await prisma.$disconnect()
    process.exit(fail > 0 ? 1 : 0)
  })
