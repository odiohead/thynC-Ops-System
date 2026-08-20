# 주간업무 관리툴 (Weekly Ops Review) — 설계안

> **상태: v1 완료 (PROD 배포 2026-08-19, 커밋 1fc2964)**
> 작성 2026-08-19. 쟁점 A~H 추천안 확정(사용자 승인) → 드래프트 → 1차 검토 반영(특이사항 보드·검색 셀렉트·안건 워딩·담당 팀·업무구분·프로젝트 연결 제거) → PROD 배포. 이후 작업은 유지보수·v2 후보(§9).

---

## 1. 배경·목적

사업본부의 주간 단위 업무 리뷰를 위한 관리 도구. 매주 주요 프로젝트(추진 과제)의 진척상황을 업데이트하고, 주요 이슈를 리스트로 관리해 놓치는 것이 없게 하며, 완료되면 완료 처리한다. 병원별로 걸려 있는 이슈도 조회할 수 있어야 한다. 구글 스프레드시트·먼데이닷컴 같은 범용 도구가 맞지 않아 운영관리시스템 웹서버에 자체 구축한다.

- **별도 페이지 신설** — 기존 화면에서 진입점(네비 메뉴) 없음, URL 직접 진입 (`/weekly`)
- **기존 계정 인증 활용** — middleware가 전 경로 로그인을 강제하므로 추가 작업 없이 성립 (middleware.ts:8-31, nav 미등록 선례 `/parking`·`/dashboard`)

### 스프레드시트 대비 이 도구의 핵심 차별점

**"항목은 지속되고, 주차별 진행내용만 쌓인다."**
스프레드시트 방식은 매주 시트를 복사하며 항목·이력이 흩어진다. 이 도구는 관리 항목(과제·이슈)을 1개의 레코드로 유지하고, 매주 그 항목에 해당 주차의 진행내용을 기록한다. 보드에서 **지난주 진행과 금주 진행을 나란히** 보며 리뷰하고, 항목 상세에서 주차별 전체 타임라인을 본다. 주차를 이동하면 과거 주의 진행내용 기록을 그대로 다시 볼 수 있다 (주차별로 버전되는 것은 진행내용이고, 상태·담당·목표일은 현재값 — §4 과거 주 렌더 규칙 참조).

---

## 2. 이 기능이 답해야 할 질문

| # | 질문 | 설계 반영 |
|---|---|---|
| Q1 | 이번 주, 주요 프로젝트들은 어디까지 진행됐나? 지난주 대비 무엇이 바뀌었나? | 주간 보드 — 항목별 [지난주 진행 \| 금주 진행] 병렬 컬럼 |
| Q2 | 지금 열려 있는 이슈는 무엇이고, 각각 누가 챙기나? 놓친 것은 없나? | 이슈 섹션 리스트 + 담당·상태·목표일 + **금주 미업데이트 항목 시각 강조** + 목표일 경과 강조 |
| Q3 | 특정 병원에 걸려 있는 이슈는 무엇인가? | 항목에 병원 연결(선택) + 병원별 그룹 뷰 |
| Q4 | 이번 주(또는 과거 특정 주)에 완료·논의된 것은 무엇인가? | 완료 처리(완료 주차 기록) + 주차 이동 + 완료 아카이브 + 주간 리뷰 메모 |

이 4개 질문에 기여하지 않는 필드·화면은 만들지 않는다 (§5 필드별 근거 참조).

---

## 3. 기존 기능과의 경계 (중복 검토)

