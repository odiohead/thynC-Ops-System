# 티켓 시스템 설계안 (ticket_system_design.md)

> 설계 진행 방식·Phase·게이트는 `ticket_design_plan.md` 참조.
> 이 문서는 **전역 결정만** 담아 얇게 유지한다. 상세 설계(화면·API·SQL)는 구현 Phase 시작 시 `ticket_dev_schedule.md`에 기재.
>
> 대원칙 (사전 합의): **티켓 = 공통 워크플로 껍데기 / 도메인 레코드 = 구조화된 본문 (1:1 연결)**, 필드 소유권 중복 금지, **AWS 티켓시스템(SIM/tt) 충실 재현** — 축소는 사내 규모상 불가피한 경우에만.

---

# 1. 현황 인벤토리 (D1 — 조사 결과, 결정 없음)

조사일: 2026-07-23 (dev2, DB row 수는 PROD 동기화본 기준 근사치)

## 1.1 전 시스템 공통 워크플로 인프라 (모듈 조사 중 발견)

티켓 설계에 직접 영향을 주는 기존 공통 장치들:

| 인프라 | 내용 | 티켓 설계 관점 |
|---|---|---|
| **`status_codes` (StatusCode, 45행)** | 상태를 Prisma enum이 아닌 DB 테이블로 관리. `id, name, value, order, color, category` — `category`로 모듈 구분 (MAINTENANCE / SITE_VISIT / HOSPITAL 등) | 상태값이 이미 동적·중앙화되어 있음. 단 **StatusCode 사용 모듈에는 전이 규칙 없음** (자유 변경) — 전 시스템 유일한 전이 강제는 병원 영업 상태의 rank 기반 전진(`lib/hospitalStatus.ts`, 1.3 참조) |
| **Slack 알림 (`lib/notify.ts` → `lib/slack.ts`)** | `task_created` / `task_status_changed` / `delayed` 이벤트를 `taskType`(MAINTENANCE, SITE_VISIT 등) 구분으로 발송, `notification_logs`(95행) 기록. best-effort | 이미 "업무 이벤트 알림"이 모듈 횡단으로 추상화되어 있음 — 티켓 이벤트로 일반화 가능 |
| **`audit_logs` (3,116행)** | 전역 감사 로그 (`lib/audit.ts`) | 프로세스 지표(P10)의 보조 소스 후보 |
| **Google Calendar 연동 (`lib/googleCalendar.ts`)** | 방문/일정형 데이터에 캘린더 이벤트 생성·수정·삭제 | 도메인 고유 기능 — 티켓 레이어가 아닌 도메인에 잔류 |
| **수신 큐 테이블** | `site_visit_queue`(80행, Gmail→답사 자동생성 대기), `install_plan_queue`(77행), `consultation_queue`(0행) | "외부 유입 → 대기 → 레코드 생성" 흐름이 이미 존재. AWS식 "큐"(배정 단위)와는 다른 개념이므로 용어 충돌 주의 |

## 1.2 워크플로 모듈 상세 인벤토리 (6모듈)

### ① 유지보수 (maintenances) — 본체 215행

| 항목 | 내용 |
|---|---|
| 테이블 | `maintenances` + `maintenance_logs`(30) · `maintenance_visits`(195) · `maintenance_assignees`(235) · `maintenance_files`(5) |
| 상태 | `statusId → StatusCode`(category MAINTENANCE). 별도 `typeId`도 StatusCode 참조. **전이 강제 없음** — PATCH에서 그대로 set, 변경 시 `statusChangedAt`만 갱신 (`app/api/maintenances/[id]/route.ts:68-70`) |
| 배정 | `MaintenanceAssignee` — **User 개인, 복수 가능** (조직 배정 아님) |
| 이력 | `maintenance_logs`: authorId·createdAt 자동 기록, content는 **Tiptap HTML**(sanitize). 4모듈 중 유일하게 구조화된 처리 기록 보유 |
| 우선순위/기한 | `priority String @default("보통")` (자유 문자열). 기한 필드 없음 — `reportedAt`(신고)·`resolvedAt`(종결)·방문일정(`maintenance_visits.startDate/endDate`)만 |
| 알림 | Slack: 생성 시 `task_created`, 상태 변경 시 `task_status_changed`. 캘린더: 방문 항목별 이벤트 |
| 참조 | `hospitalCode → Hospital`(필수). Project와 직접 FK 없음 |
| 화면 | 목록/상세/생성 + `MaintenanceLogPanel` |

### ② 현장 답사 (site-visits) — 본체 100행

