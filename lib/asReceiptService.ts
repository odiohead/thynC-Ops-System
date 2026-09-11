/**
 * AS접수 ↔ 기기현황 연동 서비스 (as_work_design.md §5 — 1차 범위: 기기현황만, WMS 제외)
 *
 * - 접수 등록: 라인별 원장 매칭(같은 병원 ACTIVE) → openDeviceAs(ref 'AS') — 미등록·이미 AS중은 경고 수집 후 스킵
 * - 라인 결과 확정: 수리반환 clearDeviceAs / 교체 replaceDevice(fold 자동 해제) / 분실 recoverDevice(LOST) / 취소 clearDeviceAs
 * - 미등록 라인(deviceId NULL)은 이벤트 전부 스킵(경고) — 추후 백필(§12)
 * 이벤트는 전부 lib/deviceRegistry 서비스 함수 경유(§7.0 유일한 쓰기자), ctx.ref = { type:'AS', code }.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeSerial, todayKst } from '@/lib/deviceRegistryShared'
import { openDeviceAs, clearDeviceAs, replaceDevice, recoverDevice, registerDevicesIn, RegistryError, type RegistryCtx } from '@/lib/deviceRegistry'
import { syncAsReceiptToTicket, createTicketForAsReceipt } from '@/lib/ticket-domains/asReceipt'
import { AS_OUTCOMES, AS_CATEGORIES, AS_METHODS, AS_DEST_TYPES, asDeviceKindFromSerial, type AsOutcome } from '@/lib/asReceiptShared'
import { nextAsCode } from '@/lib/asReceipt'

type DbClient = Prisma.TransactionClient | typeof prisma

export class AsServiceError extends Error {
  status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.name = 'AsServiceError'
    this.status = status
  }
}

const ymd = (d: Date | string | null | undefined): string | null =>
  d ? (typeof d === 'string' ? d : d.toISOString()).slice(0, 10) : null

// ── 시리얼 매칭 (등록 미리보기 + 생성 공용) ─────────────────────────────

export type MatchState = 'ACTIVE_HERE' | 'ACTIVE_OTHER' | 'RECOVERED' | 'NONE'

export interface SerialMatch {
  serialNo: string
  state: MatchState
  deviceId: number | null
  modelName: string | null
  wardName: string | null
  /** ACTIVE_OTHER일 때 배치 병원명 */
  hospitalName: string | null
  asOpen: boolean
  asRefCode: string | null
}

/** 정규화 시리얼 → 원장 매칭. NONE = 미등록(경고 후 허용 — 결정 7) */
export async function matchSerials(client: DbClient, hospitalCode: string, serials: readonly string[]): Promise<SerialMatch[]> {
  const keys = serials.map((s) => normalizeSerial(s).serialNo).filter(Boolean)
  const units = keys.length
    ? await client.deviceUnit.findMany({
        where: { serialNo: { in: Array.from(new Set(keys)) } },
        select: {
          id: true,
          serialNo: true,
          deviceInfo: { select: { deviceName: true } },
          placement: {
            select: {
              status: true, hospitalCode: true, asStartedOn: true, asRefCode: true,
              ward: { select: { name: true } },
              hospital: { select: { hospitalName: true } },
            },
          },
        },
      })
    : []
  const bySerial = new Map(units.map((u) => [u.serialNo, u]))
  return keys.map((key) => {
    const u = bySerial.get(key)
    if (!u || !u.placement) {
      return { serialNo: key, state: 'NONE' as const, deviceId: null, modelName: u?.deviceInfo.deviceName ?? null, wardName: null, hospitalName: null, asOpen: false, asRefCode: null }
    }
    const p = u.placement
    const base = {
      serialNo: key,
      deviceId: u.id,
      modelName: u.deviceInfo.deviceName,
      wardName: p.ward?.name ?? null,
      asOpen: !!p.asStartedOn,
      asRefCode: p.asRefCode,
    }
    if (p.status === 'ACTIVE' && p.hospitalCode === hospitalCode) return { ...base, state: 'ACTIVE_HERE' as const, hospitalName: null }
    if (p.status === 'ACTIVE') return { ...base, state: 'ACTIVE_OTHER' as const, hospitalName: p.hospital?.hospitalName ?? p.hospitalCode }
    return { ...base, state: 'RECOVERED' as const, hospitalName: null }
  })
}

/** 매칭 상태 → 등록 시 경고 문구 (없으면 null) */
export function matchWarning(m: SerialMatch): string | null {
  switch (m.state) {
    case 'NONE': return `${m.serialNo}: 기기 현황에 등록되지 않은 기기입니다 — 미등록 라인으로 접수(연동 스킵)`
    case 'ACTIVE_OTHER': return `${m.serialNo}: 타 병원(${m.hospitalName ?? '-'}) 배치 중 — AS 표시 스킵, 배치 확인 필요`
    case 'RECOVERED': return `${m.serialNo}: 회수 상태 기기 — AS 표시 스킵`
    default: return m.asOpen ? `${m.serialNo}: 이미 AS진행중(${m.asRefCode ?? '참조 없음'}) — 표시 유지` : null
  }
}

// ── AS 플래그 켜기 (생성·라인 추가 공용) ─────────────────────────────────

interface FlagTarget { serialNo: string; deviceId: number }

/** ACTIVE_HERE·미표시 라인에 openDeviceAs — 실패(409 등)는 경고로 수집, 호출부 트랜잭션은 계속 */
export async function openAsFlags(
  tx: Prisma.TransactionClient,
  receipt: { asCode: string; hospitalCode: string },
  targets: readonly FlagTarget[],
  actor: { userId: string | null; name: string | null },
  occurredOn: string
): Promise<string[]> {
  const warnings: string[] = []
  const ctx: RegistryCtx = {
    hospitalCode: receipt.hospitalCode,
    actor,
    occurredOn,
    source: 'MANUAL',
    ref: { type: 'AS', code: receipt.asCode },
  }
  for (const t of targets) {
    try {
      await openDeviceAs(ctx, { deviceId: t.deviceId }, { client: tx })
    } catch (e) {
      if (e instanceof RegistryError) warnings.push(`${t.serialNo}: AS 표시 실패 — ${e.message}`)
      else throw e
    }
  }
  return warnings
}

