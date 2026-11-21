/**
 * 회원가입 신청 (2026-11-13) — 공개 가입 신청 → 관리자(ADMIN 이상) 승인 시 계정 생성.
 * 입력 검증·중복 판정·간단한 요청 빈도 제한. 승인 전에는 users에 행을 만들지 않는다.
 */
import { prisma } from '@/lib/prisma'

export const SIGNUP_PASSWORD_MIN = 8
export const SIGNUP_PASSWORD_MAX = 72 // bcrypt 입력 한도
export const SIGNUP_ROLES = ['USER', 'VIEWER', 'ADMIN', 'SUPER_ADMIN'] as const
export type SignupRole = (typeof SIGNUP_ROLES)[number]

export interface SignupInput { email: string; password: string; name: string; phone: string; organizationId: number | null; memo: string | null }

/** 본문 검증 — 통과하면 정규화된 입력, 아니면 오류 문구 */
export function parseSignupBody(body: Record<string, unknown>): { ok: true; input: SignupInput } | { ok: false; error: string } {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const email = str(body.email).toLowerCase() // users.email과 같은 정규화(소문자·공백 제거)
  const name = str(body.name)
  const phone = str(body.phone)
  const password = typeof body.password === 'string' ? body.password : ''
  const memo = str(body.memo)
  if (!name) return { ok: false, error: '이름을 입력하세요.' }
  if (name.length > 50) return { ok: false, error: '이름은 50자 이내로 입력하세요.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { ok: false, error: '이메일 형식이 올바르지 않습니다.' }
  if (password.length < SIGNUP_PASSWORD_MIN) return { ok: false, error: `비밀번호는 ${SIGNUP_PASSWORD_MIN}자 이상이어야 합니다.` }
  if (password.length > SIGNUP_PASSWORD_MAX) return { ok: false, error: `비밀번호는 ${SIGNUP_PASSWORD_MAX}자 이내로 입력하세요.` }
  if (!phone) return { ok: false, error: '연락처를 입력하세요.' }
  if (phone.length > 30) return { ok: false, error: '연락처는 30자 이내로 입력하세요.' }
  if (memo.length > 500) return { ok: false, error: '신청 메모는 500자 이내로 입력하세요.' }
  const orgRaw = body.organizationId
  const organizationId = orgRaw === null || orgRaw === undefined || orgRaw === '' ? null : Number(orgRaw)
  if (organizationId !== null && !Number.isInteger(organizationId)) return { ok: false, error: '소속이 올바르지 않습니다.' }
  if (organizationId === null) return { ok: false, error: '소속을 선택하세요.' }
  return { ok: true, input: { email, password, name, phone, organizationId, memo: memo || null } }
}

/** 가입 신청 화면의 소속 선택지 — 활성 소속 이름만 (공개 응답이라 코드·인원 등은 내보내지 않는다) */
export async function signupOrganizations(): Promise<{ id: number; name: string }[]> {
  return prisma.organization.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
}

// ── 요청 빈도 제한 (공개 엔드포인트) — 프로세스 메모리(PM2 단일 프로세스 기준의 가벼운 방어)
//  · IP당 10분에 5회
//  · 전체 10분에 30회 — 프록시 없이 직접 붙는 환경에서는 IP 헤더를 지어낼 수 있으므로 IP와 무관한 상한을 함께 둔다
const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_IP = 5
const MAX_TOTAL = 30
const hits = new Map<string, number[]>()
let totalHits: number[] = []
export function signupRateLimited(ip: string | null): boolean {
  const key = ip || 'unknown'
  const now = Date.now()
  totalHits = totalHits.filter((t) => now - t < WINDOW_MS)
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  hits.set(key, list)
  if (list.length >= MAX_PER_IP || totalHits.length >= MAX_TOTAL) return true
  list.push(now)
  totalHits.push(now)
  if (hits.size > 5000) for (const [k, v] of Array.from(hits.entries())) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k)
  return false
}
/** 대기 신청 총량 상한 — 넘으면 신규 접수를 잠시 막는다(무한 적재 방지) */
export const SIGNUP_PENDING_CAP = 300

/**
 * 요청 IP — 빈도 제한용이라 **클라이언트가 지어낼 수 없는 값**을 쓴다: 프록시(Nginx)가 넣는 x-real-ip 우선,
 * 없으면 x-forwarded-for의 **마지막** 값(가장 가까운 프록시가 덧붙인 주소 — 맨 앞 값은 클라이언트가 보낸 헤더일 수 있다).
 */
export function requestIp(req: Request): string | null {
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  const fwd = req.headers.get('x-forwarded-for')
  return (fwd ? fwd.split(',').pop()?.trim() : null) || null
}