| 항목 | 내용 |
|---|---|
| 테이블 | `site_visits` + `site_visit_files`(119) · `site_visit_assignees`(111) · `site_visit_queue`(80, Gmail 수신 큐) |
| 상태 | `statusId → StatusCode`(category SITE_VISIT). **전이 강제 없음** (`app/api/site-visits/[id]/route.ts:67-72`) |
| 배정 | `SiteVisitAssignee` — User 개인·복수 + `daewoongUserId`(대웅 담당자 단일 슬롯) |
| 이력 | **전용 로그 테이블 없음** — `notes` 단일 필드(Tiptap) + 전역 AuditLog뿐 |
| 우선순위/기한 | priority 없음. `requestDate`(요청)·`visitDate`(방문 예정)·`replyDate`(회신) |
| 알림 | Slack: `task_created` / `task_status_changed`. 캘린더: visitDate·담당자 변경 시 |
| 참조 | `hospitalCode → Hospital`(필수), `daewoongUserId → User`. `SiteVisitQueue`가 1:1 역참조 |
| 화면 | 목록/상세/생성 |

### ③ 업무 (tasks) — 본체 547행 ⚠️ 성격 재정의

**독립 워크플로 모듈이 아님.** 5개 원본 모듈(프로젝트·답사·설치계획·유지보수·기타업무)을 통합하는 **롤업/체크리스트 테이블** — 원본 모듈이 생성·삭제·완료를 동기화한다.

| 항목 | 내용 |
|---|---|
| 테이블 | `tasks` 단일 (로그·첨부·배정 자식 없음) |
| 상태 | `isCompleted Boolean` + `completedAt` 뿐. `taskType`(String: PROJECT/SITE_VISIT/INSTALL_PLAN/MAINTENANCE/ETC). 완료 토글이 원본 상태를 바꾸지 않음 (`app/api/tasks/[id]/route.ts:24-33`) |
| 배정 | 없음 — 담당은 원본 모듈의 assignee 테이블에 존재 |
| 이력/우선순위/기한 | 전부 없음 |
| 알림 | 토글 자체는 알림 대상 아님(주석 명시) — 알림은 원본 모듈에서 발송 |
| 참조 | `hospitalCode`만 실제 FK. 원본과는 문자열 `refCode`(예: `IP-YYYYMM-NNNNN`)로 **느슨 연결**, 런타임 조인 (`app/api/tasks/route.ts:43-72`) |
| 화면 | `/tasks` 통합 목록만 (생성·상세 없음, 행 클릭 시 원본 상세로 이동) |

**티켓 설계 관점**: tasks는 이미 "모듈 횡단 통합 뷰"라는 티켓 시스템의 문제의식을 절반 구현한 선행물이다. 티켓 도입 시 tasks의 역할(롤업 뷰)은 티켓 목록이 자연 대체할 가능성이 높음 — D2 쟁점.

### ④ 설치계획 (install-plans) — 본체 69행

| 항목 | 내용 |
|---|---|
| 테이블 | `install_plans` + `install_plan_files`(100) · `install_plan_assignees`(63) · `install_plan_queue`(77, Gmail 인입 큐 1:1) |
| 상태 | StatusCode 미사용 — 자유 문자열 2개: `writeStatus`(작성완료여부)·`replyStatus`(회신여부), 허용값 `'-'/'미완료'/'완료'`는 UI에만 존재. 전이 강제 없음. **`statusChangedAt` 없음** (다른 모듈과 달리 — 지연 감지 갭). 둘 다 '완료'면 연동 Task 자동 완료 (`app/api/install-plans/[id]/route.ts:74-79`) |
| 배정 | `InstallPlanAssignee` — User 개인·복수 ("담당자(씨어스)") |
| 이력 | 전용 로그 테이블 없음 — `note` 단일 필드(Tiptap `RichTextEditor`) |
| 우선순위/기한 | priority 없음. `requestDate`(요청)·`replyDate`(회신)만 |
| 알림 | Slack: 생성 `task_created` / 상태변경 `task_status_changed`(시그니처 `작성:x/회신:y`로 감지) / 지연(delayed) 파이프라인 포함 (`lib/notify.ts:289-305`) |
| 참조 | `hospitalCode`(옵셔널). 생성 시 Task 자동 생성 + `advanceHospitalStatus('가견적요청')`로 **병원 영업 상태 전진** (`app/api/install-plans/route.ts:132-138`). 삭제 시 큐 `ignored` 처리 + Task 삭제(트랜잭션) |
| 화면 | 목록/상세/생성 |

### ⑤ 기타업무 (etc-tasks) — 본체 27행

| 항목 | 내용 |
|---|---|
| 테이블 | `etc_tasks` + `etc_task_assignees`(34) · `etc_task_hospitals`(9, **병원 N:M — 6모듈 중 유일**) · `etc_task_visits`(28, 업무기간 다건) · `etc_task_files` |
| 상태 | `statusId → StatusCode`(category ETC_TASK_STATUS). 시드: **접수/처리중/완료/보류** (런타임 관리 화면 `app/settings/etc-task-status`). `statusChangedAt` 있음. 전이 강제 없음. '완료' 시 Task 롤업 `isCompleted` 동기화 |
| 배정 | `EtcTaskAssignee` — User 개인·복수 (PUT은 delete-all→createMany) |
| 이력 | 전용 로그 없음 — `note` 단일 필드(Tiptap) + AuditLog |
| 우선순위/기한 | `priority`(긴급/높음/보통/낮음, 기본 '보통'). `reportedAt`(접수)·`resolvedAt`(완료). 기간은 visits 다건 |
| 알림 | Slack taskType `'ETC'`: task_created/status_changed + **지연 감지 포함**(접수일+N일, 상태 체류) |
| 참조 | 병원 N:M(미지정 허용) → Task 롤업은 `hospitalCode: null`로 생성. **Task 자동 생성 O**. advanceHospitalStatus 호출 없음. 캘린더: visit별 이벤트 |
| 화면 | 목록/상세(숫자 id)/생성 |