// ── 라인 편집 반영 (PUT — 추가/제거/텍스트 갱신) ─────────────────────────

export interface LineInput {
  serial: string
  symptom?: string | null
  wardName?: string | null
  deviceKind?: string | null
  processNote?: string | null
}

/**
 * 라인 전체 교체 반영 — 종결 라인은 제거 불가(400), 제거 라인은 이 접수가 켠 플래그만 해제(오늘 일자),
 * 추가 라인은 매칭 + AS 표시(접수일 기준). 반환: 경고 목록.
 */
export async function applyItemChanges(
  tx: Prisma.TransactionClient,
  receipt: { id: number; asCode: string; hospitalCode: string; receiptDate: Date },
  lines: readonly LineInput[],
  actor: { userId: string | null; name: string | null },
  /** 병원 변경 수정(2026-09-10) — 직전 병원 코드. 지정되고 현재와 다르면 미종결 라인 전부를 제거→재추가로 새 병원 기준 재매칭 */
  opts?: { previousHospitalCode?: string }
): Promise<string[]> {
  if (!lines.length) throw new AsServiceError(400, '기기 라인을 1개 이상 입력하세요.')
  const warnings: string[] = []
  const hospitalChanged = !!opts?.previousHospitalCode && opts.previousHospitalCode !== receipt.hospitalCode
  const allExisting = await tx.asReceiptItem.findMany({ where: { receiptId: receipt.id } })
  // 병원 변경 시 미종결 기존 라인은 '없던 것'으로 취급(아래 제거 루프에서 플래그 해제·삭제 → 추가 루프에서 재매칭 생성)
  const existing = allExisting
  const byKey = new Map(allExisting.filter((i) => !(hospitalChanged && !i.outcome)).map((i) => [i.serialNo, i]))

  const nextKeys: string[] = []
  const seen = new Set<string>()
  const inputByKey = new Map<string, LineInput>()
  for (const line of lines) {
    const key = normalizeSerial(line.serial).serialNo
    if (!key) throw new AsServiceError(400, '시리얼이 비어 있습니다.')
    if (seen.has(key)) throw new AsServiceError(400, `같은 시리얼이 중복 입력되었습니다: ${key}`)
    seen.add(key)
    nextKeys.push(key)
    inputByKey.set(key, line)
  }

  // 종결 라인 제거 금지
  for (const item of existing) {
    if (item.outcome && !seen.has(item.serialNo)) {
      throw new AsServiceError(400, `종결된 라인은 제거할 수 없습니다: ${item.serialNo}`)
    }
  }

  const today = todayKst()
  const clearCtx: RegistryCtx = {
    hospitalCode: opts?.previousHospitalCode ?? receipt.hospitalCode, // 해제 이벤트는 플래그를 켠 당시 병원 기준
    actor,
    occurredOn: today,
    source: 'MANUAL',
    ref: { type: 'AS', code: receipt.asCode },
  }

  // 제거 (미종결) — 이 접수가 켠 플래그만 해제. 병원 변경 시 미종결 라인 전부 대상(재추가 전제)
  for (const item of existing) {
    if (seen.has(item.serialNo) && !(hospitalChanged && !item.outcome)) continue
    if (item.deviceId) {
      const placement = await tx.hospitalDevice.findUnique({
        where: { deviceId: item.deviceId },
        select: { asStartedOn: true, asRefCode: true },
      })
      if (placement?.asStartedOn && placement.asRefCode === receipt.asCode) {
        try {
          await clearDeviceAs(clearCtx, { deviceId: item.deviceId }, { client: tx })
        } catch (e) {
          if (e instanceof RegistryError) warnings.push(`${item.serialNo}: AS 해제 실패 — ${e.message}`)
          else throw e
        }
      } else if (placement?.asStartedOn) {
        warnings.push(`${item.serialNo}: 다른 참조(${placement.asRefCode ?? '없음'})의 AS 표시가 있어 해제하지 않았습니다`)
      }
    }
    await tx.asReceiptItem.delete({ where: { id: item.id } })
  }

  // 추가 + 텍스트 갱신
  const addedKeys = nextKeys.filter((k) => !byKey.has(k))
  const matches = addedKeys.length ? await matchSerials(tx, receipt.hospitalCode, addedKeys) : []
  const flagTargets: FlagTarget[] = []
  for (const m of matches) {
    const line = inputByKey.get(m.serialNo)!
    const w = matchWarning(m)
    if (w) warnings.push(w)
    await tx.asReceiptItem.create({
      data: {
        receiptId: receipt.id,
        serialNo: m.serialNo,
        deviceId: m.deviceId,
        deviceKind: m.deviceId ? null : line.deviceKind?.trim() || null,
        wardName: line.wardName?.trim() || m.wardName,
        symptom: line.symptom?.trim() || null,
        processNote: line.processNote?.trim() || null,
      },
    })
    if (m.state === 'ACTIVE_HERE' && !m.asOpen) flagTargets.push({ serialNo: m.serialNo, deviceId: m.deviceId! })
  }
  warnings.push(...(await openAsFlags(tx, receipt, flagTargets, actor, ymd(receipt.receiptDate) ?? today)))

  for (const key of nextKeys) {
    const item = byKey.get(key)
    if (!item) continue
    const line = inputByKey.get(key)!
    await tx.asReceiptItem.update({
      where: { id: item.id },
      data: {
        symptom: line.symptom !== undefined ? line.symptom?.trim() || null : undefined,
        wardName: line.wardName !== undefined ? line.wardName?.trim() || null : undefined,
        deviceKind: line.deviceKind !== undefined ? (item.deviceId ? null : line.deviceKind?.trim() || null) : undefined,
        processNote: line.processNote !== undefined ? line.processNote?.trim() || null : undefined,
      },
    })
  }
  return warnings
}

// ── 라인 결과 확정 (수리반환·교체·분실종결·라인취소 + 부분 발송) ─────────