| 기존 기능 | 성격 | 신규 툴과의 관계 |
|---|---|---|
| **티켓 시스템** (`/tickets`) | 접수→처리→종결되는 **개별 업무 건의 실행 파이프라인** (전이표·Sev·Assignment Group·SLA, 도메인 6종 어댑터) | 주간툴은 **경영 리뷰 레이어** — 주 단위 반복 업데이트가 본질이고 전이·SLA·배정 큐 개념이 없음. **티켓 파이프라인에 편입하지 않는다** (§10 비범위). 따라서 CLAUDE.md 티켓 규칙 3·5·6(어댑터 SOP·CTI 규칙·상태 매핑)의 적용 대상이 아님 |
| **`/tasks` 업무 현황** | P10에서 폐기 — `redirect('/tickets')`만 수행 (app/tasks/page.tsx:3-8). 레거시 Task 모델은 스키마에 잔존 | 재사용하지 않음 (폐기 축). 신규 테이블로 감 |
| **프로젝트 이슈노트** (위키 임베드) | 프로젝트당 1:1 **자유 문서**(BlockNote) — 구조화 리스트·상태·담당 필드 없음 | 중복 아님. 주간툴 항목은 구조화 행(담당·상태·주차 이력). 위키 쪽으로 가면 규칙 7·8(모듈 경계·wiki 스키마) 제약과 임베드 승인 예외가 필요하므로 **public 신규 테이블**로 감 |
| **병원 노트** (위키 임베드) | 병원당 1:1 자유 메모 | 동일 — 중복 아님. 병원별 이슈는 구조화 리스트가 필요 |
| **프로젝트 모듈** (`/projects`) | thynC **구축 공사** 레코드 (buildStatus 축) | 주간툴의 "주요 프로젝트"는 사업본부 추진 과제(구축 외 영업·인증·신규사업 등 포함 가능)로 더 넓은 개념. 구축 프로젝트와 겹치는 항목은 `projectCode` 연결(선택)로 참조 — 연동 지점 (§9) |
| **차량예약 주간 보드 / 대시보드 주간 현황** | 주차 개념 UI 선례 | 월요일 시작·`?week=YYYY-MM-DD` URL 동기화 패턴을 그대로 차용 (app/vehicle-reservations/page.tsx:31-82) |

---

## 4. 개념 모델

```
WeeklyItem (관리 항목 — 지속 레코드)
 ├─ 구분: 프로젝트(추진 과제) | 이슈
 ├─ 제목·배경설명·담당·상태(진행/보류/완료)·목표일·병원연결·프로젝트연결·정렬
 └─ WeeklyItemUpdate (주차별 진행 기록) × N
      └─ (항목, 주차) 당 1건 — 그 주의 진행내용 텍스트, 주중 수정 가능(upsert)

WeeklyWeekNote (주간 리뷰 메모 — 주차당 1건, 회의 노트용)
```

- **주차 정의**: 월요일 시작(코드베이스 전체 일관 선례), 주차 식별자는 **월요일 날짜 `YYYY-MM-DD`** (ISO 주차 표기 선례 없음 — 차량예약 `?week=` 방식 차용)
- **기록 시점 규약 (추천안 — 쟁점 G)**: 주차 W의 진행내용 = **W 주 리뷰(회의)에서 공유할 내용** — 회의 전에 작성하며, 지난 한 주의 실적과 이번 주 계획을 함께 적는다. 이 규약이 없으면 "금요일에 그 주 셀에 쓴 성실한 업데이트"가 다음 주 월요일 회의에서 '지난주' 컬럼으로 밀려 전원 미업데이트로 보이는 역전이 생김. 도구가 강제하지 않고 팀 규약으로 운영
- **완료 여부의 단일 소스 = `completedWeek`**: NULL이면 미완료. `status`는 `진행`/`보류` **2값**만 저장하고 '완료' 배지는 completedWeek 유무에서 파생 — 두 필드가 어긋나는 desync 경로를 구조적으로 차단
- **보드(주차 W) 구성 규칙**:
  - 표시 대상 = `생성 시각(KST 기준 날짜) < W+7일` AND (`completedWeek IS NULL` OR `completedWeek ≥ W`) — 항목 생성 전 과거 주에는 안 보이고, 완료 항목은 완료 주차까지만 보임 (시간대 파스 규칙은 §7 lib/weekly.ts)
  - `지난주 진행` = 해당 항목의 W 이전 update 중 **가장 최근** 1건 (직전 주가 아닐 수 있으므로 주차 라벨 병기, 예: "8/4주: …" — 오래 밀린 항목은 라벨 자체가 방치를 드러냄)
  - `금주 진행` = W의 update (없으면 빈 셀 — 클릭해 입력)
- **완료 처리**: 보고 있는 주차를 `completedWeek`로 기록하고 `completedAt`을 **원자적으로 동시 설정** → 그 주 보드에는 완료 배지·취소선으로 잔류(그 주에 완료됐음을 리뷰에서 확인), 다음 주부터 제외. confirm에 귀속 주차를 명시("8/17 주로 완료 처리합니다"), 과거 주를 보며 완료할 때는 "이번 주 보드에는 표시되지 않습니다" 경고 추가. 재개(완료 취소)는 두 필드 동시 해제
- **과거 주 렌더 규칙**: 취소선·완료 배지는 `completedWeek === W`인 주에만 적용. `W < completedWeek`인 과거 주에서는 일반 행으로 표시(당시엔 진행 중이었으므로). 상태(진행/보류)·담당·목표일은 이력을 갖지 않는 **현재값**임을 유의 — 주차별로 버전되는 것은 진행내용뿐
- **보류**: 목록에 남기되 배지로 구분 (이슈를 놓치지 않기 위해 숨기지 않음)

