import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { findHospitalNotePage } from '@/lib/wiki/hospitalNote'
import { getAiExcludedPageIds, isPageAiExcluded } from '@/lib/wiki/aiExclusion'

/**
 * AI 어시스턴트 도구 레이어 (function_ai_assistant.html §5)
 * - 전부 read-only (Prisma SELECT 전용, mutation 금지)
 * - 반환은 토큰 절약을 위해 필요 필드만 요약 직렬화 (row 상한 명시)
 * - description에 "언제 호출하라"는 트리거 조건 명시 (should-call 품질에 직결)
 */

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/** Tiptap HTML 필드 → 태그 제거 + 길이 절단 */
function stripHtml(html: string | null | undefined, maxLen: number): string | null {
  if (!html) return null
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

// ===== 도구 정의 (Anthropic tool schema) =====

/**
 * 목록 도구 5종 공통 파라미터 — 응답 토큰 제어
 * 기본을 요약·소량으로 두고, 상세가 실제로 필요할 때만 모델이 올려 부르게 한다.
 */
const LIST_PARAMS = {
  limit: {
    type: 'number',
    description: '반환 건수 (기본 10, 최대 30). 건수만 필요한 질문이면 응답의 total을 쓰고 늘리지 마라.',
  },
  detail: {
    type: 'string',
    enum: ['summary', 'full'],
    description:
      "기본 'summary'(핵심 필드만). 증상·조치 내용·비고 등 본문이 실제로 필요할 때만 'full'로 재호출하라.",
  },
} as const

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_hospitals',
    description:
      '병원명으로 운영 병원을 검색한다. 병원명이 부정확하거나 병원 코드(hospitalCode)가 필요할 때 먼저 호출하라. 다른 도구의 hospitalCode 파라미터는 이 도구로 얻는다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '병원명 일부 (예: "부산", "삼성")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_hospital_overview',
    description:
      '특정 병원의 현황을 조회한다. 병원의 상태·도입형태·병상·계약일·담당자·설치 장비 구성·업무 건수 요약이 필요할 때 호출하라.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalCode: { type: 'string', description: '병원 코드 (search_hospitals로 조회)' },
      },
      required: ['hospitalCode'],
    },
  },
  {
    name: 'list_projects',
    description:
      '구축 공사 프로젝트 목록을 조회한다. 공사 진행 상황, 계약, 구축 일정, 병상 규모 질문 시 호출하라. 기간 필터는 구축 시작일 기준. 특정 병원 것만 보려면 hospitalCode를 지정하라.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalCode: { type: 'string', description: '병원 코드 (선택)' },
        buildStatusName: { type: 'string', description: "공사 상태명 필터 (예: '진행중', '구축완료') (선택)" },
        from: { type: 'string', description: '구축 시작일 범위 시작 YYYY-MM-DD (선택)' },
        to: { type: 'string', description: '구축 시작일 범위 끝 YYYY-MM-DD (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'list_maintenances',
    description:
      '유지보수(장애 처리) 목록을 조회한다. 장애 이력, 유지보수 건수, 증상·조치 내용, 방문 일정 질문 시 호출하라. 기간 필터는 접수일 기준. 특정 병원 것만 보려면 hospitalCode를 지정하라.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalCode: { type: 'string', description: '병원 코드 (선택)' },
        statusName: { type: 'string', description: "상태명 필터 (예: '접수', '처리중', '완료') (선택)" },
        priority: { type: 'string', description: '우선순위 필터: 긴급|높음|보통|낮음 (선택)' },
        from: { type: 'string', description: '접수일 범위 시작 YYYY-MM-DD (선택)' },
        to: { type: 'string', description: '접수일 범위 끝 YYYY-MM-DD (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'list_site_visits',
    description:
      '답사(병원 현장 방문) 목록을 조회한다. 답사 일정·상태·회신 현황 질문 시 호출하라. 기간 필터는 요청일 기준.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalCode: { type: 'string', description: '병원 코드 (선택)' },
        statusName: { type: 'string', description: "상태명 필터 (예: '접수', '답사예정', '작성완료', '회신완료') (선택)" },
        from: { type: 'string', description: '요청일 범위 시작 YYYY-MM-DD (선택)' },
        to: { type: 'string', description: '요청일 범위 끝 YYYY-MM-DD (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'list_install_plans',
    description:
      '설치계획(가안) 목록을 조회한다. 설치계획 작성·회신 진행 상황 질문 시 호출하라. 기간 필터는 요청일 기준.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalCode: { type: 'string', description: '병원 코드 (선택)' },
        writeStatus: { type: 'string', description: "작성완료여부 필터: '완료'|'미완료' (선택)" },
        replyStatus: { type: 'string', description: "회신여부 필터: '완료'|'미완료' (선택)" },
        from: { type: 'string', description: '요청일 범위 시작 YYYY-MM-DD (선택)' },
        to: { type: 'string', description: '요청일 범위 끝 YYYY-MM-DD (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'list_etc_tasks',
    description:
      '기타업무(다병원 점검 등 유지보수가 아닌 업무) 목록을 조회한다. 기타업무 현황 질문 시 호출하라. 기간 필터는 접수일 기준.',
    input_schema: {
      type: 'object',
      properties: {
        statusName: { type: 'string', description: '상태명 필터 (선택)' },
        priority: { type: 'string', description: '우선순위 필터: 긴급|높음|보통|낮음 (선택)' },
        from: { type: 'string', description: '접수일 범위 시작 YYYY-MM-DD (선택)' },
        to: { type: 'string', description: '접수일 범위 끝 YYYY-MM-DD (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'get_dashboard_summary',
    description:
      '전사 현황 요약을 조회한다. 전체 도입 병원 수·도입 병상 합계·이번주/다음주 공사 일정·진행중 유지보수 건수 같은 회사 전체 현황 질문 시 호출하라.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'aggregate_stats',
    description:
      '기간 기준 집계를 조회한다. "이번주 신규 계약", "이번달 완료된 구축과 추가 병상", "이번달 유지보수 건수", "이번달 답사 건수", "신규 계약 병원" 같은 기간·건수 집계 질문 시 반드시 이 도구를 사용하라. metric: new_contracts(계약일 기준 신규 계약 프로젝트+병상합) | completed_builds(완료 상태 진입 프로젝트+병상합) | maintenance_count(접수일 기준 유지보수, 우선순위·상태·유형·병원별 분해) | site_visit_count(요청일 기준 답사, 상태별 분해) | new_hospitals(최초 계약일 기준 신규 병원)',
    input_schema: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['new_contracts', 'completed_builds', 'maintenance_count', 'site_visit_count', 'new_hospitals'],
          description: '집계 지표',
        },
        from: { type: 'string', description: '기간 시작 YYYY-MM-DD (필수)' },
        to: { type: 'string', description: '기간 끝 YYYY-MM-DD (필수)' },
        hospitalCode: { type: 'string', description: '특정 병원으로 한정 (선택)' },
      },
      required: ['metric', 'from', 'to'],
    },
  },
  {
    name: 'search_wiki',
    description:
      '사내위키를 검색한다. thynC 제품 기능·알람 기준·장애 조치 방법·매뉴얼·업무 노하우·사내 문서(기능정의서 등) 질문 시 호출하라. 검색어의 각 단어가 모두 포함된 페이지를 관련도순으로 반환하며, 결과에는 카테고리 경로(path)가 함께 온다. 읽을 문서를 판단한 뒤 그 pageId로 read_wiki_page를 호출하라.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색어 (핵심 키워드 1~3개, 예: "알람 기준", "게이트웨이 오프라인"). 조사·어미는 빼고 명사 위주로 넣어라.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_wiki_page',
    description:
      'search_wiki 결과 중 특정 페이지의 본문을 읽는다. 긴 문서는 잘려서 오며(truncated=true), 이어 읽으려면 응답의 nextOffset을 offset으로 넣어 다시 호출하라.',
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: '위키 페이지 id (search_wiki 결과의 pageId)' },
        offset: { type: 'number', description: '읽기 시작 위치(문자 수, 기본 0). 이어 읽을 때 직전 응답의 nextOffset을 넣어라.' },
        maxChars: { type: 'number', description: '한 번에 읽을 문자 수 (기본 6000, 최대 12000)' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'read_hospital_note',
    description:
      '특정 병원의 병원 노트(과거 상담이력·특이사항이 축적된 위키 페이지)를 읽는다. "이 병원 지난번 문의", "과거 상담이력", "병원 특이사항" 질문이나 CS 응대 시 해당 병원 맥락이 필요할 때 호출하라.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalCode: { type: 'string', description: '병원 코드 (search_hospitals로 조회)' },
      },
      required: ['hospitalCode'],
    },
  },
]

/** 도구별 한국어 진행 표시 라벨 */
export const TOOL_LABELS: Record<string, string> = {
  search_hospitals: '병원 검색 중',
  get_hospital_overview: '병원 현황 조회 중',
  list_projects: '프로젝트 조회 중',
  list_maintenances: '유지보수 조회 중',
  list_site_visits: '답사 조회 중',
  list_install_plans: '설치계획 조회 중',
  list_etc_tasks: '기타업무 조회 중',
  get_dashboard_summary: '전사 현황 조회 중',
  aggregate_stats: '집계 중',
  search_wiki: '위키 검색 중',
  read_wiki_page: '위키 문서 읽는 중',
  read_hospital_note: '병원 노트 확인 중',
}

// ===== 실행기 =====

type ToolInput = Record<string, unknown>

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function int(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(Math.trunc(n), min), max)
}