export interface ResolveLineInput {
  itemId: number
  outcome: AsOutcome
  /** REPLACE 필수 — 교체 발송기기 시리얼 */
  newSerial?: string | null
  /** 라인별 처리내용 (2026-09-11 — 기기군 카드에서 라인마다 입력). 미지정 시 공통 processNote */
  processNote?: string | null
}

export interface ResolveInput {
  lines: ResolveLineInput[]
  /** 이벤트·발송 기준일 (기본 오늘) — 수리반환/교체는 발송일, 분실/취소는 처리일 */
  effectiveDate?: string | null
  shipMethod?: 'PARCEL' | 'VISIT' | null
  shipTrackingNo?: string | null
  /** 처리내용 (시트 Q열 대응, CX #18 — 선택 라인 전체에 기록) */
  processNote?: string | null
}

export interface ResolveResult {
  warnings: string[]
  /** 전 라인 종결 → 헤더 '완료' 자동 전이 여부 (§13-4) */
  autoCompleted: boolean
}

export async function resolveAsLines(
  receiptId: number,
  actor: { userId: string; name: string | null },
  input: ResolveInput
): Promise<ResolveResult> {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new AsServiceError(400, '처리할 라인을 선택하세요.')
  for (const l of input.lines) {
    if (!Number.isInteger(l.itemId)) throw new AsServiceError(400, '라인이 올바르지 않습니다.')
    if (!AS_OUTCOMES.includes(l.outcome)) throw new AsServiceError(400, '처리 결과가 올바르지 않습니다.')
    if (l.outcome === 'NOT_RECEIVED') throw new AsServiceError(400, "'미회수'는 입고 대조의 접수자 확인에서만 확정할 수 있습니다.")
    if (l.outcome === 'REPLACE' && !normalizeSerial(l.newSerial ?? '').serialNo) {
      throw new AsServiceError(400, '교체 처리에는 발송기기 시리얼이 필요합니다.')
    }
  }
  const effectiveDate = input.effectiveDate?.trim() || todayKst()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new AsServiceError(400, '처리일이 올바르지 않습니다 (YYYY-MM-DD).')
  const shipMethod = input.shipMethod ?? null
  if (shipMethod && shipMethod !== 'PARCEL' && shipMethod !== 'VISIT') throw new AsServiceError(400, '발송방법이 올바르지 않습니다.')

  return prisma.$transaction(
    async (tx) => {
      const receipt = await tx.asReceipt.findUnique({
        where: { id: receiptId },
        select: {
          id: true, asCode: true, hospitalCode: true, category: true,
          status: { select: { ticketStatus: true } },
          items: { select: { id: true, serialNo: true, deviceId: true, outcome: true, intakeState: true } },
        },
      })
      if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
      if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') {
        throw new AsServiceError(409, '완료·취소된 접수는 처리할 수 없습니다.')
      }
      const byId = new Map(receipt.items.map((i) => [i.id, i]))
      const warnings: string[] = []

      const ctx: RegistryCtx = {
        hospitalCode: receipt.hospitalCode,
        actor: { userId: actor.userId, name: actor.name },
        occurredOn: effectiveDate,
        source: 'MANUAL',
        ref: { type: 'AS', code: receipt.asCode },
      }
      /** 분실 회수 사유 (DEVICE_RECOVERY_REASON value=LOST) — 필요 시에만 조회 */
      let lostReasonId: number | null | undefined
      const requireLostReason = async () => {
        if (lostReasonId === undefined) {
          const row = await tx.statusCode.findFirst({ where: { category: 'DEVICE_RECOVERY_REASON', value: 'LOST' }, select: { id: true } })
          lostReasonId = row?.id ?? null
        }
        if (lostReasonId == null) throw new AsServiceError(400, "기기 회수 사유 마스터에 '분실(LOST)'이 없습니다.")
        return lostReasonId
      }

      for (const l of input.lines) {
        const item = byId.get(l.itemId)
        if (!item) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
        if (item.outcome) throw new AsServiceError(409, `이미 종결된 라인입니다: ${item.serialNo}`)
        // 입고 대조 게이트 (2026-09-11): 미입고·미식별입고 라인은 접수자 확인 전까지 처리 불가. 대기(PENDING)는 허용 — 방문교체·선교체는 입고 없이 처리됨
        if (item.intakeState === 'MISMATCH' || item.intakeState === 'EXTRA') {
          throw new AsServiceError(409, `${item.serialNo}: 입고 대조 확인이 필요한 라인입니다 — 접수자 확인(치환·정상입고 확정·미회수) 후 처리하세요`)
        }

        const shipped = l.outcome === 'REPAIR_RETURN' || l.outcome === 'REPLACE'
        const data: Prisma.AsReceiptItemUncheckedUpdateInput = {
          outcome: l.outcome,
          shippedAt: shipped ? new Date(effectiveDate) : undefined,
          shipMethod: shipped ? shipMethod : undefined,
          shipTrackingNo: shipped ? input.shipTrackingNo?.trim() || null : undefined,
          processNote: (l.processNote ?? input.processNote)?.trim() ? (l.processNote ?? input.processNote)!.trim() : undefined, // CX #18 — 미입력 시 기존 값 보존 (라인별 우선)
        }

        if (!item.deviceId) {
          // 미등록 라인 — 기기현황 이벤트 스킵 (결정 7), 기록만
          warnings.push(`${item.serialNo}: 미등록 라인 — 기기현황에 기록되지 않았습니다`)
          if (l.outcome === 'REPLACE') data.newSerialNo = normalizeSerial(l.newSerial!).serialNo
        } else if (l.outcome === 'REPAIR_RETURN' || l.outcome === 'CANCELED') {
          try {
            const r = await clearDeviceAs(ctx, { deviceId: item.deviceId }, { client: tx })
            // 처리일이 AS 표시 시작일(접수일)보다 앞서면 원장 fold가 해제를 접지 않아 표시가 남는다 (2026-09-11 E2E에서 확인)
            if (r.device.asStartedOn) warnings.push(`${item.serialNo}: 처리일(${effectiveDate})이 AS 표시 시작일(${ymd(r.device.asStartedOn) ?? '-'})보다 앞서 AS진행중 표시가 남았습니다 — 처리일을 표시 시작일 이후로 다시 처리하거나 기기현황에서 해제하세요`)
          } catch (e) {
            if (e instanceof RegistryError) warnings.push(`${item.serialNo}: AS 해제 실패 — ${e.message}`)
            else throw e
          }
        } else if (l.outcome === 'REPLACE') {
          const newSerial = normalizeSerial(l.newSerial!).serialNo
          try {
            const result = await replaceDevice(
              ctx,
              {
                oldDeviceId: item.deviceId,
                newSerial,
                reasonCodeId: receipt.category === 'LOST' ? await requireLostReason() : null, // 생략 시 DEFECT
              },
              { client: tx }
            )
            warnings.push(...result.warnings.map((w) => `${item.serialNo}: ${w}`))
            data.newSerialNo = newSerial
            data.newDeviceId = result.newDevice.id
          } catch (e) {
            // 교체 실패(신 시리얼 타 병원 ACTIVE 등)는 부분 성공을 남기지 않도록 전체 중단
            if (e instanceof RegistryError) throw new AsServiceError(e.status, `${item.serialNo} 교체 실패 — ${e.message}`)
            throw e
          }
        } else if (l.outcome === 'LOST') {
          try {
            await recoverDevice(ctx, { deviceId: item.deviceId, reasonCodeId: await requireLostReason() }, { client: tx })
          } catch (e) {
            if (e instanceof RegistryError) warnings.push(`${item.serialNo}: 분실 회수 기록 실패 — ${e.message}`)
            else throw e
          }
        }

        await tx.asReceiptItem.update({ where: { id: item.id }, data })
      }

      // 전 라인 종결 → 헤더 '완료' 자동 전이 (§13-4 확정) + 티켓 CLOSED (어댑터 동기화)
      let autoCompleted = false
      const remaining = await tx.asReceiptItem.count({ where: { receiptId: receipt.id, outcome: null } })
      if (remaining === 0) {
        const done = await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '완료' }, select: { id: true } })
        if (done) {
          await tx.asReceipt.update({
            where: { id: receipt.id },
            data: { statusId: done.id, statusChangedAt: new Date(), resolvedAt: new Date(effectiveDate) },
          })
          await syncAsReceiptToTicket(tx, receipt.id, actor.userId)
          autoCompleted = true
        } else {
          warnings.push("AS_STATUS '완료' 상태가 없어 자동 완료를 건너뛰었습니다 — seed-as-masters.sql 확인")
        }
      }
      return { warnings, autoCompleted }
    },
    { timeout: 120000, maxWait: 10000 }
  )
}

