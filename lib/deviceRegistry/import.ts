/**
 * 검토형 임포트 — 미리보기 판정(§7.2 서버 단일 소스) + 실행(§7.2 실행 규칙 · §5.4 배치)
 *
 * - `previewRows`는 DB에 쓰지 않는다(병동 생성은 시뮬레이션, WMS 매칭은 일시 계산)
 * - 3층 구조: 원장 상태는 유닛(`device_units`)+배치(`hospital_devices`)로 본다 — 배치 없는 고아 유닛은 신규(ok)로 판정하되 모델은 유닛의 모델을 쓴다
 * - `importBatch`는 같은 트랜잭션에서 미리보기를 다시 돌려(클라이언트 판정 불신) 배치 행을 만들고 `registerDevicesIn`으로 실행한다
 * - 판정: ok | reregister | skip | warn | conflict | error — 우선순위 error > conflict > skip > reregister > warn > ok
 */
import { Prisma } from '@prisma/client'
import {
  IMPORT_MAX_ROWS,
  IMPORT_ROW_ACTIONS,
  IMPORT_SOURCE_KINDS,
  IMPORT_BATCH_MODES,
  RECOVERY_REASON_FALLBACK_LABELS,
  normalizeSerial,
  normalizeWardName,
  type ImportBatchMode,
  type ImportRowAction,
  type ImportSourceKind,
  type ImportVerdict,
} from '@/lib/deviceRegistryShared'
import { prisma } from '@/lib/prisma'
import {
  RegistryError,
  findUnitsBySerial,
  hospitalNames,
  listHospitalWards,
  loadRecoveryReasons,
  loadTrackedModels,
  prepareCtx,
  requireOccurredOn,
  resolveModel,
  wardNames,
  withRegistryTx,
  ymd,
  ymdToDate,
  type Conflict,
  type DbClient,
  type DeviceRow,
  type RegistryCtx,
  type RegistryOpts,
  type WardRef,
} from './core'
import { registerDevicesIn, type RegisterItem, type RegisterResult } from './write'
import { matchInventoryUnits, type WmsMatch } from './wms'

// ─────────────────────────────────────────────────────────────────────────────
// 입력·출력 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportRowInput {
  /** 시트 실제 행 번호 / 붙여넣기 원문 줄 번호 (§7.2) */
  row: number
  serialInput: string
  /** 병동 열(이름 또는 ext_ward_code) */
  wardInput?: string | null
  /** Excel B열 모델 */
  modelInput?: string | null
  /** D열 메모 → REGISTER 이벤트 memo */
  memo?: string | null
  /** 온프렘 export 초안 열 (부록 B-3) */
  org?: string | null
  deviceType?: number | null
  wardCode?: string | null
  macAddress?: string | null
  extDeviceCode?: string | null
}

export interface PreviewDefaults {
  /** 모델 고정 (없으면 행별 자동) */
  deviceInfoId?: number | null
  wardMode: 'column' | 'fixed'
  /** wardMode=fixed */
  wardId?: number | null
  /** column 모드 빈 셀 처리 (기본 warn=미지정 등록) */
  emptyWardCell?: 'warn' | 'error' | null
  mode: ImportBatchMode
  /** 초안 모드 — 등록할 org 목록(없으면 전부) */
  orgs?: string[] | null
  /** 입력 병동명 → 기존 병동 id 매핑(생성 대신) */
  wardAliases?: Record<string, number> | null
  occurredOn: string
  /** 행 액션 (conflict: TRANSFER / 병동 error: UNASSIGN_WARD) */
  rowActions?: Record<number, ImportRowAction> | null
  /** 명시 제외 행 — 주어지면 defaultExcluded 대신 이 목록이 기준 */
  excludeRows?: number[] | null
}

export interface PreviewExisting {
  deviceId: number
  status: string
  hospitalCode: string | null
  hospitalName: string | null
  wardName: string | null
  placedOn: string | null
  lastHospitalCode: string | null
  lastHospitalName: string | null
  recoveredOn: string | null
  recoverReason: string | null
  recoverReasonValue: string | null
}

