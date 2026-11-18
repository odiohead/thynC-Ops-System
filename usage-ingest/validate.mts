/**
 * 수신 본문 검증 — 형식이 맞지 않으면 BadRequest 를 던진다.
 * 저장 SQL에는 여기서 걸러 낸 값만 들어간다 (알 수 없는 필드는 버린다).
 */

export class BadRequest extends Error {}

type Obj = Record<string, unknown>

const TS_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?$/

export function asObject(v: unknown, what: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequest(`${what}: object expected`)
  return v as Obj
}

export function asArray(v: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw new BadRequest(`${what}: array expected`)
  if (v.length > max) throw new BadRequest(`${what}: too many rows (${v.length} > ${max})`)
  return v
}

export function str(v: unknown, what: string, max = 255): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') throw new BadRequest(`${what}: string expected`)
  if (v.length > max) throw new BadRequest(`${what}: too long`)
  // PostgreSQL text 는 NUL 문자를 받지 않는다
  return v.includes('\u0000') ? v.replace(/\u0000/g, '') : v
}

export function reqStr(v: unknown, what: string, max = 255): string {
  const s = str(v, what, max)
  if (s === null || s === '') throw new BadRequest(`${what}: required`)
  return s
}

export function int(v: unknown, what: string, min = -2147483648, max = 2147483647): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadRequest(`${what}: integer expected`)
  if (v < min || v > max) return null // 범위를 벗어난 값은 버린다 (원본의 쓰레기 값으로 전체 묶음이 실패하지 않게)
  return v
}

export function bigint(v: unknown, what: string): number | null {
  return int(v, what, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
}

export function reqBigint(v: unknown, what: string): number {
  const n = bigint(v, what)
  if (n === null) throw new BadRequest(`${what}: required`)
  return n
}

export function smallint(v: unknown, what: string): number | null {
  return int(v, what, -32768, 32767)
}

/** 병원 DB의 시각 문자열(시간대 없음). 빈 값·0000-00-00 은 null */
export function ts(v: unknown, what: string): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string') throw new BadRequest(`${what}: timestamp string expected`)
  const m = TS_RE.exec(v)
  if (!m) throw new BadRequest(`${what}: bad timestamp`)
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) return null
  // 2월 30일 같은 날짜는 PostgreSQL 이 거부한다 — 실제 달력으로 확인
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1) return null
  return v
}

export function bool(v: unknown): boolean {
  return v === true
}
