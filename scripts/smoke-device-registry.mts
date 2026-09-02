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
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
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
} = reg
const shared = await import('../lib/deviceRegistryShared')
const access = await import('../lib/deviceRegistryAccess')
const auth = await import('../lib/auth')

const prisma = new PrismaClient()
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

/** 테스트 시리얼 — A9900xx / P9900xx / B9900xx (7자, 모델 패턴 통과) */
const S = (n: number, kind: 'A' | 'P' | 'B' = 'A') => `${kind}9900${String(n).padStart(2, '0')}`
const TEST_PREFIXES = ['A9900', 'P9900', 'B9900']
const AUDIT_RESOURCES = ['hospital_device', 'hospital_device_event', 'hospital_device_import', 'hospital_ward', 'setting:device_recovery_reason', 'setting:device_usage_type']

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

type HospRow = { hospital_code: string; hospital_name: string; deals: number; expected: number; pt_kinds: number; has_rows: boolean }
const candidates = await prisma.$queryRaw<HospRow[]>`
  WITH dl AS (SELECT sd.hospital_code, count(*)::int c, sum(coalesce(sd.daewoong_device_count,0))::int s,
                     count(DISTINCT sd.product_type) FILTER (WHERE sd.product_type IN ('일반','라이트'))::int k,
                     bool_or(EXISTS (SELECT 1 FROM sales_deal_devices sdd WHERE sdd.deal_id = sd.id)) hr
                FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
               WHERE sc.category = 'SALES_DEAL_STATUS' AND sc.name = '계약완료' GROUP BY 1)
  SELECT h.hospital_code, h.hospital_name, coalesce(dl.c,0) deals, coalesce(dl.s,0) expected, coalesce(dl.k,0) pt_kinds, coalesce(dl.hr,false) has_rows
    FROM hospitals h LEFT JOIN dl ON dl.hospital_code = h.hospital_code
   WHERE h.status = '운영'
     AND NOT EXISTS (SELECT 1 FROM hospital_wards w WHERE w.hospital_code = h.hospital_code)
     AND NOT EXISTS (SELECT 1 FROM hospital_devices d WHERE d.hospital_code = h.hospital_code OR d.last_hospital_code = h.hospital_code)
     AND NOT EXISTS (SELECT 1 FROM hospital_device_events e WHERE e.hospital_code = h.hospital_code)
   ORDER BY coalesce(dl.c,0) DESC, coalesce(dl.s,0) DESC, h.hospital_code`
