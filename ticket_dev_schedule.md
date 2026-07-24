# 티켓 시스템 개발 일정 (ticket_dev_schedule.md)

> 전역 결정 원본: `ticket_system_design.md` §2 (2026-07-23 사용자 확정) — 이 문서와 충돌 시 §2가 우선, §2 변경은 사용자 승인 필요.
> 설계 경위: `ticket_design_plan.md` (D0~D3 완료 후 이 문서가 마스터).
>
> 확정 결정 요지: 티켓=워크플로 껍데기/도메인=본문(도메인→`ticket_id` FK 1:1) · AWS 6상태 하드 enum+전이표 · 큐 필수 소속+owner 단일+참여자 N:M · CTI 3단계→큐 라우팅 · **Sev1~5 (Sev1 예약, 긴급→Sev2 백필)** · `ticket_logs` 단일 타임라인(코멘트 Tiptap+이벤트 JSONB) · public 스키마 · 편입 순서 유지보수→기타→답사→설치→프로젝트 · notify.ts 확장 · 지표는 ticket_logs 겸용

## 진행 원칙

- 각 Phase 시작 시: **(a) 이 문서의 해당 Phase에 상세 설계 작성 → 사용자 확인 → (b) 구현 → (c) 검증 → (d) 게이트**. 상세 설계 선행 작성 금지(직전 Phase에서 배운 것 반영 위해)
- 세션 프로토콜: `CLAUDE.md` → 이 문서 헤더+해당 Phase → `ticket_system_design.md` §2 (필요 부분만) 읽고 시작
- DB 마이그레이션: `prisma migrate dev` 금지 → 수동 SQL + `migrate resolve --applied` (CLAUDE.md 절대 규칙 1)
- 빌드·PM2 재시작·git push·PROD 반영: 사용자 명시 요청 시에만
- Phase 완료 시: 이 문서 하단 체크리스트 갱신 + `DEV_HISTORY.md` 상단 기록 + `README.md` 해당 섹션 갱신
- **약속어**: "티켓 Phase N 진행해줘" / "티켓 다음 단계로"
- 편입 Phase(P5~P9) 공통 패턴: **병행 운영**(도메인 화면 유지, 티켓 뷰 병행) → **백필**(기존 레코드→티켓 생성+FK, 단일 트랜잭션+사전 백업) → **전환**(생성 경로에 티켓 동시 생성 훅). 각 Phase 독립 롤백 가능해야 함

---

## P1 — DB 뼈대 (UI·API 없음)

**작업 항목 골자**
1. Prisma enum: `TicketStatus`(OPEN/ASSIGNED/IN_PROGRESS/PENDING/RESOLVED/CLOSED), `TicketSeverity`(SEV1~SEV5)
2. 신규 테이블(public, 수동 마이그레이션): `tickets`(티켓번호 채번, status, severity, queue_id, cti_id, owner_id, title, description, pending_reason_id, statusChangedAt, resolvedAt, closedAt, hospitalCode? …), `ticket_queues`, `ticket_cti`(계층 3단계, default_queue_id), `ticket_participants`(N:M), `ticket_logs`(log_type: comment/status_change/assign/queue_transfer/sev_change…, content_html?, payload JSONB, author_id?), `ticket_pending_reasons`
3. 인덱스: (queue_id, status), (owner_id, status), (severity), (statusChangedAt), ticket_logs(ticket_id, createdAt)
4. `npx prisma generate` + `migrate resolve --applied`

### P1 상세 설계 (2026-07-23 작성)

**공통**: public 스키마 · snake_case 테이블/컬럼 + Prisma `@map` · `users.id`=String(uuid) · 병원 참조는 `hospital_code` 문자열(기존 관례)

**Enum (하드 — §2.3 확정)**
```
ticket_status:   OPEN | ASSIGNED | IN_PROGRESS | PENDING | RESOLVED | CLOSED
ticket_severity: SEV1 | SEV2 | SEV3 | SEV4 | SEV5
```

**채번 규칙**: `TK-YYYYMM-NNNNN` (월별 시퀀스, 기존 `IP-YYYYMM-NNNNN` 관례 준수). 생성 시 `max(ticket_code) 조회 + 유니크 충돌 시 재시도` — install-plans 패턴 재사용, UNIQUE 제약이 최종 방어

**테이블 6종**

`tickets`
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | SERIAL | PK |
| ticket_code | TEXT | UNIQUE NOT NULL |
| title | TEXT | NOT NULL |
| description_html | TEXT | NULL (Tiptap, sanitize) |
| status | ticket_status | NOT NULL DEFAULT 'OPEN' |
| severity | ticket_severity | NOT NULL DEFAULT 'SEV4' |
| queue_id | INT | NOT NULL FK→ticket_queues |
| cti_id | INT | NULL FK→ticket_cti (DB nullable, **API에서 필수** — 백필 유연성) |
| owner_id | TEXT | NULL FK→users SET NULL (NULL=큐 대기) |
| pending_reason_id | INT | NULL FK→ticket_pending_reasons |
| pending_note | TEXT | NULL |
| hospital_code | TEXT | NULL FK→hospitals(hospital_code) |
| status_changed_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| resolved_at / closed_at | TIMESTAMPTZ | NULL |
| reopen_count | INT | NOT NULL DEFAULT 0 |
| due_at | TIMESTAMPTZ | NULL (SLA 목표 — P11에서 산정 로직, 컬럼 선반영) |
| created_by | TEXT | NULL FK→users SET NULL |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

`ticket_queues`: id PK · name TEXT UNIQUE NOT NULL · description TEXT · is_active BOOL DEFAULT true · sort_order INT DEFAULT 0 · created_at/updated_at

`ticket_cti`: id PK · parent_id INT NULL self-FK · level SMALLINT NOT NULL CHECK(1~3) · name TEXT NOT NULL · default_queue_id INT NULL FK→ticket_queues · is_active BOOL DEFAULT true · sort_order INT DEFAULT 0 · UNIQUE(parent_id, name). **계층 표현: parent_id 방식 채택** (3컬럼 방식 기각 — 트리 편집 UI·부분 재사용에 유리, level CHECK+앱 검증으로 3단계 강제. level1=Category(parent NULL), level2=Type, level3=Item)

`ticket_participants`: id PK · ticket_id INT FK CASCADE · user_id TEXT FK CASCADE · created_at · UNIQUE(ticket_id, user_id)

`ticket_logs`: id PK · ticket_id INT FK CASCADE · log_type TEXT NOT NULL (`comment` / `status_change` / `assign` / `queue_transfer` / `sev_change` / `cti_change` / `system`) · author_id TEXT NULL FK SET NULL (NULL=시스템) · content_html TEXT NULL (comment 전용) · payload JSONB NULL (이벤트 전용 — 예: `{"from":"OPEN","to":"ASSIGNED"}`) · created_at/updated_at

`ticket_pending_reasons`: id PK · name TEXT UNIQUE NOT NULL · is_active BOOL DEFAULT true · sort_order INT DEFAULT 0

**인덱스**: tickets(queue_id, status) · (owner_id, status) · (severity) · (status_changed_at) · (hospital_code) · ticket_logs(ticket_id, created_at) · ticket_cti(parent_id, sort_order)

**Prisma**: 모델 6종 + User에 역참조 3건(ownedTickets/createdTickets/ticketParticipations 등 relation 명명), Hospital에 tickets 역참조. 마이그레이션 `20260723_add_ticket_core` 수동 생성 → `migrate resolve --applied`

**이 Phase에서 안 하는 것**: 시드 데이터(큐·CTI 초기값은 P4에서 사용자와 확정), API·화면(P2·P3), 도메인 테이블 ticket_id FK(각 편입 Phase에서)

