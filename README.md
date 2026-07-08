# thynC Operations System

thynC 구축 및 운영을 위한 내부 데이터 관리 시스템입니다.
병원 정보 관리, 프로젝트(구축 공사) 관리, 답사 관리, 유지보수 관리, 조직/사용자 권한 관리 기능을 제공합니다.

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| 프레임워크 | Next.js 14 (App Router) |
| 언어 | TypeScript |
| 스타일링 | Tailwind CSS + 시멘틱 디자인 토큰(HSL CSS 변수, 라이트/다크) — `app/globals.css`·`tailwind.config.ts` |
| 폰트 | Pretendard Variable (self-host, `app/fonts/`) |
| 테마 | 라이트/다크 토글 (`ThemeProvider`, localStorage 영속, 라이트 기본) |
| ORM | Prisma |
| 데이터베이스 | PostgreSQL |
| 인증 | JWT (httpOnly 쿠키, jose 라이브러리) |
| 파일 스토리지 | AWS S3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) |
| 차트 | Recharts |
| 아이콘 | lucide-react |
| 리치 텍스트 에디터 | Tiptap (`@tiptap/react` + 확장) — 기존 모듈용 |
| 블록 에디터 (위키) | BlockNote (`@blocknote/core`, `@blocknote/react`, `@blocknote/ariakit`, `@blocknote/xl-multi-column`) — 위키 전용 |
| 드래그앤드롭 (위키) | `@dnd-kit/core` — 위키 사이드바 트리 이동 전용 |
| 프로세스 관리 | PM2 |
| 웹서버 | Nginx |
| 마크다운 렌더링 | react-markdown + `@tailwindcss/typography` |
| AI 챗봇 | Flowise RAG (외부 API 연동) |
| AI 정제 | Anthropic Claude API (`@anthropic-ai/sdk`) |
| 런타임 | Node.js 20 |

---

## 서버 환경

| 환경 | URL | 포트 | PM2 프로세스명 |
|------|-----|------|----------------|
| DEV  | https://dev.ops.seersthync.com | 3001 | `thync-dev`  |
| PROD | https://ops.seersthync.com     | 3000 | `thync-prod` |

---

## 디렉토리 구조

```
thynC-Ops-System/
├── thynC-Ops-DEV/     # 개발 환경
└── thynC-Ops-PROD/    # 운영 환경
```

```
app/
├── api/                              # API Routes
│   ├── auth/                         # 인증 (login, logout, me)
│   ├── dashboard/                    # 대시보드 집계 API (공사현황·summary·monthly·maintenance·hospital-stats)
│   ├── hospitals/                    # 병원 CRUD + 장비 배정 + 담당자 배정 + Excel 가져오기
│   ├── hira-hospitals/               # HIRA 병원 데이터 조회
│   ├── projects/                     # 프로젝트 CRUD + 장비/파일 관리
│   ├── site-visits/                  # 답사 CRUD + 파일 업로드
│   ├── maintenances/                 # 유지보수 CRUD + 파일 관리
│   ├── tasks/                        # 업무(Task) 통합 조회
│   ├── nav-menus/                    # 네비게이션 메뉴 조회 (Navigation 컴포넌트용)
│   ├── constructors/                 # 시공사 관리
│   ├── users/                        # 시스템 사용자 관리
│   ├── settings/
│   │   ├── organizations/            # 소속(조직) 관리 (SUPER_ADMIN 전용)
│   │   ├── departments/              # 부서 관리 (ADMIN 이상)
│   │   │   └── [id]/                 # 부서 수정/삭제
│   │   ├── field-engineers/          # 필드 엔지니어 관리 (ADMIN 이상)
│   │   │   ├── [id]/                 # 필드 엔지니어 삭제
│   │   │   └── candidates/           # 등록 후보 목록
│   │   ├── devices/                  # 장비 정보 관리
│   │   ├── build-status/             # 공사 상태 관리
│   │   ├── status/                   # 병원 상태코드 관리
│   │   ├── site-visit-status/        # 답사 상태코드 관리
│   │   ├── intro-type/               # 도입형태 관리
│   │   ├── consultation-type/        # 상담유형 관리
│   │   ├── document-type/            # 문서유형 관리
│   │   ├── maintenance-type/         # 장애유형 관리
│   │   ├── maintenance-status/       # 유지보수 상태 관리
│   │   ├── etc-task-status/          # 기타업무 상태 관리
│   │   ├── item-category/            # 품목 분류 트리 CRUD (대>중>소 3단계)
│   │   ├── inventories/              # 인벤토리 마스터 CRUD (이관 잠금 토글, 사용 중 삭제 409)
│   │   ├── stock-in-type/            # 입고 유형 CRUD (시스템 유형·사용 중 삭제 409)
│   │   ├── stock-out-type/           # 출고 유형 CRUD (시스템 유형·사용 중 삭제 409)
│   │   ├── manufacturers/            # 제조사 CRUD (사용 중 삭제 409)
│   │   ├── warehouses/               # 창고(위치) CRUD (재고 잔존 409·이력 시 비활성화)
│   │   ├── inventory-managers/       # 재고 담당자 풀 CRUD + candidates
│   │   ├── nav-menus/                # 네비게이션 메뉴 관리 CRUD (SUPER_ADMIN)
│   │   ├── notifications/            # Slack 알림 설정 GET/PUT (ADMIN — 토글·주기·DM·타입별 필드) + logs/ 발송 이력 조회
│   │   └── audit-logs/               # 감사 로그 조회 (SUPER_ADMIN)
│   ├── ai-assistant/                 # AI 어시스턴트 (Flowise 프록시 + 정제 + 상담이력 저장)
│   │   ├── summarize/                # AI 정제 (Anthropic Claude API)
│   │   └── consultation/             # 상담이력 저장 (ConsultationQueue)
│   ├── wiki/                         # 사내 위키
│   │   ├── pages/
│   │   │   ├── route.ts              # GET 목록 / POST 생성
│   │   │   └── [id]/
│   │   │       ├── route.ts          # GET / PUT / DELETE
│   │   │       ├── move/route.ts     # PATCH 이동 (direction/parentId/position/sortOrder)
│   │   │       └── duplicate/route.ts # POST 복제 (단일/하위 포함)
│   │   └── tree/route.ts             # GET 전체 트리
│   ├── vehicles/                     # 차량 마스터 CRUD (ADMIN 이상 쓰기)
│   ├── vehicle-reservations/         # 차량예약 CRUD (충돌 검사 + soft 취소)
│   │   └── [id]/return/              # 반납(POST: 주행거리 입력→운행일지 생성) / 반납취소(DELETE, ADMIN)
│   ├── vehicle-logs/                 # 운행일지 목록·작성 + [id] 조회/수정/삭제
│   ├── install-plans/                # 설치계획(가안) CRUD
│   ├── etc-tasks/                    # 기타업무 CRUD + 파일 관리 (다병원·비유지보수 업무)
│   ├── inventory/                    # 자재관리(WMS)
│   │   ├── items/                    # 품목 마스터 route/[id](재고·부자재 포함)/import + [id]/components(주자재-부자재 매핑)
│   │   ├── transactions/            # 입출고 원장 route + [id]/cancel + export(Excel)
│   │   ├── stocks/                   # 인벤토리·위치별 현재고 집계 + export(Excel)
│   │   ├── units/                    # 시리얼 개체 조회 + [id] 정정
│   │   ├── hospital-works/           # 출고 업무연결 후보
│   │   └── can-manage/               # 재고 처리 권한 여부 (UI 게이트)
│   ├── hira-hospitals/
│   │   └── sync/                     # 심평원 연동 (POST: 백그라운드 시작, GET: 히스토리 목록)
│   │       └── [id]/                 # 연동 잡 상세 + 로그
│   └── drive/                        # Google Drive 연동 (파일 업로드/목록/삭제/병원목록 내보내기)
├── (대시보드)/                        # 메인 대시보드 (이번 주/다음 주 공사 현황)
├── dashboard/                        # 사이니지 월보드 (50인치 상시 표시, 네비 없음)
├── hospitals/                        # 병원 목록·상세·등록·수정
├── hira-hospitals/                   # HIRA 병원 조회
├── install-plans/                    # 설치계획(가안) 목록·상세·등록
├── projects/                         # 프로젝트 목록·상세·등록
│   └── calendar/                     # 구축 일정 간트 캘린더 (새 탭)
├── site-visits/                      # 답사 목록·상세·등록
├── maintenances/                     # 유지보수 목록·상세·등록
├── etc-tasks/                        # 기타업무 목록·상세·등록 (다병원·비유지보수 업무)
├── tasks/                            # 업무(Task) 현황 (통합 조회)
├── vehicle-reservations/             # 차량예약 주간 현황 보드 + 예약/반납 모달 + 내 예약 + 운행일지 탭(VehicleLogsPanel)
├── ai-assistant/                     # AI 어시스턴트 채팅
├── wiki/                             # 사내 위키 (Phase 2-3)
│   ├── layout.tsx                    # 사이드바 + 콘텐츠 flex 레이아웃 (모든 /wiki/* 적용)
│   ├── page.tsx                      # 위키 홈 (최근 페이지 목록)
│   ├── new/page.tsx                  # 신규 페이지 작성 (?parentId= 쿼리로 하위 추가)
│   ├── [id]/page.tsx                 # 페이지 상세 (server, parent chain 수집)
│   ├── [id]/WikiPageView.tsx         # 상세 클라이언트 (breadcrumb + 편집 토글)
│   └── components/
│       ├── WikiEditor.tsx            # BlockNote 에디터 래퍼
│       ├── WikiSidebar.tsx           # 페이지 트리 사이드바 (collapse/expand + ↑↓+ + DnD 이동)
│       └── MovePageModal.tsx         # 페이지 이동 모달 (새 부모 트리 선택)
├── users/                            # 사용자 관리 (ADMIN 이상)
├── settings/
│   ├── profile/                      # 내 계정 정보
│   ├── organizations/                # 소속 관리 (SUPER_ADMIN 전용)
│   ├── field-engineers/              # 필드 엔지니어 리스트 (ADMIN 이상)
│   ├── hira-sync/                    # 심평원 연동 관리 (SUPER_ADMIN 전용)
│   ├── devices/                      # 장비 정보 관리
│   ├── build-status/                 # 공사 상태 관리
│   ├── status/                       # 병원 상태코드 관리
│   ├── site-visit-status/            # 답사 상태코드 관리
│   ├── constructors/                 # 시공사 관리
│   ├── intro-type/                   # 도입형태 관리
│   ├── consultation-type/            # 상담유형 관리
│   ├── document-type/                # 문서유형 관리
│   ├── maintenance-type/             # 장애유형 관리
│   ├── maintenance-status/           # 유지보수 상태 관리
│   ├── etc-task-status/              # 기타업무 상태 관리
│   ├── item-category/                # 품목 분류 관리 (ADMIN 이상 — 대>중>소 계층 트리)
│   ├── inventories/                  # 인벤토리 관리 (ADMIN 이상 — 이름·이관 잠금·활성·순서)
│   ├── stock-reasons/                # 입출고 유형 관리 (ADMIN 이상 — 입고/출고 2섹션, StatusCodeManager 공용 컴포넌트)
│   ├── manufacturers/                # 제조사 관리 (ADMIN 이상)
│   ├── warehouses/                   # 창고(위치) 관리 (ADMIN 이상)
│   ├── inventory-managers/           # 재고 담당자 관리 (ADMIN 이상 — 담당자 풀)
│   ├── vehicles/                     # 차량 관리 (ADMIN 이상)
│   ├── nav-menus/                    # 네비게이션 메뉴 관리 (SUPER_ADMIN 전용)
│   ├── notifications/                # Slack 알림 설정 (ADMIN 이상 — 전역/이벤트 토글 + 타입별 포함 필드)
│   └── audit-logs/                   # 감사 로그 (SUPER_ADMIN 전용)
├── inventory/                        # 자재 현황(인벤토리 탭) + [invId]/items/[itemId](인벤토리 자재 상세) + transactions/(이력) + items/(관리·[id] 품목 마스터 상세) + components/TransactionModal
├── login/                            # 로그인 페이지
└── components/                       # 공통 컴포넌트 (Navigation, NavIcons, MainWrapper, StatusBadge 등)
    ├── useOverlayDismiss.ts          # 오버레이(드로어·모달) 공통 훅 — 배경 스크롤 잠금 + ESC 닫기
    ├── theme/                        # ThemeProvider, ThemeToggle, useChartTheme (다크모드)
    └── ui/                           # 디자인 프리미티브 (Button, Card, Badge, Input, Table, Modal(모바일 바텀시트), PageHeader, EmptyState)

lib/
├── auth.ts                           # JWT 인증 유틸리티 + 역할 헬퍼
├── prisma.ts                         # Prisma 클라이언트
├── s3.ts                             # AWS S3 연동 유틸리티 (업로드/삭제/presigned URL)
├── googleDrive.ts                    # Google Drive 연동 유틸리티
├── gmail.ts                          # Gmail API 클라이언트 + 메일 파싱 유틸
├── mail-sync.ts                      # 설치계획·답사 메일 큐 동기화 로직 (Gmail → DB INSERT)
├── mail-scheduler.ts                 # 메일 동기화 인터벌 스케줄러 (mail-sync 함수 직접 호출)
├── audit.ts                          # 감사 로그 헬퍼 (logAudit, auditActorFromJWT, redact)
├── hospitalStatus.ts                 # 병원 thynC 현황상태 단방향 자동 진행 헬퍼 (advanceHospitalStatus)
├── vehicleLog.ts                     # 운행일지 거리 재계산(recalcVehicleLogs) + 주행거리 무결성 검사(checkOdometerConsistency)
├── maintenanceVisit.ts               # 유지보수 방문일정 정규화(normalizeVisits) + 캘린더 페이로드(visitEventPayload) + ymd/visitKey — 기타업무 업무기간도 공유
├── etcTask.ts                        # 기타업무 캘린더 이벤트 페이로드(etcTaskVisitEventPayload)
├── slack.ts                          # Slack Web API 전송 어댑터 (의존성0 fetch, 모드 라우팅 off/test/live, lookupByEmail)
├── notify.ts                         # 알림 정책·로그 레이어 (이벤트·상태변경·지연요약·enrich·dedup + notification_logs, best-effort)
├── notifyFields.ts                   # Slack 알림 메시지 필드 카탈로그·타입별 추천 기본값 (설정 페이지·notify 공유)
├── delay-rules.ts                    # 지연 업무 판정 (타입별 기준일·임계일수, findDelayedTasks — KST 기준·보류 제외)
├── notify-scheduler.ts               # 지연 감지 인터벌 스케줄러 (mail-scheduler 패턴, notify_delay_interval 제어)
└── inventory.ts                      # 자재관리 — 품목 채번(nextItemCode) + 재고 처리 권한(canManageStock: ADMIN or 재고 담당자 풀)

prisma/
├── schema.prisma                     # DB 스키마
├── seed.ts                           # 기본 데이터 시드 (Organization, 상담유형, 문서유형 포함)
├── seed-admin.ts                     # 관리자 계정 생성
└── seed-hira.ts                      # HIRA 병원 데이터 시드
```

