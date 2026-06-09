# thynC Operations System

thynC 구축 및 운영을 위한 내부 데이터 관리 시스템입니다.
병원 정보 관리, 프로젝트(구축 공사) 관리, 답사 관리, 유지보수 관리, 조직/사용자 권한 관리 기능을 제공합니다.

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| 프레임워크 | Next.js 14 (App Router) |
| 언어 | TypeScript |
| 스타일링 | Tailwind CSS |
| ORM | Prisma |
| 데이터베이스 | PostgreSQL |
| 인증 | JWT (httpOnly 쿠키, jose 라이브러리) |
| 파일 스토리지 | AWS S3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) |
| 차트 | Recharts |
| 아이콘 | lucide-react |
| 리치 텍스트 에디터 | Tiptap (`@tiptap/react` + 확장) — 기존 모듈용 |
| 블록 에디터 (위키) | BlockNote (`@blocknote/core`, `@blocknote/react`, `@blocknote/ariakit`) — 위키 전용 |
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
│   ├── dashboard/                    # 대시보드 (이번 주/다음 주 공사 현황)
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
│   │   ├── nav-menus/                # 네비게이션 메뉴 관리 CRUD (SUPER_ADMIN)
│   │   └── audit-logs/               # 감사 로그 조회 (SUPER_ADMIN)
│   ├── ai-assistant/                 # AI 어시스턴트 (Flowise 프록시 + 정제 + 상담이력 저장)
│   │   ├── summarize/                # AI 정제 (Anthropic Claude API)
│   │   └── consultation/             # 상담이력 저장 (ConsultationQueue)
│   ├── wiki/                         # 사내 위키
│   │   ├── pages/
│   │   │   ├── route.ts              # GET 목록 / POST 생성
│   │   │   └── [id]/
│   │   │       ├── route.ts          # GET / PUT / DELETE
│   │   │       └── move/route.ts     # PATCH 이동 (direction/parentId/sortOrder)
│   │   └── tree/route.ts             # GET 전체 트리
│   ├── install-plans/                # 설치계획(가안) CRUD
│   ├── hira-hospitals/
│   │   └── sync/                     # 심평원 연동 (POST: 백그라운드 시작, GET: 히스토리 목록)
│   │       └── [id]/                 # 연동 잡 상세 + 로그
│   └── drive/                        # Google Drive 연동 (파일 업로드/목록/삭제/병원목록 내보내기)
├── (대시보드)/                        # 메인 대시보드 (이번 주/다음 주 공사 현황)
├── hospitals/                        # 병원 목록·상세·등록·수정
├── hira-hospitals/                   # HIRA 병원 조회
├── install-plans/                    # 설치계획(가안) 목록·상세·등록
├── projects/                         # 프로젝트 목록·상세·등록
│   └── calendar/                     # 구축 일정 간트 캘린더 (새 탭)
├── site-visits/                      # 답사 목록·상세·등록
├── maintenances/                     # 유지보수 목록·상세·등록
├── tasks/                            # 업무(Task) 현황 (통합 조회)
├── ai-assistant/                     # AI 어시스턴트 채팅
├── wiki/                             # 사내 위키 (Phase 2-3)
│   ├── layout.tsx                    # 사이드바 + 콘텐츠 flex 레이아웃 (모든 /wiki/* 적용)
│   ├── page.tsx                      # 위키 홈 (최근 페이지 목록)
│   ├── new/page.tsx                  # 신규 페이지 작성 (?parentId= 쿼리로 하위 추가)
│   ├── [id]/page.tsx                 # 페이지 상세 (server, parent chain 수집)
│   ├── [id]/WikiPageView.tsx         # 상세 클라이언트 (breadcrumb + 편집 토글)
│   └── components/
│       ├── WikiEditor.tsx            # BlockNote 에디터 래퍼
│       └── WikiSidebar.tsx           # 페이지 트리 사이드바 (collapse/expand + ↑↓+)
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
│   ├── nav-menus/                    # 네비게이션 메뉴 관리 (SUPER_ADMIN 전용)
│   └── audit-logs/                   # 감사 로그 (SUPER_ADMIN 전용)
├── login/                            # 로그인 페이지
└── components/                       # 공통 컴포넌트 (Navigation, NavIcons, MainWrapper)

