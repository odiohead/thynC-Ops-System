import { prisma } from '@/lib/prisma'
import { isAdminOrAbove, isUserOrAbove, type JWTPayload } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'

/**
 * 영업/CRM 접근 권한 (서버 강제) — projects/sales_crm_design.md §6
 *
 * **(ADMIN 이상 또는 RBAC `sales.access` 권한) + SEERS 소속** 열람·편집
 * (2026-07-30 관리자 개방 → 2026-08-04 RBAC Phase 3 가산 — 등급 축만 확장, 소속 축 불변).
 * 2026-08-07 열람/편집 분리: 열람은 VIEWER도 권한 보유 시 가능, 편집(write)은 USER 등급 이상
 * (VIEWER 읽기 전용 원칙 — 쓰기 API는 { write: true }로 호출).
 * nav 허용 역할은 메뉴 노출만 제어하며, 실제 접근은 이 게이트가 단일 소스다.
 * 소속·활성 여부는 JWT가 아니라 DB 실시간 조회로 판정 (AI 어시스턴트 access.ts 선례).
 */

export const SALES_ALLOWED_ORG_CODES: readonly string[] = ['SEERS']

export type SalesAccessDenial = { status: number; error: string }

/** 통과면 null, 차단이면 응답에 쓸 상태코드·메시지 */
export async function checkSalesAccess(user: JWTPayload, opts?: { write?: boolean }): Promise<SalesAccessDenial | null> {
  const gradeOk = opts?.write ? isUserOrAbove(user.role) : true // 편집은 VIEWER 제외
  if (!isAdminOrAbove(user.role) && !(gradeOk && (await hasPermission(user, 'sales.access')))) {
    return {
      status: 403,
      error: opts?.write
        ? '영업 정보 편집은 ADMIN 이상 또는 영업 접근 권한 보유자(USER 등급 이상)만 가능합니다.'
        : '영업 정보는 ADMIN 이상 또는 영업 접근 권한 보유자만 열람할 수 있습니다.',
    }
  }
  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { isActive: true, organization: { select: { code: true } } },
  })
  if (!row) return { status: 403, error: '계정을 찾을 수 없습니다.' }
  if (!row.isActive) return { status: 403, error: '비활성 계정입니다.' }
  const code = row.organization?.code
  if (!code || !SALES_ALLOWED_ORG_CODES.includes(code)) {
    return { status: 403, error: '소속 정책에 따라 영업 정보를 열람할 수 없습니다.' }
  }
  return null
}

/** 서버 컴포넌트용 — 병원 상세에서 영업 섹션 렌더 여부 판정 */
export async function canAccessSales(user: JWTPayload | null): Promise<boolean> {
  if (!user) return false
  return (await checkSalesAccess(user)) === null
}

/**
 * 딜 코드 발번 — `DEAL-YYYYMM-NNNN` (상담이력 CS- 발번 패턴과 동일)
 * 동시 생성 시 UNIQUE 충돌(P2002)은 호출부에서 재시도한다.
 */
export async function nextDealCode(): Promise<string> {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const ym = kst.toISOString().slice(0, 7).replace('-', '')
  const prefix = `DEAL-${ym}-`
  const last = await prisma.salesDeal.findFirst({
    where: { dealCode: { startsWith: prefix } },
    orderBy: { dealCode: 'desc' },
    select: { dealCode: true },
  })
  const seq = last?.dealCode ? parseInt(last.dealCode.slice(-4)) + 1 : 1
  return `${prefix}${String(seq).padStart(4, '0')}`
}

/** BigInt 금액 → JSON 직렬화용 number|null (원 단위, 2^53 이내 전제) */
export function toAmount(v: bigint | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v)
}

/** 입력값 → BigInt|null (숫자·숫자문자열 허용, 그 외 null) */
export function parseAmount(v: unknown): bigint | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN
  if (!Number.isFinite(n)) return null
  return BigInt(Math.round(n))
}

/** 입력값 → Date|null (YYYY-MM-DD 문자열) */
export function parseDateOnly(v: unknown): Date | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return isNaN(d.getTime()) ? null : d
}

/** 영업 StatusCode 카테고리 화이트리스트 (설정 API·통합 GET 공유) — v4: 7종 */
export const SALES_CODE_CATEGORIES = [
  'SALES_STAGE',
  'SALES_DEAL_STATUS',
  'SALES_ACTIVITY_TYPE',
  'SALES_MODEL',
  'SALES_TAX_INVOICE',
  'SALES_SETTLEMENT',
  'PERSON_GROUP',
] as const
export type SalesCodeCategory = (typeof SALES_CODE_CATEGORIES)[number]

export const SALES_CODE_CATEGORY_LABELS: Record<SalesCodeCategory, string> = {
  SALES_STAGE: '영업 단계',
  SALES_DEAL_STATUS: '딜(계약 건) 상태',
  SALES_ACTIVITY_TYPE: '영업 활동 유형',
  SALES_MODEL: '판매모델',
  SALES_TAX_INVOICE: '세금계산서 발행',
  SALES_SETTLEMENT: '정산 상태',
  PERSON_GROUP: '직군 (인적정보)',
}

/**
 * 딜 판매모델(daewoong_model) → 도입형태(INTRO_TYPE StatusCode) 매핑 — 2026-08-31 확정
 * scripts/migrate-intro-types-from-deals.sql 과 단일 규칙 유지 (변경 시 양쪽 동반 수정)
 */
const DEAL_MODEL_TO_INTRO_TYPE: Record<string, string> = {
  사용량: '사용량비례형',
  구축형: '구축형',
  분납형: '구축형',
  구독형: '구독형',
  '씨어스 월 납입': '구독형',
}

/**
 * 병원 도입형태를 딜 판매모델 기준으로 재계산해 전체 교체 (딜 저장/삭제 후 호출).
 * 매핑 가능한 판매모델이 하나도 없으면 현행 유지 — 일회성 마이그와 동일 규칙
 * (판매모델 미입력 병원의 수동 도입형태 보호). 실패해도 딜 저장 자체는 성공 유지(호출부에서 로그만).
 */
export async function syncHospitalIntroTypesFromDeals(hospitalCode: string): Promise<void> {
  const deals = await prisma.salesDeal.findMany({
    where: { hospitalCode },
    select: { daewoongModel: true },
  })
  const introNames = Array.from(
    new Set(
      deals
        .map((d) => (d.daewoongModel ? DEAL_MODEL_TO_INTRO_TYPE[d.daewoongModel] : undefined))
        .filter((n): n is string => !!n)
    )
  )
  if (introNames.length === 0) return

  const [hospital, codes] = await Promise.all([
    prisma.hospital.findUnique({ where: { hospitalCode }, select: { id: true } }),
    prisma.statusCode.findMany({
      where: { category: 'INTRO_TYPE', name: { in: introNames } },
      select: { id: true },
    }),
  ])
  if (!hospital || codes.length === 0) return

  await prisma.$transaction([
    prisma.hospitalIntroType.deleteMany({ where: { hospitalId: hospital.id } }),
    prisma.hospitalIntroType.createMany({
      data: codes.map((c) => ({ hospitalId: hospital.id, statusCodeId: c.id })),
    }),
  ])
}
