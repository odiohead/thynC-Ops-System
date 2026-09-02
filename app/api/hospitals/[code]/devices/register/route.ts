import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { RegistryError, previewRows, registerDevices, type ImportRowInput, type RegisterItem, type RegistryCtx } from '@/lib/deviceRegistry'
import { IMPORT_MAX_ROWS, normalizeSerial, todayKst } from '@/lib/deviceRegistryShared'
import {
  BadRequest,
  capList,
  errorResponse,
  guardHospitalRoute,
  optPositiveInt,
  optString,
  parseIntArray,
  parseRef,
  parseRowActions,
  parseWardAliases,
  readJsonObject,
  registryActor,
} from '../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/** `conflicts: { [serial]: 'TRANSFER' }` — 키는 normalizeSerial 통과(서비스는 정규화 키로 대조) */
function parseConflicts(v: unknown): Record<string, 'TRANSFER'> {
  if (v == null || v === '') return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequest('conflicts 형식이 올바르지 않습니다.')
  const out: Record<string, 'TRANSFER'> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val == null || val === '' || val === false) continue
    if (val !== 'TRANSFER' && val !== true) throw new BadRequest(`시리얼 ${k}의 충돌 처리 값이 올바르지 않습니다 (TRANSFER만 허용).`)
    const key = normalizeSerial(k).serialNo
    if (key) out[key] = 'TRANSFER'
  }
  return out
}

interface ParsedBody {
  items: RegisterItem[]
  /** 항목별 지정이 없을 때만 쓰는 공통값(미리보기 fixed 모드 판정용) */
  common: { deviceInfoId: number | null; wardId: number | null; wardName: string | null; usageTypeId: number | null; productType: string | null; dealCode: string | null }
  anyItemWard: boolean
  anyItemModel: boolean
  occurredOn: string | null
  memo: string | null
  ref: ReturnType<typeof parseRef>
  conflicts: Record<string, 'TRANSFER'>
  rowActions: ReturnType<typeof parseRowActions>
  excludeRows: number[]
  wardAliases: Record<string, number>
}

/**
 * body `{ items[], occurredOn, memo?, ref?, conflicts?, deviceInfoId?, wardId?|wardName?, usageTypeId?, productType?, rowActions?, excludeRows?, wardAliases? }`
 * items[i]: 문자열(시리얼) 또는 `{ serialInput|serial|serialNo, deviceInfoId?, modelInput?, wardId?|wardName?, memo?, macAddress?, extDeviceCode?, usageTypeId?|usageType?, productType? }`
 * 병동 우선순위: item.wardId > item.wardName > body.wardId > body.wardName (모델·용도도 동일 — 용도는 item.usageTypeId > item.usageType(문자열) > body.usageTypeId)
 * 상품유형(B-22): item.productType > body.productType > 서비스 기본값 규칙(병원 계약완료 딜 1종 → 그 값 · 0종 → 미지정 경고 · 혼합 → 400 필수)
 */
function parseBody(body: Record<string, unknown>): ParsedBody {
  const rawItems = body.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new BadRequest('등록할 시리얼(items)이 없습니다.')
  if (rawItems.length > IMPORT_MAX_ROWS) throw new BadRequest(`한 번에 최대 ${IMPORT_MAX_ROWS.toLocaleString()}건까지 등록할 수 있습니다 (현재 ${rawItems.length}건).`)

  const common = {
    deviceInfoId: optPositiveInt(body.deviceInfoId, '모델(deviceInfoId)'),
    wardId: optPositiveInt(body.wardId, '병동(wardId)'),
    wardName: optString(body.wardName),
    usageTypeId: optPositiveInt(body.usageTypeId, '용도(usageTypeId)'),
    productType: optString(body.productType),
    dealCode: optString(body.dealCode),
  }
  let anyItemWard = false
  let anyItemModel = false
  const items: RegisterItem[] = rawItems.map((raw, i) => {
    const o: Record<string, unknown> = typeof raw === 'string' ? { serialInput: raw } : raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const serialInput = optString(o.serialInput ?? o.serial ?? o.serialNo)
    if (!serialInput) throw new BadRequest(`${i + 1}번째 항목의 시리얼이 비어 있습니다.`)
    const item: RegisterItem = { serialInput }

    const deviceInfoId = optPositiveInt(o.deviceInfoId, `${i + 1}번째 항목의 모델(deviceInfoId)`)
    const modelInput = optString(o.modelInput ?? o.model)
    if (deviceInfoId != null) {
      item.deviceInfoId = deviceInfoId
      anyItemModel = true
    } else if (modelInput) {
      item.modelInput = modelInput
      anyItemModel = true
    } else if (common.deviceInfoId != null) item.deviceInfoId = common.deviceInfoId

    const wardId = optPositiveInt(o.wardId, `${i + 1}번째 항목의 병동(wardId)`)
    const wardName = optString(o.wardName)
    if (wardId != null) {
      item.wardId = wardId
      anyItemWard = true
    } else if (wardName) {
      item.wardName = wardName
      anyItemWard = true
    } else if (common.wardId != null) item.wardId = common.wardId
    else if (common.wardName) item.wardName = common.wardName

    const memo = optString(o.memo)
    if (memo) item.memo = memo
    const mac = optString(o.macAddress)
    if (mac) item.macAddress = mac
    const ext = optString(o.extDeviceCode)
    if (ext) item.extDeviceCode = ext
    const usageTypeId = optPositiveInt(o.usageTypeId, `${i + 1}번째 항목의 용도(usageTypeId)`)
    const usageTypeInput = optString(o.usageType ?? o.usageTypeInput)
    if (usageTypeId != null) item.usageTypeId = usageTypeId
    else if (usageTypeInput) item.usageTypeInput = usageTypeInput
    else if (common.usageTypeId != null) item.usageTypeId = common.usageTypeId
    const productType = optString(o.productType ?? o.productTypeInput)
    if (productType) item.productType = productType
    else if (common.productType) item.productType = common.productType
    // 계약건(B-23): item.dealCode > body.dealCode > 서비스 자동 기본값(단일 계약완료 딜)
    const dealCode = optString(o.dealCode)
    if (dealCode) item.dealCode = dealCode
    else if (common.dealCode) item.dealCode = common.dealCode
    return item
  })

  return {
    items,
    common,
    anyItemWard,
    anyItemModel,
    occurredOn: optString(body.occurredOn),
    memo: optString(body.memo),
    ref: parseRef(body.ref),
    conflicts: parseConflicts(body.conflicts),
    rowActions: parseRowActions(body.rowActions),
    excludeRows: parseIntArray(body.excludeRows, 'excludeRows'),
    wardAliases: parseWardAliases(body.wardAliases),
  }
}