/** 목록 도구 반환 건수 — 기본 10, 최대 30 */
const listLimit = (input: ToolInput) => int(input.limit, 10, 1, 30)
/** 상세 모드 여부 — 기본은 요약(핵심 필드만) */
const isFull = (input: ToolInput) => str(input.detail) === 'full'

/** 목록 응답 공통 메타 — total을 항상 주어 "몇 건인가"를 재조회 없이 답하게 한다 */
function listMeta(shown: number, total: number) {
  return {
    count: shown,
    total,
    note:
      total > shown
        ? `전체 ${total}건 중 ${shown}건 표시 (더 필요하면 limit을 올리거나 필터를 좁혀 재조회)`
        : undefined,
  }
}

function dateRange(input: ToolInput, field: string) {
  const from = str(input.from)
  const to = str(input.to)
  if (!from && !to) return undefined
  const cond: { gte?: Date; lte?: Date } = {}
  if (from) cond.gte = new Date(from + 'T00:00:00+09:00')
  if (to) cond.lte = new Date(to + 'T23:59:59+09:00')
  return { [field]: cond }
}

async function searchHospitals(input: ToolInput) {
  const query = str(input.query)
  if (!query) return { error: 'query가 필요합니다.' }
  const found = await prisma.hospital.findMany({
    where: {
      OR: [
        { hospitalName: { contains: query, mode: 'insensitive' } },
        { hiraHospitalName: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 100,
    select: {
      hospitalCode: true,
      hospitalName: true,
      status: true,
      sidoName: true,
      sigunguName: true,
      introBeds: true,
    },
  })
  // 랭킹: 운영·계약 병원 우선 → 도입 병상 보유 우선 → 이름 짧은 순 (의원급 대량 매칭에 실병원이 묻히지 않게)
  const statusRank = (s: string) => (s === '운영' ? 0 : s === '계약완료' ? 1 : 2)
  const rows = found
    .sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) ||
        (b.introBeds ? 1 : 0) - (a.introBeds ? 1 : 0) ||
        a.hospitalName.length - b.hospitalName.length,
    )
    .slice(0, 20)
  return {
    count: rows.length,
    totalMatched: found.length,
    note: found.length > rows.length ? `전체 ${found.length}건 중 상위 20건 (운영·계약 병원 우선 정렬)` : undefined,
    hospitals: rows.map((h) => ({
      hospitalCode: h.hospitalCode,
      name: h.hospitalName,
      status: h.status,
      region: [h.sidoName, h.sigunguName].filter(Boolean).join(' ') || null,
      introBeds: h.introBeds,
    })),
  }
}

async function getHospitalOverview(input: ToolInput) {
  const code = str(input.hospitalCode)
  if (!code) return { error: 'hospitalCode가 필요합니다.' }
  const h = await prisma.hospital.findUnique({
    where: { hospitalCode: code },
    include: {
      introTypes: { include: { statusCode: { select: { name: true } } } },
      daewoongAssignments: { include: { assignedUser: { select: { name: true } } } },
      hospitalDevices: { include: { deviceInfo: { select: { deviceName: true, deviceModel: true } } } },
      _count: {
        select: { projects: true, maintenances: true, siteVisits: true, installPlans: true },
      },
    },
  })
  if (!h) return { error: `병원(${code})을 찾을 수 없습니다.` }
  return {
    hospitalCode: h.hospitalCode,
    name: h.hospitalName,
    hiraName: h.hiraHospitalName,
    type: h.type,
    status: h.status,
    region: [h.sidoName, h.sigunguName].filter(Boolean).join(' ') || null,
    address: h.address,
    introTypes: h.introTypes.map((t) => t.statusCode.name),
    introBeds: h.introBeds,
    contractDate: ymd(h.contractDate),
    daewoongStaff: h.daewoongAssignments.map((a) => a.assignedUser.name),
    devices: h.hospitalDevices
      .map((d) => (d.deviceInfo ? `${d.deviceInfo.deviceName}(${d.deviceInfo.deviceModel}) x${d.quantity}` : null))
      .filter(Boolean),
    workCounts: {
      projects: h._count.projects,
      maintenances: h._count.maintenances,
      siteVisits: h._count.siteVisits,
      installPlans: h._count.installPlans,
    },
  }
}

async function listProjects(input: ToolInput) {
  const where = {
    ...(str(input.hospitalCode) && { hospitalCode: str(input.hospitalCode) }),
    ...(str(input.buildStatusName) && {
      buildStatus: { label: { contains: str(input.buildStatusName)! } },
    }),
    ...dateRange(input, 'startDate'),
  }
  const full = isFull(input)
  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      take: listLimit(input),
      orderBy: [{ startDate: { sort: 'desc', nulls: 'first' } }],
      include: {
        hospital: { select: { hospitalName: true } },
        buildStatus: { select: { label: true } },
        contractor: { select: { name: true } },
        assignees: { include: { user: { select: { name: true } } } },
      },
    }),
  ])
  return {
    ...listMeta(rows.length, total),
    projects: rows.map((p) => ({
      projectCode: p.projectCode,
      name: p.projectName,
      hospital: p.hospital.hospitalName,
      buildStatus: p.buildStatus?.label ?? null,
      startDate: ymd(p.startDate),
      endDateExpected: ymd(p.endDateExpected),
      bedCount: p.bedCount,
      assignees: p.assignees.map((a) => a.user.name),
      ...(full && {
        contractDate: ymd(p.contractDate),
        wardCount: p.wardCount,
        gatewayCount: p.gatewayCount,
        constructor: p.contractor?.name ?? p.builderNameManual ?? null,
        remark: stripHtml(p.remark, 120),
      }),
    })),
  }
}