---

## 5. 데이터 모델

### weekly_items (관리 항목)

| 컬럼 | 타입 | 근거 (답하는 질문) |
|---|---|---|
| `id` | SERIAL PK | — |
| `kind` | TEXT NOT NULL | 보드 섹션 구분: `PROJECT`(**주요 안건** — 2026-08-19 1차 검토에서 라벨 변경, DB 값 유지) / `ISSUE`(주요 이슈) — Q1/Q2의 두 리스트 |
| `biz_type` | TEXT NOT NULL DEFAULT '공통' | **업무구분** (1차 검토 추가) — `thynC`/`mobiCARE`/`공통` 고정 3값, 코드 상수 (§5c) |
| `title` | TEXT NOT NULL | 항목명 (필수 유일 입력) |
| `detail` | TEXT (nullable) | 배경 설명 — 회의에서 처음 보는 사람용 맥락. 보드에는 안 나오고 상세에서만 |
| `status` | TEXT NOT NULL DEFAULT '진행' | `진행`/`보류` **2값** — Q2 보류 구분. '완료'는 저장하지 않음(completedWeek 파생, §4). 코드 상수 고정 (§5c) |
| `hospital_code` | TEXT NULL → FK hospitals(hospital_code) ON DELETE SET NULL | Q3 병원별 뷰의 축. 병원 무관 항목은 NULL |
| ~~`project_code`~~ | — | **제거됨** (2026-08-19 1차 검토 — 사용자 판단: 기존 운영 시스템 프로젝트 연결 불필요. `20260819171543_weekly_items_revise`에서 DROP) |
| `owner_team_id` | INTEGER NULL → FK departments(id) ON DELETE SET NULL | **담당 팀** (1차 검토 추가) — SEERS 부서 마스터 재사용 |
| `owner_id` | TEXT NULL → FK users(id) ON DELETE SET NULL | Q2 "누가 챙기나" — 단일 담당 (쟁점 C) |
| `target_date` | DATE NULL | Q2 "놓친 것 없나" — 경과 시 적색 강조. 강제 아님 |
| `completed_week` | DATE NULL | **완료 여부의 단일 소스** — 완료 주차(월요일), NULL이면 미완료. 보드 표시·아카이브 정렬 기준 |
| `completed_at` | TIMESTAMP(3) NULL | 완료 시각 (아카이브 정렬용) |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | 회의에서 읽는 순서 — 섹션 내 수동 정렬(↑↓). 우선순위 필드는 두지 않음(수동 정렬로 대체, 쟁점 D) |
| `created_by` | TEXT NULL → FK users(id) ON DELETE SET NULL | 등록자 표시 |
| `created_at` / `updated_at` | TIMESTAMP(3) | 관례 쌍 |

인덱스: `kind`, `hospital_code`, `status`.

### weekly_item_updates (주차별 진행 기록)

| 컬럼 | 타입 | 근거 |
|---|---|---|
| `id` | SERIAL PK | — |
| `item_id` | INTEGER NOT NULL → FK weekly_items(id) ON DELETE CASCADE | 항목 귀속 |
| `week_start` | DATE NOT NULL | 주차 키(월요일). **UNIQUE(item_id, week_start)** — 주차당 1건 upsert |
| `content` | TEXT NOT NULL | 진행내용 — plain text 여러 줄 (쟁점 E) |
| `updated_by` | TEXT NULL → FK users(id) ON DELETE SET NULL | 마지막 작성자 |
| `created_at` / `updated_at` | TIMESTAMP(3) | 관례 쌍 |

인덱스: `week_start`.

### weekly_week_notes (주간 특이사항 — 2026-08-19 1차 검토 개정: 주차당 1건 메모 → 주차별 N건 엔트리 보드)

| 컬럼 | 타입 | 근거 |
|---|---|---|
| `id` / `week_start` DATE(INDEX) / `content` TEXT / `created_by`·`updated_by` FK / `created_at` / `updated_at` | | Q4 + 1차 검토 피드백 — "엄격하게 레코드로 남을 데이터가 아니라 그 주에 말할 컨텐츠"의 수용처. 주차별 여러 건을 각자 기재(작성자 표기), 보드 최상단 섹션으로 상시 노출. 구 UNIQUE(week_start) 단일 메모는 폐기 (마이그레이션 `20260819152518_weekly_notes_entries`) |

