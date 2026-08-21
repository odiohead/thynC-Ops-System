# thynC Operations System

thynC 구축 및 운영을 위한 내부 데이터 관리 시스템입니다.
병원 정보 관리, 프로젝트(구축 공사) 관리, 답사 관리, 유지보수 관리, 조직/사용자 권한 관리 기능을 제공합니다.

> ## 운영관리시스템 1.0 — 2026-07-26 마감
>
> 계획했던 전 모듈이 개발·PROD 반영 완료되어 **1.0으로 마감**되었습니다.
> 포함 범위: 병원·프로젝트·답사·설치계획·유지보수·기타업무 / **티켓 시스템(P1~P13, 도메인 편입 5/5)** /
> 사내 위키(+협업 편집·HTML 문서·AI 청크 인덱스) / AI 어시스턴트 v3 + 상담이력 / 자재관리(WMS) /
> 차량예약·운행일지 / Slack 알림·SLA / GW 배치 플래너 / 전 화면 모바일 대응.
>
> 이후 작업은 1.0 유지보수(버그·운영 요청)와 **신규 설계 건**으로 구분해 처리합니다.
> 미착수 고도화 제안(`enhancement_analysis_202607.md`)은 1.0 범위 외이며, 필요 시 그 시점 데이터로 새로 설계합니다.

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
| 리치 텍스트 에디터 | Tiptap (`@tiptap/react` + 확장) — 기존 모듈 + 주간업무(/weekly, `@tiptap/extension-text-style` 색상·형광펜) |
| 블록 에디터 (위키) | BlockNote (`@blocknote/core`, `@blocknote/react`, `@blocknote/ariakit`, `@blocknote/xl-multi-column`) — 위키 전용 |
| 드래그앤드롭 (위키) | `@dnd-kit/core` — 위키 사이드바 트리 이동 전용 |
| 프로세스 관리 | PM2 |
| 웹서버 | Nginx |
| 마크다운 렌더링 | react-markdown + `@tailwindcss/typography` |
| AI 챗봇 | Flowise RAG (외부 API 연동) |
| AI 정제 | Anthropic Claude API (`@anthropic-ai/sdk`) |
| 이미지 처리 (GW 플래너) | sharp + poppler-utils(`pdftoppm`·`pdfinfo`, 시스템 패키지) |
| PPTX 생성 (GW 플래너) | pptxgenjs |
| DOCX 생성 (UDI 입출고대장) | jszip — 원본 양식 docx를 템플릿으로 열어 행 복제·텍스트 치환 (양식 100% 보존) |
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
│   │   └── [code]/system-info·servers·emr  # thynC 시스템 현황 — 서버 현황 CRUD + EMR 연동 정보 upsert (2026-08-16)
│   │   └── [code]/sales/             # 병원 영업 정보 — 통합 GET + profile/persons(전원·소속종료)/deals/activities (ADMIN+SEERS)
│   ├── hira-hospitals/               # HIRA 병원 데이터 조회
│   ├── projects/                     # 프로젝트 CRUD + 장비/파일 관리
│   ├── site-visits/                  # 답사 CRUD + 파일 업로드
│   ├── maintenances/                 # 유지보수 CRUD + 파일 관리
│   ├── tickets/                      # 티켓 CRUD + transition/assign/queue/participants/logs/parent + metrics(지표 집계)
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
│   │   ├── maintenance-status/       # 유지보수 상태 관리 (+티켓 상태 매핑)
│   │   ├── etc-task-status/          # 기타업무 상태 관리 (+티켓 상태 매핑)
│   │   ├── install-plan-status/      # 설치계획 상태 관리 (2026-07-27 단일 축 — +티켓 상태 매핑)
│   │   ├── sales-codes/              # 영업 StatusCode 3카테고리 CRUD (화이트리스트·색상, ADMIN)
│   │   ├── ticket-queues/            # Assignment Group 마스터 CRUD (티켓 있으면 삭제 400)
│   │   ├── ticket-cti/               # 티켓 분류(CTI) 3단 트리 CRUD + 기본 그룹 지정
│   │   ├── ticket-pending-reasons/   # 티켓 대기(PENDING) 사유 마스터 CRUD
│   │   ├── ticket-cti-rules/         # 티켓 자동생성 규칙 GET/PUT (업무별 CTI·Group·설명 자동입력, ADMIN)
│   │   ├── sla-policies/             # SLA 정책·타깃 CRUD + preview(영향 미리보기) — 1.1 P2, ADMIN
│   │   ├── notify-routes/            # 발송 채널·라우팅 규칙 CRUD + 연결 테스트 발송 — 1.1 P3, ADMIN
│   │   ├── item-category/            # 품목 분류 트리 CRUD (대>중>소 3단계)
│   │   ├── inventories/              # 인벤토리 마스터 CRUD (병원 연결 토글, 사용 중 삭제 409)
│   │   ├── stock-in-type/            # 입고 유형 CRUD (시스템 유형·사용 중 삭제 409)
│   │   ├── stock-out-type/           # 출고 유형 CRUD (시스템 유형·사용 중 삭제 409)
│   │   ├── manufacturers/            # 제조사 CRUD (사용 중 삭제 409)
│   │   ├── warehouses/               # 창고(위치) CRUD (인벤토리 귀속, 재고 잔존 409·이력 시 비활성화)
│   │   ├── inventory-managers/       # 재고 담당자 풀 CRUD + candidates
│   │   ├── app-roles/                # RBAC Lite 역할 CRUD + [id](수정·삭제)/permissions(권한 교체)/members(멤버 추가·회수) + candidates (SUPER_ADMIN)
│   │   ├── nav-menus/                # 네비게이션 메뉴 관리 CRUD (SUPER_ADMIN)
│   │   ├── notifications/            # Slack 알림 설정 GET/PUT (ADMIN — 토글·주기·DM·타입별 필드) + logs/ 발송 이력 조회
│   │   ├── ai-assistant/             # AI 어시스턴트 런타임 설정 GET/PUT (ADMIN — effort·캐시 TTL)
│   │   └── audit-logs/               # 감사 로그 조회 (SUPER_ADMIN)
│   ├── ai-assistant/                 # AI 어시스턴트 (에이전트 채팅 + 정제 + 세션 + 피드백)
│   │   ├── summarize/                # AI 정제 (Anthropic Claude API)
│   │   ├── sessions/                 # 대화 세션 목록·상세·삭제
│   │   └── feedback/                 # 답변 피드백 (👍/👎)
│   ├── consultations/                # 상담이력 CRUD (SEERS 전용 — 어시스턴트 상담 정리 산출물)
│   ├── wiki/                         # 사내 위키
│   │   ├── pages/
│   │   │   ├── route.ts              # GET 목록 / POST 생성
│   │   │   └── [id]/
│   │   │       ├── route.ts          # GET / PUT / DELETE
│   │   │       ├── move/route.ts     # PATCH 이동 (direction/parentId/position/sortOrder)
│   │   │       └── duplicate/route.ts # POST 복제 (단일/하위 포함)
│   │   ├── tree/route.ts             # GET 전체 트리 (+프로젝트 이슈노트 보호 정보)
│   │   └── project-issue-notes/      # 프로젝트 이슈노트 조회/생성 (프로젝트 상세 임베드용)
│   ├── gateway-planner/              # GW 배치 플래너 (ADMIN 이상)
│   │   └── jobs/                     # 잡 목록/업로드 + [id](상세·삭제)/scale(스케일 확정)/replace(재배치)/reanalyze/pptx
│   ├── vehicles/                     # 차량 마스터 CRUD (ADMIN 이상 쓰기)
│   ├── vehicle-reservations/         # 차량예약 CRUD (충돌 검사 + soft 취소)
│   │   └── [id]/return/              # 반납(POST: 주행거리 입력→운행일지 생성) / 반납취소(DELETE, ADMIN)
│   ├── vehicle-logs/                 # 운행일지 목록·작성 + [id] 조회/수정/삭제
│   ├── parking/                      # 주차 웹할인 — search/coupons/register (pweb.kr 대행, USER 이상)
│   ├── install-plans/                # 설치계획(가안) CRUD
│   ├── voc-receipts/                 # VOC접수 CRUD (등록 시 CS 마스터 티켓 자동 생성 — 단일 트랜잭션, 생성자 기록)
│   ├── voc-masters/                  # VOC 접수 채널 조회 (channels)
│   ├── etc-tasks/                    # 기타업무 CRUD + 파일 관리 (다병원·비유지보수 업무)
│   ├── inventory/                    # 자재관리(WMS)
│   │   ├── items/                    # 품목 마스터 route/[id](재고·부자재 포함)/import + [id]/components(주자재-부자재 매핑) + [id]/lot-history(LOT별 입출고 요약)
│   │   ├── transactions/            # 입출고 원장 route + [id](GET 상세·PUT 수정)/cancel + bulk(다품목 일괄) + bulk-serial(Excel 시리얼 일괄) + export(Excel)
│   │   ├── stocks/                   # 인벤토리·위치별 현재고 집계 + export(Excel)
│   │   ├── units/                    # 시리얼 개체 조회 + [id] 정정
│   │   ├── hospital-works/           # 출고 업무연결 후보
│   │   ├── ledger/                   # UDI 입출고대장 — route(모델 목록·대장) + check/(출고완료 체크) + docx/(문서 생성)
│   │   └── can-manage/               # 재고 처리 권한 여부 (UI 게이트)
│   ├── hira-hospitals/
│   │   ├── sync/                     # 심평원 연동 (POST: 백그라운드 시작, GET: 히스토리 목록)
│   │   │   └── [id]/                 # 연동 잡 상세 + 로그
│   │   └── detail-sync/              # 병원상세정보연동 (POST: 종별 선택 → 허가병상수 갱신, 백그라운드)
│   ├── weekly/                       # 주간업무 관리 (2026-08-19) — board(주차 통합)·items(+[id]/update)·notes(특이사항)·masters·can-access(진입 아이콘 게이트) (SEERS 소속 OR weekly.access 권한)
│   └── drive/                        # Google Drive 연동 (파일 업로드/목록/삭제/병원목록 내보내기)
├── (대시보드)/                        # 메인 대시보드 (이번 주/다음 주 공사 현황)
├── dashboard/                        # 사이니지 월보드 (50인치 상시 표시, 네비 없음)
├── hospitals/                        # 병원 목록·상세·등록·수정 ([code]/_components/SalesSection — 영업 정보 v3: 요약 스트립+탭 4개, ADMIN+SEERS)
├── hira-hospitals/                   # HIRA 병원 조회
├── install-plans/                    # 설치계획(가안) 목록·상세·등록
├── projects/                         # 프로젝트 목록·상세·등록
│   └── calendar/                     # 구축 일정 간트 캘린더 (새 탭)
├── site-visits/                      # 답사 목록·상세·등록
├── voc/                              # VOC 접수 — 목록·등록(new)·상세([id] — 하위 티켓 패널·처리 결과 Tiptap) (CS 워크플로)
├── maintenances/                     # 유지보수 목록·상세·등록
├── etc-tasks/                        # 기타업무 목록·상세·등록 (다병원·비유지보수 업무)
├── tickets/                          # 티켓 목록(Assignment Group 탭·저장된 뷰)·생성(CTI 3단)·상세(전이 액션·타임라인)·dashboard/(P12 지표)
│   └── components/                   # TicketStatusBadge·TicketSeverityBadge·TicketRefTypeBadge(유형 배지 단일 소스)·LinkedWorkBanner(연결 업무 배너)·TicketLogPanel·OwnerSelect
├── tasks/                            # 업무(Task) 현황 (통합 조회)
├── gateway-planner/                  # GW 배치 플래너 — 도면 업로드·잡 목록 + [id](진행 폴링·스케일 확정·2점 보정·배치 미리보기·PPTX)
├── vehicle-reservations/             # 차량예약 주간 현황 보드 + 예약/반납 모달 + 내 예약 + 운행일지 탭(VehicleLogsPanel)
│   └── logs/print/                   # 운행일지 인쇄 (A4 가로, 차량별 1장 — 네비 없는 전체 화면)
│   └── mobile/                       # 빠른 예약·반납 모바일 페이지 (가능 차량 실시간 검색 + 인라인 반납)
├── sales/                            # 영업현황 (ADMIN+SEERS) — dashboard/(대시보드 A·실적, 메인) + deals/(도입현황 — 엑셀 B~AK 표·등록 모달, [id] 딜 상세 편집) + dashboard_map/(지역별 도입현황 지도 — 7개 권역 SVG 지도+표+드릴다운) + page.tsx(→ dashboard 리다이렉트) + _components/SalesConceptTabs(탭 3개)
├── parking/                          # 주차 웹할인 등록 (차량 검색 → 계정별 할인권 → 등록, nav 미등록)
├── weekly/                           # 주간업무 관리 (사업본부 주간 리뷰 — nav 미등록·URL 직접 진입, SEERS) + _components/(ItemDetailModal·SearchSelect·AddItemRow·CellEditor·NotesSection·WeeklyRichEditor·RichContent — 진행내용·특이사항은 Tiptap 리치텍스트(색상·형광펜) HTML 저장)
├── ai-assistant/                     # AI 어시스턴트 채팅
├── wiki/                             # 사내 위키 (Phase 2-3)
│   ├── layout.tsx                    # 사이드바 + 콘텐츠 flex 레이아웃 (모든 /wiki/* 적용)
│   ├── page.tsx                      # 위키 홈 (최근 페이지 목록)
│   ├── new/page.tsx                  # 신규 페이지 작성 (?parentId= 쿼리로 하위 추가)
│   ├── [id]/page.tsx                 # 페이지 상세 (server, parent chain 수집, 페이지 타입 분기)
│   ├── [id]/WikiPageView.tsx         # 상세 클라이언트 (breadcrumb + 편집 토글)
│   ├── [id]/WikiHtmlPageView.tsx     # HTML 문서 페이지 뷰어 (sandbox iframe + 파일 교체/다운로드)
│   └── components/
│       ├── WikiEditor.tsx            # BlockNote 에디터 래퍼
│       ├── WikiSidebar.tsx           # 페이지 트리 사이드바 (collapse/expand + ↑↓+ + DnD 이동, 이슈노트 보호 컨트롤 숨김)
│       ├── ProjectIssueNotePanel.tsx # 프로젝트 상세 이슈노트 임베드 패널 (협업 편집, 메인→위키 import 승인 예외)
│       └── MovePageModal.tsx         # 페이지 이동 모달 (새 부모 트리 선택)
├── users/                            # 사용자 관리 (ADMIN 이상)
├── settings/
│   ├── _components/                  # StatusCodeManager · WorkflowStatusManager(워크플로 상태 + 티켓 상태 매핑 공용, 2026-07-27)
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
│   ├── maintenance-status/           # 유지보수 상태 관리 (WorkflowStatusManager)
│   ├── etc-task-status/              # 기타업무 상태 관리 (WorkflowStatusManager)
│   ├── voc-status/                   # VOC 상태 관리 (WorkflowStatusManager — 티켓 상태 매핑, CS 워크플로)
│   ├── voc-type/                     # VOC 분류 관리 (StatusCodeManager)
│   ├── emr-vendor/                   # EMR 업체 관리 (StatusCodeManager — 병원 EMR 연동 정보에서 선택, 2026-08-16)
│   ├── install-plan-status/          # 설치계획 상태 관리 (WorkflowStatusManager, 2026-07-27)
│   ├── sales-codes/                  # 영업 코드 관리 — 7카테고리 (단계·딜 상태·판매모델·세금계산서·정산·활동 유형·직군)
│   ├── ticket-queues/                # Assignment Group 관리 (이름·설명·순서·활성·티켓 수, 멤버 모달 팀(부서) 단위 일괄 선택)
│   ├── ticket-cti/                   # 티켓 분류(CTI) 관리 (Category/Type/Item 3컬럼 + Item 기본 Assignment Group 지정)
│   ├── ticket-pending-reasons/       # 티켓 대기 사유 관리
│   ├── ticket-cti-rules/             # 티켓 자동생성 규칙 (ADMIN — 업무 5종 통합, 목록 페이지 버튼과 같은 모달)
│   ├── item-category/                # 품목 분류 관리 (ADMIN 이상 — 대>중>소 계층 트리)
│   ├── inventories/                  # 인벤토리 관리 (ADMIN 이상 — 이름·병원 연결·활성·순서)
│   ├── stock-reasons/                # 입출고 유형 관리 (ADMIN 이상 — 입고/출고 2섹션, StatusCodeManager 공용 컴포넌트)
│   ├── manufacturers/                # 제조사 관리 (ADMIN 이상)
│   ├── warehouses/                   # 창고(위치) 관리 (ADMIN 이상 — 인벤토리별 섹션)
│   ├── inventory-managers/           # 재고 담당자 관리 (ADMIN 이상 — 담당자 풀)
│   ├── udi-ledger/                   # 입출고대장 문서 설정 (ADMIN 이상 — 문서번호·양식번호·개정이력)
│   ├── vehicles/                     # 차량 관리 (ADMIN 이상)
│   ├── roles/                        # 역할 관리 (SUPER_ADMIN 전용 — RBAC Lite 역할·권한·멤버 3구역)
│   ├── nav-menus/                    # 네비게이션 메뉴 관리 (SUPER_ADMIN 전용)
│   ├── notifications/                # 알림 설정 (ADMIN 이상) — 탭① SLA 기준(SlaMatrixTab) / 탭② 채널·라우팅(RoutesTab) / 탭③ 전역·DM·이력
│   ├── ai-assistant/                 # AI 어시스턴트 설정 (ADMIN 이상 — effort·캐시 TTL, 모델은 읽기 전용 표시)
│   └── audit-logs/                   # 감사 로그 (SUPER_ADMIN 전용)
├── inventory/                        # 자재 현황(인벤토리별 카드 섹션 + 섹션 입고/출고/이동 버튼) + [invId]/items/[itemId](인벤토리 자재 상세) + transactions/(이력·[id] 전표 상세) + items/(관리·[id] 품목 마스터 상세) + ledger/(UDI 입출고대장 — 모델별 조회·docx 출력) + components/TransactionModal(품목 선택 모드)·BulkTxModal(다품목 일괄 입출고)
├── login/                            # 로그인 페이지
├── notifications/                    # 알림함 (1.1 P5 — 목록·미읽음/종류 필터·일괄 읽음·개인 수신 설정)
└── components/                       # 공통 컴포넌트 (Navigation, NavIcons, MainWrapper, StatusBadge, NotificationBell, MyWorkPanel 등)
    ├── useOverlayDismiss.ts          # 오버레이(드로어·모달) 공통 훅 — 배경 스크롤 잠금 + ESC 닫기
    ├── theme/                        # ThemeProvider, ThemeToggle, useChartTheme (다크모드)
    └── ui/                           # 디자인 프리미티브 (Button, Card, Badge, Input, Table, Modal(모바일 바텀시트), PageHeader, EmptyState)