async function listMaintenances(input: ToolInput) {
  const where = {
    ...(str(input.hospitalCode) && { hospitalCode: str(input.hospitalCode) }),
    ...(str(input.statusName) && { status: { name: { contains: str(input.statusName)! } } }),
    ...(str(input.priority) && { priority: str(input.priority) }),
    ...dateRange(input, 'reportedAt'),
  }
  const full = isFull(input)
  const [total, rows] = await Promise.all([
    prisma.maintenance.count({ where }),
    prisma.maintenance.findMany({
      where,
      take: listLimit(input),
      orderBy: { reportedAt: 'desc' },
      include: {
        hospital: { select: { hospitalName: true } },
        type: { select: { name: true } },
        status: { select: { name: true } },
        assignees: { include: { user: { select: { name: true } } } },
        visits: { orderBy: { startDate: 'asc' }, select: { startDate: true, endDate: true } },
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { content: true, createdAt: true, author: { select: { name: true } } },
        },
      },
    }),
  ])
  return {
    ...listMeta(rows.length, total),
    maintenances: rows.map((m) => ({
      maintenanceCode: m.maintenanceCode,
      hospital: m.hospital.hospitalName,
      title: m.title,
      type: m.type?.name ?? null,
      status: m.status?.name ?? null,
      priority: m.priority,
      reportedAt: ymd(m.reportedAt),
      resolvedAt: ymd(m.resolvedAt),
      assignees: m.assignees.map((a) => a.user.name),
      ...(full && {
        isRemote: m.isRemote,
        symptoms: stripHtml(m.symptoms, 200),
        resolution: stripHtml(m.resolution, 300),
        recentLogs: m.logs.map(
          (l) => `${ymd(l.createdAt)} ${l.author?.name ?? '미상'}: ${stripHtml(l.content, 150)}`,
        ),
        visits: m.visits.map((v) =>
          ymd(v.startDate) === ymd(v.endDate) ? ymd(v.startDate) : `${ymd(v.startDate)}~${ymd(v.endDate)}`,
        ),
      }),
    })),
  }
}

