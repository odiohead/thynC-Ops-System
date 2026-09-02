/**
 * 디바이스 원장 라우트 공용 헬퍼 — 라우트는 얇게(§7.0: 서비스가 유일한 쓰기자, 라우트는 파싱·권한·감사만)
 *
 * - registryActor        : JWT → RegistryActor
 * - parseRegistryFields  : body의 공통 문맥 필드(occurredOn·memo·ref) 형태 검증 — 어휘·존재 검증은 서비스(prepareCtx)가 담당
 * - registryErrorResponse: RegistryError → 그 status + `toJSON()` 본문, 그 외 500
 * - parseIdParam         : 경로 파라미터 정수 검증
 * - deviceAuditLabel     : audit resourceLabel `{병원} {모델} {시리얼}` (§8.3)
 * - projectionSnapshot   : audit before/after용 스냅샷(유닛 식별 + 배치 상태 컬럼만) — `id`는 공개 device id(유닛 id)
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { JWTPayload } from '@/lib/auth'
import { RegistryError, isRegistryError, type DeviceRow, type RegistryActor, type RegistryRef } from '@/lib/deviceRegistry'

export function registryActor(user: JWTPayload): RegistryActor {
  return { userId: user.userId, name: user.name }
}

export interface RegistryBodyFields {
  occurredOn?: string
  memo?: string | null
  ref?: RegistryRef | null
}

/** body에서 occurredOn·memo·ref를 꺼낸다 — 형태만 검증(400), 값 검증은 서비스 */
export function parseRegistryFields(body: Record<string, unknown>): RegistryBodyFields {
  const out: RegistryBodyFields = {}
  if (body.occurredOn != null && body.occurredOn !== '') {
    if (typeof body.occurredOn !== 'string') throw new RegistryError(400, '업무일자 형식이 올바르지 않습니다 (YYYY-MM-DD)')
    out.occurredOn = body.occurredOn.trim()
  }
  if (body.memo !== undefined) {
    if (body.memo !== null && typeof body.memo !== 'string') throw new RegistryError(400, '메모는 문자열이어야 합니다')
    out.memo = body.memo
  }
  if (body.ref !== undefined) out.ref = parseRef(body.ref)
  return out
}

/** ref 형태 검증 — null 허용, `{ type, code }` 문자열 쌍만 통과 */
export function parseRef(raw: unknown): RegistryRef | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new RegistryError(400, '연결(ref)은 { type, code } 형식이어야 합니다')
  const r = raw as Record<string, unknown>
  if (typeof r.type !== 'string' || typeof r.code !== 'string') throw new RegistryError(400, '연결(ref)은 { type, code } 형식이어야 합니다')
  return { type: r.type.trim() as RegistryRef['type'], code: r.code.trim() }
}

/** 정수 ID 파라미터 — 아니면 400 */
export function parseIdParam(raw: string, label = 'ID'): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new RegistryError(400, `잘못된 ${label}입니다.`)
  return n
}

/** 선택 정수 필드 — undefined/null → undefined, 그 외 정수 아니면 400 */
export function optionalInt(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new RegistryError(400, `${label}이(가) 올바르지 않습니다.`)
  return n
}

/** JSON body 파싱 — 객체가 아니면 400 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RegistryError(400, '요청 본문이 올바르지 않습니다.')
  return body as Record<string, unknown>
}

export function registryErrorResponse(e: unknown, context: string): NextResponse {
  if (isRegistryError(e)) return NextResponse.json(e.toJSON(), { status: e.status })
  console.error(`[device-registry] ${context} 실패:`, e)
  return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 })
}

/** audit resourceLabel — `{병원} {모델} {시리얼}` (회수 개체는 마지막 병원). `deviceId`는 공개 device id(유닛 id) */
export async function deviceAuditLabel(deviceId: number): Promise<string> {
  const d = await prisma.deviceUnit.findUnique({
    where: { id: deviceId },
    select: {
      serialNo: true,
      deviceInfo: { select: { deviceModel: true } },
      placement: { select: { hospital: { select: { hospitalName: true } }, lastHospital: { select: { hospitalName: true } } } },
    },
  })
  if (!d) return `#${deviceId}`
  const hosp = d.placement?.hospital?.hospitalName ?? d.placement?.lastHospital?.hospitalName ?? '-'
  return `${hosp} ${d.deviceInfo?.deviceModel ?? '-'} ${d.serialNo}`
}

/** audit before/after용 — 유닛 식별 + 배치 프로젝션 컬럼만 (타임스탬프 제외) */
export function projectionSnapshot(d: DeviceRow) {
  return {
    id: d.id,
    placementId: d.placementId,
    serialNo: d.serialNo,
    deviceInfoId: d.deviceInfoId,
    status: d.status,
    hospitalCode: d.hospitalCode,
    wardId: d.wardId,
    placedOn: d.placedOn,
    lastHospitalCode: d.lastHospitalCode,
    recoveredOn: d.recoveredOn,
    recoverReasonId: d.recoverReasonId,
    replacedById: d.replacedById,
    lastEventType: d.lastEventType,
    lastEventOn: d.lastEventOn,
    macAddress: d.macAddress,
    extDeviceCode: d.extDeviceCode,
    memo: d.memo,
    usageTypeId: d.usageTypeId,
    productType: d.productType,
    dealCode: d.dealCode,
    asStartedOn: d.asStartedOn,
    asRefCode: d.asRefCode,
  }
}