lib/
├── ai/                               # AI 어시스턴트 v2 (function_ai_assistant.html)
│   ├── agent.ts                      # 에이전트 루프 — claude-opus-5 스트리밍 + tool use 반복(최대 8회) + 롤링 캐시 브레이크포인트
│   ├── settings.ts                   # 모델 상수(채팅 opus-5 / 정리 sonnet-5) + 런타임 설정(effort·캐시 TTL, AppSetting)
│   ├── access.ts                     # 어시스턴트 접근 권한 — 자사(SEERS) 전용 서버 강제 (DB 실시간 소속 검사)
│   └── opsSearch.ts                  # 축2 운영 정보 전문 검색 — search_operation_history / find_similar_cases (상담이력 포함)
│   └── tools.ts                      # 도구 26종 (read-only Prisma SELECT — 병원·업무·집계·위키·상담이력 + 자재·티켓·차량·조직·GW 플래너)
├── consultation.ts                   # 상담이력 — 조회 권한(SEERS)·코드 발번(CS-YYYYMM-NNNN)·제목 추출
├── sales.ts                          # 영업/CRM v3 — 접근 권한(checkSalesAccess: ADMIN+SEERS)·딜 코드 발번(DEAL-YYYYMM-NNNN)·금액/날짜 파서·코드 3카테고리
├── salesTargets.ts                   # 영업 연도별·하반기 종별 목표 병상수 — AppSetting 키(period year/h2)·검증·조회·하반기 집계 시작일(8/1) (영업 대시보드 목표현황·하반기 탭)
├── weekly.ts                         # 주간업무 관리 — kind/status 상수·주차 유틸·API DTO 계약 (클라이언트 안전)
├── weeklyAccess.ts                   # 주간업무 접근 게이트 (checkWeeklyAccess: SEERS 소속 + 쓰기는 USER 이상)
├── parking.ts                        # 주차 웹할인 — pweb.kr 대행 클라이언트 (env 계정, 로그인→검색→할인권 조회→등록)
├── auth.ts                           # JWT 인증 유틸리티 + 역할 헬퍼
├── permissions.ts                    # RBAC Lite 권한 키 카탈로그 (단일 소스 — 라벨·모듈 그룹, 클라이언트 안전)
├── appRoles.ts                       # RBAC Lite 판정 헬퍼 (hasPermission·getUserPermissions — 60초 캐시·fail-closed)
├── prisma.ts                         # Prisma 클라이언트
├── s3.ts                             # AWS S3 연동 유틸리티 (업로드/삭제/presigned URL)
├── googleDrive.ts                    # Google Drive 연동 유틸리티
├── gmail.ts                          # Gmail API 클라이언트 + 메일 파싱 유틸
├── mail-sync.ts                      # 설치계획·답사 메일 큐 동기화 로직 (Gmail → DB INSERT)
├── mail-scheduler.ts                 # 메일 동기화 인터벌 스케줄러 (mail-sync 함수 직접 호출)
├── ticket-domains/                   # 티켓 도메인 어댑터 레지스트리 (CS 워크플로 P0 — cs_ticket_workflow_design.md §3)
│   ├── meta.ts                       # [클라 안전] 도메인 메타 단일 소스 (refType·라벨·경로·taskType·childCreate)
│   ├── types.ts / shared.ts          # 어댑터 계약 + 공용 헬퍼(상태 매핑 해석·규칙 폴백)
│   ├── registry.ts                   # 어댑터 조립 — syncTicketToDomain 디스패치·detailInclude 병합·linkedWork 조립
│   └── maintenance·etcTask·siteVisit·installPlan·project·voc.ts  # 도메인별 생성·양방향 동기화·배너
├── csCodes.ts                        # CS 코드 발번 (VOC-YYYYMM-NNNN, KST)
├── audit.ts                          # 감사 로그 헬퍼 (logAudit, auditActorFromJWT, redact)
├── hospitalStatus.ts                 # 병원 thynC 현황상태 단방향 자동 진행 헬퍼 (advanceHospitalStatus)
├── vehicleLog.ts                     # 운행일지 거리 재계산(recalcVehicleLogs) + 주행거리 무결성 검사(checkOdometerConsistency)
├── maintenanceVisit.ts               # 유지보수 방문일정 정규화(normalizeVisits) + 캘린더 페이로드(visitEventPayload) + ymd/visitKey — 기타업무 업무기간도 공유
├── etcTask.ts                        # 기타업무 캘린더 이벤트 페이로드(etcTaskVisitEventPayload)
├── ticketCtiRules.ts                 # 티켓 자동생성 규칙 해석 (업무별 CTI·Group·설명 자동입력 — 조건 행 > 기본 행 > 코드 폴백)
├── slack.ts                          # Slack Web API 전송 어댑터 (의존성0 fetch, 모드 라우팅 off/test/live, lookupByEmail)
├── notify.ts                         # 알림 정책·로그 레이어 (이벤트·상태변경·지연요약·enrich·dedup + notification_logs, best-effort)
├── notifyFields.ts                   # Slack 알림 메시지 필드 카탈로그·타입별 추천 기본값 (설정 페이지·notify 공유)
├── delay-rules.ts                    # 지연 업무 판정 (타입별 기준일·임계일수, findDelayedTasks — KST 기준·보류 제외)
├── notify-scheduler.ts               # 지연 감지 인터벌 스케줄러 (mail-scheduler 패턴, notify_delay_interval 제어)
├── sla.ts                            # SLA 시계 엔진 (1.1 P1 — 정책 매칭·시계 생성/갱신·정지/재개·달성/초과, 알림과 독립)
├── sla-alerts.ts                     # SLA 알림 발송 (1.1 P4 — 초과 즉시 알림 1회성 + 지정 시각 일일 요약)
├── notify-routes.ts                  # 채널 라우팅 매칭 (1.1 P3 — 이벤트×조건 → 채널 N개, 같은 채널 1건 합침)
├── notify-center.ts                  # 내부 알림 생성 단일 진입점 (1.1 P5 — emit·수신자 산출·dedup·개인 설정)
├── slaSettings.ts                    # SLA 설정 입력 검증·정규화·CTI 서브트리 확장 (1.1 P2)
├── inventory.ts                      # 자재관리 — 품목 채번(nextItemCode) + 재고 처리 권한(canManageStock: ADMIN or 재고 담당자 풀)
├── inventoryLot.ts                   # LOT 해석 단일 소스 — 전표/개체 이중 경로(resolveTxLotRows)·복수 LOT 행 분해·LOT 잔량(getLotStocks)·LOT 요약(summarizeLots)
├── itemUdi.ts                        # 품목 UDI 필드 부분 갱신·UDI-DI 검증(GTIN 체크디지트)·대장 표기명 폴백
├── udiLedger.ts                      # UDI 입출고대장 조립 — 문서 1부=모델 1종, 행은 UDI×LOT, 인벤토리 필터, MOVE·취소 제외
├── udiLedgerDocx.ts                  # 대장 docx 생성 — 원본 양식 템플릿 재사용(jszip, 행 복제·<w:t> 치환) + 문서 메타(AppSetting)
├── gateway-planner/                  # GW 배치 플래너 (function_gateway_planner.html)
│   ├── types.ts                      # 공용 타입 + 기본 배치 규칙
│   ├── rules.ts                      # 규칙 로드/저장 (AppSetting gw_planner_rules)
│   ├── vision.ts                     # 래스터화(pdftoppm)·정규화(sharp)·Claude Vision 타일 분석·병합
│   ├── scale.ts                      # 치수 판독 → 스케일 산출 (robust median)
│   ├── placement.ts                  # 결정론적 배치 엔진 (복도 중앙선 등간격·실별 개수)
│   ├── pptx.ts                       # PPTX 생성 (A4 가로, 점 개별 도형)
│   └── runner.ts                     # 백그라운드 파이프라인 러너 + 재배치
└── wiki/
    ├── blockText.ts                  # BlockNote 블록 → plain text 추출·페이지 링크 인덱싱
    ├── chunk.ts                      # 축1 위키 청크 인덱스 생성 (HTML h1~h4 / BlockNote heading 기준, 표 구조 보존)
    ├── chunk-scheduler.ts            # 청크 주기 갱신 스케줄러 (chunks_synced_at < updated_at 판정, 기본 10분)
    ├── htmlText.ts                   # HTML 문서 페이지 — sanitize(script 등 제거) + plain text·title 추출
    ├── wikiSchema.tsx                # BlockNote 커스텀 스키마 (콜아웃·구분선·페이지링크·mention·멀티컬럼)
    ├── projectIssueNote.ts           # 프로젝트 이슈노트 — 루트 카테고리 보장·보호 판정 (refType 'project_issue')
    └── hospitalNote.ts               # 병원 노트 — 루트 카테고리 보장·보호 판정·페이지 조회 (refType 'hospital_note')

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
- 허가 병상수 (`permSbdCnt`) + 상세정보 연동 시각 (`detailSyncedAt`) — 병원상세정보연동(`getEqpInfo2.8`)으로 갱신, 미연동 시 NULL

### Hospital (운영 병원)
- hospitalCode (고유 코드), HiraHospital과 연결 (hiraId)
- HIRA 병원명 / 운영상 병원명 구분
- 상태 (status), 좌표 정보 포함
- 도입형태: `HospitalIntroType` 조인 테이블로 다대다 연결 (복수 선택 가능)
- 도입 병상 수 (`intro_beds`), 최초 계약일 (`contractDate`)

### HospitalIntroType (병원 도입형태)
- Hospital ↔ StatusCode(INTRO_TYPE) N:M 조인 테이블
- 구축형 / 구독형 / 사용량비례형 등 다중 선택 가능

### HospitalServer / HospitalEmrInfo (thynC 시스템 현황 — 2026-08-16)
- **HospitalServer** (`hospital_servers`): 병원 서버 현황 1:N — 서버이름(필수)·병동정보·모니터링 URL·원격접속 URL·정렬. 병원 상세 카드에서 추가/인라인 수정/삭제 (USER 이상)
- **HospitalEmrInfo** (`hospital_emr_info`): 병원 EMR 연동 정보 1:1 — 연동상태(단일: ACK연동/EMR직접연동/개발중/미연동, 기본 미연동)·EMR 업체(`emrVendorId` → StatusCode **EMR_VENDOR**, 설정에서 리스트 관리)·데이터 연동 범위 TEXT[](복수: 환자정보조회/일일레포트/이벤트 심전도/생체신호)·연동방식 TEXT[](복수: API/HL7(TCP/IP)/SFTP)·메모. 선택지 단일 소스 `lib/hospitalSystem.ts`

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
- 공사 상태(`buildStatus`), 시작일/완료예정일, 교육일(`educationDate` — 영업/CRM v4에서 운영 축 귀속), 비고(`remark`)
- 이슈 노트: 위키 '프로젝트 이슈노트' 페이지로 관리 (`WikiPageReference` refType `project_issue`로 1:1 연결). `issueNote` 컬럼은 위키 전환 전 백업용 보존 (deprecated — UI 미사용)
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
- **상태 (`statusId` → StatusCode INSTALL_PLAN_STATUS, 2026-07-27 단일 축 전환)**: 접수 → 작성완료(회신대기) → 회신완료 + 보류. 신규 등록 기본 '접수', 메일큐 승격도 '접수'
- ~~`writeStatus`/`replyStatus`~~ — **deprecated** (2026-07-27 단일 상태 축 전환으로 동결·백업 보존, 앱 미사용). 백필: (완료,완료)→회신완료 / (완료,그 외)→작성완료 / 나머지→접수
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
- 증상(`symptoms`): plain text
- 조치 요약(`resolution`): 리치 텍스트(Tiptap) — 원인 포함 종결 요약 (구 원인 필드 내용은 상단에 병합됨)
- `cause`·`notes` 컬럼: **deprecated** — 2026-07-18 개편으로 원인은 `resolution`에 병합, 비고는 `MaintenanceLog`로 이관 (백업용 보존, 앱 미사용)
- 담당자 N:M (`MaintenanceAssignee`), 첨부파일 (`MaintenanceFile`, S3), 방문일정 1:N (`MaintenanceVisit`), 처리 기록 1:N (`MaintenanceLog`)
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

### MaintenanceLog (유지보수 처리 기록)
- Maintenance 1:N 진행 경과 타임라인 (구 비고 필드 대체) — 엔트리별 작성자·시각 자동 기록
- `maintenanceId`(FK Cascade), `authorId`(FK users, SetNull — NULL이면 구 비고 이관분), `content`(Tiptap HTML, 저장 시 sanitize), `createdAt`/`updatedAt`
- 인덱스 `(maintenanceId, createdAt DESC)`

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
- `startDate`/`endDate`(@db.Date), `calendarEventId`(항목별 Google Calendar 이벤트, env `GOOGLE_CALENDAR_ETC_TASK_ID` — **2026-08-04부터 유지보수 캘린더와 같은 ID 사용**), `sortOrder`
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

### InventoryItem UDI 필드 (2026-08-04)
- `udiDi`(UDI-DI, GS1 GTIN) · `ledgerName`(대장 표기 상품명) · `productClass`(완제품/반제품/원자재) · `materialNo`(원자재식별 NO) · `packUnit`(포장단위)
- **UDI는 품목 속성이다** — 같은 모델이라도 사양·포장 변경으로 UDI-DI가 바뀌면 **신규 품목으로 등록**해 재고·이력을 분리한다. 재고 버킷 PK가 `(item_id, warehouse_id, inventory_id, lot_no)`이므로 재고 차원이 곧 **UDI × LOT**이 된다
- 인벤토리별로 품목이 분리되어 같은 UDI가 복수 품목에 존재 → **UNIQUE 아님**(`udi_di IS NOT NULL` 부분 인덱스만)
- `udiDi`가 있는 품목만 입출고대장 생성 대상

### UdiLedgerCheck (입출고대장 출고완료 체크)
- 대장의 '동일 LOT NO 제품 출고완료' 칸 — **수동 체크** (자동 판정은 원본 수기 대장과 값이 어긋나 2026-08-04 사용자 결정으로 수동 확정)
- PK `(transactionId, lotNo)` — 한 입고 전표가 복수 LOT으로 분해될 수 있어 복합키. `checked`, `checkedById`(users SetNull), `checkedAt`

### BuildStatus (공사 상태)
- 공사 진행 상태 정의 (레이블, 색상)
- `ticketStatus` (TicketStatus?, 2026-07-27): 이 상태가 소속되는 **티켓 상태 매핑** — 프로젝트↔티켓 상태 동기화의 단일 소스 (구 라벨 문자열 앵커 매칭 대체, `ticket_status_map_design.md`)

### StatusCode (상태코드)
- 병원/답사/상담유형/문서유형/장애유형/유지보수상태 등 다용도 상태값 정의 (커스터마이징 가능, 색상 포함)
- category: `HOSPITAL` / `SITE_VISIT` / `INTRO_TYPE` / `CONSULTATION_TYPE` / `DOCUMENT_TYPE` / `MAINTENANCE_TYPE` / `MAINTENANCE_STATUS` / `ETC_TASK_STATUS` / `INSTALL_PLAN_STATUS`(2026-07-27 신설)
- value: 코드값 (String?, nullable) — 문서유형 등에서 내부 식별자로 사용
- **티켓 상태 매핑 (2026-07-27 — `ticket_status_map_design.md`)**: 워크플로 카테고리(SITE_VISIT·MAINTENANCE_STATUS·ETC_TASK_STATUS·INSTALL_PLAN_STATUS) 행에 `ticketStatus`(OPEN/IN_PROGRESS/PENDING/RESOLVED/CLOSED 5종 — ASSIGNED는 owner 유무로 엔진 자동 판정) + `ticketPendingReasonId`(PENDING 매핑의 대기 사유 — 답사 작성완료↔보류 구분) 부여. 도메인↔티켓 상태 동기화(`lib/ticketDomain.ts`)의 단일 소스이며, 컬럼 NULL이면 기존 하드코딩 폴백. 시드 `scripts/seed-ticket-status-map.sql`(NULL만 채움 — 운영자 변경 보존)

### Contractor (시공사)
- 시공사 코드, 이름, 연락처 등

### HiraSyncJob (심평원 연동 잡)
- 심평원 연동 실행 단위 (백그라운드 비동기 처리)
- 시작시간 (`startedAt`), 종료시간 (`endedAt`), 상태 (`status`: running/done/error), 연동건수 (`totalCount`)
- 잡 유형 (`jobType`: basis 병원목록 / detail 병원상세정보) — 목록·상세 연동은 동시에 하나만 실행 (공통 배타)

### HiraSyncLog (심평원 연동 로그)
- HiraSyncJob 1:N 관계
- 이벤트 타입 (`type`: init/group_start/group_api_done/group_db_done/group_progress/done/error)
- 메시지 (`message`), 추가 데이터 (`stats`, JSONB)

### NavMenuItem (네비게이션 메뉴 설정)
- 네비게이션 메뉴 항목별 표시 이름, 접근 권한, 노출 여부 관리
- `menuKey` (고유 식별자), `label` (표시 이름, 변경 가능), `href` (URL 경로)
- `iconKey` (아이콘 매핑 키), `parentKey` (상위 메뉴 키, NULL=최상위, `settings`=설정 하위)
- `allowedRoles` (TEXT[], 허용 역할 배열, 빈 배열=전체), `allowedOrgCodes` (TEXT[], 허용 소속 코드 배열, 빈 배열=전체)
- `allowedPermissions` (TEXT[], 2026-08-04 RBAC Lite — 빈 배열=권한 무관, 있으면 1개 이상 보유(또는 SUPER_ADMIN)해야 노출. 판정은 기존 역할·소속 조건에 AND 추가)
- `isActive` (활성/비활성 토글), `sortOrder` (정렬 순서)

### RBAC Lite — AppRole / AppRolePermission / AppUserRole (2026-08-04, `projects/rbac_design.md`)
- 기존 등급(`User.role` 4단계) **위에 얹는 가산 전용(additive-only)** 기능 역할 체계 — 역할은 권한을 더해줄 뿐 기존 접근을 빼앗지 않는다
- **AppRole** (`app_roles`): 직무 단위 역할 정의 — `code`(UNIQUE, 대문자 스네이크·생성 후 변경 불가), `name`, `description`, `isActive`, `sortOrder`
- **AppRolePermission** (`app_role_permissions`): 역할 ↔ 권한 키. UNIQUE `(roleId, permKey)` — **권한 키 카탈로그는 `lib/permissions.ts`가 단일 소스**(DB에는 키 문자열만, 카탈로그 밖 키는 판정 시 무시). 카탈로그 v1.2(2026-08-06): `inventory.manage`(재고 입출고 처리)·`inventory.admin`(자재 관리자 — manage 상위집합 + 품목 마스터·자재 기초 설정)·`vehicle.manage`(차량 마스터 관리)·`sales.access`(영업 정보 접근 — SEERS 소속 축은 불변)·`maintenance.admin`/`install_plan.admin`/`project.admin`/`site_visit.admin`/`etc_task.admin`(각 모듈 건 삭제 — 조회·생성·수정은 원래 USER 전원 개방이라 무관). 각 키에 `description`(적용 범위 설명 — 역할 관리 화면 표시)
- **AppUserRole** (`app_user_roles`): 사용자 ↔ 역할 N:M. UNIQUE `(userId, roleId)`, 양쪽 Cascade
- 판정은 `lib/appRoles.ts` `hasPermission(user, perm)` — SUPER_ADMIN 무조건 true, 활성 역할 권한 합집합, **60초 인메모리 캐시**(역할·멤버 변경 API에서 무효화), 실패 시 빈 집합(fail-closed). 권한은 JWT에 넣지 않고 DB 조회
- 등급과의 합성은 호출부 책임 — 파일럿(자재관리): `canManageStock` = ADMIN 이상 OR 풀 OR `inventory.manage`(가산) / `canEditTxMeta` = ADMIN 이상 AND (풀 OR `inventory.manage`)(자격 요건)
- **Phase 3 편입 (2026-08-04)**: 차량 마스터 쓰기(`/api/vehicles` 3게이트) = ADMIN OR (USER 이상 + `vehicle.manage`) / 영업 게이트(`checkSalesAccess` 등급 축) = ADMIN OR (USER 이상 + `sales.access`) — 신규 권한 경로는 `isUserOrAbove` 동반(VIEWER 읽기 전용 원칙). 티켓 담당 지정은 이미 USER 전원 개방이라 편입 보류. 컨벤션은 CLAUDE.md '기능 권한 — RBAC Lite' 참조
- **v1.2 편입 (2026-08-06)**: 자재 관리자 `canAdminInventory`(`lib/inventory.ts`) = ADMIN OR (USER 이상 + `inventory.admin`) — 품목 마스터 4라우트·자재 설정 5종(분류·인벤토리·입출고 유형·제조사·창고) 게이트 교체, `canManageStock`에 `inventory.admin` 상위집합 가산. 워크플로 5모듈(유지보수·설치계획·프로젝트·답사·기타업무) DELETE = ADMIN OR (USER 이상 + `<모듈>.admin`). 전표 사후 수정(`canEditTxMeta`)·재고 담당자 풀 관리·UDI 문서 메타는 ADMIN 등급 유지

### Task (통합 업무) — **폐기 (P10, 2026-07-24)**
- 티켓 시스템이 롤업 역할을 대체 — `/tasks`는 `/tickets`로 리다이렉트, `/api/tasks` 제거, nav 메뉴 비활성. **테이블은 이력 보존(561건 동결)** — 원본 모듈들의 Task 생성/동기화/삭제 코드 전부 제거(ConsultationQueue 선례). 잔존 참조 없음 — `lib/workItemReassign.ts`의 Task 미러 갱신도 P13에서 제거(연결 티켓 동기화로 대체)
- (구 형상) `taskCode` TASK-YYYYMM-NNNNN, `taskType` 5종, `refCode` 느슨 연결
- 기존 테이블은 변경 없이 유지, tasks는 참조용 통합 뷰

### AiChatSession / AiChatMessage (AI 어시스턴트 v2 대화)
- `AiChatSession`: 사용자별 대화 세션 — `userId`(→User, Cascade), `hospitalCode`(→Hospital, nullable — 선택 병원 컨텍스트), `title`(첫 질문 40자 자동), 인덱스 `(user_id, updated_at DESC)`
- `AiChatMessage`: 세션 1:N 메시지 — `role`(user|assistant), `content`(표시용 텍스트), `toolCalls`(JSONB — 도구 호출 기록 [{name,input,resultSummary}]), `usage`(JSONB — 토큰 사용량), 인덱스 `(session_id, created_at)`
- 세션 삭제 = hard delete (개인 대화), 계정 삭제 시 Cascade

### AiUsageLog (AI 사용량 원장 — 2026-07-20)
- AI 어시스턴트 답변 1건 = 원장 1행. **대화(세션/메시지) 삭제와 무관하게 사용량 집계 보존** — `/settings/ai-usage` 집계의 진실
- `userId`(→User, SetNull) + `userName`/`userEmail` **스냅샷**(계정 삭제 후에도 집계 표시), `sessionId`/`messageId`(FK 없이 ID만 보관 — 삭제 후에도 세션 수 집계, `messageId` UNIQUE 백필 중복 방지)
- `hospitalCode`(→Hospital, SetNull), `model`, `inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheWriteTokens`, `createdAt`
- 채팅 응답 저장 시 best-effort 기록(실패해도 채팅 유지), 기존 대화는 마이그레이션 `20260720230000`에서 백필
- 인덱스: `(created_at)`, `(user_id, created_at)`

### AiFeedback (어시스턴트 답변 피드백 — v3, 2026-07-25)
- 답변 1건당 1행(`message_id` UNIQUE, 재전송 시 갱신). `ai_usage_logs`와 같은 이유로 메시지·세션에 **FK를 걸지 않아** 대화를 삭제해도 피드백은 보존
- `verdict`(good|bad), `reason`(bad일 때만 — wrong|not_found|outdated|inappropriate), `comment`, `userId`(SetNull)+`userName` 스냅샷
- 답변의 `toolCalls`와 `messageId`로 조인해 **어느 축·어느 도구에서 실패했는지** 사후 분류. 벡터DB 도입 판단(`ai_assistant_v3_design.md` §6)의 입력
- 인덱스: `(created_at)`, `(verdict, reason)`

### WikiChunk (위키 청크 인덱스 — v3, `wiki` 스키마)
- 위키 본문을 헤딩 단위로 쪼갠 AI 검색용 인덱스. 검색·반환 단위를 문서에서 절로 내린다
- `pageId`(→WikiPage, Cascade), `ordinal`, **`headingPath`**("문서명 > 상위 > 하위" — 랭킹 가중치 겸 표시용), `text`, `charStart`/`charEnd`
- 분할: HTML은 h1~h4, BlockNote는 heading 블록 기준. 목표 1,200자·상한 2,000자, 200자 미만 절은 병합. **표는 `셀 | 셀` 줄로 보존**(평문 추출에서 표가 뭉개지던 문제 해소)
- 페이지 저장(생성·수정) 시 전량 재생성 — 실패해도 저장을 되돌리지 않는다(검색 가속 인덱스이지 원본이 아님). 백필: `scripts/backfill-wiki-chunks.mts`
- **주기 갱신 (2026-07-26)**: 본문 저장 주체가 협업 서버(Y.Doc)라 REST 훅만으로는 본문 편집이 누락된다. `wiki_pages.chunks_synced_at`을 두고 **`chunks_synced_at < updated_at`이면 재생성**하는 스케줄러(`lib/wiki/chunk-scheduler.ts`)가 AppSetting `wiki_chunk_interval`(off/5m/**10m 기본**/30m/1h) 주기로 돌며, 한 주기 최대 50페이지를 처리한다. 경로별 훅이 아니라 상태 비교라서 **새 저장 경로가 생겨도 누락되지 않는다**
- `chunks_synced_at` 갱신은 **raw SQL + `timezone('UTC', now())` 필수** — Prisma `update`를 쓰면 `@updatedAt`이 함께 올라 무한 재생성이 되고, JS `Date` 파라미터를 쓰면 KST 서버에서 9시간 앞선 값이 기록돼 이후 편집이 감지되지 않는다
- 현황: 109페이지 → 431청크 (API 규격서 68,772자 → 97청크)
- UNIQUE `(page_id, ordinal)` + `text`/`heading_path` trigram GIN

