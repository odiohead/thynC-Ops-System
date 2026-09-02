import { NextRequest, NextResponse } from 'next/server'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { importBatch, previewRows, type RegistryCtx } from '@/lib/deviceRegistry'
import { IMPORT_BATCH_MODES, IMPORT_MAX_ROWS, todayKst, type ImportBatchMode, type ImportSourceKind } from '@/lib/deviceRegistryShared'
import {
  BadRequest,
  capList,
  errorResponse,
  guardHospitalRoute,
  jsonField,
  optPositiveInt,
  optString,
  parseIntArray,
  parseRowActions,
  parseStringArray,
  parseWardAliases,
  registryActor,
} from '../shared'
import { parseImportExcel, parseImportText, type ParsedImportInput } from './parse'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

interface ImportOptions {
  mode: ImportBatchMode | null
  deviceInfoId: number | null
  /** 폼 공통 용도(행에 용도 열이 없을 때 적용) */
  usageTypeId: number | null
  /** 폼 공통 상품유형(일반/라이트 — 행 F열/붙여넣기 셀이 없을 때, 없으면 병원 딜 기본값 규칙) */
  productType: string | null
  /** 폼 공통 계약건(딜 코드, B-23) — 없으면 단일 계약완료 딜 자동 기본값 */
  dealCode: string | null
  wardMode: 'column' | 'fixed'
  wardId: number | null
  emptyWardCell: 'warn' | 'error'
  occurredOn: string | null
  excludeRows: number[]
  /** excludeRows 필드가 배열로 명시됐는지(빈 배열 포함) — 미리보기에서 명시면 기본 제외 대신 그 기준(실행은 항상 명시 기준) */
  excludeRowsExplicit: boolean
  rowActions: ReturnType<typeof parseRowActions>
  wardAliases: Record<string, number>
  /** null = 미지정(초안 모드 distinct org ≥2면 서비스가 400) */
  orgs: string[] | null
  memo: string | null
  fileName: string | null
}

/** 옵션 정규화 — multipart 필드(문자열·JSON 문자열)와 JSON 본문을 같은 형상으로 */
function parseOptions(raw: Record<string, unknown>): ImportOptions {
  const modeRaw = optString(raw.mode)
  if (modeRaw && !(IMPORT_BATCH_MODES as readonly string[]).includes(modeRaw)) throw new BadRequest('임포트 모드(mode)가 올바르지 않습니다 (REGISTER|ONPREM_DRAFT).')
  const wardModeRaw = optString(raw.wardMode) ?? 'column'
  if (wardModeRaw !== 'column' && wardModeRaw !== 'fixed') throw new BadRequest('병동 모드(wardMode)가 올바르지 않습니다 (column|fixed).')
  const emptyRaw = optString(raw.emptyWardCell) ?? 'warn'
  if (emptyRaw !== 'warn' && emptyRaw !== 'error') throw new BadRequest('빈 병동 셀 처리(emptyWardCell)가 올바르지 않습니다 (warn|error).')
  const orgsField = jsonField(raw.orgs, 'orgs')
  const excludeField = jsonField(raw.excludeRows, 'excludeRows')
  return {
    mode: (modeRaw as ImportBatchMode | null) ?? null,
    deviceInfoId: optPositiveInt(raw.deviceInfoId, '모델(deviceInfoId)'),
    usageTypeId: optPositiveInt(raw.usageTypeId, '용도(usageTypeId)'),
    productType: optString(raw.productType),
    dealCode: optString(raw.dealCode),
    wardMode: wardModeRaw,
    wardId: optPositiveInt(raw.wardId, '고정 병동(wardId)'),
    emptyWardCell: emptyRaw,
    occurredOn: optString(raw.occurredOn),
    excludeRows: parseIntArray(excludeField, 'excludeRows'),
    excludeRowsExplicit: Array.isArray(excludeField),
    rowActions: parseRowActions(jsonField(raw.rowActions, 'rowActions')),
    wardAliases: parseWardAliases(jsonField(raw.wardAliases, 'wardAliases')),
    orgs: orgsField == null ? null : parseStringArray(orgsField, 'orgs'),
    memo: optString(raw.memo ?? raw.note),
    fileName: optString(raw.fileName),
  }
}

interface ReadResult {
  input: ParsedImportInput
  options: ImportOptions
  sourceKind: ImportSourceKind
  fileName: string | null
}

/** multipart(file + 옵션 필드) 또는 JSON `{ text, ...옵션 }` */
async function readRequest(request: NextRequest): Promise<ReadResult> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    if (!form) throw new BadRequest('multipart 본문을 읽을 수 없습니다.')
    const raw: Record<string, unknown> = {}
    form.forEach((v, k) => {
      if (typeof v === 'string') raw[k] = v
    })
    const options = parseOptions(raw)
    const file = form.get('file')
    if (file && typeof file !== 'string') {
      const input = parseImportExcel(await file.arrayBuffer())
      return { input, options, sourceKind: 'EXCEL', fileName: file.name || options.fileName }
    }
    const text = optString(form.get('text'))
    if (!text) throw new BadRequest('파일(file) 또는 붙여넣기 텍스트(text)가 필요합니다.')
    return { input: parseImportText(text), options, sourceKind: 'PASTE', fileName: options.fileName }
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('요청 본문(JSON)이 올바르지 않습니다.')
  const raw = body as Record<string, unknown>
  const options = parseOptions(raw)
  const text = typeof raw.text === 'string' ? raw.text : null
  if (!text || !text.trim()) throw new BadRequest('붙여넣기 텍스트(text)가 비어 있습니다.')
  return { input: parseImportText(text), options, sourceKind: 'PASTE', fileName: options.fileName }
}

