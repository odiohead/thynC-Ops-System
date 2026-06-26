// 유지보수 방문일정(MaintenanceVisit) 공통 헬퍼
// 각 방문 항목은 단일일(start=end) 또는 기간(start~end). 항목별 Google Calendar 이벤트와 매핑된다.

export interface NormalizedVisit {
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD (>= startDate)
  sortOrder: number
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** 날짜(@db.Date) → YYYY-MM-DD 문자열 (UTC 자정 저장값 기준) */
export function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** 방문 항목 고유키 (시작_종료) */
export function visitKey(startDate: string, endDate: string): string {
  return `${startDate}_${endDate}`
}

/**
 * 클라이언트 입력 visits 배열을 정규화한다.
 * - startDate가 유효(YYYY-MM-DD)한 항목만 채택
 * - endDate 비면 startDate로 (단일일), 역전 시 단일일로 교정
 * - 동일 (시작,종료) 중복 제거, 시작일 오름차순 정렬 후 sortOrder 부여
 */
export function normalizeVisits(input: unknown): NormalizedVisit[] {
  if (!Array.isArray(input)) return []
  const out: NormalizedVisit[] = []
  const seen = new Set<string>()
  for (const v of input) {
    const raw = v as { startDate?: unknown; endDate?: unknown }
    const start = typeof raw?.startDate === 'string' ? raw.startDate.slice(0, 10) : ''
    if (!YMD.test(start)) continue
    let end = typeof raw?.endDate === 'string' && raw.endDate ? raw.endDate.slice(0, 10) : start
    if (!YMD.test(end) || end < start) end = start
    const key = visitKey(start, end)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ startDate: start, endDate: end, sortOrder: 0 })
  }
  out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))
  out.forEach((v, i) => { v.sortOrder = i })
  return out
}

/** 방문 항목 1건에 대응하는 Google Calendar 이벤트 페이로드 생성 */
export function visitEventPayload(opts: {
  hospitalName: string
  title: string
  maintenanceCode: string | null
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  attendeeEmails: string[]
}) {
  const range = opts.startDate === opts.endDate ? opts.startDate : `${opts.startDate} ~ ${opts.endDate}`
  return {
    summary: `[유지보수] ${opts.hospitalName} - ${opts.title}`,
    description: `유지보수 코드: ${opts.maintenanceCode ?? ''}\n방문일정: ${range}`,
    startDate: new Date(opts.startDate),
    endDate: new Date(opts.endDate),
    attendeeEmails: opts.attendeeEmails,
  }
}