### ⑥ 프로젝트 (projects) — 본체 242행

| 항목 | 내용 |
|---|---|
| 테이블 | `projects` + `project_assignees`(98) · `project_devices`(270) · `project_files`(50) + 상태 마스터 `build_statuses`(5) |
| 상태 | `buildStatusId → BuildStatus`(**StatusCode가 아닌 별도 마스터**, 라벨은 런타임 자유 등록 — `app/settings/build-status`). 코드가 의미로 참조하는 라벨: '완료' 포함 여부(구축완료 판정)·'보류'(정렬·지연 제외). `statusChangedAt` 있음. 전이 강제 없음 |
| 배정 | `ProjectAssignee` — User 개인·복수 + `constructorId → Contractor`(시공사 단일) + `builderNameManual` |
| 이력 | 전용 로그 없음. **이슈노트는 위키 전환 완료** — `ProjectIssueNotePanel`(BlockNote + Y.Doc 실시간 협업, HTTP `/api/wiki/*`). `issueNote` 컬럼은 레거시 잔존 |
| 우선순위/기한 | priority 없음. `contractDate`·`startDate`·`endDateExpected`(완료예정 — 지연 판정 기준) |
| 알림 | Slack taskType `'PROJECT'`: task_created/status_changed + **지연 감지 포함**(완료예정일 경과, 상태 체류) |
| 참조 | `hospitalCode` 단일 FK. 답사·설치계획·유지보수와 직접 FK 없음(병원 매개 느슨 연결). **advanceHospitalStatus 호출 O**: 계약일 입력→'계약완료', 구축완료→'운영' 전진. ⚠️ **Task 롤업 자동 생성 X** — 일회성 백필 스크립트로만 존재(신규 프로젝트는 롤업 누락 갭) |
| 화면 | 목록/상세(**projectCode 라우팅**)/생성/캘린더 |

## 1.3 워크플로 보유 모듈 전수 목록 (스키마 전수 스캔 실측 — 위키 제외)

전제 사실: 이 시스템의 Prisma enum은 `Role` 하나뿐이며, "상태"는 대부분 **StatusCode 마스터를 category로 분기해 FK 참조**하거나 자유 문자열이다.

| 모델 (row) | 상태 필드 / 값 | 담당 | 성격 판정 |
|---|---|---|---|
| `Maintenance`(215) | `statusId`→StatusCode + `statusChangedAt` + `priority` | Assignee N:M | **워크플로** (1.2① — 로그·방문·첨부 완비) |
| `SiteVisit`(100) | `statusId`→StatusCode + `statusChangedAt` | Assignee N:M + daewoongUser | **워크플로** (1.2②) |
| `InstallPlan`(69) | `writeStatus`/`replyStatus` 자유 문자열 (statusChangedAt 없음) | Assignee N:M | **워크플로** (1.2④) |
| `Task`(547) | `isCompleted` Boolean | 없음 | **롤업 체크리스트** (1.2③ — 독립 모듈 아님) |
| `EtcTask`(27) | `statusId`→StatusCode + `statusChangedAt` + `priority` | Assignee N:M | **워크플로** — 기타업무. 병원·방문·첨부 자식 有, 로그 없음. D1b 상세 조사 |
| `Project`(242) | `buildStatusId`→BuildStatus(공사상태) + `statusChangedAt` + `hasSurvey`/`hasOrder` | Assignee N:M | **워크플로** (공사 진행). D1b 상세 조사 |
| `Hospital`(79,738 — HIRA 전수 포함, 실고객은 일부) | `status` 문자열 파이프라인 (미계약→가견적요청→답사요청→계약완료→운영→해지), **rank 기반 전진 강제 로직 존재** (`lib/hospitalStatus.ts`) — 전 시스템에서 유일한 상태 전이 규칙 | DaewoongHospitalAssignment | **세일즈 파이프라인** (워크플로 성격의 마스터). D1b에서 티켓 포섭 여부 판별 |
| `ConsultationQueue`(0) | `status`(기본 PENDING) | consultedById | 상담 처리 큐. D1b 확인 |
| `InstallPlanQueue`(77) / `SiteVisitQueue`(80) | `status`(pending/ignored 등) | 없음 | **인입 큐** (Gmail 인박스 — AWS식 배정 큐와 다른 개념) |
| `VehicleReservation`(71) | `status`(RESERVED~) + `returnedAt` | userId(예약자) | 예약 생명주기. D1b에서 티켓 포섭 여부 판별 |
| `VehicleLog`(16) | 상태 없음 | driverId | 운행 확정 기록 (이력) |
| `InventoryTransaction`(28) | `txType`(IN/OUT/MOVE) + 취소 상태(`canceledAt`) | actorId | 전표 원장 — 승인 흐름 없음. 티켓 대상 아닐 가능성 높음 |
| `InventoryUnit`(0) | `status`(IN_STOCK~) | 배치처 | 자산 개체 추적 (워크플로 아님) |
| `HiraSyncJob`(4) / `GatewayPlanJob`(2) | `status`(running / PENDING~ERROR) | — | 배치·파이프라인 잡 (사람 업무 아님 — 티켓 제외 유력) |

