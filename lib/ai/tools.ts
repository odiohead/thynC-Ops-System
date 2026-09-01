import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { findHospitalNotePage } from '@/lib/wiki/hospitalNote'
import { getAiExcludedPageIds, isPageAiExcluded } from '@/lib/wiki/aiExclusion'
import { searchOperationHistory, findSimilarCases, tokenize, excerpt } from './opsSearch'
import { checkSalesAccess } from '@/lib/sales'
import { getHospitalDeviceSummary } from '@/lib/deviceRegistry'
import type { JWTPayload } from '@/lib/auth'

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
      '특정 병원의 현황을 조회한다. 병원의 상태·도입형태·병상·계약일·담당자·디바이스 원장 배치 현황(모델별 배치 중 대수)·업무 건수 요약이 필요할 때 호출하라.',
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
        statusName: { type: 'string', description: "상태 필터: '접수'|'작성완료'|'회신완료'|'보류' (부분 일치, 선택)" },
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
      '운영 이력의 **본문 내용**을 전문 검색한다. 대상은 유지보수 증상·조치, 처리 기록, 답사 노트, 기타업무 비고, 티켓 코멘트, 상담이력이다. "게이트웨이 오프라인 사례 있어?", "케이블 교체한 적 있나", "그 병원 답사 때 특이사항" 처럼 내용으로 찾아야 하는 질문에 사용하라. list_* 도구는 상태·기간·병원 같은 구조화 필터만 가능해 내용 검색을 하지 못하므로, 본문을 찾아야 할 때는 반드시 이 도구를 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색어 (핵심 명사 1~3개). 조사·어미는 빼라.' },
        workType: {
          type: 'string',
          enum: ['MAINTENANCE', 'MAINTENANCE_LOG', 'SITE_VISIT', 'ETC', 'TICKET', 'CONSULTATION'],
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
    name: 'read_consultations',
    description:
      '특정 병원의 **과거 상담이력**을 최근순으로 읽는다. 상담 응대 시 "이 병원 지난번에 뭘 물어봤나", "과거 상담 내용"이 필요하면 가장 먼저 호출하라. 내용으로 찾아야 하면(병원 불문) search_operation_history를 workType=CONSULTATION으로 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalCode: { type: 'string', description: '병원 코드 (search_hospitals로 조회)' },
        limit: { type: 'number', description: '반환 건수 (기본 5, 최대 20)' },
      },
      required: ['hospitalCode'],
    },
  },
  {
    name: 'read_hospital_note',
    description:
      '특정 병원의 병원 노트(담당자가 직접 적어둔 특이사항 메모 위키 페이지)를 읽는다. 상담이력은 여기가 아니라 read_consultations에 있다. 병원별 주의사항·현장 메모가 필요할 때 호출하라.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalCode: { type: 'string', description: '병원 코드 (search_hospitals로 조회)' },
      },
      required: ['hospitalCode'],
    },
  },
  // ===== 자재관리(WMS) — 2026-07-27 도구 확장 =====
  {
    name: 'search_inventory_items',
    description:
      '자재 품목을 검색한다. "MC200M-T 재고 몇 개야?", "게이트웨이 어느 창고에 있어?" 같은 품목·재고 질문에 먼저 호출하라. 품목명·모델명·품목코드·규격으로 검색하며 품목별 현재고 합계와 위치별 잔량을 함께 반환한다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '품목명·모델명·품목코드·규격 일부 (예: "MC200M", "게이트웨이")' },
        inventoryName: { type: 'string', description: "인벤토리 이름 필터 (예: '대웅제약', '평가용', '판매용', 'thynC운영팀' — 부분 일치, 선택)" },
        ...LIST_PARAMS,
      },
      required: ['query'],
    },
  },
  {
    name: 'get_stock_summary',
    description:
      '재고 전체 현황을 집계한다. "전체 재고 현황", "대웅제약재고에 뭐가 얼마나 있어?", "창고별 재고" 같은 큰 그림 질문에 호출하라. 인벤토리별·위치(창고)별 품목 수와 총 수량을 반환한다. 특정 품목의 재고는 search_inventory_items를 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        inventoryName: { type: 'string', description: '인벤토리 이름 필터 (부분 일치, 선택)' },
      },
      required: [],
    },
  },
  {
    name: 'list_stock_transactions',
    description:
      '자재 입출고 전표 이력을 조회한다. "이번달 출고 내역", "OO병원에 나간 자재", "누가 언제 입고했나" 같은 질문에 호출하라. 기간 필터는 입출고일(txDate) 기준. 취소된 전표는 기본 제외.',
    input_schema: {
      type: 'object',
      properties: {
        itemQuery: { type: 'string', description: '품목명·모델명·품목코드 일부 (선택)' },
        inventoryName: { type: 'string', description: '인벤토리 이름 필터 (부분 일치, 선택)' },
        txType: { type: 'string', enum: ['IN', 'OUT', 'MOVE'], description: '전표 유형: IN(입고)|OUT(출고)|MOVE(이동) (선택)' },
        hospitalCode: { type: 'string', description: '출고 연결 병원 코드 — 병원별 사용 자재 질문에 사용 (선택)' },
        requester: { type: 'string', description: '요청자 이름 일부 (선택)' },
        from: { type: 'string', description: '입출고일 범위 시작 YYYY-MM-DD (선택)' },
        to: { type: 'string', description: '입출고일 범위 끝 YYYY-MM-DD (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'find_serial_unit',
    description:
      '시리얼 번호로 자재 개체(단품)를 추적한다. "시리얼 XXX 어디 있어?", "이 장비 어느 병원에 설치됐어?" 같은 개체 단위 질문에 호출하라. 개체의 상태(재고/출고/폐기)·위치·설치 병원·LOT·태그와 입출고 이력을 반환한다.',
    input_schema: {
      type: 'object',
      properties: {
        serialNo: { type: 'string', description: '시리얼 번호 (부분 일치 검색 지원)' },
      },
      required: ['serialNo'],
    },
  },
  // ===== 티켓 =====
  {
    name: 'list_tickets',
    description:
      '티켓 목록을 조회한다. "열린 티켓 몇 건?", "SLA 초과 티켓", "OO 담당 티켓", "유지보수 그룹 대기 티켓" 같은 질문에 호출하라. 도메인 업무(유지보수·답사 등)의 상세 내용이 필요하면 해당 list_* 도구를, 특정 티켓 심층 조회는 get_ticket을 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "상태 필터 (쉼표 구분 복수 가능): OPEN|ASSIGNED|IN_PROGRESS|PENDING|RESOLVED|CLOSED. 미지정+open=true면 열린 티켓 전체" },
        open: { type: 'boolean', description: 'true면 미종결(RESOLVED·CLOSED 제외) 티켓만 (선택)' },
        overdue: { type: 'boolean', description: 'true면 SLA 기한(dueAt) 초과 미종결 티켓만 (선택)' },
        queueName: { type: 'string', description: "Assignment Group 이름 일부 (예: '유지보수', '설치·답사') (선택)" },
        severity: { type: 'string', description: 'SEV1~SEV5 (선택)' },
        refType: { type: 'string', description: '업무 유형: MAINTENANCE|SITE_VISIT|INSTALL_PLAN|PROJECT|ETC, NONE=순수 티켓 (선택)' },
        hospitalCode: { type: 'string', description: '병원 코드 (선택)' },
        ownerName: { type: 'string', description: '담당자(owner) 이름 일부 (선택)' },
        unassigned: { type: 'boolean', description: 'true면 담당자 미배정 티켓만 (선택)' },
        q: { type: 'string', description: '티켓번호·제목 검색어 (선택)' },
        from: { type: 'string', description: '접수일 범위 시작 YYYY-MM-DD (선택)' },
        to: { type: 'string', description: '접수일 범위 끝 YYYY-MM-DD (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'get_ticket',
    description:
      '티켓 1건의 상세를 조회한다. 티켓번호(TK-YYYYMM-NNNNN)를 알 때 호출하라. 메타(상태·Sev·그룹·CTI·담당·병원)와 SLA 시계, 연결 업무, 최근 타임라인(코멘트·이벤트)을 반환한다.',
    input_schema: {
      type: 'object',
      properties: {
        ticketCode: { type: 'string', description: '티켓번호 (예: TK-202607-00123)' },
      },
      required: ['ticketCode'],
    },
  },
  // ===== 차량 =====
  {
    name: 'list_vehicle_reservations',
    description:
      '법인차량 예약 현황을 조회한다. "이번주 차량 예약", "카니발 누가 쓰고 있어?", "내일 쓸 수 있는 차" 같은 질문에 호출하라. 기간 미지정 시 오늘부터 7일. 취소된 예약은 제외.',
    input_schema: {
      type: 'object',
      properties: {
        vehicleName: { type: 'string', description: '차량 이름·차량번호 일부 (선택)' },
        userName: { type: 'string', description: '예약자 이름 일부 (선택)' },
        from: { type: 'string', description: '기간 시작 YYYY-MM-DD (기본 오늘)' },
        to: { type: 'string', description: '기간 끝 YYYY-MM-DD (기본 from+7일)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'list_vehicle_logs',
    description:
      '차량 운행일지를 조회한다. "지난달 카니발 주행거리", "OO이 언제 어디 운행했나" 같은 질문에 호출하라. 기간 필터는 운행 종료 시각 기준이며 합계 주행거리를 함께 반환한다.',
    input_schema: {
      type: 'object',
      properties: {
        vehicleName: { type: 'string', description: '차량 이름·차량번호 일부 (선택)' },
        driverName: { type: 'string', description: '운전자 이름 일부 (선택)' },
        from: { type: 'string', description: '기간 시작 YYYY-MM-DD (선택)' },
        to: { type: 'string', description: '기간 끝 YYYY-MM-DD (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  // ===== 조직 디렉토리 =====
  {
    name: 'search_users',
    description:
      '사내 구성원을 검색한다. "OO 어느 부서야?", "유지보수 담당자 풀 누구야?", "재고 처리 권한 있는 사람" 같은 질문에 호출하라. 이름·소속·부서·역할과 업무별 담당 풀(프로젝트/설치계획/유지보수/기타업무)·재고 담당 여부를 반환한다. 연락처는 제공하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '이름·부서명·소속명 일부 (예: "이준호", "운영팀"). 비우면 활성 계정 전체에서 필터만 적용' },
        workType: { type: 'string', enum: ['PROJECT', 'INSTALL_PLAN', 'MAINTENANCE', 'ETC_TASK'], description: '이 업무의 담당자 풀 소속만 (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  // ===== GW 배치 플래너 =====
  {
    name: 'list_gateway_plan_jobs',
    description:
      'GW 배치 플래너의 도면 분석 잡 목록을 조회한다. "OO병원 도면 분석했었나?", "최근 배치 플래너 작업" 같은 질문에 호출하라. 잡 제목·상태·게이트웨이 수·공간 인식 요약을 반환한다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '잡 제목 일부 (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'get_hospital_sales',
    description:
      '특정 병원의 영업/CRM 정보를 조회한다. 영업 단계·담당 영업·전체 병상/침투율·병원 키맨(인적정보)·도입 계약(차수·금액·판매모델·정산)·최근 영업 활동 질문 시 호출하라. 접근 권한이 없는 사용자에게는 오류가 반환된다.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalCode: { type: 'string', description: '병원 코드 (search_hospitals로 조회)' },
      },
      required: ['hospitalCode'],
    },
  },
  {
    name: 'list_sales_deals',
    description:
      '도입 계약(딜) 목록을 조회한다. "계약완료 건", "영업중인 병원", "구독형 계약", "올해 계약 실적·실판매액" 같은 영업 질문 시 호출하라. 상태·판매모델·지역·기간 필터와 금액 합계를 반환한다. 접근 권한이 없는 사용자에게는 오류가 반환된다.',
    input_schema: {
      type: 'object',
      properties: {
        hospitalName: { type: 'string', description: '병원명 일부 (선택)' },
        statusName: { type: 'string', description: "딜 상태 (예: '영업중', '계약완료', '해지·중단')" },
        modelName: { type: 'string', description: "판매모델 (예: '구축형', '구독형', '사용량비례형') — 병원/씨어스 관점 모두 매칭" },
        sido: { type: 'string', description: "지역 시도 (예: '경기', '전남')" },
        contractFrom: { type: 'string', description: '계약일 시작 YYYY-MM-DD (선택)' },
        contractTo: { type: 'string', description: '계약일 끝 YYYY-MM-DD (선택)' },
        ...LIST_PARAMS,
      },
      required: [],
    },
  },
  {
    name: 'get_sales_summary',
    description:
      '영업 전사 요약을 조회한다. "누적 실판매액", "도입 병원 몇 곳", "영업 단계별 현황", "판매모델 구성" 같은 영업 집계 질문 시 호출하라. KPI·단계 분포·판매모델 분포·지역 Top5를 반환한다. 접근 권한이 없는 사용자에게는 오류가 반환된다.',
    input_schema: { type: 'object', properties: {}, required: [] },
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
  read_consultations: '상담이력 확인 중',
  read_hospital_note: '병원 노트 확인 중',
  search_inventory_items: '자재 품목 검색 중',
  get_stock_summary: '재고 현황 집계 중',
  list_stock_transactions: '입출고 이력 조회 중',
  find_serial_unit: '시리얼 개체 추적 중',
  list_tickets: '티켓 조회 중',
  get_ticket: '티켓 상세 확인 중',
  list_vehicle_reservations: '차량 예약 조회 중',
  list_vehicle_logs: '운행일지 조회 중',
  search_users: '구성원 검색 중',
  list_gateway_plan_jobs: 'GW 플래너 잡 조회 중',
  get_hospital_sales: '병원 영업 정보 조회 중',
  list_sales_deals: '도입 계약 조회 중',
  get_sales_summary: '영업 요약 집계 중',
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
      _count: {
        select: { projects: true, maintenances: true, siteVisits: true, installPlans: true },
      },
    },
  })
  if (!h) return { error: `병원(${code})을 찾을 수 없습니다.` }
  // 디바이스 원장 요약 — 모델별 배치 중(ACTIVE) 개체 수 + 계약 대조 (hospital_device_registry_design.md §9.5 P1; 읽기 전용 1회 호출)
  //   ECG hard → '/ 계약 n', SpO2 soft → '/ 참고 n', GW·제3자 none → 접미 없음. 배치 0대라도 계약 축이 있으면 노출(미등록 격차 확인용)
  const registry = await getHospitalDeviceSummary(code).catch((err) => {
    console.error('[ai/tools] getHospitalDeviceSummary failed:', err)
    return null
  })
  const devices = (registry?.models ?? [])
    .filter((m) => m.active > 0 || m.compare !== 'none')
    .map((m) => {
      const suffix =
        m.compare === 'hard' && m.expected != null
          ? ` / 계약 ${m.expected}`
          : m.compare === 'soft' && m.expected != null
            ? ` / 참고 ${m.expected}`
            : ''
      return `${m.deviceName}(${m.deviceModel}) 배치 ${m.active}대${suffix}`
    })
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
    devices,
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
    ...(str(input.statusName) && { status: { name: { contains: str(input.statusName)! } } }),
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
        status: { select: { name: true } },
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
      status: p.status?.name ?? null,
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

/** 병원별 상담이력 — 최근순. 위키 노트가 아니라 `consultations` 원본을 읽는다 */
async function readConsultations(input: ToolInput) {
  const code = str(input.hospitalCode)
  if (!code) return { error: 'hospitalCode가 필요합니다.' }
  const limit = int(input.limit, 5, 1, 20)

  const [rows, total] = await Promise.all([
    prisma.consultation.findMany({
      where: { hospitalCode: code },
      orderBy: [{ consultedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        consultationCode: true,
        hospitalCode: true,
        title: true,
        content: true,
        consultedByName: true,
        consultedAt: true,
        consultationType: { select: { name: true } },
      },
    }),
    prisma.consultation.count({ where: { hospitalCode: code } }),
  ])

  if (rows.length === 0) return { count: 0, total: 0, note: '이 병원의 상담이력이 아직 없습니다.' }

  return {
    count: rows.length,
    total,
    consultations: rows.map((r) => ({
      code: r.consultationCode,
      consultedAt: ymd(r.consultedAt),
      consultationType: r.consultationType?.name ?? null,
      consultedBy: r.consultedByName,
      title: r.title,
      content: r.content.length > 4000 ? r.content.slice(0, 4000) + '…' : r.content,
      link: `/hospitals/${r.hospitalCode}#consultations`, // 출처
    })),
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

// ===== 자재관리(WMS)·티켓·차량·조직·GW 플래너 — 2026-07-27 도구 확장 =====

const TX_TYPE_LABELS: Record<string, string> = { IN: '입고', OUT: '출고', MOVE: '이동', TRANSFER: '이관(구)' }
const UNIT_STATUS_LABELS: Record<string, string> = { IN_STOCK: '재고', OUT: '출고됨', DISPOSED: '폐기' }

/** KST 기준 분 단위 표기 (차량 예약·운행 시각) */
const kstMinute = (d: Date | null | undefined) =>
  d ? d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : null

async function searchInventoryItems(input: ToolInput) {
  const query = str(input.query)
  if (!query) return { error: 'query가 필요합니다.' }
  const invName = str(input.inventoryName)
  const where = {
    isActive: true,
    OR: [
      { name: { contains: query, mode: 'insensitive' as const } },
      { modelName: { contains: query, mode: 'insensitive' as const } },
      { itemCode: { contains: query, mode: 'insensitive' as const } },
      { spec: { contains: query, mode: 'insensitive' as const } },
    ],
    ...(invName && { inventory: { name: { contains: invName } } }),
  }
  const full = isFull(input)
  const [total, rows] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.findMany({
      where,
      take: listLimit(input),
      orderBy: [{ inventoryId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        inventory: { select: { name: true } },
        category: { select: { name: true } },
        manufacturer: { select: { name: true } },
        stocks: { include: { warehouse: { select: { name: true } } } },
      },
    }),
  ])
  return {
    ...listMeta(rows.length, total),
    items: rows.map((it) => {
      const totalQty = it.stocks.reduce((s, x) => s + x.quantity, 0)
      const byWh = new Map<string, number>()
      for (const s of it.stocks) byWh.set(s.warehouse.name, (byWh.get(s.warehouse.name) ?? 0) + s.quantity)
      return {
        itemCode: it.itemCode,
        name: it.name,
        modelName: it.modelName,
        inventory: it.inventory.name,
        totalQty,
        unit: it.unit,
        stocksByWarehouse: Array.from(byWh.entries()).filter(([, q]) => q > 0).map(([w, q]) => `${w}: ${q}`),
        serialManaged: it.isSerialManaged,
        link: `/inventory/${it.inventoryId}/items/${it.id}`, // 출처
        ...(full && {
          category: it.category?.name ?? null,
          manufacturer: it.manufacturer?.name ?? null,
          spec: it.spec,
          lotManaged: it.isLotManaged,
          memo: it.memo,
        }),
      }
    }),
  }
}

async function getStockSummary(input: ToolInput) {
  const invName = str(input.inventoryName)
  const inventories = await prisma.inventory.findMany({
    where: { isActive: true, ...(invName && { name: { contains: invName } }) },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true },
  })
  if (!inventories.length) return { error: `인벤토리(${invName ?? ''})를 찾을 수 없습니다.` }
  const result = []
  for (const inv of inventories) {
    const [itemCount, stocks] = await Promise.all([
      prisma.inventoryItem.count({ where: { inventoryId: inv.id, isActive: true } }),
      prisma.inventoryStock.findMany({
        where: { inventoryId: inv.id, quantity: { gt: 0 } },
        include: { warehouse: { select: { name: true } } },
      }),
    ])
    const byWh = new Map<string, { qty: number; items: Set<number> }>()
    let totalQty = 0
    for (const s of stocks) {
      totalQty += s.quantity
      const b = byWh.get(s.warehouse.name) ?? { qty: 0, items: new Set<number>() }
      b.qty += s.quantity
      b.items.add(s.itemId)
      byWh.set(s.warehouse.name, b)
    }
    result.push({
      inventory: inv.name,
      itemCount,
      totalQty,
      warehouses: Array.from(byWh.entries()).map(([w, b]) => ({ warehouse: w, qty: b.qty, itemKinds: b.items.size })),
    })
  }
  return { inventories: result, note: '수량은 현재고(취소 반영) 기준. 시리얼 개체 수는 수량과 동일 관리', link: '/inventory' }
}

async function listStockTransactions(input: ToolInput) {
  const itemQuery = str(input.itemQuery)
  const invName = str(input.inventoryName)
  const txType = str(input.txType)?.toUpperCase()
  const where = {
    canceledAt: null,
    ...(txType && ['IN', 'OUT', 'MOVE'].includes(txType) && { txType }),
    ...(str(input.hospitalCode) && { hospitalCode: str(input.hospitalCode) }),
    ...(str(input.requester) && { requester: { contains: str(input.requester)!, mode: 'insensitive' as const } }),
    ...(itemQuery && {
      item: {
        OR: [
          { name: { contains: itemQuery, mode: 'insensitive' as const } },
          { modelName: { contains: itemQuery, mode: 'insensitive' as const } },
          { itemCode: { contains: itemQuery, mode: 'insensitive' as const } },
        ],
      },
    }),
    ...(invName && { inventory: { name: { contains: invName } } }),
    ...dateRange(input, 'txDate'),
  }
  const full = isFull(input)
  const [total, rows] = await Promise.all([
    prisma.inventoryTransaction.count({ where }),
    prisma.inventoryTransaction.findMany({
      where,
      take: listLimit(input),
      orderBy: [{ txDate: 'desc' }, { id: 'desc' }],
      include: {
        item: { select: { name: true, itemCode: true, unit: true } },
        warehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
        inventory: { select: { name: true } },
        reasonCode: { select: { name: true } },
        hospital: { select: { hospitalName: true } },
        _count: { select: { units: true } },
      },
    }),
  ])
  return {
    ...listMeta(rows.length, total),
    link: '/inventory/transactions', // 출처
    transactions: rows.map((t) => ({
      txCode: t.txCode,
      date: ymd(t.txDate),
      type: TX_TYPE_LABELS[t.txType] ?? t.txType,
      item: `${t.item.name}(${t.item.itemCode})`,
      qty: `${t.quantity}${t.item.unit}`,
      warehouse: t.toWarehouse ? `${t.warehouse.name} → ${t.toWarehouse.name}` : t.warehouse.name,
      inventory: t.inventory.name,
      reason: t.reasonCode?.name ?? null,
      requester: t.requester,
      hospital: t.hospital?.hospitalName ?? null,
      destination: t.destination,
      ...(full && {
        workRef: t.refCode ? `${t.workType ?? ''} ${t.refCode}`.trim() : null,
        lotNo: t.lotNo,
        serialCount: t._count.units || undefined,
        note: stripHtml(t.note, 120),
      }),
    })),
  }
}

async function findSerialUnit(input: ToolInput) {
  const serial = str(input.serialNo)
  if (!serial) return { error: 'serialNo가 필요합니다.' }
  const units = await prisma.inventoryUnit.findMany({
    where: { serialNo: { contains: serial, mode: 'insensitive' } },
    take: 10,
    include: {
      item: { select: { id: true, name: true, itemCode: true, inventoryId: true } },
      inventory: { select: { name: true } },
      warehouse: { select: { name: true } },
      hospital: { select: { hospitalName: true } },
      transactions: {
        orderBy: { transactionId: 'asc' },
        include: {
          transaction: { select: { txCode: true, txType: true, txDate: true, requester: true, canceledAt: true } },
        },
      },
    },
  })
  if (!units.length) return { count: 0, note: `시리얼 '${serial}'과 일치하는 개체가 없습니다.` }
  return {
    count: units.length,
    units: units.map((u) => ({
      serialNo: u.serialNo,
      item: `${u.item.name}(${u.item.itemCode})`,
      inventory: u.inventory.name,
      status: UNIT_STATUS_LABELS[u.status] ?? u.status,
      warehouse: u.warehouse?.name ?? null,
      hospital: u.hospital?.hospitalName ?? null,
      lotNo: u.lotNo,
      tags: u.tags.length ? u.tags : undefined,
      memo: u.memo,
      history: u.transactions
        .filter((t) => !t.transaction.canceledAt)
        .map(
          (t) =>
            `${ymd(t.transaction.txDate)} ${TX_TYPE_LABELS[t.transaction.txType] ?? t.transaction.txType}(${t.transaction.txCode})${t.transaction.requester ? ` 요청자:${t.transaction.requester}` : ''}`,
        ),
      link: `/inventory/${u.item.inventoryId}/items/${u.item.id}`, // 출처
    })),
  }
}

const TICKET_STATUS_VALUES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'] as const
type TicketStatusValue = (typeof TICKET_STATUS_VALUES)[number]

async function listTickets(input: ToolInput) {
  const statuses = (str(input.status) ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is TicketStatusValue => (TICKET_STATUS_VALUES as readonly string[]).includes(s))
  const refType = str(input.refType)?.toUpperCase()
  const where = {
    ...(statuses.length && { status: { in: statuses } }),
    ...(!statuses.length && input.open === true && { status: { notIn: ['RESOLVED', 'CLOSED'] as TicketStatusValue[] } }),
    ...(str(input.severity) && { severity: str(input.severity)!.toUpperCase() as never }),
    ...(str(input.queueName) && { queue: { name: { contains: str(input.queueName)! } } }),
    ...(str(input.hospitalCode) && { hospitalCode: str(input.hospitalCode) }),
    ...(str(input.ownerName) && { owner: { name: { contains: str(input.ownerName)! } } }),
    ...(input.unassigned === true && { ownerId: null }),
    ...(refType && { refType: refType === 'NONE' ? null : refType }),
    ...(str(input.q) && {
      OR: [
        { ticketCode: { contains: str(input.q)!, mode: 'insensitive' as const } },
        { title: { contains: str(input.q)!, mode: 'insensitive' as const } },
      ],
    }),
    ...dateRange(input, 'createdAt'),
    // overdue는 마지막에 적용 — 미종결 강제 포함
    ...(input.overdue === true && {
      dueAt: { lt: new Date() },
      status: { notIn: ['RESOLVED', 'CLOSED'] as TicketStatusValue[] },
    }),
  }
  const full = isFull(input)
  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      take: listLimit(input),
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      include: {
        queue: { select: { name: true } },
        cti: { select: { name: true } },
        owner: { select: { name: true } },
        hospital: { select: { hospitalName: true } },
        pendingReason: { select: { name: true } },
      },
    }),
  ])
  const now = Date.now()
  return {
    ...listMeta(rows.length, total),
    tickets: rows.map((t) => ({
      ticketCode: t.ticketCode,
      title: t.title,
      status: t.status,
      severity: t.severity,
      queue: t.queue.name,
      owner: t.owner?.name ?? null,
      hospital: t.hospital?.hospitalName ?? null,
      refType: t.refType ?? 'NONE',
      createdAt: ymd(t.createdAt),
      dueAt: ymd(t.dueAt),
      overdue: !!t.dueAt && t.dueAt.getTime() < now && t.status !== 'RESOLVED' && t.status !== 'CLOSED' ? true : undefined,
      link: `/tickets/${t.ticketCode}`, // 출처
      ...(full && {
        cti: t.cti?.name ?? null,
        pendingReason: t.pendingReason?.name ?? null,
        pendingNote: t.pendingNote,
        reopenCount: t.reopenCount || undefined,
        resolvedAt: ymd(t.resolvedAt),
        closedAt: ymd(t.closedAt),
      }),
    })),
  }
}

async function getTicket(input: ToolInput) {
  const code = str(input.ticketCode)?.toUpperCase()
  if (!code) return { error: 'ticketCode가 필요합니다.' }
  const t = await prisma.ticket.findUnique({
    where: { ticketCode: code },
    include: {
      queue: { select: { name: true } },
      cti: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } },
      owner: { select: { name: true } },
      creator: { select: { name: true } },
      hospital: { select: { hospitalCode: true, hospitalName: true } },
      pendingReason: { select: { name: true } },
      participants: { include: { user: { select: { name: true } } } },
      parent: { select: { ticketCode: true, title: true } },
      children: { select: { ticketCode: true, title: true, status: true } },
      slaClocks: { orderBy: { id: 'asc' } },
      logs: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { name: true } } },
      },
      maintenance: { select: { maintenanceCode: true, id: true } },
      siteVisit: { select: { siteVisitCode: true, id: true } },
      installPlan: { select: { planCode: true, id: true } },
      project: { select: { projectCode: true } },
      etcTask: { select: { etcTaskCode: true, id: true } },
    },
  })
  if (!t) return { error: `티켓(${code})을 찾을 수 없습니다.` }
  const linked =
    t.maintenance ? { type: 'MAINTENANCE', code: t.maintenance.maintenanceCode, link: `/maintenances/${t.maintenance.id}` }
    : t.siteVisit ? { type: 'SITE_VISIT', code: t.siteVisit.siteVisitCode, link: `/site-visits/${t.siteVisit.id}` }
    : t.installPlan ? { type: 'INSTALL_PLAN', code: t.installPlan.planCode, link: `/install-plans/${t.installPlan.id}` }
    : t.project ? { type: 'PROJECT', code: t.project.projectCode, link: `/projects/${t.project.projectCode}` }
    : t.etcTask ? { type: 'ETC', code: t.etcTask.etcTaskCode, link: `/etc-tasks/${t.etcTask.id}` }
    : null
  return {
    ticketCode: t.ticketCode,
    title: t.title,
    status: t.status,
    severity: t.severity,
    queue: t.queue.name,
    ctiPath: t.cti
      ? [t.cti.parent?.parent?.name, t.cti.parent?.name, t.cti.name].filter(Boolean).join(' > ')
      : null,
    owner: t.owner?.name ?? null,
    participants: t.participants.map((p) => p.user.name),
    creator: t.creator?.name ?? null,
    hospital: t.hospital ? { code: t.hospital.hospitalCode, name: t.hospital.hospitalName } : null,
    pending: t.status === 'PENDING' ? { reason: t.pendingReason?.name ?? null, note: t.pendingNote } : undefined,
    createdAt: ymd(t.createdAt),
    dueAt: ymd(t.dueAt),
    resolvedAt: ymd(t.resolvedAt),
    closedAt: ymd(t.closedAt),
    reopenCount: t.reopenCount || undefined,
    description: stripHtml(t.descriptionHtml, 300),
    linkedWork: linked,
    parent: t.parent ? `${t.parent.ticketCode} ${t.parent.title}` : undefined,
    children: t.children.length ? t.children.map((c) => `${c.ticketCode} [${c.status}] ${c.title}`) : undefined,
    slaClocks: t.slaClocks.map((c) => ({
      metric: c.metric,
      statusScope: c.statusScope ?? undefined,
      state: c.state,
      dueAt: c.dueAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    })),
    recentLogs: t.logs.map((l) => ({
      date: ymd(l.createdAt),
      type: l.logType,
      author: l.author?.name ?? null,
      content: l.logType === 'comment' ? stripHtml(l.contentHtml, 150) : (l.payload ? JSON.stringify(l.payload).slice(0, 150) : null),
    })),
    link: `/tickets/${t.ticketCode}`, // 출처
  }
}

/** KST 오늘 00:00 */
function kstToday(): Date {
  const s = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  return new Date(s + 'T00:00:00+09:00')
}

async function listVehicleReservations(input: ToolInput) {
  const fromD = str(input.from) ? new Date(str(input.from)! + 'T00:00:00+09:00') : kstToday()
  const toD = str(input.to)
    ? new Date(str(input.to)! + 'T23:59:59+09:00')
    : new Date(fromD.getTime() + 7 * 86400000)
  const where = {
    status: 'RESERVED',
    startAt: { lt: toD },
    endAt: { gt: fromD },
    ...(str(input.vehicleName) && {
      vehicle: {
        OR: [
          { name: { contains: str(input.vehicleName)!, mode: 'insensitive' as const } },
          { plateNumber: { contains: str(input.vehicleName)! } },
        ],
      },
    }),
    ...(str(input.userName) && { user: { name: { contains: str(input.userName)! } } }),
  }
  const [total, rows] = await Promise.all([
    prisma.vehicleReservation.count({ where }),
    prisma.vehicleReservation.findMany({
      where,
      take: listLimit(input),
      orderBy: { startAt: 'asc' },
      include: {
        vehicle: { select: { name: true, plateNumber: true } },
        user: { select: { name: true } },
      },
    }),
  ])
  const now = new Date()
  return {
    ...listMeta(rows.length, total),
    period: `${kstMinute(fromD)} ~ ${kstMinute(toD)} (KST)`,
    link: '/vehicle-reservations', // 출처
    reservations: rows.map((r) => ({
      vehicle: `${r.vehicle.name}(${r.vehicle.plateNumber})`,
      user: r.user.name,
      start: kstMinute(r.startAt),
      end: kstMinute(r.endAt),
      purpose: r.purpose,
      destination: r.destination,
      returned: r.returnedAt ? '반납완료' : r.endAt < now ? '반납필요' : undefined,
    })),
  }
}

async function listVehicleLogs(input: ToolInput) {
  const where = {
    ...(str(input.vehicleName) && {
      vehicle: {
        OR: [
          { name: { contains: str(input.vehicleName)!, mode: 'insensitive' as const } },
          { plateNumber: { contains: str(input.vehicleName)! } },
        ],
      },
    }),
    ...(str(input.driverName) && { driver: { name: { contains: str(input.driverName)! } } }),
    ...dateRange(input, 'endAt'),
  }
  const full = isFull(input)
  const [agg, rows] = await Promise.all([
    prisma.vehicleLog.aggregate({ where, _count: { id: true }, _sum: { distanceKm: true } }),
    prisma.vehicleLog.findMany({
      where,
      take: listLimit(input),
      orderBy: { endAt: 'desc' },
      include: {
        vehicle: { select: { name: true, plateNumber: true } },
        driver: { select: { name: true } },
      },
    }),
  ])
  return {
    ...listMeta(rows.length, agg._count.id),
    totalDistanceKm: agg._sum.distanceKm ?? 0,
    link: '/vehicle-reservations', // 출처 (운행일지 탭)
    logs: rows.map((l) => ({
      vehicle: `${l.vehicle.name}(${l.vehicle.plateNumber})`,
      driver: l.driver.name,
      start: kstMinute(l.startAt),
      end: kstMinute(l.endAt),
      purpose: l.purpose,
      destination: l.destination,
      distanceKm: l.distanceKm,
      ...(full && { endOdometer: l.endOdometer, note: l.note }),
    })),
  }
}

async function searchUsers(input: ToolInput) {
  const query = str(input.query)
  const workType = str(input.workType)?.toUpperCase()
  const where = {
    isActive: true,
    ...(query && {
      OR: [
        { name: { contains: query, mode: 'insensitive' as const } },
        { department: { name: { contains: query, mode: 'insensitive' as const } } },
        { organization: { name: { contains: query, mode: 'insensitive' as const } } },
      ],
    }),
    ...(workType && { fieldEngineers: { some: { workType } } }),
  }
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      take: listLimit(input),
      orderBy: [{ organizationId: 'asc' }, { name: 'asc' }],
      // 연락처(이메일·전화)는 의도적으로 미반환 — 2026-07-27 사용자 결정
      select: {
        name: true,
        role: true,
        organization: { select: { name: true } },
        department: { select: { name: true } },
        fieldEngineers: { select: { workType: true } },
        inventoryManager: { select: { userId: true } },
      },
    }),
  ])
  const POOL_LABELS: Record<string, string> = {
    PROJECT: '프로젝트', INSTALL_PLAN: '설치계획', MAINTENANCE: '유지보수', ETC_TASK: '기타업무',
  }
  return {
    ...listMeta(rows.length, total),
    note: '연락처는 제공하지 않는다 (사내 정책)',
    users: rows.map((u) => ({
      name: u.name,
      organization: u.organization?.name ?? null,
      department: u.department?.name ?? null,
      role: u.role,
      workPools: u.fieldEngineers.length ? u.fieldEngineers.map((f) => POOL_LABELS[f.workType] ?? f.workType) : undefined,
      stockManager: u.inventoryManager ? true : undefined,
    })),
  }
}