export interface PreviewRow {
  row: number
  serialInput: string
  serialNo: string
  serialRaw: string | null
  deviceInfoId: number | null
  deviceModel: string | null
  wardInput: string | null
  wardId: number | null
  wardName: string | null
  wardNew: boolean
  wardInactive: boolean
  org: string | null
  status: ImportVerdict
  defaultExcluded: boolean
  /** excludeRows가 주어지면 그 기준, 아니면 defaultExcluded */
  excluded: boolean
  messages: string[]
  /** 이 행에 허용되는 액션 */
  actions: ImportRowAction[]
  /** 적용된 액션 */
  action: ImportRowAction | null
  existing: PreviewExisting | null
  wms: WmsMatch | null
  memo: string | null
  macAddress: string | null
  extDeviceCode: string | null
  /** 실행 시 이 행이 실제로 이벤트를 만드는가 */
  executable: boolean
  /** 초안 모드 — 실행 후 병동에 기록할 온프렘 코드 */
  extWardCodeToSet: string | null
}

export interface PreviewSummary {
  total: number
  ok: number
  reregister: number
  skip: number
  warn: number
  conflict: number
  error: number
  excluded: number
  executable: number
  transfer: number
  newWards: { name: string; nameNorm: string; rows: number; fromCode: boolean }[]
  wardAliases: Record<string, number>
  orgs: { org: string; rows: number; selected: boolean }[]
  occurredOn: string
  mode: ImportBatchMode
}

export interface PreviewResult {
  rows: PreviewRow[]
  summary: PreviewSummary
}

type Kind = 'ok' | 'reregister' | 'skip' | 'conflict'

// ─────────────────────────────────────────────────────────────────────────────
// previewRows — DB 쓰기 없음
// ─────────────────────────────────────────────────────────────────────────────