단순 마스터데이터(상태·담당·이력 없음): HiraHospital, StatusCode, BuildStatus, Organization, User, Department, FieldEngineer, DeviceInfo, Contractor, Warehouse, Inventory 계열 마스터, Vehicle, NavMenuItem, AppSetting 등.

## 1.3.1 경계 모듈 판별 결과 (D1b 조사 완료)

세 대상 모두 **티켓 포섭 대상 아님**으로 판별. 근거:

### 병원 영업 파이프라인 (Hospital.status) — 자동 파생 상태, 티켓 아님
- 6단계 rank 단방향 파이프라인(미계약→가견적요청→답사요청→계약완료→운영→해지). `advanceHospitalStatus`(전진 전용)가 답사·설치계획·프로젝트·메일큐 등록 API **6곳에서 자동 호출** — 사람이 집어 처리하는 업무 단위가 아니라 **다른 업무 발생의 파생 결과**
- `recomputeHospitalStatus`(하향 포함 재계산)는 업무 재지정 시 상태를 역산(`lib/workItemReassign.ts`). 담당자는 `DaewoongHospitalAssignment`로 상태와 분리
- **티켓 관점 시사점**: 티켓이 도메인 편입 후에도 이 자동 전진 훅(도메인 레코드 생성 시 발동)은 도메인 측에 그대로 잔류해야 함. 주의 — 병원 편집 폼 PUT은 rank 검증 없이 status를 덮어쓸 수 있는 우회 경로 존재(`app/api/hospitals/[code]/route.ts:80-95`)
- ⚠️ 단, "병원 담당자(대웅) 관점의 영업 활동" 자체를 업무 티켓으로 만들지는 D2에서 별도 논의 가능 (파이프라인 상태와는 별개 문제)

### 차량 예약 (VehicleReservation) — 셀프서비스 예약 시스템, 티켓 아님
- status는 RESERVED/CANCELED 2값뿐, 반납은 `returnedAt` 타임스탬프 + VehicleLog(운행일지) 자동 생성. 승인자·배차 담당·배정 필드 전무, 본인 예약만 조작(관리자는 예외 개입). 알림 연동 없음
- "시간 점유 예약 + 실적 일지 전환" 모델 — 큐 배정·worklog가 자연스럽게 매핑되지 않음

### 상담 큐 (ConsultationQueue) — 폐기된 레거시, 제외
- 0행, API·UI 제거됨(README: "상담 대기열 폐기, 테이블은 이력 보존"). AI 상담 정리는 위키 병원노트 흐름으로 대체. 잔존 참조는 병원 재지정 하우스키핑 1곳뿐

**추가 판별 (D1a 근거)**: 인입 큐 2종(SiteVisitQueue·InstallPlanQueue)은 "외부 유입 → 도메인 레코드 승격" 전 단계로, AWS로 치면 티켓 생성 *소스*(메일 인테이크)에 해당 — 티켓 자체가 아니라 **티켓 생성 채널로 편입 검토** 대상(D2 쟁점). HiraSyncJob·GatewayPlanJob은 사람 업무가 아닌 배치 잡으로 제외.

## 1.4 공통 요소 매트릭스 — "티켓 껍데기로 올릴 수 있는 것"

티켓 편입 대상 5개 워크플로 모듈 비교 (tasks 롤업은 대체 대상이므로 제외):

