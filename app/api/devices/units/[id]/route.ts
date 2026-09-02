import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { correctDevice, getUnitDetail, updateDeviceMemo, type CorrectChanges } from '@/lib/deviceRegistry'
import { DEVICE_USAGE_TYPE_CATEGORY } from '@/lib/deviceRegistryShared'
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
    return NextResponse.json({ error: '디바이스 원장 조회 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

const IDENTITY_KEYS = ['deviceInfoId', 'serialNo', 'macAddress', 'extDeviceCode', 'usageTypeId', 'productType', 'dealCode'] as const
/** 식별 보정 중 write(USER+)로 허용되는 키 — 용도·상품유형·계약건은 운영 속성이라 admin 게이트 밖(B-21·B-22·B-23) */
const WRITE_LEVEL_IDENTITY_KEYS: readonly (typeof IDENTITY_KEYS)[number][] = ['usageTypeId', 'productType', 'dealCode']
const EVENT_ONLY_KEYS = ['status', 'hospitalCode', 'wardId', 'placedOn', 'recoveredOn', 'lastHospitalCode', 'recoverReasonId', 'replacedById'] as const

/**
 * PATCH /api/devices/units/[id] — 개체 속성 수정 (§7.1·§8.2)
 * - `{ memo }`                                   : 유닛 메모(`device_units.memo`) UPDATE (write, 이벤트 아님)
 * - `{ deviceInfoId?|serialNo?|macAddress?|extDeviceCode? }` : 식별 보정 → CORRECT 이벤트 (admin) — 시리얼·모델·MAC은 유닛, 닉네임은 배치. 시리얼 충돌 409, 이력 있는 개체의 시리얼 정정 409
 * - `{ usageTypeId }`                            : 용도(판매용/평가용/null=미지정) → CORRECT 이벤트 (**write** — USER+, 다른 식별 키와 함께 보내면 admin)
 * - `{ productType }`                            : 상품유형(일반/라이트/null=미지정, 배치 속성 B-22) → CORRECT 이벤트 (**write** — USER+, 잘못된 값 400)
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
      return NextResponse.json({ error: '변경할 항목이 없습니다 (memo·usageTypeId·productType·dealCode 또는 식별 필드 deviceInfoId·serialNo·macAddress·extDeviceCode)' }, { status: 400 })
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

    const device = r.memo?.device ?? r.correct!.device
    const beforeSnap = projectionSnapshot(device) as Record<string, unknown>
    const afterSnap = projectionSnapshot(device) as Record<string, unknown>
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
    const OPS_KEYS = ['usageTypeId', 'productType', 'dealCode']
    const parts = [
      r.correct && changeKeys.some((k) => !OPS_KEYS.includes(k)) ? `식별 보정(${changeKeys.filter((k) => !OPS_KEYS.includes(k)).join(', ')})` : null,
      usagePart,
      ptPart,
      dealPart,
      r.memo ? '메모' : null,
    ].filter(Boolean)
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'hospital_device',
      resourceId: device.serialNo,
      resourceLabel: `${await deviceAuditLabel(device.id)} ${parts.join('·')}`,
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