lib/
├── auth.ts                           # JWT 인증 유틸리티 + 역할 헬퍼
├── prisma.ts                         # Prisma 클라이언트
├── s3.ts                             # AWS S3 연동 유틸리티 (업로드/삭제/presigned URL)
├── googleDrive.ts                    # Google Drive 연동 유틸리티
├── gmail.ts                          # Gmail API 클라이언트 + 메일 파싱 유틸
├── mail-sync.ts                      # 설치계획·답사 메일 큐 동기화 로직 (Gmail → DB INSERT)
├── mail-scheduler.ts                 # 메일 동기화 인터벌 스케줄러 (mail-sync 함수 직접 호출)
├── audit.ts                          # 감사 로그 헬퍼 (logAudit, auditActorFromJWT, redact)
└── hospitalStatus.ts                 # 병원 thynC 현황상태 단방향 자동 진행 헬퍼 (advanceHospitalStatus)

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
- userId, workType(`PROJECT` / `INSTALL_PLAN` / `MAINTENANCE`), createdAt
- (userId, workType) 복합 UNIQUE — 한 사용자가 여러 풀에 동시 등록 가능
- `PROJECT` 풀은 프로젝트·답사에서 공유, `INSTALL_PLAN`/`MAINTENANCE`는 각 업무 전용

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
- 상태코드 연결, 방문일/요청일/회신일
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
- 장애유형(`typeId` → StatusCode MAINTENANCE_TYPE), 상태(`statusId` → StatusCode MAINTENANCE_STATUS)
- 우선순위(`priority`): 긴급/높음/보통/낮음 (기본값: 보통)
- 신고자(`reporterName`): 병원 측 텍스트
- 원격처리 여부(`isRemote`), 접수일(`reportedAt`), 방문일(`visitDate`), 완료일(`resolvedAt`)
- 증상(`symptoms`), 원인(`cause`): plain text
- 조치내용(`resolution`), 비고(`notes`): 리치 텍스트(Tiptap)
- 담당자 N:M (`MaintenanceAssignee`), 첨부파일 (`MaintenanceFile`, S3)
- Google Calendar 이벤트 ID (`calendarEventId`) — 유지보수 생성/수정/삭제 시 자동 동기화

### MaintenanceAssignee (유지보수 담당자)
- Maintenance ↔ User N:M 관계 테이블
- maintenanceId, userId, createdAt

### MaintenanceFile (유지보수 첨부파일)
- Maintenance에 첨부된 파일
- fileCategory, fileName, s3Key

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
- category: `HOSPITAL` / `SITE_VISIT` / `INTRO_TYPE` / `CONSULTATION_TYPE` / `DOCUMENT_TYPE` / `MAINTENANCE_TYPE` / `MAINTENANCE_STATUS`
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
- 프로젝트, 답사, 설치계획(가안), 유지보수를 통합 관리하는 TASK 테이블
- 고유 코드 `taskCode`: `TASK-YYYYMM-NNNNN` 형식 (월별 순번 통합 채번)
- `taskType`: `PROJECT` / `SITE_VISIT` / `INSTALL_PLAN` / `MAINTENANCE`
- `refCode`: 원본 테이블의 고유 코드 (projectCode / siteVisitCode / planCode / maintenanceCode)
- `hospitalCode` (FK→Hospital, nullable), `title`
- 기존 테이블은 변경 없이 유지, tasks는 참조용 통합 뷰

### ConsultationQueue (상담 대기열)
- AI 어시스턴트 상담이력 저장
- Hospital 연결 (hospitalCode, 선택), 상담유형(StatusCode CONSULTATION_TYPE), 문서유형(StatusCode DOCUMENT_TYPE)
- 결론(`conclusion`), 대화이력(`chatHistory`, JSONB), AI 정제 결과(`aiSummary`)
- 상태(`status`: PENDING 등), 상담자(`consultedById` → User)

### Wiki 모듈 — 별도 PostgreSQL 스키마 `wiki`
- 사내 위키(Notion-like) 기능. 본문은 BlockNote JSON 블록 배열로 저장
- 모든 위키 테이블은 `wiki.*` 스키마에 격리. FK 방향은 `wiki.* → public.*` 만 허용

#### WikiPage (위키 페이지)
- `id` (uuid), `parentId`(self-reference, 트리 구조), `title`, `slug` (선택)
- `contentJson` (JSONB, BlockNote 블록 배열), `isPublished`, `sortOrder`
- `authorId` → User, `lastEditorId` → User (nullable)
- 인덱스: `(parent_id, sort_order)`, `(updated_at DESC)`, `(author_id)`

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