**검증**: `migrate status` up to date · `\dt ticket*` 존재 · `prisma.ticket.findMany()` 동작 · `tsc --noEmit`

**게이트**: 스키마 리뷰 승인 → P2

---

## P2 — 티켓 코어 API (화면 없음)

**작업 항목 골자**
1. `app/api/tickets/*`: CRUD, 상태 전이(**전이표 강제** — 위반 시 400, PENDING은 사유 필수), owner/참여자 배정, 큐 이관, Sev 변경
2. 모든 변경을 `ticket_logs`에 시스템 이벤트 자동 기록(§2.7·2.11)
3. worklog API: 코멘트 CRUD(Tiptap HTML sanitize — maintenance_logs 패턴 재사용)
4. CTI 선택 → default 큐 자동 라우팅, 수동 큐 지정 허용
5. 권한: 역할 헬퍼(`isAdminOrAbove` 등) + VIEWER 읽기 전용
6. 관리 API: 큐·CTI·PENDING 사유 마스터 CRUD (설정 화면은 P3)

### P2 상세 설계 (2026-07-23 작성)

**전이표 (`lib/ticket.ts`에 코드 고정)**
```
OPEN        → ASSIGNED, CLOSED(오생성 종결)
ASSIGNED    → IN_PROGRESS, OPEN(배정 해제 시 자동), CLOSED
IN_PROGRESS → PENDING, RESOLVED, ASSIGNED(진행 중단)
PENDING     → IN_PROGRESS, RESOLVED
RESOLVED    → CLOSED, IN_PROGRESS(=재오픈: reopen_count++, resolved_at 클리어)
CLOSED      → (터미널 — 재오픈은 신규 티켓+링크, §2.3)
```
부속 규칙: ASSIGNED·IN_PROGRESS는 owner 필수 / PENDING 진입 시 pending_reason_id 필수(이탈 시 클리어) / RESOLVED 진입 시 resolved_at, CLOSED 진입 시 closed_at 스탬프 / 모든 전이에서 status_changed_at 갱신 / **RESOLVED→CLOSED 자동 확정(N일)은 P11에서 배치로** (P2는 수동만)

**owner-상태 자동 연동 (assign API)**: owner 배정 시 OPEN이면 →ASSIGNED 자동 / owner 해제 시 ASSIGNED면 →OPEN 자동 (그 외 상태에선 owner 해제 거부 — IN_PROGRESS 이후는 전이 먼저)

**API (기존 컨벤션: getAuthUser·logAudit·sanitize·VIEWER mutation 403)**
- `GET/POST /api/tickets` — 목록(필터: queue/status 복수/severity/owner/mine/unassigned/hospital/cti/q, 페이지네이션) · 생성(ctiId API 필수, queueId 미지정 시 CTI default_queue 라우팅, `TK-YYYYMM-NNNNN` 채번 — max 조회+P2002 재시도)
- `GET/PUT/DELETE /api/tickets/[id]` — 상세(+logs) · 기본 필드 수정(title/desc/severity/cti/hospital — sev_change·cti_change 이벤트 기록) · 삭제는 ADMIN 이상
- `POST /api/tickets/[id]/transition` — `{to, pendingReasonId?, pendingNote?}` 전이표 위반 400
- `POST /api/tickets/[id]/assign` — `{ownerId|null}` + 자동 연동
- `POST /api/tickets/[id]/queue` — `{queueId}` 이관
- `PUT /api/tickets/[id]/participants` — delete-all→createMany(기존 관례)
- `GET/POST /api/tickets/[id]/logs`, `PUT/DELETE .../logs/[logId]` — 코멘트(Tiptap sanitize, 수정·삭제는 본인 또는 ADMIN)
- 마스터: `app/api/settings/ticket-queues|ticket-cti|ticket-pending-reasons` (+`[id]`) — 기존 settings 패턴, CTI는 parent·level 검증(3단계·부모 level+1)
- 모든 mutation → `ticket_logs` 시스템 이벤트 자동 기록 + `logAudit`

**이벤트 payload**: status_change `{from,to,pendingReason?,pendingNote?}` · assign `{from,to}` · queue_transfer `{from,to}` · sev_change `{from,to}` · cti_change `{from,to}` · created `{via:'manual'}`

**검증**: `tsc --noEmit` + 전이표 로직 단위 검증. **HTTP 스모크 테스트는 P3 빌드 시 함께**(빌드는 사용자 요청 시 규칙)

**게이트**: 전이표 동작 검증(P3 빌드 시 API 스모크 포함) → P3

---

## P3 — 티켓 기본 UI

**작업 항목 골자**
1. `/tickets` 목록: **큐 뷰**(큐별 탭/필터, 상태·Sev·담당 필터, 내 티켓/미배정 뷰)
2. `/tickets/[번호]` 상세: 타임라인(worklog — 코멘트+시스템 이벤트 시간순), 상태 전이 버튼(허용 전이만 노출), 배정·큐 이관·Sev 변경 UI
3. `/tickets/new` 생성: CTI 선택→큐 자동 표시, Sev 선택(기본 Sev4)
4. 설정 화면: 큐·CTI·PENDING 사유 관리(`app/settings/*` 관례)
5. `nav_menu_items` 등록, `router.refresh()` 컨벤션 준수

**Phase 시작 시 상세 설계**: 화면 레이아웃·컴포넌트 구조(기존 목록/상세 패턴 재사용 범위)

**검증**: 생성→배정→전이→해결→종결 전 과정을 UI로 완주(`/verify` 스킬), 다크모드 확인

**게이트**: 사용자 UI 시연 승인 → P4

---

## P4 — 순수 티켓 운영 개시

**작업 항목 골자**
1. 도메인 레코드 없는 일반 업무·요청을 티켓으로 접수 시작 (Sev 기본값·초기 큐/CTI 시드 데이터 등록)
2. 알림 최소 연결: 생성·배정·상태변경 시 기존 `notifyTaskEvent` 경로에 taskType `'TICKET'` 추가(전면 재편은 P11)
3. 초기 CTI 트리·큐 구성을 사용자와 확정해 시드 등록
4. 기존 기타업무(EtcTask) 모듈은 P6까지 현행 유지 — P4 순수 티켓은 "어느 도메인에도 속하지 않는 업무"용으로 안내 구분

### P4 실행 기록 (2026-07-24)
- 사용자 확정: **큐 4종**(영업/설치·답사/유지보수/내부운영) + **CTI 초안**(고객지원·영업·내부 3 Category, Item별 기본 큐 라우팅) + **PENDING 사유 5종**
- `scripts/seed-ticket-masters.sql` 신규 — 재실행 안전(idempotent), nav 메뉴 4행 포함. **PROD 최초 반영 시 이 파일 사용**. DEV 적용 완료(사용자 테스트 데이터 보존 병합: 필드엔지니어 큐, 영업/신규도입 분류)
- 알림 연결: notify 파이프라인에 taskType **'TICKET'** 추가(TaskType union·notifyFields 카탈로그·enrichTask 티켓 분기) — 생성 task_created, 전이·배정 자동 전이 task_status_changed. Slack 설정 화면(/settings/notifications)에 '티켓' 타입 자동 노출. 지연(delayed)은 P11
- 상태 표기 영문 전환(Open/Assigned/In Progress/Pending/Resolved/Closed — 사용자 지시)
- 도메인 연결 표시는 ref_type+전용 패널 방식 확정(§2.1 보강 2) — 구현은 P5~

**게이트**: 실사용 1주 안정(오류·불편 수집) 또는 사용자 판단 조기 통과 → P5

---

## P5 — 도메인 편입 ①: 유지보수