### 5b. Prisma 반영

- 모델 `WeeklyItem` / `WeeklyItemUpdate` / `WeeklyWeekNote`, 하우스 컨벤션(camelCase + `@map`, `@@map` 복수형 snake_case, `@@schema("public")`, createdAt/updatedAt 쌍) — HospitalServer 선례 (prisma/schema.prisma:478-494)
- 역방향 relation 추가 필요: `User`에 **4개** — WeeklyItem.owner / WeeklyItem.createdBy / WeeklyItemUpdate.updatedBy / WeeklyWeekNote.updatedBy (named relation이 Prisma 규칙상 강제되는 곳은 관계가 2개인 User↔WeeklyItem뿐이나 관례상 전부 명명). `Hospital.weeklyItems`, `Project.weeklyItems`도 추가
- 마이그레이션은 수동 패턴 (psql 직접 실행 → migration.sql 작성 → `migrate resolve --applied` → schema 수동 갱신 + generate)

### 5c. 상태·구분 값 — 코드 상수 (DB 마스터 아님)

`lib/weekly.ts` 단일 소스: `WEEKLY_ITEM_KINDS = ['PROJECT','ISSUE']`, `WEEKLY_ITEM_STATUSES = ['진행','보류']` + 타입가드. 화면의 배지 3종(진행/보류/완료)은 `completedWeek ? '완료' : status` 파생 — 표시 라벨 헬퍼도 이 파일에. `lib/hospitalSystem.ts`의 EMR_LINK_STATUSES 선례(코드 상수 + TEXT 컬럼, 클라이언트 안전 — prisma import 금지)를 따른다. StatusCode 카테고리로 가지 않는 이유: 상태 값은 도구의 동작(보드 표시 규칙)과 결합돼 있어 사용자가 바꿀 대상이 아니고, 설정 화면·nav 시드 비용이 불필요. 티켓 미편입이므로 ticket_status 매핑 의무도 없음.

---

## 6. 화면 설계 — `/weekly` (단일 페이지, 클라이언트 컴포넌트)

일반 네비 셸 유지(FULLSCREEN_PATHS 미등록 — 로그인한 본인만 URL로 진입하는 도구이므로 기존 셸이 자연스러움). nav_menu_items에는 등록하지 않음.

### 6a. 주간 보드 (기본 뷰)

```
┌ 주간업무 관리 ──────────────────────────────────────────── [+ 항목 추가] ┐
│  ◀ 이전 주   오늘   다음 주 ▶      2026년 8월 17일 ~ 8월 23일             │
│  [ 주간 보드 ]  [ 병원별 ]  [ 완료 아카이브 ]                              │
│                                                                          │
│  ■ 주간 특이사항 (주차별 N건 자유 기재 — 작성자 표기, +추가/수정/삭제)       │
│                                                                          │
│  ■ 주요 프로젝트 ─────────────────────────────────────────────────────── │
│  ┌──┬────────────────┬──────┬──────┬────────┬──────────────┬──────────────┬───┐ │
│  │↑↓│ 항목            │ 담당  │ 상태  │ 목표일  │ 지난주 진행    │ 금주 진행     │ ⋯ │ │
│  ├──┼────────────────┼──────┼──────┼────────┼──────────────┼──────────────┼───┤ │
│  │  │ ◯◯병원 구축     │ 홍길동│ 진행  │ 09-30  │ 8/10주: 병동  │ 서버 반입,    │완료│ │
│  │  │ [◯◯병원][구축중] │      │      │        │ 실사 완료      │ 22일 교육 예정│상세│ │
│  │  │ 원격모니터링 인증  │  —   │ 보류  │   —    │ 8/4주: 서류   │ (클릭하여 입력)│   │ │
│  ├──┴────────────────┴──────┴──────┴────────┴──────────────┴──────────────┴───┤ │
│  │  + 항목 추가 (인라인 행)                                                     │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ■ 주요 이슈 ──────────────────────────────── (동일 컬럼 구조) ─────────── │
│  │ (등록된 이슈가 없습니다 — + 항목 추가)   ← 빈 상태에도 컬럼 헤더 상시 노출  │
└──────────────────────────────────────────────────────────────────────────┘
```

