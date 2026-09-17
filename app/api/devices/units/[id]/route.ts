import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { correctDevice, getUnitDetail, updateDeviceMemo, type CorrectChanges } from '@/lib/deviceRegistry'
import { DEVICE_CONDITIONS, DEVICE_SITE_VALUES, DEVICE_USAGE_TYPE_CATEGORY, deviceConditionLabel, isDeviceCondition, isDeviceSiteValue, unitStateChangesOf, type DeviceLocationSnapshot } from '@/lib/deviceRegistryShared'
import { locationSnapshotText } from '@/app/devices/_components/deviceDisplay'
import {
  deviceAuditLabel,
  optionalInt,
  parseIdParam,
  parseRef,
  projectionSnapshot,
  readJsonObject,
  registryActor,
  registryErrorResponse,
} from '@/lib/deviceRegistryRoute'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 개체 상세(이력 드로어, §6.1) — 개체 + 이벤트 전체(병원 경계 무관) + 교체 상대 + WMS 표시
 * 응답 `{ device, events }`
 * - `device`: 유닛 식별 + 배치 프로젝션 평탄화(`id` = 유닛 id) + deviceInfo·ward·hospital·lastHospital·recoverReason·replacedBy(→ 교체됨)·replaces[](이 개체가 대체한 구기기)
 *   ·wms(=wmsTransient, 표시용 일시 매칭, DB 쓰기 없음)·wmsWarning
 * - `events`: **최신순(occurred_on DESC, id DESC)** — 드로어가 그대로 렌더. fold 순서가 필요하면 클라이언트에서 뒤집는다.
 *   각 행에 hospital·fromWard·toWard·reasonCode·relatedDevice·importBatch + actorName 스냅샷
 * 로그인 전체. 읽기이므로 logAudit 없음.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: '기기 id가 올바르지 않습니다.' }, { status: 400 })

  try {
    const detail = await getUnitDetail(id)
    if (!detail) return NextResponse.json({ error: '기기를 찾을 수 없습니다.' }, { status: 404 })
    const { events, ...device } = detail
    return NextResponse.json({ device, events })
  } catch (e) {
    console.error('[devices:units/[id]]', e)
    return NextResponse.json({ error: '기기 현황 조회 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

const IDENTITY_KEYS = ['deviceInfoId', 'serialNo', 'macAddress', 'extDeviceCode', 'usageTypeId', 'productType', 'dealCode', 'condition', 'location'] as const
/** 식별 보정 중 write(USER+)로 허용되는 키 — 용도·상품유형·계약건은 운영 속성이라 admin 게이트 밖(B-21·B-22·B-23). condition·location 보정은 admin OR device.admin(2026-09-17 §8.1) */
const WRITE_LEVEL_IDENTITY_KEYS: readonly (typeof IDENTITY_KEYS)[number][] = ['usageTypeId', 'productType', 'dealCode']
/** 운영 속성 키 — 감사 라벨에서 '식별 보정(…)'으로 묶지 않고 각자 문장화 */
const OPS_KEYS: readonly string[] = ['usageTypeId', 'productType', 'dealCode', 'condition', 'location']

/** `location` body → 스냅샷 형상. null/''/`{kind:null}` = 위치 없음. 형태 오류는 400 */
function parseLocationBody(raw: unknown): DeviceLocationSnapshot | null | NextResponse {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return NextResponse.json({ error: '위치는 { kind: HOSPITAL|SITE|null, code } 형식이어야 합니다' }, { status: 400 })
  const o = raw as Record<string, unknown>
  if (o.kind == null || o.kind === '') return null
  if (o.kind !== 'HOSPITAL' && o.kind !== 'SITE') return NextResponse.json({ error: '위치 kind는 HOSPITAL | SITE | null 이어야 합니다' }, { status: 400 })
  const code = typeof o.code === 'string' ? o.code.trim() : ''
  if (!code) return NextResponse.json({ error: o.kind === 'HOSPITAL' ? '위치 병원 코드를 입력하세요' : `거점 값을 선택하세요 (${DEVICE_SITE_VALUES.join(' | ')})` }, { status: 400 })
  if (o.kind === 'SITE' && !isDeviceSiteValue(code)) return NextResponse.json({ error: `거점 값이 올바르지 않습니다 (${DEVICE_SITE_VALUES.join(' | ')})` }, { status: 400 })
  return { kind: o.kind, code }
}
const EVENT_ONLY_KEYS = ['status', 'hospitalCode', 'wardId', 'placedOn', 'recoveredOn', 'lastHospitalCode', 'recoverReasonId', 'replacedById'] as const

/**
 * PATCH /api/devices/units/[id] — 개체 속성 수정 (§7.1·§8.2)
 * - `{ memo }`                                   : 유닛 메모(`device_units.memo`) UPDATE (write, 이벤트 아님)
 * - `{ deviceInfoId?|serialNo?|macAddress?|extDeviceCode? }` : 식별 보정 → CORRECT 이벤트 (admin) — 시리얼·모델·MAC은 유닛, 닉네임은 배치. 시리얼 충돌 409, 이력 있는 개체의 시리얼 정정 409
 * - `{ usageTypeId }`                            : 용도(판매용/평가용/null=미지정) → CORRECT 이벤트 (**write** — USER+, 다른 식별 키와 함께 보내면 admin)
 * - `{ productType }`                            : 상품유형(일반/라이트/null=미지정, 배치 속성 B-22) → CORRECT 이벤트 (**write** — USER+, 잘못된 값 400)
 * - `{ condition?, location? }`                  : 기기 상태·위치 보정(2026-09-17 §7.0·§8.1 — PRE_SHIP v1 진입로 A-6) → CORRECT 이벤트 (**admin OR device.admin**).
 *   condition 6종|null(미확인), location `{ kind:'HOSPITAL'|'SITE'|null, code }`. 검증(I-1·I-3·배치 병원)은 서비스. 배치 없는 유닛도 허용(device null)
 *   선택: `occurredOn`·`ref`는 CORRECT 이벤트 문맥(기본 오늘)
 * 두 종류를 함께 보내면 단일 tx로 처리(식별 보정 → 메모). 상태·병원·병동 키는 400(이벤트로만 변경).
 * 병원 문맥은 개체에서 유도(body hospitalCode 무시). audit `hospital_device` UPDATE(resourceId=시리얼, before/after 스냅샷)
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const denied = await checkDeviceRegistryAccess(user, { write: true })
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })

  try {
    const deviceId = parseIdParam(params.id, '기기 ID')
    const body = await readJsonObject(request)

    const blocked = EVENT_ONLY_KEYS.filter((k) => k in body)
    if (blocked.length > 0) {
      return NextResponse.json({ error: `상태·병원·병동은 이벤트(등록/이동/회수)로만 변경할 수 있습니다: ${blocked.join(', ')}` }, { status: 400 })
    }
    const identityKeys = IDENTITY_KEYS.filter((k) => k in body)
    const hasMemo = 'memo' in body
    if (identityKeys.length === 0 && !hasMemo) {
      return NextResponse.json({ error: '변경할 항목이 없습니다 (memo·usageTypeId·productType·dealCode·condition·location 또는 식별 필드 deviceInfoId·serialNo·macAddress·extDeviceCode)' }, { status: 400 })
    }
    if (hasMemo && body.memo !== null && typeof body.memo !== 'string') {
      return NextResponse.json({ error: '메모는 문자열이어야 합니다' }, { status: 400 })
    }

    let changes: CorrectChanges | null = null
    let occurredOn: string | undefined
    let ref: ReturnType<typeof parseRef> | undefined
    if (identityKeys.length > 0) {
      const needsAdmin = identityKeys.some((k) => !WRITE_LEVEL_IDENTITY_KEYS.includes(k))
      if (needsAdmin) {
        const adminDenied = await checkDeviceRegistryAccess(user, { admin: true })
        if (adminDenied) return NextResponse.json({ error: adminDenied.error }, { status: adminDenied.status })
      }
      changes = {}
      if ('usageTypeId' in body) {
        // null = 미지정으로 되돌리기, 양의 정수 = DEVICE_USAGE_TYPE id(서비스가 마스터 검증)
        if (body.usageTypeId === null || body.usageTypeId === '') changes.usageTypeId = null
        else {
          const v = optionalInt(body.usageTypeId, '용도')
          if (v === undefined) changes.usageTypeId = null
          else changes.usageTypeId = v
        }
      }
      if ('productType' in body) {
        // null/'' = 미지정, 문자열은 서비스가 별칭 매칭(일반/라이트, 미매칭 400)
        if (body.productType === null || body.productType === '') changes.productType = null
        else if (typeof body.productType !== 'string') return NextResponse.json({ error: '상품유형 값이 올바르지 않습니다 (일반/라이트)' }, { status: 400 })
        else changes.productType = body.productType
      }
      if ('dealCode' in body) {
        // null/'' = 미지정, 문자열은 서비스가 계약완료 딜 소속 검증(아니면 409 — B-23)
        if (body.dealCode === null || body.dealCode === '') changes.dealCode = null
        else if (typeof body.dealCode !== 'string') return NextResponse.json({ error: '계약건 값이 올바르지 않습니다 (딜 코드)' }, { status: 400 })
        else changes.dealCode = body.dealCode
      }
      if ('condition' in body) {
        // null/'' = 미확인(NULL — 백필·재도출 전용 값이지만 admin 보정으로 되돌릴 수 있게 허용), 문자열은 6종만
        if (body.condition === null || body.condition === '') changes.condition = null
        else if (!isDeviceCondition(body.condition)) return NextResponse.json({ error: `기기 상태 값이 올바르지 않습니다 (${DEVICE_CONDITIONS.join(' | ')})` }, { status: 400 })
        else changes.condition = body.condition
      }
      if ('location' in body) {
        const loc = parseLocationBody(body.location)
        if (loc instanceof NextResponse) return loc
        changes.location = loc
      }
      if ('deviceInfoId' in body) {
        const v = optionalInt(body.deviceInfoId, '모델')
        if (v === undefined) return NextResponse.json({ error: '모델을 선택하세요' }, { status: 400 })
        changes.deviceInfoId = v
      }
      if ('serialNo' in body) {
        if (typeof body.serialNo !== 'string' || !body.serialNo.trim()) return NextResponse.json({ error: '시리얼이 비어 있습니다' }, { status: 400 })
        changes.serialNo = body.serialNo
      }
      for (const k of ['macAddress', 'extDeviceCode'] as const) {
        if (!(k in body)) continue
        if (body[k] !== null && typeof body[k] !== 'string') return NextResponse.json({ error: `${k}은(는) 문자열이어야 합니다` }, { status: 400 })
        changes[k] = (body[k] as string | null) ?? null
      }
      if (body.occurredOn != null && body.occurredOn !== '') {
        if (typeof body.occurredOn !== 'string') return NextResponse.json({ error: '업무일자 형식이 올바르지 않습니다 (YYYY-MM-DD)' }, { status: 400 })
        occurredOn = body.occurredOn.trim()
      }
      if ('ref' in body) ref = parseRef(body.ref)
    }

    const actor = registryActor(user)
    const memoValue = hasMemo ? ((body.memo as string | null) ?? null) : undefined
    const r = await prisma.$transaction(
      async (tx) => {
        const correct = changes ? await correctDevice({ actor, occurredOn, ref }, { deviceId, changes }, { client: tx }) : null
        const memo = memoValue !== undefined ? await updateDeviceMemo({ actor }, { deviceId, memo: memoValue }, { client: tx }) : null
        return { correct, memo }
      },
      { timeout: 30_000, maxWait: 10_000 }
    )

    // 배치 없는 유닛(고아·PRE_SHIP)의 상태·위치 보정은 device가 null — 스냅샷은 changes만 (2026-09-17 correctDevice 배치 무관 조회)
    const device = r.memo?.device ?? r.correct?.device ?? null
    const unitIdent = r.correct?.unit
    const beforeSnap = (device ? projectionSnapshot(device) : { id: unitIdent?.id, serialNo: unitIdent?.serialNo }) as Record<string, unknown>
    const afterSnap = (device ? projectionSnapshot(device) : { id: unitIdent?.id, serialNo: unitIdent?.serialNo }) as Record<string, unknown>
    if (r.correct) {
      for (const [field, v] of Object.entries(r.correct.changes)) {
        beforeSnap[field] = v.before
        afterSnap[field] = v.after
      }
    }
    if (r.memo) {
      beforeSnap.memo = r.memo.before
      afterSnap.memo = r.memo.after
    }
    const changeKeys = r.correct ? Object.keys(r.correct.changes) : []
    const usageLabel = (id: unknown) => (id == null ? '미지정' : (usageNames.get(Number(id)) ?? `#${String(id)}`))
    const usageNames = r.correct?.changes.usageTypeId
      ? new Map((await prisma.statusCode.findMany({ where: { category: DEVICE_USAGE_TYPE_CATEGORY }, select: { id: true, name: true } })).map((s) => [s.id, s.name]))
      : new Map<number, string>()
    const usagePart = r.correct?.changes.usageTypeId ? `용도 ${usageLabel(r.correct.changes.usageTypeId.before)} → ${usageLabel(r.correct.changes.usageTypeId.after)}` : null
    const ptPart = r.correct?.changes.productType ? `상품유형 ${String(r.correct.changes.productType.before ?? '미지정')} → ${String(r.correct.changes.productType.after ?? '미지정')}` : null
    const dealPart = r.correct?.changes.dealCode ? `계약건 ${String(r.correct.changes.dealCode.before ?? '미지정')} → ${String(r.correct.changes.dealCode.after ?? '미지정')}` : null
    // 기기 상태·위치 보정(2026-09-17 §8.3) — 라벨 '기기 상태 보정'/'위치 보정', 스냅샷은 문장화 값(위치 병원은 이름으로)
    const unitState = r.correct ? unitStateChangesOf(r.correct.changes) : null
    const hospitalNames = new Map<string, string>()
    if (unitState) {
      const codes = [unitState.location.before, unitState.location.after].filter((l) => l.kind === 'HOSPITAL' && l.code).map((l) => l.code!)
      if (codes.length > 0) for (const h of await prisma.hospital.findMany({ where: { hospitalCode: { in: codes } }, select: { hospitalCode: true, hospitalName: true } })) hospitalNames.set(h.hospitalCode, h.hospitalName)
    }
    const condChanged = !!unitState && (unitState.condition.before ?? null) !== (unitState.condition.after ?? null)
    const locChanged = !!unitState && ((unitState.location.before.kind ?? null) !== (unitState.location.after.kind ?? null) || (unitState.location.before.code ?? null) !== (unitState.location.after.code ?? null))
    const condPart = unitState && condChanged ? `기기 상태 보정 ${deviceConditionLabel(unitState.condition.before)} → ${deviceConditionLabel(unitState.condition.after)}` : null
    const locPart = unitState && locChanged ? `위치 보정 ${locationSnapshotText(unitState.location.before, hospitalNames)} → ${locationSnapshotText(unitState.location.after, hospitalNames)}` : null
    if (unitState) {
      beforeSnap.condition = deviceConditionLabel(unitState.condition.before)
      afterSnap.condition = deviceConditionLabel(unitState.condition.after)
      beforeSnap.location = locationSnapshotText(unitState.location.before, hospitalNames)
      afterSnap.location = locationSnapshotText(unitState.location.after, hospitalNames)
    }
    const parts = [
      r.correct && changeKeys.some((k) => !OPS_KEYS.includes(k)) ? `식별 보정(${changeKeys.filter((k) => !OPS_KEYS.includes(k)).join(', ')})` : null,
      usagePart,
      ptPart,
      dealPart,
      condPart,
      locPart,
      r.memo ? '메모' : null,
    ].filter(Boolean)
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_device',
      resourceId: device?.serialNo ?? unitIdent?.serialNo ?? String(deviceId),
      resourceLabel: `${await deviceAuditLabel(device?.id ?? deviceId)} ${parts.join('·')}`,
      before: beforeSnap,
      after: { ...afterSnap, ...(r.correct ? { correctEventId: r.correct.event.id, changes: r.correct.changes } : {}) },
    })

    return NextResponse.json({
      device,
      ...(r.correct ? { event: r.correct.event, changes: r.correct.changes, wms: r.correct.wms } : {}),
      ...(r.memo ? { memo: { before: r.memo.before, after: r.memo.after } } : {}),
    })
  } catch (e) {
    return registryErrorResponse(e, `units/${params.id} PATCH`)
  }
}