async function listSiteVisits(input: ToolInput) {
  const where = {
    ...(str(input.hospitalCode) && { hospitalCode: str(input.hospitalCode) }),
    ...(str(input.statusName) && { status: { name: { contains: str(input.statusName)! } } }),
    ...dateRange(input, 'requestDate'),
  }
  const full = isFull(input)
  const [total, rows] = await Promise.all([
    prisma.siteVisit.count({ where }),
    prisma.siteVisit.findMany({
      where,
      take: listLimit(input),
      orderBy: { requestDate: 'desc' },
      include: {
        hospital: { select: { hospitalName: true } },
        status: { select: { name: true } },
        daewoongUser: { select: { name: true } },
        assignees: { include: { user: { select: { name: true } } } },
      },
    }),
  ])
  return {
    ...listMeta(rows.length, total),
    siteVisits: rows.map((v) => ({
      siteVisitCode: v.siteVisitCode,
      hospital: v.hospital.hospitalName,
      status: v.status?.name ?? null,
      requestDate: ymd(v.requestDate),
      visitDate: ymd(v.visitDate),
      replyDate: ymd(v.replyDate),
      assignees: v.assignees.map((a) => a.user.name),
      ...(full && {
        daewoongStaff: v.daewoongUser?.name ?? null,
        notes: stripHtml(v.notes, 150),
      }),
    })),
  }
}