- **주차 네비**: `mondayOf` + `addDays(±7)` + `?week=YYYY-MM-DD` URL 동기화(`history.replaceState`) — 차량예약 보드 패턴 그대로 (app/vehicle-reservations/page.tsx:31-82, 256-280). 범위 표기도 동일 (`2026년 8월 17일 ~ 8월 23일`)
- **항목 셀**: 제목 + 아래 줄에 병원 배지·프로젝트 연결 시 buildStatus 배지(StatusBadge — DB 색). 제목 클릭 → 상세 모달
- **지난주 진행**: 읽기 전용. W 이전 최근 update + 주차 라벨(직전 주가 아니면 "8/4주:" 식 명시). 없으면 `—`
- **금주 진행**: 셀 클릭 → textarea 인라인 편집(저장/취소) — SystemStatusCard 행 교체 패턴의 셀 버전 (app/hospitals/[code]/_components/SystemStatusCard.tsx:106-149). 저장 = 해당 주차 upsert. 셀 내용은 §4 기록 시점 규약(회의 전 작성 — 지난주 실적 + 금주 계획)을 따름
- **미업데이트 강조**: 금주 진행 미입력 셀의 연한 amber 배경은 **`진행` 상태의 미완료 항목에만** 적용 (Q2 놓치지 않기). 보류·완료 행은 제외 — 보류 항목은 정의상 매주 update가 없으므로 포함하면 보드가 상시 amber가 되어 신호가 소음이 됨(경고 피로). 보류 항목의 방치는 지난주 진행의 주차 라벨("8/4주:")이 드러냄
- **진행 셀 표시**: 두 텍스트 컬럼은 3~4줄 line-clamp — 초과분은 셀 클릭(편집 진입) 또는 상세 모달에서 전체 표시. 회의 프로젝터에서 행 높이 폭주 방지
- **목표일**: 경과(오늘 > 목표일, 미완료) 시 적색 표기
- **행 액션(⋯)**: 완료(→ 보고 있는 주차로 완료 처리, confirm에 귀속 주차 명시 — §4), 상세. 완료 행은 `completedWeek === W`인 주 보드에만 취소선 + `완료` 배지로 잔류 (과거 주 렌더 규칙 §4)
- **정렬**: ↑↓ 버튼 (sortOrder, 신규는 `(last ?? 0) + 10`)
- **+ 항목 추가**: 섹션 하단 인라인 행 — 제목(필수)·담당 select·병원 select(검색)·목표일. 저장 시 즉시 행 추가. 상세 필드는 상세 모달에서 보완
- **빈 상태**: 두 섹션 헤더 + 컬럼 헤더는 데이터 없이도 상시 노출, tbody에 EmptyState 행 (설계 원칙 — 빈 상태에서 전체 필드 구조 검토 가능)
- **상태 배지**: 진행=primary·보류=warning·완료(completedWeek 파생)=success (ui/Badge 시멘틱 variant — 고정 3종이므로 DB 색 마스터 불필요)

### 6b. 항목 상세 (Modal — 모바일 자동 바텀시트)

```
┌ 항목 상세 ───────────────────────────────────────────┐
│ 구분 [프로젝트 ▾]  상태 [진행 ▾]        [완료 처리]    │
│ 제목 [                                  ]            │
│ 병원 [검색 select ▾]   프로젝트 연결 [select ▾]        │
│ 담당 [select ▾]        목표일 [date]                  │
│ 배경 설명 [textarea]                                  │
│ ── 주차별 진행 이력 (역순) ──────────────────────────  │
│  8/17주  서버 반입, 22일 교육 예정          (작성 홍길동)│
│  8/10주  병동 실사 완료                              │
│ ──────────────────────────────────────────────────  │
│ [삭제]                              [취소] [저장]     │
└──────────────────────────────────────────────────────┘
```

- 전 필드 편집 + 전체 타임라인 (데이터는 `GET /api/weekly/items/[id]` — updates 전체 include). 과거 주차 진행내용도 이 화면(또는 보드에서 과거 주로 이동)에서 수정 가능 — 회의록 보완 허용
- 상태 select는 **진행/보류 2값만** — 완료는 [완료 처리] 버튼 전용(completedWeek 원자 세팅, §4), 완료 항목이면 [재개] 버튼으로 교체
- 삭제는 confirm() + 감사 로그 (update 이력 CASCADE 삭제이므로 확인 문구에 명시)