export async function previewRows(
  hospitalCode: string,
  rows: readonly ImportRowInput[],
  defaults: PreviewDefaults,
  client: DbClient = prisma
): Promise<PreviewResult> {
  if (!hospitalCode) throw new RegistryError(400, '병원 코드가 필요합니다')
  const hospital = await client.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true } })
  if (!hospital) throw new RegistryError(404, '병원을 찾을 수 없습니다')
  if (!IMPORT_BATCH_MODES.includes(defaults.mode)) throw new RegistryError(400, '임포트 모드가 올바르지 않습니다')
  if (defaults.wardMode !== 'column' && defaults.wardMode !== 'fixed') throw new RegistryError(400, '병동 모드가 올바르지 않습니다 (column|fixed)')
  if (!Array.isArray(rows)) throw new RegistryError(400, '행 목록이 필요합니다')
  if (rows.length > IMPORT_MAX_ROWS) throw new RegistryError(400, `행 수가 최대 ${IMPORT_MAX_ROWS}건을 초과합니다 (${rows.length}건) — 나눠서 임포트하세요`)
  const occurredOn = requireOccurredOn(defaults.occurredOn)
  const draft = defaults.mode === 'ONPREM_DRAFT'
  const emptyWardCell = defaults.emptyWardCell ?? 'warn'
  const rowActions = defaults.rowActions ?? {}
  for (const [k, v] of Object.entries(rowActions)) {
    if (!IMPORT_ROW_ACTIONS.includes(v)) throw new RegistryError(400, `행 ${k}의 액션이 올바르지 않습니다: ${String(v)}`)
  }
  const explicitExclude = defaults.excludeRows ? new Set(defaults.excludeRows.map(Number)) : null

  // ── 마스터 로드
  const models = await loadTrackedModels(client)
  const wards = await listHospitalWards(client, hospitalCode)
  const wardsById = new Map(wards.map((w) => [w.id, w]))
  const wardsByNorm = new Map(wards.map((w) => [w.nameNorm, w]))
  const wardsByCode = new Map(wards.filter((w) => w.extWardCode).map((w) => [w.extWardCode!.toUpperCase(), w]))
  const reasons = await loadRecoveryReasons(client)
  const reasonById = new Map(reasons.map((r) => [r.id, r]))

  // 고정 모델·고정 병동 검증(전 행 공통이므로 한 번)
  if (defaults.deviceInfoId != null && !models.some((m) => m.id === Number(defaults.deviceInfoId))) {
    throw new RegistryError(400, '고정 모델이 원장 대상 모델이 아닙니다')
  }
  let fixedWard: WardRef | null = null
  if (defaults.wardMode === 'fixed' && defaults.wardId != null) {
    fixedWard = wardsById.get(Number(defaults.wardId)) ?? null
    if (!fixedWard) throw new RegistryError(404, '고정 병동을 찾을 수 없습니다 (이 병원 소속이 아님)')
    if (!fixedWard.isActive) throw new RegistryError(409, `폐쇄된 병동입니다: ${fixedWard.name}`)
  }
  // 별칭 맵 — 입력명 정규화 → 병동
  const aliasMap = new Map<string, WardRef>()
  for (const [input, id] of Object.entries(defaults.wardAliases ?? {})) {
    const w = wardsById.get(Number(id))
    if (!w) throw new RegistryError(400, `병동 별칭 '${input}'의 대상 병동을 찾을 수 없습니다`)
    aliasMap.set(normalizeWardName(input), w)
  }

  // ── 1차: 정규화·중복·모델·org
  type Work = {
    input: ImportRowInput
    out: PreviewRow
    kind: Kind
    /** 빈 시리얼·파일 내 중복 — 항상 반영 */
    errors: string[]
    /** 모델 판별 실패 — 원장에 이미 있는 개체면 무시(기존 모델 사용) */
    modelError: string | null
    modelWarns: string[]
    /** 병동 해석 — skip(변경 없음) 행에서는 무시 */
    wardErrors: string[]
    wardWarns: string[]
    /** WMS·분실 등 — skip 행에서는 무시 */
    warns: string[]
    modelId: number | null
    modelName: string | null
  }
  const works: Work[] = []
  const firstRowBySerial = new Map<string, number>()
  const orgCounts = new Map<string, number>()
  const selectedOrgs = draft && defaults.orgs ? new Set(defaults.orgs.map((o) => String(o).trim().toUpperCase())) : null

  for (const r of rows) {
    const ns = normalizeSerial(r.serialInput)
    const org = r.org != null && String(r.org).trim() ? String(r.org).trim() : null
    if (draft && org) orgCounts.set(org, (orgCounts.get(org) ?? 0) + 1)
    const out: PreviewRow = {
      row: Number(r.row),
      serialInput: String(r.serialInput ?? ''),
      serialNo: ns.serialNo,
      serialRaw: ns.serialRaw,
      deviceInfoId: null,
      deviceModel: null,
      wardInput: null,
      wardId: null,
      wardName: null,
      wardNew: false,
      wardInactive: false,
      org,
      status: 'ok',
      defaultExcluded: false,
      excluded: false,
      messages: [],
      actions: [],
      action: null,
      existing: null,
      wms: null,
      memo: r.memo?.trim() || null,
      macAddress: r.macAddress?.trim() || null,
      extDeviceCode: r.extDeviceCode?.trim() || null,
      executable: false,
      extWardCodeToSet: null,
    }
    const w: Work = { input: r, out, kind: 'ok', errors: [], modelError: null, modelWarns: [], wardErrors: [], wardWarns: [], warns: [], modelId: null, modelName: null }
    works.push(w)

    if (!ns.serialNo) {
      w.errors.push('시리얼이 비어 있습니다')
      continue
    }
    if (ns.kind === 'GW_COMPOSITE') w.out.messages.push('합성 시리얼 분해 · 원문 보존')
    if (selectedOrgs && org && !selectedOrgs.has(org.toUpperCase())) {
      w.kind = 'skip'
      w.out.messages.push(`선택 해제된 기관(${org})의 행`)
    }
    const first = firstRowBySerial.get(ns.serialNo)
    if (first != null) {
      w.errors.push(`파일 내 중복(${first}행)`)
      w.out.defaultExcluded = true
    } else {
      firstRowBySerial.set(ns.serialNo, out.row)
    }
    const res = resolveModel(models, {
      serialNo: ns.serialNo,
      deviceInfoId: defaults.deviceInfoId ?? null,
      modelInput: defaults.deviceInfoId == null ? r.modelInput ?? null : null,
      onpremDeviceType: defaults.deviceInfoId == null && !r.modelInput ? r.deviceType ?? null : null,
    })
    if (!res.model) w.modelError = res.error!
    else {
      w.modelId = res.model.id
      w.modelName = res.model.deviceModel
      out.deviceInfoId = res.model.id
      out.deviceModel = res.model.deviceModel
      w.modelWarns.push(...res.warnings)
    }
  }

  // ── 2차: 병동 해석 (시뮬레이션)
  for (const w of works) {
    const out = w.out
    if (!out.serialNo) continue
    const action = rowActions[out.row] ?? null
    if (defaults.wardMode === 'fixed') {
      if (fixedWard) {
        out.wardId = fixedWard.id
        out.wardName = fixedWard.name
      } else {
        if (emptyWardCell === 'error') w.wardErrors.push('병동이 지정되지 않았습니다')
        else w.wardWarns.push('병동 미지정으로 등록')
      }
      if (action === 'UNASSIGN_WARD') throw new RegistryError(400, `행 ${out.row}: UNASSIGN_WARD 액션은 병동 오류 행에만 지정할 수 있습니다`)
      continue
    }
    const raw = draft && w.input.wardCode != null && String(w.input.wardCode).trim() ? String(w.input.wardCode).trim() : null
    const input = raw ?? (w.input.wardInput != null ? String(w.input.wardInput) : '')
    out.wardInput = input.trim() || null
    if (!out.wardInput) {
      if (action === 'UNASSIGN_WARD') throw new RegistryError(400, `행 ${out.row}: UNASSIGN_WARD 액션은 병동 오류 행에만 지정할 수 있습니다`)
      if (emptyWardCell === 'error') w.wardErrors.push('병동이 비어 있습니다')
      else w.wardWarns.push('병동 미지정으로 등록')
      continue
    }
    const norm = normalizeWardName(out.wardInput)
    let ward: WardRef | null = aliasMap.get(norm) ?? null
    const viaAlias = !!ward
    let viaCode = false
    if (!ward && draft && raw) {
      ward = wardsByCode.get(out.wardInput.toUpperCase()) ?? null
      viaCode = !!ward
    }
    if (!ward) ward = wardsByNorm.get(norm) ?? null
    let wardError = false
    if (ward && !ward.isActive) {
      out.wardInactive = true
      out.wardName = ward.name
      wardError = true
      w.wardErrors.push(`폐쇄된 병동(${ward.name}) — 재활성 후 재검증`)
      out.actions.push('UNASSIGN_WARD')
    } else if (ward) {
      out.wardId = ward.id
      out.wardName = ward.name
      if (viaAlias) {
        out.messages.push(`병동 '${out.wardInput}' → ${ward.name} 매핑`)
        if (draft && raw) {
          if (!ward.extWardCode) out.extWardCodeToSet = raw.trim()
          else if (ward.extWardCode.toUpperCase() !== raw.trim().toUpperCase()) w.wardWarns.push(`병동 ${ward.name}에 다른 온프렘 코드(${ward.extWardCode})가 있어 코드를 기록하지 않습니다`)
        }
      }
      if (viaCode) out.messages.push(`온프렘 병동 코드 ${out.wardInput} → ${ward.name}`)
    } else {
      out.wardNew = true
      out.wardName = out.wardInput
      if (draft && raw) {
        w.wardWarns.push('병동 자동 생성(코드명) — 병동명 확인 필요')
        out.extWardCodeToSet = raw.trim()
      } else {
        w.wardWarns.push('병동 자동 생성')
      }
    }
    if (action === 'UNASSIGN_WARD') {
      if (!wardError) throw new RegistryError(400, `행 ${out.row}: UNASSIGN_WARD 액션은 병동 오류 행에만 지정할 수 있습니다`)
      // 폐쇄 병동 error → 병동 NULL로 warn 재계산 (§7.2)
      w.wardErrors = w.wardErrors.filter((m) => !m.startsWith('폐쇄된 병동'))
      out.wardId = null
      out.wardNew = false
      out.wardInactive = false
      out.action = 'UNASSIGN_WARD'
      w.wardWarns.push('병동 미지정으로 등록(폐쇄 병동 해제)')
    }
  }

  // ── 3차: 원장 상태 (현재 프로젝션 기준) + 소급 정합
  const serials = Array.from(new Set(works.map((w) => w.out.serialNo).filter(Boolean)))
  const unitsBySerial = await findUnitsBySerial(client, serials)
  const existing = Array.from(unitsBySerial.values()).map((x) => x.device).filter((d): d is DeviceRow => !!d)
  const existingBySerial = new Map(existing.map((d) => [d.serialNo, d]))
  const hNames = await hospitalNames(client, existing.flatMap((d) => [d.hospitalCode, d.lastHospitalCode]))
  const wNames = await wardNames(client, existing.map((d) => d.wardId))
  const transferCandidates = works.filter((w) => {
    const d = existingBySerial.get(w.out.serialNo)
    return d && d.status === 'ACTIVE' && d.hospitalCode !== hospitalCode && rowActions[w.out.row] === 'TRANSFER'
  })
  const lastStateOn = new Map<number, string>()
  if (transferCandidates.length > 0) {
    const grouped = await client.hospitalDeviceEvent.groupBy({
      by: ['deviceId'],
      where: { deviceId: { in: transferCandidates.map((w) => existingBySerial.get(w.out.serialNo)!.id) }, eventType: { not: 'CORRECT' } },
      _max: { occurredOn: true },
    })
    for (const g of grouped) lastStateOn.set(g.deviceId, ymd(g._max.occurredOn) ?? '')
  }

  for (const w of works) {
    const out = w.out
    if (!out.serialNo) continue
    const action = rowActions[out.row] ?? null
    const d = existingBySerial.get(out.serialNo)
    const unit = unitsBySerial.get(out.serialNo)?.unit
    if (unit) {
      // 원장에 있는 유닛(배치 유무 무관)은 모델이 확정되어 있다 — 행의 모델 판별 오류·형식 경고는 무시
      w.modelError = null
      w.modelWarns = []
      w.modelId = unit.deviceInfoId
      w.modelName = models.find((m) => m.id === unit.deviceInfoId)?.deviceModel ?? null
      out.deviceInfoId = unit.deviceInfoId
      out.deviceModel = w.modelName
    }
    if (!d) {
      if (action === 'TRANSFER') throw new RegistryError(400, `행 ${out.row}: TRANSFER 액션은 타 병원 배치 중(conflict) 행에만 지정할 수 있습니다`)
      continue
    }
    out.existing = toExisting(d, hNames, wNames, reasonById)
    if (d.status === 'ACTIVE' && d.hospitalCode === hospitalCode) {
      if (action === 'TRANSFER') throw new RegistryError(400, `행 ${out.row}: TRANSFER 액션은 타 병원 배치 중(conflict) 행에만 지정할 수 있습니다`)
      w.kind = 'skip'
      out.messages.push('이 병원에 이미 배치 중(변경 없음)')
    } else if (d.status === 'ACTIVE') {
      w.kind = 'conflict'
      out.actions.push('TRANSFER')
      const where = `${out.existing.hospitalName ?? d.hospitalCode} ${out.existing.wardName ?? '미지정'} 배치 중(${out.existing.placedOn ?? '?'})`
      if (action === 'TRANSFER') {
        out.action = 'TRANSFER'
        const placed = out.existing.placedOn
        if (placed && occurredOn < placed) {
          w.errors.push(`이관 업무일자(${occurredOn})가 ${out.existing.hospitalName ?? d.hospitalCode} 배치일(${placed})보다 이릅니다 — 업무일자를 조정하거나 행을 제외하세요`)
        } else if ((lastStateOn.get(d.id) ?? '') > occurredOn) {
          w.errors.push(`이관 업무일자 이후 ${out.existing.hospitalName ?? d.hospitalCode}에 이벤트(${lastStateOn.get(d.id)})가 있습니다 — 그 병원에서 먼저 정리하세요`)
        } else {
          out.messages.push(`${where} → 이관 처리(회수 TRANSFER + 등록)`)
        }
      } else {
        out.defaultExcluded = true
        out.messages.push(`${where} — 제외 또는 이관을 지정하세요`)
      }
    } else {
      if (action === 'TRANSFER') throw new RegistryError(400, `행 ${out.row}: TRANSFER 액션은 타 병원 배치 중(conflict) 행에만 지정할 수 있습니다`)
      w.kind = 'reregister'
      const rec = out.existing.recoveredOn ?? '?'
      const reason = out.existing.recoverReason ?? '사유 없음'
      if (d.lastHospitalCode === hospitalCode) {
        if (draft) {
          out.defaultExcluded = true
          out.messages.push(`회수 후보 — ${rec} ${reason} 회수됨(이 병원), 온프렘 삭제 요청 대상 (초안 모드 기본 제외)`)
        } else {
          out.messages.push(`이 병원에서 ${rec} ${reason} 회수 → 재등록`)
        }
      } else {
        out.messages.push(`${out.existing.lastHospitalName ?? d.lastHospitalCode ?? '?'}에서 ${rec} ${reason} 회수 → 재등록으로 이력 연결`)
        if (out.existing.recoverReasonValue === 'LOST') w.warns.push('분실 처리된 기기입니다 — 실물 확인 필요')
      }
      if (out.existing.recoveredOn && occurredOn < out.existing.recoveredOn) {
        w.errors.push(`업무일자(${occurredOn})가 이 기기의 회수일(${out.existing.recoveredOn})보다 이릅니다 — 업무일자를 조정하거나 행을 제외하세요`)
      }
    }
  }

  // ── 4차: WMS 배치 매칭(일시 계산) → IN_STOCK warn
  const wmsInputs = works
    .filter((w) => w.out.serialNo && w.modelId != null && w.kind !== 'skip')
    .map((w, i) => ({
      id: existingBySerial.get(w.out.serialNo)?.id ?? -(i + 1),
      serialNo: w.out.serialNo,
      serialRaw: w.out.serialRaw,
      deviceInfoId: w.modelId,
      deviceModel: w.modelName,
      work: w,
    }))
  if (wmsInputs.length > 0) {
    const m = await matchInventoryUnits(client, wmsInputs)
    for (const x of wmsInputs) {
      const match = m.get(x.id) ?? null
      x.work.out.wms = match
      if (match?.status === 'IN_STOCK') x.work.warns.push(`창고 개체가 재고 상태(IN_STOCK · ${match.inventoryName})입니다`)
    }
  }

  // ── 판정 확정 + 요약
  const summary: PreviewSummary = {
    total: works.length,
    ok: 0,
    reregister: 0,
    skip: 0,
    warn: 0,
    conflict: 0,
    error: 0,
    excluded: 0,
    executable: 0,
    transfer: 0,
    newWards: [],
    wardAliases: { ...(defaults.wardAliases ?? {}) },
    orgs: Array.from(orgCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([org, n]) => ({ org, rows: n, selected: !selectedOrgs || selectedOrgs.has(org.toUpperCase()) })),
    occurredOn,
    mode: defaults.mode,
  }
  const newWardAgg = new Map<string, { name: string; rows: number; fromCode: boolean }>()
  for (const w of works) {
    const out = w.out
    const skip = w.kind === 'skip'
    if (skip) {
      // 변경 없음 — 병동 해석 결과는 표시하지 않고 생성도 하지 않는다 (§7.2 skip)
      out.wardNew = false
      out.wardInactive = false
      out.actions = out.actions.filter((a) => a !== 'UNASSIGN_WARD')
    }
    const errors = [...w.errors, ...(w.modelError ? [w.modelError] : []), ...(skip ? [] : w.wardErrors)]
    const warns = [...w.modelWarns, ...(skip ? [] : [...w.wardWarns, ...w.warns])]
    let status: ImportVerdict
    if (errors.length > 0) status = 'error'
    else if (w.kind === 'conflict') status = 'conflict'
    else if (skip) status = 'skip'
    else if (w.kind === 'reregister') status = 'reregister'
    else if (warns.length > 0) status = 'warn'
    else status = 'ok'
    out.status = status
    out.messages = [...errors, ...out.messages, ...warns]
    out.excluded = explicitExclude ? explicitExclude.has(out.row) : out.defaultExcluded
    out.executable = !out.excluded && (status === 'ok' || status === 'warn' || status === 'reregister' || (status === 'conflict' && out.action === 'TRANSFER'))
    summary[status] += 1
    if (out.excluded) summary.excluded += 1
    if (out.executable) {
      summary.executable += 1
      if (out.action === 'TRANSFER') summary.transfer += 1
      if (out.wardNew && out.wardName) {
        const key = normalizeWardName(out.wardName)
        const agg = newWardAgg.get(key)
        if (agg) agg.rows += 1
        else newWardAgg.set(key, { name: out.wardName, rows: 1, fromCode: !!out.extWardCodeToSet })
      }
    }
  }
  summary.newWards = Array.from(newWardAgg.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([nameNorm, v]) => ({ nameNorm, ...v }))
  return { rows: works.map((w) => w.out), summary }
}