/**
 * 등록 폼 실시간 판별(§6.1) — 임포트와 같은 `previewRows` 엔진. items → 행(1부터) 매핑.
 * 항목별 병동/모델이 없고 공통 wardId만 있으면 fixed 모드, 아니면 column 모드(병동 id는 이름으로 환원 — name_norm 매칭이 같은 병동으로 해석).
 */
async function previewItems(hospitalCode: string, p: ParsedBody) {
  const wardIds = Array.from(new Set(p.items.map((it) => it.wardId).filter((id): id is number => id != null)))
  const modelIds = Array.from(new Set(p.items.map((it) => it.deviceInfoId).filter((id): id is number => id != null)))
  const useFixedWard = !p.anyItemWard && p.common.wardId != null
  const useFixedModel = !p.anyItemModel && p.common.deviceInfoId != null

  const [wards, models] = await Promise.all([
    useFixedWard || wardIds.length === 0
      ? Promise.resolve([] as { id: number; name: string }[])
      : prisma.hospitalWard.findMany({ where: { id: { in: wardIds }, hospitalCode }, select: { id: true, name: true } }),
    useFixedModel || modelIds.length === 0
      ? Promise.resolve([] as { id: number; deviceModel: string }[])
      : prisma.deviceInfo.findMany({ where: { id: { in: modelIds } }, select: { id: true, deviceModel: true } }),
  ])
  const wardName = new Map(wards.map((w) => [w.id, w.name]))
  const modelName = new Map(models.map((m) => [m.id, m.deviceModel]))
  if (!useFixedWard) {
    const missing = wardIds.filter((id) => !wardName.has(id))
    if (missing.length > 0) throw new RegistryError(404, `병동을 찾을 수 없습니다 (이 병원 소속이 아님): ${missing.join(', ')}`)
  }
  if (!useFixedModel) {
    const missing = modelIds.filter((id) => !modelName.has(id))
    if (missing.length > 0) throw new RegistryError(400, `모델을 찾을 수 없습니다: ${missing.join(', ')}`)
  }

  const rowActions = { ...p.rowActions }
  const rows: ImportRowInput[] = p.items.map((it, i) => {
    const row = i + 1
    if (p.conflicts[normalizeSerial(it.serialInput).serialNo]) rowActions[row] = 'TRANSFER'
    return {
      row,
      serialInput: it.serialInput,
      wardInput: useFixedWard ? null : it.wardName ?? (it.wardId != null ? wardName.get(it.wardId) ?? null : null),
      modelInput: useFixedModel ? null : it.modelInput ?? (it.deviceInfoId != null ? modelName.get(it.deviceInfoId) ?? null : null),
      memo: it.memo ?? null,
      macAddress: it.macAddress ?? null,
      extDeviceCode: it.extDeviceCode ?? null,
      usageTypeId: it.usageTypeId ?? null,
      usageTypeInput: it.usageTypeInput ?? null,
      productTypeInput: it.productType ?? null,
      dealCode: it.dealCode ?? null,
    }
  })

  return previewRows(hospitalCode, rows, {
    deviceInfoId: useFixedModel ? p.common.deviceInfoId : null,
    usageTypeId: p.common.usageTypeId,
    productType: p.common.productType,
    wardMode: useFixedWard ? 'fixed' : 'column',
    wardId: useFixedWard ? p.common.wardId : null,
    emptyWardCell: 'warn',
    mode: 'REGISTER',
    wardAliases: Object.keys(p.wardAliases).length ? p.wardAliases : null,
    occurredOn: p.occurredOn ?? todayKst(),
    rowActions,
    excludeRows: p.excludeRows.length ? p.excludeRows : null,
  })
}