---

## 데이터베이스 스키마

### User (시스템 사용자)
- 이메일, 비밀번호(bcrypt), 이름, 전화번호
- 역할: `SUPER_ADMIN` / `ADMIN` / `USER` / `VIEWER`
- 소속(Organization) 연결 (organizationId), 부서(Department) 연결 (departmentId, 선택)
- 차량예약 사용 제한 (`vehicleReservationBlocked`, 기본 false): true면 역할과 무관하게 차량예약 등록·수정·취소 불가 (조회만 가능). 계정관리에서 제어
- Slack DM 매핑 캐시 (`slackUserId`, nullable): 지연 알림 DM 발송 시 이메일→Slack ID 조회 결과 캐시 (Phase 4)
- Slack 발송 유무 (`slackNotifyEnabled`, 기본 true): false면 해당 계정에 Slack DM 미발송. 계정관리 타계정 수정에서 제어(ADMIN)

### Organization (소속/조직)
- 사용자 그룹 단위 (예: SEERS, DAEWOONG)
- code (고유 코드, 대문자), name, isActive, sortOrder
- 삭제 보호: `DAEWOONG` 코드는 영구 삭제 불가

### Department (부서)
- Organization 하위 부서 단위
- name, organizationId, sortOrder
- 연결된 유저가 있으면 삭제 불가 (409)

### FieldEngineer (업무별 담당자 풀)
- SEERS 소속 User 중 업무별 담당자로 지정된 목록
- userId, workType(`PROJECT` / `INSTALL_PLAN` / `MAINTENANCE` / `ETC_TASK`), createdAt
- (userId, workType) 복합 UNIQUE — 한 사용자가 여러 풀에 동시 등록 가능
- `PROJECT` 풀은 프로젝트·답사에서 공유, `INSTALL_PLAN`/`MAINTENANCE`/`ETC_TASK`는 각 업무 전용
- `ETC_TASK` 풀은 SEERS + thynC운영팀 소속만 등록 가능 (후보·등록 서버 검증)

### HiraHospital (건강보험심사평가원 병원 원본 데이터)
- HIRA에서 가져온 공공 병원 데이터 원본
- hiraId, 병원명, 종별코드, 시도/시군구, 주소, 전화번호, 의사 수 등

### Hospital (운영 병원)
- hospitalCode (고유 코드), HiraHospital과 연결 (hiraId)
- HIRA 병원명 / 운영상 병원명 구분
- 상태 (status), 좌표 정보 포함
- 도입형태: `HospitalIntroType` 조인 테이블로 다대다 연결 (복수 선택 가능)
- 도입 병상 수 (`intro_beds`), 최초 계약일 (`contractDate`)

### HospitalIntroType (병원 도입형태)
- Hospital ↔ StatusCode(INTRO_TYPE) N:M 조인 테이블
- 구축형 / 구독형 / 사용량비례형 등 다중 선택 가능

### HospitalMeta (병원 메타 정보)
- Hospital과 1:1 관계
- Google Drive 폴더 ID (`driveProjectFolderId`), Drive 상태 파일 ID (`driveStatusFileId`), Drive 설치계획 파일 ID (`driveInstallPlanFileId`)
- 원격 접속 URL (`remoteAccessUrl`), 원격 제어 URL (`remoteControlUrl`)

### HospitalDevice (병원 장비)
- Hospital ↔ DeviceInfo N:M 관계 테이블

### Project (프로젝트)
- 구축 공사 프로젝트 단위
- `projectCode`, `projectName`, `orderNumber` (내부 순번)
- 병원 연결, 담당자 N:M (`ProjectAssignee`), 수동 담당자명(`builderNameManual`), 시공사(`constructorId`)
- 계약 정보: `contractDate`, 도입형태(`introTypeId` → StatusCode INTRO_TYPE 연결)
- 규모: `wardCount` (병동 수), `bedCount` (병상 수), `gatewayCount` (게이트웨이 수)
- 진행 플래그: `hasSurvey` (답사 완료), `hasOrder` (발주 완료)
- 공사 상태(`buildStatus`), 시작일/완료예정일, 비고(`remark`), 이슈 노트(`issueNote`, 리치 텍스트)
- 공사상태 진입 시각(`statusChangedAt`) — 상태 실변경 시 기록, 단계 체류 지연 감지용
- Google Drive 폴더 연결 (`driveFolderId`)
- Google Calendar 이벤트 ID (`calendarEventId`) — 프로젝트 생성/수정/삭제 시 자동 동기화

### ProjectAssignee (프로젝트 담당자)
- Project ↔ User N:M 관계 테이블
- projectCode, userId, createdAt

### ProjectDevice (프로젝트 장비)
- Project ↔ DeviceInfo 관계 + 수량

### ProjectFile (프로젝트 파일)
- 프로젝트에 첨부된 파일
- 파일 카테고리 (`fileCategory`), Google Drive 필드 (`driveFileId`, `driveUrl`) + S3 키 (`s3Key`) 병행 지원

### InstallPlan (설치계획 가안)
- 병원별 설치계획(가안) 관리
- 고유 코드 `planCode`: `IP-YYYYMM-NNNNN` 형식 (생성 시 자동 발번)
- 병원 연결 (hospitalCode, 선택사항)
- 요청일 (`requestDate`), 회신일 (`replyDate`)
- 작성완료여부 (`writeStatus`): `-` / `미완료` / `완료`
- 회신여부 (`replyStatus`): `-` / `미완료` / `완료`
- 담당자 N:M (`InstallPlanAssignee`), 비고 (`note`, 리치 텍스트)

### InstallPlanAssignee (설치계획 담당자)
- InstallPlan ↔ User N:M 관계 테이블
- installPlanId, userId, createdAt

### SiteVisit (답사)
- 병원 답사 기록
- 고유 코드 `siteVisitCode`: `VISIT-YYYYMM-NNNNN` 형식 (생성 시 자동 발번)
- 대웅 담당자 `daewoongUserId` (DAEWOONG 소속 User) + 담당자 N:M (`SiteVisitAssignee`)
- 상태코드 연결, 방문일/요청일/회신일, 상태 진입 시각(`statusChangedAt`, 단계 체류 지연 감지용)
- 파일(설치계획서·평면도) 첨부: Drive 필드 (`installPlanUrl`, `floorPlanUrl`) + S3 키 (`installPlanS3Key`, `floorPlanS3Key`) 병행 지원
- 노트(`notes`): 리치 텍스트(Tiptap)
- Google Calendar 이벤트 ID (`calendarEventId`) — 답사 생성/수정/삭제 시 자동 동기화

### SiteVisitAssignee (답사 담당자)
- SiteVisit ↔ User N:M 관계 테이블
- siteVisitId, userId, createdAt

### Maintenance (유지보수)
- 병원 장비/시스템 유지보수 기록
- 고유 코드 `maintenanceCode`: `MNT-YYYYMM-NNNN` 형식 (생성 시 자동 발번)
- 병원 연결 (hospitalCode, 필수)
- 장애유형(`typeId` → StatusCode MAINTENANCE_TYPE), 상태(`statusId` → StatusCode MAINTENANCE_STATUS), 상태 진입 시각(`statusChangedAt`)
- 우선순위(`priority`): 긴급/높음/보통/낮음 (기본값: 보통)
- 신고자(`reporterName`): 병원 측 텍스트
- 원격처리 여부(`isRemote`), 접수일(`reportedAt`), 완료일(`resolvedAt`)
- 방문일정: `MaintenanceVisit` 자식 테이블로 다건 관리 (단일 `visitDate`/`calendarEventId` 컬럼은 보존·deprecated)
- 증상(`symptoms`), 원인(`cause`): plain text
- 조치내용(`resolution`), 비고(`notes`): 리치 텍스트(Tiptap)
- 담당자 N:M (`MaintenanceAssignee`), 첨부파일 (`MaintenanceFile`, S3), 방문일정 1:N (`MaintenanceVisit`)
- Google Calendar 이벤트 ID는 방문 항목(`MaintenanceVisit.calendarEventId`)별 관리 — 항목 생성/수정/삭제 시 자동 동기화

### MaintenanceAssignee (유지보수 담당자)
- Maintenance ↔ User N:M 관계 테이블
- maintenanceId, userId, createdAt

### MaintenanceVisit (유지보수 방문일정)
- Maintenance 1:N 방문일정. 각 항목은 단일일(start=end) 또는 기간(start~end), 비연속 다건 지원
- `maintenanceId`(FK Cascade), `startDate`/`endDate`(@db.Date), `calendarEventId`(항목별 Google Calendar 이벤트), `sortOrder`, `createdAt`
- 인덱스 `(maintenanceId)`

### MaintenanceFile (유지보수 첨부파일)
- Maintenance에 첨부된 파일
- fileCategory, fileName, s3Key

### EtcTask (기타업무)
- 여러 병원을 커버하거나 유지보수가 아닌 주요 업무 관리
- 고유 코드 `etcTaskCode`: `ETC-YYYYMM-NNNN` 형식 (생성 시 자동 발번)
- 상태(`statusId` → StatusCode ETC_TASK_STATUS), 우선순위(`priority`): 긴급/높음/보통/낮음 (기본값: 보통), 상태 진입 시각(`statusChangedAt`)
- 접수일(`reportedAt`), 완료일(`resolvedAt`)
- 비고(`note`): 리치 텍스트(Tiptap)
- 담당자 N:M (`EtcTaskAssignee`), 병원 N:M (`EtcTaskHospital`, 0~N곳 선택 연결), 업무기간 1:N (`EtcTaskVisit`), 첨부파일 (`EtcTaskFile`, S3)

### EtcTaskAssignee (기타업무 담당자)
- EtcTask ↔ User N:M 관계 테이블 (etcTaskId, userId UNIQUE)

### EtcTaskHospital (기타업무 관련 병원)
- EtcTask ↔ Hospital N:M 관계 테이블 — 다병원 업무를 위해 병원을 0~N곳 연결
- UNIQUE `(etcTaskId, hospitalCode)` + `(hospitalCode)` 역검색 인덱스

### EtcTaskVisit (기타업무 업무기간)
- EtcTask 1:N 업무기간. 단일일(start=end)·기간(start~end)·비연속 다건 지원 (유지보수 방문일정과 동일 구조)
- `startDate`/`endDate`(@db.Date), `calendarEventId`(항목별 Google Calendar 이벤트, env `GOOGLE_CALENDAR_ETC_TASK_ID`), `sortOrder`
- 간트차트에 항목별 바로 표시

### EtcTaskFile (기타업무 첨부파일)
- EtcTask에 첨부된 파일 (fileCategory, fileName, s3Key — `etc-tasks/{id}/{timestamp}_{fileName}`)

### AuditLog (감사 로그)
- 시스템 내 모든 mutation 및 인증 이벤트 기록
- actorId/actorEmail/actorName/actorRole (User 스냅샷 — User 삭제 후에도 기록 보존)
- action: `CREATE` / `UPDATE` / `DELETE` / `LOGIN` / `LOGOUT`
- resource: `auth` / `user` / `hospital` / `project` / `site_visit` / `maintenance` / `install_plan` / `contractor` / `setting:*` 등
- resourceId, resourceLabel (사람이 읽기 좋은 이름)
- before/after (JSONB, 비밀번호 등 민감정보 자동 redact)
- ipAddress, userAgent
- (actorId, createdAt) / (resource, resourceId, createdAt) / (createdAt) 인덱스

### DaewoongHospitalAssignment (병원 담당자 배정)
- User(DAEWOONG 소속) ↔ Hospital N:M 관계 테이블