### 6c. 병원별 뷰 (탭 2)

`hospital_code`가 있는 활성 항목을 병원별 그룹 헤더로 묶은 동일 컬럼 테이블. 병원 무관 항목은 "(병원 미지정)" 그룹. 카드 나열이 아니라 그룹 테이블 (설계 원칙 4). **'완료 포함' 토글** 제공 — 고객사 방문 전 그 병원에 걸렸던 이슈까지 병원 축으로 훑는 용도 (P2).

### 6d. 완료 아카이브 (탭 3)

완료 항목 전체 — 완료 주차 역순 테이블 (항목·구분·병원·담당·완료주차·마지막 진행내용). 행 클릭 → 상세(재개 가능).

### 6e. 모바일

데스크톱 우선(리뷰 회의 도구) — 테이블은 `overflow-x-auto` + `min-w` (차량예약 보드 패턴 B). 카드 전환(패턴 A)은 P3 후보로 보류.

---

## 7. API 설계

경로 `app/api/weekly/*`. 전부 `export const dynamic = 'force-dynamic'`, 수동 검증(zod 없음), 에러 `{ error }`, 성공은 리소스 키 객체, mutation 성공 시 `logAudit` + 클라이언트 `router.refresh()` 컨벤션.

| 메서드·경로 | 동작 | 권한 |
|---|---|---|
| `GET /api/weekly/board?week=YYYY-MM-DD` | 주차 통합 조회 — 표시 대상 항목(+병원·프로젝트 buildStatus·담당 include) + 해당 주 update + 직전 최근 update + 주간 메모. `week`는 월요일 날짜만 허용(서버 검증). 금주/직전 update는 `include: { updates: { where: { weekStart: { lte: W } }, orderBy: { weekStart: 'desc' }, take: 2 } }` 한 번으로 가져와 첫 행의 `weekStart === W` 여부로 분리 (같은 relation을 다른 필터로 include 2회는 Prisma 불가) | 조회 게이트 |
| `GET /api/weekly/items?scope=archive\|hospital` | 아카이브·병원별 뷰 조회 (병원별은 완료 포함 토글 파라미터) | 조회 게이트 |
| `GET /api/weekly/items/[id]` | 항목 상세 — updates **전체**(역순) + 병원·프로젝트·담당 include (상세 모달 타임라인 데이터 소스) | 조회 게이트 |
| `POST /api/weekly/items` | 항목 생성 (kind·title 필수, 나머지 선택 — 화이트리스트 검증) | 쓰기 게이트 |
| `PUT /api/weekly/items/[id]` | 필드 수정(status는 진행/보류만 수용 — '완료' 직접 설정 400)·sortOrder·**완료/재개는 전용 액션** (`{ complete: { week } }` → completedWeek+completedAt 원자 세팅 / `{ reopen: true }` → 동시 해제) | 쓰기 게이트 |
| `DELETE /api/weekly/items/[id]` | 항목 삭제 (updates CASCADE) | 쓰기 게이트 |
| `PUT /api/weekly/items/[id]/update` | body `{ week, content }` — 주차 진행 upsert (빈 content면 해당 주 레코드 삭제) | 쓰기 게이트 |
| `POST /api/weekly/notes` | body `{ week, content }` — 주간 특이사항 엔트리 생성 (2026-08-19 개정 — 구 `PUT week-note` 단일 upsert 대체) | 쓰기 게이트 |
| `PUT·DELETE /api/weekly/notes/[id]` | 특이사항 엔트리 수정·삭제 | 쓰기 게이트 |

감사 로그 resource: `weekly_item` / `weekly_item_update` / `weekly_week_note`.

### lib/weekly.ts (단일 소스)