### P5 상세 설계 (2026-07-24 작성 — 실측: 상태 접수36/처리중13/완료166/보류4, 우선순위 긴급3/높음22/보통194, 담당 0명4·1명193·2명21·4명1)

**스키마**
- `maintenances.ticket_id` INT UNIQUE NULL FK→tickets(SET NULL)
- `tickets.ref_type` TEXT NULL (§2.1 보강 2 — 첫 사용) + 인덱스. 값: MAINTENANCE (편입 진행에 따라 확대)

**상태 매핑 (StatusCode MAINTENANCE ↔ TicketStatus)**
| 유지보수 | → 티켓 | 역방향 (티켓 → 유지보수) |
|---|---|---|
| 접수 | OPEN (담당 있으면 ASSIGNED) | OPEN·ASSIGNED → 접수 |
| 처리중 | IN_PROGRESS | IN_PROGRESS → 처리중 |
| 보류 | PENDING (백필 사유 '기타') | PENDING → 보류 |
| 완료 | CLOSED (resolved/closedAt=m.resolvedAt) | RESOLVED·CLOSED → 완료 |

**배정 매핑**: 첫 담당자→owner, 나머지→참여자. 담당 0명→owner NULL(OPEN 유지)
**Sev 백필**: 긴급→SEV2, 높음→SEV3, 보통→SEV4 (§2.6 확정 매핑)
**CTI**: `고객지원/장애/(하드웨어·소프트웨어·네트워크·기타)` 신설(기본 큐=유지보수) — MAINTENANCE_TYPE 4종과 1:1 매핑, 백필·신규 생성 시 typeId로 자동 결정. 도메인 typeId는 병행 유지(정리는 P13 검토)
**동기화 (병행 운영— 각 API가 한 트랜잭션에서 양쪽 갱신, 트리거 없음이라 루프 없음)**
- 유지보수 생성 → 티켓 동시 생성(큐=유지보수, worklog에 created), 상태/담당/우선순위/유형 변경 → 티켓 동기화(이벤트 기록)
- 티켓 전이/배정 → 유지보수 statusId·assignees 역동기화
- `maintenance_logs` 신규 작성 경로는 유지(기존 UI) + 동시에 ticket_logs 코멘트로 기록? → **아니오: 이관 후 유지보수 로그 패널이 티켓 타임라인을 표시**(단일 기록 원칙 — 중복 기록 금지)
**백필**: `scripts/backfill-maintenance-tickets.mts` — 215건 티켓 생성(+ref_type, 매핑 적용) + maintenance_logs 30건 → ticket_logs 코멘트 이관(원본 테이블 보존·읽기 중단) + created(via:'backfill') 이벤트. 사전 DB 백업, 단일 트랜잭션
**UI**: 유지보수 상세 — 상태·담당 UI는 유지하되 저장 시 티켓 동기화, 처리 기록 패널을 티켓 타임라인(TicketLogPanel)로 교체, 티켓 링크 표시. 티켓 상세 — "연결된 업무" 패널(유형 배지·유지보수 코드·병원·이동 버튼). 티켓 목록 — 유형 배지·필터
**Slack 이중 발송 방지**: 유지보수 경로의 기존 notifyTaskEvent(MAINTENANCE)는 유지, 동기화로 인한 티켓 측 알림은 **발송하지 않음**(도메인 알림이 대표) — 순수 티켓만 TICKET 알림

**작업 항목 골자**
1. `maintenances.ticket_id` FK(UNIQUE, nullable) 추가
2. 상태 매핑 설계 적용: StatusCode(MAINTENANCE) ↔ TicketStatus 매핑·동기화 방향 확정(상세 설계에서), `priority`→Sev 백필(긴급→Sev2…)
3. 백필: 기존 215행→티켓 생성+FK+`maintenance_logs`(30행)→ticket_logs 이관(원본 보존)
4. 생성 경로 전환: 유지보수 생성 시 티켓 동시 생성(트랜잭션), 상태 변경의 티켓 동기화
5. 유지보수 상세에 티켓 패널(타임라인) 연결, 기존 Task 동기화 코드는 티켓 동기화로 치환
6. 도메인 잔류 확인: 방문 일정·캘린더·첨부는 무변경

**게이트**: 백필 정합(행 수·FK)·신규 생성 동시성 검증 + 사용자 승인 → P6

---

## P6 — 도메인 편입 ②: 기타업무

### P6 상세 설계 (2026-07-24 — 실측: 29건, 상태 접수19/완료10, 우선순위 전건 보통, 병원 0개19·1개10(복수 없음), 전건 방문일정 보유, 첨부 0)

**사용자 확정 (2026-07-24)**: ① **존속 편입** — 유지보수와 동일 패턴(모듈 유지+1:1 동기화). 근거: 전건이 방문일정·캘린더 연동 사용, 티켓에 없는 기능. 역할 구분 = 일정·병원 연결 필요하면 기타업무, 아니면 순수 티켓 ② CTI `내부/기타업무/(일반·기타)` 신설, 기본 큐=**내부운영**

- 스키마: `etc_tasks.ticket_id` UNIQUE FK. refType 값 'ETC' 추가
- 상태 매핑: 유지보수와 동일(접수/처리중/완료/보류 — ETC_TASK_STATUS 카테고리만 다름). Sev·owner 규칙 동일
- 병원: 첫 연결 병원 → ticket.hospitalCode (0개면 NULL, 복수면 첫 병원 — 실측 복수 0건)
- CTI: 전 건 `내부/기타업무/일반` (유형 필드 없음)
- 동기화·Slack 대표(ETC)·삭제 동반: P5와 동일. 이력: EtcTask는 로그 없음 → 티켓 타임라인이 첫 이력. 방문·캘린더·note는 도메인 잔류
- 백필: `scripts/backfill-etc-task-tickets.mts` (29건)
- UI: 목록 ETC 배지·필터, 티켓 상세 Linked Work(기타업무), 기타업무 상세 티켓 배너+타임라인 패널 추가

**게이트**: P5와 동일 기준 → P7

---

## P7 — 도메인 편입 ③: 답사

### P7 상세 설계 (2026-07-24 — 실측: 104건, 상태 접수4/답사예정10/작성완료0/회신완료89/보류1, 담당 0명4·1명88·2명12)

**상태 매핑 (SITE_VISIT 5종 ↔ 티켓 — 상태 수 불일치로 역방향은 손실 허용, 도메인이 자기 상태의 원본)**
| 답사 | → 티켓 | 역방향 |
|---|---|---|
| 접수 | OPEN/ASSIGNED(owner 따라) | OPEN·ASSIGNED → 접수 |
| 답사예정 | IN_PROGRESS | IN_PROGRESS → 답사예정 |
| 작성완료 | **PENDING('외부 회신 대기')** — 회신 대기 의미 | PENDING → 보류 |
| 회신완료 | CLOSED | RESOLVED·CLOSED → 회신완료 |
| 보류 | PENDING('기타') | 〃 |

- 티켓 제목: `[답사] {병원명}` (답사엔 title 필드 없음). Sev: 전건 SEV4(우선순위 없음). 큐: **설치·답사**
- CTI: 기존 `영업/신규도입/답사요청` 사용(사용자 생성분) — default_queue 미지정이었으므로 시드에서 '설치·답사'로 지정(+PROD용 ensure 추가, '설치계획(가안)요청'도 함께)
- **생성 경로 2곳** 모두 티켓 동시 생성: ① POST /api/site-visits ② site-visit-queue 승격(Gmail 인입 → 티켓 생성 채널화). daewoong 슬롯·파일·notes·캘린더 도메인 잔류. 이력 부재 → 티켓 타임라인이 첫 이력
- 백필 104건, refType 'SITE_VISIT'. 동기화·알림 대표·삭제 동반: P5 패턴