| 요소 | 유지보수 | 답사 | 설치계획 | 기타업무 | 프로젝트 |
|---|---|---|---|---|---|
| 상태 체계 | StatusCode<br>(MAINTENANCE) | StatusCode<br>(SITE_VISIT) | 자유 문자열 2개<br>(write/reply) | StatusCode<br>(ETC_TASK_STATUS) | BuildStatus<br>(별도 마스터) |
| `statusChangedAt` | ✅ | ✅ | ❌ | ✅ | ✅ |
| 전이 강제 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 담당 User N:M | ✅ | ✅ (+대웅 단일) | ✅ | ✅ | ✅ (+시공사 단일) |
| 조직 단위 배정 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 우선순위 | ✅ 문자열 | ❌ | ❌ | ✅ 4단계 | ❌ |
| 기한(마감) | ❌ | ❌ | ❌ | ❌ | ✅ endDateExpected |
| worklog(타임라인) | ✅ maintenance_logs<br>(Tiptap) | ❌ | ❌ | ❌ | △ 위키 이슈노트<br>(BlockNote·성격 다름) |
| 단일 note 필드 | — | ✅ Tiptap | ✅ Tiptap | ✅ Tiptap | 레거시 issueNote |
| 첨부 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 방문/일정 다건 | ✅ visits | ❌ (visitDate 단일) | ❌ | ✅ visits | ❌ (startDate) |
| 병원 연결 | 단일 필수 | 단일 필수 | 단일 옵션 | **N:M** (미지정 허용) | 단일 |
| Task 롤업 자동 생성 | ✅ | ⚠️ 큐 승격 시만<br>(직접 생성 시 누락) | ✅ | ✅ | ❌ (백필만) |
| Slack 알림 (생성·상태변경) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 지연 감지 (`lib/delay-rules.ts`) | ✅ 접수+N일·체류 | ✅ 요청+N일·체류 | ✅ 요청+N일 | ✅ 접수+N일·체류 | ✅ 예정일·체류 |
| Google Calendar | ✅ visit별 | ✅ visitDate | ❌ | ✅ visit별 | ✅ 1건 |
| 병원 상태 전진 훅 | ❌ | ✅ (생성 시) | ✅ (생성 시) | ❌ | ✅ (계약·완료 시) |
| 메일 인입 큐 | ❌ | ✅ site_visit_queue | ✅ install_plan_queue | ❌ | ❌ (mail-queue→Task는 별도) |

### 매트릭스가 말해주는 것 (D2 입력)

**티켓 껍데기로 승격할 공통 요소 (전 모듈 보유 또는 보유해야 마땅한 것)**
1. **상태 + statusChangedAt** — 5모듈 전부 상태 보유. 단 체계가 3종(StatusCode/자유문자열/BuildStatus)으로 갈라져 있고 전이 강제는 전무 → 티켓 공통 라이프사이클로 평준화 대상
2. **담당 배정** — 전 모듈 User 개인·복수(N:M) 패턴 동일 → 티켓 배정으로 일반화 용이. 조직(큐) 단위 배정은 전 시스템에 부재 — AWS식 큐는 순수 신규 도입
3. **우선순위·기한** — 보유 모듈이 소수(2/5, 1/5)지만 지연 감지는 전 모듈 대상 → 티켓 공통 필드로 승격하면 지연 감지가 단순해짐
4. **worklog** — 유지보수만 보유 → 티켓 공통 correspondence로 신설이 사실상 필수 (답사·설치계획·기타업무는 이력이 아예 없음)
5. **Slack 알림·지연 감지** — 이미 taskType 스위치로 모듈 횡단 추상화 완료 → 티켓 이벤트 기반으로 재편 최적 조건

**도메인에 잔류할 고유 요소**
- 방문/일정 다건(visits) + Google Calendar 연동, 병원 상태 전진 훅, 메일 인입 큐(→티켓 생성 채널로 재해석 가능), 대웅 담당자·시공사 슬롯, 장비/파일 구조

**티켓 도입이 해소하는 기존 갭 (실측)**
- 프로젝트·답사(직접 생성)의 Task 롤업 누락 → 롤업 테이블 대체 시 자연 해소
- 설치계획 statusChangedAt 부재 → 티켓 상태 이벤트로 해소
- 답사·설치계획·기타업무의 처리 이력 부재 → 티켓 worklog로 해소
- 우선순위·기한의 모듈별 파편화 → 티켓 공통 필드로 해소

---

# 2. 전역 결정 (D2)

> ✅ **D2b 확정 완료 (2026-07-23, 사용자 결정)** — 전 항목 ★ 권장안으로 확정. 쟁점 4건 개별 확인: ① 11개 권장안 일괄 채택 ② **프로젝트 완전 편입**(마지막 Phase — "링크만" 옵션 기각) ③ Sev 매핑 긴급→Sev2·**Sev1 신규 예약** ④ 티켓 상태 **하드 enum + 전이표 강제**(StatusCode 관례 미적용).
> 이 섹션이 모든 구현 Phase의 전역 결정 원본이다. 변경하려면 사용자 승인 필요.
> 각 항목: 옵션 → 확정안(★) → 근거. 인벤토리 근거는 §1 참조.

## 2.1 티켓-도메인 연결 구조

| 옵션 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A ★** | **도메인 테이블에 `ticket_id` FK (UNIQUE, nullable)** — 티켓이 먼저 존재, 도메인 레코드가 자기 티켓을 가리킴 | FK 무결성 보장, 1:1 강제, 순수 티켓(도메인 없음) 자연 지원, "모든 업무는 티켓으로 시작"(AWS) 방향과 일치 | 편입 시 도메인 테이블마다 컬럼 추가 마이그레이션 필요 |
| B | 티켓에 폴리모픽 참조(`ref_type`+`ref_id`) | 도메인 테이블 무변경 | FK 무결성 없음 — **기존 tasks.refCode 느슨 연결의 갭(§1.2③)을 그대로 반복** |
| C | 별도 연결 테이블 | 유연(N:M 가능) | 1:1 강제 불가, 조인 비용, 필요 없는 유연성 |