/**
 * POST /api/hospitals/[code]/devices/register[?preview=true] — N개 등록(신규·재등록·opt-in 이관) (§7.1, write)
 * 201 `{ actionGroup, created[], reregistered[], transferred[], skipped[], warnings[], newWards[], eventIds[], wms }`
 * 409 `{ error, conflicts[] }`(타 병원 ACTIVE 미지정) · 409 `{ error, skipped[] }`(단건/전부 이미 배치) · 400 모델 판별 불가
 */
export async function POST(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code, { write: true })
  if (!g.ok) return g.response
  const { user, hospital } = g
  const preview = request.nextUrl.searchParams.get('preview') === 'true'

  try {
    const body = await readJsonObject(request)
    if (!body) return NextResponse.json({ error: '요청 본문(JSON)이 올바르지 않습니다.' }, { status: 400 })
    const p = parseBody(body)

    if (preview) {
      const result = await previewItems(hospital.hospitalCode, p)
      return NextResponse.json({ rows: result.rows, summary: result.summary, productTypeContext: result.summary.productTypeContext })
    }

    // 실행 — rowActions의 TRANSFER(행 기준)도 conflicts(시리얼 기준)로 합친다(판별 패널 [이관 처리]와 같은 입력)
    const conflicts = { ...p.conflicts }
    for (const [rowKey, action] of Object.entries(p.rowActions)) {
      if (action !== 'TRANSFER') continue
      const item = p.items[Number(rowKey) - 1]
      if (item) conflicts[normalizeSerial(item.serialInput).serialNo] = 'TRANSFER'
    }
    const ctx: RegistryCtx = {
      hospitalCode: hospital.hospitalCode,
      actor: registryActor(user),
      occurredOn: p.occurredOn,
      ref: p.ref,
      memo: p.memo,
      source: 'MANUAL',
    }
    const result = await registerDevices(ctx, p.items, { conflicts: Object.keys(conflicts).length ? conflicts : null })

    const touched = [
      ...result.created.map((r) => ({ ...r, kind: 'created' as const })),
      ...result.reregistered.map((r) => ({ ...r, kind: 'reregistered' as const })),
      ...result.transferred.map((r) => ({ ...r, kind: 'transferred' as const })),
    ]
    const serials = touched.map((t) => t.serialNo)

    if (p.items.length === 1 && touched.length === 1) {
      // 단건 등록 — hospital_device(id=serial) CREATE (§8.3). t.id = 공개 device id(유닛 id)
      const t = touched[0]
      const device = await prisma.deviceUnit.findUnique({ where: { id: t.id }, select: { deviceInfo: { select: { deviceModel: true } } } })
      await logAudit({
        req: request,
        actor: auditActorFromJWT(user),
        action: 'CREATE',
        resource: 'hospital_device',
        resourceId: t.serialNo,
        resourceLabel: `${hospital.hospitalName} ${device?.deviceInfo.deviceModel ?? ''} ${t.serialNo}`.replace(/\s+/g, ' ').trim(),
        after: {
          deviceId: t.id,
          serialNo: t.serialNo,
          kind: t.kind,
          eventId: t.eventId,
          wardId: t.wardId,
          productType: t.productType,
          fromHospitalCode: 'fromHospitalCode' in t ? t.fromHospitalCode : undefined,
          actionGroup: result.actionGroup,
          occurredOn: p.occurredOn ?? todayKst(),
          ref: p.ref,
          memo: p.memo,
        },
      })
    } else {
      // 다건 — hospital_device_event(action_group) 1행, eventIds·시리얼 ≤50 (§8.3)
      await logAudit({
        req: request,
        actor: auditActorFromJWT(user),
        action: 'CREATE',
        resource: 'hospital_device_event',
        resourceId: result.actionGroup,
        resourceLabel: `${hospital.hospitalName} 기기 등록 ${touched.length}대`,
        after: {
          hospitalCode: hospital.hospitalCode,
          action: 'REGISTER',
          counts: { items: p.items.length, created: result.created.length, reregistered: result.reregistered.length, transferred: result.transferred.length, skipped: result.skipped.length, events: result.events.length },
          eventIds: capList(result.events),
          serials: capList(serials),
          truncated: result.events.length > 50 || serials.length > 50,
          newWards: result.newWards,
          productType: p.common.productType,
          occurredOn: p.occurredOn ?? todayKst(),
          ref: p.ref,
          memo: p.memo,
        },
      })
    }

    return NextResponse.json(
      {
        actionGroup: result.actionGroup,
        created: result.created,
        reregistered: result.reregistered,
        transferred: result.transferred,
        skipped: result.skipped,
        warnings: result.warnings,
        newWards: result.newWards,
        eventIds: result.events,
        wms: result.wms,
      },
      { status: 201 }
    )
  } catch (e) {
    return errorResponse(e, preview ? '등록 판별 중 오류가 발생했습니다.' : '기기 등록 중 오류가 발생했습니다.')
  }
}