/**
 * POST /api/hospitals/[code]/devices/import[?preview=true] — 검토형 임포트 (§7.1·§7.2, write)
 * - preview: `{ rows[], summary, input:{ format, onprem, header, columns, sourceKind, fileName, rowCount, mode } }` — DB 쓰기 없음
 * - 실행: 201 `{ batch, result, summary, warnings }` — 서버 재검증 후 단일 tx(120s). 미제외 오류 400 `{ error, rows[] }` · 미지정 conflict 409 `{ error, conflicts[] }` · 소급 불성립 409 `{ error, rows[] }`
 * mode 미지정 시 입력 형상으로 결정(온프렘 export 감지 → ONPREM_DRAFT, 그 외 REGISTER)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code, { write: true })
  if (!g.ok) return g.response
  const { user, hospital } = g
  const preview = request.nextUrl.searchParams.get('preview') === 'true'

  try {
    const { input, options, sourceKind, fileName } = await readRequest(request)
    if (input.rows.length === 0) {
      throw new BadRequest(
        sourceKind === 'EXCEL'
          ? '파일에 유효한 데이터가 없습니다. 첫 시트 A열=시리얼(B 모델·C 병동·D 메모·E 용도·F 상품유형, 1행 헤더)을 확인하세요.'
          : '유효한 시리얼 줄이 없습니다. 줄당 1건(시리얼<TAB>병동<TAB>메모) 또는 온프렘 export 목록을 붙여넣으세요.'
      )
    }
    if (input.shape.overflow || input.rows.length > IMPORT_MAX_ROWS) {
      throw new BadRequest(`한 번에 최대 ${IMPORT_MAX_ROWS.toLocaleString()}행까지 처리할 수 있습니다 — 나눠서 임포트하세요.`)
    }
    const mode: ImportBatchMode = options.mode ?? (input.shape.onprem ? 'ONPREM_DRAFT' : 'REGISTER')
    const defaults = {
      deviceInfoId: options.deviceInfoId,
      usageTypeId: options.usageTypeId,
      productType: options.productType,
      dealCode: options.dealCode,
      wardMode: options.wardMode,
      wardId: options.wardId,
      emptyWardCell: options.emptyWardCell,
    }

    if (preview) {
      const result = await previewRows(hospital.hospitalCode, input.rows, {
        ...defaults,
        mode,
        orgs: options.orgs,
        wardAliases: Object.keys(options.wardAliases).length ? options.wardAliases : null,
        occurredOn: options.occurredOn ?? todayKst(),
        rowActions: options.rowActions,
        excludeRows: options.excludeRowsExplicit ? options.excludeRows : null,
      })
      return NextResponse.json({
        rows: result.rows,
        summary: result.summary,
        input: { ...input.shape, sourceKind, fileName, rowCount: input.rows.length, mode },
      })
    }

    const ctx: RegistryCtx = {
      hospitalCode: hospital.hospitalCode,
      actor: registryActor(user),
      occurredOn: options.occurredOn,
      memo: options.memo,
      source: 'IMPORT',
    }
    const { batch, result, preview: verified, warnings } = await importBatch(ctx, {
      rows: input.rows,
      excludeRows: options.excludeRows,
      rowActions: options.rowActions,
      wardAliases: Object.keys(options.wardAliases).length ? options.wardAliases : null,
      orgs: options.orgs,
      sourceKind,
      mode,
      fileName,
      defaults,
    })

    const serials = [...result.created, ...result.reregistered, ...result.transferred].map((r) => r.serialNo)
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'CREATE',
      resource: 'hospital_device_import',
      resourceId: batch.id,
      resourceLabel: `${hospital.hospitalName} 기기 임포트 #${batch.id} — 등록 ${batch.registeredCount} · 재등록 ${batch.reregisteredCount} · 이관 ${batch.transferredCount} · 건너뜀 ${batch.skippedCount}`,
      after: {
        hospitalCode: hospital.hospitalCode,
        batchId: batch.id,
        actionGroup: result.actionGroup,
        mode,
        sourceKind,
        fileName,
        usageTypeId: options.usageTypeId,
        productType: options.productType,
        dealCode: options.dealCode,
        occurredOn: verified.summary.occurredOn,
        counts: {
          rows: batch.rowCount,
          registered: batch.registeredCount,
          reregistered: batch.reregisteredCount,
          transferred: batch.transferredCount,
          skipped: batch.skippedCount,
          events: result.events.length,
          newWards: result.newWards.length,
        },
        serials: capList(serials),
        truncated: serials.length > 50,
        newWards: result.newWards,
        orgs: options.orgs,
        memo: options.memo,
      },
    })

    return NextResponse.json(
      {
        batch,
        result: {
          actionGroup: result.actionGroup,
          created: result.created,
          reregistered: result.reregistered,
          transferred: result.transferred,
          skipped: result.skipped,
          newWards: result.newWards,
          eventIds: result.events,
          warnings: result.warnings,
        },
        summary: verified.summary,
        warnings,
      },
      { status: 201 }
    )
  } catch (e) {
    return errorResponse(e, preview ? '임포트 미리보기 중 오류가 발생했습니다.' : '임포트 실행 중 오류가 발생했습니다.')
  }
}