async function listInstallPlans(input: ToolInput) {
  const where = {
    ...(str(input.hospitalCode) && { hospitalCode: str(input.hospitalCode) }),
    ...(str(input.writeStatus) && { writeStatus: str(input.writeStatus) }),
    ...(str(input.replyStatus) && { replyStatus: str(input.replyStatus) }),
    ...dateRange(input, 'requestDate'),
  }
  const full = isFull(input)
  const [total, rows] = await Promise.all([
    prisma.installPlan.count({ where }),
    prisma.installPlan.findMany({
      where,
      take: listLimit(input),
      orderBy: { requestDate: 'desc' },
      include: {
        hospital: { select: { hospitalName: true } },
        assignees: { include: { user: { select: { name: true } } } },
      },
    }),
  ])
  return {
    ...listMeta(rows.length, total),
    installPlans: rows.map((p) => ({
      planCode: p.planCode,
      hospital: p.hospital?.hospitalName ?? null,
      requestDate: ymd(p.requestDate),
      replyDate: ymd(p.replyDate),
      writeStatus: p.writeStatus,
      replyStatus: p.replyStatus,
      ...(full && {
        assignees: p.assignees.map((a) => a.user.name),
        note: stripHtml(p.note, 150),
      }),
    })),
  }
}

async function listEtcTasks(input: ToolInput) {
  const where = {
    ...(str(input.statusName) && { status: { name: { contains: str(input.statusName)! } } }),
    ...(str(input.priority) && { priority: str(input.priority) }),
    ...dateRange(input, 'reportedAt'),
  }
  const full = isFull(input)
  const [total, rows] = await Promise.all([
    prisma.etcTask.count({ where }),
    prisma.etcTask.findMany({
      where,
      take: listLimit(input),
      orderBy: { reportedAt: 'desc' },
      include: {
        status: { select: { name: true } },
        assignees: { include: { user: { select: { name: true } } } },
        hospitals: { include: { hospital: { select: { hospitalName: true } } } },
        visits: { orderBy: { startDate: 'asc' }, select: { startDate: true, endDate: true } },
      },
    }),
  ])
  return {
    ...listMeta(rows.length, total),
    etcTasks: rows.map((t) => ({
      etcTaskCode: t.etcTaskCode,
      title: t.title,
      status: t.status?.name ?? null,
      priority: t.priority,
      reportedAt: ymd(t.reportedAt),
      resolvedAt: ymd(t.resolvedAt),
      ...(full && {
        hospitals: t.hospitals.map((h) => h.hospital.hospitalName),
        assignees: t.assignees.map((a) => a.user.name),
        periods: t.visits.map((v) =>
          ymd(v.startDate) === ymd(v.endDate) ? ymd(v.startDate) : `${ymd(v.startDate)}~${ymd(v.endDate)}`,
        ),
      }),
    })),
  }
}

/** KST 기준 이번주 월요일 00:00 Date */
function kstWeekStart(offsetWeeks = 0): Date {
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000)
  const day = nowKst.getUTCDay() || 7 // 월=1..일=7
  const monday = new Date(nowKst)
  monday.setUTCDate(nowKst.getUTCDate() - (day - 1) + offsetWeeks * 7)
  monday.setUTCHours(0, 0, 0, 0)
  return new Date(monday.getTime() - 9 * 3600 * 1000)
}

