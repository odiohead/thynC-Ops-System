// 기타업무(EtcTask) 공통 헬퍼
// 업무기간 항목(EtcTaskVisit)은 유지보수 방문일정과 동일 구조 — normalizeVisits/ymd/visitKey는 lib/maintenanceVisit 공유

/** 업무기간 항목 1건에 대응하는 Google Calendar 이벤트 페이로드 생성 */
export function etcTaskVisitEventPayload(opts: {
  title: string
  etcTaskCode: string | null
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  attendeeEmails: string[]
}) {
  const range = opts.startDate === opts.endDate ? opts.startDate : `${opts.startDate} ~ ${opts.endDate}`
  return {
    summary: `[기타업무] ${opts.title}`,
    description: `기타업무 코드: ${opts.etcTaskCode ?? ''}\n업무기간: ${range}`,
    startDate: new Date(opts.startDate),
    endDate: new Date(opts.endDate),
    attendeeEmails: opts.attendeeEmails,
  }
}
