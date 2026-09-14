import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, type JWTPayload } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'

/**
 * 사내 위키 접근 게이트 (서버 강제) — projects/wiki_next_gen_review.md A-6
 *
 * nav 메뉴의 `allowed_org_codes={SEERS}`는 UI 노출 제어일 뿐 API·페이지·협업 서버를 막지 못한다.
 * AI 어시스턴트(lib/ai/access.ts)·주간업무(lib/weeklyAccess.ts)와 같은 방식으로
 * 로그인 + (SEERS 소속 OR `wiki.access` 권한)을 DB 실시간으로 판정한다 (JWT는 최대 7일 stale).
 *
 * 등급(VIEWER 읽기전용 / USER 이상 쓰기)은 이 게이트와 별개 축 — 게이트는 "위키에 들어올 수 있는가"만 본다.
 * 적용 지점: app/wiki/layout.tsx(페이지), /api/wiki/* (getWikiAuthUser), collab-server onConnect(동일 규칙 자체 구현).
 */

export const WIKI_ALLOWED_ORG_CODES: readonly string[] = ['SEERS']

export type WikiAccessDenial = { status: number; error: string }

/** 통과면 null, 차단이면 상태코드·메시지 */
export async function checkWikiAccess(user: JWTPayload): Promise<WikiAccessDenial | null> {
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { isActive: true, organization: { select: { code: true } } },
  })
  if (!row) return { status: 403, error: '계정을 찾을 수 없습니다.' }
  if (!row.isActive) return { status: 403, error: '비활성 계정입니다.' }
  const code = row.organization?.code
  if (code && WIKI_ALLOWED_ORG_CODES.includes(code)) return null
  // 소속 미충족 — RBAC Lite 가산: wiki.access 권한 보유 시 허용
  if (await hasPermission(user, 'wiki.access')) return null
  return { status: 403, error: '소속 정책에 따라 사내 위키에 접근할 수 없습니다.' }
}

/**
 * /api/wiki/* 공용 인증 — 로그인 + 위키 접근 게이트를 한 번에.
 * 통과 시 JWT 페이로드, 미로그인·게이트 차단 모두 null (호출부는 기존대로 401 처리).
 * 게이트 차단을 401로 합치는 이유: 25개 라우트의 기존 2줄 패턴을 그대로 유지하기 위해서이며,
 * 메인 화면의 임베드 패널(병원 노트·이슈노트·관련 위키 카드)은 non-ok 응답이면 패널을 숨긴다.
 */
export async function getWikiAuthUser(req: NextRequest): Promise<JWTPayload | null> {
  const user = await getAuthUser(req)
  if (!user) return null
  const denial = await checkWikiAccess(user)
  return denial ? null : user
}