**게이트**: P5와 동일 기준 + 메일 인입 경로 검증 → P8

---

## P8 — 도메인 편입 ④: 설치계획

### P8 상세 설계 (2026-07-24 — 실측: 72건, write/reply 완료·완료 67 / 미완료·미완료 5, 담당 0명3·1명69, 병원 전건 있음)

**2축 상태 ↔ 티켓 매핑**
| write / reply | → 티켓 | 역방향 (티켓 →) |
|---|---|---|
| write 미완료·'-' | IN_PROGRESS(owner) / OPEN | OPEN·ASSIGNED·IN_PROGRESS → write 미완료·reply 미완료 |
| write 완료 & reply 미완료 | **PENDING('외부 회신 대기')** | PENDING → write 완료·reply 미완료 |
| write 완료 & reply 완료 | CLOSED | RESOLVED·CLOSED → write 완료·reply 완료 |

- 제목 `[설치계획] {병원명}`, Sev SEV4, 큐 **설치·답사**, CTI `영업/신규도입/설치계획(가안)요청`(기본 큐 기지정)
- statusChangedAt 부재 갭 → 티켓 statusChangedAt이 해소(도메인 무변경). 생성 경로 2곳: POST /api/install-plans + **mail-queue 승격**(티켓 생성 채널화). 병원 상태 전진 훅('가견적요청') 도메인 잔류. 기존 Task 완료 동기화 코드 유지
- 백필 72건, refType 'INSTALL_PLAN'. 동기화·알림 대표·삭제 동반: P5 패턴

**게이트**: P5와 동일 기준 → P9

---

## P9 — 도메인 편입 ⑤: 프로젝트 (완전 편입 — D2b 확정)

### P9 상세 설계 (2026-07-24 — 실측: 243건, 구축완료219/보류13/진행중7/준비4, 담당 0명164·1명60·2명18·3명1, 완료예정일 235건)

**상태 매핑 (BuildStatus 라벨은 런타임 편집 가능 → 의미 앵커 기반, 기존 코드 관례와 동일)**
| BuildStatus | → 티켓 | 역방향 (티켓 →, 라벨 findFirst best-effort) |
|---|---|---|
| '완료' 포함 (구축완료) | CLOSED | RESOLVED·CLOSED → '완료' 포함 라벨 |
| '보류' | PENDING('기타') | PENDING → '보류' |
| '준비' | OPEN/ASSIGNED(owner) | OPEN·ASSIGNED → '준비' |
| 그 외 (진행중·업데이트 필요) | IN_PROGRESS | IN_PROGRESS → '진행중' |

- 제목 `[프로젝트] {projectName}`, Sev SEV4, 큐 **설치·답사**, CTI `영업/신규도입/구축`(신설), **dueAt = endDateExpected**(SLA 선반영 필드 첫 활용)
- 특이: ProjectAssignee FK는 **projectCode**(문자열) — 동기화 함수 projectCode 기준. BuildStatus는 도메인 잔류(양방향 동기화는 의미 앵커로). 병원 상태 전진 훅(계약→계약완료, 구축완료→운영)은 도메인 PUT 경로 유지 — **티켓 쪽 전이로 구축완료 시 훅 미발동(한계, P13 보완 검토)**. 이슈노트(위키)는 링크만. **Task 롤업 미생성 갭은 티켓이 대체 해소**
- 백필 243건, refType 'PROJECT'. 동기화·알림 대표(PROJECT)·삭제 동반: P5 패턴

**게이트**: P5와 동일 기준 → P10 (P7~P9 게이트는 사용자 부재 지시로 P9 완료 후 일괄 확인)

---

## P10 — tasks 롤업 대체·폐기

**작업 항목 골자**
1. 전 모듈 편입 완료 확인 → `/tasks` 화면을 티켓 목록(해당 필터 프리셋)으로 교체
2. 미완료 tasks 잔여분 검증(전 모듈 백필로 커버됐는지 대조), 원본 모듈들의 Task 동기화 코드 제거 확인
3. `tasks` 테이블 이력 보존 폐기(ConsultationQueue 선례 — API·화면 제거, 테이블 유지)

**게이트**: tasks 대비 티켓 목록 누락 0건 검증 → P11

---

## P11 — 알림·SLA 재편 (Sev 기반)

**작업 항목 골자**
1. `lib/notify.ts` 티켓 이벤트 전면 전환: 생성/큐 배정/개인 배정/상태 변경/SLA 임박·초과. **Sev1·2 강조 발송**(채널/멘션 — 상세 설계에서)
2. `lib/delay-rules.ts` → Sev별 SLA 목표(런타임 설정) 재편, 기존 모듈별 지연 규칙 대체
3. 편입 기간의 이중 발송 방지 규칙 정리, `notification_logs` 유지

### P11 상세 설계 (2026-07-24 작성 — **사용자 확정 완료**: ① Sev1=@channel·Sev2=큐멤버 멘션(메인 채널) ② 큐 멤버 멘션 on(멤버 배정 후 활성, 0명 큐는 무해) ③ 배정 DM 기본 on ④ SLA 기본 1/1/3/7/없음 — 런타임 조정 가능. 메시지 티켓 중심 통일·코멘트 알림 제외·체류 기본 미사용도 권장안대로)

**전제 (실측, dev)**: 열린 티켓 122건(OPEN 11·ASSIGNED 59·IN_PROGRESS 34·PENDING 18), 열린 티켓 Sev 분포 SEV3 7·SEV4 115(SEV1·2 없음), dueAt 보유 235건(전부 PROJECT=endDateExpected), 큐 멤버 dev 0명(PROD도 배정 필요 — P1~P10 배포 후속 안내 미이행 상태). 백필 티켓의 createdAt은 도메인 원본 생성일 보존 → SLA 앵커로 사용 가능.

**A. 이벤트 소스 전면 전환 — 단일 파이프라인**
- 모든 업무 알림의 **트리거를 티켓 레이어로 이동**. 도메인 라우트 7곳(maintenances·etc-tasks·site-visits·site-visit-queue·install-plans·mail-queue·projects)의 `notifyTaskEvent`/`notifyTaskStatusChanged` 직접 호출 제거 → P5의 "도메인 알림이 대표" 이중 발송 방지 규칙 자연 소멸
- 신규 진입점(lib/notify.ts): `notifyTicketCreated` / `notifyTicketStatusChanged` / `notifyTicketAssigned` / `notifyTicketQueueTransferred` (+스케줄러의 SLA). 도메인 라우트는 자기 refCode 대신 **연결 티켓코드로 호출** — sig 비교(기존 방식)가 실변경만 발송 보장
- `notification_logs`: taskType은 refType 유래(MAINTENANCE… / 순수=TICKET) 유지 → `notify_types_enabled` 타입별 on/off·로그 필터 호환. **refCode는 ticketCode로 통일**(dedup·baseline 기준). 전환 직후 티켓별 첫 상태변경 1회는 baseline 기록으로 조용히 스킵(기존 관례 — 오발송 방지)
- DDL 없음(dueAt 기존 컬럼 활용) — 마이그레이션 불필요, 코드+설정+dueAt 백필 UPDATE만

**B. 메시지 형식 — 티켓 중심 통일 빌더 (쟁점 4)**
- 헤더: 이모지 + `[유형라벨] TK-… · Sev` + 병원/제목(티켓 상세 링크). 본문: 상태 from→to + 선택 필드(기존 FIELD_CATALOG 재사용 — refType 도메인 필드 + 티켓 필드 queue/owner/dueAt 병합 렌더) + 연결 도메인 상세 링크 병기
- 대안(기존 도메인 형식 유지)은 큐·Sev 표시 불가 + 빌더 이원화 → 기각 권장

