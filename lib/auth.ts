import { SignJWT, jwtVerify } from 'jose'
import { NextRequest } from 'next/server'

const secret = new TextEncoder().encode(process.env.JWT_SECRET!)

export interface JWTPayload {
  userId: string
  email: string
  name: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'VIEWER'
  isActive: boolean
  organization?: { id: number; name: string; code: string }
}

/** 세션 수명 — 기본 7일, '로그인 상태 유지'(사이니지 등 장기 표시) 시 365일 */
export const SESSION_TTL_SEC = { default: 60 * 60 * 24 * 7, remember: 60 * 60 * 24 * 365 } as const

export async function signToken(payload: JWTPayload, ttlSec: number = SESSION_TTL_SEC.default): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec)
    .sign(secret)
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

/** 요청 쿠키에서 현재 사용자 페이로드를 반환. 없으면 null. */
export async function getAuthUser(req: NextRequest): Promise<JWTPayload | null> {
  const token = req.cookies.get('auth-token')?.value
  if (!token) return null
  return verifyToken(token)
}

export function isAdminOrAbove(role: string) {
  return role === 'SUPER_ADMIN' || role === 'ADMIN'
}

export function isSuperAdmin(role: string) {
  return role === 'SUPER_ADMIN'
}

/** USER 이상 (VIEWER만 제외) — 쓰기 가능 역할 */
export function isUserOrAbove(role: string) {
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'USER'
}