async function listGatewayPlanJobs(input: ToolInput) {
  const query = str(input.query)
  const where = query ? { title: { contains: query, mode: 'insensitive' as const } } : {}
  const GW_STATUS_LABELS: Record<string, string> = {
    PENDING: '대기', RASTERIZING: '변환 중', ANALYZING: '분석 중',
    NEED_SCALE: '스케일 확정 대기', PLACED: '배치 완료', ERROR: '오류',
  }
  const [total, rows] = await Promise.all([
    prisma.gatewayPlanJob.count({ where }),
    prisma.gatewayPlanJob.findMany({
      where,
      take: listLimit(input),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, status: true, gatewayCount: true, scaleSource: true,
        analysis: true, createdAt: true,
        createdBy: { select: { name: true } },
      },
    }),
  ])
  return {
    ...listMeta(rows.length, total),
    jobs: rows.map((j) => {
      const spaces = (j.analysis as { spaces?: unknown[] } | null)?.spaces
      return {
        title: j.title,
        status: GW_STATUS_LABELS[j.status] ?? j.status,
        gatewayCount: j.gatewayCount,
        spacesDetected: Array.isArray(spaces) ? spaces.length : undefined,
        scaleSource: j.scaleSource ?? undefined,
        createdBy: j.createdBy.name,
        createdAt: ymd(j.createdAt),
        link: `/gateway-planner/${j.id}`, // 출처
      }
    }),
  }
}