### DeviceInfo (장비 정보)
- 장비 모델명, 이름, 정렬 순서

### BuildStatus (공사 상태)
- 공사 진행 상태 정의 (레이블, 색상)

### StatusCode (상태코드)
- 병원/답사/상담유형/문서유형/장애유형/유지보수상태 등 다용도 상태값 정의 (커스터마이징 가능, 색상 포함)
- category: `HOSPITAL` / `SITE_VISIT` / `INTRO_TYPE` / `CONSULTATION_TYPE` / `DOCUMENT_TYPE` / `MAINTENANCE_TYPE` / `MAINTENANCE_STATUS` / `ETC_TASK_STATUS`
- value: 코드값 (String?, nullable) — 문서유형 등에서 내부 식별자로 사용

### Contractor (시공사)
- 시공사 코드, 이름, 연락처 등

### HiraSyncJob (심평원 연동 잡)
- 심평원 연동 실행 단위 (백그라운드 비동기 처리)
- 시작시간 (`startedAt`), 종료시간 (`endedAt`), 상태 (`status`: running/done/error), 연동건수 (`totalCount`)

### HiraSyncLog (심평원 연동 로그)
- HiraSyncJob 1:N 관계
- 이벤트 타입 (`type`: init/group_start/group_api_done/group_db_done/done/error)
- 메시지 (`message`), 추가 데이터 (`stats`, JSONB)

### NavMenuItem (네비게이션 메뉴 설정)
- 네비게이션 메뉴 항목별 표시 이름, 접근 권한, 노출 여부 관리
- `menuKey` (고유 식별자), `label` (표시 이름, 변경 가능), `href` (URL 경로)
- `iconKey` (아이콘 매핑 키), `parentKey` (상위 메뉴 키, NULL=최상위, `settings`=설정 하위)
- `allowedRoles` (TEXT[], 허용 역할 배열, 빈 배열=전체), `allowedOrgCodes` (TEXT[], 허용 소속 코드 배열, 빈 배열=전체)
- `isActive` (활성/비활성 토글), `sortOrder` (정렬 순서)

### Task (통합 업무)
- 프로젝트, 답사, 설치계획(가안), 유지보수, 기타업무를 통합 관리하는 TASK 테이블
- 고유 코드 `taskCode`: `TASK-YYYYMM-NNNNN` 형식 (월별 순번 통합 채번)
- `taskType`: `PROJECT` / `SITE_VISIT` / `INSTALL_PLAN` / `MAINTENANCE` / `ETC`
- `refCode`: 원본 테이블의 고유 코드 (projectCode / siteVisitCode / planCode / maintenanceCode / etcTaskCode)
- `hospitalCode` (FK→Hospital, nullable), `title`
- 기존 테이블은 변경 없이 유지, tasks는 참조용 통합 뷰

### ConsultationQueue (상담 대기열)
- AI 어시스턴트 상담이력 저장
- Hospital 연결 (hospitalCode, 선택), 상담유형(StatusCode CONSULTATION_TYPE), 문서유형(StatusCode DOCUMENT_TYPE)
- 결론(`conclusion`), 대화이력(`chatHistory`, JSONB), AI 정제 결과(`aiSummary`)
- 상태(`status`: PENDING 등), 상담자(`consultedById` → User)

### Vehicle (법인차량)
- 차량예약에 사용되는 차량 마스터
- `name` (표시 이름), `plateNumber` (차량번호, UNIQUE), `model`, `seatCount`, `color` (보드 표시 색), `memo`
- `isActive`, `sortOrder` — 예약 이력이 있는 차량은 삭제 대신 비활성화 (이력 보존)
- `lastOdometer` (최신 누적 주행거리, km) — 운행일지 종료거리로 자동 갱신, 반납 입력 시 직전 기록 안내·검증에 사용

### VehicleReservation (차량예약)
- 선착순 즉시 확정 예약. 시간 단위(30분 간격), 다일(多日) 예약 가능
- `vehicleId` → Vehicle, `userId` → User (예약자)
- `startAt` / `endAt`, `purpose` (목적), `destination` (행선지)
- `status`: `RESERVED` / `CANCELED` — 취소는 soft delete (이력 보존)
- `returnedAt` (반납 완료 시각, nullable) — NULL=미반납. 반납 시 운행일지 생성과 함께 기록, status는 RESERVED 유지(보드 표시·충돌검사 영향 없음)
- 더블부킹 방지 이중 장치:
  - 앱 레벨: `$transaction` 안에서 겹침 검사 → 409 + 겹치는 예약자/시간 안내
  - DB 레벨: `btree_gist` 확장 + EXCLUDE 제약 (`vehicle_id` 동일 & `tsrange(start_at, end_at)` 겹침 & RESERVED 상태) — 동시 요청 race까지 차단
- 인덱스: `(vehicle_id, start_at)`, `(user_id, start_at)`

### VehicleLog (차량 운행일지)
- 차량별 운행 기록. 반납 절차로 생성되거나(예약 연결) 직접 작성(예약 미연결)
- `vehicleId` → Vehicle, `reservationId` → VehicleReservation (nullable, UNIQUE 1:1), `driverId` → User (운전자)
- `startAt` / `endAt`, `purpose` (운행 목적), `destination` (행선지) — 예약 연결 시 예약값 자동 채움
- `endOdometer` (운행 후 최종 주행거리, km), `distanceKm` (구간거리 = 종료거리 − 직전 일지 종료거리, 자동 계산·저장)
- `note` (비고), `createdById` → User (작성자)
- 인덱스: `(vehicle_id, end_at)`, `(driver_id, start_at)`
- 거리 무결성: 생성/수정/삭제 시 같은 차량 일지를 endAt 순으로 재계산하고 앞/뒤 기록과 모순(주행거리 역전) 차단

### NotificationLog (Slack 알림 발송 이력)
- Slack 알림 발송 기록 + 중복 발송 방지(dedup)의 근거 테이블 (`function_notification.md` Phase 1)
- `eventType` (`task_created`/`task_completed`/`delayed`), `taskType`, `refCode` (원본 업무 코드)
- `targetType` (`channel`/`dm`), `targetId` (채널 ID 또는 Slack user ID), `status` (`sent`/`failed`/`skipped`), `error`, `payload` (JSONB)
- 인덱스: `(event_type, ref_code, target_id, created_at)` (dedup 조회), `(created_at)`

### 자재관리(WMS) 모듈 (`function_wms.md` Phase 1~)

#### InventoryCategory (계층형 품목 분류)
- 대 > 중 > 소 최대 3단계 트리 (`parentId` self-FK, 깊이·순환은 API 검증)
- 같은 부모 아래 중복명 방지 UNIQUE(`COALESCE(parent_id,0)`, name — SQL 전용 인덱스)
- 하위 분류·연결 품목 있으면 삭제 409. 품목은 어느 단계 노드에나 연결 가능

#### InventoryItem (품목 마스터)
- 자재 품목 단위. 고유 코드 `itemCode`: `ITEM-NNNN` (전체 순번, 생성 시 자동 발번)
- `name`, 분류(`categoryId` → InventoryCategory 트리), 제조사(`manufacturerId` → StatusCode `MANUFACTURER`), `spec`(규격), `unit`(단위, 기본 EA)
- `isSerialManaged`(시리얼 개체 추적 여부 — 입출고 이력 생기면 변경 409 잠금), `deviceInfoId`(자사 기기 ↔ DeviceInfo 선택 FK)
- `refPrice`(참고 단가, nullable), `memo`, `isActive`, `sortOrder`
- 이력 있는 품목 삭제 → 비활성화 전환 (이력 보존)
- 인덱스: `(category_id)`

#### Inventory (인벤토리 마스터 — Phase 9)
- 재고를 나누는 인벤토리 단위. 시드 3행: **대웅제약재고 / 평가용재고 / 판매용재고**
- `name`(UNIQUE), **`isTransferLocked`**(true면 TRANSFER 출발·도착 모두 불가 — 평가용재고), **`linkHospital`**(true면 출고 시 병원·업무 연결 허용 — 대웅제약재고만), `memo`, `isActive`, `sortOrder`
- 사용 중(재고·전표·개체) 삭제 409 → 비활성화 사용. `/settings/inventories`에서 편집

#### InventoryItemComponent (주자재-부자재 매핑 — Phase 9)
- 주자재(모) 품목 아래 부자재(자식) 품목 N개 매핑. 복합 PK `(parentItemId, childItemId)`
- `quantity`(주자재 1개당 구성 수량, `CHECK > 0`), `sortOrder`. **1단계 깊이만 허용**(부자재는 주자재가 될 수 없음 — API 검증)
- 출고 시 세트출고 옵션으로 비시리얼 부자재 자동 동시 출고

#### Warehouse (위치/창고 마스터)
- 자재 보관 위치. `name`(UNIQUE), `memo`, `isActive`, `sortOrder`
- 불량품 보관은 별도 상태가 아니라 '불량/수리 대기' 같은 위치로 표현

#### InventoryManager (재고 담당자 풀)
- 재고 입출고·이동·취소 처리 권한 담당자. **FieldEngineer(업무 담당자)와 별개 직무**
- `userId`(→ User, UNIQUE). ADMIN 이상은 풀 미등록이어도 처리 가능