### Consultation (상담이력 — 2026-07-26)
- AI 어시스턴트 '상담이력 저장'의 **원본**. 구 방식(위키 '병원 노트' 마크다운 append)을 대체 — 상담이력은 문서가 아니라 운영 이벤트(v3 축2)이므로 DB가 원본이고, 위키 병원 노트는 '사람이 쓰는 특이사항 메모'로 역할 분리
- 고유 코드 `consultationCode`: `CS-YYYYMM-NNNN` (생성 시 자동 발번)
- 병원 연결 (`hospitalCode`, **필수**), 상담유형(StatusCode CONSULTATION_TYPE), 문서유형(StatusCode DOCUMENT_TYPE — 컬럼 유지·UI 미노출)
- `title`(본문 첫 줄에서 자동 추출, 60자), `content`(최종 본문 마크다운), `aiSummary`(AI 정제 원문 — 사람이 수정했을 때 비교용)
- `sessionId`: AiChatSession id를 **FK 없이 ID만 보관** — 대화를 삭제해도 상담이력은 보존 (`AiUsageLog` 선례)
- `consultedById` → User + `consultedByName` **스냅샷**(계정 삭제 후에도 목록 표시), `consultedAt`(DATE, 소급 입력 가능)
- 인덱스: `(hospital_code, consulted_at DESC)`, `(consulted_by_id, consulted_at DESC)`, `(consulted_at DESC)` + `content`/`title` trigram GIN(축2 전문 검색 가속)
- 권한: 조회 = SEERS 소속 + 활성(VIEWER 포함) / 생성 = SEERS + USER 이상(어시스턴트가 유일 경로) / 수정·삭제 = 본인 or ADMIN
- 설계: `consultation_history_design.md`

### ConsultationQueue (상담 대기열) — **동결 (2026-07-26)**
- v1 상담이력 대기열. `Consultation` 신설로 역할 종료 — **테이블은 이력 보존**, 앱은 병원 일괄 이전 시 hospitalCode 갱신만 수행
- (구 형상) hospitalCode·상담유형·문서유형·`conclusion`·`chatHistory`(JSONB)·`aiSummary`·`status`(PENDING)·`consultedById`

### 영업/CRM 모듈 (v4, 2026-07-29 — `projects/sales_crm_design.md`)

> 접근 권한: **(ADMIN 이상 또는 RBAC `sales.access` 권한) + SEERS 소속** (2026-07-30 관리자 개방 → 2026-08-04 RBAC Phase 3 가산 → **2026-08-07 열람/편집 분리** — 열람은 VIEWER도 권한 보유 시 가능, 편집(쓰기 API 8곳 `{ write: true }`)은 USER 등급 이상. `lib/sales.ts` `checkSalesAccess` 단일 소스, 소속은 DB 실시간 판정·모든 영업 API 재검증. nav 허용 역할은 메뉴 노출만 제어)
> v4 구도: **병원 축**(프로필·인적정보·도입현황 파생) / **차수 축**(딜 1행 = 1도입 건) + 운영 축 조인(공사·답사·교육일 — 저장 없음). 백오피스 중 정산·세금계산서는 차수 단위로 관리(사용자 결정)

#### HospitalSalesProfile (병원 영업 프로필 — 병원 축 헤더)
- 병원당 1행(upsert). `stageId`(**영업 단계** SALES_STAGE — 파이프라인 중심 축), `ownerId`(씨어스 영업담당, User), `totalBeds`/`totalWards`(병원 **전체** 병상·병동 — 침투율 분모, 수기), `salesMemo`
- 파생(저장 안 함): 도입 병상 = `hospitals.intro_beds`, 침투율 = 도입/전체, 누적 실판매액 = 계약완료 딜 합산

#### Person / PersonAffiliation (병원별 인적정보 — 전원(轉院) 이력)
- **Person** (인물 마스터, 병원 독립): `name`·`personGroupId`(직군 PERSON_GROUP)·`specialty`(진료과)·`phone`/`email`(개인 귀속)·`memo`·`isActive`
- **PersonAffiliation** (병원 소속 이력): `personId`(CASCADE)·`hospitalCode`·`title`(직책)·`department`·`isPrimary`(주요 인물)·`isCurrent`·`startedOn`/`endedOn`·`note` — 인덱스 `(hospitalCode, isCurrent)`·`(personId)`
- **전원 처리** = 액션 1회: 기존 소속 종료(isCurrent=false·endedOn) + 새 병원 소속 생성 — 이력 보존, 새 병원에서 과거 이력 표시(리드 신호)

#### SalesDeal (계약 이력 — 차수 축, 1행 = 1도입 건)
- `dealCode`(`DEAL-YYYYMM-NNNN` 자동 발번), `(hospitalCode, roundNo)` UNIQUE, `statusId`(SALES_DEAL_STATUS), `contractDate`
- 판매모델 2관점: `hospitalModelId`/`seersModelId` — 둘 다 **SALES_MODEL 단일 마스터**(설정 제어, 차수별 상이 = 병원 내 혼재 허용)
- 도입규모: `wardsText`(도입병동, 콤마 다중)/`deptsText`(도입진료과)·`wardCount`/`bedCount`(계약 스냅샷)
- 금액 3종(BIGINT 원): `amountProduct`(제품가)/`amountConstruction`(공사비)/`amountActual`(실판매액) — **'판매' 합계 = 제품+공사 파생 표시**
- 정산: `taxInvoiceId`(SALES_TAX_INVOICE)/`settlementId`(SALES_SETTLEMENT), `projectCode`(선택 연결, UNIQUE), `remark`
- 보강 컬럼 (2026-07-31): `warrantyText`(보증기간)·`firstContactDate`(최초 인입일)
- **대웅 축 (2026-07-31 — 원천: `thynC_status_DW.xlsx` 대웅 원장 232행 + 구파일 보강, 씨어스 금액과 분리)**: `daewoongClientCode`(거래처코드, 재동기화 키)·`daewoongCountType`(병원/추가/로컬/이슈)·`daewoongOrderStatus`(완료/미완료)·`daewoongModelKind`/`daewoongModel`(판매모델)·`daewoongDeviceCount`·`daewoongAmountTotal`(계약금액 총견적가)·`daewoongBuildDate`(공사일)·`daewoongAmountProduct/Construction/Actual/Service`(금액 4종)·`daewoongTaxInvoice`/`daewoongSettlement`(원문 텍스트)·`daewoongPriceType`·`daewoongDivision/Office/Manager/Phone`(영업조직). **/sales 원장·대시보드·AI 도구 금액 지표는 대웅 필드 기준 표시** — 씨어스 금액 필드(amountProduct/Construction/Actual·taxInvoiceId·settlementId)는 수기 입력용

#### SalesDealDevice (딜별 도입 기기 수량 — 2026-07-31)
- SalesDeal ↔ DeviceInfo N:M + `quantity` — 계약 스냅샷 (운영 실측은 ProjectDevice와 별개)
- `(dealId, deviceInfoId)` UNIQUE, 딜 삭제 시 CASCADE. 수량 0은 행 미저장 — 기기 마스터가 늘어나면 기존 딜 상세에 0으로 표시
- 딜 상세(`/sales/deals/[id]`) '규모·계약'에서 입력, PUT에 `devices` 배열이 온 경우에만 전체 교체(미전송 PUT은 보존)

#### SalesActivity (영업 활동)
- `activityDate`·`activityTypeId`(SALES_ACTIVITY_TYPE)·`content`(sanitize된 리치텍스트)·`authorId`·`dealId`(선택)

#### 영업 StatusCode 카테고리 (7종 — `/settings/sales-codes`)
- `SALES_STAGE`(단계 7종, 색상)·`SALES_DEAL_STATUS`(딜 상태 3종, 색상)·`SALES_MODEL`(판매모델 4종)·`SALES_TAX_INVOICE`(3종)·`SALES_SETTLEMENT`(3종)·`SALES_ACTIVITY_TYPE`(5종)·`PERSON_GROUP`(직군 7종)
- 시드: `scripts/seed-sales-masters.sql` (idempotent — 코드 27행 + nav 2행: `/settings/sales-codes`·`/sales`)

### WeeklyItem / WeeklyItemUpdate / WeeklyWeekNote (주간업무 관리 — 2026-08-19, `projects/weekly_ops_design.md`)
- **WeeklyItem** (`weekly_items`): 사업본부 주간 리뷰 관리 항목(지속 레코드) — kind(`PROJECT`=주요 안건/`ISSUE`=주요 이슈)·title·detail(설명)·status(`진행`/`보류`)·bizType(`thynC`/`mobiCARE`/`공통` — 코드 상수 `lib/weekly.ts`)·병원/담당 팀(departments)/담당 FK(선택, SET NULL)·targetDate·`completedWeek`(**완료 여부 단일 소스** — 완료 주차 월요일 DATE, NULL이면 미완료)·completedAt·sortOrder·createdBy. 구 project_code 연결은 2026-08-19 1차 검토에서 제거(`20260819171543_weekly_items_revise`)
- **WeeklyItemUpdate** (`weekly_item_updates`): 항목×주차별 진행 기록 — `UNIQUE(item_id, week_start)` 주차당 1건 upsert, content TEXT, 항목 삭제 시 CASCADE
- **WeeklyWeekNote** (`weekly_week_notes`): 주간 특이사항 — 주차별 N건 자유 기재 엔트리 (week_start INDEX, created_by/updated_by — 2026-08-19 1차 검토에서 주차당 1건 메모에서 개정)
- 티켓 파이프라인 미편입(경영 리뷰 레이어) — ticket_status 매핑·어댑터 비대상

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
- **`inventoryId`(소속 인벤토리 — Phase 10, 필수·변경 불가)**: 같은 물건도 인벤토리마다 별도 품목·별도 코드로 등록 (완전 독립 관리)
- `name`, **`modelName`(모델명 — 제조사 모델 식별자, 규격과 별개)**, 분류(`categoryId` → InventoryCategory 트리), 제조사(`manufacturerId` → StatusCode `MANUFACTURER`), `spec`(규격), `unit`(단위, 기본 EA)
- `isSerialManaged`(시리얼 개체 추적 여부), `isLotManaged`(LOT 추적 — **시리얼 품목**: 신규 입고 시 개체별 LOT 필수 / **비시리얼 품목**: 전표 단위 `lot_no` 선택 기록). **시리얼 여부만 이력 생기면 변경 409 잠금** — LOT 여부는 이력이 있어도 변경 가능(2026-07-20, 기존 재고·전표 LOT는 빈 값 유지·이후 입출고부터 적용). `deviceInfoId`(자사 기기 ↔ DeviceInfo 선택 FK). ~~`tags`~~ — deprecated(2026-07-20, 태그는 개체 `InventoryUnit.tags`로 이관·백업 보존)
- `refPrice`(참고 단가, nullable), `memo`, `isActive`, `sortOrder`
- 이력 있는 품목 삭제 → 비활성화 전환 (이력 보존)
- 인덱스: `(category_id)`, `(inventory_id)`

#### Inventory (인벤토리 마스터 — Phase 9·10)
- 재고를 나누는 인벤토리 단위. 시드 3행: **대웅제약재고 / 평가용재고 / 판매용재고**
- `name`(UNIQUE), **`linkHospital`**(true면 출고 시 병원·업무 연결 허용 — 대웅제약재고만), `memo`, `isActive`, `sortOrder`
- ~~`isTransferLocked`~~ — Phase 10에서 이관(TRANSFER) 폐지와 함께 컬럼 삭제
- 사용 중(품목·위치·재고·전표·개체) 삭제 409 → 비활성화 사용. `/settings/inventories`에서 편집

#### InventoryItemComponent (주자재-부자재 매핑 — Phase 9)
- 주자재(모) 품목 아래 부자재(자식) 품목 N개 매핑. 복합 PK `(parentItemId, childItemId)`
- `quantity`(주자재 1개당 구성 수량, `CHECK > 0`), `sortOrder`. **1단계 깊이만 허용**(부자재는 주자재가 될 수 없음 — API 검증). **같은 인벤토리 품목끼리만 매핑 가능**(Phase 10, API 409)
- 출고 시 세트출고 옵션으로 비시리얼 부자재 자동 동시 출고

#### Warehouse (위치/창고 마스터)
- 자재 보관 위치. **`inventoryId`(소속 인벤토리 — Phase 10, 필수)**: 인벤토리별로 독립 추가/삭제
- `name`(UNIQUE는 인벤토리 내에서만 — `(inventory_id, name)`), `memo`, `isActive`, `sortOrder`
- 불량품 보관은 별도 상태가 아니라 '불량/수리 대기' 같은 위치로 표현

#### InventoryManager (재고 담당자 풀)
- 재고 입출고·이동·취소 처리 권한 담당자. **FieldEngineer(업무 담당자)와 별개 직무**
- `userId`(→ User, UNIQUE). ADMIN 이상은 풀 미등록이어도 처리 가능

#### 재고 차원 — 인벤토리별 완전 독립 (Phase 10 재설계)
- **품목·위치가 인벤토리에 귀속**되어 인벤토리(대웅제약/평가용/판매용)별로 자재관리가 완전 분리 — 같은 물건도 인벤토리마다 별도 품목 코드
- 전표 유형 3종: `IN`/`OUT`/`MOVE`(같은 인벤토리 내 위치 이동). **`TRANSFER`(이관)는 Phase 10에서 폐지** — 과거 전표만 이력 표시(취소 불가), 인벤토리 간 이동은 출고+입고로 처리
- 전표의 인벤토리는 품목에서 파생(입력값 아님), 위치도 같은 인벤토리 소속 검증(400)
- 입고/출고 유형은 StatusCode `STOCK_IN_TYPE`(구매·회수(반품)`RETURN`·기타)/`STOCK_OUT_TYPE`(설치·판매·폐기`DISPOSE`·불량`DISPOSE`·기타)으로 마스터화 — `/settings/stock-reasons`에서 추가·삭제(시스템 유형·사용 중 유형은 삭제 409)

#### InventoryStock (현재고 스냅샷)
- 품목×위치×**LOT**별 현재고. 복합 PK `(itemId, warehouseId, inventoryId, lotNo)` (`inventoryId`는 품목 소속과 동일 — 비정규화, `lotNo` ''=LOT 없음 — 2026-07-20 A안), `quantity`(DB `CHECK >= 0`), `updatedAt`
- 시리얼 품목·비LOT 품목은 항상 '' 버킷(시리얼의 LOT는 개체 단위 추적), **비시리얼 LOT 품목만 실값 LOT 버킷** 사용
- 전표 처리와 같은 트랜잭션에서 버킷 단위 증감 — 재고 수량의 진실

#### InventoryTransaction (입출고 원장)
- append-only 전표. `txCode`(`STK-YYYYMM-NNNN`, 동시 채번 P2002 재시도), `txType`(IN/OUT/MOVE — TRANSFER는 과거 전표만), `reasonId`(→ StatusCode 입출고 유형, MOVE는 NULL), `itemId`, `warehouseId`(출발/입고처), `toWarehouseId`(MOVE 도착), `inventoryId`(= 품목 소속, 비정규화), `quantity`(`CHECK > 0`), **`txDate`(입출고일 DATE — 업무 기준일, 소급 등록 지원, 기간 필터 기준. 2026-07-20)**, `requester`(요청자 자유 텍스트 — OUT 필수). 메타 필드는 ADMIN이 사후 수정 가능(유형은 같은 동작 부류만)
- deprecated 컬럼(과거 TRANSFER 표시용 보존): `toInventoryId`, `transferDate`, `transferPrice`
- OUT 부가정보(선택): **`destination`(출고처 자유 텍스트)**, `hospitalCode`, `workType`(PROJECT/MAINTENANCE/ETC), `refCode`
- **`parentTxId`**(세트출고 — 부자재 자식 전표가 주자재 전표 참조. 부모 취소 시 자식 일괄 취소)
- `actorId`, `canceledAt`/`canceledById`(취소 마킹). 인덱스: `(item_id, created_at)`, `(hospital_code)`, `(work_type, ref_code)`, `(created_at)`, `(inventory_id, created_at)`, `(parent_tx_id)`

#### InventoryUnit / InventoryTransactionUnit (시리얼 개체)
- `InventoryUnit`: 시리얼 품목 개체. `itemId`+`serialNo`(UNIQUE — 품목이 인벤토리 귀속이라 시리얼도 자동 격리), `status`(IN_STOCK/OUT/DISPOSED), `warehouseId`(재고 시 위치), `inventoryId`(= 품목 소속, 비정규화), `hospitalCode`(출고 설치처), **`tags`(TEXT[] — 개체 단위 자유 태그, 최대 10개, 2026-07-20)**, `memo`. 태그·메모는 `PATCH /api/inventory/units/[id]`로 정정(처리 권한자). 인덱스 `(item_id, status)`, `(hospital_code)`, `(inventory_id)`
- 갱신은 조건부 updateMany + 건수 검증 (동시 요청 이중 출고 차단)
- `InventoryTransactionUnit`: 전표↔개체 조인(개체 이력 산출). 복합 PK `(transactionId, unitId)`

### GatewayPlanJob (게이트웨이 배치 플래너 잡 — `function_gateway_planner.html`)
- 도면 분석 잡 단위. `status`: PENDING → RASTERIZING → ANALYZING → NEED_SCALE(사용자 스케일 확정 대기) → PLACED / ERROR
- 원본·정규화 이미지·PPTX S3 키(`gateway-planner/{jobId}/…`), 이미지 크기(원본/vision)
- 스케일: `scaleMPerPx`(m/px, vision 좌표 기준), `scaleSource`(ai_dimension/manual_2point/none), `scaleMeta`(AI 치수 후보·2점 보정 입력)
- `analysis`(JSONB — 공간 인식 spaces[]), `placements`(JSONB — 배치 points[]·skipped·notes), `gatewayCount`, `rulesSnapshot`, `tokenUsage`
- `createdBy` → User. 인덱스 `(created_by, created_at DESC)`, `(created_at DESC)`
- 배치 규칙은 AppSetting `gw_planner_rules` (커버리지 직경·복도 간격 계수·병실 개수·제외 공간 등)

