import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { findHospitalNotePage } from '@/lib/wiki/hospitalNote'
import { getAiExcludedPageIds, isPageAiExcluded } from '@/lib/wiki/aiExclusion'
import { searchOperationHistory, findSimilarCases, tokenize, excerpt } from './opsSearch'

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
    name: 'search_operation_history',
    description:
      '운영 이력의 **본문 내용**을 전문 검색한다. 대상은 유지보수 증상·조치, 처리 기록, 답사 노트, 기타업무 비고, 티켓 코멘트다. "게이트웨이 오프라인 사례 있어?", "케이블 교체한 적 있나", "그 병원 답사 때 특이사항" 처럼 내용으로 찾아야 하는 질문에 사용하라. list_* 도구는 상태·기간·병원 같은 구조화 필터만 가능해 내용 검색을 하지 못하므로, 본문을 찾아야 할 때는 반드시 이 도구를 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색어 (핵심 명사 1~3개). 조사·어미는 빼라.' },
        workType: {
          type: 'string',
          enum: ['MAINTENANCE', 'MAINTENANCE_LOG', 'SITE_VISIT', 'ETC', 'TICKET'],
          description: '업무 유형으로 한정 (선택)',
        },
        hospitalCode: { type: 'string', description: '병원 코드로 한정 (선택)' },
        from: { type: 'string', description: '발생일 범위 시작 YYYY-MM-DD (선택)' },
        to: { type: 'string', description: '발생일 범위 끝 YYYY-MM-DD (선택)' },
        limit: { type: 'number', description: '반환 건수 (기본 8, 최대 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_similar_cases',
    description:
      '증상을 입력하면 **과거 유사 장애와 그때의 조치**를 찾는다. 병원이 장애를 문의했을 때 가장 먼저 호출하라. 조치 내용(resolution)이 함께 오므로 바로 응대에 활용할 수 있다. 증상 문장을 그대로 넣어도 된다.',
    input_schema: {
      type: 'object',
      properties: {
        symptoms: { type: 'string', description: '증상 설명 (문장 그대로 가능)' },
        hospitalCode: { type: 'string', description: '같은 병원 사례에 가중치 부여 (선택)' },
        limit: { type: 'number', description: '반환 건수 (기본 5, 최대 15)' },
      },
      required: ['symptoms'],
    },
  },
  {
    name: 'search_wiki',
    description:
      '사내위키를 **문서 안의 절(節) 단위로** 검색한다. thynC 제품 기능·알람 기준·API 규격·설치 절차·매뉴얼 등 고정형 지식 질문에 호출하라. 결과는 문서 전체가 아니라 해당 내용이 있는 절이며, 위키 카테고리(category)와 문서 내 위치(heading)가 함께 온다. 발췌만으로 답할 수 있으면 그대로 답하고, 본문 전체가 필요할 때만 chunkId로 read_wiki_chunk를 호출하라.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색어 (핵심 키워드 1~3개, 예: "알람 기준", "게이트웨이 오프라인"). 조사·어미는 빼고 명사 위주로 넣어라.' },
        limit: { type: 'number', description: '반환 절 개수 (기본 6, 최대 12)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_wiki_chunk',
    description:
      'search_wiki 결과 중 특정 절의 본문 전체를 읽는다. 앞뒤 절이 함께 오므로 문맥이 끊기지 않는다. 발췌로 충분하면 호출하지 마라.',
    input_schema: {
      type: 'object',
      properties: {
        chunkId: { type: 'number', description: 'search_wiki 결과의 chunkId' },
        neighbors: { type: 'number', description: '앞뒤로 함께 읽을 절 수 (기본 1, 최대 3)' },
      },
      required: ['chunkId'],
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
  search_operation_history: '운영 이력 검색 중',
  find_similar_cases: '유사 장애 사례 찾는 중',
  search_wiki: '위키 검색 중',
  read_wiki_chunk: '위키 문서 읽는 중',
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

// ===== 축 2 — 운영 정보 전문 검색 (v3 O1·O2) =====

async function searchOperationHistoryTool(input: ToolInput) {
  const query = str(input.query)
  if (!query) return { error: 'query가 필요합니다.' }
  const rows = await searchOperationHistory({
    query,
    workType: str(input.workType),
    hospitalCode: str(input.hospitalCode),
    from: str(input.from),
    to: str(input.to),
    limit: int(input.limit, 8, 1, 20),
  })
  const terms = tokenize(query)
  const total = rows[0]?.total ?? 0
  return {
    count: rows.length,
    total,
    note: total > rows.length ? `관련 ${total}건 중 상위 ${rows.length}건 (검색어를 좁히면 정확도가 올라감)` : undefined,
    records: rows.map((r) => ({
      workType: r.work_type,
      code: r.code, // 출처 — 답변에 이 코드를 함께 제시할 것
      link: r.ref_path,
      hospital: r.hospital_name,
      date: ymd(r.occurred_at),
      title: r.title,
      excerpt: excerpt(r.body, terms),
    })),
  }
}

async function findSimilarCasesTool(input: ToolInput) {
  const symptoms = str(input.symptoms)
  if (!symptoms) return { error: 'symptoms가 필요합니다.' }
  const rows = await findSimilarCases({
    symptoms,
    hospitalCode: str(input.hospitalCode),
    limit: int(input.limit, 5, 1, 15),
  })
  return {
    count: rows.length,
    candidates: rows[0]?.total ?? 0,
    note: rows.length === 0 ? '유사한 과거 사례를 찾지 못했습니다.' : undefined,
    cases: rows.map((r) => ({
      maintenanceCode: r.maintenance_code, // 출처
      link: r.ref_path,
      hospital: r.hospital_name,
      type: r.type_name,
      status: r.status_name,
      priority: r.priority,
      reportedAt: ymd(r.reported_at),
      resolvedAt: ymd(r.resolved_at),
      symptoms: r.symptoms,
      resolution: r.resolution, // 조치 = 답의 본체
    })),
  }
}

type WikiSearchRow = {
  chunk_id: number
  page_id: string
  title: string
  heading_path: string
  text: string
  ordinal: number
  updated_at: Date
  score: number
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

/**
 * 축 1 — 위키 청크 검색 (v3 W2)
 *
 * 검색 단위를 문서에서 헤딩 청크로 내렸다. 문서 단위였을 때는 68,772자 문서가 통째로
 * 한 건이라 "어디에 답이 있는지"를 알 수 없어 6,000자씩 선형으로 읽어야 했다.
 * 헤딩 경로는 제목보다 강한 관련도 신호이므로 랭킹에서 가장 큰 가중치를 준다.
 */
async function searchWiki(input: ToolInput) {
  const query = str(input.query)
  if (!query) return { error: 'query가 필요합니다.' }

  // AI 검색 제외로 표시된 페이지(및 그 하위 전체)는 대상에서 뺀다
  const excludedIds = Array.from(await getAiExcludedPageIds())

  // 한국어는 조사·어미 때문에 질의 전체 문자열 매칭의 리콜이 낮다
  // ("게이트웨이 오프라인" ↛ "게이트웨이가 오프라인") → 공백 단위 토큰 매칭
  const terms = tokenize(query)
  const limit = int(input.limit, 6, 1, 12)

  const rows = await prisma.$queryRaw<WikiSearchRow[]>`
    SELECT c.id AS chunk_id, c.page_id, p.title, c.heading_path, c.text, c.ordinal, p.updated_at,
           ( (SELECT count(*) FROM unnest(${terms}::text[]) tk
                WHERE c.heading_path ILIKE '%' || tk || '%')::float8 * 3
             + (SELECT count(*) FROM unnest(${terms}::text[]) tk
                  WHERE p.title ILIKE '%' || tk || '%')::float8 * 2
             + (SELECT count(*) FROM unnest(${terms}::text[]) tk
                  WHERE c.text ILIKE '%' || tk || '%')::float8
             + similarity(c.heading_path, ${query})::float8
           ) AS score,
           count(*) OVER ()::int AS total
      FROM wiki.wiki_chunks c
      JOIN wiki.wiki_pages p ON p.id = c.page_id
     WHERE p.deleted_at IS NULL
       AND p.is_template = false
       AND NOT (p.id = ANY(${excludedIds}::text[]))
       AND (SELECT count(*) FROM unnest(${terms}::text[]) tk
              WHERE c.heading_path || ' ' || p.title || ' ' || c.text ILIKE '%' || tk || '%') > 0
     ORDER BY score DESC, p.updated_at DESC
     LIMIT ${limit}
  `

  const pathOf = rows.length > 0 ? await wikiPathResolver() : () => ''

  return {
    count: rows.length,
    total: rows[0]?.total ?? 0,
    note:
      rows.length === 0
        ? '일치하는 내용이 없습니다. 검색어를 바꾸거나 더 일반적인 단어로 시도하세요.'
        : '본문 전체가 필요하면 chunkId로 read_wiki_chunk를 호출하라.',
    chunks: rows.map((r) => ({
      chunkId: r.chunk_id,
      pageId: r.page_id, // 출처
      category: pathOf(r.page_id), // 위키 트리상 위치
      heading: r.heading_path, // 문서 내 위치
      link: `/wiki/${r.page_id}`,
      updatedAt: ymd(r.updated_at),
      excerpt: excerpt(r.text, terms, 400),
    })),
  }
}

/** 청크 본문 정밀 조회 — 앞뒤 청크를 함께 반환해 문맥이 끊기지 않게 한다 */
async function readWikiChunk(input: ToolInput) {
  const chunkId = int(input.chunkId, 0, 1, Number.MAX_SAFE_INTEGER)
  if (!chunkId) return { error: 'chunkId가 필요합니다.' }
  const neighbors = int(input.neighbors, 1, 0, 3)

  const base = await prisma.wikiChunk.findUnique({
    where: { id: chunkId },
    select: { pageId: true, ordinal: true, page: { select: { title: true, deletedAt: true } } },
  })
  if (!base || base.page.deletedAt) return { error: '청크를 찾을 수 없습니다.' }
  if (await isPageAiExcluded(base.pageId)) return { error: '청크를 찾을 수 없습니다.' }

  const rows = await prisma.wikiChunk.findMany({
    where: {
      pageId: base.pageId,
      ordinal: { gte: base.ordinal - neighbors, lte: base.ordinal + neighbors },
    },
    orderBy: { ordinal: 'asc' },
    select: { id: true, ordinal: true, headingPath: true, text: true },
  })

  return {
    pageId: base.pageId,
    pageTitle: base.page.title,
    link: `/wiki/${base.pageId}`,
    chunks: rows.map((r) => ({
      chunkId: r.id,
      heading: r.headingPath,
      text: r.text,
      isRequested: r.ordinal === base.ordinal,
    })),
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
      case 'search_operation_history':
        return await searchOperationHistoryTool(input)
      case 'find_similar_cases':
        return await findSimilarCasesTool(input)
      case 'search_wiki':
        return await searchWiki(input)
      case 'read_wiki_page':
        return await readWikiPage(input)
      case 'read_wiki_chunk':
        return await readWikiChunk(input)
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