### 대시보드
- 이번 주 / 다음 주 공사 예정 프로젝트 현황
- 공사 상태별 요약, 비고 인라인 수정
- **월별 누적 사용 현황**: 신규 병원/병상, 누적 병원/병상 추이 (Recharts 차트)
- **월별 신규 병원/병상 막대 차트** (ComposedChart)
- 캐시 미사용 (`force-dynamic`), 매 요청마다 DB 조회

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
  - 구축 프로젝트 + 유지보수 + 답사 업무 통합 표시
  - 바 색상: 프로젝트는 buildStatus.color, 유지보수는 장애유형 color, 답사는 답사 상태 color (좌측 보더 + 사선 패턴으로 구분)
  - 유지보수 바는 `visitDate`(방문일) 기준 1일짜리 단일 바로 표시. `visitDate` 미입력 건은 간트차트 미표시
  - 답사 바는 `visitDate`(방문일) 기준 1일짜리 단일 바
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
- 접수일 / 방문일 / 완료일 관리
- 증상·원인: plain textarea, 조치내용·비고: Tiptap 리치 텍스트
- 첨부파일 관리 (AWS S3 업로드, presigned URL 다운로드) — edit 모드에서만
- 목록 컬럼: 접수일 | 병원명 | 제목 | 장애유형 | 우선순위 | 상태 | 원격 | 담당자 | 방문일 | 완료일
- 목록 필터: 병원명 텍스트 검색, 장애유형/상태/우선순위 select
- 우선순위 색상 뱃지: 긴급(red) / 높음(amber) / 보통(blue) / 낮음(gray)
- 등록 시 상태 기본값: '접수'
- 병원 상세 페이지에 유지보수 카드 연동

### 소속 관리 (SUPER_ADMIN 전용)
- 소속(Organization) 추가·수정·삭제
- 인라인 수정, 순서 이동
- 유저가 있는 소속 삭제 방지 (409 반환)
- DAEWOONG 소속 영구 삭제 보호

### 사용자 관리
- 시스템 사용자 등록·수정·삭제 (ADMIN 이상)
- 소속 드롭다운 연결
- **SUPER_ADMIN의 타계정 수정**: 이름·연락처·역할·소속·부서·비밀번호 일괄 수정 (현재 비밀번호 확인 없이 변경 가능)
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
- **탭 3종**: 프로젝트 담당자 / 설치계획 담당자 / 유지보수 담당자
  - 프로젝트 담당자 풀은 프로젝트·답사 페이지에서 공유 사용
  - 설치계획·유지보수는 각 업무 전용 풀
  - 한 사용자가 여러 풀에 동시 등록 가능
- "+ 추가" 버튼으로 후보 검색 모달 열기 (이름/이메일 검색, 300ms debounce, 페이지네이션)
- 후보: SEERS 소속·활성·해당 풀 미등록 사용자만 표시
- 목록 테이블: 번호·이름·이메일·소속·부서·추가일·삭제

### 사내 위키 (Phase 2-7)
- Notion-like 블록 에디터(BlockNote) 기반 사내 위키
- 별도 PostgreSQL 스키마 `wiki`에 격리, 메인 모듈과 단방향 의존성 유지
- 페이지 단위 작성·조회·수정·삭제 (BlockNote JSON 본문)
- **계층 구조**: `parentId`로 무한 깊이 트리, 좌측 사이드바에서 접기/펼치기·형제 순서 변경(↑↓)·하위 페이지 추가(+)
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

### 병원
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/hospitals` | 병원 목록 |
| POST | `/api/hospitals` | 병원 등록 |
| GET  | `/api/hospitals/[code]` | 병원 상세 |
| PUT  | `/api/hospitals/[code]` | 병원 수정 |
| DELETE | `/api/hospitals/[code]` | 병원 삭제 |
| POST | `/api/hospitals/import` | Excel 일괄 가져오기 (`?preview=true` 미리보기) |
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
| GET  | `/api/settings/field-engineers` | 담당자 목록 (`?workType=PROJECT\|INSTALL_PLAN\|MAINTENANCE` 기본 PROJECT, `?search=&page=&limit=`, `?all=true` 전체 반환) |
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

### 위키 (Phase 2-7)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/wiki/pages` | 페이지 목록 (`?parentId=` 필터 또는 `?refType=&refCode=` 역참조 검색) |
| POST | `/api/wiki/pages` | 페이지 생성 — USER+, 감사로그 CREATE, `plainText` 자동 |
| GET  | `/api/wiki/pages/[id]` | 페이지 상세 |
| PUT  | `/api/wiki/pages/[id]` | 페이지 수정 — USER+, 감사로그 UPDATE, **본문 변경 시 직전 상태 자동 버전 스냅샷 + `plainText` 동기화** |
| DELETE | `/api/wiki/pages/[id]` | 페이지 삭제 (자식 + 첨부 S3 best-effort 정리) — USER+, 감사로그 DELETE |
| PATCH | `/api/wiki/pages/[id]/move` | 페이지 이동/정렬 — USER+, 순환 참조 차단 |
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
| GET  | `/api/wiki/search` | 검색 (`?q=&tagId=`) — 제목 + plain_text ILIKE, snippet 반환 |
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
