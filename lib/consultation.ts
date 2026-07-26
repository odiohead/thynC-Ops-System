import { prisma } from '@/lib/prisma'
import type { JWTPayload } from '@/lib/auth'
import { AI_ALLOWED_ORG_CODES } from '@/lib/ai/access'

/**
 * 상담이력 공용 유틸 — 접근 권한·코드 발번·제목 추출
 *
 * 상담이력은 SEERS 전용 AI 어시스턴트의 산출물이므로 열람 범위도 어시스턴트와 같다(설계 D3).
 * 생성은 `lib/ai/access.ts`의 `checkAiAccess`를 그대로 쓰고(어시스턴트가 유일한 생성 경로),
 * 조회는 VIEWER까지 허용해야 해서 여기에 별도 헬퍼를 둔다.
 *
 * 설계: consultation_history_design.md
 */

export type ConsultationDenial = { status: number; error: string }

/**
 * 조회 권한 — SEERS 소속 + 활성 계정. VIEWER 포함(읽기 전용 역할이므로 조회는 허용).
 * 소속·활성은 JWT(최대 7일 경과)가 아니라 DB 실시간 조회로 판정한다(checkAiAccess와 동일한 이유).
 */
export async function checkConsultationRead(user: JWTPayload): Promise<ConsultationDenial | null> {
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { isActive: true, organization: { select: { code: true } } },
  })
  if (!row) return { status: 403, error: '계정을 찾을 수 없습니다.' }
  if (!row.isActive) return { status: 403, error: '비활성 계정입니다.' }

  const code = row.organization?.code
  if (!code || !AI_ALLOWED_ORG_CODES.includes(code)) {
    return { status: 403, error: '소속 정책에 따라 상담이력을 조회할 수 없습니다.' }
  }
  return null
}

/** KST 기준 오늘 (YYYY-MM-DD) — 서버 타임존과 무관하게 업무일 기준을 맞춘다 */
export function todayKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

/**
 * 상담이력 코드 발번 — `CS-YYYYMM-NNNN` (유지보수 MNT- 발번 패턴과 동일)
 * 동시 생성 시 UNIQUE 충돌(P2002)은 호출부에서 재시도한다.
 */
export async function nextConsultationCode(): Promise<string> {
  const ym = todayKst().slice(0, 7).replace('-', '')
  const prefix = `CS-${ym}-`
  const last = await prisma.consultation.findFirst({
    where: { consultationCode: { startsWith: prefix } },
    orderBy: { consultationCode: 'desc' },
    select: { consultationCode: true },
  })
  const seq = last?.consultationCode ? parseInt(last.consultationCode.slice(-4)) + 1 : 1
  return `${prefix}${String(seq).padStart(4, '0')}`
}

/**
 * 본문에서 목록 표시용 제목 추출 — 첫 유효 줄에서 마크다운 장식을 걷어내고 60자로 자른다.
 * AI 정제 결과는 보통 `# 상담이력` 같은 헤딩으로 시작하므로 헤딩 마크는 제거한다.
 */
export function extractConsultationTitle(content: string, fallback: string): string {
  for (const raw of content.split('\n')) {
    const line = raw
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^>\s*/, '')
      .replace(/[*_`~]/g, '')
      .trim()
    if (line) return line.slice(0, 60)
  }
  return fallback
}