function toExisting(
  d: DeviceRow,
  hNames: Map<string, string>,
  wNames: Map<number, string>,
  reasonById: Map<number, { id: number; name: string; value: string | null }>
): PreviewExisting {
  const reason = d.recoverReasonId != null ? reasonById.get(d.recoverReasonId) : null
  return {
    deviceId: d.id,
    status: d.status,
    hospitalCode: d.hospitalCode,
    hospitalName: d.hospitalCode ? hNames.get(d.hospitalCode) ?? null : null,
    wardName: d.wardId != null ? wNames.get(d.wardId) ?? null : null,
    placedOn: ymd(d.placedOn),
    lastHospitalCode: d.lastHospitalCode,
    lastHospitalName: d.lastHospitalCode ? hNames.get(d.lastHospitalCode) ?? null : null,
    recoveredOn: ymd(d.recoveredOn),
    recoverReason: reason?.name ?? (reason?.value ? RECOVERY_REASON_FALLBACK_LABELS[reason.value as keyof typeof RECOVERY_REASON_FALLBACK_LABELS] : null) ?? null,
    recoverReasonValue: reason?.value ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// importBatch — 서버 재검증 후 단일 트랜잭션 실행 (§7.2 실행 규칙 · §5.4)
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportInput {
  rows: ImportRowInput[]
  excludeRows?: number[] | null
  rowActions?: Record<number, ImportRowAction> | null
  wardAliases?: Record<string, number> | null
  orgs?: string[] | null
  sourceKind: ImportSourceKind
  mode: ImportBatchMode
  fileName?: string | null
  defaults: Omit<PreviewDefaults, 'occurredOn' | 'mode' | 'rowActions' | 'excludeRows' | 'wardAliases' | 'orgs'>
}

export interface ImportResult {
  batch: Prisma.HospitalDeviceImportBatchGetPayload<Record<string, never>>
  result: RegisterResult
  preview: PreviewResult
  warnings: string[]
}

export async function importBatch(ctx: RegistryCtx, input: ImportInput, opts?: RegistryOpts): Promise<ImportResult> {
  return withRegistryTx(opts, async (tx) => {
    if (!IMPORT_SOURCE_KINDS.includes(input.sourceKind)) throw new RegistryError(400, '입력 출처(sourceKind)가 올바르지 않습니다')
    if (!IMPORT_BATCH_MODES.includes(input.mode)) throw new RegistryError(400, '임포트 모드가 올바르지 않습니다')
    const p = await prepareCtx(tx, { ...ctx, source: 'IMPORT' }, { requireHospital: true })
    const here = p.hospitalCode!
    const rows = input.rows ?? []
    if (rows.length === 0) throw new RegistryError(400, '임포트할 행이 없습니다')

    // 1) 서버 재검증 (클라이언트 판정 불신)
    const preview = await previewRows(
      here,
      rows,
      {
        ...input.defaults,
        mode: input.mode,
        occurredOn: p.occurredOn,
        rowActions: input.rowActions ?? null,
        excludeRows: input.excludeRows ?? [],
        wardAliases: input.wardAliases ?? null,
        orgs: input.orgs ?? null,
      },
      tx
    )
    if (input.mode === 'ONPREM_DRAFT' && preview.summary.orgs.length >= 2 && !input.orgs) {
      throw new RegistryError(400, `기관 코드가 ${preview.summary.orgs.length}개 있습니다 — 등록할 기관(orgs)을 선택하세요`)
    }
    for (const k of Object.keys(input.rowActions ?? {})) {
      if (!preview.rows.some((r) => r.row === Number(k))) throw new RegistryError(400, `행 ${k}은(는) 입력에 없습니다 (rowActions)`)
    }

    // 2) 실행 규칙
    const errorsLeft = preview.rows.filter((r) => r.status === 'error' && !r.excluded)
    if (errorsLeft.length > 0) throw new RegistryError(400, `오류 행 ${errorsLeft.length}건 — 제외 후 실행하세요`, { rows: errorsLeft.map((r) => ({ row: r.row, serial: r.serialNo, message: r.messages[0] ?? '오류' })) })
    const conflictsLeft = preview.rows.filter((r) => r.status === 'conflict' && !r.excluded && r.action !== 'TRANSFER')
    if (conflictsLeft.length > 0) {
      const conflicts: Conflict[] = conflictsLeft.map((r) => ({
        serial: r.serialNo,
        deviceId: r.existing!.deviceId,
        hospitalCode: r.existing!.hospitalCode!,
        hospitalName: r.existing!.hospitalName,
        wardName: r.existing!.wardName,
        placedOn: r.existing!.placedOn,
      }))
      throw new RegistryError(409, '타 병원에서 운용 중인 시리얼이 있습니다 — 행별로 제외하거나 이관을 지정하세요', { conflicts })
    }
    const executing = preview.rows.filter((r) => r.executable)
    if (executing.length === 0) throw new RegistryError(400, '실행할 행이 없습니다 (전부 제외·건너뜀)')

    // 3) 배치 행 먼저(이벤트 import_batch_id FK), 카운트는 끝에
    const batch0 = await tx.hospitalDeviceImportBatch.create({
      data: {
        hospitalCode: here,
        sourceKind: input.sourceKind,
        mode: input.mode,
        fileName: input.fileName?.trim() || null,
        occurredOn: ymdToDate(p.occurredOn),
        note: p.memo,
        rowCount: rows.length,
        createdById: p.actor.userId,
      },
    })

    // 4) 등록 실행 (이관 쌍의 RECOVER에도 import_batch_id)
    const items: RegisterItem[] = executing.map((r) => ({
      serialInput: r.serialInput,
      deviceInfoId: r.deviceInfoId,
      wardId: r.wardId ?? undefined,
      wardName: r.wardId == null && r.wardNew ? r.wardName : undefined,
      memo: r.memo,
      macAddress: r.macAddress,
      extDeviceCode: r.extDeviceCode,
    }))
    const conflicts = Object.fromEntries(executing.filter((r) => r.action === 'TRANSFER').map((r) => [r.serialNo, 'TRANSFER' as const]))
    let result: RegisterResult
    try {
      result = await registerDevicesIn(
        tx,
        { hospitalCode: here, actor: p.actor, occurredOn: p.occurredOn, ref: p.ref, source: 'IMPORT', memo: p.memo, actionGroup: p.actionGroup },
        items,
        { client: tx, importBatchId: batch0.id, conflicts, autoCreateWard: true }
      )
    } catch (e) {
      // 미리보기 이후 데이터 변동으로 소급 불성립 → 행 번호로 되돌려 409 { error, rows[] } (§7.1)
      if (e instanceof RegistryError && e.serial && !e.rows) {
        const hit = executing.find((r) => r.serialNo === e.serial)
        throw new RegistryError(e.status, e.message, { rows: [{ row: hit?.row ?? 0, serial: e.serial, message: e.message }], conflicts: e.conflicts })
      }
      throw e
    }

    // 5) 초안 모드 — 온프렘 병동 코드 기록(B-3): 코드명으로 생성된 병동·매핑 병동(코드 비어 있을 때만)
    const codeWrites = new Map<number, string>()
    for (const r of executing) {
      if (!r.extWardCodeToSet) continue
      const wardId = r.wardId ?? result.newWards.find((w) => normalizeWardName(w.name) === normalizeWardName(r.wardName ?? ''))?.id ?? null
      if (wardId != null && !codeWrites.has(wardId)) codeWrites.set(wardId, r.extWardCodeToSet)
    }
    const warnings = [...result.warnings]
    for (const [wardId, code] of Array.from(codeWrites)) {
      const dup = await tx.hospitalWard.findFirst({ where: { hospitalCode: here, extWardCode: code, NOT: { id: wardId } }, select: { id: true, name: true } })
      if (dup) {
        warnings.push(`온프렘 병동 코드 ${code}는 이미 ${dup.name}에 기록되어 있어 건너뜁니다`)
        continue
      }
      await tx.hospitalWard.updateMany({ where: { id: wardId, hospitalCode: here, extWardCode: null }, data: { extWardCode: code } })
    }

    // 6) 카운트·요약 확정 (§5.4 summary)
    const summaryJson = {
      preview: preview.summary,
      newWards: result.newWards,
      wardAliases: input.wardAliases ?? {},
      orgs: input.orgs ?? null,
      excludeRows: input.excludeRows ?? [],
      rowActions: input.rowActions ?? {},
      warnings,
      cancelledRows: [] as unknown[],
    }
    const batch = await tx.hospitalDeviceImportBatch.update({
      where: { id: batch0.id },
      data: {
        registeredCount: result.created.length,
        reregisteredCount: result.reregistered.length,
        skippedCount: preview.summary.skip,
        transferredCount: result.transferred.length,
        summary: summaryJson as unknown as Prisma.InputJsonValue,
      },
    })
    return { batch, result, preview, warnings }
  })
}