- 상수·타입가드·파생 상태 라벨 헬퍼 (§5c) — 클라이언트 안전 (prisma import 금지). 접근 게이트는 prisma를 쓰므로 서버 전용 파일(`lib/weeklyAccess.ts`)로 분리 (hospitalSystem.ts / sales.ts 분리 선례와 동일 이유)
- `checkWeeklyAccess(user, opts?: { write?: boolean })` — checkSalesAccess 패턴 (lib/sales.ts:16-48): DB 실시간 조회로 isActive·소속 검사, 반환 `{ status, error } | null`
- 주차 유틸: `isMondayYmd(s)` 등 서버 검증용 (주차 계산 자체는 클라이언트 로컬 기준 — 차량예약 선례)
- **시간대 파스 규칙** (혼용 방지 — 단일 소스로 명문화):
  - DATE 컬럼(`week_start`·`completed_week`)의 쓰기·비교는 **UTC 자정 파스** `new Date('YYYY-MM-DD')` — 기존 `@db.Date` 관례. KST 로컬 파스를 쓰면 UTC 변환 시 하루 전 날짜로 저장되는 함정
  - `created_at`(UTC TIMESTAMP) 경계 비교(`생성 < W+7일`)만 **KST 자정 인스턴트** `new Date(\`${ymd}T00:00:00+09:00\`)`와 비교 — UTC 자정과 비교하면 월요일 00~09시(KST) 생성 항목이 이전 주 보드에 노출되는 9시간 오차
  - `isMondayYmd`는 `getUTCDay() === 1` 기준

---

## 8. 권한 (쟁점 A — 추천안 기준)

- **조회**: 로그인 + **SEERS 소속** (사업본부 내부 리뷰 자료 — 고객사 소속 계정 차단). `WEEKLY_ALLOWED_ORG_CODES = ['SEERS']` 상수, DB 실시간 조회 (checkAiAccess 주석 선례: JWT 소속은 최대 7일 stale)
- **쓰기**: 위 + `isUserOrAbove` (VIEWER 읽기 전용 원칙 준수)
- 페이지는 클라이언트 컴포넌트 + API 게이트 방식 (/parking 선례) — 페이지 접근 자체는 middleware 로그인 강제로 충분, 데이터는 전부 게이트 통과 API 경유
- RBAC Lite 권한 키는 신설하지 않음 — 추후 SEERS 외 예외 인원이 생기면 `weekly.access` 키를 카탈로그에 추가(가산 패턴)하는 확장 여지만 기록

---

## 9. 기존 데이터 연동 (v1 시드 + v2 방향)

**v1에 포함**:
- 병원 연결 (`hospital_code` FK) — 병원별 뷰의 축, 병원 배지
- ~~프로젝트 연결 (`project_code` FK)~~ — **2026-08-19 1차 검토에서 제거** (사용자 판단: 불필요. 쟁점 H 번복)
- 담당 팀 (`owner_team_id` → departments) — 기존 부서 마스터 재사용 (신규 마스터 신설 없음)

**v2 후보 (이번 범위 아님)**:
- 항목↔티켓/유지보수 소프트 링크 (참조 표시만 — 파이프라인 편입 아님)
- AI 어시스턴트 read-only 도구 노출 (`lib/ai/tools.ts`에 주간 항목 조회 추가)
- Slack 주간 요약 발송 (티켓 규칙 1 — `lib/notify.ts` 경유 필요)
- 프로젝트 모듈에서 "주간 관리 중" 표시 역참조

---

## 10. 비범위 (Non-goals)

- **티켓 파이프라인 편입 안 함** — 상태 전이·Sev·Assignment Group·SLA·CTI 없음. 근거: 주간툴은 주 단위 리뷰 레이어이고, 개별 실행 건은 이미 티켓·도메인 모듈이 담당. 편입 시 어댑터 SOP·상태 매핑·CTI 규칙이 전부 따라와 도구가 무거워짐
- Slack 알림 없음 (v2 후보)
- 개인 할일(to-do) 관리 아님 — 회의체 공유 항목만
- 간트/일정 시각화 아님 (기존 `/projects/calendar` 존재)
- 위키 모듈 관여 없음 (public 스키마·메인 모듈로만 구성 — 규칙 7·8 비적용)

---

## 11. 구현 단계

| 단계 | 내용 | 산출물 |
|---|---|---|
| **P1 — 코어** | 마이그레이션(테이블 3) + Prisma 모델·역방향 relation + `lib/weekly.ts`(+접근 게이트) + API 8종 + 주간 보드(주차 네비·섹션 2·인라인 금주 편집·항목 추가·완료·정렬·주간 메모) + 항목 상세 모달 | `/weekly` 동작 (보드+상세) |
| **P2 — 보조 뷰** | 병원별 탭(완료 포함 토글) + 완료 아카이브 탭 + 담당자 필터(보드 상단 select — 회의 전 "내 항목" 훑기용) + 미업데이트/목표일 경과 강조 마감 | 탭 3종 완성 |
| **P3 — 후보 (별도 승인)** | 모바일 카드 전환 · v2 연동 (§9) | — |