async function getDashboardSummary() {
  const weekStart = kstWeekStart(0)
  const nextWeekStart = kstWeekStart(1)
  const weekAfterNext = kstWeekStart(2)

  const [operatingCount, bedSum, doneStatuses, maintenanceOpen, thisWeek, nextWeek] =
    await Promise.all([
      prisma.hospital.count({ where: { status: '운영' } }),
      prisma.hospital.aggregate({ where: { status: '운영' }, _sum: { introBeds: true } }),
      prisma.buildStatus.findMany({ where: { label: { contains: '완료' } }, select: { id: true } }),
      prisma.maintenance.count({ where: { NOT: { status: { name: { contains: '완료' } } } } }),
      prisma.project.findMany({
        where: { startDate: { lt: nextWeekStart }, endDateExpected: { gte: weekStart } },
        include: { hospital: { select: { hospitalName: true } }, buildStatus: { select: { label: true } } },
        take: 20,
      }),
      prisma.project.findMany({
        where: { startDate: { lt: weekAfterNext, gte: nextWeekStart } },
        include: { hospital: { select: { hospitalName: true } }, buildStatus: { select: { label: true } } },
        take: 20,
      }),
    ])

  const doneIds = new Set(doneStatuses.map((s) => s.id))
  const fmt = (p: {
    projectName: string
    hospital: { hospitalName: string }
    buildStatus: { label: string } | null
    startDate: Date | null
    endDateExpected: Date | null
    bedCount: number | null
    buildStatusId: number | null
  }) => ({
    name: p.projectName,
    hospital: p.hospital.hospitalName,
    status: p.buildStatus?.label ?? null,
    period: `${ymd(p.startDate)}~${ymd(p.endDateExpected)}`,
    bedCount: p.bedCount,
  })
  return {
    asOf: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
    operatingHospitals: operatingCount,
    totalIntroBeds: bedSum._sum.introBeds ?? 0,
    maintenanceInProgress: maintenanceOpen,
    thisWeekBuilds: thisWeek.filter((p) => !p.buildStatusId || !doneIds.has(p.buildStatusId)).map(fmt),
    nextWeekBuilds: nextWeek.map(fmt),
  }
}

async function aggregateStats(input: ToolInput) {
  const metric = str(input.metric)
  const from = str(input.from)
  const to = str(input.to)
  if (!metric || !from || !to) return { error: 'metric, from, to가 필요합니다.' }
  const range = { gte: new Date(from + 'T00:00:00+09:00'), lte: new Date(to + 'T23:59:59+09:00') }
  const hospitalCode = str(input.hospitalCode)

  if (metric === 'new_contracts') {
    const rows = await prisma.project.findMany({
      where: { contractDate: range, ...(hospitalCode && { hospitalCode }) },
      include: { hospital: { select: { hospitalName: true } } },
      orderBy: { contractDate: 'asc' },
    })
    return {
      metric, from, to,
      count: rows.length,
      bedSum: rows.reduce((s, p) => s + (p.bedCount ?? 0), 0),
      items: rows.slice(0, 30).map((p) => ({
        projectCode: p.projectCode, name: p.projectName, hospital: p.hospital.hospitalName,
        contractDate: ymd(p.contractDate), bedCount: p.bedCount,
      })),
    }
  }
  if (metric === 'completed_builds') {
    const rows = await prisma.project.findMany({
      where: {
        buildStatus: { label: { contains: '완료' } },
        statusChangedAt: range,
        ...(hospitalCode && { hospitalCode }),
      },
      include: { hospital: { select: { hospitalName: true } }, buildStatus: { select: { label: true } } },
      orderBy: { statusChangedAt: 'asc' },
    })
    return {
      metric, from, to,
      note: '완료 상태 진입 시각(status_changed_at) 기준',
      count: rows.length,
      bedSum: rows.reduce((s, p) => s + (p.bedCount ?? 0), 0),
      items: rows.slice(0, 30).map((p) => ({
        projectCode: p.projectCode, name: p.projectName, hospital: p.hospital.hospitalName,
        completedAt: ymd(p.statusChangedAt), bedCount: p.bedCount,
      })),
    }
  }
  if (metric === 'maintenance_count') {
    const rows = await prisma.maintenance.findMany({
      where: { reportedAt: range, ...(hospitalCode && { hospitalCode }) },
      include: {
        hospital: { select: { hospitalName: true } },
        type: { select: { name: true } },
        status: { select: { name: true } },
      },
    })
    const tally = (keyFn: (m: (typeof rows)[number]) => string) => {
      const map = new Map<string, number>()
      for (const m of rows) map.set(keyFn(m), (map.get(keyFn(m)) ?? 0) + 1)
      return Object.fromEntries(Array.from(map.entries()).sort((a, b) => b[1] - a[1]))
    }
    return {
      metric, from, to, hospitalCode: hospitalCode ?? null,
      total: rows.length,
      byPriority: tally((m) => m.priority),
      byStatus: tally((m) => m.status?.name ?? '미지정'),
      byType: tally((m) => m.type?.name ?? '미지정'),
      byHospital: hospitalCode ? undefined : tally((m) => m.hospital.hospitalName),
    }
  }
  if (metric === 'site_visit_count') {
    const rows = await prisma.siteVisit.findMany({
      where: { requestDate: range, ...(hospitalCode && { hospitalCode }) },
      include: { status: { select: { name: true } } },
    })
    const byStatus = new Map<string, number>()
    for (const v of rows) {
      const k = v.status?.name ?? '미지정'
      byStatus.set(k, (byStatus.get(k) ?? 0) + 1)
    }
    return { metric, from, to, total: rows.length, byStatus: Object.fromEntries(byStatus) }
  }
  if (metric === 'new_hospitals') {
    const rows = await prisma.hospital.findMany({
      where: { contractDate: range },
      orderBy: { contractDate: 'asc' },
      select: { hospitalCode: true, hospitalName: true, contractDate: true, introBeds: true, status: true },
    })
    return {
      metric, from, to,
      note: '병원 최초 계약일 기준',
      count: rows.length,
      items: rows.slice(0, 30).map((h) => ({
        hospitalCode: h.hospitalCode, name: h.hospitalName,
        contractDate: ymd(h.contractDate), introBeds: h.introBeds, status: h.status,
      })),
    }
  }
  return { error: `지원하지 않는 metric: ${metric}` }
}

