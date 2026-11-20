import { NextRequest, NextResponse } from 'next/server'
import { isAdminOrAbove, type JWTPayload } from '@/lib/auth'
import { AgentAdminError } from '@/lib/usage/agents'
import { usageError, usageGate } from '../_shared'

/** 에이전트 관리에서 바꾸는 일 — 사용량 열람 게이트 + ADMIN 이상 */
export async function agentAdminGate(req: NextRequest): Promise<{ user: JWTPayload } | { response: NextResponse }> {
  const gate = await usageGate(req)
  if ('response' in gate) return gate
  if (!isAdminOrAbove(gate.user.role)) return { response: NextResponse.json({ error: '에이전트 관리는 ADMIN 이상만 변경할 수 있습니다.' }, { status: 403 }) }
  return gate
}

export function agentError(e: unknown): NextResponse {
  if (e instanceof AgentAdminError) return NextResponse.json({ error: e.message }, { status: e.status })
  return usageError(e)
}

export function serverCount(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : null
}

export function noteOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null
}