/** 도구 실행 디스패처 — 실패는 throw하지 않고 error 객체 반환 (agent가 is_error로 전달) */

// ===== 영업/CRM 도구 (v4 — 사용자별 권한 게이트) =====

/**
 * 영업 데이터는 UI와 동일하게 checkSalesAccess로 사용자별 재검증한다
 * (어시스턴트는 SEERS USER 이상 전원 사용 — 임시 SUPER_ADMIN 제한의 권한 우회 방지).
 * 통과 시 null, 차단 시 도구 응답용 에러 객체.
 */
async function salesGate(user?: JWTPayload): Promise<{ error: string } | null> {
  if (!user) return { error: '영업 정보 조회 권한을 확인할 수 없습니다.' }
  const denial = await checkSalesAccess(user)
  if (denial) return { error: `${denial.error} 영업 기능이 정식 오픈되면 접근 범위가 완화됩니다.` }
  return null
}

const amt = (v: bigint | null) => (v === null ? null : Number(v))

async function getHospitalSales(input: ToolInput) {
  const hospitalCode = str(input.hospitalCode)
  if (!hospitalCode) return { error: 'hospitalCode가 필요합니다. search_hospitals로 먼저 조회하세요.' }
  const hospital = await prisma.hospital.findUnique({
    where: { hospitalCode },
    select: {
      hospitalCode: true, hospitalName: true, introBeds: true,
      salesProfile: {
        include: {
          stage: { select: { name: true } },
          owner: { select: { name: true } },
        },
      },
      personAffiliations: {
        where: { isCurrent: true },
        orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
        take: 15,
        include: { person: { include: { personGroup: { select: { name: true } } } } },
      },
      salesDeals: {
        orderBy: { roundNo: 'asc' },
        include: {
          status: { select: { name: true } },
          hospitalModel: { select: { name: true } },
          seersModel: { select: { name: true } },
          taxInvoice: { select: { name: true } },
          settlement: { select: { name: true } },
          project: { select: { projectName: true } },
        },
      },
      salesActivities: {
        orderBy: [{ activityDate: 'desc' }, { id: 'desc' }],
        take: 5,
        include: { activityType: { select: { name: true } }, author: { select: { name: true } } },
      },
    },
  })
  if (!hospital) return { error: '병원을 찾을 수 없습니다.' }
  const p = hospital.salesProfile
  const totalBeds = p?.totalBeds ?? null
  return {
    hospital: hospital.hospitalName,
    profile: {
      stage: p?.stage?.name ?? null,
      owner: p?.owner?.name ?? null,
      totalBeds,
      totalWards: p?.totalWards ?? null,
      introBeds: hospital.introBeds,
      penetrationPct: totalBeds && totalBeds > 0 && hospital.introBeds !== null ? Math.round((hospital.introBeds / totalBeds) * 1000) / 10 : null,
      memo: p?.salesMemo ?? null,
    },
    persons: hospital.personAffiliations.map((a) => ({
      name: a.person.name,
      group: a.person.personGroup?.name ?? null,
      title: a.title,
      department: a.department,
      specialty: a.person.specialty,
      isPrimary: a.isPrimary,
    })),
    deals: hospital.salesDeals.map((d) => ({
      round: d.roundNo,
      dealCode: d.dealCode,
      status: d.status?.name ?? null,
      hospitalModel: d.hospitalModel?.name ?? null,
      seersModel: d.seersModel?.name ?? null,
      contractDate: ymd(d.contractDate),
      wards: d.wardCount,
      beds: d.bedCount,
      wardsText: d.wardsText,
      amountProduct: amt(d.daewoongAmountProduct),
      amountConstruction: amt(d.daewoongAmountConstruction),
      amountActual: amt(d.daewoongAmountActual),
      taxInvoice: d.daewoongTaxInvoice,
      settlement: d.daewoongSettlement,
      project: d.project?.projectName ?? null,
    })),
    recentActivities: hospital.salesActivities.map((a) => ({
      date: ymd(a.activityDate),
      type: a.activityType?.name ?? null,
      author: a.author?.name ?? null,
      content: stripHtml(a.content, 150),
    })),
    link: `/hospitals/${hospital.hospitalCode}`,
  }
}

