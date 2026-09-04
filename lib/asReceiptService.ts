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
import { openDeviceAs, clearDeviceAs, replaceDevice, recoverDevice, RegistryError, type RegistryCtx } from '@/lib/deviceRegistry'
import { syncAsReceiptToTicket } from '@/lib/ticket-domains/asReceipt'
import { AS_OUTCOMES, type AsOutcome } from '@/lib/asReceiptShared'

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
  actor: { userId: string | null; name: string | null }
): Promise<string[]> {
  if (!lines.length) throw new AsServiceError(400, '기기 라인을 1개 이상 입력하세요.')
  const warnings: string[] = []
  const existing = await tx.asReceiptItem.findMany({ where: { receiptId: receipt.id } })
  const byKey = new Map(existing.map((i) => [i.serialNo, i]))

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
    hospitalCode: receipt.hospitalCode,
    actor,
    occurredOn: today,
    source: 'MANUAL',
    ref: { type: 'AS', code: receipt.asCode },
  }

  // 제거 (미종결) — 이 접수가 켠 플래그만 해제
  for (const item of existing) {
    if (seen.has(item.serialNo)) continue
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
}

export interface ResolveInput {
  lines: ResolveLineInput[]
  /** 이벤트·발송 기준일 (기본 오늘) — 수리반환/교체는 발송일, 분실/취소는 처리일 */
  effectiveDate?: string | null
  shipMethod?: 'PARCEL' | 'VISIT' | null
  shipTrackingNo?: string | null
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
          items: { select: { id: true, serialNo: true, deviceId: true, outcome: true } },
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

        const shipped = l.outcome === 'REPAIR_RETURN' || l.outcome === 'REPLACE'
        const data: Prisma.AsReceiptItemUncheckedUpdateInput = {
          outcome: l.outcome,
          shippedAt: shipped ? new Date(effectiveDate) : undefined,
          shipMethod: shipped ? shipMethod : undefined,
          shipTrackingNo: shipped ? input.shipTrackingNo?.trim() || null : undefined,
        }

        if (!item.deviceId) {
          // 미등록 라인 — 기기현황 이벤트 스킵 (결정 7), 기록만
          warnings.push(`${item.serialNo}: 미등록 라인 — 기기현황에 기록되지 않았습니다`)
          if (l.outcome === 'REPLACE') data.newSerialNo = normalizeSerial(l.newSerial!).serialNo
        } else if (l.outcome === 'REPAIR_RETURN' || l.outcome === 'CANCELED') {
          try {
            await clearDeviceAs(ctx, { deviceId: item.deviceId }, { client: tx })
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