// ── 입고 대조 (2026-09-11 — as_work_design.md §14) ─────────────────────────
// 입고처리: AS담당자가 실물 시리얼을 입력 → 접수 라인과 대조. 일치 → RECEIVED, 접수됐으나 없음 → MISMATCH,
// 입고됐으나 접수에 없음 → EXTRA 라인 생성(원장 매칭만, AS 표시는 편입 확정 시). 누적 실행 가능(부분 입고).
// 접수자 확인: MISMATCH → 치환(EXTRA와 매핑)·정상입고 확정·미회수 / EXTRA → 신규 편입·삭제.

/** 비고 끝에 이력 한 줄 추가 (5,000자 초과 시 앞부분 절단) */
function appendNote(note: string | null | undefined, line: string): string {
  const next = note?.trim() ? `${note.trimEnd()}\n${line}` : line
  return next.length > 5000 ? next.slice(next.length - 5000) : next
}

export interface IntakeInput {
  serials: string[]
  receivedAt?: string | null // 입고일 (N열) — 기본 오늘
  checkedAt?: string | null // 확인일 (O열) — 기본 입고일
}
export interface IntakeResult {
  received: string[]
  mismatch: string[]
  extra: string[]
  warnings: string[]
  statusChanged: boolean
}

export async function intakeAsLines(receiptId: number, actor: { userId: string; name: string | null }, input: IntakeInput): Promise<IntakeResult> {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const raw of input.serials ?? []) {
    const k = normalizeSerial(String(raw ?? '')).serialNo
    if (!k || seen.has(k)) continue
    seen.add(k); keys.push(k)
  }
  if (!keys.length) throw new AsServiceError(400, '입고 시리얼을 1개 이상 입력하세요.')
  const receivedAt = input.receivedAt?.trim() || todayKst()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) throw new AsServiceError(400, '입고일이 올바르지 않습니다 (YYYY-MM-DD).')
  const checkedAt = input.checkedAt?.trim() || receivedAt
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) throw new AsServiceError(400, '확인일이 올바르지 않습니다 (YYYY-MM-DD).')

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, hospitalCode: true, receivedAt: true, note: true, statusId: true, status: { select: { ticketStatus: true, order: true } }, items: true },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수는 입고 처리할 수 없습니다.')
    const warnings: string[] = []
    const result: IntakeResult = { received: [], mismatch: [], extra: [], warnings, statusChanged: false }
    const bySerial = new Map(receipt.items.map((i) => [i.serialNo, i]))
    const matched = new Set<string>()

    for (const k of keys) {
      const item = bySerial.get(k)
      if (item) {
        matched.add(k)
        if (item.outcome) { warnings.push(`${k}: 이미 종결된 라인 — 입고 상태를 바꾸지 않았습니다`); continue }
        if (item.intakeState !== 'RECEIVED') {
          await tx.asReceiptItem.update({ where: { id: item.id }, data: { intakeState: 'RECEIVED', receivedAt: new Date(receivedAt) } })
        }
        result.received.push(k)
      } else {
        // 접수 외 입고 — EXTRA 라인 생성 (원장 매칭만, AS 표시·기기종류는 편입 확정 시)
        const [m] = await matchSerials(tx, receipt.hospitalCode, [k])
        const w = matchWarning(m)
        if (w) warnings.push(w)
        await tx.asReceiptItem.create({
          data: {
            receiptId: receipt.id, serialNo: k, deviceId: m.deviceId, wardName: m.wardName,
            deviceKind: m.deviceId ? null : asDeviceKindFromSerial(k), // 미등록이면 시리얼 접두로 기기종류 추정 (A 심전계 / P 산소포화도)
            intakeState: 'EXTRA', intakeSource: 'INTAKE', receivedAt: new Date(receivedAt),
          },
        })
        result.extra.push(k)
      }
    }
    // 접수 라인 중 이번 입력에 없고 아직 대기인 라인 → 미입고 (이미 정상입고·종결은 유지)
    for (const item of receipt.items) {
      if (matched.has(item.serialNo) || item.outcome) continue
      if (item.intakeState === 'PENDING') {
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { intakeState: 'MISMATCH' } })
      }
      if (item.intakeState === 'PENDING' || item.intakeState === 'MISMATCH') result.mismatch.push(item.serialNo)
    }

    // 헤더: 입고일(최초만)·확인일 갱신, 상태가 '입고' 이전 단계면 '입고'로
    const data: Prisma.AsReceiptUncheckedUpdateInput = { checkedAt: new Date(checkedAt) }
    if (!receipt.receivedAt) data.receivedAt = new Date(receivedAt)
    // 비고 이력 (사용자 요청 2026-09-11 — 입고 대조·확인 흔적을 비고에 남긴다)
    data.note = appendNote(receipt.note, `[입고처리 ${receivedAt} ${actor.name ?? ''}] 입력 ${keys.length} → 정상입고 ${result.received.length}${result.mismatch.length ? ` · 미입고 ${result.mismatch.length}(${result.mismatch.join(', ')})` : ''}${result.extra.length ? ` · 미식별입고 ${result.extra.length}(${result.extra.join(', ')})` : ''}`)
    const inbound = await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '입고' }, select: { id: true, order: true } })
    if (inbound && receipt.statusId !== inbound.id && (receipt.status?.order ?? 0) < inbound.order) {
      data.statusId = inbound.id
      data.statusChangedAt = new Date()
      result.statusChanged = true
    }
    await tx.asReceipt.update({ where: { id: receipt.id }, data })
    if (result.statusChanged) await syncAsReceiptToTicket(tx, receipt.id, actor.userId)
    return result
  }, { timeout: 60000, maxWait: 10000 })
}

