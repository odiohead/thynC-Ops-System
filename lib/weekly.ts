/**
 * 주간업무 관리 — 서버·클라이언트 공용 상수/타입/주차 유틸 (projects/weekly_ops_design.md)
 *
 * lib/hospitalSystem.ts 선례: prisma 등 서버 모듈 import 금지 (클라이언트 select 옵션과
 * 서버 검증이 같은 상수를 공유). 접근 게이트는 서버 전용 lib/weeklyAccess.ts 참조.
 *
 * 완료 여부의 단일 소스는 completedWeek — status는 '진행'/'보류' 2값만 저장하고
 * '완료' 배지는 completedWeek 유무에서 파생한다 (이중 소스 desync 차단).
 */

export const WEEKLY_ITEM_KINDS = ['PROJECT', 'ISSUE'] as const
export type WeeklyItemKind = (typeof WEEKLY_ITEM_KINDS)[number]

export const WEEKLY_KIND_LABELS: Record<WeeklyItemKind, string> = {
  PROJECT: '주요 안건', // 2026-08-19 1차 검토: '주요 프로젝트' → '주요 안건' (라벨만 변경, DB 값 유지)
  ISSUE: '주요 이슈',
}

export const WEEKLY_ITEM_STATUSES = ['진행', '보류'] as const
export type WeeklyItemStatus = (typeof WEEKLY_ITEM_STATUSES)[number]

/** 업무구분 — 고정 3값 (2026-08-19 1차 검토 추가) */
export const WEEKLY_BIZ_TYPES = ['thynC', 'mobiCARE', '공통'] as const
export type WeeklyBizType = (typeof WEEKLY_BIZ_TYPES)[number]

export function isWeeklyBizType(v: unknown): v is WeeklyBizType {
  return typeof v === 'string' && (WEEKLY_BIZ_TYPES as readonly string[]).includes(v)
}

export function isWeeklyItemKind(v: unknown): v is WeeklyItemKind {
  return typeof v === 'string' && (WEEKLY_ITEM_KINDS as readonly string[]).includes(v)
}

export function isWeeklyItemStatus(v: unknown): v is WeeklyItemStatus {
  return typeof v === 'string' && (WEEKLY_ITEM_STATUSES as readonly string[]).includes(v)
}

/** 화면 표시용 파생 상태 — completedWeek 있으면 '완료' */
export function weeklyDisplayStatus(item: { status: string; completedWeek: string | null }): '진행' | '보류' | '완료' {
  if (item.completedWeek) return '완료'
  return item.status === '보류' ? '보류' : '진행'
}

// ── 주차 유틸 ────────────────────────────────────────────────
// DATE 컬럼(week_start·completed_week·target_date)의 쓰기·비교는 UTC 자정 파스
// new Date('YYYY-MM-DD') — 기존 @db.Date 관례. created_at(UTC TIMESTAMP) 경계 비교만
// KST 자정 인스턴트(kstMidnight)와 비교한다 (설계 §7 시간대 파스 규칙).

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

export function isYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !YMD_RE.test(s)) return false
  const d = new Date(s)
  // '2026-02-31' 같은 무효 일자는 V8이 3/3으로 롤오버 파싱하므로 왕복 비교로 거부
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** 주차 파라미터 검증 — YYYY-MM-DD이면서 월요일(getUTCDay===1)인지 */
export function isMondayYmd(s: unknown): s is string {
  return isYmd(s) && new Date(s).getUTCDay() === 1
}

/** YMD 문자열에 일수 더하기 (UTC 날짜 산술 — 타임존 무관) */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(ymd)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 해당 YMD의 KST 자정 인스턴트 — created_at 경계 비교 전용 */
export function kstMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`)
}

/** KST 기준 오늘이 속한 주의 월요일 YMD — 완료 주차 상한(미래 주 완료 차단) 검증용 */
export function currentMondayKstYmd(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  const dow = kst.getUTCDay()
  kst.setUTCDate(kst.getUTCDate() - (dow === 0 ? 6 : dow - 1))
  return kst.toISOString().slice(0, 10)
}

/** 로컬 기준(브라우저 KST 가정 — 차량예약 mondayOf 선례) 해당 주 월요일 00:00 */
export function mondayOfLocal(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  out.setDate(out.getDate() - (day === 0 ? 6 : day - 1))
  return out
}

/** 로컬 날짜 → YYYY-MM-DD (toISOString은 UTC 변환이라 자정 부근 하루 밀림 — 로컬 성분으로 조립) */
export function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 주차 라벨 — "8/17주" (지난주 진행 컬럼의 주차 병기용) */
export function weekLabel(ymd: string): string {
  const d = new Date(ymd)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}주`
}

// ── API 응답 DTO (라우트·페이지 공용 계약) ──────────────────────

export interface WeeklyUpdateDto {
  weekStart: string // YYYY-MM-DD
  content: string
  updatedByName: string | null
  updatedAt: string
}

export interface WeeklyItemDto {
  id: number
  kind: WeeklyItemKind
  title: string
  detail: string | null
  status: string // '진행' | '보류'
  bizType: string // 'thynC' | 'mobiCARE' | '공통'
  hospitalCode: string | null
  hospitalName: string | null
  ownerTeamId: number | null
  ownerTeamName: string | null
  ownerId: string | null
  ownerName: string | null
  targetDate: string | null // YYYY-MM-DD
  completedWeek: string | null // YYYY-MM-DD — NULL이면 미완료
  completedAt: string | null
  sortOrder: number
  createdAt: string
  /** board 전용 — 선택 주차의 update */
  thisWeek: WeeklyUpdateDto | null
  /** board 전용 — 선택 주차 이전의 최근 update */
  lastWeek: WeeklyUpdateDto | null
  /** archive·hospital 스코프 전용 — 가장 최근 update */
  latestUpdate: WeeklyUpdateDto | null
}

/** 주간 특이사항 엔트리 — 주차별 N건 자유 기재 (엄격한 관리 항목이 아닌 '그 주에 말할 컨텐츠') */
export interface WeeklyNoteDto {
  id: number
  weekStart: string // YYYY-MM-DD
  content: string
  createdByName: string | null
  /** 작성자 소속팀(departments) — 표시 전용 (2026-08-20) */
  createdByTeamName: string | null
  updatedByName: string | null
  createdAt: string
  updatedAt: string
}

export interface WeeklyBoardResponse {
  week: string
  items: WeeklyItemDto[]
  weekNotes: WeeklyNoteDto[]
}

export interface WeeklyItemDetailDto extends Omit<WeeklyItemDto, 'thisWeek' | 'lastWeek' | 'latestUpdate'> {
  createdByName: string | null
  updates: WeeklyUpdateDto[] // weekStart 역순 전체
}

export interface WeeklyMastersResponse {
  hospitals: { hospitalCode: string; hospitalName: string }[]
  users: { id: string; name: string }[]
  teams: { id: number; name: string }[] // SEERS 부서 (담당 팀 select)
}