### 티켓 시스템 (P1~P13 완료 — `ticket_dev_schedule.md`·`ticket_system_design.md` §2)
- AWS SIM식 티켓 레이어 — 티켓=공통 워크플로 껍데기, 도메인 레코드=구조화 본문(1:1). 전역 결정: `ticket_system_design.md` §2
- **Ticket** (`tickets`): `ticketCode`(TK-YYYYMM-NNNNN, UNIQUE) · `status`(하드 enum `ticket_status`: OPEN/ASSIGNED/IN_PROGRESS/PENDING/RESOLVED/CLOSED — 전이표 코드 강제, `lib/ticket-shared.ts` 단일 소스) · `severity`(enum `ticket_severity`: SEV1~SEV5, 기본 SEV4) · `queueId`(필수) · `ctiId`(DB nullable·API 필수) · `ownerId`(단일 책임자, NULL=그룹 대기) · `pendingReasonId`+`pendingNote` · `hospitalCode?` · `statusChangedAt`/`resolvedAt`/`closedAt`/`reopenCount`/`dueAt`(SLA — 생성일+Sev별 목표, PROJECT는 완료예정일) · 인덱스 (queue,status)/(owner,status)/(severity)/(statusChangedAt)/(hospitalCode)
- Ticket 추가 필드: `parentId`(self-FK — **마스터-서브 2레벨 고정**, 마스터는 열린 서브 있으면 해결/종결 불가, 연결/해제는 양쪽 타임라인 link 이벤트) · `refType`(도메인 연결 유형: MAINTENANCE, NULL=순수 티켓)
- **답사·설치계획·프로젝트 편입 (P7~P9, 2026-07-24)**: 각 `ticketId`(1:1) — 답사(상태 5종 매핑, 작성완료→Pending 회신대기, Gmail 대기열 승격도 티켓 생성), 설치계획(2축 write/reply 매핑, mail-queue 승격 포함), 프로젝트(BuildStatus 라벨 앵커 매핑, dueAt=완료예정일, CTI 영업/신규도입/구축). refType 'SITE_VISIT'·'INSTALL_PLAN'·'PROJECT'. 백필 104+72+243건(`scripts/backfill-*-tickets.mts`). **도메인 편입 5/5 완료**
- **기타업무 편입 (P6, 2026-07-24)**: `etc_tasks.ticketId`(1:1) — 존속 편입(방문일정·캘린더는 도메인 잔류), CTI 내부/기타업무/일반→내부운영 그룹, 상태 체계는 유지보수와 동일 매핑, 병원은 첫 연결분→ticket.hospitalCode. 백필 29건(`scripts/backfill-etc-task-tickets.mts`). refType 'ETC'. 역할 구분: 일정·병원 연결 필요하면 기타업무, 아니면 순수 티켓
- **유지보수 편입 (P5, 2026-07-24)**: `maintenances.ticketId`(1:1 FK) — 유지보수 생성 시 티켓 동시 생성(Assignment Group '유지보수', 장애유형→CTI 고객지원/장애/*, 우선순위→Sev), 상태·담당 **양방향 동기화**(`lib/ticketDomain.ts`, 매핑: 접수↔OPEN/ASSIGNED·처리중↔IN_PROGRESS·보류↔PENDING·완료↔RESOLVED/CLOSED), 처리 기록은 티켓 타임라인으로 일원화(기존 30건 이관·maintenance_logs 보존), Slack은 P11부터 티켓 파이프라인 단일 발송. 백필 219건 완료(`scripts/backfill-maintenance-tickets.mts`)
- **TicketQueue** (`ticket_queues`): **Assignment Group** 마스터 — AWS SIM의 assigned/resolver group에 대응하는 배정 그룹(기능 단위, 런타임 관리). **UI 표기는 'Assignment Group'**, 테이블·API 경로는 `ticket_queues`/`ticket-queues` 유지(2026-07-26 명칭 변경)
- **TicketQueueMember** (`ticket_queue_members`): Assignment Group 멤버 N:M (담당자 선택 시 그룹 멤버 우선 노출, 비멤버 배정도 허용). 설정 멤버 모달은 팀(부서)별 그룹핑 + 팀 헤더 체크박스로 일괄 추가/해제 (2026-08-06 — 데이터는 개인 단위 유지, 팀 스냅샷 방식)
- **TicketCti** (`ticket_cti`): 3단계 분류 트리(parent_id 자기참조, level 1~3 CHECK) + `defaultQueueId`(CTI→Assignment Group 자동 라우팅, Item 레벨에 지정)
- **TicketParticipant** (`ticket_participants`): 참여자 N:M (owner와 별개)
- **TicketLog** (`ticket_logs`): 단일 타임라인 — `logType` comment(사람, Tiptap HTML)/status_change·assign·queue_transfer·sev_change 등 시스템 이벤트(`payload` JSONB). 프로세스 지표 원천 겸용
- **TicketPendingReason** (`ticket_pending_reasons`): PENDING 사유 마스터
- **TicketDomainCtiRule** (`ticket_domain_cti_rules`, 2026-07-26 — `ticket_cti_rule_design.md`): 도메인 업무 → 티켓 자동생성 시 붙는 **CTI·Assignment Group·설명 자동입력**을 코드 하드코딩에서 DB로 이관
  - `refType`(SITE_VISIT/INSTALL_PLAN/PROJECT/ETC/MAINTENANCE) × `matchStatusCodeId`(NULL=업무 기본, 값=유지보수 장애유형별) → `ctiId`(**ON DELETE RESTRICT** — 규칙에 물린 CTI 삭제 차단의 DB 근거) + `queueId`(NULL=CTI 기본 그룹) + `fillDescription`
  - 해석 순서: 조건 행 > 기본 행 > **기존 하드코딩 폴백**(시드 유실·신규 환경에서도 티켓 생성 실패 없음). Group은 `규칙 → CTI 기본 → 이름 폴백`
  - CTI는 **level 3(Item)만** 지정 가능·비활성 CTI 금지(API 검증). UNIQUE `(ref_type, match_status_code_id)` + 부분 UNIQUE `(ref_type) WHERE match_status_code_id IS NULL`
  - **규칙 변경은 소급 적용하지 않는다** — 기존 티켓 CTI 백필 없음(SLA 정책과 동일 원칙). 유지보수만 장애유형 변경 시 CTI 재동기화 유지
  - 유지보수 장애유형 매칭이 **이름 문자열 → status_code_id(FK)** 로 바뀌면서, 유형 이름 변경 시 조용히 '기타'로 떨어지던 결함 해소
  - 시드 `scripts/seed-ticket-cti-rules.sql`(9행, idempotent·이름 조회 기반) — 배포 직후 동작이 이전과 동일
- **도메인↔티켓 상태 매핑 (2026-07-27 — `ticket_status_map_design.md`)**: 도메인 상태코드(`status_codes.ticket_status`+`ticket_pending_reason_id`)·BuildStatus(`build_statuses.ticket_status`)가 소속 티켓 상태를 명시 선언 — 하드코딩 switch·라벨 문자열 매칭 대체. 순방향은 매핑 컬럼 우선(+하드코딩 폴백, OPEN 계열은 owner로 ASSIGNED 자동 판정), 역방향은 keep-if-consistent → PENDING 사유 일치 → order 최소(RESOLVED·CLOSED 같은 버킷, 버킷 부재 시 no-op). 설정 4페이지+build-status에서 매핑 관리(신규 상태는 매핑 필수), 변경은 비소급. 시드 `scripts/seed-ticket-status-map.sql`
- 초기 마스터 시드: `scripts/seed-ticket-masters.sql` (재실행 안전 — Assignment Group 4종·CTI 3 Category·사유 5종·nav 메뉴 4행. PROD 최초 반영 시 실행)
- Slack 알림 (P11, 2026-07-24): **티켓 이벤트 단일 파이프라인** — 모든 업무 알림이 티켓 mutation(생성/상태·그룹 변경/배정/Sev 에스컬레이션)에서 발생, 도메인 라우트 직접 발송 폐지. sig v2 4축 비교로 실변경만 발송. Sev1=@channel·Sev2=🔥+그룹 멤버 멘션, 배정 시 owner DM(`notify_assign_dm`). 상태 표기는 영문(Open~Closed)
- SLA (P11): `dueAt = 생성일 + Sev별 목표일`(`notify_sla_rules` 기본 SEV1:1/SEV2:1/SEV3:3/SEV4:7/SEV5:미적용, PROJECT는 완료예정일 유지) — 스케줄러가 초과/임박(D-N)/상태 체류를 지연 채널 요약 + SLA 초과 owner DM. PENDING은 SLA 시계 정지. RESOLVED는 `ticket_auto_close_days`(기본 0=끔) 경과 시 자동 CLOSED(타임라인 이벤트만). 백필: `scripts/backfill-ticket-dueat.sql`

### CS 워크플로 — VOC접수 (2026-08-15 — `projects/cs_ticket_workflow_design.md`, 콜기록지는 같은 날 사용자 결정으로 제거)
- **도메인 어댑터 레지스트리 (P0)**: 구 `lib/ticketDomain.ts`(~1,150줄)의 도메인별 블록을 `lib/ticket-domains/` 어댑터로 분리 — `meta.ts`(클라이언트 안전 단일 소스: 라벨·경로·taskType·statusCategory·childCreate) + `registry.ts`(어댑터 조립·`syncTicketToDomain` 디스패치·`domainDetailIncludes`·`buildTicketLinkedWork`) + 도메인당 1파일. `ticketDomain.ts`는 재-export 파사드(기존 import 경로 호환). **신규 도메인 편입 = 어댑터 1파일 + 레지스트리 등록 + 마스터 시드** (SOP: 설계문서 §3.4). 티켓 상세 배너(`linkedWork`)는 서버(어댑터)가 조립 — 클라이언트는 refType 지식 없음
- **VocReceipt** (`voc_receipts`): CS 사건의 원본 도메인 레코드 (6번째 도메인, refType `VOC`) — `vocCode`(VOC-YYYYMM-NNNN) · 병원(nullable+`hospitalNameRaw`) · 고객명/연락처 · 채널(`VOC_CHANNEL`) · 분류(`VOC_TYPE`, 규칙 조건 축) · 상태(`VOC_STATUS` — 접수→OPEN/처리중→IN_PROGRESS/보류→PENDING/회신완료→**RESOLVED**(자동 종결 배치 대상)/종결→CLOSED 매핑) · `resolution`(Tiptap) · **생성자(`createdById`)** · `ticketId`(1:1). **담당 배정은 티켓이 단독 소유** (2026-08-15 개정 — 담당자 N:M 없음, 도메인→티켓 동기화도 owner 미접촉). **연결 티켓 = CS 마스터 티켓** — 하위 도메인 티켓(P3)의 parentId 대상. Assignment Group 'CS' + CTI 고객지원>VOC>일반 (규칙 시드)
- **하위 티켓 생성 (P3)**: 마스터 티켓·VOC 상세의 '서브/하위 티켓 생성' 드롭다운 — 순수 티켓(`/tickets/new?parentId=`) + `childCreate` 선언 도메인(유지보수 `/maintenances/new?parentTicketId=` — POST가 같은 트랜잭션에서 parentId 연결+link 이벤트)
- 마스터 시드: `scripts/seed-cs-masters.sql` (idempotent — 상태코드 3카테고리·CS 그룹·CTI·VOC 규칙·nav 3행). 스모크: `scripts/cs-workflow-smoke.mts`

### SLA 시계 엔진 (1.1 P1 — `projects/notification_v1.1_design.md` §4)

- 1.0의 단일 시계(`dueAt = 생성일 + Sev별 목표일`)를 **정책 × 타깃 × 시계** 3계층으로 재설계. 티켓 1건이 metric별 여러 시계를 동시에 갖는다
- **SlaPolicy** (`sla_policies`): "어떤 티켓에 적용되나" — `priority`(낮을수록 우선, **매칭되면 1개만 승리·병합 없음**), 스코프 `refTypes[]`/`queueIds[]`/`ctiIds[]`(서브트리 상속)/`severities[]`(빈 배열=전체), `clockType`(CALENDAR_24H — 영업시간 시계는 1.1 범위 외)
- **SlaTarget** (`sla_targets`): "무엇을 몇 분 안에" — `metric`(ASSIGN·FIRST_RESPONSE·RESOLVE·UPDATE_STALE·DWELL·DOMAIN_DUE), `statusScope`(DWELL 전용), `severity`(NULL=전 Sev 공통), `thresholdMin`(분 단일 단위), `warnRatio`(임박 예고 %). UNIQUE `(policy, metric, statusScope, severity)`
- **TicketSlaClock** (`ticket_sla_clocks`): 티켓별 실측 인스턴스 — `startedAt`/`dueAt`/`pausedMs`, `state`(RUNNING·PAUSED·MET·BREACHED·CANCELED), `satisfiedAt`/`breachedAt`, **`notifiedBreachAt`**(즉시 알림 1회성 보장 + quiet 백필 마킹 겸용). UNIQUE `(ticket, metric, statusScope)` + 초과 스캔 전용 부분 인덱스(`state='RUNNING' AND notified_breach_at IS NULL`)
- metric 성격: `UPDATE_STALE`은 활동 발생 시 **리셋**(달성 아님) / `DWELL`은 상태 이탈 시 종료 / `DOMAIN_DUE`는 도메인 필드가 기한 소유(PROJECT=완료예정일·SITE_VISIT=방문일·INSTALL_PLAN=회신일, **코드 고정 매핑**)
- **PENDING은 시계 정지**(`pausedMs` 누적 후 기한 이월). 정책 변경은 진행 중 시계를 소급 변경하지 않고, 목표가 늘어 기한이 미래가 되면 초과가 해소된다(유령 위험 방지)
- `tickets.due_at`은 대표 시계(DOMAIN_DUE > RESOLVE)의 **캐시로 유지** — 목록·상세·기존 지표 무영향. 캐시 쓰기는 raw SQL이며 **ISO 문자열 + `timestamptz AT TIME ZONE 'UTC'` 캐스팅 필수**(JS Date 파라미터는 KST로 직렬화돼 9시간 어긋남)
- 시드 `scripts/seed-ticket-masters.sql`과 별개로 `scripts/seed-sla-policies.sql`(폴백 정책 = 1.0 값 이관 + PROJECT 정책), 백필 `scripts/backfill-sla-clocks.mts`(**quiet 기본** — 과거 초과분 알림 억제), 스모크 `scripts/sla-smoke.mts`(31케이스)

### Slack 채널 라우팅 (1.1 P3 — `projects/notification_v1.1_design.md` §5.1)

- 1.0은 채널이 env 상수(`SLACK_CHANNEL_MAIN`/`DELAY`)에 고정돼 유형별 분리가 불가능했다. 1.1은 **채널·규칙을 DB로** 옮겨 런타임 관리
- **NotifyChannel** (`notify_channels`): `name`(UNIQUE)·`slackChannelId`·활성·순서. 설정 화면에서 **연결 테스트 발송** 가능
- **NotifyRoute** (`notify_routes`): `eventType`(TICKET_CREATED·TICKET_STATUS_CHANGED·TICKET_QUEUE_TRANSFERRED·SEV_ESCALATED·SLA_BREACH·SLA_WARNING·DAILY_DIGEST) × 조건(`refTypes`/`queueIds`/`ctiIds`(서브트리)/`severities`/`statusTo`(전이 후 상태)/`metrics`) → `channelId`. `mentionMode`(none·queue_members·here·channel), **`digestHour`**(KST 0~23)·`digestOpts`(포함 섹션·그룹 기준·섹션 상한)
- 매칭 의미론은 SLA 정책과 동일(축 간 AND, 배열 내부 OR, 빈 배열=전체)이나 **매칭된 규칙을 전부 실행**한다(다중 채널). 같은 채널 중복은 1건으로 합치고 멘션은 강한 쪽 채택. 규칙 0건이면 미발송 + `no_route` 스킵 로그
- 시드 `scripts/seed-notify-routes.sql` — 기존 env 채널을 규칙 6행(등록·상태변경·그룹이관·Sev상향·일일요약 09:00·초과 즉시)으로 재현해 **배포 직후 동작이 1.0과 동일**

### SLA 알림 발송 (v2 재편 — 초과·임박·전역 요약)

- **초과 즉시 알림**: tick(기본 5분)마다 기한 지난 시계를 BREACHED로 확정하고, `notified_breach_at`이 NULL인 건만 발송 후 마킹 → **1회성 보장 + 재시작·미스 캐치업**. tick당 상한 `notify_breach_tick_cap`(기본 20)
- **발송 채널 (v2 P3)**: **정책별 채널(`sla_policies.notify_channel_id`) 우선**, 없으면 `SLA_BREACH`/`SLA_WARNING` 라우팅 규칙 폴백
- **임박(WARNING) 알림 (v2 P3 신규 배선)**: `warnRatio`(기본 80%) 경과 시점 1회 발송(`notified_warn_at` 마킹) — 1.1에서 상수·컬럼만 있고 발송 코드가 없던 결함 해소
- **전역 일일 요약 (v2 P4)**: 구 규칙별 DAILY_DIGEST를 폐기하고 **AppSetting `notify_digest_hour`(KST) + `notify_digest_channel_id` 전역 1건**으로 단순화. KST 당일 발송 로그(payload.digestRouteId=0)로 하루 1회 보장. 본문은 초과·임박 × Assignment Group 섹션
- **스케줄러**: `notify_tick_interval`(off·1m·5m·10m·15m, 기본 5m) — 설정 저장 시 재시작 없이 즉시 반영. Slack off여도 초과 확정·내부 알림은 진행(v2 F4 — 채널 발송만 mode_off 스킵)

### 시스템 내부 알림 (1.1 P5 — `projects/notification_v1.1_design.md` §6)

- **알림의 원본을 DB로**: 1.0은 "알림 = Slack 발송"이라 시스템 안에 사용자가 볼 알림이 없었다. 1.1은 티켓 이벤트 → `notifications` 적재 → Slack은 그 중 일부를 내보내는 어댑터. **Slack이 꺼져 있어도 내부 알림은 남는다**
- **Notification** (`notifications`): `userId`·`kind`·`title`·`body`·`link`(앱 내부 경로)·`ticketId`(**FK 없이 ID만** — 티켓 삭제 후에도 이력 보존)·`refType`/`refCode`/`severity`·`actorId`+`actorName`(스냅샷)·`dedupKey`(부분 UNIQUE)·`readAt`
- **NotificationPref** (`notification_prefs`): `(userId, kind)` PK, `inApp`/`slackDm`. **행이 없으면 코드 기본값**(계정마다 미리 만들지 않는다)
- kind 6종: `TICKET_ASSIGNED`·`TICKET_UNASSIGNED_IN_MY_QUEUE`(내 그룹 미배정 유입)·`TICKET_STATUS_CHANGED`·`TICKET_COMMENT`·`SLA_WARNING`·`SLA_BREACH`
- 수신자 규칙: owner + 참여자, **owner가 없으면 Assignment Group 멤버로 폴백**(그룹 대기 티켓의 알림이 사라지지 않게). **본인 행동은 제외**(actor == 수신자면 스킵 — 전 호출부에 `actorId` 전달)
- UI: 전역 벨(`app/components/NotificationBell.tsx` — 데스크톱 사이드바·모바일 헤더, 60초 폴링) + `/notifications` 알림함 + 개인 수신 설정. **위키 알림은 HTTP로 합산 표시**(`/api/wiki/notifications`) — 테이블 통합 없이 모듈 경계(규칙 #7·#8) 유지
- 향후 페이저 앱은 이 테이블을 소스로 푸시한다(설계 §12)

### 첫 화면 개인화 — My Work (1.1 P6 — §7)

- `app/page.tsx` 최상단 `MyWorkPanel` — 기존 전사 KPI는 그대로 아래 유지
- 타일 4종(내 티켓 / **SLA 초과**(적색) / SLA 임박(앰버) / 내 그룹 미배정) → 클릭 시 필터된 `/tickets`로 이동
- **SLA 위험 목록**(최대 5건, metric별 초과·임박 라벨) + 최근 알림 5건
- 데이터는 `GET /api/me/dashboard` **1콜**. `hasWork=false`(담당 티켓·그룹 멤버십·SLA 위험 전부 없음)면 **블록 자체를 렌더하지 않는다** — 0건 카드 나열은 소음
- 티켓 목록에 **SLA 필터**(초과·임박), 티켓 상세에 **SLA 시계 패널**(metric별 기한·잔여/초과·정지 누적·적용 정책)

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
- `id` (uuid), `pageId` → WikiPage, `refType` (`hospital` | `project` | `project_issue`), `refCode`, `createdById` → User
- UNIQUE `(pageId, refType, refCode)` + `(refType, refCode)` 역검색 인덱스
- `project_issue`는 프로젝트↔이슈노트 페이지 1:1 시스템 연결 (참조 패널 미노출, 수동 추가 불가, 복제 시 미복사)

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
- `aiExcluded` (BOOLEAN DEFAULT false) — AI 어시스턴트 검색 제외 플래그. true면 이 페이지 **및 하위 전체**가 `search_wiki`/`read_wiki_page`/`read_hospital_note` 대상에서 제외(조회 시 재귀 CTE로 cascade 계산 — `lib/wiki/aiExclusion.ts`). ADMIN이 `PATCH /api/wiki/pages/[id]/ai-exclude`로 토글(위키 페이지 메뉴/버튼)

#### WikiPage HTML 문서 페이지 (2026-07-18)
- `pageType` (VARCHAR(10) NOT NULL DEFAULT 'block') — `'block'`(BlockNote) | `'html'`(HTML 문서)
- `contentHtml` (TEXT, nullable) — HTML 문서 페이지의 원본 HTML (저장 시 sanitize: script·인라인 이벤트·javascript: URL·iframe 제거, 최대 2MB)
- HTML 페이지도 저장 시 `plainText` 추출 → 기존 검색·AI 어시스턴트 지식소스에 자동 포함
- 렌더링은 sandbox iframe(스크립트 실행 차단), 편집은 파일 재업로드 방식(버전 스냅샷 미지원)

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
- **목록 페이지 카드 뷰**: 병원/프로젝트/설치계획/답사/유지보수/기타업무/**티켓**/업무현황/계정 목록이 md(768px) 미만에서 테이블 대신 카드 리스트로 표시 (핵심 필드 + 상태 뱃지, 탭하면 상세 이동). 메인 대시보드 공사현황도 카드 전환(비고 인라인 수정 유지)
- **네비게이션**: 모바일 상단 헤더 + 슬라이드 드로어 (배경 스크롤 잠금, ESC/백드롭 닫기)
- **모달**: `ui/Modal`은 모바일에서 바텀시트로 전환. 폼(유지보수·답사·기타업무·티켓)은 모바일 1컬럼 스택
- **위키**: lg 미만에서 사이드바가 오프캔버스 드로어로 전환 (좌하단 플로팅 버튼)
- **간트차트·차량보드**: min-width 기반 가로 스크롤, 모바일 헤더 높이 보정(dvh)
- **티켓 (2026-07-26)**: 목록 = 모바일 카드(티켓번호·Sev·유형·상태 배지 + 그룹/담당/병원/경과, SEV1·2 좌측 액센트 유지) + 그룹 탭 가로 스크롤 + 필터 셀렉트 2열 · 상세 = 전이 버튼 전폭 분할·연결 업무 배너 CTA 전폭·서브 티켓 카드 전환 · 생성 = 병원 검색이 공통 `ui/Modal`(바텀시트) · 대시보드 = 필터 2열, Sev/유형 차트 세로 스택, 표는 min-width 가로 스크롤
- **AI 어시스턴트 (2026-07-26)**: 모바일 헤더 압축(제목 축소·설명 숨김·버튼 라벨 단축), 병원 검색 입력 전폭, 답변 버블 폭 확대(94%), 대화 목록 드로어에 `useOverlayDismiss` 적용, **hover 없는 터치에서 접근 불가였던 대화 삭제 버튼 상시 노출**, 피드백(👍/👎)·정제 버튼 터치 타겟 확대
- 공통 오버레이 동작은 `useOverlayDismiss` 훅으로 통일

### 대시보드 (2026-07-20 개편 — 첫 화면 정보 밀도 강화)
- **KPI 스탯 타일 6종** (최상단): 도입 병원(+검토중) / 도입 병상(+이번달 신규) / 유지보수 진행중(긴급 포함 시 빨강 강조) / 이번주 구축 / 차주 구축 예정 / 누적 도입률(전국 HIRA 모수 대비) — 타일 클릭 시 관련 페이지 이동
- **2단 메인 그리드**: 좌(2/3) 이번주·차주 thynC 구축 현황(공사 상태별 요약 + **비고 인라인 수정** 유지), 우(1/3) **유지보수 진행중 최신 7건**(우선순위 점·상태 뱃지·상세 링크) + **종별 도입 현황**(도입/전국 미니 진행바, 검토중 병기)
- **월별 도입 추이**: 단일 축 소형 차트 4개(누적 병원·누적 병상 라인 / 월별 신규 병원·병상 막대 — 이중 축 제거, 병원=파랑·병상=초록 색상 고정) + 월별 표(토글) + 엑셀 다운로드. 신규 병상은 완료 프로젝트(차수)별 `bedCount`를 **완료일(endDateExpected)의 당월**에 집계(2026-07-20 실시간 전환 — 구 기준은 완료 익월), 신규 병원은 병원별 최초 완료 프로젝트의 완료월에 1회만 집계(2차·3차 도입은 병상만 가산)
- 다크모드 대응, 캐시 미사용 (`force-dynamic`), 매 요청마다 DB 조회 (기존 `/api/dashboard/*` 5종 재사용 — 신규 API 없음)
- 우측 상단 **'사이니지 월보드' 진입 버튼** — `/dashboard`를 새 탭으로 오픈 (2026-07-21, 사이니지 월보드의 유일한 UI 진입 경로)

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
- 병원 상세 → 답사 관리 카드 + 설치계획(가안) 관리 카드 + 유지보수 카드 + 구축 프로젝트 카드 + 사용 자재 카드 + **상담이력 카드**(SEERS 전용) + 병원 노트 순으로 표시 (각 카드에서 해당 병원 데이터 직접 조회, 행 클릭 상세 이동, ADMIN 이상 등록 버튼 제공)
- 운영 병원 등록·수정·삭제
  - 등록: 병원명+상태만으로 즉시 등록, HIRA 연결은 선택
  - 수정: HIRA 병원 연결 변경·해제 지원
- 병원별 대웅 담당자(DAEWOONG 소속 User) 복수 선택 배정·해제 (DaewoongSelectModal 체크박스 방식)
- 병원별 장비 관리
- 시도/시군구/상태 필터, 페이지네이션 — 병원종·상태 필터는 표 상단 **체크박스 상시 노출** (2026-07-21, 구 멀티선택 드롭다운 대체. 선택 시 즉시 적용 + 초기화 버튼)
- **전체 병상수 표기** (2026-08-10): 목록 '전체병상' 컬럼(모바일 카드 포함)·상세 기본 정보 '전체 병상수 (심평원)' — `hira_hospitals.perm_sbd_cnt` 조인 표시, 병원상세정보연동 미실행 병원은 '-'
- **Excel 일괄 가져오기** (ADMIN 이상): `병원명`, `도입형태`, `도입병상 수` 컬럼 기준 일괄 교체
  - 미리보기(preview) 모드 지원
  - 같은 병원명 여러 행 → 도입형태 병합, 도입병상 수 합산
- **병원 목록 Google Sheets 내보내기**: Drive Sheets API로 스프레드시트 직접 생성
- **엑셀 다운로드** (2026-08-04, 로그인 사용자 전체): `GET /api/hospitals/export` — 페이지네이션 없이 조건에 맞는 전체를 xlsx로 생성. 12컬럼(병원코드·병원명·HIRA 병원명·종별·상태·시도·시군구·주소·도입형태·도입 병상수·계약일·등록일), 정렬은 목록과 동일(등록 최신순)
  - **대상 선택 모달**: 버튼 클릭 → 병원종·상태 체크박스 모달(전체선택·해제 지원). 목록에 걸린 병원종·상태가 초기 선택값으로 들어오고, 검색어·시도 필터는 그대로 함께 적용됨(모달 상단에 표시)
  - **병원종·상태 최소 1개 필수** — 병원 테이블에 HIRA 전수(약 8만건, 미계약 79,458)가 들어 있어 무필터 전량은 45MB·약 4초·피크 힙 247MB. **서버(400)와 UI 양쪽에서 강제**한다. 건수 상한은 두지 않음(종별 '의원' 37,763건 등 정당한 필터도 큼) — 대신 1만 건 초과 시 모달에 경고 표시
  - **선택 즉시 대상 건수 미리보기**: 같은 엔드포인트에 `countOnly=1`로 조회(디바운스 250ms·이전 요청 abort). 0건이면 다운로드 버튼 비활성
- **업무 병원 재지정(매핑 정정)** (ADMIN 이상): 프로젝트/답사/설치계획/유지보수 상세의 "병원 재지정" 버튼으로 잘못 지정된 병원을 올바른 병원으로 이전. 한 트랜잭션으로 업무 hospitalCode + **연결 티켓(병원·제목) 동기화**(P13 — Task 미러 갱신은 폐기), 두 병원 현황 상태 자동 재계산(옛 병원 하향 포함), 프로젝트는 이름의 병원명도 선택 변경. 감사로그 기록
- **병원 업무 일괄 이전** (SUPER_ADMIN): 병원 상세의 "업무 일괄 이전" 버튼으로 한 병원의 모든 업무(프로젝트·답사·설치계획·유지보수·상담)를 다른 병원으로 한 번에 이전(병원을 통째로 잘못 만든 경우 정리용). **연결 티켓·순수 티켓도 함께 이전**(P13 — [답사]/[설치계획] 제목의 병원명 갱신 포함)

### 병원 영업 정보 (영업/CRM v4, 2026-07-29 — ADMIN 이상 + SEERS 전용)
- 병원 상세 '영업 정보' 단일 카드 — 권한 통과 시에만 렌더(서버 컴포넌트 게이트 + API 재검증)
- **요약 스트립(항상 표시)**: 영업 단계 배지(색상)·담당 영업·전체 병상·도입 병상(자동)·침투율(자동)·누적 실판매액·최근 활동
- **탭 4개**: 개요 / 인적정보 / 영업 활동 / 계약 이력 — **빈 상태에도 필드 그리드·컬럼 헤더가 상시 노출**
  - 개요: 단계·담당·전체 병상/병동·도입 병상(자동)·침투율(자동)·메모 (수정 토글 시 같은 그리드가 인라인 폼 전환)
  - 인적정보: 이름·직군·직책·부서·진료과·전화·이메일 테이블 + 인물 등록 인라인 폼. 행 액션 **수정 / 전원(병원 검색 모달 — 이력 보존) / 소속종료 / 삭제**, 타 병원 이력 보유 시 '이력' 뱃지(툴팁), 과거 인물 접힘 목록(재직기간·현재 병원)
  - 영업 활동: 최신순 타임라인(일자·유형·작성자·딜 연결) + 리치텍스트 작성 폼
  - 계약 이력: 차수·상태·판매모델(병원/씨어스)·계약일·도입병동·병동·병상·제품가·공사비·판매(파생)·실판매액·세금계산서·정산·프로젝트 테이블 + 합계 행(계약완료 기준) + 등록/수정 모달(규모·계약/금액·정산 2단)
- 설정: `/settings/sales-codes`(영업 코드 7카테고리) — nav '설정 > 영업' 그룹

### 영업현황 (`/sales/dashboard`·`/sales/deals`·`/sales/dashboard_map`, 영업/CRM v4 — ADMIN 이상 + SEERS 전용)
- nav '영업 현황(개발중)' → **메인 화면은 대시보드(`/sales/dashboard`, 구 대시보드 A)**, 탭 3개 구성: `대시보드` | `도입현황` | `대시보드(지도)`. `/sales`는 대시보드로 리다이렉트(구 북마크 호환)
- **대시보드 (`/sales/dashboard`)**: 딜 축 실적 집계 — 요약 지표(계약·병상·디바이스·금액)·월별 추이·이번달/이번주 계약내역 리스트(◀▶ 기간 이동)·종별 도입 병원 게이지·판매/정산/세금계산서 분포
  - **종별 카드 탭 3종 (2026-08-21 하반기 탭 추가)**: `하반기 영업현황`(**디폴트·첫 탭** — 계약일 2026-08-01~12-31 계약완료 딜 기준, 하반기 전용 목표 대비 진척) | `2026년 목표현황`(계약일 2026년 계약완료 딜 기준 — **병상 메인**(목표 대비 진척률, 초과 시 105%처럼 그대로 표기 + '달성' 배지)·병원수 서브, 목표 입력 종별만 + 합계 행) | `종별 도입 병원`(누적 침투율 — 병원수 메인·병상 서브). 카드 우상단 ⚙(ADMIN 이상)로 **활성 탭의** 종별 목표 병상수 설정(연간/하반기 별도 저장) — `lib/salesTargets.ts` + `/api/settings/sales-targets`
  - 종별 도입 병원 카드에 **병상 침투율** 병기 (2026-08-10): 종별 도입 병상(계약완료 딜의 대웅 디바이스 수량 합, KPI '도입 병상'과 동일 기준) / 종별 전체 병상(심평원 `perm_sbd_cnt` 합) + 보조 게이지. 전체 병상 미연동(0) 종별은 분모 '-'·배지 '-%' 표시(게이지 생략)
- **엑셀 다운로드 (2026-08-04)**: 두 탭 모두 우측 상단 '엑셀 다운로드' — **화면에 걸린 필터가 그대로 반영된 결과**를 받는다. 도입현황은 필터·정렬이 적용된 표를 컬럼 정의(`COLS`) 순서 그대로 29컬럼+순번으로 내보내며, xlsx 라이브러리는 클릭 시점에 동적 로드(초기 번들 제외)
- **도입현황 (`/sales/deals`)**: 계약 이력 전용 입력 페이지. 엑셀 B~AK 컬럼 순서 flat 표(**1행 = 1차수(딜)**) + '+ 등록'(병원 검색·매핑 → 딜 생성 → 상세 이동) + 행 클릭 → 딜 상세 편집(`/sales/deals/[id]` — 전 필드 카드형 폼, 병원·지역·종별 자동 표시, 운영 축 읽기 전용, 프로젝트 연결 셀렉트, 삭제)
  - 기본 정렬 계약일 최신순 + 헤더 클릭 정렬(전 컬럼) + 필터(오더·병원종·대웅 사업부)
  - 엑셀 보강 컬럼 8종(보증기간·최초 인입일·용역매출·판매가 유형·대웅 사업부/사무소/담당자/연락처)은 `sales_deals`에 신설, 도입 기기 수량은 기기 마스터(설정>장비 정보) 기준 `SalesDealDevice`로 입력(새 기기 추가 시 기존 딜은 0 표시). 납품일·공사지연일은 추후 연동
  - 운영 축(공사 단계·답사일·공사시작/완료예정·교육일·종별·지역)은 연결 프로젝트·답사에서 **조인 표시(이중 저장 없음)**
- **대시보드(지도) (`/sales/dashboard_map`, 2026-08-14)**: 한반도 SVG 지도 기반 지역별 도입현황 — 7개 권역(수도권/강원/충청/대구·경북/부산·울산·경남/광주·전라/제주, 시도→권역 매핑) 폴리곤 위에 병원수·병상수 막대(지표별 독립 정규화) 표시. 병상수 = 계약완료 딜의 대웅 디바이스 수량 합(KPI '도입 병상'과 동일 기준), 도입률 = 지역 허가병상수(심평원 `perm_sbd_cnt` 연동분) 대비 병상 침투율. KPI 3종(도입 병원수·병상수·병상 침투율) + 지역별 수치 표(열 정렬·CSV 내보내기) + 지도↔표 상호 하이라이트 + 권역 클릭 드릴다운(병원 리스트 → 병원 상세 링크). 지도 경로는 시도 폴리곤(kostat topojson)을 권역 병합·투영해 리포에 번들(`koreaGeo.ts` 자동 생성 파일, 런타임 외부 CDN 의존 없음). 지표 토글(병원수/병상수/둘 다), xl 미만 1열 스택
  - **종별 필터·막대 모드 (2026-08-14 v2)**: 종별 칩 복수선택(딜 보유 종별만 노출, 선택 즉시 지도·KPI·표·드릴다운 전부 클라이언트 재계산 — 서버는 병원 flat 데이터 + 권역×종별 전체 집계만 전달) + 막대 모드 3종(**'도입 수치'(기본)** = 도입 수량만 / '도입현황 대비' = 배경이 전국 도입 합계, 채움 비율 = 지역 구성비 / '전체 대비' = 배경이 선택 종별의 전체 병원수·허가병상, 채움 비율 = 침투율)
  - **muted-earth 베이스맵 (2026-08-15 v3)**: 지도 시각을 `public/geo/korea-map-E1-muted-earth.png`(시도별 파스텔·입체 음영 디자인)로 교체 — 상호작용(권역 히트/틴트·리더선 앵커)은 기존 투영 폴리곤이 담당하며 극점 대응 회귀로 PNG와 정렬(제주는 이미지 배치에 맞춰 시프트). 다크모드는 이미지 감광 처리. 정렬·재생성 절차는 `projects/sales_dashboard_map_design.md`
- **폐기 (2026-08-03)**: 컨셉 비교용 SUPER_ADMIN 전용 5개 탭 — 차수 원장(`/sales`)·영업 파이프라인(`/sales2`)·병원 요약(`/sales3`)·대시보드 B(`/sales/dashboard2`)·대시보드 C(`/sales/dashboard3`) 화면 삭제. 전부 조회 전용 뷰였고 `sales_deals` 등 원천 데이터·API는 그대로. `/sales2`에만 있던 딜 생성·프로젝트 매핑은 `/sales/deals`·딜 상세 폼으로 대체됨

### 주차 웹할인 등록 (`/parking`, USER 이상)
- 방문차량 주차 할인권 등록 유틸 — pweb.kr(아마노) 주차 웹할인 사이트를 서버가 대행 호출 (stateless, DB 미사용)
- 차량번호+입차일 검색 → 입차 차량 선택 → 계정별(env `PARKING_ACCOUNTS`) 사용 가능 할인권·잔여 조회 → 할인권 1건 등록
- **자동 계산·등록**: 주차시간 기반 무료+유료 최적 조합 미리보기(plan) → 순차 등록(auto-apply). 커버 목표 = 주차시간 + **출차 여유 10분**, 차감(부과) 대상 = 목표 − **기본 무료 30분** − 기적용분 (2026-08-03). 무료권 우선, 잔여는 903 계정 유료권 DP 최소비용 커버
- **재입차 무료권 차단 (2026-08-04)**: 사이트 규칙상 한 차량이 그날 무료권을 쓰면 출차 후 재입차해도 무료권을 다시 못 쓴다. 입차 차량 검색은 '현재 주차 중'만 반환해 이전 입차건이 안 보이므로, **할인등록현황(`/state/doListMst`, `account_no=''` → 전 호실·출차분 포함)** 을 조회해 판정 — 이번 입차건과 `entry_date`가 다른 무료 등록이 우리 계정(`PARKING_ACCOUNTS`)에 있으면 `freeBlocked`. 자동계산은 무료를 빼고 전부 유료로 커버하고, 수동 무료 버튼은 비활성화되며 유료 게이트(`paidUnlocked`)는 즉시 해제된다. 타 입주사 계정의 무료권은 재사용 사례가 확인되어 판정에서 제외. 이력 조회 실패 시 차단하지 않음(fail-open). **판정은 입차 달력일 기준(2026-08-07)** — 사이트 영업일이 실제 날짜를 지연 추적해(13시에도 전날 표시 실측) 전날 입차건 무료권이 새 날짜 입차를 차단하던 오판(47서1581) 수정: 현재 입차건과 같은 입차일(YYYYMMDD) 이력만 차단 사유로 인정
- nav 메뉴 미등록 (URL 직접 접근)

### 주간업무 관리 (`/weekly` — 2026-08-19 드래프트, SEERS 소속 전용·nav 미등록)
- 사업본부 주간 리뷰 도구 — 관리 항목(**주요 안건**/주요 이슈 2섹션, 업무구분 thynC/mobiCARE/공통·담당 팀·담당·목표일)은 지속 레코드로 유지하고 주차별 진행내용만 쌓는 구조 (스프레드시트 주간 복사 방식 대체, `projects/weekly_ops_design.md`)
- **주간 보드**: 주차 네비(월요일 시작, `?week=` URL 동기화) + 항목별 [지난주 진행(주차 라벨) | 금주 진행(셀 클릭 인라인 편집, 주차당 1건 upsert)] 병렬 컬럼. 진행·미완료·금주 미입력 항목 amber 강조, 목표일 경과 적색, 섹션 내 ↑↓ 수동 정렬, 인라인 항목 추가(병원은 검색형 SearchSelect — 3,600건 마스터 대응), **주간 특이사항 보드**(주차별 N건 자유 기재·작성자 표기 — 엄격한 관리 항목이 아닌 '그 주에 말할 컨텐츠' 수용처, 보드 최하단 배치)
- **완료 처리**: 보고 있는 주차로 귀속(completedWeek — 단일 소스, 미래 주 차단) → 해당 주 보드에 취소선·완료 배지 잔류, 다음 주부터 제외, 아카이브 탭에서 재개 가능
- **병원별 탭**(완료 포함 토글)·**완료 아카이브 탭** + 항목 상세 모달(전 필드 편집·주차별 타임라인·삭제)
- 접근: 로그인+SEERS 소속 조회, USER 이상 쓰기 (`checkWeeklyAccess` — nav 미등록이므로 API 게이트가 단일 소스)

### 프로젝트 관리
- 구축 공사 프로젝트 등록·수정·삭제 (삭제는 ADMIN 이상)
- 공사 상태(BuildStatus) 연결 및 관리
- 담당자(복수 지정, 필드 엔지니어 선택 모달), 시공사, 계약일, 도입형태(IntroType), 시작일/완료예정일, 교육일, 비고 관리
- 병동 수 / 병상 수 / 게이트웨이 수, 답사·발주 완료 플래그
- **이슈 노트 (위키 임베드)**: 프로젝트 상세에 사내위키 '프로젝트 이슈노트' 페이지를 인라인 임베드(BlockNote 실시간 협업 편집). "+ 이슈노트 생성" 버튼으로 필요할 때만 페이지 생성(프로젝트당 1개), "위키에서 열기" 링크 제공. 협업 서버 미연결 시 스냅샷 읽기 전용 폴백. 기존 Tiptap `issueNote` 컬럼은 백업용 보존(deprecated)
- 프로젝트별 장비 관리
- 프로젝트별 파일 관리 (S3 업로드 / 파일 다운로드 / Drive 연동 병행 지원)
- 목록 표시: 페이지네이션 없이 전체 목록 한 번에 표시
- 목록 기본 정렬: 구축시작일 DESC (미입력 프로젝트 최상단), 보류 상태 항목 최하단
- **목록 검색 상태 유지**: 목록의 검색·필터·정렬 쿼리를 sessionStorage에 보존 — 상세에서 '목록으로' 복귀(저장·삭제 후 이동 포함) 시 마지막 검색 상태 그대로 복원
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
- 요청일 / **상태(단일 축, 2026-07-27 — 접수·작성완료·회신완료·보류, `/settings/install-plan-status`에서 관리)** / 담당자(씨어스, 복수 지정) / 회신일 / 비고(Tiptap 리치 텍스트)
- 상태 색상 뱃지(상태코드 색), 등록 시 상태 기본값: '접수'
- 구 작성완료여부/회신여부 2축은 단일 상태로 통합 (컬럼은 백업 보존)
- 목록 컬럼 헤더 클릭으로 오름차순/내림차순 정렬 토글 (요청일·회신일·등록일), 상태·작성자 필터

### 답사 관리 (구 답사 현황)
- 병원 방문 답사 기록 등록·수정·삭제 (삭제는 ADMIN 이상)
- 대웅 담당자(DAEWOONG 소속) + 담당자(필드 엔지니어, 복수 지정) 연결 지원
- 방문일 / 요청일 / 회신일 관리
- 답사 상태코드 연결
- 답사 상태: 접수 / 답사예정 / 작성완료 / 회신완료
- 목록 기본 정렬: 상태 우선순위(접수 → 답사예정 → 작성완료 → 회신완료), 접수는 요청일 오래된 순, 나머지는 요청일 최신 순
- **목록 필터**: 병원명 검색 + 대웅담당자·담당자(실데이터에서 옵션 추출)·상태 select + 요청일/답사일/회신일 **기간 필터** — 전체 1회 로드 후 클라이언트 즉시 필터(페이지네이션 없음, 총 N건 표시, 필터 초기화 버튼)
- **컬럼 헤더 정렬**: 전 컬럼 클릭 정렬 (오름차순 → 내림차순 → 기본 정렬 해제, 빈 값은 항상 뒤로)
- **필터·정렬 상태 유지**: sessionStorage 보존 — 상세 다녀와도 복원
- 목록 테이블 전체 폭 사용으로 한 화면 표시 (가로 스크롤 제거)
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
- 증상: plain textarea, **조치 요약**: Tiptap 리치 텍스트 — 원인·조치를 종결 시 요약 (완료 처리인데 비어 있으면 안내 배지, 저장은 허용). AI 어시스턴트가 유사 장애 검색에 사용
- **처리 기록 타임라인** (2026-07-18, 구 원인·비고 필드 개편): 상세 페이지 하단 패널 — 진행 경과를 엔트리 단위로 기록(Tiptap), 작성자·시각 자동 기록, **폼과 독립 저장**(기록 추가에 전체 폼 저장 불필요, 동시 편집 충돌 없음). 수정·삭제는 본인+ADMIN(이관분은 ADMIN만). 구 비고 데이터는 '(구 비고 이관)' 기록으로 이관, 구 원인은 조치 요약 상단에 병합
- 첨부파일 관리 (AWS S3 업로드, presigned URL 다운로드) — edit 모드에서만 (건 단위 — 기록별 첨부 아님)
- 목록 컬럼: 접수일 | 병원명 | 제목 | 장애유형 | 우선순위 | 상태 | 원격 | 담당자 | 방문일정 | 완료일 (방문일정은 다건을 결합 표시, 3건↑은 "외 N건")
- **목록 필터**: 병원명 텍스트 검색, 장애유형/상태/우선순위/**담당자** select + **접수일 기간 필터** — 전체 1회 로드 후 클라이언트 즉시 필터 (총 N건 표시, 필터 초기화 버튼)
- **컬럼 헤더 정렬**: 전 컬럼 클릭 정렬 (오름차순 → 내림차순 → 기본 정렬 해제 · 우선순위는 긴급>높음>보통>낮음 순, 빈 값은 항상 뒤로)
- **필터·정렬 상태 유지**: sessionStorage 보존 — 상세 다녀와도 복원
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
  - **캘린더는 유지보수와 공용** (2026-08-04): 기타업무 전용 캘린더를 따로 두지 않고 `GOOGLE_CALENDAR_ETC_TASK_ID`에 유지보수 캘린더 ID를 그대로 넣어 운영. 담당자는 이벤트 초대로 개인 캘린더에서 보므로 공용 캘린더 분리 실익이 없다는 판단. 분리하려면 env 값만 새 캘린더 ID로 바꾸면 됨(코드 변경 불필요)
- 비고: Tiptap 리치 텍스트, 첨부파일(S3, edit 모드)
- 업무(Task) 현황에 `ETC` 타입으로 통합 조회 (상태 '완료' → isCompleted 동기화)
- 목록 컬럼: 접수일 | 제목 | 상태 | 우선순위 | 담당자 | 관련 병원(3곳↑ "외 N곳") | 업무기간 | 완료일. 필터: 제목 검색, 상태/우선순위 select
- 네비 메뉴 기본 노출: SEERS 소속만 (메뉴 관리에서 변경 가능)
- 감사 로그 `resource='etc_task'`로 모든 mutation 기록

### 티켓 관리 (`/tickets` — P3 기본 UI, 2026-07-23)
- **목록** (`/tickets`): 상단 Assignment Group 탭(전체+활성 그룹별) · 필터 바 — 상태 다중 토글(선택 없음 = 열린 티켓 `open=true`), Sev 셀렉트, 내 티켓/미배정 토글(상호 배타), 티켓번호·제목 검색(300ms 디바운스) · 서버 페이지네이션(30건) · 컬럼: 티켓번호|Sev|제목|상태(PENDING이면 사유 병기)|Assign Group|담당자|병원|접수일 · 행 클릭 → 상세
- **생성** (`/tickets/new`): CTI 3단 셀렉트(Category→Type→Item, 전체 트리 1회 로드 후 클라이언트 구성) · 선택 Item의 기본 Assignment Group 표시 + 그룹 수동 변경 · Sev(기본 SEV4) · 담당자(owner, 지정 시 ASSIGNED 시작) · 참여자 칩+셀렉트 · 병원 검색 모달(유지보수 폼과 동일 패턴) · 설명 Tiptap → 저장 후 상세로 이동
- **개인 업무 티켓** (2026-08-03): 생성 폼 상단 '개인 업무' 토글 — 켜면 CTI '내부>개인>업무'·Assignment Group '개인 업무'가 자동 지정되고 본인이 담당자로 배정(즉시 ASSIGNED). 시스템 그룹 '개인 업무'·해당 CTI는 `seed-ticket-masters.sql` §5 마스터, 그룹명은 `lib/ticket-shared.ts`의 `PERSONAL_QUEUE_NAME` 단일 소스. 개인 업무 그룹은 **티켓 대시보드(P12) 지표에서 제외**(큐 필터로 명시 선택 시에만 조회). 서브 티켓 생성 시에는 토글 미노출
- **상세** (`/tickets/[id]`): 헤더(티켓번호·상태/Sev 배지·재오픈 횟수) · 메타 패널(Assignment Group, CTI 전체 경로, 담당자, 참여자, 병원 링크, 접수자, 접수/해결/종결 시각) · PENDING이면 사유·메모 배너
- **액션** (VIEWER 숨김): `canTransition` 전이표로 **현재 상태에서 허용된 전이 버튼만 노출** — PENDING 전환은 사유 셀렉트+메모 인라인 입력, CLOSED는 confirm · 담당자 변경(OPEN↔ASSIGNED 자동 연동) · 큐 이관 · Sev 변경 · 참여자 추가/제거 · 티켓 삭제(ADMIN) · 전이표 위반 등 API 400 메시지 그대로 alert
- **타임라인** (`TicketLogPanel`): 코멘트(Tiptap HTML, 본인·ADMIN 수정/삭제)와 시스템 이벤트(회색 한 줄 — payload를 상태/Sev 라벨·사용자/큐/CTI 이름으로 번역: "상태 접수 → 배정 · 작성자 · 시각") 시간순 단일 뷰 + 하단 코멘트 작성
- 배지 색·라벨·전이표는 `lib/ticket-shared.ts`(클라이언트 안전) 단일 소스 — `TicketStatusBadge`/`TicketSeverityBadge` 공용 컴포넌트
- **설정**: `/settings/ticket-queues`(큐 — 티켓 있으면 삭제 비활성+안내), `/settings/ticket-cti`(3컬럼 트리 — 각 레벨 추가/이름수정/활성/삭제, Item 기본 큐 지정, **규칙 사용처 배지·삭제 차단**), `/settings/ticket-pending-reasons`(대기 사유), `/settings/ticket-cti-rules`(자동생성 규칙)
- **업무 → 티켓 자동생성 규칙** (2026-07-26 — `ticket_cti_rule_design.md`): 답사·설치계획·프로젝트·기타업무·유지보수 등록 시 만들어지는 티켓의 **CTI·Assignment Group·설명 자동입력**을 운영자가 지정
  - 진입: 각 목록 페이지 **우측 상단 `티켓 설정` 버튼**(ADMIN 이상에만 노출 — 버튼이 스스로 역할 확인) + `/settings/ticket-cti-rules` 통합 페이지. 화면은 공용 모달 1개(`TicketRuleSettingModal`)를 5곳이 재사용
  - 유지보수는 **장애유형별 규칙 표**가 추가되며, 규칙 없는 장애유형은 `규칙 미지정` 배지로 드러난다(기본 규칙으로 폴백)
  - **설명 자동 채움**: 답사 노트 / 설치계획·기타업무 비고(Tiptap HTML 그대로) / 유지보수 증상 · 프로젝트 비고(plain → 문단 변환)를 sanitize 후 `tickets.description_html`로 이관 + 출처 한 줄(`※ 답사 VISIT-… 노트에서 자동 입력`). 메일큐 승격 경로 2곳 포함. **생성 시 1회 스냅샷**(티켓에서 편집한 설명을 덮어쓰지 않기 위해 이후 도메인 비고 수정은 미반영)
  - 변경은 **이후 새로 등록되는 업무부터** 적용 — 이미 만들어진 티켓의 분류는 바뀌지 않는다
- **지표 대시보드** (`/tickets/dashboard` — P12, 2026-07-25): 목록 우상단 '대시보드' 버튼으로 진입. KPI 6타일(열린/미배정/SLA 초과(적색 강조)/이번주 종결/평균 해결 소요 90일/재오픈율) + 필터(기간 3·6·12개월·전체, 큐, 유형) + 차트 4종(recharts, 다크 대응 — 월별 생성vs종결·해결 소요 중앙값 추이·SLA 준수율 추이·Sev/유형 분포) + 월별 표 토글 + 큐별 열린 티켓 바 + **담당별 처리량 표(ADMIN 이상만)** + 현 상태 장기 체류 Top 10. 지표 2계열: 필드 기반(전 기간 — 백필 원본 날짜 보존, 음수 소요는 0 클램프) / 상태·큐 체류 통계는 P11 이후 이벤트 축적 후 고도화

### 자재관리(WMS) (개발 중 — `function_wms.md`)
- 구축·판매에서 취급하는 하드웨어 자재(게이트웨이·MC200M-T 등 자사기기, 사이니지·PC·모니터 등 전자제품, 케이블 등 잡자재) 재고관리. **자재 수량·입출고 관리에 집중**(안전재고·실사조정 등 부가기능 미채택)
- **인벤토리 완전 분리 (Phase 10 재설계)**: 인벤토리는 **대웅제약재고 / 평가용재고 / 판매용재고** 3종(`/settings/inventories`에서 추가·병원 연결·활성 편집). **품목·위치(창고)·재고·전표·개체 전부 인벤토리에 귀속** — 같은 MC200M-T라도 인벤토리마다 별도 품목(별도 코드)으로 등록해 완전 독립 관리. **이관(TRANSFER) 기능 폐지**(과거 전표는 '이관(구)'로 이력 표시만, 취소 불가) — 인벤토리 간 이동이 필요하면 A 출고 + B 입고로 각각 처리
  - **자재 현황** (`/inventory`, 전 로그인 조회): **인벤토리별 카드 섹션**(탭 없음) — 섹션 헤더에 인벤토리명·품목 수·총 수량·위치 수 + **입고/출고/이동 버튼 1세트**(품목은 모달에서 검색·선택, 행별 입출고 버튼 없음). 검색·분류 필터는 전 섹션 공통, **Excel 다운로드**
  - **인벤토리 자재 상세** (`/inventory/[invId]/items/[itemId]`): 현황 섹션에서 자재 클릭 시 진입 — 품목 소속 인벤토리와 URL 불일치 시 안내. 그 품목의 재고·이력·개체 + 입출고 모달(품목·인벤토리 고정). **품목 마스터 상세**(`/inventory/items/[id]`)는 기준정보·부자재 구성 관리 + 재고 요약·이력·개체
- **입출고 원장**: 입고(IN)/출고(OUT)/이동(MOVE, 같은 인벤토리 내 위치 이동) 전표 3종, 전표코드 `STK-YYYYMM-NNNN`. **인벤토리는 품목에서 파생**(전표 입력값 아님), 위치도 품목과 같은 인벤토리 소속이어야 함(서버 400). **원장은 불변(append-only)** — 잘못 입력은 취소(역방향 되돌림)로 보정, 취소가 재고를 음수로 만들면 거부. 재고 음수 방지 이중장치(앱 조건부 차감 + DB `CHECK quantity>=0`). 출고/이동 모달은 현재 위치에 재고가 없으면 재고 있는 위치 자동 선택
- **입고/출고 유형 설정화** (`/settings/stock-reasons`, ADMIN): 입고(구매/회수(반품)/기타)·출고(설치/판매/폐기/불량/기타) 유형을 설정에서 추가·삭제. 시스템 동작이 걸린 유형(회수=개체 복귀, 폐기·불량=DISPOSED)과 사용 중 유형은 삭제 409
- **상대처 기재 (2026-08-04 확장)**: `destination`은 **입고=발송처 / 출고=출고처** 겸용(구 OUT 전용). 입고 발송처는 UDI 입출고대장의 '발송처정보' 칸 소스. 이동(MOVE)은 사내 이동이라 미사용
- **출고처 기재**: 출고 전표에 출고처 자유 텍스트(`destination`). **병원·업무 연결은 병원 연결 허용 인벤토리(대웅제약재고) 품목 출고에서만 가능**(UI 숨김 + 서버 400) — 평가용/판매용은 출고처 텍스트만. 병원 상세 **'사용 자재' 카드**(출고 이력 + 설치 개체)
- **주자재/부자재 (BOM)**: 품목 상세에서 주자재 아래 부자재 N개 매핑(구성 수량 포함, 1단계 깊이, **같은 인벤토리 품목끼리만** — 서버 409). 출고 모달 **"부자재 함께 출고"(세트출고)** — 비시리얼 부자재를 같은 위치에서 자동 동시 출고(수량=출고수량×구성수량, 수정 가능), 자식 전표 `parent_tx_id` 연결·부모 취소 시 일괄 취소. 시리얼 부자재는 개별 출고
- **시리얼 개체 추적 (바코드 스캔 대량 처리)**: `is_serial_managed` 품목은 개체 단위 관리(IN_STOCK/OUT/DISPOSED). 입고·출고·이동 모두 **시리얼 직접 입력 textarea**(줄 단위 붙여넣기·바코드 리더기 연속 스캔) — 재고 1만 개·1회 100~200개 출고 대응. 서버가 시리얼→개체 해석 후 위치·재고 상태 검증(미등록/불일치 시리얼 명시 거부 — 시리얼은 품목 단위라 타 인벤토리 개체는 자동 격리), 가용 개체 목록 클릭 선택 병행. 수량↔개체 정합 보장, 동시성 가드(조건부 updateMany+건수 검증)
- **LOT 추적 (2026-07-19, 2026-07-20 A안 확장)**: 품목 마스터 'LOT 관리' 체크(이력 있어도 변경 가능 — 시리얼 여부만 잠금). **시리얼 품목**: `inventory_units.lot_no` 개체 단위 — 신규 입고 시 필수, 회수·출고 시 값이 있으면 개체 LOT 대조. **비시리얼 품목**: **LOT 재고 버킷**(품목×위치×LOT) — 입고 시 LOT 필수(전표당 1개), 출고·이동 시 보유 LOT 선택(모달 드롭다운, '(LOT 없음)' 버킷 포함)·LOT별 잔량 검증(부족 409)·취소 시 해당 LOT 복원. LOT 켜기 전 재고는 '(LOT 없음)' 버킷으로 소진. 품목 상세에 **LOT별 잔량** 표시, 재고 Excel에 LOT 컬럼. LOT 버킷 품목의 전표 LOT 사후 수정 금지(409 — 취소 후 재등록), LOT 관리 부자재는 세트출고 불가(개별 출고). 단건 입고 모달은 전표당 LOT 1개 — LOT 혼합은 전표 분리 또는 Excel 일괄(행별 LOT). 개체 목록·이력에 LOT 컬럼
- **개체(단품) 태그·비고 (2026-07-20)**: 태그는 **시리얼 개체 단위**(`inventory_units.tags`, 최대 10개) — 개체 목록에 태그 컬럼 + '편집' 모달(태그·메모, 처리 권한자)로 관리(예: DEMO, 각인). 품목 단위 태그(2026-07-19)는 개체 태그로 대체되어 UI 제거(`inventory_items.tags` 컬럼은 백업 보존). 품목 memo는 '비고'로 노출(품목 목록 컬럼)
- **요청자 (2026-07-19)**: 전표 `requester`(자유 텍스트) — **출고 필수**(내부 처리는 "자체 처리" 등 기입), 입고 선택, 이동 없음. 세트출고 자식 전표에 상속, 이력 컬럼·Excel 다운로드 포함
- **입출고일 (2026-07-20)**: 전표 `txDate`(DATE) — 시스템 처리시각과 별개의 **업무 기준일, 지난 날짜 소급 등록 지원**. 단건 모달(입고일/출고일 date 입력, 기본 오늘)·Excel 일괄 업로드에서 지정, 이동은 자동(오늘). 이력·상세 이력·Excel에 입출고일 표시(처리일시 별도), 기간 필터는 입출고일 기준. 기존 전표는 처리시각의 KST 날짜로 백필. 수정 모달에서 변경 가능
- **전표 메타 수정 (2026-07-19 · 권한 강화 2026-07-20 — ADMIN이면서 재고 담당자 풀 등록자만)**: `PUT /api/inventory/transactions/[id]` — 유형(같은 시스템 동작 부류 내에서만: 일반↔일반·회수↔회수·폐기↔폐기)·요청자·**입출고일**·출고처·병원/업무 연결·비고. **품목·위치·시리얼은 수정 불가**(개체 정합 — 취소 후 재등록). 취소·이관(구) 전표 수정 불가, 감사 로그 before/after 기록
- **전표 수량 수정 (2026-07-21)**: 같은 수정 모달에서 **비시리얼 품목만** 수량 변경 가능 — 변경분(delta)을 재고 버킷(LOT 포함)에 즉시 반영, 결과 재고가 음수가 되면 409(예: 입고 축소인데 이미 출고됨), MOVE는 출발·도착 양쪽 반영. **시리얼 품목(수량=개체 수)·세트출고 주자재는 금지**(취소 후 재등록 — 부자재 전표는 개별 수정 가능)
- **입출고 이력** (`/inventory/transactions`): 인벤토리 탭 + 유형·위치(탭 인벤토리 스코프)·**기간 필터(입출고일 기준)**, **입출고일·처리일시 컬럼 분리**, **수정(ADMIN+재고담당자)**·취소(권한자, 과거 이관 전표는 취소 불가 409), 요청자 컬럼, **Excel 다운로드**(필터 반영, 최대 1만 행)
- **Excel 일괄 입출고 (시리얼 품목 마이그레이션)**: 이력 페이지 'Excel 일괄 입출고' 버튼(처리 권한자) — **A열=품목명·B열=시리얼번호·C열=LOT번호**(1행 헤더) 업로드로 입고/출고 일괄 처리(`POST /api/inventory/transactions/bulk-serial`, preview 모드). 구분(입고/출고)·인벤토리·위치·유형·요청자(출고 필수) 선택 후 **시리얼 관리 품목만** 대상. 품목명은 선택 인벤토리 내 정확 일치(동명 2건 이상이면 매칭 거부), 품목별 전표 1건씩 생성(최대 2000행). 미리보기에서 행 단위 검증(미등록 품목·비시리얼 품목·파일 내 중복·기등록/미등록 시리얼·위치 불일치·**LOT 규칙**: 입고 시 LOT 관리 품목 C열 필수/비관리 금지, 회수·출고 시 값 있으면 개체 LOT 대조) 후 **오류 0건일 때만 실행, 전체 단일 트랜잭션(all-or-nothing)**
- **전표 상세 페이지 (2026-07-30)**: `GET /api/inventory/transactions/[id]` + `/inventory/transactions/[id]` — 전표 전체 정보 + 시리얼 품목이면 연결 개체 목록(시리얼·LOT·현재 상태·위치) + 세트출고 부모/자식 전표 링크. 입출고 이력·품목 상세 이력의 전표코드 클릭으로 진입
- **LOT별 입출고 요약 (2026-07-30, 2026-08-04 결함 수정)**: `GET /api/inventory/items/[id]/lot-history` — LOT 관리 품목의 LOT번호별 입고·출고·잔량 요약(취소 전표 제외). 품목 상세(인벤토리 스코프·마스터 양쪽)에 'LOT별 입출고' 표 + 이력 행 LOT 컬럼. **LOT 해석은 `lib/inventoryLot.ts` 단일 소스** — 시리얼 품목은 개체(`inventory_units.lot_no`), 비시리얼은 전표(`transactions.lot_no`)로 이원화되어 있어 전표만 보면 시리얼 품목의 LOT이 통째로 소실됨(구 구현 결함). 한 전표에 복수 LOT이 섞인 경우 행 분해
- **UDI 입출고대장 (2026-08-04 — `projects/inventory_udi_ledger_design.md`)**: `/inventory/ledger` — 의료기기 GMP 품질기록 **F707-1「입출고대장」**을 시스템 데이터로 생성해 **docx 다운로드**. **문서 1부 = 모델 1종**(예: 'MP100W Series 입출고대장.docx')이고, 문서 안의 각 행은 **UDI × LOT** 단위로 구분된다(원 양식에 UDI·LOT NO 컬럼이 행마다 있는 이유). **인벤토리 필터**로 범위를 좁힐 수 있고 미선택 시 전체 합산. 취소 전표·사내 이동(MOVE/TRANSFER) 제외. '동일 LOT NO 제품 출고완료'는 **수동 체크**. 현재고는 UDI×LOT 소계와 총합을 함께 표시. docx는 **원본 양식을 템플릿으로 재사용**(`assets/templates/udi-ledger-F707-1.docx` — 행 복제 + `<w:t>` 치환)해 글꼴·테두리·머리글/바닥글을 100% 보존하며, 문서번호·양식번호·개정이력은 `/settings/udi-ledger`에서 편집. 권한: 조회·출력 `canManageStock`(재고 담당자 또는 ADMIN 이상), 문서 메타 ADMIN 이상. 출력 시 감사 로그 기록
  - **UDI 입력 경로**: 자재관리 > **품목 관리**의 등록/수정 폼(목록에 UDI 컬럼, 품목 상세에 UDI 카드). UDI는 품목 속성이므로 인벤토리별 품목에 각각 입력한다
  - API: `GET /api/inventory/ledger`(모델 목록 / 대장 데이터) · `PUT /api/inventory/ledger/check`(출고완료 체크 토글) · `GET /api/inventory/ledger/docx`(문서 다운로드)
  - **대장 시작점은 2026-07-01** — 시스템 도입 시 재고를 스냅샷으로 적재해 그 이전 입출고 이력이 없음(소급 입력 미실시)
- **다품목 일괄 입출고 (2026-07-30)**: 이력 페이지 '다품목 입출고' 버튼(`BulkTxModal`) — 인벤토리·유형·요청자·출고처·일자 공통 입력 + 위치·품목·수량(비시리얼)/시리얼·LOT(시리얼)는 줄별 지정, 혼합 지원. `POST /api/inventory/transactions/bulk`(입고/출고만, 세트출고·병원연결 미포함) — 줄별 검증 후 단일 트랜잭션 전부 성공/전부 롤백, 품목별 전표 1건씩 생성. **비시리얼 LOT 품목 출고 시 보유 LOT 버킷 드롭다운 선택**(2026-08-07 — 단품목 출고 모달과 동일, 위치 선택 후 활성화·잔량 표시·'(LOT 없음)' 버킷 포함. 수동 입력은 입고 신규 LOT만)
- **품목 마스터** (`/inventory/items`, ADMIN 또는 `inventory.admin` 권한): 인벤토리 탭 + 인벤토리 컬럼. `ITEM-NNNN` 자동 발번(전체 순번), **등록 시 인벤토리 필수·수정 불가**. **모델명**·대>중>소 분류 트리·제조사·규격·단위·시리얼 여부·DeviceInfo 연결·참고단가. 검색은 품목명·모델명·코드·규격 통합. **Excel 일괄 가져오기**(가져올 인벤토리 선택 필수, 같은 인벤토리 내 품목명 중복만 스킵, K열=LOT여부)
- **위치(창고) 관리** (`/settings/warehouses`, ADMIN): **인벤토리별 섹션으로 독립 추가/수정/삭제** — 위치명 UNIQUE는 인벤토리 내에서만(다른 인벤토리엔 같은 이름 허용)
- **처리 권한**: 입고/출고/이동/취소 = 재고 담당자 풀(`/settings/inventory-managers`) + ADMIN 이상 + **RBAC `inventory.manage`/`inventory.admin` 권한 보유자**(2026-08-04 가산 편입, 2026-08-06 admin 상위집합 — `canManageStock` 서버 실시간 검사). **품목 마스터·자재 기초 설정** = ADMIN 이상 또는 (USER 이상 + `inventory.admin`) (`canAdminInventory`). 조회=전 로그인. 감사 로그 `resource='inventory_tx'`/`inventory_item`/`setting:*`
- **PROD 배포**: Phase 10(인벤토리 완전 분리, 마이그레이션 `20260716100000`)까지 배포 완료

### GW 배치 플래너 (`/gateway-planner`, ADMIN 이상 — `function_gateway_planner.html` Phase 1·2)
- **목적**: 병원 1개층 도면(스캔 PDF/JPG/PNG)을 업로드하면 AI가 공간(복도·병실·화장실 등)을 인식하고 게이트웨이 설치 위치 초안을 자동 배치 → **편집 가능한 PPTX**(A4 가로, 빨간 점 = 개별 도형)로 다운로드해 사람이 PowerPoint에서 검토·수정 후 설치계획 문서에 사용
- **파이프라인** (백그라운드 잡 — HiraSyncJob 패턴, 30초~2분): 래스터화(pdftoppm 200DPI) → 정규화(sharp, 장변 1568px) → **Claude Vision 공간 인식**(2×2 타일 분할 + 그리드 오버레이, claude-opus-4-8 tool use) + **전체 뷰 치수 판독** → 스케일 후보 산출(robust median) → **결정론적 배치 엔진**(AI 미사용 — 복도는 중앙선 등간격, 병실 면적 기준 1~2개, 화장실 1개, 계단·EV·야외 제외) → 미리보기 배치
- **스케일 확정 (필수 사람 개입)**: AI 치수 판독 후보 승인 / 도면 2점 클릭+실거리 입력 보정 / 스케일 없이 진행(개소 기반만) — 확정 후 PPTX 생성 가능
- **잡 상세**: 진행 상태 폴링, 도면 위 점·공간 인식 결과 SVG 오버레이 미리보기, 공간별 집계, 재배치(AI 재호출 없음)·AI 재분석·PPTX 생성/다운로드·삭제
- **배치 규칙 설정** (`/settings/gateway-planner`, ADMIN): 커버리지 직경(기본 10m)·복도 간격 계수(0.8→8m)·병실 기본/소형 개수·소형 기준 면적(20㎡)·최소 배치 면적·제외 공간·점 직경(0.2cm)/색상. AppSetting `gw_planner_rules`, 변경 후 기존 잡은 "재배치"로 반영
- 감사 로그 `resource='gateway_plan'` / `setting:gateway-planner`. 접근: 메뉴·API 모두 ADMIN 이상

### 차량예약
- 법인차량 선착순 즉시 확정 예약 (승인 절차 없음)
- **미반납자 예약 차단**: 종료시각이 지났는데 반납 처리하지 않은 예약이 있으면 새 예약 불가 (서버 403 + 대상 건 안내, 보드 상단 경고 배너 + "바로 반납하기" 버튼). 반납 즉시 차단 해제
- **빠른 예약·반납 모바일 페이지** (`/vehicle-reservations/mobile`): 현장에서 폰으로 최소 탭 예약·반납
  - **반납**: 내 이용 중(운행중/반납필요) 차량 카드 → 최종 주행거리(직전 기록 힌트)+비고 입력 → 즉시 반납
  - **빠른 예약**: 날짜·시작시각(30분 단위) + 이용시간 칩(1/2/4시간·종일·직접입력) → **가능 차량 실시간 검색**(충돌 차량은 예약자·시간 표시로 비활성) → 차량 탭 선택 → 목적·행선지 입력 → 예약
  - 기존 API만 사용(신규 API 없음), 주간 보드와 상호 링크
- **주간 현황 보드** (`/vehicle-reservations`): 행=차량(색 칩+이름+차량번호), 열=월~일
  - 예약 카드: 시간·예약자·목적, 내 예약은 파란색 강조, 여러 날에 걸친 예약은 ←/→ 표시로 분할 렌더
  - **반납 상태 색 구분**: 반납완료(회색 ✓) / 반납필요(종료시간 지난 미반납, 앰버 ⚠) / 내 예약(파랑) / 타인(회색)
  - 빈 영역 클릭 → 해당 차량·날짜로 예약 모달 자동 채움
  - 주 이동 ◀▶ + 오늘 버튼, URL `?week=` 동기화, 오늘 컬럼·주말 컬럼 하이라이트
- **반납**: 예약 상세 모달에 `반납` 버튼 → 최종 주행거리(+비고) 입력 → 운행일지 자동 생성 + 반납완료 처리(한 트랜잭션). 시작/종료/목적/행선지/운전자는 예약값 자동(운전자 변경은 ADMIN). 반납완료 예약은 수정/취소 대신 반납 정보 표시, ADMIN은 반납취소(일지 삭제+해제) 가능
- **운행일지 탭**: 현황 보드 | 내 예약 | 운행일지. 차량·기간 필터 + 합계 주행거리, 예약 미연결 운행 직접 작성·수정·삭제. 조회=로그인 전체, 작성·수정·삭제=USER 이상 본인(운전자/작성자) 또는 ADMIN
- **운행일지 인쇄 (2026-07-21)**: 운행일지 탭 '인쇄' 버튼 → `/vehicle-reservations/logs/print` (현재 차량·기간 필터 유지, 네비 없는 전체 화면) — **A4 가로, 차량별 1장씩 페이지 나눔**. 표준 운행일지 양식(번호·운행일자·반납일·운행시간·운전자·운행목적·행선지·계기판거리·주행거리·비고 + 합계), 전체 차량 선택 시 차량마다 별도 시트로 일괄 인쇄. 반납일 컬럼은 2026-08-10 추가(여러 날 대여 건의 반납일 표기 — `endAt` 날짜)
- **예약 모달**: 차량 / 시작·종료(날짜+30분 단위 시각, 다일 예약 지원) / 종일(09:00~18:00) 버튼 / 목적 / 행선지
  - 충돌 시 "이미 ○○님이 …~… 예약했습니다" 인라인 안내 (409)
- **내 예약 탭**: 다가오는 본인 예약 목록 + 상세/수정/취소
- 권한: 조회=로그인 전체(VIEWER 포함), 예약·본인 수정·취소=USER 이상, 타인 예약 취소=ADMIN 이상
- **계정별 사용 제한**: 계정관리에서 `vehicleReservationBlocked` 지정 시 해당 계정은 등록·수정·취소 불가(조회만). 서버에서 POST/PUT/DELETE 진입 시 DB 조회로 실시간 차단(403), 페이지 상단 안내 배너 노출
- 더블부킹 방지: 앱 레벨 트랜잭션 검사 + DB EXCLUDE 제약 이중 장치
- **차량 관리** (`/settings/vehicles`, ADMIN 이상 또는 RBAC `vehicle.manage` 권한 보유 USER — 2026-08-04): 차량 등록·수정·삭제·순서·활성 토글, 보드 표시 색상(ColorPicker)
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

### Slack 알림 (v2 재편, 2026-08-03 — `projects/notification_v2_design.md`)
- **이벤트 소스 = 티켓 레이어** (P11 유지): 순수 티켓·도메인 업무 모두 티켓 mutation에서 알림 발생(`lib/notify.ts` `notifyTicketCreated`/`notifyTicketChanged`). 도메인 라우트는 저장 후 티켓 알림만 호출 — 이중 발송 구조 없음
- **발송 모드는 env 소유** (`SLACK_NOTIFY_MODE`): `off` / `test`(전량 테스트 채널로 리라우팅 + **`[DEV→#원채널명]` 표식** — 라우팅 검증 가능, 비-production은 live 자동 강등) / `live`. 채널·정책은 전부 DB(설정 화면) — PROD 데이터 동기화로 DEV에 실채널 ID가 복사돼도 모드 게이트가 오발송을 차단
- **DM 폐기 (v2)**: 배정 DM·SLA 초과 owner DM 제거. 대신 **채널 메시지에 담당자 @멘션**(`<@Uxxx>`, 이메일 lookup + `users.slack_user_id` 캐시, 매핑 실패 시 이름 폴백). `slackNotifyEnabled=false`도 채널 멘션은 발송(DM 아님)
- **그룹 알림 채널** (`ticket_queues.notify_channel_id`): Assignment Group마다 채널 지정 — 생성·배정·이관·상태변경 알림이 라우팅 규칙 매칭 채널과 **병합 발송**(같은 채널 1건). **'개인 업무' 그룹은 채널 알림 제외**(`personal_queue` 스킵 로그). 그룹 관리 화면에서 채널 지정+테스트 발송
- **변경 감지 (sig)**: `v2|status|owner|sev|queue` 시그니처를 **`tickets.notify_sig` 컬럼**과 비교(v2 — 로그 의존 제거, 로그 purge에 안전). 상태·큐 변경, Sev1·2 에스컬레이션, **담당자 배정**(`assigned` 토글)은 채널 발송(복합 변경 1메시지), 그 외는 조용히 기준선 갱신
- 메시지(티켓 중심 통일): 이모지+`[유형] TK-번호 · Sev · 큐` 헤더 + 티켓 상세 링크(+도메인 상세 링크) + 변경 축(Status/Queue/Severity/Assignee) + **타입별 선택 필드**(카탈로그 유지)
- **Sev1·2 강조**: Sev1 = 🚨+`<!channel>` / Sev2 = 🔥. 큐 멤버 멘션(`notify_queue_mentions`) 유지
- **RESOLVED 자동 종결**: `ticket_auto_close_days`(기본 0=끔) — `runTicketAutoClose`, tick 주기 실행
- **설정 페이지 `/settings/notifications`** (ADMIN 이상) 3탭: ① **SLA 정책**(정책×타깃 매트릭스 + CTI 스코프 + 정책별 알림 채널) ② **채널·발송 규칙**(notify_channels CRUD·테스트 발송 + 이벤트 라우팅) ③ **전역·이력**(전역/이벤트/타입 토글 · tick 주기·상한 · **전역 SLA 요약 시각+채널** · 자동종결 · 메시지 필드 · 발송 이력)
- 폐기(v2 P1): `lib/delay-rules.ts`(구 지연 판정 — SLA 시계로 일원화), 배정/SLA DM, `notify_delay_interval`·`notify_dm_*`·`notify_assign_dm`·`notify_sla_rules`·`notify_status_dwell` 설정 키, `SLACK_CHANNEL_MAIN`·`sendConnectionTest`

### 사내 위키 (Phase 2-13)
- Notion-like 블록 에디터(BlockNote) 기반 사내 위키
- 별도 PostgreSQL 스키마 `wiki`에 격리, 메인 모듈과 단방향 의존성 유지
- 페이지 단위 작성·조회·수정·삭제 (BlockNote JSON 본문)
- **HTML 문서 페이지 (2026-07-18)**: 신규 작성에서 "HTML 문서 업로드"로 HTML 파일을 그대로 게시(설계서·산출물 등, 최대 2MB) — 저장 시 sanitize(script·인라인 이벤트·`javascript:`·iframe 제거), sandbox iframe으로 원본 디자인 그대로 렌더(스크립트 실행 차단), 파일 교체/다운로드, plain_text 추출로 위키 검색·AI 어시스턴트 지식소스에 자동 포함. 편집은 재업로드 방식(버전 히스토리 미지원)
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
- **병원 노트 시스템 카테고리 (2026-07-18, 역할 조정 2026-07-26)**: 최상위 '병원 노트' 카테고리(AppSetting `wiki_hospital_note_root_id`) 아래 병원별 노트 페이지(`WikiPageReference` refType `hospital_note` 1:1). 병원 상세에 임베드(HospitalNotePanel, 협업 편집). **담당자가 직접 쓰는 특이사항 메모**이며 어시스턴트 `read_hospital_note` 도구가 참조 — 상담이력 자동 append는 2026-07-26에 폐지(`consultations` 테이블로 분리). 보호 규칙은 이슈노트와 동일(루트 이동·삭제 차단, 노트 이동 차단·삭제 ADMIN만, 카테고리 직속 생성 차단, 복제 시 참조 미복사)
- **프로젝트 이슈노트 시스템 카테고리**: 최상위 '프로젝트 이슈노트' 카테고리(AppSetting `wiki_project_issue_root_id`) 아래 프로젝트별 이슈노트 페이지 수용 — 프로젝트 상세에서 생성·임베드 편집. 루트는 이동·이름변경·삭제·복제 차단, 이슈노트 페이지는 카테고리 밖 이동·템플릿화 차단 + 삭제는 ADMIN 이상만(서버 검증 + 사이드바/상세 메뉴 숨김). 일반 페이지를 카테고리 안으로 이동·생성하는 것도 차단. 이슈노트 페이지 복제 시 사본은 일반 페이지로 최상위 생성(`project_issue` 참조 미복사). 프로젝트가 삭제돼도 페이지는 카테고리에서 계속 접근 가능
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

### AI 어시스턴트 v2 (에이전트형 — `function_ai_assistant.html`, Phase 1~4·6 완료 2026-07-18)
- **에이전트**: Anthropic API(`claude-opus-5` + adaptive thinking, effort 기본 `medium`) 직접 호출, **tool use로 운영 DB·위키 실데이터 조회** 후 답변. 역할 3축 — ①CS 응대(위키 지식+병원 노트) ②정보 조회(병원 현황·형상) ③영업·운영 집계
- **접근 권한 (v3, 2026-07-25)**: **자사(SEERS) 전용**. `lib/ai/access.ts`가 `/api/ai-assistant/*` 전 핸들러에서 소속을 **DB 실시간 조회**로 검사(JWT는 최대 7일 경과 가능). nav 메뉴의 `allowed_org_codes`는 UI 게이트일 뿐이라 서버에서 별도 강제
- **지식 소스 2축 (v3 설계 원리 — `ai_assistant_v3_design.md`)**: 축1 **고정형**(사내위키 — 제품 사양·매뉴얼, 문서 단위가 아니라 **절 단위** 검색) / 축2 **운영**(운영관리 DB — 유지보수·답사·상담 이력, **자유 텍스트 전문 검색**). 두 축은 단위·정답 성격·갱신 빈도가 달라 검색 전략을 분리했다
- **도구 26종(read-only, `lib/ai/tools.ts` 화이트리스트)**: `search_hospitals`(운영·계약 우선 랭킹) / `get_hospital_overview` / `list_projects` / `list_maintenances` / `list_site_visits` / `list_install_plans` / `list_etc_tasks` / `get_dashboard_summary` / **`aggregate_stats`**(기간 집계) / **`search_operation_history`**(v3 — 유지보수 증상·조치, 처리기록, 답사 노트, 기타업무 비고, 티켓 코멘트, **상담이력** 통합 전문 검색) / **`find_similar_cases`**(v3 — 증상→과거 유사 장애+조치, CS 응대 특화) / **`read_consultations`**(2026-07-26 — 병원별 과거 상담이력 최근순) / `search_wiki` / **`read_wiki_chunk`**(v3) / `read_wiki_page` / `read_hospital_note`(담당자가 직접 쓴 병원 메모 — 상담이력과 별개)
- **도구 확장 10종 (2026-07-27 — 운영시스템 전 데이터 커버)**: 자재관리 `search_inventory_items`(품목 검색+현재고·위치별 잔량) / `get_stock_summary`(인벤토리×위치 집계) / `list_stock_transactions`(입출고 전표 — 병원별 사용 자재 포함) / `find_serial_unit`(시리얼 개체 추적+이력) · 티켓 `list_tickets`(상태·그룹·Sev·SLA 초과 필터) / `get_ticket`(상세+타임라인+SLA 시계+연결 업무) · 차량 `list_vehicle_reservations` / `list_vehicle_logs`(합계 주행거리) · 조직 `search_users`(이름·부서·역할·담당 풀 — **연락처 미제공**) · `list_gateway_plan_jobs`. **의도적 제외**: 감사 로그·AI 사용량(ADMIN 전용 데이터 — 권한 우회 방지), 개인 알림함·대화 세션, 폐기 테이블
- **출처 표기 (v3)**: 지식 도구가 `link`(도메인 상세 경로)를 함께 반환하고, 시스템 프롬프트가 사실 진술에 근거 출처를 마크다운 링크로 제시하도록 규정 — 예: `[MNT-202605-0043](/maintenances/104)`
- **답변 피드백 (v3)**: 답변 하단 👍/👎(👎는 사유 4종 — 틀림·못 찾음·오래된 정보·부적절) → `ai_feedback`. 대화를 삭제해도 보존되며, 벡터DB 도입 여부 판단의 근거 데이터로 쓴다
- **목록 도구 5종 공통 파라미터 (2026-07-25)**: `limit`(기본 10·최대 30)·`detail`(`summary` 기본 / `full`). 요약 모드는 핵심 필드만 반환하고 증상·조치·비고 등 본문은 `full`에서만. 응답에 `total`을 항상 포함해 "몇 건인가"를 재조회 없이 답한다
- **`search_wiki` 절 단위 검색 (v3)**: 문서가 아니라 **헤딩 청크** 단위로 검색·반환한다. 랭킹은 헤딩 경로 적중(3배) > 문서 제목(2배) > 본문 + `pg_trgm` 유사도. 결과에 위키 카테고리(`category`)와 문서 내 위치(`heading`)가 함께 와서 읽을 절을 정확히 고를 수 있다. 68,772자 API 규격서에서 `1. 공통 규격 > 1.2 인증 (TokenInterceptor)` 절을 도구 1회로 특정
- **`read_wiki_chunk` (v3)**: 특정 절의 본문 전체 + 앞뒤 절(기본 1개)을 반환해 문맥이 끊기지 않게 한다. `read_wiki_page`(문서 전문, `offset`/`nextOffset`)는 문서 전체 조망용으로 존치
- 에이전트 루프(`lib/ai/agent.ts`): 스트리밍 + tool use 반복(최대 8회), 도구 실패 is_error 전달, **프롬프트 캐싱** — 시스템+도구 정의 breakpoint(가변 컨텍스트는 캐시 뒤 배치) + **messages 롤링 브레이크포인트**(2026-07-25): 반복마다 마지막 블록에 마커를 갱신해 다음 반복이 직전 도구 결과까지를 캐시로 읽는다(직전 1개 유지 — lookback 20블록·상한 4개 제약). 적용 전에는 N번째 반복이 1~N-1번째 도구 결과를 전부 정가로 재처리했다
- **SSE 스트리밍**: `POST /api/ai-assistant/chat` — `text`/`tool_start`/`done`/`error` + 15초 하트비트(프록시 타임아웃 보호), 도구 진행 상태("🔍 집계 중...") 인라인 표시
- **세션 UX**: 좌측 사이드바(내 대화 목록·이어하기·삭제, 모바일 드로어), 세션 제목 자동(첫 질문 40자), 병원 컨텍스트 칩 복원
- **상담 정리 → 상담이력 저장 (2026-07-26 재설계)**: AI 정제(`claude-sonnet-5` — 단발 요약이라 Opus 불필요) 후 **"💾 상담이력 저장"** → `consultations` 테이블에 저장(병원 필수, 원 대화 `sessionId` 연결). 병원 상세 '상담이력' 카드에서 조회·수정·삭제하고, 다음 상담에서 `read_consultations`·`search_operation_history`로 재활용
  - 구 방식(위키 '병원 노트' 마크다운 append)은 **폐지** — 협업 Y.Doc과 이중 기록이라 노트가 열려 있으면 덮이는 유실 경로가 있었고, 구조가 없어 집계·필터가 불가능했으며, 청크 인덱스가 갱신되지 않아 AI 검색에도 안 잡혔다. 상세는 `consultation_history_design.md`
  - 위키 '병원 노트'는 **담당자가 직접 쓰는 특이사항 메모**로 역할 분리 (임베드 패널 유지)
- 권한: VIEWER 사용 불가(403), 세션은 소유자만 접근(삭제는 본인 또는 ADMIN)
- **Flowise 제거**: 프록시 라우트·env 삭제 완료 (Flowise EC2 종료는 추후 결정)
- **제품 지식 소스**: thynC 솔루션 자체 사양은 사내위키 `thync_1.3.0` 카테고리의 산출물 문서 세트(HTML 12종 — 기능정의서·API규격서·DB설계서·알람정책·외부연동·설치/설정·용어집)로 제공. `search_wiki`/`read_wiki_page`로 자동 참조하며, 원본은 `docs/thync-product-1.3.0/`에 보존(`scripts/publish-wiki-html-docs.mts`로 재게시)

### AI 어시스턴트 설정 (`/settings/ai-assistant`, ADMIN 이상 — 2026-07-25)
- **사용 모델(읽기 전용)**: 채팅 `claude-opus-5` / 상담 정리 `claude-sonnet-5`. 모델 ID는 코드 상수로 고정(오타 하나로 전 요청이 실패하므로 설정으로 열지 않음)
- **사고 깊이(effort)**: `low`/`medium`(기본·권장)/`high`/`max` — 미지정 시 API 기본값이 `high`라 단순 조회에도 사고 토큰이 과다 청구되던 것을 기본 `medium`으로 고정
- **프롬프트 캐시 TTL**: `5m`(기본) / `1h` — 쓰기 단가가 1.25배/2배로 달라 대화 간격에 따라 손익이 갈림
- AppSetting `ai_assistant_settings`(JSON 단일 키), 변경은 다음 질문부터 적용. 감사 로그 `resource='setting:ai-assistant'`
- 효과 측정은 `/settings/ai-usage`(사용량 원장 집계)와 `npx tsx scripts/ai-agent-smoke.mts`(회귀 질문셋 — 도구 호출·토큰·캐시 적중률·추정 비용 출력, 원장에 기록되지 않아 집계 오염 없음)로 확인

### AI 사용 현황 (`/settings/ai-usage`, ADMIN 이상 — 2026-07-20)
- AI 어시스턴트 사용량 관리 — **사용량 원장 `ai_usage_logs` 집계** (2026-07-20 전환: 대화를 삭제해도 집계 보존, 기존 대화 백필)
- **KPI**(이번달 질문·토큰·예상 비용·사용자, 전월 병기) + **월별 추이 차트 12개월**(질문 수·예상 비용, 단일 축 2차트) + **사용자별 테이블**(기간 필터 — 질문·세션·입력/출력/캐시 토큰·예상 비용·최근 사용) + **병원 컨텍스트 Top 10**
- 비용은 토큰 × 단가(AppSetting `ai_usage_pricing` — 입력/출력/캐시읽기/캐시쓰기 USD·환율, 페이지에서 편집) **추정치** — 실청구는 Anthropic Console 기준
- 대화 내용 미노출(메타데이터만), 계정 삭제 시에도 원장 스냅샷(이름·이메일)으로 집계 유지

### 역할 관리 (RBAC Lite — SUPER_ADMIN 전용, 2026-08-04)
- 직무 단위 **역할**(권한 키 묶음)을 정의하고 사용자에게 N:M 부여 — 기존 등급 체계 위에 얹는 **가산 전용**(기존 접근 불변, `projects/rbac_design.md`)
- `/settings/roles` 한 페이지 3구역: ① 역할 목록(추가·이름/설명 수정·활성·순서·삭제) ② 권한 할당(카탈로그 모듈별 체크박스, 토글 즉시 저장) ③ 멤버 할당(활성 사용자 검색 추가/회수)
- 계정관리(`/users`) 목록·카드에 보유 역할 보라색 배지 표시(읽기 전용, 활성 역할만)
- 메뉴 노출 연동: 메뉴 관리 '허용 권한' 필드 — 지정 시 해당 권한 보유자(또는 SUPER_ADMIN)에게만 노출. `/api/auth/me`가 `permissions[]`를 반환(SUPER_ADMIN은 카탈로그 전체). **메뉴 노출은 UX일 뿐, 보안은 각 API 게이트가 담당**
- 파일럿 편입(자재관리): 역할에 `inventory.manage`를 주면 재고 담당자 풀 미등록이어도 재고 처리 가능 — 풀 등록자·ADMIN은 기존 동작 그대로
- 모든 역할·권한·멤버 변경은 감사 로그 `resource='setting:app-roles'` 기록. 역할 회수·비활성은 60초 내(캐시 TTL) 반영, 같은 프로세스의 변경은 즉시 반영
- 신규 기능의 권한 요구는 전용 풀 신설 대신 **카탈로그 키 추가**로 처리 (기존 모듈 편입은 Phase 3에서 건별 승인)

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
- **설치계획 상태 관리** (2026-07-27): 단일 축 상태(접수·작성완료·회신완료·보류) 추가·수정·삭제
- **워크플로 상태 티켓 매핑** (2026-07-27): 유지보수/기타업무/답사/설치계획 상태·공사 상태에 티켓 상태 매핑 지정(신규 상태는 필수, PENDING은 대기 사유 지정) — 미매핑 앰버 배지·역방향 버킷 부재 경고
- **도입형태(IntroType) 관리**: 구축형·구독형·사용량비례형 등 동적 추가·수정·삭제·순서 변경
- **상담유형(ConsultationType) 관리**: AI 어시스턴트 상담유형 동적 추가·수정·삭제·순서 변경
- **문서유형(DocumentType) 관리**: AI 어시스턴트 문서유형 동적 추가·수정·삭제·순서 변경 (value 코드값 포함)
- **심평원 연동 관리** (SUPER_ADMIN 전용): 심평원 Open API 병원 데이터 동기화
  - 연동 시작 버튼 → 백그라운드 비동기 처리 (브라우저 닫아도 서버에서 계속 실행)
  - 연동 히스토리 목록 (시작시간·종료시간·유형·상태·연동건수)
  - 히스토리 행 클릭 시 상세 로그 패널 표시 (이벤트 타입별 색상 구분)
  - 진행 중 잡에 대해 2초 간격 폴링으로 실시간 로그 갱신
  - **병원상세정보연동**: 종별 다중 선택(병원급 7종 — 상급종합·종합병원·병원·요양병원·정신병원·치과병원·한방병원) → 병원별 허가 병상수(`permSbdCnt`)를 `MadmDtlInfoService2.8/getEqpInfo2.8`로 조회·갱신 (병원당 API 1콜, 백그라운드 + 로그). 미연동 병원 우선 처리라 중단 후 재실행 시 이어서 진행. 일일 트래픽 한도 10,000건 — 의원급(의원·치과의원·한의원 등)은 건수 초과로 범위 제외

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
| GET  | `/api/hospitals/[code]/system-info` | thynC 시스템 현황 통합 조회 — 서버 현황+EMR 연동 정보+EMR 업체 마스터 (2026-08-16) |
| POST | `/api/hospitals/[code]/servers` | 병원 서버 등록 (USER 이상 — 이름 필수, URL은 http(s)만 허용) |
| PUT/DELETE | `/api/hospitals/[code]/servers/[id]` | 서버 수정·삭제 (USER 이상) |
| PUT  | `/api/hospitals/[code]/emr` | EMR 연동 정보 upsert (USER 이상 — 연동상태·업체·범위·방식 화이트리스트는 `lib/hospitalSystem.ts` 단일 소스) |
| GET/POST, PUT/DELETE | `/api/settings/emr-vendor(/[id])` | EMR 업체 마스터 (ADMIN — status_codes EMR_VENDOR, 사용 중 삭제 409) |

### 영업/CRM (전 엔드포인트 ADMIN 이상 + SEERS 소속 — `checkSalesAccess`)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/hospitals/[code]/sales` | 영업 정보 통합 조회 (프로필·인적정보(현재/과거 소속)·활동·딜 + 마스터(SALES 코드 7종·SEERS 유저·프로젝트) + 파생(도입 병상·침투율·누적 실판매액)) |
| PUT  | `/api/hospitals/[code]/sales/profile` | 영업 프로필 upsert (단계·담당 영업 검증) |
| POST, PUT/DELETE | `/api/hospitals/[code]/sales/persons(/[affId])` | 인물+소속 등록/동시 수정/소속 삭제(오입력 정정) |
| POST | `/api/hospitals/[code]/sales/persons/[affId]/transfer` | **전원 처리** — 소속 종료 + 대상 병원 신규 소속 (이력 보존) |
| POST | `/api/hospitals/[code]/sales/persons/[affId]/end` | 소속 종료 (퇴직 등) |
| POST | `/api/hospitals/[code]/sales/deals/[id]/map-project` | 프로젝트 매핑/해제 전용 (다른 필드 불변, 같은 병원 검증·중복 409) — **호출처 없음**(2026-08-03 `/sales2` 폐기, 프로젝트 연결은 딜 상세 폼의 `projectCode`로 대체). 라우트는 보존 |
| POST, PUT/DELETE | `/api/hospitals/[code]/sales/deals(/[id])` | 계약 건(차수) — `DEAL-YYYYMM-NNNN` 발번, round_no 자동, 같은 병원 프로젝트만 연결, 코드 FK 카테고리 검증 |
| POST, PUT/DELETE | `/api/hospitals/[code]/sales/activities(/[id])` | 영업 활동 |
| GET/POST, PUT/DELETE | `/api/settings/sales-codes/[category](/[id])` | 영업 StatusCode 7카테고리 (화이트리스트 검증, 색상 지원, 사용 중 삭제 409) |
| GET/PUT | `/api/settings/sales-targets` | 연도별 종별 목표 병상수 (AppSetting `sales_bed_targets_<year>` JSON, `period=h2`는 하반기 키 `sales_bed_targets_<year>_h2` — 열람: 영업 게이트, 수정: ADMIN 이상) |

### 주차 웹할인 (USER 이상 — pweb.kr 대행 호출, DB 미사용)
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/parking/search` | 차량번호+입차일로 입차 차량 검색 |
| POST | `/api/parking/coupons` | 선택 차량에 대한 전 계정 할인권·잔여 병렬 조회 |
| POST | `/api/parking/register` | 계정 1개로 할인권 1건 등록 |
| POST | `/api/parking/plan` | 주차시간 기반 자동 할인권 조합 미리보기 (무료 30분·출차 여유 10분 반영, 읽기 전용) |
| POST | `/api/parking/auto-apply` | 자동 계산 조합 순차 등록 (무료 먼저 → 903 유료, 실패 시 중단) |

### 주간업무 관리 (2026-08-19 — 조회 SEERS 소속, 쓰기 USER 이상 `checkWeeklyAccess`)
- `GET /api/weekly/board?week=YYYY-MM-DD` - 주차 통합 조회 (항목+금주/직전 update+주간 메모, week는 월요일만)
- `GET /api/weekly/items?scope=archive|hospital&includeDone=1` - 아카이브·병원별 뷰 조회
- `POST /api/weekly/items` - 항목 생성 / `GET·PUT·DELETE /api/weekly/items/[id]` - 상세(updates 전체)·수정(complete/reopen/move/필드 — 미래 주 완료 400)·삭제
- `PUT /api/weekly/items/[id]/update` - 주차 진행 upsert (빈 content면 삭제)
- `POST /api/weekly/notes` / `PUT·DELETE /api/weekly/notes/[id]` - 주간 특이사항 엔트리 생성·수정·삭제
- `GET /api/weekly/masters` - 셀렉트 마스터 (병원·SEERS 활성 사용자·SEERS 부서=담당 팀)

### HIRA 병원
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/hira-hospitals` | HIRA 병원 목록 (검색/필터) |
| GET | `/api/hira-hospitals/[id]` | HIRA 병원 상세 |
| GET | `/api/hira-hospitals/sync` | 연동 잡 히스토리 목록 (최근 50건) |
| POST | `/api/hira-hospitals/sync` | 연동 잡 시작 (백그라운드 비동기, SUPER_ADMIN) |
| GET | `/api/hira-hospitals/sync/[id]` | 연동 잡 상세 + 로그 목록 (SUPER_ADMIN) |
| POST | `/api/hira-hospitals/detail-sync` | 병원상세정보연동 시작 — 종별 선택(병원급 7종), 허가병상수 갱신 (백그라운드 비동기, SUPER_ADMIN) |

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
| GET  | `/api/install-plans` | 설치계획 목록 (`?search=&hospitalCode=&statusId=&authorId=&orderBy=&order=` — 전체 반환) |
| POST | `/api/install-plans` | 설치계획 등록 |
| GET  | `/api/install-plans/[id]` | 설치계획 상세 |
| PUT  | `/api/install-plans/[id]` | 설치계획 수정 |
| DELETE | `/api/install-plans/[id]` | 설치계획 삭제 (ADMIN 이상) |

### 유지보수
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/maintenances` | 유지보수 목록 (`?search=`병원명 `&hospitalCode=&typeId=&statusId=&priority=` 필터) |
| POST | `/api/maintenances` | 유지보수 등록 |
| GET  | `/api/maintenances/[id]` | 유지보수 상세 |
| PUT  | `/api/maintenances/[id]` | 유지보수 수정 |
| DELETE | `/api/maintenances/[id]` | 유지보수 삭제 (ADMIN 이상) |
| GET/POST | `/api/maintenances/[id]/files`, `/api/maintenances/file-url` | 첨부파일 업로드·presigned URL |
| GET  | `/api/maintenances/[id]/logs` | 처리 기록 목록 (최신순, 작성자 포함) |
| POST | `/api/maintenances/[id]/logs` | 처리 기록 추가 (USER 이상, sanitize 후 저장) |
| PUT  | `/api/maintenances/[id]/logs/[logId]` | 처리 기록 수정 (본인 or ADMIN — 이관분은 ADMIN만) |
| DELETE | `/api/maintenances/[id]/logs/[logId]` | 처리 기록 삭제 (본인 or ADMIN) |

### 티켓 (P2 — 2026-07-23)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/tickets` | 티켓 목록 (`?queueId=&status=`복수`&severity=&mine=&unassigned=&ownerId=&hospitalCode=&ctiId=&q=&open=&page=&pageSize=`) — Sev↑·최신순 |
| POST | `/api/tickets` | 티켓 생성 (ctiId 필수 — L3, queueId 미지정 시 CTI 기본 큐 라우팅, `TK-YYYYMM-NNNNN` 채번, owner 지정 시 ASSIGNED 시작) |
| GET/PUT/DELETE | `/api/tickets/[id]` | 상세 · 기본 필드 수정(sev/cti 변경 이벤트 기록) · 삭제(ADMIN 이상) |
| POST | `/api/tickets/[id]/transition` | 상태 전이 `{to, pendingReasonId?, pendingNote?}` — **전이표 위반 400**, PENDING 사유 필수, RESOLVED→IN_PROGRESS=재오픈 |
| POST | `/api/tickets/[id]/assign` | owner 배정/해제 `{ownerId\|null}` — OPEN↔ASSIGNED 자동 연동 |
| POST | `/api/tickets/[id]/queue` | 큐 이관 `{queueId}` |
| PUT  | `/api/tickets/[id]/participants` | 참여자 전체 설정 `{userIds[]}` |
| POST | `/api/tickets/[id]/parent` | 마스터 연결/해제 `{parentId\|null}` — 2레벨 고정·CLOSED 부모 불가 |
| GET/PUT | `/api/settings/ticket-queues/[id]/members` | 큐 멤버 조회·전체 설정 `{userIds[]}` |
| GET/POST | `/api/tickets/[id]/logs` | 타임라인(코멘트+시스템 이벤트 시간순) · 코멘트 작성(sanitize) |
| PUT/DELETE | `/api/tickets/[id]/logs/[logId]` | 코멘트 수정·삭제 (본인 or ADMIN, 시스템 이벤트 불변) |
| GET | `/api/tickets/metrics` | 프로세스 지표 집계 (P12 — `?months=3\|6\|12\|0&queueId=&refType=`, raw SQL·KST 버킷. perOwner는 ADMIN 이상만 포함) |
| GET/POST, PUT/DELETE | `/api/settings/ticket-queues(/[id])` | 큐 마스터 (티켓 있으면 삭제 불가) |
| GET/POST, PUT/DELETE | `/api/settings/ticket-cti(/[id])` | CTI 3단계 트리 (하위·티켓·**자동생성 규칙** 있으면 삭제 불가, 기본 큐 지정, 목록에 `ruleUsage` 사용처 포함) |
| GET, PUT | `/api/settings/ticket-cti-rules` | 업무별 티켓 자동생성 규칙 (CTI·Assignment Group·설명 자동입력 — 조회 로그인, 변경 ADMIN) |
| GET/POST, PUT/DELETE | `/api/settings/ticket-pending-reasons(/[id])` | PENDING 사유 마스터 |

### CS 워크플로 — VOC접수 (2026-08-15 — `projects/cs_ticket_workflow_design.md`, 콜기록지는 같은 날 사용자 결정으로 제거)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET/POST | `/api/voc-receipts` | VOC 목록(`?from=&to=&statusId=&vocTypeId=&hospitalCode=&createdById=&q=`) · 등록(`VOC-YYYYMM-NNNN` 채번 + **연결 티켓 자동 생성**=CS 마스터, 단일 트랜잭션 — 생성자 자동 기록) |
| GET/PUT/DELETE | `/api/voc-receipts/[id]` | 상세(+하위 티켓 현황) · 수정(어댑터 동기화 — 담당은 티켓 단독 소유라 미포함) · 삭제(ADMIN — 연결 티켓 동반 삭제) |
| GET | `/api/voc-masters/channels` | VOC 접수 채널(VOC_CHANNEL) 조회 |
| GET/POST, PUT/DELETE | `/api/settings/voc-status(/[id])` | VOC 워크플로 상태 (+티켓 상태 매핑 필수, 사용 중 삭제 409) |
| GET/POST, PUT/DELETE | `/api/settings/voc-type(/[id])` | VOC 분류 마스터 (자동생성 규칙 조건 축, 사용 중 삭제 409) |

※ `/api/maintenances` POST는 `parentTicketId` 옵션 수용 (P3 — 생성 티켓을 마스터의 하위로 연결, 2레벨·CLOSED 검증). `/api/tickets/[id]` GET/PUT 응답에 `linkedWork`(어댑터 조립 배너 데이터) 포함. `/api/tickets` GET은 `sort`(code/severity/type/title/status/queue/owner/hospital/created/changed)+`order` 컬럼 정렬 지원 (2026-08-15)

### SLA 기준 (1.1 P2 — 전체 ADMIN 이상)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/settings/sla-policies` | 정책+타깃 목록(매트릭스 소스) + 편집 마스터(Assignment Group·CTI·상태·Sev·metric) |
| POST | `/api/settings/sla-policies` | 정책 행 추가 (스코프·우선순위, 타깃 검증 — DWELL 상태 필수·DOMAIN_DUE 지원 유형 검사) |
| PUT  | `/api/settings/sla-policies/[id]` | 스코프·우선순위·활성 + **타깃 전체 재설정**(빈 셀=감지 안 함). `applyToOpen:true`면 열린 티켓 **quiet 재계산**(알림 미발송) |
| DELETE | `/api/settings/sla-policies/[id]` | 정책 삭제 (타깃 cascade, 시계는 `policy_id` SET NULL로 이력 보존 후 다음 동기화에서 정리) |
| POST | `/api/settings/sla-policies/preview` | 저장 전 영향 미리보기 — 매칭 열린 티켓 수 + 즉시 초과가 될 건수 + 상위 10건 |

### 발송 채널·라우팅 (1.1 P3 — 전체 ADMIN 이상)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/settings/notify-routes` | 채널·규칙 목록 + 편집 마스터(이벤트·멘션 모드·Assignment Group·CTI·상태·Sev·metric) |
| POST | `/api/settings/notify-routes` | `{kind:'channel'}` 채널 추가 / `{kind:'route'}` 규칙 추가(일일 요약은 발송 시각 필수) / `{kind:'test'}` **연결 테스트 발송** |
| PUT  | `/api/settings/notify-routes/[id]?kind=channel\|route` | 채널·규칙 수정 (규칙은 조건·채널·멘션·발송 시각·활성) |
| DELETE | `/api/settings/notify-routes/[id]?kind=channel\|route` | 삭제 (채널 삭제 시 연결 규칙 cascade — 발송 대상 없는 규칙을 남기지 않음) |

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
| POST | `/api/vehicle-reservations` | 예약 생성 (USER 이상, 충돌 시 409 + 겹치는 예약 정보, **반납 미처리 건 보유 시 403**) |
| GET  | `/api/vehicle-reservations/[id]` | 예약 상세 |
| PUT  | `/api/vehicle-reservations/[id]` | 예약 수정 (본인 또는 ADMIN 이상, 충돌 재검사) |
| DELETE | `/api/vehicle-reservations/[id]` | 예약 취소 (본인 또는 ADMIN 이상, status=CANCELED) |

### GW 배치 플래너 (전체 ADMIN 이상)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/gateway-planner/jobs` | 잡 목록 (최근 100건) |
| POST | `/api/gateway-planner/jobs` | 도면 업로드 + 잡 생성 (multipart `file`/`title`/`page`, 백그라운드 파이프라인 시작) |
| GET | `/api/gateway-planner/jobs/[id]` | 잡 상세 (상태 폴링 겸용 — 분석·배치 결과 + presigned 이미지/PPTX URL) |
| DELETE | `/api/gateway-planner/jobs/[id]` | 잡 삭제 (S3 파일 포함) |
| PATCH | `/api/gateway-planner/jobs/[id]/scale` | 스케일 확정 (`mode`: confirm/manual(2점+m)/none) → 재배치 + PLACED |
| POST | `/api/gateway-planner/jobs/[id]/replace` | 현재 규칙으로 재배치 (AI 재호출 없음) |
| POST | `/api/gateway-planner/jobs/[id]/reanalyze` | AI 재분석 (원본부터 파이프라인 재수행, 스케일 초기화) |
| POST | `/api/gateway-planner/jobs/[id]/pptx` | PPTX 생성 → S3 저장 + presigned URL (PLACED 상태에서만) |
| GET/PUT | `/api/settings/gateway-planner` | 배치 규칙 조회/저장 (AppSetting `gw_planner_rules`) |
| GET | `/api/settings/ai-usage` | AI 어시스턴트 사용 집계 (`?from=&to=` — 월별 12개월·사용자별·병원별 Top10 + 단가) — ADMIN |
| PUT | `/api/settings/ai-usage` | AI 사용 단가 저장 (AppSetting `ai_usage_pricing`) — ADMIN |
| GET/PUT | `/api/settings/ai-assistant` | AI 어시스턴트 런타임 설정 — effort·캐시 TTL (AppSetting `ai_assistant_settings`, 모델 ID는 읽기 전용) — ADMIN |

### AI 어시스턴트
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/ai-assistant/chat` | **v2 에이전트 채팅** (`{ sessionId?, message, hospitalCode? }` → SSE 스트림: `text`/`tool_start`/`done`/`error`). USER 이상, 세션 자동 생성·소유자 검증 |
| GET | `/api/ai-assistant/sessions` | 내 세션 목록 (최근순 50개) |
| GET | `/api/ai-assistant/sessions/[id]` | 세션 메시지 전체 (본인만, 도구 라벨 포함) |
| DELETE | `/api/ai-assistant/sessions/[id]` | 세션 삭제 (본인 또는 ADMIN) |
| POST | `/api/ai-assistant/summarize` | AI 정제 (대화 → 마크다운 상담이력, `claude-sonnet-5`) |
| POST | `/api/ai-assistant/feedback` | 답변 피드백 저장 (`{messageId, verdict, reason?}` — 답변당 1건, 재전송 시 갱신) |
| GET | `/api/ai-assistant/feedback` | 피드백 집계 (최근 90일, 못 찾음 비율 포함) — ADMIN |

### 상담이력 (2026-07-26)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/consultations` | 목록 (`?hospitalCode=&consultedById=&from=&to=&q=&page=&pageSize=`) — 상담일 최신순. **SEERS 소속만**(VIEWER 포함) |
| POST | `/api/consultations` | 저장 (`{hospitalCode, content, aiSummary?, consultationTypeId?, sessionId?, consultedAt?}`) — `checkAiAccess`(SEERS + USER 이상), `CS-YYYYMM-NNNN` 발번 |
| GET  | `/api/consultations/[id]` | 상세 — SEERS 소속만 |
| PUT  | `/api/consultations/[id]` | 수정 (본문 변경 시 title 재추출) — 본인 or ADMIN |
| DELETE | `/api/consultations/[id]` | 삭제 — 본인 or ADMIN |

### 내부 알림·개인 대시보드 (1.1 P5·P6)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET  | `/api/notifications` | 내 알림 목록 + 미읽음 수 (`?unread=1&kind=&limit=`) — 본인 것만 |
| PATCH | `/api/notifications` | 읽음 처리 (`{ids?}` 없으면 전체) |
| GET/PUT | `/api/notifications/prefs` | 개인 수신 설정 (kind별 알림함·Slack DM, 행 없으면 기본값 반환) |
| GET  | `/api/me/dashboard` | 첫 화면 My Work 1콜 — 내 티켓 상태별·SLA 위험·내 그룹 미배정·최근 알림 |
| GET  | `/api/tickets/[id]/sla` | 티켓 SLA 시계 목록 (상세 패널용, 읽기 전용) |

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
| GET  | `/api/settings/udi-ledger` | 입출고대장 문서 메타(문서번호·양식번호·개정이력) 조회 |
| PUT  | `/api/settings/udi-ledger` | 입출고대장 문서 메타 수정 (ADMIN 이상) |
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
| GET  | `/api/settings/install-plan-status` | 설치계획 상태 목록 (2026-07-27 단일 축) |
| POST | `/api/settings/install-plan-status` | 설치계획 상태 추가 (티켓 상태 매핑 필수) |
| PUT  | `/api/settings/install-plan-status/[id]` | 설치계획 상태 수정 |
| DELETE | `/api/settings/install-plan-status/[id]` | 설치계획 상태 삭제 (ADMIN 이상, 사용 중 409) |
| GET  | `/api/settings/audit-logs` | 감사 로그 목록 (SUPER_ADMIN 전용, `?page=&limit=&search=&action=&resource=&from=&to=`) |

### 역할 관리 (RBAC Lite — SUPER_ADMIN 전용, 2026-08-04)
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/settings/app-roles` | 역할 전체 목록 (권한 키·멤버 포함) |
| POST | `/api/settings/app-roles` | 역할 생성 (`code` 대문자 스네이크·`name`·`description`) |
| PUT | `/api/settings/app-roles/[id]` | 역할 수정 (이름·설명·활성·순서 — 코드는 변경 불가) |
| DELETE | `/api/settings/app-roles/[id]` | 역할 삭제 (권한·멤버십 Cascade) |
| PUT | `/api/settings/app-roles/[id]/permissions` | 권한 키 전체 교체 (`lib/permissions.ts` 카탈로그 키만 허용) |
| POST | `/api/settings/app-roles/[id]/members` | 멤버 추가 (`{userId}`) |
| DELETE | `/api/settings/app-roles/[id]/members?userId=` | 멤버 제거(역할 회수) |
| GET | `/api/settings/app-roles/candidates` | 멤버 추가 후보 검색 (`?roleId=&search=` — 활성·미보유 사용자) |

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
| POST | `/api/wiki/pages` | 페이지 생성 — USER+, 감사로그 CREATE, `plainText` 자동. **HTML 문서 페이지**: `{pageType:'html', contentHtml}` (sanitize 후 저장, 최대 2MB) |
| GET  | `/api/wiki/pages/[id]` | 페이지 상세 |
| PUT  | `/api/wiki/pages/[id]` | 페이지 수정 — USER+, 감사로그 UPDATE. 본문 변경 시 **버전 스냅샷(2분 throttle) + `plainText`/백링크 동기화**. `icon`/`coverUrl`/`coverOffsetY`/`isTemplate` 수정, `baseUpdatedAt`로 **충돌 감지(409)**. HTML 페이지는 `contentHtml`로 문서 교체(블록 본문과 상호 배타 400) |
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
| GET  | `/api/wiki/project-issue-notes?projectCode=` | 프로젝트 이슈노트 페이지 조회 (본문 포함, 없으면 null) |
| POST | `/api/wiki/project-issue-notes` | 프로젝트 이슈노트 페이지 생성 (`{projectCode}`) — USER+, 프로젝트당 1개(멱등), 루트 카테고리 자동 보장 |
| GET  | `/api/wiki/hospital-notes?hospitalCode=` | 병원 노트 페이지 조회 (본문 포함, 없으면 null) |
| POST | `/api/wiki/hospital-notes` | 병원 노트 생성(`{hospitalCode}`, 멱등) / **상담이력 append**(`{hospitalCode, appendMd, consultationType?}` — 마크다운→블록 변환 후 날짜·상담자 헤더와 함께 하단 추가, 버전 스냅샷) — USER+ |

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