type WikiSearchRow = {
  id: string
  title: string
  plain_text: string
  updated_at: Date
  title_hits: number
  title_sim: number
  total: number
}

/** 검색 결과 페이지의 카테고리 경로("상위 > 하위 > 페이지") 계산기 */
async function wikiPathResolver(): Promise<(id: string) => string> {
  const tree = await prisma.wikiPage.findMany({
    where: { deletedAt: null },
    select: { id: true, parentId: true, title: true },
  })
  const byId = new Map(tree.map((t) => [t.id, t]))
  return (id: string) => {
    const parts: string[] = []
    const seen = new Set<string>()
    let cur = byId.get(id)
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      parts.unshift(cur.title)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return parts.join(' > ')
  }
}

async function searchWiki(input: ToolInput) {
  const query = str(input.query)
  if (!query) return { error: 'query가 필요합니다.' }

  // AI 검색 제외로 표시된 페이지(및 그 하위 전체)는 대상에서 뺀다
  const excludedIds = Array.from(await getAiExcludedPageIds())

  // 한국어는 조사·어미 때문에 질의 전체 문자열 매칭의 리콜이 낮다
  // ("게이트웨이 오프라인" ↛ "게이트웨이가 오프라인") → 공백 단위 토큰 AND 매칭
  const tokens = query.split(/\s+/).filter(Boolean).slice(0, 5)
  const terms = tokens.length > 0 ? tokens : [query]

  // 정렬은 관련도 우선(제목에 걸린 토큰 수 → 제목 유사도 → 최신순).
  // 기존 updatedAt 정렬은 "최근 수정된 10건"을 줄 뿐 관련도를 반영하지 못했다.
  const rows = await prisma.$queryRaw<WikiSearchRow[]>`
    SELECT p.id, p.title, p.plain_text, p.updated_at,
           (SELECT count(*) FROM unnest(${terms}::text[]) tk
              WHERE p.title ILIKE '%' || tk || '%')::int AS title_hits,
           similarity(p.title, ${query})::float8 AS title_sim,
           count(*) OVER ()::int AS total
      FROM wiki.wiki_pages p
     WHERE p.deleted_at IS NULL
       AND p.is_template = false
       AND NOT (p.id = ANY(${excludedIds}::text[]))
       AND (SELECT bool_and(p.title ILIKE '%' || tk || '%' OR p.plain_text ILIKE '%' || tk || '%')
              FROM unnest(${terms}::text[]) tk)
     ORDER BY title_hits DESC, title_sim DESC, p.updated_at DESC
     LIMIT 10
  `

  const pathOf = rows.length > 0 ? await wikiPathResolver() : () => ''
  const lowerTerms = terms.map((t) => t.toLowerCase())

  return {
    count: rows.length,
    total: rows[0]?.total ?? 0,
    pages: rows.map((p) => {
      // 스니펫은 가장 먼저 등장하는 토큰 주변을 보여준다
      const lower = p.plain_text.toLowerCase()
      const idx = lowerTerms
        .map((t) => lower.indexOf(t))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)[0]
      const snippet =
        idx === undefined
          ? p.plain_text.slice(0, 150)
          : p.plain_text.slice(Math.max(0, idx - 60), idx + 120)
      return {
        pageId: p.id,
        title: p.title,
        path: pathOf(p.id),
        updatedAt: ymd(p.updated_at),
        snippet,
      }
    }),
  }
}