**C. 이벤트 종류·수신 대상**

| 이벤트 | 트리거 | 채널 | DM | 비고 |
|---|---|---|---|---|
| created | 티켓 생성(순수·도메인 동시생성·메일큐 승격) | 메인 | — | **큐 멤버 멘션**(§2.4 용도② — 쟁점 2) |
| status_changed | status sig 실변경 | 메인 | — | 기존 방식 유지 |
| assigned | owner 실변경 | — | 신규 owner에게 배정 DM | 채널 미발송(노이즈 방지). `notify_assign_dm` 기본 on(쟁점 3) |
| queue_transferred | 큐 이관 | 메인 | — | 이관받은 큐 멤버 멘션 |
| sev_escalated | SEV1·2 진입(생성 포함) | 메인(강조) | — | 강조 방식 쟁점 1 |
| sla_warning | dueAt 임박(D-1, 설정) | 지연 요약 | — | 스케줄러(기존 인터벌) |
| sla_overdue | dueAt 경과 | 지연 요약 | owner DM(기존 지연 DM 재편 — 담당자→owner) | 〃 |
| dwell | 상태 체류 임계 초과 | 지연 요약 병합 | 〃 | 기본 전부 미사용(현행 관례) |
| comment | 코멘트 작성 | — | — | **P11 제외**(§2.10 '선택' — 후순위, 쟁점 6) |

**D. Sev1·2 강조 (쟁점 1)**
- 권장: 별도 채널 신설 없이 **메인 채널 + 멘션 차등** — Sev1 = `:rotating_light:` + `<!channel>`, Sev2 = `:fire:` + 큐 멤버 멘션. 별도 긴급 채널(SLACK_CHANNEL_URGENT)은 채널 관리 부담 대비 실익 낮음(사내 규모·Sev1 예약 상태)

**E. Sev 기반 SLA — delay-rules.ts 재편**
- 새 설정 `notify_sla_rules`(AppSetting JSON): Sev별 목표일 — 기본 **SEV1:1 · SEV2:1 · SEV3:3 · SEV4:7 · SEV5:없음(제외)** (기존 유지보수 긴급1·높음3·보통7 관례 승계, SEV5=백로그 무알림 §2.6) + 임박 예고 D-N(기본 1)
- **dueAt 산정**: 생성 시 `createdAt + SLA[sev]` (SEV5·refType PROJECT 제외 — PROJECT는 endDateExpected가 소유, 도메인 동기화 유지). Sev 변경 시 재산정(PROJECT 제외). 별도 컬럼 추가 없음
- **판정** `findDelayedTickets()`: 대상 status OPEN/ASSIGNED/IN_PROGRESS — **PENDING은 SLA 시계 정지**(AWS 관례, 외부 대기 중 알림 노이즈 방지 — 대신 체류 규칙으로 커버), dueAt<오늘=초과 · dueAt=내일=임박. 정렬 Sev→초과일수
- 상태 체류: `notify_status_dwell` 재편 → 티켓 상태 6종별 임계일(기본 전부 미사용)
- 기존 `findDelayedTasks`(도메인 5종 판정)·`notify_delay_rules` 편집 UI 제거(설정 키 잔존은 무해). 스케줄러(notify-scheduler·주기 설정)는 그대로
- **dueAt 백필**: 열린 티켓 1회 UPDATE(createdAt+SLA, PROJECT·SEV5·CLOSED/RESOLVED 제외). 오래된 열린 티켓의 초기 '초과' 다수 발생 예상 → 요약 MAX 20 완충 + 첫 발송 전 건수 사용자 보고

**F. 설정 화면 (/settings/notifications) 개편**
- '지연 판정 기준일(타입별·유지보수 우선순위별)' → **'SLA 목표(Sev별)' 편집** + 임박 D-N
- 상태 체류: 타입·상태별 → 티켓 상태 6종별
- 유지: 발송 모드·전역/이벤트 토글·타입별 on/off(refType 기준)·메시지 필드 선택·DM 토글·발송 이력. 신규: 배정 DM 토글

**G. 검증**
- tsc + 스모크(test 모드 → 테스트 채널 수신 + notification_logs 확인): 순수 티켓·유지보수 연동 티켓 각각 생성/배정/전이/큐이관/Sev 상향
- **이중 발송 0건**: 유지보수 PUT 상태변경 1회 → 채널 메시지 정확히 1건
- SLA: dueAt 조작 티켓으로 `runDelayNotifications` 수동 실행 → 임박·초과 요약 + owner DM 확인

**쟁점 (사용자 결정 대기)**: ① Sev1/2 강조 방식 ② 큐 멤버 멘션 on 여부(PROD 큐 멤버 미배정 상태) ③ 배정 DM 기본 on ④ 메시지 티켓 중심 통일 ⑤ SLA 기본값 ⑥ 코멘트 알림 제외 → **전부 확정(2026-07-24)**: 메인채널+멘션 차등 / 멘션 on / DM on / 통일 / 1·1·3·7·없음 / 제외

### P11 구현 기록 (2026-07-24)
- **알림 단일 파이프라인**: `notifyTicketCreated`·`notifyTicketChanged`(notify.ts 신규) — sig v2(`v2|status|owner|sev|queue`)로 4축 변경 감지, 복합 변경 1메시지. 도메인 라우트 7곳 직접 알림 제거(이중 발송 방지 규칙 소멸), refCode=ticketCode 통일(전환 직후 티켓별 첫 변경 1회는 baseline 스킵). notifyTaskEvent/notifyTaskStatusChanged/domainNotifyRef 제거
- **P2 이월 부속규칙 이행 — RESOLVED→CLOSED 자동 확정**: `runTicketAutoClose`(ticketDomain) — `ticket_auto_close_days`(기본 0=끔), notify-scheduler 주기에 실행(주기 off면 미실행), 열린 서브 있으면 스킵, Slack 미발송(타임라인 이벤트만)
- **SLA**: `notify_sla_rules` {SEV1:1,SEV2:1,SEV3:3,SEV4:7,SEV5:0}+warnDays 1 · dueAt=생성일+SLA(생성 5경로 산정, Sev 변경 시 재산정, PROJECT 제외) · `findDelayedTickets` 초과/임박/체류(PENDING은 SLA 정지) · 요약 3섹션(섹션당 10건 캡)+SLA 초과 owner DM · 체류 규칙은 티켓 상태 6종 기준으로 재편(구 도메인 dwell 설정은 무시됨)
- 백필: `scripts/backfill-ticket-dueat.sql`(재실행 안전) — dev 98건, 초기 SLA 초과 81건(구 규칙에서도 지연이던 오래된 열린 티켓들). **PROD 반영 시 이 파일 실행 필요**
- 설정 화면: SLA 목표(Sev별)+임박 D-N+자동종결 · 상태 체류(티켓 상태) · 배정 DM 토글 · 타입별 on/off는 refType 기준 유지. 발송이력 라벨 SLA·체류/배정 DM 추가
- 세분화 토글 추가(2026-07-25 사용자 지시): **이벤트별 채널 알림**(`notify_event_toggles` — created/statusChanged/queueTransferred/sevEscalated, 기본 on) + **큐 멤버 멘션**(`notify_queue_mentions`) + **Sev1 @channel**(`notify_sev1_channel`) — 꺼진 이벤트는 채널 미발송·sig 기준선만 갱신(event_off/sig_update)
- 검증: tsc 0오류 · 구 API 참조 0건 · **스모크 통과(2026-07-25, dev2)**: 생성/전이/Sev 상향/큐 이관/배정 DM/큐 멘션/토글 off·on/레거시 baseline/SLA 요약 — 유지보수 이중 발송 0건. 개인 대상 테스트는 이준호만(원복 완료)

