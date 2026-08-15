# CS 티켓 워크플로 — 운영시스템 개선방안 설계

> 작성일: 2026-08-14 · 상태: **P0~P3 구현 완료 (dev2, 2026-08-15) — PROD 미반영**
> **개정 (2026-08-15 사용자 결정)**: ① **콜기록지(P1) 기능 제거** — 콜센터 원장 불요, CS 접수는 VOC 직접 등록으로 시작 (§4의 원장·승격 모델 폐기, `call_logs` 드랍). ② **VOC 담당자 N:M 제거** — 배정은 티켓이 단독 소유, 도메인에는 생성자(`created_by_id`)만 기록 (§5.1의 assignees·D5 무효). 마이그레이션 `20260815120000_cs_drop_call_logs_voc_creator`
> 구현 확정 사항: D1 기존 5종 전부 어댑터 이관 / D2 콜 승격은 VOC 단일 경유 / D3 콜기록↔티켓 N:1 / D4 콜기록 상태 2값 / D5 VOC 담당 후보 SEERS 전체 / D6 §5.1 초기값 시드 / D7 nav 티켓 옆 '콜 기록'·유지보수 앞 'VOC 접수' (2026-08-15 사용자 승인)
> 검증: tsc 0오류 · `scripts/cs-workflow-smoke.mts` 24/24 · `scripts/ticket-cti-rules-smoke.mts` 36/36 (VOC 규칙 포함)
> 구현 편차: SLA DOMAIN_DUE 앵커·workItemReassign은 어댑터 미편입 유지(§3.2 인터페이스 주석 참조 — 정적 Prisma select 타입 보존·도메인 테이블 직접 조작이라 티켓 지식 아님). 배지 색상은 Tailwind content 글롭(app/**만 스캔) 제약으로 TicketRefTypeBadge에 잔류하되 Record<DomainRefType,…> 타입으로 누락 시 컴파일 오류.
> 범위: ① 티켓 도메인 편입 구조의 플러그인화(어댑터 레지스트리) ② 콜기록지(Call Log) 원장 모듈 ③ 신규 도메인 'VOC접수'(CS 마스터 티켓) ④ 마스터 티켓 하위 도메인 티켓 생성
> 열람용 사본: `cs_ticket_workflow_design.html`

---

## 1. 취지 및 목적

### 1.1 배경

1.0 티켓 시스템(P1~P13)은 기존 업무 5종(유지보수·기타업무·답사·설치계획·프로젝트)을 티켓으로 편입해 **"흩어진 업무의 통합 추적 뷰"** 를 완성했다. 이번 개선의 목적은 그 다음 단계 — **CS(고객 대응) 업무를 티켓 기반 서비스 워크플로로 재편**하는 것이다. 모델은 AWS SIM의 운영 방식이다:

- 고객 관점의 사건 1건 = **마스터 티켓 1건** (VOC접수)
- 사건을 해결하기 위한 개별 작업 = **하위 티켓 N건** (유지보수·분석·기타), 마스터 아래 **평면(2레벨)** 배치
- 접수 채널(콜센터)의 원천 기록은 티켓과 분리된 **원장(콜기록지)** 으로 유지하고, 추적할 가치가 있는 건만 사람 판단으로 티켓에 편입

### 1.2 목적 3가지

| # | 목적 | 성공 기준 |
|---|---|---|
| 1 | **도메인 증설의 플랫폼화** — 신규 업무의 티켓 편입 비용을 구조적으로 낮춤 | 신규 도메인 1종 추가 시 티켓 시스템 공용 코드 수정이 "어댑터 파일 1개 + 레지스트리 1줄 + 마스터 데이터"로 수렴. VOC접수가 첫 검증 사례 |
| 2 | **CS 사건의 단일 추적점** — 콜 접수부터 하위 작업 완료까지 마스터 티켓 한 화면에서 파악 | 마스터 티켓 상세에서 연결 콜 이력·하위 티켓 현황이 모두 보임 |
| 3 | **콜센터 대응 원장 확보** — 단순문의 포함 인바운드 콜 전건의 기록·통계 기반 마련 | 콜기록지에 전건 기록, 승격률·유형 분포를 후속 통계로 산출 가능 |

### 1.3 왜 이 방향인가

**(a) 도메인은 계속 늘어난다 — 편입 비용이 구조 문제가 되는 시점.**
당장 VOC접수가 6번째 도메인으로 예정되어 있고, CS 워크플로가 자리잡으면 후속 편입(예: 정기점검, 교육 요청 등)이 반복될 것이 자명하다. 현재 구조는 도메인 1종 추가에 **공용 코드 8곳 이상의 산재 수정**이 필요하다(§2 실측). 5종까지는 감내했지만 6종째부터는 수정 누락이 곧 버그가 되는 구조다. switch/화이트리스트에 흩어진 도메인 지식을 **어댑터 1파일로 응집**시키면, 도메인 추가·폐기가 국소 변경이 되고 기존 5종의 동작은 그대로 보존된다(리팩토링은 동작 불변).

**(b) 티켓 = 균질 껍데기, 도메인 레코드 = 원본(System of Record).**
2026-08-14 논의에서 확정한 원칙. 업무 고유 필드·워크플로는 도메인 레코드가 갖고, 티켓은 접수·라우팅·상태 추적의 균질한 그림자다. VOC접수도 이 원칙대로 **도메인 레코드로 신설**하고(고유 필드·워크플로 상태 보유), 그 연결 티켓이 CS 마스터가 된다. refType(구조 축)과 CTI(분류 축)의 분리도 유지한다.

**(c) 콜기록지는 티켓이 아니다 — 원장·승격 모델.**
콜센터의 목적은 인바운드 콜 대응이지 CS 접수가 아니다. 단순문의가 다수인 콜 전건에 티켓을 자동 발행하면 티켓 시스템이 노이즈로 오염되고 SLA·지표가 무의미해진다. 콜기록지는 승격 여부와 무관하게 보존되는 **영구 원장**이고, CS 처리가 필요한 소수 건만 **승격**(VOC접수 생성) 또는 **연결**(기존 사건 재콜)로 티켓에 편입한다. 메일큐→설치계획 승격이 이미 검증한 패턴이되, 메일큐(소모성 대기열)와 달리 콜기록지는 원장으로 남는 점이 다르다.

**(d) 계층은 마스터 1 + 하위 N 평면(2레벨 고정 유지).**
"2차 티켓·3차분석 티켓"은 시간적 단계이지 소유 관계가 아니다. 깊은 트리는 사건 전체 그림을 한 화면에서 못 보게 한다. 기존 2레벨 검증·마스터 자동종결 규칙을 그대로 활용한다(A안, 2026-08-14 확정).

---

## 2. 현재 구조 진단 — 도메인 1종 추가의 실측 비용

2026-08-14 코드 실측. 신규 도메인 1종을 지금 구조에서 편입하면 손대는 곳:

| # | 위치 | 내용 | 성격 |
|---|---|---|---|
| 1 | `prisma/schema.prisma` | 도메인 테이블 + `Ticket` 모델에 1:1 역관계 추가 | 불가피 (도메인 고유) |
| 2 | `lib/ticketDomain.ts` (~1,140줄) | `createTicketForX`·`syncXToTicket`·`syncTicketToX` + 상태 폴백 함수 4~6개 신규 작성, `syncTicketToDomain()` if-분기 추가 | **산재 — 개선 대상** |
| 3 | `app/api/tickets/route.ts:41` | refType 화이트리스트 배열에 값 추가 | 산재 |
| 4 | `app/tickets/components/TicketRefTypeBadge.tsx` | `TICKET_REF_TYPE_META`에 배지 항목 추가 (LinkedWorkBanner도 이 메타 공유) | 산재 |
| 5 | `app/tickets/[code]/page.tsx` | 연결 도메인 include + LinkedWorkBanner href·메타 분기 추가 | 산재 |
| 6 | `lib/notifyFields.ts` | `refTypeToTaskType` 매핑 + 라벨 추가 (알림 필드 카탈로그) | 산재 |
| 7 | `lib/sla.ts:76` | `DOMAIN_DUE` 앵커 switch 분기 (기한 필드가 있는 도메인) | 산재 |
| 8 | `lib/workItemReassign.ts` | 담당 재배정 분기 (담당자 N:M 도메인) | 산재 |
| 9 | `ticket_domain_cti_rules` + `scripts/seed-ticket-masters.sql` | CTI 자동생성 규칙 행 | 마스터 데이터 (규칙 5 — 유지) |
| 10 | `status_codes` 워크플로 카테고리 + `ticket_status` 매핑 + 설정 페이지 + `seed-ticket-status-map.sql` | 도메인 워크플로 상태 마스터 (규칙 6 — 유지) | 마스터 데이터 (유지) |
| 11 | 도메인 자체 CRUD API·페이지·nav | 도메인 고유 화면 | 불가피 (도메인 고유) |

**문제의 본질**: #2~#8이 "이 refType이면 이렇게"라는 동일한 지식을 7곳의 switch·배열·객체 리터럴에 중복 기술하고 있다. 추가 시 한 곳이라도 누락하면 컴파일은 통과하고 런타임에서 조용히 빠진다(배지 미표시, 알림 라벨 누락, SLA 앵커 미적용 등). 삭제(도메인 폐기)는 더 위험해서 사실상 시도된 적이 없다.

---

## 3. 설계 ① — 티켓 도메인 어댑터 레지스트리 (P0)

### 3.1 구조

도메인별 지식을 **어댑터 1파일**에 응집하고, 공용 코드는 레지스트리 조회로 전환한다. 서버 전용 로직(Prisma 트랜잭션)과 클라이언트 안전 메타(배지·라벨·링크)를 분리한다 — 배지 컴포넌트가 클라이언트 컴포넌트이기 때문.

```
lib/ticket-domains/
├── types.ts            # TicketDomainMeta·TicketDomainAdapter 인터페이스
├── meta.ts             # [클라이언트 안전] 전 도메인 메타 배열 — 배지·필터·배너가 순회
├── registry.ts         # [서버] 어댑터 조립 — getDomainAdapter(refType)·DOMAIN_REF_TYPES
├── maintenance.ts      # [서버] 기존 lib/ticketDomain.ts 유지보수 블록 이관
├── etcTask.ts
├── siteVisit.ts
├── installPlan.ts
├── project.ts
└── voc.ts              # (P2) 신규 — VOC접수
```

### 3.2 인터페이스 (안)

```typescript
// types.ts — 클라이언트 안전 메타
export type TicketDomainMeta = {
  refType: string                        // 'MAINTENANCE' | ... | 'VOC'
  label: string                          // '유지보수'
  badge: { bg: string; text: string }    // TicketRefTypeBadge 톤
  codePrefix: string                     // 'MNT' — 참고용 (발번은 도메인 측)
  detailHref: (refCode: string) => string // 연결 업무 배너·목록 링크
  taskType: string | null                // notifyFields 업무 타입 매핑 (없으면 null)
  filterLabel?: string                   // 티켓 목록 유형 필터 표기 (기본 label)
}

// types.ts — 서버 어댑터
export interface TicketDomainAdapter {
  meta: TicketDomainMeta
  statusCategory: string | null          // StatusCode 워크플로 카테고리 (매핑 검증용)
  /** 도메인 생성 트랜잭션 안에서 연결 티켓 생성 (기존 createTicketForX) */
  createTicket(tx: Tx, domainRecord: unknown, actorId: string | null, via: 'domain' | 'backfill'): Promise<number>
  /** 도메인 변경 → 티켓 동기화 (기존 syncXToTicket) */
  syncDomainToTicket(tx: Tx, domainId: number, actorId: string | null): Promise<void>
  /** 티켓 변경 → 도메인 역동기화 (기존 syncTicketToX) */
  syncTicketToDomain(tx: Tx, ticketId: number): Promise<void>
  /** SLA DOMAIN_DUE 앵커 (기한 개념이 없으면 미구현) */
  dueAnchor?(ticket: TicketForSla): Date | null
  /** 티켓 상세 연결 배너 데이터 (refCode·부가 메타 로드) */
  loadBanner?(ticketId: number): Promise<LinkedWorkData | null>
  /** 담당 재배정 훅 (담당자 N:M 도메인만) */
  reassign?(tx: Tx, ticketId: number, userIds: string[]): Promise<void>
  /** (P3) 마스터 하위 생성 — 도메인 등록 폼 진입점 + 마스터 티켓 기반 프리필 */
  childCreate?: {
    formPath: string                                     // 예: '/maintenances/new'
    prefill(master: TicketCore): Record<string, unknown> // hospitalCode·신고자 등
  }
}
```

### 3.3 소비처 전환

| 소비처 | 현재 | 전환 후 |
|---|---|---|
| `syncTicketToDomain()` if-체인 | refType 5분기 하드코딩 | `getDomainAdapter(refType)?.syncTicketToDomain(...)` |
| 티켓 목록 refType 필터 화이트리스트 | 배열 리터럴 | `DOMAIN_REF_TYPES` (meta 순회) |
| `TICKET_REF_TYPE_META` (배지·배너 톤) | 객체 리터럴 | `meta.ts` 순회 생성 |
| 목록 필터 셀렉트 옵션 | JSX 하드코딩 | `meta.ts` 순회 |
| `refTypeToTaskType` | switch | `meta.taskType` |
| SLA `DOMAIN_DUE` 앵커 switch | switch | `adapter.dueAnchor?.()` |
| 티켓 상세 연결 배너 include·분기 | 페이지 내 분기 | `adapter.loadBanner?.()` |
| 담당 재배정 분기 | 분기 | `adapter.reassign?.()` |

`lib/ticketDomain.ts`는 공용 유틸(코드 발번·상태 매핑 해석·`resolveRuleWithFallback`·자동종결 배치)만 남기고, 도메인별 블록은 각 어댑터 파일로 **동작 불변 이관**한다. 기존 export 시그니처는 어댑터를 재-export하는 얇은 별칭으로 유지해 도메인 CRUD 라우트의 import 변경을 최소화한다(호출부 일괄 수정은 선택).

### 3.4 도메인 추가 절차 (P0 산출물 — SOP)

P0 완료 시 아래 체크리스트가 문서화되고, VOC접수(P2)가 첫 적용 사례로 절차를 검증한다:

1. Prisma — 도메인 테이블 + `Ticket` 1:1 역관계, 수동 마이그레이션 패턴
2. 워크플로 상태 마스터 — StatusCode 카테고리 + `ticket_status` 매핑 + `seed-ticket-status-map.sql` (규칙 6)
3. CTI 자동생성 규칙 — `ticket_domain_cti_rules` 행 + `seed-ticket-masters.sql` (규칙 5)
4. **어댑터 파일 1개** 작성 + `registry.ts`·`meta.ts` 등록 (여기까지가 티켓 시스템 편입의 전부)
5. 도메인 CRUD API·페이지·nav — 생성/수정 트랜잭션에서 어댑터 `createTicket`/`syncDomainToTicket` 호출
6. 검증 — tsc·전이 왕복 스모크(도메인→티켓·티켓→도메인)·배지/배너/필터 표시 확인

### 3.5 도메인 폐기 정책

- 어댑터 제거 = **신규 생성·동기화 중단**. 기존 티켓의 `refType` 문자열·도메인 데이터는 보존(비소급 원칙 일관)
- 미등록 refType에 대한 공용 코드 동작을 명시적으로 정의: 배지는 회색 폴백, 배너 생략, sync no-op, 필터 목록 미노출. 현재도 `TicketRefTypeBadge`에 fallback이 있으나 폴백 계약을 레지스트리 차원으로 일반화
- CLAUDE.md 티켓 규칙 3의 문구를 "도메인↔티켓 동기화는 **도메인 어댑터** 경유"로 개정 (P0 완료 시)

---

## 4. 설계 ② — 콜기록지(Call Log) 원장 모듈 (P1)

### 4.1 전체 흐름

```
[인바운드 콜]
     │ 상담원이 전건 기록
     ▼