**근거**: 롤업 누락 갭(§1.4)의 근본 원인이 느슨 연결이었음. nullable로 두는 이유는 편입 전 병행 운영 기간 지원 — 편입 완료 모듈은 생성 시 티켓 동시 생성(트랜잭션)으로 사실상 NOT NULL 운용.

**보강 2 (2026-07-24, 사용자 확정): 도메인 연결 표시 방식** — 도메인 레코드(코드·주요 필드)는 기존 형상 그대로 유지(재확인). 티켓 쪽 표현은 설명란 링크가 아니라 **구조화 방식**: `tickets.ref_type`(MAINTENANCE/SITE_VISIT/INSTALL_PLAN/ETC/PROJECT, NULL=순수 티켓 — 도메인 데이터 복제가 아닌 포인터, 연결 트랜잭션에서 세팅) + 티켓 상세 "연결된 업무" 패널(유형 배지·도메인 코드·주요 필드 요약·이동 버튼) + 목록 유형 배지/필터. 기존 tasks.refCode 텍스트 연결의 실패 반복 방지. 구현은 P5~P9 각 편입 Phase에서.

**보강 (2026-07-24, 사용자 지시): 마스터-서브 티켓** — AWS SIM parent/child 재현. `tickets.parent_id` self-FK(SET NULL). 규칙: ① **2레벨 고정** — 서브 티켓은 자식을 가질 수 없고, 부모가 있는 티켓을 부모로 지정 불가 ② **마스터는 열린 서브가 있으면 RESOLVED/CLOSED 전이 거부**(자식 먼저 해결 — AWS 관례) ③ 연결/해제는 양쪽 티켓 타임라인에 `link` 이벤트 기록 ④ CLOSED 재오픈(§2.3)의 "신규 티켓+링크"도 이 메커니즘 사용. 일반 관련 링크(non-계층)는 후순위 — 필요해지면 별도 ticket_links로.

## 2.2 tasks(롤업) 모듈 처리

| 옵션 | 내용 |
|---|---|
| **A ★** | **티켓으로 흡수·대체** — 기존 tasks 데이터를 티켓으로 백필, `/tasks` 화면은 티켓 목록으로 교체, 테이블은 이력 보존 후 폐기(ConsultationQueue 선례) |
| B | 존치 병행 | 
| C | 폐기만 하고 백필 생략 |

**근거**: tasks는 이미 "모듈 횡단 통합 뷰"(§1.2③) — 티켓 목록이 상위 호환. 병행(B)은 이중 관리, 백필 생략(C)은 미완료 업무 547행의 추적 단절. 원본 모듈들의 Task 동기화 코드(생성·완료·삭제)는 티켓 동기화로 치환.

## 2.3 상태 라이프사이클

| 옵션 | 내용 |
|---|---|
| **A ★** | **AWS 충실 6상태 + 재오픈**: `OPEN`(접수) → `ASSIGNED`(배정) → `IN_PROGRESS`(진행) → `PENDING`(대기, **사유 필수**) → `RESOLVED`(해결) → `CLOSED`(종결). RESOLVED→재오픈 가능, CLOSED는 N일 경과 후 자동 확정(재오픈 시 신규 티켓+링크) |
| B | 4상태 축소(접수/진행/대기/완료) |

**부속 결정**: ① 티켓 상태는 StatusCode 테이블이 아닌 **하드 enum + 코드 전이표 강제** — 전이 규칙 부재(§1.4 전 모듈 ❌)를 고치는 것이 도입 목적이므로 상태 집합 자체를 런타임 편집 가능하게 두면 목적 훼손. ② 도메인 고유 상태(BuildStatus 등)는 도메인에 잔류 — 티켓 상태와의 매핑은 편입 Phase별 상세 설계에서. ③ PENDING 사유 코드(외부 회신 대기/자재 대기/일정 대기 등)는 런타임 관리 마스터.

**근거**: AWS SIM의 Assigned/WIP/Pending/Resolved 재현. PENDING 사유 필수는 "대기가 왜 발생했나"가 프로세스 지표(§2.11)의 핵심 축이기 때문.

## 2.4 큐/배정 모델

| 옵션 | 내용 |
|---|---|
| **A ★** | **AWS식 큐 신설**: `ticket_queues` 마스터(예: 영업/답사/설치/유지보수/관리 — 런타임 관리 화면). 티켓은 항상 큐에 소속(`queue_id` 필수), 개인 배정 없이 큐 대기 가능. **owner 단일**(AWS식 책임자) + **참여자 N:M**(기존 복수 담당 관례 수용). 큐 간 이관(transfer) 지원 |
| B | 큐 없이 개인 배정만(현행 일반화) |