**게이트**: 이벤트별 발송 검증 + 이중 발송 0건 → P12

---

## P12 — 프로세스 지표·대시보드

**작업 항목 골자**
1. ticket_logs 이벤트 기반 지표 SQL 뷰: 접수→해결 소요, 큐 체류, 상태별 체류, 재오픈율, 담당별 처리량, Sev 분포
2. 대시보드 화면(기존 메인 대시보드/사이니지 월보드와의 관계는 상세 설계에서)

### P12 상세 설계 (2026-07-25 작성 — **사용자 확정·착수 승인**: ① 독립 /tickets/dashboard ② 뷰 없이 라우트 집계 ③ **담당별 처리량 표는 ADMIN 이상만**(그 외 지표는 전 사용자) ④ 지표 구성 제안대로)

**전제 (실측, dev)**: 티켓 673건(백필 667·manual 4·domain 2) 중 열린 122건. **ticket_logs 이벤트는 created 673 외 status_change 6·assign 1·sev_change 2뿐** — 백필 티켓의 과거 전이 이력이 없어 순수 이벤트 기반 체류 지표는 P11 전환 시점 이후부터 누적. 반면 티켓 필드(createdAt=도메인 원본 생성일·resolvedAt·closedAt·statusChangedAt·reopenCount·severity·queueId·ownerId·dueAt)는 백필에도 보존 → **지표를 2계열로 설계**: ① 필드 기반(전 기간 산출 가능) ② 이벤트 기반(체류 — 축적 중 안내)

**A. 지표 정의 (골자 6종 + SLA·백로그 2종 추가)**

| 지표 | 산출 | 계열 |
|---|---|---|
| 접수→해결 소요 | `closedAt - createdAt`(RESOLVED는 resolvedAt) — 평균·중앙값, 월별 추이, Sev/유형/큐별 | 필드(전 기간) |
| 담당별 처리량 | 기간 내 종결 수 by owner + 현재 열린 부하(참고 병기) | 필드 |
| 재오픈율 | `reopenCount>0` / 해결 도달 티켓 | 필드 |
| Sev·유형·큐 분포 | 열린 티켓 스냅샷 | 필드 |
| **SLA 준수율** (P11 dueAt 활용) | 종결 시 `closedAt ≤ dueAt` 비율 + 현재 초과·임박 수 | 필드 |
| **백로그 추이** | 월별 생성 vs 종결 건수 (throughput) | 필드 |
| 상태별 체류 | ticket_logs status_change 간격 집계 — **P11 이후 데이터부터**. 보완: 열린 티켓의 현 상태 체류(statusChangedAt 기준)는 지금도 산출 → "현 상태 장기 체류 Top" 목록으로 제공 | 이벤트+필드 |
| 큐 체류 | queue_transfer 이벤트 기반 — 이관 자체가 희소하므로 후순위(체류 집계에 포함만) | 이벤트 |

**B. 산출 방식 — SQL 뷰 대신 API 라우트 집계 (쟁점 ②)**
- `GET /api/tickets/metrics?months=&queueId=&refType=` 단일 라우트에서 raw SQL(`prisma.$queryRaw`) 집계. **DB 뷰 미생성** — 규모(수백 건)상 실시간 집계 충분, 뷰는 마이그레이션·스키마 관리 부담만 추가. 필요해지면 후일 materialized view 전환(§2.11 설계 여지 그대로)
- 삭제 티켓은 지표에서 자연 제외(행 삭제). 백필 티켓의 resolvedAt 부재 CLOSED(과거 이력 한계)는 closedAt로 대체 계산

**C. 화면 — 독립 `/tickets/dashboard` (쟁점 ①)**
- 메인 대시보드(`/`)·사이니지 월보드는 **무변경** (기존 구성 훼손 없음 — 원하면 후속에서 KPI 타일 1개 추가 논의). 진입: nav '티켓' 하위 메뉴 + `/tickets` 목록 우상단 버튼
- 구성(위→아래):
  1. KPI 타일 6: 열린 티켓 / 미배정 / SLA 초과 / 이번 주 종결 / 평균 해결 소요(최근 90일) / 재오픈율
  2. 필터 바: 기간(3/6/12개월·전체) · 큐 · 유형
  3. 차트(recharts 기설치·메인 대시보드 관례 준수, 다크모드 대응): 월별 생성 vs 종결(막대+라인) · 해결 소요 월별 추이(중앙값 라인) · Sev 분포·큐별 열린 티켓(막대) · SLA 준수율 추이
  4. 담당별 처리량 표(기간 내 종결·평균 소요·열린 부하) — 쟁점 ③
  5. 현 상태 장기 체류 Top 10 목록(티켓 링크) + 이벤트 기반 체류 지표는 "P11 이후 축적 중" 안내
- 권한: 로그인 사용자 전체(VIEWER 포함 — 조회 전용 성격). nav 시드 추가(`seed-ticket-masters.sql`에 ensure)

**D. 이 Phase에서 안 하는 것**: 메인 대시보드·사이니지 개편, DB 뷰/마이그레이션, 엑셀 다운로드(요청 시 후속), 지표 알림(P11 SLA 요약이 담당)

**검증(게이트)**: 지표 수치 표본 검증 — SQL 수기 대조(최소: 열린/미배정/SLA 초과 건수, 특정 월 생성·종결 수, 특정 담당 처리량, 재오픈 건수) + 다크모드·필터 동작 확인 → P13

**쟁점 (사용자 결정 대기)**: ① 화면 위치 — 독립 /tickets/dashboard(권장) vs 메인 대시보드 통합 ② DB 뷰 없이 라우트 집계(권장) ③ 담당별 처리량 표 노출 범위 — 전 사용자(권장, 사내 규모) vs ADMIN 이상 ④ KPI·차트 구성에서 빼거나 더할 지표 → **확정(2026-07-25)**: 독립 페이지 / 라우트 집계 / **ADMIN 이상만** / 구성 제안대로

### P12 구현 기록 (2026-07-25)
- `GET /api/tickets/metrics`: raw SQL 집계(KST 버킷·`percentile_cont` 중앙값), 필터 months/queueId/refType(PURE=순수), perOwner는 `isAdminOrAbove`일 때만 응답 포함. **백필 데이터 보정**: closed_at<created_at(도메인 완료일이 입력일보다 과거) 케이스 → 소요일 `GREATEST(…,0)` 클램프
- `/tickets/dashboard`: KPI 6타일·필터 바·차트 4종·월별 표 토글·큐별 바·담당별 표(perOwner 있을 때만)·장기 체류 Top 10(statusChangedAt 기준 — 이벤트 축적 전 보완 지표). 진입은 목록 우상단 버튼(nav는 settings 하위만 지원하는 구조라 하위 메뉴 미사용 — 시드 변경 없음)
- 차트 팔레트 dataviz 검증: 2시리즈(생성/종결) light `#2C5CE5/#10B981` PASS(대비 WARN → 월별 표 뷰로 해소) · dark `#4B7BFF/#059669`(emerald 밝기 밴드 초과로 스냅) ALL PASS. 분포 차트는 단일 hue(축 라벨이 정체성)
- **게이트 검증 통과**: 수기 SQL 대조 9지표 전부 일치(open 122·unassigned 19·slaOverdue 81·이번주 종결 8·2026-06 생성 140/종결 107·재오픈 0·이제현 6개월 종결 51·박종찬 평균 2.4일) + 필터(PURE=4·큐7=53)·VIEWER perOwner 미포함 확인. tsc 0오류·dev2 빌드·재시작·페이지 200