콜기록지 (call_logs — 영구 원장, 티켓 아님)
     ├─ 단순문의 → 즉답 종결 (대다수, 여기서 끝)
     ├─ 콜백 필요 → OPEN 유지 → 콜백 후 종결
     └─ CS 처리 필요
           ├─ [승격] VOC접수 생성 → 연결 티켓(refType 'VOC') = CS 마스터
           └─ [연결] 기존 마스터 티켓에 연결 (같은 사건 재콜)
                 ▼
        CS 마스터 티켓 (VOC)
           ├─ 하위: 유지보수 티켓 (도메인)
           ├─ 하위: 분석 티켓 (순수)
           └─ … (평면 2레벨)
```

### 4.2 기존 기능과의 경계 (중복 검토)

| 기존 기능 | 경계 |
|---|---|
| **상담이력** (`Consultation`, `CS-` 코드) | AI 어시스턴트 상담 정리 산출물 — 별개. `CS-` prefix 선점으로 콜기록지는 `CALL-` 사용. 통합·변환 없음 |
| **메일큐** (설치계획·답사 승격) | 승격 패턴 선례(프리필 생성 + 원본에 결과 FK). 차이: 메일큐는 소모성, 콜기록지는 영구 원장 |
| **유지보수 `reporterName`·`reportedAt`** | 하위 유지보수 생성 시(P3) 콜기록의 발신자·수신일시 프리필 — 원천→도메인 복사이지 중복 아님 |

### 4.3 데이터 모델 — `call_logs` (public)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | SERIAL PK | |
| `call_code` | VARCHAR(20) UNIQUE | `CALL-YYYYMM-NNNNN` (KST, 설치계획 발번 패턴) |
| `received_at` | TIMESTAMP NOT NULL | 수신 일시 (기본 now) |
| `direction` | TEXT DEFAULT 'IN' | `IN` 인바운드 / `OUT` 콜백 발신 기록 |
| `received_by_id` | TEXT FK→users | 기록자 = 상담원 |
| `hospital_code` | TEXT NULL FK→hospitals | 미상·비고객 콜은 NULL |
| `hospital_name_raw` | TEXT NULL | 병원 미등록 시 문자열 (답사큐 선례) |
| `caller_name` / `caller_phone` | TEXT NULL | 발신자 |
| `inquiry_type_id` | INT NULL FK→status_codes | 문의 유형 — 카테고리 `CALL_INQUIRY_TYPE` 신설 |
| `content` | TEXT NOT NULL | 문의·대응 내용 (plain text — 빠른 입력 우선, 에디터 미사용) |
| `status` | TEXT DEFAULT 'DONE' | `DONE` 종결 / `OPEN` 콜백 등 후속 대기 — **2값뿐** |
| `ticket_id` | INT NULL FK→tickets (SetNull, **UNIQUE 아님**) | 승격/연결된 마스터 티켓 — N:1 |
| `created_at` / `updated_at` | | |

인덱스: `received_at`·`hospital_code`·`status`·`ticket_id`

- 콜기록지는 **워크플로가 아니라 기록** — 상태 축을 2값으로 고정하고, 추적이 필요한 건 티켓으로 승격하는 것이 이 설계의 요지. `ticket_status` 매핑 대상 아님(WorkflowStatusManager 불사용)
- 문의 유형 초기값(안): 단순문의 / 사용법 문의 / 장애 신고 / 불만(VOC) / 영업 문의 / 오인입·기타 — 콜센터 실기록지와 대조 후 확정

### 4.4 콜기록 ↔ 티켓 관계 (N:1)

같은 사건의 재콜은 CS의 일상이다. 재콜마다 티켓을 만들면 사건이 분산되므로, 재콜은 **새 콜기록 + 기존 마스터 티켓 연결**로 기록한다.

| 액션 | 동작 |
|---|---|
| **승격** | VOC접수 등록 모달(§5) 프리필 오픈 → 생성 트랜잭션에서 VOC 레코드 + 연결 티켓 생성(어댑터) + `call_logs.ticket_id` 설정 + 콜기록 `DONE` + 티켓 이벤트 `created(via:'call_log', callCode)` |
| **연결** | 티켓 검색(코드·제목·병원, 서브 티켓 제외) → `ticket_id` 설정 + `DONE` + 티켓 이벤트 `link(event:'call_linked', callCode)` |
| **해제** | `ticket_id` NULL + 이벤트 (오연결 정정, ADMIN) |

- **티켓 상세**: 연결 콜 기록 패널(수신일시·상담원·발신자·요약) — "고객이 언제 몇 번 전화했는지"가 마스터 티켓 한 화면에 보이는 것이 목적 2의 핵심
- **콜기록 목록·상세**: 연결 티켓 코드 배지·링크

### 4.5 모듈 구성

- **페이지 `/call-logs`** — 목록 단일 페이지 + 등록/수정 모달 (별도 상세 페이지 없음, 빠른 기록 최우선)
  - 기본 오늘 수신분·최신순. 필터: 기간·병원·유형·상태·상담원
  - `OPEN`(콜백 대기) 상단 고정 섹션 — 잊힌 콜백 방지
  - 행 액션: 수정 · VOC 승격 · 기존 티켓 연결 · 티켓 바로가기
- **API**: `GET/POST /api/call-logs` · `GET/PUT/DELETE /api/call-logs/[id]` · `POST /api/call-logs/[id]/ticket` (`mode: 'link' | 'unlink'` — 승격은 VOC 등록 API가 `callLogId`를 받아 처리)
- **설정**: `/settings/call-inquiry-type` (StatusCodeManager 재사용, ADMIN)
- **권한(안)**: 조회 로그인 전체 / 등록·수정 USER 이상(수정은 작성자 본인 또는 ADMIN) / 삭제 ADMIN. RBAC 키는 콜센터 인원 구성 확인 후 필요 시 카탈로그 추가
- **알림**: 승격 티켓은 기존 `notifyTicketCreated` 파이프라인 자동(규칙 1). 콜기록 자체 알림 없음. 감사 로그: 등록·수정·삭제·승격·연결

---

## 5. 설계 ③ — 신규 도메인 'VOC접수' (P2)

CS 사건의 원본 레코드이자 **마스터 티켓의 실체**. 어댑터 구조(P0)의 첫 적용 사례로, "도메인 추가 절차(§3.4)"를 그대로 밟아 구조를 검증한다.

### 5.1 데이터 모델 — `voc_receipts` (안)

| 컬럼 | 설명 |
|---|---|
| `voc_code` UNIQUE | `VOC-YYYYMM-NNNN` (유지보수 발번 패턴) |
| `hospital_code` NULL FK / `hospital_name_raw` | 비고객 VOC 허용 (콜기록지와 동일 원칙) |
| `customer_name` / `customer_phone` | 고객(제기자) |
| `channel_id` FK→status_codes | 접수 채널 — 카테고리 `VOC_CHANNEL` (전화/메일/방문/기타). 콜 승격 시 '전화' 자동 |
| `voc_type_id` FK→status_codes | VOC 분류 — 카테고리 `VOC_TYPE` (불만/장애/요청/문의/칭찬 등 — 검토 시 확정) |
| `title` / `content` | 제목·내용 (content plain text) |
| `status_id` FK→status_codes | 워크플로 상태 — 카테고리 `VOC_STATUS` + **`ticket_status` 매핑 필수** (규칙 6, API 400 강제) |
| `status_changed_at` | 단계 체류 추적 (기존 도메인 패턴) |
| `resolution` | 처리 결과 요약 (Tiptap — 유지보수 `resolution` 선례) |
| `received_at` | 접수 일시 |
| `ticket_id` UNIQUE FK→tickets | 연결 티켓 (도메인 1:1 패턴) |
| 담당자 | `voc_receipt_assignees` N:M (기존 Assignee 패턴) |

- 워크플로 상태(안): **접수 → 처리중 → 회신완료 → 종결** + 보류 — 값·매핑은 검토 시 확정
- 연결 티켓: `refType 'VOC'` · CTI 규칙 행 `VOC`(조건 축 `voc_type_id`) · Assignment Group 기본값은 규칙으로 지정
- 첨부파일: 초기 미도입 — 필요 시 기존 `*File` 패턴 후속 (빈 기능 선탑재 금지)

### 5.2 화면

- `/voc` 목록(필터: 기간·병원·분류·상태·담당) + 등록·상세. 상세에 **하위 티켓 현황 패널**(P3)과 연결 콜 이력
- 설정: `/settings/voc-status`(WorkflowStatusManager — 티켓 상태 매핑 포함)·`/settings/voc-type`·채널은 초기 시드 후 필요 시 관리 화면
- `field_engineers` 풀 편입 여부는 초기 보류 — 담당 후보는 SEERS 사용자 전체로 시작 (D5)

### 5.3 마스터 티켓으로서의 역할

- VOC 연결 티켓은 하위 티켓의 `parentId` 대상이 된다. VOC 티켓 자체는 서브가 될 수 없도록 유지(2레벨 규칙이 이미 보장)
- 마스터 자동종결 규칙(열린 서브 있으면 스킵) 그대로 적용 — VOC 종결은 하위 완료 후에만 자연 성립

---

## 6. 설계 ④ — 마스터 하위 도메인 티켓 생성 (P3, A안)

### 6.1 원칙

하위 티켓이 도메인 업무(유지보수 등)라면 **티켓을 먼저 만들지 않는다** — 기존 도메인 생성 경로에 `parentTicketId` 옵션을 추가하고, 도메인 생성 트랜잭션이 만든 연결 티켓에 `parentId`를 설정한다. 도메인 검증·발번·프리필은 기존 경로가 전부 보장한다.

### 6.2 구현

- **도메인 POST 확장**: `parentTicketId?: number` — 유효성(존재·2레벨·CLOSED 아님) 검증 후, 어댑터 `createTicket`이 만든 티켓에 `parentId` 설정 + link 이벤트 2건(기존 parent API와 동일 페이로드). 유지보수부터 적용, 이후 도메인은 어댑터 `childCreate` 구현 시 자동 노출
- **UI**: 마스터 티켓 상세(및 VOC 상세) "하위 티켓 생성" → 유형 선택(순수 티켓 / `childCreate` 구현 도메인 목록 — 레지스트리 순회) →
  - 순수 티켓: 기존 티켓 생성 폼 + `parentId` (현행 지원)
  - 도메인: 해당 등록 폼으로 이동(`formPath` + 쿼리 `parentTicketId`) — 어댑터 `prefill`이 병원·신고자·수신일시 등 매핑
- 하위 현황 패널: 마스터 티켓 상세의 기존 서브 티켓 표시를 유형 배지 포함으로 확인·보강

---

## 7. 결정 필요 사항

| # | 쟁점 | 권장안 | 근거 |
|---|---|---|---|
| **D1** | P0 리팩토링 범위 | **기존 5종 전부 어댑터 이관** (동작 불변) | 신규만 어댑터로 하면 이중 구조가 남아 목적 1이 미달. 이관은 기계적 이동이며 기존 export 별칭으로 위험 최소화 |
| **D2** | 콜 승격의 대상 | **VOC접수 단일** (CS 건은 항상 VOC 마스터 경유) | 마스터=고객 관점 사건이라는 모델의 일관성. "콜에서 유지보수 직접 생성" 지름길은 사건 추적점을 파편화 — 단순 AS 콜도 VOC 1건+하위 1건이 원칙. 부담이 실측되면 지름길(승격 시 하위 동시 생성)을 후속으로 |
| **D3** | 콜기록↔티켓 관계 | **N:1** (재콜 연결 허용) | §4.4 |
| **D4** | 콜기록 상태 축 | **2값 (OPEN/DONE)** | 콜기록지는 기록이지 워크플로가 아님 |
| **D5** | VOC 담당자 풀 | **초기 SEERS 전체, `field_engineers` 편입 보류** | CS 조직 구성 확인 전 풀 신설은 과잉 |
| **D6** | VOC 분류·상태·채널 초기값 | §5.1 안 | 검토 시 확정 (실 CS 운영 기준 대조) |
| **D7** | nav 구성 | 티켓 그룹에 '콜 기록'·'VOC 접수' 추가 | CS 워크플로 입구의 위치 표현 — 취향 결정 |

## 8. 확인 필요 (착수 전)

- 콜센터 현행 콜기록지 양식(엑셀/수기)의 실제 항목 — §4.3 필드와 대조 (빈 필드 노출 금지 원칙)
- 콜센터 인원의 시스템 계정·소속(Organization) — 권한(D4)·상담원 필터 전제
- 일평균 콜 건수·병원 미등록 콜 비중 — 목록 UX·`hospital_name_raw` 검증
- VOC 처리 조직(담당 그룹)과 Assignment Group 구성 — CTI 규칙 기본값

## 9. 단계 계획

| Phase | 범위 | 게이트(다음 단계 진입 조건) |
|---|---|---|
| **P0 — 도메인 어댑터 리팩토링** | `lib/ticket-domains/` 신설, 기존 5종 이관(동작 불변), 소비처 8곳 레지스트리 전환, 도메인 추가 SOP 문서화, CLAUDE.md 규칙 3 문구 개정 | tsc 0오류 + 기존 도메인 5종 전이 왕복 스모크 통과 (동작 회귀 없음) |
| **P1 — 콜기록지 원장** | `call_logs`·`CALL_INQUIRY_TYPE`·CRUD API·`/call-logs` 목록+모달·설정 페이지 | 콜센터 전건 기록 가능, 사용자 UI 확인 |
| **P2 — VOC접수 도메인** | §3.4 SOP 그대로: 테이블·상태/CTI 마스터·**어댑터 1파일**·CRUD·화면 + 콜 승격/연결(§4.4)·티켓 상세 콜 패널 | 콜→VOC→마스터 티켓 흐름 완주. **SOP 검증 리포트**(어댑터 외 공용 코드 수정이 있었는지) |
| **P3 — 하위 티켓 생성** | 도메인 POST `parentTicketId`(유지보수 우선)·마스터/VOC 상세 하위 생성 UI·`childCreate` 프리필 | CS 사건 1건의 마스터+하위 실전 시나리오 완주 |
| 범위 외(후속) | 콜 통계 대시보드, 콜백 지연 알림, VOC 리포트(승격률·유형 분포), 전화설비 연동, 승격 시 하위 동시 생성 지름길 | 필요 시 그 시점 데이터로 별도 설계 |

각 Phase 완료 시: tsc·스모크 검증, `DEV_HISTORY.md`·`README.md` 갱신. 빌드·PM2 재시작·git push는 사용자 명시 요청 시에만.

## 10. 리스크와 완화

| 리스크 | 완화 |
|---|---|
| P0 이관 중 동작 회귀 (5종 도메인 sync는 운영 핵심 경로) | 동작 불변 이관 원칙(로직 수정 금지, 파일 이동만) + 기존 export 별칭 유지 + 도메인별 전이 왕복 스모크를 P0 게이트로 강제 |
| 어댑터 인터페이스 과설계 (미래 도메인 요구 예측 실패) | 선택 메서드(`?`) 중심 — 현재 5종+VOC가 실제 쓰는 것만 정의. 새 훅은 필요해질 때 추가 |
| VOC·유지보수 이중 입력 부담 (D2 단일 경유의 대가) | P3에서 프리필로 입력 최소화. 부담이 실측되면 지름길 후속 설계 |
| 콜기록 미입력 (원장은 기록 문화에 의존) | 시스템으로 강제 불가 — 모달 빠른 입력 UX로 마찰 최소화, 통계(후속)로 가시화 |