export type IntakeConfirmAction =
  | { type: 'REMAP'; itemId: number; extraItemId: number } // 미입고 라인의 시리얼을 미식별입고 라인 시리얼로 치환 (오타 보정)
  | { type: 'MARK_RECEIVED'; itemId: number } // 미입고 → 정상입고 (입고 입력 누락 등 수동 확정)
  | { type: 'NOT_RECEIVED'; itemId: number; comment: string } // 미입고 → 미회수 종결 (코멘트 필수)
  | { type: 'ACCEPT_EXTRA'; itemId: number; deviceKind?: string | null } // 미식별입고 → 신규 라인 편입 (정상입고, AS 표시)
  | { type: 'DISCARD_EXTRA'; itemId: number } // 미식별입고 라인 삭제 (입고 입력 오타)

export async function confirmAsIntake(receiptId: number, actor: { userId: string; name: string | null }, action: IntakeConfirmAction): Promise<{ warnings: string[]; autoCompleted: boolean }> {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, hospitalCode: true, receiptDate: true, note: true, status: { select: { ticketStatus: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수입니다.')
    const warnings: string[] = []
    const today = todayKst()
    let history = '' // 비고 이력 한 줄
    const ctx: RegistryCtx = { hospitalCode: receipt.hospitalCode, actor, occurredOn: today, source: 'MANUAL', ref: { type: 'AS', code: receipt.asCode } }
    const getItem = async (id: number) => {
      const it = await tx.asReceiptItem.findFirst({ where: { id, receiptId } })
      if (!it) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
      if (it.outcome) throw new AsServiceError(409, `이미 종결된 라인입니다: ${it.serialNo}`)
      return it
    }
    /** 이 접수가 켠 AS 표시만 해제 */
    const clearOwnFlag = async (deviceId: number | null, serial: string) => {
      if (!deviceId) return
      const p = await tx.hospitalDevice.findUnique({ where: { deviceId }, select: { asStartedOn: true, asRefCode: true } })
      if (p?.asStartedOn && p.asRefCode === receipt.asCode) {
        try { await clearDeviceAs(ctx, { deviceId }, { client: tx }) } catch (e) { if (e instanceof RegistryError) warnings.push(`${serial}: AS 해제 실패 — ${e.message}`); else throw e }
      }
    }

    switch (action.type) {
      case 'REMAP': {
        const item = await getItem(action.itemId)
        const extra = await getItem(action.extraItemId)
        if (item.intakeState !== 'MISMATCH') throw new AsServiceError(400, `미입고 라인이 아닙니다: ${item.serialNo}`)
        if (extra.intakeState !== 'EXTRA') throw new AsServiceError(400, `미식별입고 라인이 아닙니다: ${extra.serialNo}`)
        await clearOwnFlag(item.deviceId, item.serialNo)
        await tx.asReceiptItem.delete({ where: { id: extra.id } })
        await tx.asReceiptItem.update({
          where: { id: item.id },
          data: {
            serialNo: extra.serialNo, receiptSerialNo: item.receiptSerialNo ?? item.serialNo,
            deviceId: extra.deviceId, deviceKind: extra.deviceId ? null : item.deviceKind,
            wardName: item.wardName ?? extra.wardName,
            intakeState: 'RECEIVED', receivedAt: extra.receivedAt,
          },
        })
        if (extra.deviceId) {
          const [m] = await matchSerials(tx, receipt.hospitalCode, [extra.serialNo])
          if (m.state === 'ACTIVE_HERE' && !m.asOpen) warnings.push(...(await openAsFlags(tx, receipt, [{ serialNo: m.serialNo, deviceId: m.deviceId! }], actor, ymd(receipt.receiptDate) ?? today)))
          else { const w = matchWarning(m); if (w) warnings.push(w) }
        } else warnings.push(`${extra.serialNo}: 기기 현황에 등록되지 않은 기기입니다 — 미등록 라인으로 유지`)
        history = `시리얼 치환 ${item.serialNo} → ${extra.serialNo}`
        break
      }
      case 'MARK_RECEIVED': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'MISMATCH') throw new AsServiceError(400, `미입고 라인이 아닙니다: ${item.serialNo}`)
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { intakeState: 'RECEIVED', receivedAt: item.receivedAt ?? new Date(today) } })
        history = `${item.serialNo} 정상입고 수동 확정`
        break
      }
      case 'NOT_RECEIVED': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'MISMATCH') throw new AsServiceError(400, `미입고 라인이 아닙니다: ${item.serialNo}`)
        const comment = action.comment?.trim()
        if (!comment) throw new AsServiceError(400, '미회수 처리에는 코멘트가 필요합니다.')
        await clearOwnFlag(item.deviceId, item.serialNo)
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { outcome: 'NOT_RECEIVED', processNote: comment } })
        history = `${item.serialNo} 미회수 종결 — ${comment}`
        break
      }
      case 'ACCEPT_EXTRA': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'EXTRA') throw new AsServiceError(400, `미식별입고 라인이 아닙니다: ${item.serialNo}`)
        const [m] = await matchSerials(tx, receipt.hospitalCode, [item.serialNo])
        await tx.asReceiptItem.update({
          where: { id: item.id },
          data: { intakeState: 'RECEIVED', deviceId: m.deviceId, deviceKind: m.deviceId ? null : action.deviceKind?.trim() || item.deviceKind, wardName: item.wardName ?? m.wardName },
        })
        if (m.state === 'ACTIVE_HERE' && !m.asOpen) warnings.push(...(await openAsFlags(tx, receipt, [{ serialNo: m.serialNo, deviceId: m.deviceId! }], actor, today)))
        else { const w = matchWarning(m); if (w) warnings.push(w) }
        history = `${item.serialNo} 미식별입고 → 신규 라인 편입`
        break
      }
      case 'DISCARD_EXTRA': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'EXTRA') throw new AsServiceError(400, `미식별입고 라인이 아닙니다: ${item.serialNo}`)
        await tx.asReceiptItem.delete({ where: { id: item.id } })
        history = `${item.serialNo} 미식별입고 라인 삭제`
        break
      }
      default:
        throw new AsServiceError(400, '확인 동작이 올바르지 않습니다.')
    }
    if (history) await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[입고확인 ${today} ${actor.name ?? ''}] ${history}`) } })

    // 미회수 종결로 전 라인이 끝나면 접수 자동 완료 (라인 처리와 동일 규칙)
    let autoCompleted = false
    const remaining = await tx.asReceiptItem.count({ where: { receiptId: receipt.id, outcome: null } })
    if (remaining === 0) {
      const done = await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '완료' }, select: { id: true } })
      if (done) {
        await tx.asReceipt.update({ where: { id: receipt.id }, data: { statusId: done.id, statusChangedAt: new Date(), resolvedAt: new Date(today) } })
        await syncAsReceiptToTicket(tx, receipt.id, actor.userId)
        autoCompleted = true
      }
    }
    return { warnings, autoCompleted }
  }, { timeout: 60000, maxWait: 10000 })
}

// ── 원장 정합 확정 (2026-09-11 — 접수 시리얼이 미등록·미배치·회수·타병원일 때 접수 병원 배치로 보정) ─────────
// registerDevicesIn 한 번으로 신규 등록 / 재등록(회수·미배치) / 타병원 이관(TRANSFER opt-in)을 처리하고
// 라인 deviceId를 연결 + AS 표시. 이력은 비고에 남긴다. 권한: USER 이상(접수자 확인과 동일).

export interface RegistryConfirmInput {
  itemId: number
  /** 미등록 시리얼의 모델(device_name/device_model) — 접두로 판별 불가할 때 필수 */
  modelInput?: string | null
  /** 상품유형(일반/라이트) — 병원이 혼합 딜이면 필수(원장 규칙) */
  productType?: string | null
  wardName?: string | null
}

export async function confirmAsRegistry(receiptId: number, actor: { userId: string; name: string | null }, input: RegistryConfirmInput): Promise<{ warnings: string[]; kind: 'created' | 'reregistered' | 'transferred' }> {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, hospitalCode: true, receiptDate: true, note: true, status: { select: { ticketStatus: true } }, hospital: { select: { hospitalName: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수입니다.')
    const item = await tx.asReceiptItem.findFirst({ where: { id: input.itemId, receiptId } })
    if (!item) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
    if (item.outcome) throw new AsServiceError(409, `이미 종결된 라인입니다: ${item.serialNo}`)
    const [m] = await matchSerials(tx, receipt.hospitalCode, [item.serialNo])
    if (m.state === 'ACTIVE_HERE') throw new AsServiceError(409, `${item.serialNo}: 이미 이 병원에 배치된 기기입니다 (정상)`)

    const today = todayKst()
    const ctx: RegistryCtx = { hospitalCode: receipt.hospitalCode, actor, occurredOn: today, source: 'MANUAL', ref: { type: 'AS', code: receipt.asCode }, memo: `AS접수 원장 확정 (${receipt.asCode})` }
    const ward = input.wardName?.trim() || item.wardName || null
    const r = await registerDevicesIn(tx, ctx, [{
      serialInput: item.serialNo,
      modelInput: input.modelInput?.trim() || null,
      wardName: ward,
      productType: input.productType?.trim() || undefined,
    }], { client: tx, conflicts: m.state === 'ACTIVE_OTHER' ? { [item.serialNo]: 'TRANSFER' } : null })
    const ref = r.created[0] ?? r.reregistered[0] ?? r.transferred[0]
    if (!ref) throw new AsServiceError(409, `${item.serialNo}: 원장 배치가 만들어지지 않았습니다${r.skipped[0]?.reason ? ` — ${r.skipped[0].reason}` : ''}`)
    const kind: 'created' | 'reregistered' | 'transferred' = r.created[0] ? 'created' : r.reregistered[0] ? 'reregistered' : 'transferred'
    const warnings = [...r.warnings]

    await tx.asReceiptItem.update({ where: { id: item.id }, data: { deviceId: ref.id, deviceKind: null, wardName: ward ?? undefined } })
    warnings.push(...(await openAsFlags(tx, receipt, [{ serialNo: item.serialNo, deviceId: ref.id }], actor, today)))

    const kindLabel = kind === 'created' ? '원장 신규 등록' : kind === 'reregistered' ? '재등록' : `타병원(${m.hospitalName ?? '-'})에서 이관`
    await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[원장확정 ${today} ${actor.name ?? ''}] ${item.serialNo} → ${receipt.hospital?.hospitalName ?? receipt.hospitalCode} 배치 (${kindLabel}${ward ? `, ${ward}` : ''})`) } })
    return { warnings, kind }
  }, { timeout: 60000, maxWait: 10000 })
}