**게이트**: 지표 수치 표본 검증(수기 대조) — **2026-07-25 통과, 사용자 승인 대기** → P13

---

## P13 — 안정화·마무리

**작업 항목 골자**
1. 전 모듈 티켓 흐름 회귀 점검, 에지 케이스(재오픈·큐 이관 연쇄·권한) 정리
2. `README.md` 전면 갱신(기능·API·스키마·디렉토리), CLAUDE.md에 티켓 관련 규칙 추가 검토
3. PROD 반영 준비(마이그레이션 순서 정리·시드 스크립트) — **실제 반영은 사용자 명시 요청 시**

### P13 상세 설계 (2026-07-25 작성 — **사용자 검토 대기**)

**A. 이월 갭 보완 (조사 실측 2건 — 코드 수정)**
1. **`lib/workItemReassign.ts` 정리 + 티켓 병원 동기화 갭 수정**: ① 동결된 `tasks` 미러 갱신 코드(task.updateMany 3곳) 제거(P10 이월) ② **업무 재지정/병원 전체 이관 시 도메인 hospital_code만 바뀌고 연결 티켓의 hospital_code·제목([답사] 병원명 등)은 미동기화** → 같은 트랜잭션에서 티켓 갱신 추가(기존 sync*ToTicket 재사용 — 유지보수/답사/설치계획/프로젝트, 기타업무는 병원 N:M 첫 병원 규칙)
2. **프로젝트 '운영' 전진 훅 (P9 한계)**: 티켓 transition으로 PROJECT 티켓이 RESOLVED/CLOSED 진입(→BuildStatus '완료' 앵커 동기화) 시 `advanceHospitalStatus('운영')` 호출 추가 — transition 라우트에서 트랜잭션 밖 best-effort(도메인 PUT 경로와 동일 규칙). 티켓 오생성 종결(OPEN/ASSIGNED→CLOSED)도 도메인이 '완료'로 동기화되므로 동일 적용

**B. 검토 결론 기록 (코드 무변경)**
- `maintenances.typeId` 병행(P5 이월): **유지** — 도메인 화면·알림 필드·CTI 자동 매핑이 typeId 기준으로 동작 중, 제거 실익 없음
- 재오픈(RESOLVED→IN_PROGRESS) 시 dueAt: **재산정 안 함(원 기한 유지)** — 재오픈=미해결이므로 원 SLA로 초과 노출이 타당(AWS 관례)
- 위키 이슈노트: 링크만(§2.7) — 변경 없음 확인

**C. 회귀 점검 매트릭스 (dev2, test 모드 스모크 — 개인 대상은 이준호만)**
| 영역 | 케이스 |
|---|---|
| 전이표 | 허용/거부 대표 케이스 + PENDING 사유 필수·이탈 클리어 + owner 필수 상태 |
| 재오픈 | RESOLVED→IN_PROGRESS(reopen_count++·resolvedAt 클리어) · CLOSED 재오픈=신규+링크 UI |
| 마스터-서브 | 열린 서브 존재 시 마스터 RESOLVED/CLOSED 거부 · 2레벨 제약 · auto-close 스킵 |
| 큐 이관 연쇄 | 연속 이관 sig·알림 정상, CLOSED 이관 거부 |
| 권한 | VIEWER mutation 403 전반 · 삭제 ADMIN · metrics perOwner 분기(P12 기검증) |
| 도메인 동기화 | 5종 각 생성→티켓 / 도메인 변경→티켓 / 티켓 전이→도메인 역동기화 / 삭제 동반 (P5~P9 스모크 축약 재실행) + A-1·A-2 수정분 |
| 알림 | 이중 발송 0건 재확인(P11 기검증 — 대표 1케이스만) |

**D. 문서 전면 갱신**
- README: 티켓 관련 섹션 정합화(P1~P12 누적 반영 — 기능·API·스키마·디렉토리 구조에 tickets/dashboard 등)
- **CLAUDE.md 티켓 규칙 추가(검토 후 최소한만)**: ① Slack 알림은 lib/notify.ts 티켓 파이프라인 단일 소스 — 도메인 라우트에서 직접 발송 금지 ② 상태 전이표·라벨은 lib/ticket-shared.ts 단일 소스 ③ 도메인↔티켓 동기화는 lib/ticketDomain.ts를 같은 트랜잭션에서 호출(직접 티켓 UPDATE 금지) ④ 티켓 마스터(큐·CTI·사유) 변경은 seed-ticket-masters.sql에도 반영

**E. PROD 반영 준비 (체크리스트 문서화만 — 실행은 명시 요청 시)**
- P11 이후 DDL 없음(마이그레이션 추가 불필요 — P1~P10분은 기배포). 반영 시: git push → PROD pull → build → pm2 restart + ① `scripts/backfill-ticket-dueat.sql` 실행 ② 큐 멤버 배정(설정 화면) ③ 알림 설정 확인(SLA 주기·토글) — 체크리스트를 이 문서 하단에 기재

### P13 구현·검증 기록 (2026-07-25)
- **A-1**: `lib/workItemReassign.ts` — Task 미러 갱신 제거(tasks 참조 0건), 단건 재지정은 `sync*ToTicket` 트랜잭션 동기화, 일괄 이전은 티켓 일괄 UPDATE(순수 티켓 포함)+[답사]/[설치계획] 제목 병원명 갱신(이관 전 from 기준 — 기존 to 병원 티켓 미접촉)
- **A-2**: transition 라우트에 PROJECT 티켓 RESOLVED/CLOSED 진입 시 `advanceHospitalStatus('운영')` 훅 추가
- **B**: typeId 병행 유지·재오픈 dueAt 원 기한 유지·이슈노트 링크만 — 결론 확정
- **D**: CLAUDE.md 티켓 규칙 4개 추가(알림 단일 파이프라인·전이표 단일 소스·ticketDomain 경유·시드 반영), README 정합화(디렉토리·재지정/이관·스키마 헤딩·P10 잔존 문구)
- **회귀 매트릭스 전 항목 통과** (dev2, 테스트 병원 2곳 생성 후 검증·전체 삭제, 개인 대상은 이준호만):
  전이표 14케이스(위반 400·PENDING 사유 필수/클리어·owner 제약·재오픈 카운트·터미널) · 마스터-서브(2레벨 위반 400·열린 서브 시 RESOLVED 거부·종결 후 허용) · 큐 이관 연쇄(이벤트 2건) · 권한(VIEWER 403·USER 삭제 403) · auto-close(1일 설정 → CLOSED·via auto_close) · 유지보수 양방향 동기화 + **채널 발송 정확 3건(이중 발송 0)** · A-1 재지정/일괄 이전 시 티켓 병원 동시 이동 · A-2 훅(테스트 병원 미계약→**운영** 전진+구축완료 동기화) · 도메인 삭제 시 티켓 동반 삭제. 종료 후 티켓 673건·설정 원상 복귀

**게이트**: 회귀 매트릭스 통과 ✓ (2026-07-25) + **사용자 최종 승인 대기** → 프로젝트 완료

### PROD 반영 체크리스트 (P11~P13분 — 실행은 사용자 명시 요청 시)

P1~P10분은 2026-07-24 기배포(마이그레이션 8개·시드·백필 673건). P11 이후 **DDL 없음** — 추가 마이그레이션·prisma generate 불필요.