**근거**: 조직 단위 배정은 전 시스템 부재(§1.4) — AWS 재현의 핵심 신규 요소. "담당자 부재 ≠ 업무 정체"를 만드는 장치. 큐는 Organization(2행, 회사 구분)·Department(부서)와 별개 마스터로 — 큐는 *기능* 단위이지 조직도가 아님. 기존 모듈의 daewoong 슬롯·시공사 슬롯은 도메인 잔류(§1.4).

**보강 (2026-07-24, 사용자 지시)**: **큐 멤버십 추가** — AWS resolver group처럼 큐마다 인원을 배정(`ticket_queue_members` N:M). 용도: ① 담당자 선택 시 큐 멤버 우선 노출 ② 큐 신규 티켓 알림 수신 대상(P11) ③ "내 큐" 뷰. 멤버가 아니어도 배정 자체는 가능(강제 아님 — 사내 규모상 유연성 유지).

## 2.5 분류 체계 (CTI)

| 옵션 | 내용 |
|---|---|
| **A ★** | **AWS 충실 3단계 Category/Type/Item** — 계층 마스터 테이블(런타임 관리), 티켓에 `cti_id`. **CTI → 기본 큐 자동 라우팅**(CTI 노드에 default_queue 지정) |
| B | 2단계 축소 |

**근거**: AWS에서 CTI 선택 = 큐 결정이라는 라우팅 본질 재현. 예시 계층(D2b 논의용): `고객지원/장애/센서류`, `영업/신규도입/답사`, `내부/자산/차량` 등. 초기 트리는 편입 모듈 5종의 기존 분류(유지보수 typeId, 기타업무 등)에서 도출.

## 2.6 우선순위/심각도 — Sev1~Sev5 (5단계 고정)

**사용자 명시 지시(사전 합의 6)로 5단계 확정 권장 — D2b에서는 의미 정의만 논의.**

| Sev | 의미(안) | 대응 기대 | 알림 |
|---|---|---|---|
| **Sev1** | 전사 비상 — 고객사(병원) 서비스 전면 중단급 | 즉시, 전원 인지 | Slack 즉시 + 강조(별도 채널/멘션) |
| **Sev2** | 긴급 — 당일 착수 필요(주요 기능 장애, 긴급 요청) | 당일 | Slack 즉시 |
| **Sev3** | 표준 — 큐 순서대로 처리 | SLA 목표 내 | 일반 알림 |
| **Sev4** | 낮음 — 여유 있는 요청·개선 | 여유 | 일반 알림 |
| **Sev5** | 백로그 — 기록해두고 기회 시 처리 | 없음 | 없음 |

**부속 결정**: ① 기존 우선순위 매핑(백필용): 긴급→Sev2, 높음→Sev3, 보통→Sev4, 낮음→Sev5. **Sev1은 신규 예약**(AWS에서도 Sev1은 극히 드묾 — 기존 '긴급'을 Sev1로 올리면 인플레이션). ② Sev별 SLA 목표일은 기존 `lib/delay-rules.ts`의 모듈별 N일 규칙을 Sev 기준으로 재편(런타임 설정 유지). ③ 페이징(전화 호출)은 도입하지 않음 — Sev1·2의 Slack 즉시 알림으로 갈음(사내 규모).

## 2.7 이력(worklog/correspondence) 모델

| 옵션 | 내용 |
|---|---|
| **A ★** | **공통 `ticket_logs` 신설** — 한 테이블에 2계열: ① `comment`(사람 작성, **Tiptap HTML** — 코딩 컨벤션의 에디터 분기 준수, 위키 BlockNote 아님) ② 시스템 이벤트(`status_change`/`assign`/`queue_transfer`/`sev_change` 등, 구조화 payload JSONB) — 자동 기록 |
| B | 코멘트/이벤트 테이블 분리 |
| C | 기존 모듈별 로그 존치 + 연결 |

**부속 결정**: `maintenance_logs`(30행)는 유지보수 편입 Phase에서 티켓 로그로 이관(원본 보존). 프로젝트 이슈노트(위키)는 성격이 다름(협업 문서) — 이관하지 않고 티켓에서 링크만.

**근거**: AWS correspondence = 시간순 단일 스레드 재현. 시스템 이벤트를 같은 타임라인에 두면 "티켓 안에 모든 기록"이라는 문화 재현 + 프로세스 지표(§2.11) 원천 데이터 확보. 답사·설치계획·기타업무는 이력이 아예 없어(§1.4) 신설 필수.

## 2.8 DB 스키마 위치

| 옵션 | 내용 |
|---|---|
| **A ★** | **`public` 스키마** |
| B | 위키처럼 별도 `ticket` 스키마 |

**근거**: 위키의 별도 스키마는 "떼어낼 수 있는 부가 모듈" 보존 목적이었으나, 티켓은 반대로 **메인 업무의 백본**이며 도메인 테이블(public)이 `ticket_id` FK로 티켓을 참조해야 함(§2.1) — 별도 스키마로 가르면 wiki 규칙(public→wiki FK 금지)과 같은 경계 원칙을 스스로 위반하게 됨. 테이블 명명은 `tickets`, `ticket_logs`, `ticket_queues`, `ticket_cti` 등 접두사로 구분.