// ── 리오픈 (2026-09-11 — 완료·취소된 접수를 다시 진행 상태로) ─────────
// 헤더만 되돌린다(라인 결과·기기현황 이벤트는 그대로 — 라인 되돌리기는 별도 결정). 사유는 비고 이력 + 티켓은 어댑터 동기화로 재오픈.

export async function reopenAsReceipt(receiptId: number, actor: { userId: string; name: string | null }, input: { reason: string; statusId?: number | null }): Promise<{ statusName: string }> {
  const reason = input.reason?.trim()
  if (!reason) throw new AsServiceError(400, '리오픈 사유를 입력하세요.')
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, note: true, status: { select: { ticketStatus: true, name: true } }, items: { select: { intakeState: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    const terminal = receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED'
    if (!terminal) throw new AsServiceError(409, '완료·취소된 접수만 리오픈할 수 있습니다.')
    // 대상 상태: 지정 시 비종결 AS_STATUS만 / 미지정 시 입고된 라인이 있으면 '입고', 없으면 '접수'
    let target: { id: number; name: string } | null = null
    if (input.statusId != null) {
      const row = await tx.statusCode.findFirst({ where: { id: input.statusId, category: 'AS_STATUS' }, select: { id: true, name: true, ticketStatus: true } })
      if (!row || row.ticketStatus === 'RESOLVED' || row.ticketStatus === 'CLOSED') throw new AsServiceError(400, '리오픈 대상 상태가 올바르지 않습니다 (종결 상태 불가).')
      target = { id: row.id, name: row.name }
    } else {
      const name = receipt.items.some((i) => i.intakeState === 'RECEIVED') ? '입고' : '접수'
      target = await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name }, select: { id: true, name: true } })
        ?? await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '접수' }, select: { id: true, name: true } })
      if (!target) throw new AsServiceError(400, "AS_STATUS '접수' 상태가 없습니다 — seed-as-masters.sql 확인")
    }
    const today = todayKst()
    await tx.asReceipt.update({
      where: { id: receipt.id },
      data: {
        statusId: target.id, statusChangedAt: new Date(), resolvedAt: null,
        note: appendNote(receipt.note, `[리오픈 ${today} ${actor.name ?? ''}] ${receipt.status?.name ?? '종결'} → ${target.name} — ${reason}`),
      },
    })
    await syncAsReceiptToTicket(tx, receipt.id, actor.userId)
    return { statusName: target.name }
  }, { timeout: 30000, maxWait: 10000 })
}