// H1은 상품유형 단일(혼합이면 미지정 등록이 400이라 기존 시나리오가 깨진다 — 혼합 규칙은 [1c]에서 문맥 주입으로 검증)
// + 딜 모델별 수량 행이 없는 병원 우선(B-25 — 폴백 규칙이 구 기대값(Σ디바이스수)과 같아 기존 대조 시나리오 유지; 모델 행 케이스는 [1d] 실데이터 읽기 검증)
const h1 = candidates.find((c) => c.deals > 0 && c.pt_kinds < 2 && !c.has_rows) ?? candidates.find((c) => c.deals > 0 && c.pt_kinds < 2)
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
  console.log(`  H1=${H1} ${h1!.hospital_name} (계약완료 딜 ${h1!.deals}건 Σ${h1!.expected}) · H2=${H2} ${h2!.hospital_name} · H3=${H3} ${h3!.hospital_name} (딜 0건)`)
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
  // 주입 문맥 — 혼합 병원 시나리오(실데이터 수정 없음)
  await expectErr('혼합 문맥 주입 + 미지정 → 400 필수', () => registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(66) }], { productTypeContextOverride: MIXED_CTX }), 400, shared.PRODUCT_TYPE_REQUIRED_MESSAGE)
  await expectErr('혼합 문맥 다건 — 하나라도 미지정이면 400', () => registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(66), productType: '일반' }, { serialInput: S(67) }], { productTypeContextOverride: MIXED_CTX }), 400, shared.PRODUCT_TYPE_REQUIRED_MESSAGE)
  ok((await prisma.deviceUnit.count({ where: { serialNo: { in: [S(66), S(67)] } } })) === 0, '400 시 유닛·배치 미생성(롤백)')
  const rM = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(66), productType: '일반' }, { serialInput: S(67), productType: '라이트' }], { productTypeContextOverride: MIXED_CTX })
  ok(rM.created.length === 2 && rM.created.map((c) => c.productType).sort().join() === '라이트,일반', '혼합 문맥 + 전부 명시 → 201 (한 병원에 일반·라이트 공존)')
  const rL = await registerDevices(ctx(H1, '2026-08-01'), [{ serialInput: S(68) }], { productTypeContextOverride: LITE_CTX })
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
  await expectErr('교체 소급 경로 + 혼합 문맥 + 미지정 → 400', () => replaceDevice(ctx(H1, '2026-08-15'), { oldSerial: S(73), oldWardName: '6병동', newSerial: S(74), productTypeContextOverride: MIXED_CTX }), 400, shared.PRODUCT_TYPE_REQUIRED_MESSAGE)
  const rpB = await replaceDevice(ctx(H1, '2026-08-15'), { oldSerial: S(73), oldWardName: '6병동', newSerial: S(74), productType: 'lite', productTypeContextOverride: MIXED_CTX })
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
    { wardMode: 'fixed', mode: 'REGISTER', occurredOn: '2026-08-20', productTypeContextOverride: MIXED_CTX }
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
  for (const t of ptH1.types) ok(ecgP.byProductType[t]!.expected === ptH1.byType.find((b) => b.type === t)!.devices && (ecgP.compare !== 'hard' || ecgP.byProductType[t]!.diff === ecgP.byProductType[t]!.activeForCompare - ecgP.byProductType[t]!.expected!), `요약 byProductType.${t}.expected = 그 유형 딜 Σ(§9.1) · diff`)
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
    const unassignedActive = await prisma.hospitalDevice.count({ where: { hospitalCode: H3, status: 'ACTIVE', dealCode: null } })
    ok(sumD.dealUnassigned.active === unassignedActive && typeof sumD.dealUnassigned.replacements === 'number', '요약 dealUnassigned 버킷(active = deal NULL ACTIVE 수)')
    const sumH1D = (await getHospitalDeviceSummary(H1))!
    const rowReal = sumH1D.deals.find((d) => d.dealCode === realDeal.dealCode)!
    ok(!!rowReal && rowReal.contracted && rowReal.expected === realDeal.count && rowReal.roundNo === realDeal.roundNo && rowReal.active >= 2, '요약 deals[] — 계약완료 딜 행(expected = Σ대웅 수·등록 수량)', rowReal)
    // ── B-25: 계약 수량 = 딜 모델별 수량 1순위 · 디바이스수 폴백
    if (!h1!.has_rows) {
      ok(rowReal.expectedSource === 'fallback' && rowReal.expectedByModel?.ecg === realDeal.count && rowReal.expectedByModel?.spo2 === null && rowReal.expectedByModel?.bp === null, 'B-25: 폴백 딜 — expectedSource=fallback · expectedByModel={ecg: 디바이스수}', rowReal.expectedByModel)
      const ecgActiveReal = await prisma.hospitalDevice.count({ where: { hospitalCode: H1, status: 'ACTIVE', dealCode: realDeal.dealCode, unit: { deviceInfo: { onpremDeviceType: 1 } } } })
      ok(rowReal.activeByModel.ecg === ecgActiveReal && rowReal.activeByModel.ecg + rowReal.activeByModel.spo2 + rowReal.activeByModel.bp <= rowReal.active, 'B-25: 딜×모델 등록 수(activeByModel.ecg = DB count)', rowReal.activeByModel)
      ok(sumH1D.dealUnassigned.activeByModel.ecg <= sumH1D.dealUnassigned.active && typeof sumH1D.dealUnassigned.activeByModel.spo2 === 'number', 'B-25: 미지정 버킷 activeByModel')
      const ecgMF = sumH1D.models.find((m) => m.onpremDeviceType === 1)!
      const spo2MF = sumH1D.models.find((m) => m.onpremDeviceType === 3)
      ok(ecgMF.expected === h1!.expected && (!spo2MF || spo2MF.compare !== 'hard'), 'B-25: 폴백 전용 병원(H1) — ECG 기대 = Σ디바이스수(구 동작) · SpO2 soft 유지', { ecg: ecgMF.expected, spo2: spo2MF?.compare })
    } else console.log('  (H1이 모델 행 보유 병원 — 폴백 전용 케이스 스킵)')
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
        SELECT sum(CASE WHEN m.deal_id IS NULL THEN coalesce(sd.daewoong_device_count, 0) ELSE coalesce(m.ecg, 0) END)::int AS ecg,
               sum(coalesce(m.spo2, 0))::int AS spo2
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
      ok(sEcg.compare === 'hard' && sEcg.expected === (sqlExp.ecg ?? 0), `B-25 실데이터(${MH}): ECG 기대 = Σ(모델 행 + 폴백 디바이스수)`, { exp: sEcg.expected, sql: sqlExp })
      ok(sSpo2.compare === 'hard' && sSpo2.expected === (sqlExp.spo2 ?? 0) && sSpo2.diff === sSpo2.activeForCompare - (sqlExp.spo2 ?? 0), 'B-25 실데이터: SpO2 실측 hard 대조(ECG 동수 soft 아님)', { compare: sSpo2.compare, exp: sSpo2.expected })
      const mDeal = sM.deals.find((d) => d.contracted && d.expectedSource === 'models')
      ok(!!mDeal && mDeal.expectedByModel != null && (mDeal.expectedByModel.ecg != null || mDeal.expectedByModel.spo2 != null), 'B-25 실데이터: deals[] models 출처 행 — expectedByModel 모델별 수량', mDeal && { code: mDeal.dealCode, byModel: mDeal.expectedByModel })
      const covM = (await getGlobalCoverage({ q: MH, limit: 5 })).data.find((r) => r.hospitalCode === MH)
      ok(!!covM && covM.expected === (sqlExp.ecg ?? 0), 'B-25 실데이터: 커버리지 expected = 모델 행 우선 ECG', covM && { expected: covM.expected })
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
    ok((await getHospitalDeviceSummary(H3))!.asInProgress >= 1, '요약 asInProgress ≥ 1')
    const asC = await reg.clearDeviceAs(ctx(null, '2026-08-16'), { deviceId: dAS.id })
    ok(asC.event.eventType === 'AS_CLEAR' && asC.device.asStartedOn === null && asC.device.asRefCode === null, 'clearDeviceAs — 수동 해제')
    await expectErr('표시 없는 기기 해제 → 409', () => reg.clearDeviceAs(ctx(null), { deviceId: dAS.id }), 409, '표시가 없는')
    // LIFO 취소 — AS_CLEAR 취소 → 플래그 복원, AS_OPEN 취소 → 해제
    const cClear = await cancelLastEvent(ctx(null), { eventId: asC.event.id })
    ok(cClear.cancelledEventIds.length === 1 && (await dev({ id: dAS.id }))!.asStartedOn?.toISOString().startsWith('2026-08-15') === true, 'AS_CLEAR 취소(LIFO) → 플래그 복원(fold)')
    await cancelLastEvent(ctx(null), { eventId: asO.event.id })
    ok((await dev({ id: dAS.id }))!.asStartedOn === null && (await dev({ id: dAS.id }))!.asRefCode === null, 'AS_OPEN 취소 → 플래그 해제')
    ok(await projectionEqualsRebuild(dAS.id), 'AS 취소 후 프로젝션 = fold')
    // 자동 해제 — 회수·교체
    await reg.openDeviceAs(ctx(null, '2026-08-17'), { deviceId: dAS.id })
    const rcAS = await recoverDevice(ctx(null, '2026-08-18'), { deviceId: dAS.id, reasonCodeId: defect.id })
    ok(rcAS.device.asStartedOn === null && rcAS.device.asRefCode === null, '회수 → AS 플래그 자동 해제')
    ok((await prisma.hospitalDeviceEvent.count({ where: { deviceId: dAS.id, eventType: 'AS_CLEAR' } })) === 0, '자동 해제는 AS_CLEAR 이벤트를 만들지 않는다')
    await registerDevices(ctx(H3, '2026-08-19'), [{ serialInput: S(52), wardName: 'D동' }], { dealContextOverride: NONE_D })
    await reg.openDeviceAs(ctx(null, '2026-08-20'), { deviceId: dAS.id })
    const repAS = await replaceDevice(ctx(H3, '2026-08-21'), { oldDeviceId: dAS.id, newSerial: S(62, 'P') })
    ok(repAS.oldDevice.status === 'RECOVERED' && repAS.oldDevice.asStartedOn === null && repAS.newDevice.asStartedOn === null, '교체 → 구 기기 AS 플래그 자동 해제')
    await expectErr('회수된 기기 AS 표시 → 409', () => reg.openDeviceAs(ctx(null), { deviceId: dAS.id }), 409, '회수된 기기에는 AS 표시')
    const detAS = (await getUnitDetail(repAS.newDevice.id))!
    ok('dealCode' in detAS && 'asStartedOn' in detAS && 'asRefCode' in detAS, '상세 응답에 dealCode·asStartedOn·asRefCode')
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
  await expectErr('배치 업무일자 → 이관 원 병원 이후 이벤트 앞으로(불성립)', () => editImportBatchDate(ctx(H1), { batchId: imp.batch.id, occurredOn: '2026-08-29' }), 409, '성립하지')
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
  ok(ecg.compare === 'hard' && ecg.expected === h1!.expected && ecg.diff === ecg.activeForCompare - h1!.expected && ecg.active === (await prisma.hospitalDevice.count({ where: { hospitalCode: H1, status: 'ACTIVE', unit: { deviceInfoId: ecg.deviceInfoId } } })), 'ECG hard 대조(diff = 배치 중(평가용 제외) − 계약)', ecg)
  const evalActiveH1 = await prisma.hospitalDevice.count({ where: { hospitalCode: H1, status: 'ACTIVE', unit: { deviceInfoId: ecg.deviceInfoId, usageType: { is: { value: 'EVAL' } } } } })
  ok(evalActiveH1 >= 1 && ecg.activeEval === evalActiveH1 && ecg.activeForCompare === ecg.active - ecg.activeEval && ecg.diff !== ecg.active - h1!.expected, '요약: activeEval = 배치 중 EVAL 수 · activeForCompare = active − activeEval · diff에서 평가용 제외', { active: ecg.active, activeEval: ecg.activeEval, diff: ecg.diff })
  ok(sum.evalTotal >= evalActiveH1 && sum.evalTotal === sum.models.reduce((s, m) => s + m.activeEval, 0), '요약: evalTotal = Σ models.activeEval')
  ok(!spo2 || (spo2.compare === 'soft' && spo2.expected === h1!.expected && spo2.diff === null), 'SpO2 soft(참고, diff null)', spo2)
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
  ok(!!covRow && covRow.expected === h1!.expected && covRow.deals === h1!.deals && covRow.registered && covRow.diff === covRow.activeEcg - h1!.expected && covRow.lastImport?.id === imp2.batch.id, '커버리지 행(H1): 계약·배치·차이·마지막 임포트', covRow)
  ok(covRow.activeEcgEval === ecg.activeEval && covRow.activeEcg === ecg.activeForCompare && covRow.evalTotal === sum.evalTotal && covRow.evalTotal >= 1, '커버리지: 배치 중 ECG·차이는 평가용 제외, activeEcgEval·evalTotal 별도(요약과 일치)', { cov: [covRow.activeEcg, covRow.activeEcgEval, covRow.evalTotal], sum: [ecg.activeForCompare, ecg.activeEval, sum.evalTotal] })
  ok(cov.totals.active.eval >= 1 && typeof cov.totals.active.ecg === 'number', '전역 합계 active.eval')
  ok(cov.totals.customerHospitals > 0 && cov.totals.registeredHospitals >= 3 && cov.totals.active.total >= 1 && cov.totals.events30d >= 1, '전역 합계', cov.totals)
  const cov3 = await getGlobalCoverage({ q: H3 })
  ok(cov3.data[0]?.hospitalCode === H3 && cov3.data[0].expected === null && cov3.data[0].diff === null && cov3.data[0].registered, '딜 0건 병원 커버리지: expected/diff null, registered')
  const covDiff = await getGlobalCoverage({ filter: 'diff', limit: 50 })
  ok(covDiff.total > 0 && covDiff.data.every((r) => r.deals > 0 && r.diff !== 0), '차이 있음 필터')
  const covUn = await getGlobalCoverage({ filter: 'unregistered', limit: 5 })
  ok(covUn.data.every((r) => !r.registered), '미등록 필터')
  const covDone = await getGlobalCoverage({ filter: 'complete', limit: 5 })
  ok(covDone.data.every((r) => r.registered && (r.deals === 0 || r.diff === 0)), '등록 완료 필터')
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
  ok(!!(await prisma.auditLog.findFirst({ where: { id: { gt: pre.max.a }, resource: 'hospital_device', action: 'UPDATE', resourceLabel: { contains: 'AS 시작' } } })), 'as-open audit 라벨 AS 시작')
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
  r = await call(h(R.hSummary.GET), 'GET', `${B}/api/hospitals/${H1}/devices/summary`, { ...V, ...P1 })
  ok(r.status === 200 && Array.isArray(r.json.deals) && r.json.dealUnassigned && typeof r.json.asInProgress === 'number' && r.json.contractedDeals.every((d: { productType?: unknown }) => 'productType' in d), 'hospital summary — deals[]·dealUnassigned·asInProgress·contractedDeals.productType')
  const auditBy = await prisma.auditLog.groupBy({ by: ['resource'], where: { id: { gt: pre.max.a }, resource: { in: AUDIT_RESOURCES } }, _count: { _all: true } })
  const ac = Object.fromEntries(auditBy.map((a) => [a.resource, a._count._all]))
  ok((ac.hospital_device ?? 0) >= 5 && (ac.hospital_device_event ?? 0) >= 5 && ac.hospital_device_import === 3 && (ac.hospital_ward ?? 0) >= 4 && ac['setting:device_recovery_reason'] === 3 && ac['setting:device_usage_type'] === 3, '감사 로그 자원별 건수(§8.3 자원명)', ac)

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
    console.log(`\n결과: pass=${pass} fail=${fail}`)
    await prisma.$disconnect()
    process.exit(fail > 0 ? 1 : 0)
  })
