/**
 * 병원 스코프 디바이스 원장 라우트 공용 — 선검사·오류 매핑·본문 파서
 * (projects/hospital_device_registry_design.md §7 규약: force-dynamic · 수동 파싱 · `{ error: '한국어' }` · 병원 404 선검사)
 *
 * 라우트는 얇게: parse → access → service(`@/lib/deviceRegistry`) → logAudit → respond.
 * `app/api/hospitals/[code]/wards/*`도 이 파일을 import한다(같은 병원 스코프 규약).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, type JWTPayload } from '@/lib/auth'
import { checkDeviceRegistryAccess } from '@/lib/deviceRegistryAccess'
import { isRegistryError, type RegistryActor, type RegistryRef } from '@/lib/deviceRegistry'
import { IMPORT_ROW_ACTIONS, REGISTRY_REF_TYPES, type ImportRowAction, type RegistryRefType } from '@/lib/deviceRegistryShared'

export type HospitalRef = { hospitalCode: string; hospitalName: string }

export type RouteGuard = { ok: true; user: JWTPayload; hospital: HospitalRef } | { ok: false; response: NextResponse }

/** 로그인(401) → 원장 권한(403, `checkDeviceRegistryAccess`) → 병원 존재(404) 선검사 */
export async function guardHospitalRoute(
  request: NextRequest,
  code: string,
  access?: { write?: boolean; admin?: boolean }
): Promise<RouteGuard> {
  const user = await getAuthUser(request)
  if (!user) return { ok: false, response: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) }
  if (access) {
    const denial = await checkDeviceRegistryAccess(user, access)
    if (denial) return { ok: false, response: NextResponse.json({ error: denial.error }, { status: denial.status }) }
  }
  const hospital = await prisma.hospital.findUnique({
    where: { hospitalCode: code },
    select: { hospitalCode: true, hospitalName: true },
  })
  if (!hospital) return { ok: false, response: NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 }) }
  return { ok: true, user, hospital }
}

export function registryActor(user: JWTPayload): RegistryActor {
  return { userId: user.userId, name: user.name }
}

/** 라우트 파서용 400 — `errorResponse`가 `{ error }` 400으로 변환 */
export class BadRequest extends Error {
  status = 400 as const
  constructor(message: string) {
    super(message)
    this.name = 'BadRequest'
  }
}

/** RegistryError → 그 status + `toJSON()`(`{ error, conflicts?, rows?, skipped? }`), BadRequest → 400, 그 외 500 */
export function errorResponse(e: unknown, fallback: string): NextResponse {
  if (isRegistryError(e)) return NextResponse.json(e.toJSON(), { status: e.status })
  if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 })
  console.error(`[device-registry] ${fallback}`, e)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/** JSON 본문 — 객체가 아니면 null */
export async function readJsonObject(request: NextRequest): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// 값 파서 — 미지정(undefined)과 명시 null을 구분하지 않고 "값 없음 = null"로 정규화
// ─────────────────────────────────────────────────────────────────────────────

export function optString(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}

/** 양의 정수만 허용(숫자 문자열 포함). 값 없음 → null, 그 외 → 400 */
export function optPositiveInt(v: unknown, label: string): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isInteger(n) || n <= 0) throw new BadRequest(`${label}이(가) 올바르지 않습니다.`)
  return n
}

/** 정수(0·음수 허용 — sortOrder 등). 값 없음 → null, 그 외 → 400 */
export function optInt(v: unknown, label: string): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isInteger(n)) throw new BadRequest(`${label}이(가) 올바르지 않습니다.`)
  return n
}

export function optBoolean(v: unknown, label: string): boolean | null {
  if (v == null || v === '') return null
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === '1' || v === 1) return true
  if (v === 'false' || v === '0' || v === 0) return false
  throw new BadRequest(`${label}이(가) 올바르지 않습니다.`)
}

/** multipart 필드처럼 JSON 문자열로 온 값을 풀어준다(문자열이 아니면 그대로) */
export function jsonField(v: unknown, label: string): unknown {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    throw new BadRequest(`${label} 형식이 올바르지 않습니다 (JSON).`)
  }
}

/** 소프트 참조 `{ type, code }` — 어휘는 REGISTRY_REF_TYPES, 코드 존재 검사는 서비스(prepareCtx)가 수행 */
export function parseRef(v: unknown): RegistryRef | null {
  if (v == null) return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequest('연결(ref) 형식이 올바르지 않습니다.')
  const o = v as { type?: unknown; code?: unknown; refType?: unknown; refCode?: unknown }
  const type = optString(o.type ?? o.refType)
  const code = optString(o.code ?? o.refCode)
  if (!type && !code) return null
  if (!type || !(REGISTRY_REF_TYPES as readonly string[]).includes(type)) throw new BadRequest('연결 유형(ref.type)이 올바르지 않습니다.')
  if (!code) throw new BadRequest('연결 코드(ref.code)가 비어 있습니다.')
  return { type: type as RegistryRefType, code }
}

/** `excludeRows: number[]` */
export function parseIntArray(v: unknown, label: string): number[] {
  if (v == null || v === '') return []
  if (!Array.isArray(v)) throw new BadRequest(`${label}은(는) 배열이어야 합니다.`)
  return v.map((x) => {
    const n = typeof x === 'number' ? x : Number(String(x).trim())
    if (!Number.isInteger(n)) throw new BadRequest(`${label}에 정수가 아닌 값이 있습니다.`)
    return n
  })
}

export function parseStringArray(v: unknown, label: string): string[] {
  if (v == null || v === '') return []
  if (!Array.isArray(v)) throw new BadRequest(`${label}은(는) 배열이어야 합니다.`)
  return v.map((x) => String(x ?? '').trim()).filter(Boolean)
}

/** `rowActions: { [row]: 'TRANSFER'|'UNASSIGN_WARD' }` — 판정 일치 여부는 서비스가 400으로 강제(§7.2) */
export function parseRowActions(v: unknown): Record<number, ImportRowAction> {
  if (v == null || v === '') return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequest('rowActions 형식이 올바르지 않습니다.')
  const out: Record<number, ImportRowAction> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const row = Number(k)
    if (!Number.isInteger(row)) throw new BadRequest(`rowActions의 행 번호가 올바르지 않습니다: ${k}`)
    if (val == null || val === '') continue
    if (!(IMPORT_ROW_ACTIONS as readonly string[]).includes(String(val))) throw new BadRequest(`행 ${k}의 액션이 올바르지 않습니다: ${String(val)}`)
    out[row] = val as ImportRowAction
  }
  return out
}

/** `wardAliases: { [입력 병동명]: wardId }` */
export function parseWardAliases(v: unknown): Record<string, number> {
  if (v == null || v === '') return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequest('wardAliases 형식이 올바르지 않습니다.')
  const out: Record<string, number> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const name = k.trim()
    if (!name) continue
    if (val == null || val === '') continue
    const id = typeof val === 'number' ? val : Number(String(val).trim())
    if (!Number.isInteger(id) || id <= 0) throw new BadRequest(`병동 별칭 '${k}'의 대상 병동 id가 올바르지 않습니다.`)
    out[name] = id
  }
  return out
}

/** 감사 after용 — 배열 앞 n건만(임포트 1,000건에 audit 1,000행을 만들지 않는다 — §8.3) */
export const AUDIT_LIST_CAP = 50
export function capList<T>(list: readonly T[], cap: number = AUDIT_LIST_CAP): T[] {
  return list.slice(0, cap)
}