// ── 발송정보 갱신 (2026-09-11 — 기기군 단위 발송방법·송장·발송일 일괄 기입/정정) ─────────
// 발송된 라인(수리반환·교체)만 대상. 기기현황 이벤트는 건드리지 않음(발송 메타만). 시트 R·V·W 역기입은 다음 틱에 반영.

export interface ShipInfoInput {
  itemIds: number[]
  shipMethod?: 'PARCEL' | 'VISIT' | null
  shipTrackingNo?: string | null
  shippedAt?: string | null // YYYY-MM-DD
}

export async function updateAsShipInfo(receiptId: number, input: ShipInfoInput): Promise<{ updated: number }> {
  const ids = Array.from(new Set((input.itemIds ?? []).filter((n) => Number.isInteger(n))))
  if (!ids.length) throw new AsServiceError(400, '발송정보를 적용할 라인을 선택하세요.')
  const shipMethod = input.shipMethod ?? null
  if (shipMethod && shipMethod !== 'PARCEL' && shipMethod !== 'VISIT') throw new AsServiceError(400, '발송방법이 올바르지 않습니다.')
  const shippedAt = input.shippedAt?.trim() || null
  if (shippedAt && !/^\d{4}-\d{2}-\d{2}$/.test(shippedAt)) throw new AsServiceError(400, '발송일이 올바르지 않습니다 (YYYY-MM-DD).')
  const items = await prisma.asReceiptItem.findMany({ where: { id: { in: ids }, receiptId }, select: { id: true, serialNo: true, outcome: true } })
  if (items.length !== ids.length) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
  const notShipped = items.filter((i) => i.outcome !== 'REPAIR_RETURN' && i.outcome !== 'REPLACE')
  if (notShipped.length) throw new AsServiceError(400, `발송 라인(수리반환·교체)만 발송정보를 수정할 수 있습니다: ${notShipped.map((i) => i.serialNo).join(', ')}`)
  const r = await prisma.asReceiptItem.updateMany({
    where: { id: { in: ids } },
    data: {
      shipMethod: input.shipMethod === undefined ? undefined : shipMethod,
      shipTrackingNo: input.shipTrackingNo === undefined ? undefined : input.shipTrackingNo?.trim() || null,
      shippedAt: shippedAt ? new Date(shippedAt) : undefined,
    },
  })
  return { updated: r.count }
}

// ── 접수 등록 코어 (2026-09-07 — 채널톡 자동 등록 편입으로 라우트에서 추출) ─────────
// 화면 등록(POST /api/as-receipts)과 채널톡 시트 폴링(lib/channeltalkAsSync)이 공유하는 단일 경로.
// 검증 실패는 AsServiceError(400). 발번 충돌(P2002)은 1회 재시도.

export interface CreateAsReceiptInput {
  hospitalCode: string
  category?: string
  receiptDate: Date
  reporterName?: string | null
  pickupMethod?: string | null
  pickupTrackingNo?: string | null
  preReplace?: boolean
  destType?: string | null // HOSPITAL / OTHER
  destInfo?: string | null
  pickupDestInfo?: string | null // 회수지 정보 (CX #13 — 채널톡 인입 시 발송지와 동일 자동 기재)
  statusId?: number | null // 미지정 시 '접수'
  note?: string | null
  lines: LineInput[]
}