/** read_wiki_page 1회 반환 문자 수 */
const WIKI_CHARS_DEFAULT = 6000
const WIKI_CHARS_MAX = 12000

async function readWikiPage(input: ToolInput) {
  const pageId = str(input.pageId)
  if (!pageId) return { error: 'pageId가 필요합니다.' }
  const page = await prisma.wikiPage.findUnique({
    where: { id: pageId },
    select: { id: true, title: true, plainText: true, deletedAt: true, updatedAt: true },
  })
  if (!page || page.deletedAt) return { error: '페이지를 찾을 수 없습니다.' }
  // AI 검색 제외 영역의 페이지는 직접 id로도 열람 불가
  if (await isPageAiExcluded(pageId)) return { error: '페이지를 찾을 수 없습니다.' }

  const text = page.plainText
  const offset = int(input.offset, 0, 0, Math.max(text.length, 0))
  const maxChars = int(input.maxChars, WIKI_CHARS_DEFAULT, 500, WIKI_CHARS_MAX)
  const content = text.slice(offset, offset + maxChars)
  const end = offset + content.length
  const truncated = end < text.length

  return {
    pageId: page.id,
    title: page.title,
    updatedAt: ymd(page.updatedAt),
    totalChars: text.length,
    offset,
    truncated,
    ...(truncated && { nextOffset: end }),
    content,
  }
}

async function readHospitalNote(input: ToolInput) {
  const code = str(input.hospitalCode)
  if (!code) return { error: 'hospitalCode가 필요합니다.' }
  const page = await findHospitalNotePage(code)
  if (!page) return { note: '이 병원의 병원 노트(상담이력)가 아직 없습니다.' }
  if (await isPageAiExcluded(page.id)) return { note: '이 병원의 병원 노트(상담이력)가 아직 없습니다.' }
  const text = page.plainText
  return {
    pageId: page.id,
    title: page.title,
    updatedAt: ymd(page.updatedAt),
    truncated: text.length > 8000,
    // 최근 상담이 하단에 append되므로 길면 뒷부분을 우선 반환
    content: text.length > 8000 ? '…' + text.slice(-8000) : text,
  }
}

/** 도구 실행 디스패처 — 실패는 throw하지 않고 error 객체 반환 (agent가 is_error로 전달) */
export async function executeTool(name: string, input: ToolInput): Promise<unknown> {
  try {
    switch (name) {
      case 'search_hospitals':
        return await searchHospitals(input)
      case 'get_hospital_overview':
        return await getHospitalOverview(input)
      case 'list_projects':
        return await listProjects(input)
      case 'list_maintenances':
        return await listMaintenances(input)
      case 'list_site_visits':
        return await listSiteVisits(input)
      case 'list_install_plans':
        return await listInstallPlans(input)
      case 'list_etc_tasks':
        return await listEtcTasks(input)
      case 'get_dashboard_summary':
        return await getDashboardSummary()
      case 'aggregate_stats':
        return await aggregateStats(input)
      case 'search_wiki':
        return await searchWiki(input)
      case 'read_wiki_page':
        return await readWikiPage(input)
      case 'read_hospital_note':
        return await readHospitalNote(input)
      default:
        return { error: `알 수 없는 도구: ${name}` }
    }
  } catch (e) {
    console.error(`[ai-tool] ${name} 실행 실패:`, e)
    return { error: '조회 중 오류가 발생했습니다. 조건을 바꿔 다시 시도하세요.' }
  }
}