완료 시 관례에 따라 DEV_HISTORY.md 기록, README.md(기능·API·스키마·디렉토리) 갱신. 빌드·push는 사용자 명시 요청 시에만.

---

## 12. 쟁점 — 사용자 확인 필요

| # | 쟁점 | 추천 | 대안 |
|---|---|---|---|
| **A** | 접근 범위 | **SEERS 소속 전원 조회 + USER 이상 쓰기** (§8) | 로그인 전원 허용(/parking식) / ADMIN 이상만 |
| **B** | 섹션 구성 | **'주요 프로젝트'·'주요 이슈' 2섹션 고정** (kind 상수) | 자유 그룹(카테고리 마스터 관리) — 필요해지면 확장 |
| **C** | 담당자 | **단일 담당(선택)** — 주간 항목은 "챙기는 사람 1명"이 명확한 게 리뷰에 유리 | 복수 담당 N:M (InstallPlanAssignee 패턴) |
| **D** | 우선순위 필드 | **없음** — 섹션 내 수동 정렬(↑↓)이 회의 순서를 대신 | 상/중/하 필드 추가 |
| **E** | 진행내용 형식 | **plain text 여러 줄** (보드 셀 가독성·인라인 편집 단순성) | RichTextEditor(HTML) — 상세 모달 한정 적용 절충 가능 |
| **F** | 주간 리뷰 메모 | **포함** (주차당 1건, 접이식 textarea) → **2026-08-19 1차 검토에서 '주간 특이사항' N건 엔트리 보드로 개정** (§5 weekly_week_notes) | 제외 (항목만으로 운영) |
| **G** | 기록 시점 규약 | **주차 W 셀 = W 주 회의에서 공유할 내용** (회의 전 작성: 지난주 실적 + 금주 계획 혼합, §4) — 기존에 주간보고를 언제·어떤 리듬으로 써왔는지에 맞춰야 함 | '실적'과 '계획'을 별도 2컬럼(2필드)으로 분리 — 주간보고 관행이 그렇다면 |
| **H** | 프로젝트 연결의 v1 포함 | ~~포함~~ → **2026-08-19 1차 검토에서 사용자 판단으로 제거 확정** (컬럼 DROP) | — |

---

## 부록 — 마이그레이션 SQL 초안

```sql
-- 주간업무 관리툴 (2026-08-XX) — 관리 항목 + 주차별 진행 + 주간 메모
-- 상태·구분 값은 lib/weekly.ts 코드 상수 (DB 마스터 아님)

CREATE TABLE weekly_items (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                       -- 'PROJECT' | 'ISSUE'
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT '진행',       -- '진행' | '보류' (완료는 completed_week로 판정 — 단일 소스)
  hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE SET NULL,
  project_code TEXT REFERENCES projects(project_code) ON DELETE SET NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_date DATE,
  completed_week DATE,                      -- 완료 주차(월요일) — NULL이면 미완료 (완료 여부 단일 소스)
  completed_at TIMESTAMP(3),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX weekly_items_kind_idx ON weekly_items(kind);
CREATE INDEX weekly_items_hospital_code_idx ON weekly_items(hospital_code);
CREATE INDEX weekly_items_status_idx ON weekly_items(status);

CREATE TABLE weekly_item_updates (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES weekly_items(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,                 -- 주차 키(월요일)
  content TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  UNIQUE (item_id, week_start)
);
CREATE INDEX weekly_item_updates_week_start_idx ON weekly_item_updates(week_start);

CREATE TABLE weekly_week_notes (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
```

---

## 개정 이력 (구현 후)

- **2026-08-20 — 2차 검토 반영**
  1. 보드 필드 순서: `업무구분 · 안건 · 지난주 진행 · 금주 진행`을 앞 4개로 고정(한 화면 노출 보장), 담당 팀·담당·상태·목표일·완료는 후열(횡스크롤 허용, min-w 1512px). 병원별·아카이브 리스트도 '최근 진행'을 안건 뒤로 이동
  2. 주간 특이사항에 작성자 소속팀 필드 추가 (`WeeklyNoteDto.createdByTeamName` — 표시 전용)
  3. 진행내용·특이사항 입력을 리치텍스트로 전환 — `WeeklyRichEditor`(Tiptap: 마크다운 입력 규칙 + 글자색·형광펜), 저장 HTML(서버 sanitize), 표시 `RichContent`(구 plain text 하위호환). §5의 "plain text 저장" 결정을 대체