export interface CreateAsReceiptResult {
  id: number
  asCode: string
  ticketId: number
  warnings: string[]
  hospitalName: string
}

export async function createAsReceipt(
  input: CreateAsReceiptInput,
  actor: { userId: string; name: string }
): Promise<CreateAsReceiptResult> {
  const hospitalCode = input.hospitalCode?.trim()
  if (!hospitalCode) throw new AsServiceError(400, '병원을 선택하세요.')
  const hospital = await prisma.hospital.findUnique({
    where: { hospitalCode },
    select: { hospitalCode: true, hospitalName: true },
  })
  if (!hospital) throw new AsServiceError(400, '병원을 찾을 수 없습니다.')

  const category = input.category ?? 'FAULT'
  if (!(AS_CATEGORIES as readonly string[]).includes(category)) throw new AsServiceError(400, '구분이 올바르지 않습니다.')

  const receiptDate = input.receiptDate
  if (!(receiptDate instanceof Date) || isNaN(receiptDate.getTime())) throw new AsServiceError(400, '접수일을 입력하세요.')

  const pickupMethod = input.pickupMethod ?? null
  if (pickupMethod && !(AS_METHODS as readonly string[]).includes(pickupMethod)) {
    throw new AsServiceError(400, '수거방법이 올바르지 않습니다.')
  }

  const lines = input.lines
  if (!lines.length) throw new AsServiceError(400, '기기 시리얼을 1개 이상 입력하세요.')
  const seen = new Set<string>()
  for (const l of lines) {
    const key = l.serial.replace(/\s+/g, '').toUpperCase()
    if (!key) throw new AsServiceError(400, '시리얼이 비어 있습니다.')
    if (seen.has(key)) throw new AsServiceError(400, `같은 시리얼이 중복 입력되었습니다: ${key}`)
    seen.add(key)
  }

  // 상태 — 지정 시 카테고리 검증, 미지정이면 '접수'
  let statusId: number | null = null
  if (input.statusId !== undefined && input.statusId !== null) {
    const row = Number.isInteger(input.statusId)
      ? await prisma.statusCode.findFirst({ where: { id: input.statusId, category: 'AS_STATUS' }, select: { id: true } })
      : null
    if (!row) throw new AsServiceError(400, '상태가 올바르지 않습니다.')
    statusId = row.id
  } else {
    const open = await prisma.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '접수' }, select: { id: true } })
    statusId = open?.id ?? null
  }
  const statusRow = statusId ? await prisma.statusCode.findUnique({ where: { id: statusId }, select: { name: true } }) : null

  const note = input.note?.trim() || null
  const reporterName = input.reporterName?.trim() || null
  const pickupTrackingNo = input.pickupTrackingNo?.trim() || null
  const preReplace = input.preReplace === true
  const destType = input.destType ?? null
  if (destType && !(AS_DEST_TYPES as readonly string[]).includes(destType)) throw new AsServiceError(400, '발송지 구분이 올바르지 않습니다.')
  const destInfo = input.destInfo?.trim() || null

  // 티켓 설명 소스 — 비고 또는 라인 접수사유 상위 3건
  const symptoms = lines.map((l) => l.symptom?.trim()).filter((s): s is string => !!s)
  const description = note ?? (symptoms.length ? symptoms.slice(0, 3).join(' / ') : null)

  // 레코드+라인+연결 티켓+AS 표시 단일 트랜잭션 — 발번 P2002 1회 재시도
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const receipt = await tx.asReceipt.create({
            data: {
              asCode: await nextAsCode(tx),
              hospitalCode: hospital.hospitalCode,
              category,
              receiptDate,
              reporterName,
              pickupMethod,
              pickupTrackingNo,
              preReplace,
              destType,
              destInfo,
              pickupDestInfo: input.pickupDestInfo?.trim() || null,
              statusId,
              note,
              createdById: actor.userId,
            },
          })
          // 라인 매칭 + 생성
          const txWarnings: string[] = []
          const matches = await matchSerials(tx, hospital.hospitalCode, lines.map((l) => l.serial))
          const flagTargets: { serialNo: string; deviceId: number }[] = []
          for (let i = 0; i < matches.length; i++) {
            const m = matches[i]
            const line = lines[i]
            const w = matchWarning(m)
            if (w) txWarnings.push(w)
            await tx.asReceiptItem.create({
              data: {
                receiptId: receipt.id,
                serialNo: m.serialNo,
                deviceId: m.deviceId,
                deviceKind: m.deviceId ? null : line.deviceKind?.trim() || null,
                wardName: line.wardName?.trim() || m.wardName,
                symptom: line.symptom?.trim() || null,
              },
            })
            if (m.state === 'ACTIVE_HERE' && !m.asOpen) flagTargets.push({ serialNo: m.serialNo, deviceId: m.deviceId! })
          }
          const tid = await createTicketForAsReceipt(tx, {
            id: receipt.id,
            asCode: receipt.asCode,
            hospitalCode: hospital.hospitalCode,
            hospitalName: hospital.hospitalName,
            category,
            statusName: statusRow?.name ?? null,
            statusId: receipt.statusId,
            description,
            resolvedAt: null,
            createdAt: receipt.createdAt,
          }, actor.userId, 'domain')
          // AS 표시 — 접수일 기준, 실패는 경고 (ref 검증이 접수 레코드를 참조하므로 티켓 생성 후 호출 무관)
          txWarnings.push(
            ...(await openAsFlags(
              tx,
              { asCode: receipt.asCode, hospitalCode: hospital.hospitalCode },
              flagTargets,
              { userId: actor.userId, name: actor.name },
              receipt.receiptDate.toISOString().slice(0, 10)
            ))
          )
          return { receipt, tid, txWarnings }
        },
        { timeout: 60000, maxWait: 10000 }
      )
      return {
        id: result.receipt.id,
        asCode: result.receipt.asCode,
        ticketId: result.tid,
        warnings: result.txWarnings,
        hospitalName: hospital.hospitalName,
      }
    } catch (err) {
      if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
}