1. dev2에서 커밋 → `git push origin main`
2. PROD: `git pull origin main` → `NODE_OPTIONS="--max-old-space-size=4096" npm run build` → `pm2 restart thync-prod`
3. **dueAt 백필**: `psql -d thync_ops -f scripts/backfill-ticket-dueat.sql` (재실행 안전 — 열린 티켓, PROJECT·SEV5 제외) ⚠️ PROD DB 작업 — 명시 허락 후
4. **큐 멤버 배정**: 설정 → 티켓 큐 관리에서 큐별 멤버 지정 (멘션·"내 큐" 동작 전제, 0명이어도 오류는 없음)
5. **알림 설정 확인** (`/settings/notifications`): SLA 요약 주기(현 off — 켜야 SLA 요약·자동 종결 동작), 배정 DM·이벤트별 토글·SLA 목표(기본 1/1/3/7/없음) 검토. SLA 초과 DM은 오래된 열린 티켓 정리 후 활성 권장
6. 검증: `/tickets`·`/tickets/dashboard` 307/200 · 티켓 생성→Slack 채널 1건(live 모드) · notification_logs 확인

---

## 진행 체크리스트

- [x] P1 — DB 뼈대 (2026-07-23) — 마이그레이션 `20260723150000_add_ticket_core`(enum 2종+테이블 6종+인덱스), Prisma 모델 6종+User/Hospital 역참조. 검증: migrate status OK·findMany 동작·tsc 0오류. 게이트: 스키마 리뷰 승인 대기
- [x] P2 — 티켓 코어 API (2026-07-23) — lib/ticket.ts(전이표·채번·이벤트) + 티켓 API 8라우트 + 마스터 3종(settings). 검증: tsc 0오류·전이표 20케이스 단위 통과 + **HTTP 스모크 30케이스 전부 통과(2026-07-24) → 게이트 통과**
- [x] P3 — 티켓 기본 UI (2026-07-23) — /tickets 목록(큐 탭·필터)·/tickets/new(CTI 3단→큐 라우팅)·/tickets/[id](전이 버튼=전이표 기반·타임라인)·설정 3종·nav 메뉴 4행: '티켓'(tickets) + 설정 하위 3행(settings/ticket-queues·ticket-cti·ticket-pending-reasons, group '티켓') — 전부 dev INSERT, **PROD 반영·데이터 동기화 시 재INSERT 필요(ON CONFLICT DO NOTHING)**. tsc 0오류. 2026-07-24 빌드·pm2 재시작 완료(/tickets 307 정상). 사용자 피드백 반영(2026-07-24): AWS SIM식 상세 2컬럼+고정 사이드바+'나에게 배정' 액션 바, 목록 나이/최근변경·Sev1/2 행 액센트·저장된 뷰(localStorage), **큐 멤버십**(ticket_queue_members + 설정 UI + 담당자 셀렉트 멤버 우선), **마스터-서브 티켓**(parent_id 2레벨 고정·열린 서브 시 마스터 종결 불가·서브 생성/기존 연결 UI). 추가 반영: 상세 기본정보 상단 그리드 재배치·티켓번호 URL(`/tickets/TK-…`, 숫자 호환)·제목/설명 인라인 수정. **게이트 통과: 2026-07-24 사용자 승인** (UI 시연 후 "다음 단계로" 지시)
- [x] P4 — 순수 티켓 운영 개시 (2026-07-24) — 시드(큐4·CTI 3카테고리·사유5, seed-ticket-masters.sql) + Slack 알림 TICKET 연결 + 상태 영문 표기. **게이트: 실사용 안정 확인 대기(또는 사용자 조기 통과)**
- [x] P5 — 편입 ① 유지보수 (2026-07-24) — ref_type/ticket_id 스키마, 장애 CTI 4종, lib/ticketDomain.ts 양방향 동기화, 백필 219건+로그 30건 이관(분포 설계 일치, 사전 백업), UI 3종(목록 유형 배지·상세 연결 패널·유지보수 타임라인 교체), 동기화 스모크 17케이스 통과. **게이트 통과: 2026-07-24 사용자 승인** (+티켓 UI 필드명 영문화 지시)
- [x] P6 — 편입 ② 기타업무 (2026-07-24) — 존속 편입(사용자 확정), etc_tasks.ticket_id, CTI 내부/기타업무 신설(→내부운영 큐), ticketDomain에 ETC 동기화+공통 진입점(syncTicketToDomain·domainNotifyRef), 백필 29건(사전 백업), UI(violet 배지·Linked Work·기타업무 타임라인 신설), 스모크 14케이스 통과. 티켓 UI 필드명 영문화 병행 완료. **게이트 대기: 사용자 승인**
- [x] P7 — 편입 ③ 답사 (2026-07-24) — site_visits.ticket_id, 상태 5종 매핑(작성완료→Pending '외부 회신 대기'), 생성 2경로(직접+Gmail 큐 승격) 티켓 자동, CTI 답사요청 기본 큐 지정, 백필 104건, UI(sky 배지·Linked Work·답사 타임라인), 스모크 17케이스 통과. 게이트: P9 후 사용자 일괄 확인(부재 지시)
- [x] P8 — 편입 ④ 설치계획 (2026-07-24) — install_plans.ticket_id, 2축 상태 매핑(작성완료·회신대기→Pending), 생성 2경로(직접+mail-queue 승격), 백필 72건, UI(emerald 배지·Linked Work·타임라인), 스모크 9케이스 통과
- [x] P9 — 편입 ⑤ 프로젝트 (2026-07-24) — projects.ticket_id, BuildStatus 라벨 앵커 매핑, dueAt=완료예정일(SLA 필드 첫 활용), CTI 구축 신설, projectCode FK 특수 처리, 백필 243건, UI(rose 배지·프로젝트 상세 최소 침습 삽입), 스모크 9케이스+전 유형 총계 5건 통과. **게이트 통과: 2026-07-24 사용자 일괄 승인**
- [x] P10 — tasks 대체·폐기 (2026-07-24) — 누락 0건 대조 검증(불일치 16건 전부 티켓이 더 정확: 고아 3·과거 동기화 누락 13), /api/tasks 제거·/tasks→/tickets 리다이렉트(force-dynamic)·nav 비활성(시드에 반영)·도메인 라우트의 Task 동기화 코드 전부 제거(알림·병원 전진 훅은 보존). tasks 테이블 561건 동결 보존. workItemReassign은 P13 정리. 게이트: P13 전 일괄 확인
- [x] P11 — 알림·SLA 재편 (2026-07-24) — 티켓 이벤트 단일 파이프라인(sig v2 4축 감지·큐 멤버 멘션·Sev1 @channel/Sev2 멘션·배정 DM), Sev SLA(notify_sla_rules 1/1/3/7/없음·dueAt 자동 산정·백필 98건), findDelayedTickets(초과/임박/체류)·owner DM, RESOLVED 자동 종결(ticket_auto_close_days), 설정 화면 개편. tsc 0오류. **게이트 검증 완료(2026-07-25 스모크 — 이벤트별 발송·이중 발송 0건), 사용자 승인 대기**
- [x] P12 — 지표·대시보드 (2026-07-25) — GET /api/tickets/metrics(raw SQL·KST, perOwner ADMIN 한정) + /tickets/dashboard(KPI 6·필터·차트 4종·월별 표·담당별 표·체류 Top10, 목록 버튼 진입). 백필 음수 소요 0 클램프. 수기 대조 9지표 일치·필터·권한 분기 검증. **게이트: 사용자 승인 대기**
- [x] P13 — 안정화·마무리 (2026-07-25) — 이월 갭 2건 수정(재지정·이관 시 티켓 병원/제목 동기화 + Task 미러 제거, 프로젝트 티켓 전이 '운영' 훅), CLAUDE.md 티켓 규칙 4개·README 정합화, PROD 반영 체크리스트 문서화. 회귀 매트릭스 전 항목 통과(전이표·마스터서브·큐연쇄·권한·auto-close·양방향 동기화·이중발송 0·삭제 동반). **게이트: 사용자 최종 승인 대기 → 프로젝트 완료**