#### 재고 차원 — 품목 × 위치 × 인벤토리 (Phase 9 재설계)
- 같은 품목이라도 인벤토리(대웅제약/평가용/판매용)가 다르면 **수량·입출고 완전 독립** 관리
- 전표 유형 4종: `IN`/`OUT`/`MOVE`(같은 인벤토리 내 위치 이동)/**`TRANSFER`(인벤토리 간 이관)**
- **이관 규칙**: 출발·도착 모두 `isTransferLocked=false`여야 허용 — 대웅제약↔판매용 가능, **평가용재고는 양방향 이관 금지**
- 입고/출고 유형은 StatusCode `STOCK_IN_TYPE`(구매·회수(반품)`RETURN`·기타)/`STOCK_OUT_TYPE`(설치·판매·폐기`DISPOSE`·불량`DISPOSE`·기타)으로 마스터화 — `/settings/stock-reasons`에서 추가·삭제(시스템 유형·사용 중 유형은 삭제 409)

#### InventoryStock (현재고 스냅샷)
- 품목×위치×인벤토리별 현재고. 복합 PK `(itemId, warehouseId, inventoryId)`, `quantity`(DB `CHECK >= 0`), `updatedAt`
- 전표 처리와 같은 트랜잭션에서 버킷 단위 증감 — 재고 수량의 진실

#### InventoryTransaction (입출고 원장)
- append-only 전표. `txCode`(`STK-YYYYMM-NNNN`, 동시 채번 P2002 재시도), `txType`(IN/OUT/MOVE/TRANSFER), `reasonId`(→ StatusCode 입출고 유형, MOVE/TRANSFER는 NULL), `itemId`, `warehouseId`(출발/입고처), `toWarehouseId`(MOVE·TRANSFER 도착), `inventoryId`, `toInventoryId`(TRANSFER 도착 인벤토리), `quantity`(`CHECK > 0`)
- OUT 부가정보(선택): **`destination`(출고처 자유 텍스트)**, `hospitalCode`, `workType`(PROJECT/MAINTENANCE/ETC), `refCode`
- **`parentTxId`**(세트출고 — 부자재 자식 전표가 주자재 전표 참조. 부모 취소 시 자식 일괄 취소)
- `actorId`, `canceledAt`/`canceledById`(취소 마킹). 인덱스: `(item_id, created_at)`, `(hospital_code)`, `(work_type, ref_code)`, `(created_at)`, `(inventory_id, created_at)`, `(parent_tx_id)`

#### InventoryUnit / InventoryTransactionUnit (시리얼 개체)
- `InventoryUnit`: 시리얼 품목 개체. `itemId`+`serialNo`(UNIQUE), `status`(IN_STOCK/OUT/DISPOSED), `warehouseId`(재고 시 위치), `inventoryId`(소속 인벤토리 — 출고·이동 시 버킷 일치 강제, 이관 시 소속 변경, 회수는 원래 인벤토리만), `hospitalCode`(출고 설치처). 인덱스 `(item_id, status)`, `(hospital_code)`, `(inventory_id)`
- 갱신은 조건부 updateMany + 건수 검증 (동시 요청 이중 출고 차단)
- `InventoryTransactionUnit`: 전표↔개체 조인(개체 이력 산출). 복합 PK `(transactionId, unitId)`

### Wiki 모듈 — 별도 PostgreSQL 스키마 `wiki`
- 사내 위키(Notion-like) 기능. 본문은 BlockNote JSON 블록 배열로 저장
- 모든 위키 테이블은 `wiki.*` 스키마에 격리. FK 방향은 `wiki.* → public.*` 만 허용

#### WikiPage (위키 페이지)
- `id` (uuid), `parentId`(self-reference, 트리 구조), `title`, `slug` (선택)
- `contentJson` (JSONB, BlockNote 블록 배열), `isPublished`, `sortOrder`
- `authorId` → User, `lastEditorId` → User (nullable)
- `icon` (이모지), `coverUrl` (커버 이미지 S3 URL), `coverOffsetY` (커버 세로 위치 %)
- `isTemplate` (템플릿 표시 — 트리/홈/검색에서 제외, 신규 작성 갤러리에만 노출)
- `deletedAt` (휴지통 soft delete — NULL=정상, 값=삭제됨)
- 인덱스: `(parent_id, sort_order)`, `(updated_at DESC)`, `(author_id)`, `(is_template)`, `(deleted_at)`, title/plain_text trigram GIN(`pg_trgm`, 검색 가속)

#### WikiPageLink (페이지 간 링크 — 백링크)
- 본문의 `wikiPageLink` 블록을 인덱싱. `sourcePageId` → `targetPageId` (복합 PK), `(target_page_id)` 역참조 인덱스
- 본문 저장 시 자동 재계산. 상세 페이지 "이 페이지를 링크한 페이지" 패널 산출용

#### WikiNotification (알림)
- `id` (uuid), `userId` → User, `pageId` → WikiPage(nullable), `type`(`comment` 등)
- `actorId`/`actorName`/`pageTitle` (스냅샷), `readAt`(nullable), `createdAt`
- 인덱스 `(user_id, read_at, created_at DESC)`. 댓글 작성 시 작성자+최근수정자에게 생성

#### WikiAttachment (위키 첨부)
- `id` (uuid), `pageId` → WikiPage, `fileName`, `s3Key` (UNIQUE)
- `size`, `mimeType`, `uploaderId` → User
- S3 키 패턴: `wiki/{pageId}/{timestamp}_{fileName}`

#### WikiPageReference (위키 ↔ 메인 도메인 참조)
- 위키 페이지와 병원/프로젝트의 명시적 N:M 연결 인덱스
- `id` (uuid), `pageId` → WikiPage, `refType` (`hospital` | `project`), `refCode`, `createdById` → User
- UNIQUE `(pageId, refType, refCode)` + `(refType, refCode)` 역검색 인덱스

#### WikiTag / WikiPageTag (태그)
- `WikiTag`: id, name UNIQUE, color, sortOrder
- `WikiPageTag`: pageId × tagId N:M (PK 복합)

#### WikiFavorite (즐겨찾기)
- 복합 PK `(userId, pageId)`, 인덱스 `(userId, createdAt desc)`

#### WikiViewLog (열람 로그)
- 사용자별 페이지 열람 기록, 인덱스 `(userId, viewedAt desc)` + `(pageId)`. 최근 본 페이지 산출용

#### WikiVersion (버전 히스토리)
- 본문 수정 시 직전 상태 스냅샷. `pageId`, `title`, `contentJson`(JSONB), `savedById`, `savedAt`. 인덱스 `(pageId, savedAt desc)`

#### WikiComment (댓글)
- 페이지 단위 flat 댓글. `pageId`, `authorId`, `body`, 생성/수정 타임스탬프. 인덱스 `(pageId, createdAt)` + `(authorId)`

#### WikiPage 추가 컬럼 (Phase 7)
- `plainText` (TEXT NOT NULL DEFAULT '') — BlockNote JSON에서 추출한 검색용 평문

---

## 인증 및 역할 체계

### 역할 (Role)

| 역할 | 설명 |
|------|------|
| `SUPER_ADMIN` | 전체 시스템 최고 관리자. 소속 관리, 타계정 수정 포함 모든 권한 |
| `ADMIN` | 일반 관리자. 사용자 생성, 설정 관리 등 |
| `USER` | 일반 사용자. 병원·프로젝트·답사 생성·수정 가능 |
| `VIEWER` | 읽기 전용. 모든 데이터 조회만 가능, 수정 불가 |

### 역할 헬퍼 (`lib/auth.ts`)
- `isAdminOrAbove(role)` — SUPER_ADMIN 또는 ADMIN 여부
- `isSuperAdmin(role)` — SUPER_ADMIN 여부

### JWT 인증
- `auth-token` 쿠키에 JWT 저장 (httpOnly)
- 페이로드: userId, email, name, role, isActive, organization
- 만료: 7일
- 미들웨어(`middleware.ts`)로 모든 페이지 인증 보호

---

## 주요 기능

### 모바일 대응 (반응형 UI/UX)
- 전 화면 모바일 최적화: viewport `viewport-fit=cover`(노치·홈 인디케이터 safe-area), iOS 입력 포커스 자동확대 방지, 탭 하이라이트 제거
- **목록 페이지 카드 뷰**: 병원/프로젝트/설치계획/답사/유지보수/기타업무/업무현황/계정 목록이 md(768px) 미만에서 테이블 대신 카드 리스트로 표시 (핵심 필드 + 상태 뱃지, 탭하면 상세 이동). 메인 대시보드 공사현황도 카드 전환(비고 인라인 수정 유지)
- **네비게이션**: 모바일 상단 헤더 + 슬라이드 드로어 (배경 스크롤 잠금, ESC/백드롭 닫기)
- **모달**: `ui/Modal`은 모바일에서 바텀시트로 전환. 폼(유지보수·답사·기타업무)은 모바일 1컬럼 스택
- **위키**: lg 미만에서 사이드바가 오프캔버스 드로어로 전환 (좌하단 플로팅 버튼)
- **간트차트·차량보드**: min-width 기반 가로 스크롤, 모바일 헤더 높이 보정(dvh)
- 공통 오버레이 동작은 `useOverlayDismiss` 훅으로 통일

### 대시보드
- 이번 주 / 다음 주 공사 예정 프로젝트 현황
- 공사 상태별 요약, 비고 인라인 수정
- **월별 누적 사용 현황**: 신규 병원/병상, 누적 병원/병상 추이 (Recharts 차트)
- **월별 신규 병원/병상 막대 차트** (ComposedChart)
- 캐시 미사용 (`force-dynamic`), 매 요청마다 DB 조회

### 사이니지 월보드 (`/dashboard`, 50인치 상시 표시용)
- 네비게이션 없는 h-screen 무스크롤 단일 화면, 다크/라이트 토글, 전체화면 버튼, 실시간 시계, 60초 자동 폴링(실패 시 기존 데이터 유지)
- KPI 7컬럼: 도입병원 / 도입병상 / **종별 도입 현황(전국 HIRA 모수 대비 도입수·도입률: 상급종합·종합병원·병원·기타)** / 유지보수 진행중 / 이번주 구축 / 차주 구축 예정
- 월별 누적 도입 현황 차트(라벨 상시 표시 — 사이니지 원칙상 호버 툴팁 미사용, 라인·바 밴드 분리, 애니메이션 비활성)
- 유지보수 진행중 내역(우선순위 마커, 최신 7건) + 이번주/차주 구축 리스트

### 병원 thynC 현황상태 자동 진행 규칙
- 업무 등록·진행 상태에 따라 `hospitals.status`를 단방향(미계약 → 가견적요청 → 답사요청 → 계약완료 → 운영 → 해지)으로 자동 진행. 후행 단계에 있는 병원의 status는 보존(이미 `운영`인 병원에 추가 설치계획·답사가 들어와도 다운그레이드 안 함).
- 트리거 시점:
  - 설치계획(가안) 등록 → `가견적요청` (수동·메일큐 자동등록 둘 다, 큐 적재 단계는 제외)
  - 답사 등록 → `답사요청` (동일)
  - 프로젝트 등록 시 계약일(`contractDate`) 입력 → `계약완료`. `Hospital.contractDate`가 NULL이면 함께 채우고, 이미 값이 있는 추가도입은 계약일 보존
  - 프로젝트 `buildStatus`가 라벨에 `완료` 포함된 값으로 변경 → `운영`
- 모든 자동 변경은 `audit_logs`에 `resource='hospital'` UPDATE로 기록(`resourceLabel`에 `(자동: <source>)` 표기), 트리거 발생시킨 사용자가 actor.

### 병원 관리
- HIRA 병원 데이터 검색 및 조회 (모달 방식)
- 병원 상세 → 답사 관리 카드 + 설치계획(가안) 관리 카드 + 구축 프로젝트 카드 순으로 표시 (각 카드에서 해당 병원 데이터 직접 조회, 행 클릭 상세 이동, ADMIN 이상 등록 버튼 제공)
- 운영 병원 등록·수정·삭제
  - 등록: 병원명+상태만으로 즉시 등록, HIRA 연결은 선택
  - 수정: HIRA 병원 연결 변경·해제 지원
- 병원별 대웅 담당자(DAEWOONG 소속 User) 복수 선택 배정·해제 (DaewoongSelectModal 체크박스 방식)
- 병원별 장비 관리
- 시도/시군구/상태 필터, 페이지네이션
- **Excel 일괄 가져오기** (ADMIN 이상): `병원명`, `도입형태`, `도입병상 수` 컬럼 기준 일괄 교체
  - 미리보기(preview) 모드 지원
  - 같은 병원명 여러 행 → 도입형태 병합, 도입병상 수 합산
- **병원 목록 Google Sheets 내보내기**: Drive Sheets API로 스프레드시트 직접 생성
- **업무 병원 재지정(매핑 정정)** (ADMIN 이상): 프로젝트/답사/설치계획/유지보수 상세의 "병원 재지정" 버튼으로 잘못 지정된 병원을 올바른 병원으로 이전. 한 트랜잭션으로 업무 hospitalCode + Task 미러 동기화, 두 병원 현황 상태 자동 재계산(옛 병원 하향 포함), 프로젝트는 이름의 병원명도 선택 변경. 감사로그 기록
- **병원 업무 일괄 이전** (SUPER_ADMIN): 병원 상세의 "업무 일괄 이전" 버튼으로 한 병원의 모든 업무(프로젝트·답사·설치계획·유지보수·상담)를 다른 병원으로 한 번에 이전(병원을 통째로 잘못 만든 경우 정리용)

### 프로젝트 관리
- 구축 공사 프로젝트 등록·수정·삭제 (삭제는 ADMIN 이상)
- 공사 상태(BuildStatus) 연결 및 관리
- 담당자(복수 지정, 필드 엔지니어 선택 모달), 시공사, 계약일, 도입형태(IntroType), 시작일/완료예정일, 비고 관리
- 병동 수 / 병상 수 / 게이트웨이 수, 답사·발주 완료 플래그
- 이슈 노트: 리치 텍스트 에디터(Tiptap)로 서식 있는 내용 입력 가능
- 프로젝트별 장비 관리
- 프로젝트별 파일 관리 (S3 업로드 / 파일 다운로드 / Drive 연동 병행 지원)
- 목록 표시: 페이지네이션 없이 전체 목록 한 번에 표시
- 목록 기본 정렬: 구축시작일 DESC (미입력 프로젝트 최상단), 보류 상태 항목 최하단
- 목록 컬럼: 병원명 | 진행상태 | 담당자 | 구축 시작일 | 구축 종료일(예상) | 도입형태 | 계약일 | 병동 수 | 병상 수 | G/W | 심전계 | 산소포화도 | 구축업체
- **필드 엔지니어 간트차트** (`/projects/calendar`): 필드 엔지니어 기준 월간 간트차트
  - Y축: 필드 엔지니어 1명 = 1행 그룹, 배정 업무가 겹치면 레인(sub-row) 자동 분리
  - X축: 뷰 범위 = 해당 월이 속한 ISO 주의 월요일 ~ 일요일 (월 경계 주가 잘리지 않도록 인접 월 일부 포함, 총 35~42일), URL `?month=YYYY-MM` 동기화, 주차·일별 2행 헤더 (sticky top), 현재 월 외 날짜는 연한 회색 글자 + 연회색 배경으로 구분
  - 구축 프로젝트 + 유지보수 + 답사 + 기타업무 통합 표시
  - 바 색상: 프로젝트는 buildStatus.color, 유지보수는 장애유형 color, 답사는 답사 상태 color, 기타업무는 상태 color (좌측 보더 + 사선 패턴으로 구분)
  - 유지보수 바는 방문일정(`MaintenanceVisit`) 항목별로 표시 — 단일일은 1일 바, 기간은 시작~종료 바. 한 건에 방문 항목이 여럿이면 바도 여럿. 뷰 범위와 겹치는 항목만 렌더, 방문일정 없는 건은 미표시
  - 답사 바는 `visitDate`(방문일) 기준 1일짜리 단일 바
  - 기타업무 바는 업무기간(`EtcTaskVisit`) 항목별로 표시 — 유지보수 방문일정과 동일 규칙
  - 과거 일정 옅게, 미래 일정 짙게 표시 (오늘 기준 gradient 분리)
  - 바 클릭 시 해당 상세 페이지 새 탭 오픈
  - 주말 컬럼 연회색 오버레이, 오늘 세로선 빨강
  - 배정 업무 없는 엔지니어도 빈 행으로 표시

### 설치계획(가안) 관리
- 설치계획(가안) 등록·수정·삭제 (삭제는 ADMIN 이상)
- 병원 검색 모달로 병원 연결 (선택사항)
- 요청일 / 작성완료여부 / 회신여부 / 담당자(씨어스, 복수 지정) / 회신일 / 비고(Tiptap 리치 텍스트)
- 작성완료여부·회신여부 색상 뱃지: 완료(초록) / 미완료(노랑) / -(회색)
- 등록 시 작성완료여부·회신여부 기본값: '미완료'
- 목록 컬럼 헤더 클릭으로 오름차순/내림차순 정렬 토글

### 답사 관리 (구 답사 현황)
- 병원 방문 답사 기록 등록·수정·삭제 (삭제는 ADMIN 이상)
- 대웅 담당자(DAEWOONG 소속) + 담당자(필드 엔지니어, 복수 지정) 연결 지원
- 방문일 / 요청일 / 회신일 관리
- 답사 상태코드 연결
- 답사 상태: 접수 / 답사예정 / 작성완료 / 회신완료
- 목록 정렬: 상태 우선순위(접수 → 답사예정 → 작성완료 → 회신완료), 접수는 요청일 오래된 순, 나머지는 요청일 최신 순
- 목록 상태 필터 드롭다운
- 등록 시 상태 기본값: '접수'
- 설치계획서·평면도 파일 첨부 (AWS S3 업로드, presigned URL 다운로드)
- 노트: Tiptap 리치 텍스트 에디터

### 유지보수 관리
- 병원 장비/시스템 유지보수 기록 등록·수정·삭제 (삭제는 ADMIN 이상)
- 병원 ���색 모달로 병원 연결 (필수)
- 장애유형(MAINTENANCE_TYPE) / 상태(MAINTENANCE_STATUS) / 우선순위(긴급/높음/보통/낮음) 관리
- 담당자(필드 엔지니어, 복수 지정), 신고자(병원 측 텍스트), 원격처리 체크박스
- 접수일 / 완료일 관리
- **방문일정 다건 (캘린더 선택기)**: "방문일 지정" 버튼 → 월 달력 모달(`MaintenanceVisitPicker`, 외부 라이브러리 없는 자체 컴포넌트). 날짜를 클릭해 비연속 여러 날(예: 3일·7일·15일)을 토글 선택, **`장기일정` 체크박스**를 켜면 시작·종료일을 찍어 연속 기간 등록. 단일일·기간을 한 건에 혼합 + 기간 여러 개 가능. 선택 결과는 칩으로 표시·개별 삭제. 방문 항목별 Google Calendar 이벤트 자동 동기화
- 증상·원인: plain textarea, 조치내용·비고: Tiptap 리치 텍스트
- 첨부파일 관리 (AWS S3 업로드, presigned URL 다운로드) — edit 모드에서만
- 목록 컬럼: 접수일 | 병원명 | 제목 | 장애유형 | 우선순위 | 상태 | 원격 | 담당자 | 방문일정 | 완료일 (방문일정은 다건을 결합 표시, 3건↑은 "외 N건")
- 목록 필터: 병원명 텍스트 검색, 장애유형/상태/우선순위 select
- 우선순위 색상 뱃지: 긴급(red) / 높음(amber) / 보통(blue) / 낮음(gray)
- 등록 시 상태 기본값: '접수'
- 병원 상세 페이지에 유지보수 카드 연동

### 기타업무 관리
- 여러 병원을 커버하는 업무(다병원 점검 등)나 유지보수가 아닌 주요 업무 관리 (`/etc-tasks`)
- 등록·수정·삭제 (삭제는 ADMIN 이상), 고유 코드 `ETC-YYYYMM-NNNN` 자동 발번
- 제목 / 상태(ETC_TASK_STATUS, 설정에서 관리) / 우선순위(긴급/높음/보통/낮음) / 접수일 / 완료일
- **관련 병원 다중 연결** (선택, 0~N곳): 병원 검색 모달에서 칩 토글로 여러 병원 연결
- 담당자(기타업무 전용 풀, SEERS + thynC운영팀만 등록 가능, 복수 지정)
- **업무기간 다건**: 유지보수와 동일한 캘린더 선택기(`MaintenanceVisitPicker`)로 단일일·기간 혼합 등록 → **간트차트에 항목별 바 표기**(🗂, 상태 색) + 항목별 Google Calendar 이벤트 자동 동기화(`GOOGLE_CALENDAR_ETC_TASK_ID`, 미설정 시 스킵)
- 비고: Tiptap 리치 텍스트, 첨부파일(S3, edit 모드)
- 업무(Task) 현황에 `ETC` 타입으로 통합 조회 (상태 '완료' → isCompleted 동기화)
- 목록 컬럼: 접수일 | 제목 | 상태 | 우선순위 | 담당자 | 관련 병원(3곳↑ "외 N곳") | 업무기간 | 완료일. 필터: 제목 검색, 상태/우선순위 select
- 네비 메뉴 기본 노출: SEERS 소속만 (메뉴 관리에서 변경 가능)
- 감사 로그 `resource='etc_task'`로 모든 mutation 기록

### 자재관리(WMS) (개발 중 — `function_wms.md`)
- 구축·판매에서 취급하는 하드웨어 자재(게이트웨이·MC200M-T 등 자사기기, 사이니지·PC·모니터 등 전자제품, 케이블 등 잡자재) 재고관리. **자재 수량·입출고 관리에 집중**(안전재고·실사조정 등 부가기능 미채택)
- **인벤토리 3분리 (Phase 9 재설계)**: 재고 = **품목 × 위치 × 인벤토리**. 인벤토리는 **대웅제약재고 / 평가용재고 / 판매용재고** 3종(`/settings/inventories`에서 추가·이관 잠금·병원 연결·활성 편집) — 같은 MC200M-T라도 인벤토리별 수량·입출고 완전 독립
  - **인벤토리 탭 분리**: 자재 현황·입출고 이력 모두 상단 **인벤토리 탭**(전체/대웅제약/평가용/판매용)으로 분리 조회. 현황↔이력 이동 시 탭 유지, **입출고 모달의 기본 인벤토리 = 현재 탭**
  - **인벤토리 자재 상세** (`/inventory/[invId]/items/[itemId]`): 인벤토리 탭에서 자재 클릭 시 진입 — **URL 경로에 인벤토리 고정**. 그 인벤토리의 재고·입출고 이력·개체 목록만 표시(타 인벤토리 정보 미노출), 입출고 모달도 인벤토리 고정. 전체 탭·품목 관리에서 클릭하면 **품목 마스터 상세**(`/inventory/items/[id]` — 기준정보·부자재 구성 + 인벤토리별 재고 요약 카드→각 인벤토리 상세 링크 + 전체 이력·개체)
  - **자재 현황** (`/inventory`, 전 로그인 조회): 인벤토리 탭 + 분류·위치·검색 필터, 위치별 재고 칩, 주자재/부자재 뱃지, **Excel 다운로드**(현재 필터 반영)
  - **이관(TRANSFER)**: 인벤토리 간 재고 이동 전표 — **대웅제약↔판매용 상호 이관 가능, 평가용재고는 양방향 이관 금지**(이관 잠금). **이관일자**(기본 오늘)·**이관 단가**(참고용 선택 — 대웅→판매 재판매 기록) 입력, 이력·상세·Excel에 표시. 시리얼 개체는 이관 시 소속 인벤토리 변경, 회수(반품)도 원래 인벤토리로만(우회 이관 차단). 출고/이동/이관 모달은 현재 창고에 재고가 없으면 재고 있는 창고 자동 선택
- **입출고 원장**: 입고(IN)/출고(OUT)/이동(MOVE, 같은 인벤토리 내 위치 이동)/이관(TRANSFER) 전표, 전표코드 `STK-YYYYMM-NNNN`. **원장은 불변(append-only)** — 잘못 입력은 취소(역방향 되돌림)로 보정, 취소가 재고를 음수로 만들면 거부. 재고 음수 방지 이중장치(앱 조건부 차감 + DB `CHECK quantity>=0`)
- **입고/출고 유형 설정화** (`/settings/stock-reasons`, ADMIN): 입고(구매/회수(반품)/기타)·출고(설치/판매/폐기/불량/기타) 유형을 설정에서 추가·삭제. 시스템 동작이 걸린 유형(회수=개체 복귀, 폐기·불량=DISPOSED)과 사용 중 유형은 삭제 409
- **출고처 기재**: 출고 전표에 출고처 자유 텍스트(`destination`). **병원·업무 연결은 병원 연결 허용 인벤토리(대웅제약재고) 출고에서만 가능**(UI 숨김 + 서버 400) — 평가용/판매용은 출고처 텍스트만. 병원 상세 **'사용 자재' 카드**(출고 이력 + 설치 개체)
- **주자재/부자재 (BOM)**: 품목 상세에서 주자재 아래 부자재 N개 매핑(구성 수량 포함, 1단계 깊이). 출고 모달 **"부자재 함께 출고"(세트출고)** — 비시리얼 부자재를 같은 위치·인벤토리에서 자동 동시 출고(수량=출고수량×구성수량, 수정 가능), 자식 전표 `parent_tx_id` 연결·부모 취소 시 일괄 취소. 시리얼 부자재는 개별 출고
- **시리얼 개체 추적 (바코드 스캔 대량 처리)**: `is_serial_managed` 품목은 개체 단위 관리(IN_STOCK/OUT/DISPOSED). 입고·출고·이동·이관 모두 **시리얼 직접 입력 textarea**(줄 단위 붙여넣기·바코드 리더기 연속 스캔) — 재고 1만 개·1회 100~200개 출고 대응. 서버가 시리얼→개체 해석 후 버킷(위치·인벤토리·재고 상태) 검증(미등록/불일치 시리얼 명시 거부), 가용 개체 목록 클릭 선택 병행. 수량↔개체 정합 보장, 동시성 가드(조건부 updateMany+건수 검증)
- **입출고 이력** (`/inventory/transactions`): 유형·인벤토리·위치·기간 필터, 취소(권한자), **Excel 다운로드**(필터 반영, 최대 1만 행)
- **품목 마스터** (`/inventory/items`, ADMIN): `ITEM-NNNN` 자동 발번, 대>중>소 분류 트리·제조사·규격·단위·시리얼 여부·DeviceInfo 연결·참고단가. **Excel 일괄 가져오기**(품목명·대/중/소분류·제조사·규격·단위·시리얼여부·참고단가, 미리보기)
- **품목 상세** (`/inventory/items/[id]`): 요약·인벤토리×위치별 재고·**부자재 구성 카드**(매핑 추가/수량/해제, 부자재면 소속 주자재 표시)·입출고 이력·시리얼 개체 목록(인벤토리·위치·설치처 컬럼 분리)
- **처리 권한**: 입고/출고/이동/이관/취소 = 재고 담당자 풀(`/settings/inventory-managers`) + ADMIN 이상(`canManageStock` 서버 실시간 검사). 조회=전 로그인. 감사 로그 `resource='inventory_tx'`/`inventory_item`/`setting:*`
- **PROD 배포 완료** (2026-07-08 — 마이그레이션 8건 일괄)

### 차량예약
- 법인차량 선착순 즉시 확정 예약 (승인 절차 없음)
- **주간 현황 보드** (`/vehicle-reservations`): 행=차량(색 칩+이름+차량번호), 열=월~일
  - 예약 카드: 시간·예약자·목적, 내 예약은 파란색 강조, 여러 날에 걸친 예약은 ←/→ 표시로 분할 렌더
  - **반납 상태 색 구분**: 반납완료(회색 ✓) / 반납필요(종료시간 지난 미반납, 앰버 ⚠) / 내 예약(파랑) / 타인(회색)
  - 빈 영역 클릭 → 해당 차량·날짜로 예약 모달 자동 채움
  - 주 이동 ◀▶ + 오늘 버튼, URL `?week=` 동기화, 오늘 컬럼·주말 컬럼 하이라이트
- **반납**: 예약 상세 모달에 `반납` 버튼 → 최종 주행거리(+비고) 입력 → 운행일지 자동 생성 + 반납완료 처리(한 트랜잭션). 시작/종료/목적/행선지/운전자는 예약값 자동(운전자 변경은 ADMIN). 반납완료 예약은 수정/취소 대신 반납 정보 표시, ADMIN은 반납취소(일지 삭제+해제) 가능
- **운행일지 탭**: 현황 보드 | 내 예약 | 운행일지. 차량·기간 필터 + 합계 주행거리, 예약 미연결 운행 직접 작성·수정·삭제. 조회=로그인 전체, 작성·수정·삭제=USER 이상 본인(운전자/작성자) 또는 ADMIN
- **예약 모달**: 차량 / 시작·종료(날짜+30분 단위 시각, 다일 예약 지원) / 종일(09:00~18:00) 버튼 / 목적 / 행선지
  - 충돌 시 "이미 ○○님이 …~… 예약했습니다" 인라인 안내 (409)
- **내 예약 탭**: 다가오는 본인 예약 목록 + 상세/수정/취소
- 권한: 조회=로그인 전체(VIEWER 포함), 예약·본인 수정·취소=USER 이상, 타인 예약 취소=ADMIN 이상
- **계정별 사용 제한**: 계정관리에서 `vehicleReservationBlocked` 지정 시 해당 계정은 등록·수정·취소 불가(조회만). 서버에서 POST/PUT/DELETE 진입 시 DB 조회로 실시간 차단(403), 페이지 상단 안내 배너 노출
- 더블부킹 방지: 앱 레벨 트랜잭션 검사 + DB EXCLUDE 제약 이중 장치
- **차량 관리** (`/settings/vehicles`, ADMIN 이상): 차량 등록·수정·삭제·순서·활성 토글, 보드 표시 색상(ColorPicker)
  - 예약 이력 있는 차량 삭제 → 자동 비활성화 (이력 보존)
- 감사 로그: `resource='vehicle'` / `'vehicle_reservation'` 으로 모든 mutation 기록

### 소속 관리 (SUPER_ADMIN 전용)
- 소속(Organization) 추가·수정·삭제
- 인라인 수정, 순서 이동
- 유저가 있는 소속 삭제 방지 (409 반환)
- DAEWOONG 소속 영구 삭제 보호

### 사용자 관리
- 시스템 사용자 등록·수정·삭제 (ADMIN 이상)
- 소속 드롭다운 연결
- **SUPER_ADMIN의 타계정 수정**: 이름·연락처·역할·소속·부서·비밀번호 + **차량예약 사용 제한** 일괄 수정 (현재 비밀번호 확인 없이 변경 가능)
- **차량예약 사용 제한 토글**: 타계정 수정 모달에서 체크 시 해당 계정 차량예약 차단, 목록에 `예약제한` 뱃지 표시 (변경 권한 ADMIN 이상)
- 계정 활성/비활성 처리
- 소속별 탭 분리: 씨어스테크놀로지(SEERS) / 대웅제약(DAEWOONG) (탭별 사용자 수 뱃지)
- 계정 생성·수정 시 부서 드롭다운 (소속 선택 연동 동적 로드)

### 소속 관리 (SUPER_ADMIN 전용)
- 소속(Organization) 추가·수정·삭제·순서 이동
- **부서 관리**: 각 소속 행의 "부서 관리" 버튼으로 인라인 아코디언 열기 (다른 소속 아코디언 자동 닫힘)
  - 부서 목록 테이블: 순서↑↓, 부서명 인라인 수정, 소속 계정 수, 삭제
  - 부서 추가: 하단 입력 행에서 즉시 추가
  - 연결된 계정 있으면 삭제 불가 (인라인 에러 표시)

### 담당자 리스트 (ADMIN 이상)
- SEERS 소속 사용자 중 업무별 담당자 등록·삭제
- **탭 4종**: 프로젝트 담당자 / 설치계획 담당자 / 유지보수 담당자 / 기타업무 담당자
  - 프로젝트 담당자 풀은 프로젝트·답사 페이지에서 공유 사용
  - 설치계획·유지보수·기타업무는 각 업무 전용 풀
  - 기타업무 담당자는 SEERS + thynC운영팀 소속만 후보로 표시·등록 가능
  - 한 사용자가 여러 풀에 동시 등록 가능
- "+ 추가" 버튼으로 후보 검색 모달 열기 (이름/이메일 검색, 300ms debounce, 페이지네이션)
- 후보: SEERS 소속·활성·해당 풀 미등록 사용자만 표시
- 목록 테이블: 번호·이름·이메일·소속·부서·추가일·삭제

### Slack 알림 (개발 중 — `function_notification.md`)
- 주요 업무(프로젝트/답사/설치계획/유지보수/기타업무) **등록 시 + 이후 상태 변경 시마다 Slack 채널 알림** (Phase 2 완료). 완료도 "→ 완료" 상태 변경의 한 경우
- 전송 어댑터 `lib/slack.ts`(의존성0 fetch) + 정책·로그 `lib/notify.ts`. 발송 실패는 업무 API를 절대 깨지 않는 best-effort
- **발송 모드** (`SLACK_NOTIFY_MODE`): `off`(미발송) / `test`(전부 테스트 채널 + `[DEV]` prefix, 비-production은 live 자동 강등) / `live`(운영). DEV는 항상 test
- **게이트**: AppSetting `notify_enabled`(기본 off) + `notify_events_enabled`(기본 on) + **업무 타입별 `notify_types_enabled`(기본 전부 on, 끈 타입은 등록·상태변경·지연·DM 전부 미발송)**. 채널은 `SLACK_CHANNEL_MAIN` 단일
- **상태 변경 감지**: 타입별 상태 시그니처(프로젝트=공사상태, 답사/유지보수/기타업무=상태명, 설치계획=작성/회신여부)를 직전 발송 로그와 비교해 **실제 변경 시에만** 발송(from→to 표기). 등록 알림은 `refCode`당 1회 dedup. (업무현황 완료 체크박스는 원본 상태 미변경이라 알림 대상 아님)
- 메시지: 고정(이모지+타입+병원명/제목+상세 링크, 등록 🆕 / 상태변경 🔄 `접수 → 처리중`) + **타입별 선택 필드**
- **담당자 멘션**: 담당자 필드는 Slack 태그(`<@ID>`) — 단 계정 발송 플래그 on + 매핑 성공인 사람만, 그 외는 이름 텍스트 폴백
- **지연 감지 요약** (Phase 3): 주기(`notify_delay_interval` off/1h/6h/24h) 점검 → 지연 업무 요약 1메시지(⏰ N건, 상세링크)를 지연 채널로. 기준(설정 페이지에서 편집 가능·`notify_delay_rules`) — 답사·설치계획 요청일+N / 기타업무 접수일+N / 프로젝트 완료예정일+N / 유지보수 우선순위별(긴급·높음·보통·낮음), 완료·보류 제외(KST 자정 기준). 12시간 내 동일 목록 재발송 스킵. 스케줄러는 `lib/notify-scheduler.ts`(mail-scheduler 패턴, instrumentation 기동), 판정은 `lib/delay-rules.ts`
- **단계(상태) 체류 지연**: 특정 상태(단계)에 지정 일수 이상 머물면 지연 판정 — 기준일 규칙과 병행(둘 중 하나만 걸려도 지연). 타입별·상태별 임계일을 설정 페이지에서 지정(`notify_status_dwell`, 0=미사용, 기본 전체 미사용). 상태 진입 시각은 각 업무 테이블 `status_changed_at`(상태 실변경 시 기록, 레거시 NULL은 요청/접수일→등록일 fallback). 완료예정일 미입력 프로젝트도 체류 규칙으로 감지 가능. 설치계획은 작성/회신 2-플래그 구조라 제외
- **담당자 DM** (Phase 4): 지연 업무 담당자에게 개인 DM 리마인드(`notify_dm_enabled`, 기본 off). 매핑 — 계정 이메일로 Slack `lookupByEmail` 후 `users.slack_user_id` 캐시(실패 시 그 사람만 스킵). 같은 건·같은 사람 24h 1회, 상한 없음(해소 시까지). test 모드는 실제 담당자 대신 테스트 채널로 `[DEV][DM→이름]`
- **설정 페이지 `/settings/notifications`** (ADMIN 이상): 발송 모드(읽기전용) + 전역/이벤트 토글 + **지연 요약 주기·담당자 DM 토글** + **지연 판정 기준일 편집**(타입별·유지보수 우선순위별) + **업무 타입별 메시지 포함 필드 선택**(예: 답사에 '요청일') + **발송 이력**(최근 50건·상태 필터, `GET /api/settings/notifications/logs`). 저장은 AppSetting(`notify_enabled`/`notify_events_enabled`/`notify_delay_interval`/`notify_dm_enabled`/`notify_event_fields`/`notify_delay_rules`/`notify_dm_policy`)
- **계정별 발송 차단**: `users.slackNotifyEnabled=false`인 계정은 DM 미발송(계정관리에서 제어)

### 사내 위키 (Phase 2-13)
- Notion-like 블록 에디터(BlockNote) 기반 사내 위키
- 별도 PostgreSQL 스키마 `wiki`에 격리, 메인 모듈과 단방향 의존성 유지
- 페이지 단위 작성·조회·수정·삭제 (BlockNote JSON 본문)
- **디자인 시스템(Phase 9)**: 위키 전용 디자인 토큰(`app/wiki/wiki-theme.css`, `.wiki-root` 스코프), full-bleed 레이아웃, 공통 컴포넌트(Toast/WikiModal/Skeleton/EmptyState/OverflowMenu), `alert()` 미사용(토스트로 통일)
- **자동 저장 + 충돌 감지(Phase 10)**: 편집 모드 토글 없이 진입 즉시 편집, 변경 시 debounce 1.5초 자동 저장, 헤더 저장 인디케이터. `baseUpdatedAt` 비교로 다른 곳 수정 시 409 충돌 안내(실시간 협업 대신 lost-update 방지). 버전 스냅샷은 2분 throttle
- **페이지 아이콘·커버(Phase 10)**: 이모지 아이콘(경량 EmojiPicker) + 커버 이미지. 사이드바·홈·검색·휴지통에 아이콘 노출
- **블록 확장(Phase 11)**: 콜아웃(💡 배경색 박스)·구분선 커스텀 블록(슬래시 메뉴), **멀티컬럼**(`@blocknote/xl-multi-column` — 블록을 좌우 칼럼으로 나란히 배치, 드래그로 칼럼 생성)
- **목차 TOC(Phase 11)**: heading 추출 → 넓은 화면 우측 floating 목차(클릭 스크롤)
- **홈 대시보드(Phase 11)**: 즐겨찾기 / 최근 본 / 최근 수정 3섹션
- **백링크(Phase 12)**: 본문 저장 시 페이지 링크를 `WikiPageLink`로 인덱싱, 상세 하단 "이 페이지를 링크한 페이지" 패널
- **템플릿(Phase 12)**: 페이지 상세 ⋯ "템플릿으로 저장", 신규 작성 시 "빈 페이지 + 템플릿 갤러리" 선택
- **휴지통(Phase 13)**: soft delete(`deletedAt`) → `/wiki/trash`에서 복구(부모 삭제 시 루트 승격)/영구삭제. 모든 조회에서 삭제 페이지 제외
- **검색 고도화(Phase 13)**: 작성자·기간 필터, `pg_trgm` GIN 인덱스로 ILIKE 가속, 삭제/템플릿 제외
- **알림(Phase 13)**: 댓글 시 작성자+최근수정자에게 `WikiNotification` 생성, 사이드바 🔔 벨(미읽음 뱃지·60초 폴링·읽음 처리)
- **계층 구조**: `parentId`로 무한 깊이 트리, 좌측 사이드바에서 접기/펼치기·형제 순서 변경(↑↓)·하위 페이지 추가(+)
- **드래그앤드롭 트리 이동** (`@dnd-kit/core`): 사이드바에서 핸들(⠿)로 드래그 — 행 위에 놓으면 하위로, 행 사이 틈에 놓으면 해당 위치로, 하단 존에 놓으면 최상위로. 자기 자신/후손으로의 이동은 차단
- **페이지 이동 모달**: 사이드바 📂 버튼 또는 페이지 상세 "📂 이동" 버튼 → 트리에서 새 부모 선택 (루트 이동 포함)
- **페이지 복제**: 페이지 상세 "⧉ 복제" 버튼 — 단일 또는 하위 포함 재귀 복제. 본문·태그·참조 복사, 댓글·버전·첨부 미복사. 사본 제목 " (사본)" suffix
- **breadcrumb**: 상세 페이지 상단에 부모 체인 표시
- **파일 첨부**: 이미지/파일 BlockNote 안에서 드래그/슬래시로 직접 업로드. S3 저장(`wiki/{pageId}/{ts}_{name}`), 최대 50MB, 24h presigned URL로 표시
- **메인 메뉴 등록**: `nav_menu_items`에 `wiki` 행 (sort_order=15)
- **감사 로그**: CREATE/UPDATE/DELETE 모두 `resource='wiki_page'`로 기록
- **명시적 참조 (WikiPageReference)**: 병원/프로젝트를 chip 형태로 명시적 연결, 병원 상세 역참조 카드
- **태그**: 페이지에 다중 태그 추가, 검색에서 태그 필터 가능 (`WikiTag`/`WikiPageTag`)
- **즐겨찾기**: 페이지 상단 ☆ 토글, `/wiki/favorites` 전용 페이지
- **최근 본 페이지**: 페이지 열람 시 `WikiViewLog` 자동 기록, `/wiki/recent`에서 사용자별 최근 50개 페이지
- **검색** (`/wiki/search`): 제목 + 본문(plain_text 컬럼) ILIKE, 태그 필터, 매칭 부위 snippet `<mark>` 강조
- **버전 히스토리**: 본문 수정 시 직전 상태를 `WikiVersion`에 자동 스냅샷, 상단 "🕘 버전" 버튼으로 목록 + 복원 (복원도 현재 본문을 새 스냅샷으로 보존)
- **댓글**: 페이지 하단 flat 댓글 (본인+ADMIN 수정·삭제, Ctrl+Enter 단축키)
- **BlockNote 커스텀 블록**:
  - **페이지 블록** — 슬래시 `/`에 "하위 페이지 추가" → 자식 페이지 즉시 생성 + 본문에 📄 링크 블록 삽입
  - **기존 페이지 링크** — 슬래시 `/`에 "기존 페이지 링크" → 검색 모달(`/api/wiki/search`)에서 이미 있는 페이지를 골라 신규 생성 없이 📄 링크 블록 삽입
  - **인라인 mention** — `@` 입력 시 병원·프로젝트 통합 검색 자동완성, 선택 시 `target="_blank"` 링크 삽입
- 권한: 로그인 필수 / VIEWER 읽기 / USER 이상 쓰기·삭제
- 인라인 mention 검색은 검색 plain_text 인덱스에도 포함됨 (label 추출)

### AI 어시스턴트
- Flowise RAG 서버 연동 AI 챗봇
- 2단 레이아웃: 좌측 채팅 + 우측 상담 정리 패널 (토글 열기/닫기)
- **좌측 채팅**: 병원 검색(debounce) → 선택 태그 표시, 기본값 '공통', 사용자/AI 말풍선 구분, AI 답변 마크다운 렌더링
- **우측 상담 정리 패널 (선택사항)**: 상담유형/문서유형 선택, AI 정제 버튼(Anthropic Claude API), 결론 텍스트, 대기리스트 등록 (대화 없이도 등록 가능)
- AI 정제: 대화 내역을 마크다운 상담이력으로 자동 정리 (claude-sonnet-4-5)
- 상담이력 저장: ConsultationQueue 테이블에 병원·유형·대화·정제결과 저장
- 세션 ID 기반 대화 컨텍스트 유지, 모든 역할 접근 가능

### 네비게이션 메뉴 관리 (SUPER_ADMIN 전용)
- DB 기반 동적 네비게이션 메뉴 시스템
- **설정 하위 메뉴 기능별 그룹화** (`group_label`): 네비 설정 아코디언이 그룹 헤더(일반/조직·계정/병원·구축/업무 유형·상태/자재관리/차량/연동·알림)로 구분 표시. 메뉴 관리에서 그룹명 인라인 편집(자유 텍스트 — 새 그룹 즉시 생성)
- 메뉴명 인라인 수정 (표시 이름 커스터마이징)
- 역할별 메뉴 노출 제어: 체크박스로 SUPER_ADMIN/ADMIN/USER/VIEWER 선택 (빈 선택=전체 역할)
- 소속별 메뉴 노출 제어: 체크박스로 Organization 선택 (빈 선택=전체 소속)
- 활성/비활성 토글로 메뉴 숨기기
- 메인 메뉴 / 설정 하위 메뉴 2개 섹션으로 구분
- 순서 변경 (↑↓ 버튼), 새 메뉴 추가/삭제
- API 실패 시 폴백 메뉴 자동 적용

### 감사 로그 (SUPER_ADMIN 전용)
- 시스템 내 모든 데이터 변경(CREATE/UPDATE/DELETE) 및 인증(LOGIN/LOGOUT) 이벤트 기록
- 적용 범위: 인증, User CRUD, 4대 업무(Project/SiteVisit/Maintenance/InstallPlan), Hospital(+ 대웅 담당자 배정/해제), Contractor, Settings 전체
- `/settings/audit-logs` 페이지: 검색(사용자/대상명) + 액션·대상·기간 필터 + 페이지네이션
- 행 클릭 시 상세 모달: before/after 필드별 비교 테이블(변경 필드 노란색 하이라이트)
- 비밀번호 등 민감 필드는 저장 시점에 자동 `[REDACTED]` 처리
- 로그 기록 실패는 본 작업을 차단하지 않음 (try-catch 보호)

### 설정 (ADMIN 이상)
- 병원 상태코드 관리 (추가·수정·삭제·순서)
- 답사 상태코드 관리
- 공사 상태(BuildStatus) 관리
- 장비 정보(DeviceInfo) 관리
- 시공사(Contractor) 관리
- **도입형태(IntroType) 관리**: 구축형·구독형·사용량비례형 등 동적 추가·수정·삭제·순서 변경
- **상담유형(ConsultationType) 관리**: AI 어시스턴트 상담유형 동적 추가·수정·삭제·순서 변경
- **문서유형(DocumentType) 관리**: AI 어시스턴트 문서유형 동적 추가·수정·삭제·순서 변경 (value 코드값 포함)
- **심평원 연동 관리** (SUPER_ADMIN 전용): 심평원 Open API 병원 데이터 동기화
  - 연동 시작 버튼 → 백그라운드 비동기 처리 (브라우저 닫아도 서버에서 계속 실행)
  - 연동 히스토리 목록 (시작시간·종료시간·상태·연동건수)
  - 히스토리 행 클릭 시 상세 로그 패널 표시 (이벤트 타입별 색상 구분)
  - 진행 중 잡에 대해 2초 간격 폴링으로 실시간 로그 갱신

### Google Drive 연동 (선택)
- Service Account 기반 파일 업로드 (`POST /api/drive/upload`)
- 폴더 내 파일 목록 조회 (`GET /api/drive/files`)
- 파일 삭제 (`POST /api/drive/delete`)
- 병원 목록 스프레드시트 내보내기 (`POST /api/drive/export/hospitals`, Sheets API)
- 연결 상태 확인 (`testDriveConnection()`)

> 프로젝트 파일·답사 파일 업로드는 AWS S3로 전환되었습니다. Google Drive는 병원 목록 내보내기 등 Drive 전용 기능에 활용됩니다.

---

## Google Drive 연동 설정

Google Drive 연동을 사용하려면 아래 절차를 따릅니다.

### 1. 서비스 계정 JSON 키 발급

1. [Google Cloud Console](https://console.cloud.google.com/) → IAM 및 관리자 → 서비스 계정
2. 서비스 계정 생성 후 **키 추가 → JSON** 다운로드
3. Google Drive API 활성화 (API 및 서비스 → 라이브러리)
4. 공유할 Drive 폴더에 서비스 계정 이메일을 **편집자**로 초대

### 2. JSON 키를 한 줄 문자열로 변환

```bash
cat your-service-account.json | tr -d '\n'
```

### 3. `.env.local`에 값 설정

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...전체_JSON_한줄로..."}
GOOGLE_DRIVE_FOLDER_ID=1r0QdwBtm5LPdBi1QvpUO9InUt7kSENm5
```

> 키 파일 원본(`.json`)과 `.env.local`은 절대 git에 커밋하지 마세요.

---

## AWS S3 연동 설정

프로젝트 파일 및 답사 파일은 AWS S3에 저장됩니다.

### 1. IAM 사용자 및 버킷 준비

1. AWS Console → IAM → 사용자 생성 후 `AmazonS3FullAccess` (또는 해당 버킷 전용 정책) 부여
2. 액세스 키 생성
3. S3 버킷 생성 (예: `seers-thync-ops`, 리전: `ap-northeast-2`)

### 2. `.env`에 값 설정

```env
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
S3_BUCKET_NAME=seers-thync-ops
```

### 파일 저장 경로 규칙

| 구분 | S3 키 패턴 |
|------|-----------|
| 프로젝트 파일 | `projects/{projectCode}/{timestamp}_{fileName}` |
| 답사 설치계획서 | `site-visits/{hospitalCode}/install-plan_{fileName}` |
| 답사 평면도 | `site-visits/{hospitalCode}/floor-plan_{fileName}` |

> `.env` 파일은 절대 git에 커밋하지 마세요.

---

## 로컬 개발 환경 설정

### 사전 요구사항
- Node.js 20+
- PostgreSQL

### 1. 저장소 클론

```bash
git clone https://github.com/odiohead/thynC-Ops-System.git
cd thynC-Ops-System/thynC-Ops-DEV
```

### 2. 패키지 설치

```bash
npm install
```

### 3. 환경변수 설정

`.env.example`을 복사해서 `.env.local`을 생성하고 실제 값을 채웁니다.

```bash
cp .env.example .env.local
```

```env
# 데이터베이스
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/<dbname>"

# 인증
JWT_SECRET="your-secret-key"

# 앱 이름
NEXT_PUBLIC_APP_NAME="thynC Operations System"

# AWS S3 (파일 업로드 — 필수)
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
S3_BUCKET_NAME=seers-thync-ops

# Google Drive (선택 — 병원 목록 내보내기 등 Drive 연동 시 필요)
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
GOOGLE_DRIVE_FOLDER_ID=your_folder_id_here
```

> `.env.local`은 `.gitignore`에 포함되어 있어 git에 커밋되지 않습니다.

### 4. DB 마이그레이션 및 시드

```bash
npx prisma migrate deploy
npm run seed:admin    # 관리자 계정 생성
npm run seed          # 기본 데이터 생성 (Organization 포함)
```

### 5. 개발 서버 실행

```bash
npm run dev
```

---

## 기본 관리자 계정

| 항목 | 값 |
|------|----|
| 이메일 | admin@thync.com |
| 비밀번호 | admin1234 |

> 운영 환경에서는 반드시 비밀번호를 변경하세요.

---

## API 엔드포인트

### 인증
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/logout` | 로그아웃 |
| GET  | `/api/auth/me` | 현재 사용자 정보 |

### 대시보드
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/dashboard` | 이번 주/다음 주 공사 현황 |
| GET | `/api/dashboard/monthly` | 월별 누적 병원/병상 통계 |
| GET | `/api/dashboard/summary` | 도입병원/병상 합계 + 상태별 집계 |
| GET | `/api/dashboard/maintenance` | 유지보수 진행중 건수·상태별·주간 추이 + 진행중 내역(items) |
| GET | `/api/dashboard/hospital-stats` | 종별(HIRA) 병원 현황 — 전국 모수·검토중·도입(contracted) |

### 병원
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/hospitals` | 병원 목록 |
| POST | `/api/hospitals` | 병원 등록 |
| GET  | `/api/hospitals/[code]` | 병원 상세 |
| PUT  | `/api/hospitals/[code]` | 병원 수정 |
| DELETE | `/api/hospitals/[code]` | 병원 삭제 |
| POST | `/api/hospitals/import` | Excel 일괄 가져오기 (`?preview=true` 미리보기) |
| POST | `/api/hospitals/[code]/transfer-work` | 병원 업무 일괄 이전 (SUPER_ADMIN) |
| POST | `/api/work-items/reassign` | 업무 병원 재지정 (ADMIN 이상, type/code/newHospitalCode) |
| GET  | `/api/hospitals/[code]/devices` | 병원 장비 목록 |
| POST | `/api/hospitals/[code]/devices` | 병원 장비 추가 |
| GET  | `/api/hospitals/[code]/daewoong-staff` | 병원 담당자 목록 |
| POST | `/api/hospitals/[code]/daewoong-staff` | 담당자 배정 |
| DELETE | `/api/hospitals/[code]/daewoong-staff/[sid]` | 담당자 해제 |
| POST | `/api/hospitals/[code]/drive-folder` | Drive 폴더 연결 |

### HIRA 병원
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/hira-hospitals` | HIRA 병원 목록 (검색/필터) |
| GET | `/api/hira-hospitals/[id]` | HIRA 병원 상세 |
| GET | `/api/hira-hospitals/sync` | 연동 잡 히스토리 목록 (최근 50건) |
| POST | `/api/hira-hospitals/sync` | 연동 잡 시작 (백그라운드 비동기, SUPER_ADMIN) |
| GET | `/api/hira-hospitals/sync/[id]` | 연동 잡 상세 + 로그 목록 (SUPER_ADMIN) |

### 프로젝트
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/projects` | 프로젝트 목록 (`?all=true` 전체 반환, 페이지네이션 없음) |
| POST | `/api/projects` | 프로젝트 등록 |
| GET  | `/api/projects/[code]` | 프로젝트 상세 |
| PUT  | `/api/projects/[code]` | 프로젝트 수정 |
| DELETE | `/api/projects/[code]` | 프로젝트 삭제 |
| GET  | `/api/projects/[code]/devices` | 프로젝트 장비 목록 |
| POST | `/api/projects/[code]/devices` | 프로젝트 장비 추가 |
| GET  | `/api/projects/[code]/files` | 프로젝트 파일 목록 |
| POST | `/api/projects/[code]/files` | 프로젝트 파일 추가 |
| GET  | `/api/projects/[code]/files/[fileId]/download` | 프로젝트 파일 다운로드 (S3 presigned URL) |
| PUT  | `/api/projects/[code]/files/[fileId]` | 프로젝트 파일 수정 |
| DELETE | `/api/projects/[code]/files/[fileId]` | 프로젝트 파일 삭제 |
| POST | `/api/projects/[code]/drive-folder` | Drive 폴더 연결 |

### 설치계획(가안)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/install-plans` | 설치계획 목록 (필터·정렬, 전체 반환) |
| POST | `/api/install-plans` | 설치계획 등록 |
| GET  | `/api/install-plans/[id]` | 설치계획 상세 |
| PUT  | `/api/install-plans/[id]` | 설치계획 수정 |
| DELETE | `/api/install-plans/[id]` | 설치계획 삭제 (ADMIN 이상) |

### 기타업무
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/etc-tasks` | 기타업무 목록 (`?search=`제목 `&statusId=&priority=&hospitalCode=` 필터) |
| POST | `/api/etc-tasks` | 기타업무 등록 (USER 이상, 코드 발번 + Task 미러 + 기간별 캘린더 이벤트) |
| GET  | `/api/etc-tasks/[id]` | 기타업무 상세 |
| PUT  | `/api/etc-tasks/[id]` | 기타업무 수정 (담당자·병원·업무기간 reconcile, 상태 '완료' → Task isCompleted) |
| DELETE | `/api/etc-tasks/[id]` | 기타업무 삭제 (ADMIN 이상, 캘린더·S3·Task 정리) |
| GET  | `/api/etc-tasks/[id]/files` | 첨부파일 목록 |
| POST | `/api/etc-tasks/[id]/files` | 첨부파일 업로드 (S3 `etc-tasks/{id}/…`) |
| DELETE | `/api/etc-tasks/[id]/files/[fileId]` | 첨부파일 삭제 |
| GET  | `/api/etc-tasks/file-url` | 첨부파일 presigned URL 발급 (`?key=`) |

### 차량예약
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/vehicles` | 차량 목록 (`?activeOnly=true`, 예약 건수 포함) |
| POST | `/api/vehicles` | 차량 등록 (ADMIN 이상) |
| PUT  | `/api/vehicles/[id]` | 차량 수정 (ADMIN 이상) |
| DELETE | `/api/vehicles/[id]` | 차량 삭제 (ADMIN 이상, 예약 이력 있으면 비활성화 처리) |
| GET  | `/api/vehicle-reservations` | 예약 목록 (`?from=&to=&vehicleId=&mine=true`, RESERVED만) |
| POST | `/api/vehicle-reservations` | 예약 생성 (USER 이상, 충돌 시 409 + 겹치는 예약 정보) |
| GET  | `/api/vehicle-reservations/[id]` | 예약 상세 |
| PUT  | `/api/vehicle-reservations/[id]` | 예약 수정 (본인 또는 ADMIN 이상, 충돌 재검사) |
| DELETE | `/api/vehicle-reservations/[id]` | 예약 취소 (본인 또는 ADMIN 이상, status=CANCELED) |

### AI 어시스턴트
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/ai-assistant` | AI 질문 전송 (`{ question, sessionId? }` → `{ answer }`) |
| POST | `/api/ai-assistant/summarize` | AI 정제 (대화 → 마크다운 상담이력) |
| POST | `/api/ai-assistant/consultation` | 상담이력 대기리스트 등록 |

### 답사
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/site-visits` | 답사 목록 |
| POST | `/api/site-visits` | 답사 등록 |
| GET  | `/api/site-visits/[id]` | 답사 상세 |
| PUT  | `/api/site-visits/[id]` | 답사 수정 |
| DELETE | `/api/site-visits/[id]` | 답사 삭제 |
| POST | `/api/site-visits/upload` | 답사 파일 업로드 (S3) |
| GET  | `/api/site-visits/file-url` | 답사 파일 presigned URL 발급 (`?key=`) |
| DELETE | `/api/site-visits/file` | 답사 S3 파일 삭제 |

### 시공사
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/constructors` | 시공사 목록 |
| POST | `/api/constructors` | 시공사 등록 |
| GET  | `/api/constructors/[code]` | 시공사 상세 |
| PUT  | `/api/constructors/[code]` | 시공사 수정 |
| DELETE | `/api/constructors/[code]` | 시공사 삭제 |

### 사용자
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/users` | 사용자 목록 (`?organization=` 필터, `?search=` 검색, `?page=&limit=` 페이지네이션 — page/limit 있으면 `{data,total,page,limit}` 반환) |
| POST | `/api/users` | 사용자 등록 |
| GET  | `/api/users/[id]` | 사용자 상세 |
| PUT  | `/api/users/[id]` | 사용자 수정 (SUPER_ADMIN은 타계정 수정 가능) |
| DELETE | `/api/users/[id]` | 사용자 삭제 |

### 설정
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/settings/organizations` | 소속 목록 (유저 수 포함) |
| POST | `/api/settings/organizations` | 소속 추가 (SUPER_ADMIN 전용) |
| PUT  | `/api/settings/organizations/[id]` | 소속 수정 (SUPER_ADMIN 전용) |
| DELETE | `/api/settings/organizations/[id]` | 소속 삭제 (SUPER_ADMIN 전용) |
| GET  | `/api/settings/departments` | 부서 목록 (`?organizationId=` 필수, `_count.users` 포함) |
| POST | `/api/settings/departments` | 부서 추가 (ADMIN 이상) |
| PUT  | `/api/settings/departments/[id]` | 부서 수정 (ADMIN 이상) |
| DELETE | `/api/settings/departments/[id]` | 부서 삭제 (ADMIN 이상, 연결 계정 있으면 409) |
| GET  | `/api/settings/field-engineers` | 담당자 목록 (`?workType=PROJECT\|INSTALL_PLAN\|MAINTENANCE\|ETC_TASK` 기본 PROJECT, `?search=&page=&limit=`, `?all=true` 전체 반환) |
| POST | `/api/settings/field-engineers` | 담당자 등록 (ADMIN 이상, SEERS 소속만 가능, `{userId, workType}`) |
| DELETE | `/api/settings/field-engineers/[id]` | 담당자 삭제 (ADMIN 이상, 204) |
| GET  | `/api/settings/field-engineers/candidates` | 등록 후보 목록 (ADMIN 이상, SEERS·활성·해당 workType 미등록) |
| GET  | `/api/settings/devices` | 장비 정보 목록 |
| POST | `/api/settings/devices` | 장비 정보 추가 |
| PUT  | `/api/settings/devices/[id]` | 장비 정보 수정 |
| DELETE | `/api/settings/devices/[id]` | 장비 정보 삭제 |
| GET  | `/api/settings/build-status` | 공사 상태 목록 |
| POST | `/api/settings/build-status` | 공사 상태 추가 |
| PUT  | `/api/settings/build-status/[id]` | 공사 상태 수정 |
| DELETE | `/api/settings/build-status/[id]` | 공사 상태 삭제 |
| GET  | `/api/settings/status` | 병원 상태코드 목록 |
| POST | `/api/settings/status` | 병원 상태코드 추가 |
| PUT  | `/api/settings/status/[id]` | 병원 상태코드 수정 |
| DELETE | `/api/settings/status/[id]` | 병원 상태코드 삭제 |
| GET  | `/api/settings/site-visit-status` | 답사 상태코드 목록 |
| POST | `/api/settings/site-visit-status` | 답사 상태코드 추가 |
| PUT  | `/api/settings/site-visit-status/[id]` | 답사 상태코드 수정 |
| DELETE | `/api/settings/site-visit-status/[id]` | 답사 상태코드 삭제 |
| GET  | `/api/settings/intro-type` | 도입형태 목록 |
| POST | `/api/settings/intro-type` | 도입형태 추가 |
| PUT  | `/api/settings/intro-type/[id]` | 도입형태 수정 |
| DELETE | `/api/settings/intro-type/[id]` | 도입형태 삭제 |
| GET  | `/api/settings/consultation-type` | 상담유형 목록 |
| POST | `/api/settings/consultation-type` | 상담유형 추가 |
| PUT  | `/api/settings/consultation-type/[id]` | 상담유형 수정 |
| DELETE | `/api/settings/consultation-type/[id]` | 상담유형 삭제 (ADMIN 이상) |
| GET  | `/api/settings/document-type` | 문서유형 목록 |
| POST | `/api/settings/document-type` | 문서유형 추가 |
| PUT  | `/api/settings/document-type/[id]` | 문서유형 수정 |
| DELETE | `/api/settings/document-type/[id]` | 문서유형 삭제 (ADMIN 이상) |
| GET  | `/api/settings/etc-task-status` | 기타업무 상태 목록 |
| POST | `/api/settings/etc-task-status` | 기타업무 상태 추가 |
| PUT  | `/api/settings/etc-task-status/[id]` | 기타업무 상태 수정 |
| DELETE | `/api/settings/etc-task-status/[id]` | 기타업무 상태 삭제 (ADMIN 이상) |
| GET  | `/api/settings/audit-logs` | 감사 로그 목록 (SUPER_ADMIN 전용, `?page=&limit=&search=&action=&resource=&from=&to=`) |

### 네비게이션 메뉴
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/nav-menus` | 활성 메뉴 목록 (Navigation 컴포넌트용) |
| GET | `/api/settings/nav-menus` | 전체 메뉴 목록 + 소속 목록 (SUPER_ADMIN) |
| POST | `/api/settings/nav-menus` | 메뉴 추가 (SUPER_ADMIN) |
| PUT | `/api/settings/nav-menus/[id]` | 메뉴 수정 (SUPER_ADMIN) |
| DELETE | `/api/settings/nav-menus/[id]` | 메뉴 삭제 (SUPER_ADMIN) |

### Google Drive
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/drive/upload` | 파일 업로드 (`fileName`, `content`, `mimeType`) |
| GET  | `/api/drive/files` | 폴더 내 파일 목록 (`?folderId=` 선택) |
| POST | `/api/drive/delete` | 파일 삭제 |
| POST | `/api/drive/export/hospitals` | 병원 목록 스프레드시트 내보내기 (Sheets API) |

### 위키 (Phase 2-13)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/wiki/pages` | 페이지 목록 (`?parentId=` 필터 / `?refType=&refCode=` 역참조 / `?templates=1` 템플릿 목록). 삭제·템플릿 기본 제외 |
| POST | `/api/wiki/pages` | 페이지 생성 — USER+, 감사로그 CREATE, `plainText` 자동 |
| GET  | `/api/wiki/pages/[id]` | 페이지 상세 |
| PUT  | `/api/wiki/pages/[id]` | 페이지 수정 — USER+, 감사로그 UPDATE. 본문 변경 시 **버전 스냅샷(2분 throttle) + `plainText`/백링크 동기화**. `icon`/`coverUrl`/`coverOffsetY`/`isTemplate` 수정, `baseUpdatedAt`로 **충돌 감지(409)** |
| DELETE | `/api/wiki/pages/[id]` | 휴지통 이동(soft delete, 자식 동반). `?permanent=1` → 영구 삭제(+첨부 S3 정리) — USER+, 감사로그 DELETE |
| POST | `/api/wiki/pages/[id]/restore` | 휴지통에서 복구 (자식 동반, 부모 삭제 시 루트 승격) — USER+ |
| PATCH | `/api/wiki/pages/[id]/move` | 페이지 이동/정렬 — USER+, 순환 참조 차단. `{direction}` 형제 교환 / `{parentId}` 부모 변경(최하단) / `{parentId, position}` 특정 위치 삽입(형제 sortOrder 재부여) / `{sortOrder}` 직접 지정 |
| POST | `/api/wiki/pages/[id]/duplicate` | 페이지 복제 (`{includeChildren?}`) — USER+, 본문·태그·참조 복사, 감사로그 CREATE |
| GET  | `/api/wiki/tree` | 전체 위키 페이지 평면 리스트 |
| POST | `/api/wiki/upload?pageId=` | 첨부 업로드 (multipart, 최대 50MB) — USER+ |
| GET  | `/api/wiki/files/[id]` | 첨부 다운로드 (24h presigned URL로 307) |
| DELETE | `/api/wiki/files/[id]` | 첨부 삭제 — USER+ |
| GET  | `/api/wiki/pages/[id]/references` | 페이지의 병원/프로젝트 참조 목록 (라벨 enrich) |
| POST | `/api/wiki/pages/[id]/references` | 참조 추가 — USER+, 도메인 객체 존재 검증, 중복 시 409 |
| DELETE | `/api/wiki/pages/[id]/references/[refId]` | 참조 해제 — USER+ |
| GET  | `/api/wiki/tags` | 태그 목록 (`?q=` 검색) |
| POST | `/api/wiki/tags` | 태그 생성 (`{name, color?}`) — USER+ |
| PUT  | `/api/wiki/tags/[id]` | 태그 수정 — USER+ |
| DELETE | `/api/wiki/tags/[id]` | 태그 삭제 — USER+ |
| GET  | `/api/wiki/pages/[id]/tags` | 페이지의 태그 목록 |
| POST | `/api/wiki/pages/[id]/tags` | 태그 연결 (`{tagId}` 기존 또는 `{name}` 신규 자동 생성) — USER+ |
| DELETE | `/api/wiki/pages/[id]/tags?tagId=` | 태그 연결 해제 — USER+ |
| GET  | `/api/wiki/favorites` | 내 즐겨찾기 페이지 목록 |
| GET  | `/api/wiki/pages/[id]/favorite` | 현재 페이지 즐겨찾기 여부 |
| POST | `/api/wiki/pages/[id]/favorite` | 즐겨찾기 추가 |
| DELETE | `/api/wiki/pages/[id]/favorite` | 즐겨찾기 해제 |
| GET  | `/api/wiki/search` | 검색 (`?q=&tagId=`) — 제목 + plain_text ILIKE(trgm 가속), snippet 반환, 삭제/템플릿 제외. (페이지 `/wiki/search`는 작성자·기간 필터 추가) |
| GET  | `/api/wiki/notifications` | 내 알림 목록 + 미읽음 수 |
| PATCH | `/api/wiki/notifications` | 알림 읽음 처리 (`{ids?}` 없으면 전체) |
| GET  | `/api/wiki/pages/[id]/versions` | 페이지 버전 목록 |
| GET  | `/api/wiki/pages/[id]/versions/[versionId]` | 버전 상세 |
| POST | `/api/wiki/pages/[id]/versions/[versionId]` | 해당 버전으로 복원 — USER+, 감사로그 UPDATE |
| GET  | `/api/wiki/pages/[id]/comments` | 댓글 목록 |
| POST | `/api/wiki/pages/[id]/comments` | 댓글 등록 (`{body}`) — USER+ |
| PUT  | `/api/wiki/comments/[id]` | 댓글 수정 (본인 + ADMIN+) |
| DELETE | `/api/wiki/comments/[id]` | 댓글 삭제 (본인 + ADMIN+) |
| GET  | `/api/wiki/mention?q=` | @ mention 자동완성 — 병원/프로젝트 통합 검색 (타입별 5개) |

---

## 배포

### DEV 서버 반영

```bash
npm run build
pm2 restart thync-dev
```

### PROD 서버 반영

```bash
cd /home/ubuntu/thynC-Ops-System/thynC-Ops-PROD
git pull origin main
npm run build
pm2 restart thync-prod
```

> `npm run start`, `nohup`, `node` 등으로 직접 서버를 실행하지 마세요. 반드시 PM2를 사용합니다.

---

## Git 워크플로우

```
개발 (DEV) → git push → PROD에서 git pull → 빌드 → PM2 재시작
```

1. DEV 환경에서 개발 및 테스트
2. `git push origin main`
3. PROD 서버에서 `git pull` 후 빌드 및 재시작