## 2.9 기존 모듈 편입 순서

| 옵션 | 순서 | 논거 |
|---|---|---|
| **A ★** | **유지보수 → 기타업무 → 답사 → 설치계획 → 프로젝트** | 유지보수: 가장 티켓다움(worklog·우선순위 기보유, AWS 장애 티켓과 동형) — 패턴 확립용 1호. 기타업무: 구조 유사(StatusCode·우선순위)로 저비용 2호, 단 병원 N:M 특수성 처리. 답사·설치계획: 이력 부재 모듈에 worklog 부여 + 인입 큐를 티켓 생성 채널로 재해석. 프로젝트: 상태 체계 이질(BuildStatus·장기 진행형)이라 최후 |
| B | 프로젝트 편입 제외(티켓 링크만) | 장기 프로젝트는 티켓보다 프로젝트 관리 성격 — **D2b에서 기각** (사용자 결정: "모든 업무 티켓화" 목표 우선, 2레이어 구조로 이질성 흡수) |

**공통**: 각 편입 Phase는 병행 운영(도메인 화면 유지 + 티켓 화면 병행) → 백필 → 전환 순. 잠정 로드맵(P5~P8, `ticket_design_plan.md`)의 순서는 이 결정으로 대체.

## 2.10 알림

| 옵션 | 내용 |
|---|---|
| **A ★** | **기존 `lib/notify.ts` 확장** — taskType 스위치를 티켓 이벤트로 재편: 생성/큐 배정/개인 배정/상태 변경/코멘트(선택)/SLA 임박·초과(기존 delayed 재편). Sev1·2는 강조 발송(§2.6). `notification_logs` 유지 |
| B | 티켓 전용 알림 신설 병행 |

**근거**: 알림 인프라는 이미 모듈 횡단 추상화 완료(§1.1) — 재작성이 아니라 이벤트 소스를 티켓으로 교체하는 것이 최소 비용. 편입 전 모듈은 기존 경로 유지(병행 기간 이중 발송 방지 규칙은 편입 Phase 상세 설계에서).

## 2.11 대시보드/프로세스 지표 접점

| 옵션 | 내용 |
|---|---|
| **A ★** | **`ticket_logs`의 시스템 이벤트를 지표 원천으로 겸용** — 별도 이벤트 테이블 없음. 지표(접수→해결 소요, 큐 체류, 상태별 체류, 재오픈율, 담당별 처리량)는 SQL 뷰/집계 쿼리로 산출. 대시보드 화면은 P10에서 상세 설계 |
| B | 별도 `ticket_events` 분리 |

**근거**: 이벤트를 이중 기록하면 §사전합의 3(중복 저장 금지) 위반. 규모상(월 수백 티켓) 로그 테이블 집계로 충분. 필요 시 후일 뷰 물질화(materialized view)로 대응 가능 — 지금 분리할 이유 없음.

---

## D2b 확정 결정 요약 (2026-07-23 — 구현 Phase의 준거)

| # | 항목 | 확정안 | 특기 |
|---|---|---|---|
| 2.1 | 연결 구조 | 도메인→ticket_id FK (UNIQUE, nullable) | 편입 완료 모듈은 트랜잭션 동시 생성 |
| 2.2 | tasks 처리 | 티켓 흡수·백필 후 폐기 | 테이블은 이력 보존 |
| 2.3 | 라이프사이클 | AWS 6상태+재오픈, **하드 enum+전이표 강제** | PENDING 사유 필수, 사유 코드는 런타임 마스터 |
| 2.4 | 큐/배정 | 큐 필수 소속 + owner 단일 + 참여자 N:M | 큐는 기능 단위 신규 마스터 |
| 2.5 | 분류 | CTI 3단계 + CTI→큐 자동 라우팅 | 초기 트리는 기존 5모듈 분류에서 도출 |
| 2.6 | 심각도 | **Sev1~5 (5단계 고정)** | 긴급→Sev2·높음→Sev3·보통→Sev4·낮음→Sev5, **Sev1 신규 예약**. SLA는 delay-rules 재편 |
| 2.7 | worklog | ticket_logs 단일(코멘트 Tiptap + 이벤트 JSONB) | maintenance_logs 이관, 위키 이슈노트는 링크만 |
| 2.8 | 스키마 | public (`ticket*` 접두사) | |
| 2.9 | 편입 순서 | 유지보수→기타→답사→설치→**프로젝트(완전 편입)** | 각 Phase 병행 운영→백필→전환 |
| 2.10 | 알림 | notify.ts 확장 | Sev1·2 강조 발송 |
| 2.11 | 지표 | ticket_logs 겸용 + SQL 뷰 | 이벤트 이중 기록 금지 |

**게이트 통과 — 구현 코드 작성 해금.** 다음: D3 (구현 로드맵 → `ticket_dev_schedule.md`)