async function listSalesDeals(input: ToolInput) {
  const limit = int(input.limit, 10, 1, 30)
  const detail = str(input.detail) === 'full' ? 'full' : 'summary'
  const modelName = str(input.modelName)
  const from = str(input.contractFrom)
  const to = str(input.contractTo)
  const where = {
    ...(str(input.statusName) && { status: { name: { contains: str(input.statusName)! } } }),
    ...(modelName && { OR: [{ hospitalModel: { name: { contains: modelName } } }, { seersModel: { name: { contains: modelName } } }] }),
    ...(str(input.hospitalName) || str(input.sido)
      ? { hospital: {
          ...(str(input.hospitalName) && { hospitalName: { contains: str(input.hospitalName)! } }),
          ...(str(input.sido) && { sidoName: { contains: str(input.sido)! } }),
        } }
      : {}),
    ...((from || to) && { contractDate: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to + 'T23:59:59Z') }) } }),
  }
  const [total, sums, rows] = await Promise.all([
    prisma.salesDeal.count({ where }),
    prisma.salesDeal.aggregate({ where, _sum: { daewoongAmountActual: true, daewoongAmountProduct: true, daewoongAmountConstruction: true, bedCount: true, wardCount: true } }),
    prisma.salesDeal.findMany({
      where,
      orderBy: [{ contractDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: limit,
      include: {
        status: { select: { name: true } },
        hospitalModel: { select: { name: true } },
        seersModel: { select: { name: true } },
        taxInvoice: { select: { name: true } },
        settlement: { select: { name: true } },
        hospital: { select: { hospitalName: true, sidoName: true } },
      },
    }),
  ])
  return {
    total,
    totals: {
      amountActual: amt(sums._sum.daewoongAmountActual),
      amountProduct: amt(sums._sum.daewoongAmountProduct),
      amountConstruction: amt(sums._sum.daewoongAmountConstruction),
      beds: sums._sum.bedCount,
      wards: sums._sum.wardCount,
    },
    deals: rows.map((d) => ({
      hospital: d.hospital.hospitalName,
      sido: d.hospital.sidoName,
      round: d.roundNo,
      status: d.status?.name ?? null,
      hospitalModel: d.hospitalModel?.name ?? null,
      contractDate: ymd(d.contractDate),
      beds: d.bedCount,
      amountActual: amt(d.daewoongAmountActual),
      ...(detail === 'full' && {
        dealCode: d.dealCode,
        seersModel: d.seersModel?.name ?? null,
        wards: d.wardCount,
        wardsText: d.wardsText,
        deptsText: d.deptsText,
        amountProduct: amt(d.daewoongAmountProduct),
        amountConstruction: amt(d.daewoongAmountConstruction),
        taxInvoice: d.daewoongTaxInvoice,
        settlement: d.daewoongSettlement,
        remark: d.remark,
      }),
    })),
    link: '/sales/deals',
  }
}

async function getSalesSummary() {
  const [deals, profiles] = await Promise.all([
    prisma.salesDeal.findMany({
      include: {
        status: { select: { name: true } },
        hospitalModel: { select: { name: true } },
        hospital: { select: { sidoName: true } },
      },
    }),
    prisma.hospitalSalesProfile.findMany({ include: { stage: { select: { name: true, order: true } } } }),
  ])
  const completed = deals.filter((d) => d.status?.name === '계약완료')
  const perHosp = new Map<string, number>()
  completed.forEach((d) => perHosp.set(d.hospitalCode, (perHosp.get(d.hospitalCode) ?? 0) + 1))
  const count = (map: Map<string, number>, k: string) => map.set(k, (map.get(k) ?? 0) + 1)
  const stageMap = new Map<string, number>()
  profiles.forEach((pf) => { if (pf.stage) count(stageMap, pf.stage.name) })
  const modelMap = new Map<string, number>()
  completed.forEach((d) => count(modelMap, d.hospitalModel?.name ?? '미지정'))
  const regionMap = new Map<string, number>()
  completed.forEach((d) => regionMap.set(d.hospital.sidoName ?? '기타', (regionMap.get(d.hospital.sidoName ?? '기타') ?? 0) + (amt(d.daewoongAmountActual) ?? 0)))
  return {
    kpi: {
      adoptedHospitals: perHosp.size,
      expandedHospitals: Array.from(perHosp.values()).filter((c) => c >= 2).length,
      completedDeals: completed.length,
      activeDeals: deals.filter((d) => d.status?.name === '영업중' || !d.status).length,
      bedsSum: completed.reduce((a, d) => a + (d.bedCount ?? 0), 0),
      amountActualSum: completed.reduce((a, d) => a + (amt(d.daewoongAmountActual) ?? 0), 0),
      amountSaleSum: completed.reduce((a, d) => a + (amt(d.daewoongAmountProduct) ?? 0) + (amt(d.daewoongAmountConstruction) ?? 0), 0),
    },
    stageDist: Array.from(stageMap.entries()).map(([name, n2]) => ({ stage: name, hospitals: n2 })),
    modelDist: Array.from(modelMap.entries()).map(([name, n2]) => ({ model: name, deals: n2 })).sort((a, b) => b.deals - a.deals),
    regionTop5: Array.from(regionMap.entries()).map(([name, actual]) => ({ sido: name, amountActual: actual })).sort((a, b) => b.amountActual - a.amountActual).slice(0, 5),
    link: '/sales/dashboard',
  }
}

export async function executeTool(name: string, input: ToolInput, user?: JWTPayload): Promise<unknown> {
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
      case 'read_consultations':
        return await readConsultations(input)
      case 'read_hospital_note':
        return await readHospitalNote(input)
      case 'search_inventory_items':
        return await searchInventoryItems(input)
      case 'get_stock_summary':
        return await getStockSummary(input)
      case 'list_stock_transactions':
        return await listStockTransactions(input)
      case 'find_serial_unit':
        return await findSerialUnit(input)
      case 'list_tickets':
        return await listTickets(input)
      case 'get_ticket':
        return await getTicket(input)
      case 'list_vehicle_reservations':
        return await listVehicleReservations(input)
      case 'list_vehicle_logs':
        return await listVehicleLogs(input)
      case 'search_users':
        return await searchUsers(input)
      case 'list_gateway_plan_jobs':
        return await listGatewayPlanJobs(input)
      case 'get_hospital_sales':
      case 'list_sales_deals':
      case 'get_sales_summary': {
        const denied = await salesGate(user)
        if (denied) return denied
        if (name === 'get_hospital_sales') return await getHospitalSales(input)
        if (name === 'list_sales_deals') return await listSalesDeals(input)
        return await getSalesSummary()
      }
      default:
        return { error: `알 수 없는 도구: ${name}` }
    }
  } catch (e) {
    console.error(`[ai-tool] ${name} 실행 실패:`, e)
    return { error: '조회 중 오류가 발생했습니다. 조건을 바꿔 다시 시도하세요.' }
  }
}
