/**
 * 병원 운영 이력 보고서 — 수집 스냅샷(facts)·AI 결과 타입 (projects/hospital_report_design.md §6·§7)
 * facts는 report_runs.facts(JSONB)에 그대로 저장되므로 날짜는 'YYYY-MM-DD' 문자열, 숫자는 number만 쓴다.
 */

export interface KindCount {
  spo2: number
  ecg: number
  other: number
}

export interface HospitalReportFacts {
  version: 1
  asOf: string // ISO (생성 시각)
  hospital: {
    code: string
    name: string
    type: string | null
    address: string | null
    status: string | null
    introType: string | null
    introBeds: number | null
    contractDate: string | null
    asMemo: string | null
    asMemoUpdatedAt: string | null
    tags: { name: string; description: string | null; assignedAt: string | null }[]
    hasRemoteAccess: boolean
    serverCount: number
    emrCount: number
    /** 이하 2026-11-08 추가 — 이전 실행분 facts에는 없음 */
    daewoongClientCode?: string | null
    contacts?: { name: string; department: string | null; title: string | null; note: string | null }[]
  }
  deals: {
    code: string
    roundNo: number | null
    status: string | null
    contractDate: string | null
    wardCount: number | null
    bedCount: number | null
    wardsText: string | null
    productType: string | null
    projectCode: string | null
    devices: { name: string; qty: number }[]
    amountTotal: number | null
    amountProduct: number | null
    amountConstruction: number | null
    amountActual: number | null
    taxInvoice: string | null
    settlement: string | null
    daewoongOffice: string | null
    daewoongDivision: string | null
    daewoongManager: string | null
    remark: string | null
  }[]
  projects: {
    code: string
    name: string
    buildStatus: string | null
    constructor: string | null
    contractType: string | null
    wardCount: number | null
    bedCount: number | null
    gatewayCount: number | null
    startDate: string | null
    endDateExpected: string | null
    educationDate: string | null
    assigneeCount: number
  }[]
  devices: {
    contracted: KindCount // 계약완료 딜 도입 기기 합
    active: KindCount
    activeTotal: number
    noWard: number
    wards: { name: string; spo2: number; ecg: number; other: number }[]
    firstPlacedOn: string | null
  }
  as: {
    receipts: {
      code: string
      receiptDate: string
      status: string | null
      category: string | null
      source: string | null
      resolvedAt: string | null
      leadDays: number | null
      lines: number
      kind: KindCount
      outcome: { replace: number; repairReturn: number; canceled: number; undecided: number }
      pickedUpAt: string | null
      receivedAt: string | null
      repaired: number
      noFault: number
    }[]
    quarters: { label: string; receipts: number; kind: KindCount; total: number }[]
    totals: { receipts: number; lines: number; kind: KindCount; done: number; open: number }
    peakMonth: { month: string; receipts: number; lines: number } | null
    lead: { median: number | null; avg: number | null; longest: { code: string; days: number }[] }
    outcome: { replace: number; repairReturn: number; canceled: number; undecided: number; undecidedInDone: number }
    repeat: { distinctSerials: number; repeatedSerials: number; dist: { times: number; serials: number }[]; top: { serial: string; times: number }[] }
    distinctByKind: KindCount
    wardMissing: number
    repair: { judged: number; repaired: number; noFault: number; byKind: { kind: string; repaired: number; noFault: number }[]; findings: { label: string; count: number }[] }
    otherHospitalSerials: { asCode: string; serial: string; hospitalName: string }[]
  }
  voc: {
    total: number
    firstAt: string | null
    lastAt: string | null
    byStatus: { status: string; count: number }[]
    bySource: { source: string; count: number }[]
    byQuarter: { label: string; count: number }[]
    byGroup: { group: string; count: number; subs: { name: string; count: number }[] }[]
    unresolved: { code: string; receivedAt: string; status: string; title: string }[]
    items: VocItem[]
  }
  chats: { id: string; openedAt: string | null; tags: string[]; summary: string | null; firstAsk: string | null }[]
  maintenances: {
    code: string
    title: string
    status: string | null
    type: string | null
    reporter: string | null
    reportedAt: string | null
    visitDate: string | null
    resolvedAt: string | null
    symptoms: string | null
    resolution: string | null
    notes: string | null
  }[]
  etcTasks: { code: string; title: string; status: string | null; reportedAt: string | null; resolvedAt: string | null; note: string | null }[]
  tickets: { refType: string; status: string; count: number }[]
  timeline: { date: string; kind: string; text: string }[]
  checks: { key: string; label: string; level: 'ok' | 'warn'; detail: string; impact: string }[]
  sourceCounts: { label: string; count: number }[]
}

export interface VocItem {
  code: string
  receivedAt: string
  type: string | null
  status: string | null
  source: string | null
  title: string
  content: string
  resolution: string
}

/** AI 출력 (구조화 출력 스키마와 1:1 — 서버 검증 후 저장) — 레포트 구성 2차(2026-11-08) 기준 */
export interface HospitalReportAi {
  /** 상단 요약 — 문단 사이 줄바꿈 */
  summary: string
  /** VOC 대분류별 '확인된 내용' (분류별 현황 표) */
  groupNotes?: { group: string; note: string }[]
  themes: { name: string; vocCodes: string[]; insight: string }[]
  /** vocCodes[0]이 대표, 접수일은 vocCodes 범위로 다시 계산 (구 실행분은 vocCode 단일) */
  keyIssues: { vocCodes?: string[]; vocCode?: string; issue: string; ask?: string; action: string }[]
  /** AS 운영 프로세스 한 줄 (근거 없으면 빈 문자열) */
  asProcess?: string
  /** 시사점 (구 실행분은 risks + recommendations) */
  insights?: { title: string; detail: string }[]
  risks?: string[]
  recommendations?: { title: string; detail: string }[]
  /** 서버 검증 메모 (AI가 만든 값 아님) */
  warnings: string[]
  truncatedVoc: number
}
