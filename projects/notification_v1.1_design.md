# 알림체계 개선 설계안 — 운영관리시스템 1.1

> **상태: 설계 확정 — P1~P6 구현 완료 (2026-07-26), P7(지표·배포) 대기**
> 작성 2026-07-26 · 대상 버전 1.1 · 선행 버전 1.0(2026-07-26 마감)
> 진행: P0 ✅ · **P1 SLA 엔진 ✅** · **P2 SLA 설정 화면 ✅** · **P3 채널·라우팅 ✅** · **P4 초과 즉시 + 일 1회 요약 ✅** · **P5 내부 알림함 ✅**(emit·벨·알림함·개인 설정, 스모크 13/13) · **P6 첫 화면 개인화 ✅**(My Work·SLA 필터·시계 패널) · P7 지표 확장 + PROD 배포 ← 남음
> 스모크 합계 **62/62 통과** (sla 31 · routes 18 · notify-center 13)
> 관련 기존 문서: `function_notification.md`(1.0 Slack 알림), `ticket_dev_schedule.md`(P11 SLA·알림 재편), `ticket_system_design.md`

---

## 1. 배경과 목표

### 1.1 사용자 요구사항 (원문 요약)

| # | 요구사항 |
|---|---|
| R1 | **Slack을 메인 핵심 알림체계로 가져가지 않는다** |
| R2 | 시스템 안에서 **본인 계정 알림을 확인**할 수 있어야 한다 |
| R3 | 궁극 목표는 아마존처럼 **별도 페이저 앱** — 단, 이번 범위 아님 |
| R4 | SLA가 지난 **그 시점에** 특정 채널로 Slack 알림 |
| R5 | SLA 지난 **전체 리스트를 하루 한 번 특정 시각**에 채널로 알림 |
| R6 | **특정 티켓 유형**의 생성·상태 변경 시 **특정 채널**로 알림 |
| R7 | 티켓 유형도 여러 개, 공지 채널도 여러 개 — **상황에 따른 제어 필요** |
| R8 | **첫 화면 개인화** — 기본 대시보드 정보 + 나의 티켓 현황 |
| R9 | SLA 지난 티켓을 **시스템 안에서 인지** 가능해야 한다 |
| R10 | **SLA 개념 세분화** — 등급×생성→완료 단일 측정은 부족. 장기 프로젝트, CS의 "몇 시간째 미배정" 같은 축이 필요하고 **세밀한 커스터마이징 제어**가 필요 |

### 1.2 설계 원칙 전환 (이번 개선의 핵심)

1.0의 구조는 **"알림 = Slack 발송 행위"** 였다. `lib/notify.ts`가 이벤트를 감지해 Slack으로 보내고, 그 흔적을 `notification_logs`에 남긴다. 시스템 안에는 사용자가 볼 알림이 존재하지 않는다.

1.1은 이 관계를 뒤집는다.

```
[1.0]  티켓 이벤트 ──> Slack 발송 ──> notification_logs (발송 기록)
                                        └ 사용자가 볼 알림은 시스템에 없음

[1.1]  티켓 이벤트 ──> 알림 레코드(notifications) ─┬─> 시스템 내부 알림함·벨·첫 화면
        SLA 시계 초과 ──┘                          ├─> Slack 채널 어댑터 (라우팅 규칙)
                                                   └─> (향후) 페이저 앱 푸시
```

- **알림의 원본은 DB(`notifications`)**, Slack은 그 중 일부를 밖으로 내보내는 **어댑터 하나**로 격하 (R1)
- 이 구조가 곧 **페이저 앱의 전제**다. 푸시할 대상 데이터가 이미 사용자별로 DB에 쌓여 있어야 앱을 붙일 수 있다 (R3)
- SLA는 **"시계(clock)"** 라는 1급 개념으로 승격. 티켓 하나가 여러 시계를 동시에 갖는다 (R10)

### 1.3 범위

**포함**: SLA 모델 재설계 / Slack 채널 라우팅 규칙 / SLA 초과 즉시 알림 / 일 1회 다이제스트 / 시스템 내부 알림함·벨 / 첫 화면 개인화 / 개인 알림 설정 / 티켓 지표에 SLA metric 반영

**제외**: 페이저 앱(모바일 네이티브·웹푸시·PWA), 이메일 알림, 공휴일 캘린더, 알림 에스컬레이션 체인(1차 무응답 시 상급자), Slack 인터랙티브 액션(버튼으로 상태 변경)

---

## 2. 현재 형상 진단 (코드 근거)

### 2.1 Slack 알림 — 되는 것과 안 되는 것

| 항목 | 현재 | 근거 |
|---|---|---|
| 이벤트 발송 | 티켓 생성·상태변경·큐이관·Sev 에스컬레이션 | `lib/notify.ts` `notifyTicketCreated`/`notifyTicketChanged` |
| 변경 감지 | sig v2 4축(`status\|owner\|sev\|queue`) 비교로 실변경만 | `ticketSig()`, `parseSig()` |
| **채널** | **단일 채널 고정** — 이벤트는 `SLACK_CHANNEL_MAIN`, 지연 요약은 `SLACK_CHANNEL_DELAY \|\| MAIN` | `notifyTicketCreated` L712, `sendDelayChannelSummary` L901 |
| 유형별 제어 | 타입 on/off만 (`notify_types_enabled`) — **유형→채널 매핑 불가** | `getTypesEnabled()` |
| 이벤트별 제어 | 4종 토글 (`notify_event_toggles`) — 전 채널 공통 | `getEventToggles()` |
| SLA 알림 | **주기 요약만** (off/1h/6h/24h) — 초과 시점 알림 없음 | `lib/notify-scheduler.ts` `INTERVAL_MAP` |
| 다이제스트 | 시각 지정 불가. 24h 주기는 "서버 기동 후 24시간마다" | 같은 파일, `setInterval` |
| 요약 재발송 방지 | 12시간 내 동일 멤버십이면 스킵 | `sendDelayChannelSummary` L890 |

**결론**: R4(초과 즉시)·R5(지정 시각)·R6·R7(유형×채널 다중 라우팅)은 **현재 구조로 불가능**하다. 채널이 env 상수로 박혀 있고, 발송 시점이 스케줄러 주기에 종속된다.

### 2.2 SLA — 단일 시계의 한계

현재 판정(`lib/delay-rules.ts`):

```
dueAt = createdAt + Sev별 목표일     (SEV1 1일 / SEV2 1일 / SEV3 3일 / SEV4 7일 / SEV5 미적용)
초과 판정 = KST 자정 기준 일(day) 단위 비교
PENDING = 시계 정지 / PROJECT = endDateExpected가 dueAt 소유
보조 축 = 상태 체류(notify_status_dwell, 기본 전부 미사용)
```

| 한계 | 구체적 문제 | 요구 |
|---|---|---|
| **측정 축이 1개** | 생성→완료만 본다. "생성 후 3시간째 미배정"을 잡을 수 없다 | R10 |
| **시간 단위 부재** | `overdueDays()`가 일 단위 정수 → "2시간 내 배정" 표현 자체가 불가 | R10 |
| **차별화 축이 Sev뿐** | 그룹·CTI·유형별로 다른 목표를 줄 수 없다. CS 티켓과 구축 프로젝트가 같은 규칙 | R10 |
| **장기 건 처리가 예외 하드코딩** | `PROJECT`만 코드에서 제외하고 도메인 필드로 우회 | R10 |
| **초과 상태가 저장되지 않음** | 매 tick 전량 재계산(`findDelayedTickets` 전 티켓 스캔) → "초과된 그 순간" 1회 알림의 근거가 없다 | R4 |
| **달성 이력 없음** | 준수/위반 여부가 남지 않아 metric별 준수율 지표를 만들 수 없다 | 지표 |

### 2.3 시스템 내부 알림 — 존재하지 않음

- 개인 알림 테이블·벨·목록 없음. 유일한 선례는 **위키 전용** `wiki.wiki_notifications`(댓글 알림) + `app/wiki/components/NotificationBell.tsx`
- `notification_logs`는 **발송 감사 로그**이지 사용자 알림함이 아니다 (수신자 개념 없음, 읽음 상태 없음)
- 즉 R2·R9를 만족할 자산이 0

### 2.4 첫 화면 — 전사 지표만

`app/page.tsx`(733줄): KPI 6타일(도입 병원·병상·유지보수 진행중·이번주/차주 구축·누적 도입률) + 이번주·차주 구축 현황 + 유지보수 최신 7건 + 종별 도입 + 월별 추이. **개인 데이터가 한 줄도 없다.** 개인화의 씨앗은 `/tickets`의 My Tickets 탭(진입 기본값)에만 있다.

---

## 3. 목표 아키텍처

```
                        ┌───────────────────────────────┐
   티켓 mutation ──────▶│  lib/sla.ts   시계 엔진        │
   (생성·전이·배정·      │  - 정책 매칭 → 시계 생성/갱신  │
    코멘트·큐이관)       │  - 정지/재개·달성/초과 판정    │
                        └───────────┬───────────────────┘
                                    │ ticket_sla_clocks
                                    ▼
   ┌────────────────────────────────────────────────────────────┐
   │  lib/notify-center.ts   알림 센터 (단일 진입점)             │
   │  emit({ kind, recipients, ticket, payload })                │
   └───────┬───────────────────────────────┬─────────────────────┘
           │                               │
           ▼                               ▼
   notifications 테이블            lib/notify-routes.ts
   (사용자별 알림함)                (조건 매칭 → 채널 N개)
           │                               │
           ▼                               ▼
   벨 · /notifications ·          lib/slack.ts  (기존 어댑터)
   첫 화면 My Work                 → Slack 채널
           │
           └────▶ (향후) 페이저 앱 푸시 — 같은 테이블을 소스로

   스케줄러 tick(기본 5분): ① 초과 스캔 → 즉시 알림  ② 다이제스트 시각 도달 검사
                            ③ RESOLVED 자동 종결(기존)
```

원칙 3가지:
1. **시계 계산과 알림 발송을 분리** — 시계는 이벤트 훅에서 갱신, 발송은 tick이 초과분만 집어간다
2. **알림 생성과 채널 전달을 분리** — `emit()`은 항상 DB에 쓰고, Slack 여부는 라우팅 규칙이 결정
3. **기존 자산 보존** — `notification_logs`(발송 감사), sig v2(중복 발송 방지), test/live 모드 강등, best-effort(알림 실패가 업무 API를 깨지 않음)는 전부 유지

---

## 4. SLA 모델 재설계 (R10)

> **용어 (2026-07-26)**: 배정 그룹의 UI 표기는 **Assignment Group**(AWS SIM assigned/resolver group 대응).
> DB 테이블·컬럼(`ticket_queues`, `queue_ids`, `queueId`)과 API 경로는 그대로 유지한다 — 라벨만 변경.

### 4.1 3계층 구조

| 계층 | 테이블 | 역할 | 예 |
|---|---|---|---|
| **정책** | `sla_policies` | "어떤 티켓에 적용되나" + 시계 성격 | 고객지원 그룹 · Sev1~2 |
| **타깃** | `sla_targets` | "무엇을 몇 분 안에" | 배정 30분 / 해결 1일 |
| **시계** | `ticket_sla_clocks` | 티켓 하나의 metric별 실측 인스턴스 | TK-…-00042 ASSIGN, 시작 10:00, 기한 10:30, 초과 |

티켓 1건이 **여러 시계**를 갖는다: `ASSIGN`(배정까지) + `RESOLVE`(해결까지) + `UPDATE_STALE`(무응답) 이 동시에 돌 수 있다.

### 4.2 metric 정의

| metric | 시작(anchor) | 달성 조건 | 정지 | 용도 |
|---|---|---|---|---|
| `ASSIGN` | 티켓 생성 | `ownerId` 최초 non-null | PENDING | **CS 미배정 방치** — "생성 3시간째 담당자 없음" |
| `FIRST_RESPONSE` | 티켓 생성 | 첫 코멘트(`ticket_logs.log_type='comment'`) 또는 IN_PROGRESS 진입 중 빠른 쪽 | PENDING | 첫 응답 지연 (선택 도입) |
| `RESOLVE` | 티켓 생성 | RESOLVED 또는 CLOSED 진입 | PENDING | 현행 `dueAt`의 후계 |
| `UPDATE_STALE` | **마지막 활동**(코멘트·상태변경·배정) | 새 활동 발생 시 **리셋**(달성 아님, 재시작) | PENDING | **장기 건 방치 감지** — 프로젝트가 3주간 아무 기록 없음 |
| `DWELL` | 특정 상태 진입 | 그 상태 이탈 | — | 상태별 체류 (현 `notify_status_dwell` 후계). `status_scope` 필수 |
| `DOMAIN_DUE` | **도메인 기한 필드** | RESOLVED/CLOSED 진입 | PENDING | 장기 프로젝트·답사처럼 **기한을 도메인이 소유**하는 경우 |

`DOMAIN_DUE`의 앵커 필드는 refType별로 코드에 고정(하드코딩 매핑, 자유 입력 아님):

| refType | 앵커 필드 |
|---|---|
| `PROJECT` | `projects.end_date_expected` |
| `SITE_VISIT` | `site_visits.visit_date` |
| `INSTALL_PLAN` | `install_plans.reply_date` |
| 그 외 | 미지원(정책 저장 시 검증 400) |

**장기 프로젝트 문제의 답**: 프로젝트 티켓은 `RESOLVE`(생성→완료) 시계를 걸지 않고 **`DOMAIN_DUE`(완료예정일) + `UPDATE_STALE`(무응답)** 조합을 쓴다. "6개월 걸리는 게 정상인 건"에 7일 SLA를 씌우는 현재의 왜곡이 사라진다.

### 4.3 정책 매칭·우선순위

```
매칭 축 (AND):  refTypes[] · queueIds[] · ctiIds[](서브트리 상속) · severities[] · isPure(순수 티켓 여부)
빈 배열 = 해당 축 제한 없음(전체)
```

- 여러 정책이 매칭되면 **`priority` 오름차순 1개만 승리**(가장 구체적인 규칙에 낮은 숫자를 준다). 병합(merge) 없음 — 병합은 "어느 값이 이겼는지" 추적이 어려워 운영 사고를 만든다
- 승리 정책의 **모든 활성 타깃**이 시계로 인스턴스화된다
- 타깃의 `severity`가 NULL이면 정책 스코프 내 전 Sev 공통, 값이 있으면 그 Sev에만 적용(같은 metric에 Sev별 행 허용)
- 매칭 결과는 시계에 `policy_id`/`target_id`로 **박아 저장** — 나중에 정책을 바꿔도 진행 중 시계의 기준이 바뀌지 않는다(소급 재계산 없음). 재계산은 명시적 "정책 재적용" 액션에서만

### 4.4 시계 정지·재개

- **PENDING 정지**(현행 관례 유지): PENDING 진입 시 `paused_at` 기록, 이탈 시 `paused_ms += now - paused_at`, `due_at`을 그만큼 뒤로 밀어 재계산
- 정지 중에는 초과 판정 대상에서 제외
- **영업시간 시계**(평일 09:00~18:00만 카운트): 스키마에 `clock_type`(`CALENDAR_24H` | `BUSINESS_HOURS`) 필드를 두되 **1.1 구현은 `CALENDAR_24H`만** — 영업시간 시계는 공휴일 처리가 없으면 반쪽이고(공휴일 캘린더는 범위 외), 계산·검증 비용이 크다 → **⏳ D3 결정 항목**

### 4.5 스키마

```sql
-- ① SLA 정책
CREATE TABLE sla_policies (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  description  TEXT,
  priority     INT NOT NULL DEFAULT 100,          -- 낮을수록 우선
  ref_types    TEXT[] NOT NULL DEFAULT '{}',      -- 빈 배열 = 전체
  queue_ids    INT[]  NOT NULL DEFAULT '{}',
  cti_ids      INT[]  NOT NULL DEFAULT '{}',      -- 서브트리 상속
  severities   TEXT[] NOT NULL DEFAULT '{}',
  clock_type   VARCHAR(20) NOT NULL DEFAULT 'CALENDAR_24H',
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX sla_policies_priority_idx ON sla_policies (is_active, priority);

-- ② 정책별 목표
CREATE TABLE sla_targets (
  id             SERIAL PRIMARY KEY,
  policy_id      INT NOT NULL REFERENCES sla_policies(id) ON DELETE CASCADE,
  metric         VARCHAR(20) NOT NULL,            -- ASSIGN|FIRST_RESPONSE|RESOLVE|UPDATE_STALE|DWELL|DOMAIN_DUE
  status_scope   VARCHAR(20),                     -- DWELL 전용 (대상 상태)
  severity       VARCHAR(10),                     -- NULL = 정책 스코프 전 Sev
  threshold_min  INT NOT NULL,                    -- 목표(분). DOMAIN_DUE는 기한 대비 오프셋(0=기한 당일)
  warn_ratio     SMALLINT NOT NULL DEFAULT 80,    -- 임박 예고: 목표의 N% 경과 시 (0=미사용)
  is_active      BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT sla_targets_threshold_chk CHECK (threshold_min >= 0),
  CONSTRAINT sla_targets_dwell_chk CHECK (metric <> 'DWELL' OR status_scope IS NOT NULL)
);
CREATE UNIQUE INDEX sla_targets_uniq ON sla_targets
  (policy_id, metric, COALESCE(status_scope,''), COALESCE(severity,''));

-- ③ 티켓별 시계 (알림·지표의 근거)
CREATE TABLE ticket_sla_clocks (
  id                BIGSERIAL PRIMARY KEY,
  ticket_id         INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  metric            VARCHAR(20) NOT NULL,
  status_scope      VARCHAR(20),
  policy_id         INT REFERENCES sla_policies(id) ON DELETE SET NULL,
  target_id         INT REFERENCES sla_targets(id) ON DELETE SET NULL,
  threshold_min     INT NOT NULL,
  started_at        TIMESTAMP NOT NULL,
  due_at            TIMESTAMP NOT NULL,
  paused_at         TIMESTAMP,
  paused_ms         BIGINT NOT NULL DEFAULT 0,
  state             VARCHAR(12) NOT NULL DEFAULT 'RUNNING',  -- RUNNING|PAUSED|MET|BREACHED|CANCELED
  satisfied_at      TIMESTAMP,
  breached_at       TIMESTAMP,
  notified_warn_at  TIMESTAMP,   -- 임박 알림 발송 시각(1회성)
  notified_breach_at TIMESTAMP,  -- 초과 즉시 알림 발송 시각(1회성·quiet backfill 마킹 겸용)
  created_at        TIMESTAMP NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ticket_sla_clocks_uniq ON ticket_sla_clocks
  (ticket_id, metric, COALESCE(status_scope,''));
-- 초과 스캔 전용 (tick 부하 억제): 아직 알리지 않은 진행 중 시계만
CREATE INDEX ticket_sla_clocks_scan_idx ON ticket_sla_clocks (state, due_at)
  WHERE state = 'RUNNING' AND notified_breach_at IS NULL;
CREATE INDEX ticket_sla_clocks_ticket_idx ON ticket_sla_clocks (ticket_id);
```

> `UPDATE_STALE`은 리셋 시 같은 행의 `started_at`/`due_at`을 갱신하고 `notified_breach_at`을 NULL로 되돌린다(재초과 시 다시 알림). 유일 인덱스가 metric 단위이므로 행이 늘지 않는다.

**마이그레이션은 CLAUDE.md 절대규칙 #1 패턴**(psql 직접 실행 → 마이그레이션 파일 수동 생성 → `migrate resolve --applied` → schema.prisma 수동 반영 → `prisma generate`).

### 4.6 기존 자산 이관

| 기존 | 이관 방향 |
|---|---|
| `notify_sla_rules`(Sev별 일수) | **기본 정책 1행 + RESOLVE 타깃 Sev별 4행**으로 시드. 값 동일(1/1/3/7, SEV5 제외) → 기존 동작 유지 |
| `notify_status_dwell` | 설정값이 있으면 **DWELL 타깃**으로 이관, 없으면 미생성 |
| `tickets.due_at` | **유지**. `RESOLVE`/`DOMAIN_DUE` 시계의 캐시로 계속 갱신 → 목록·상세·기존 지표 무영향 |
| `PROJECT` 예외 하드코딩 | **PROJECT 전용 정책**(DOMAIN_DUE + UPDATE_STALE)으로 대체, 코드 분기 제거 |
| `lib/delay-rules.ts` `findDelayedTickets()` | 시계 테이블 조회로 교체(`findSlaRisk()`). 반환 형태는 유지해 다이제스트 빌더 재사용 |

### 4.7 초기 정책 세트 (예시 — ⏳ D2에서 확정)

| 우선순위 | 정책 | 스코프 | 타깃 |
|---|---|---|---|
| 10 | CS 긴급 대응 | 큐=고객지원, Sev1~2 | ASSIGN Sev1 30분 / Sev2 1시간, RESOLVE Sev1 4시간 / Sev2 1일 |
| 20 | CS 일반 | 큐=고객지원 | ASSIGN 4시간, RESOLVE 3일, UPDATE_STALE 2일 |
| 30 | 유지보수 | refType=MAINTENANCE | ASSIGN 1일, RESOLVE Sev별(1/1/3/7일), UPDATE_STALE 3일 |
| 40 | 구축 프로젝트 | refType=PROJECT | DOMAIN_DUE 0(완료예정일), UPDATE_STALE 14일 |
| 50 | 답사·설치계획 | refType=SITE_VISIT,INSTALL_PLAN | DOMAIN_DUE 0, DWELL(PENDING) 7일 |
| 100 | 기본(폴백) | 전체 | RESOLVE Sev별 1/1/3/7일 (SEV5 미적용) |

> **시드 범위**: 마이그레이션 시드는 **우선순위 100 폴백 정책 + 기존 `notify_sla_rules` 값 이관**까지만 만든다. 위 10~50번 정책은 그룹·CTI가 실사용으로 늘어나면서 바뀌므로 **관리자가 설정 화면에서 직접 추가**한다(§4.8).

### 4.8 관리자 설정 화면 — SLA 지연 기준 편집 (요구사항 핵심)

> "티켓의 **각 상태에서 지연 시 알림**이 **단계별로 시간 지정** 가능해야 하고, **티켓 유형별로도 구분**되어야 한다"

이 요구를 만족하는 편집 UX를 **`/settings/notifications` → SLA 정책 탭**에 둔다. 스키마는 그대로(정책 × 타깃)이고, 화면이 그것을 **매트릭스로 보여준다**.

#### 화면 1 — 상태 지연 매트릭스 (유형 × 상태)

```
상태 지연 알림 기준                                   [고급: Sev별 세분 ▢]

  유형          접수(OPEN)  배정(ASSIGNED) 처리중(IN_PROG) 대기(PENDING) 해결(RESOLVED)
  ─────────────────────────────────────────────────────────────────────────────
  전체(기본)    [ 1 일 ▾]   [ 3 일 ▾]      [ 5 일 ▾]      [ 7 일 ▾]     [ 3 일 ▾]
  유지보수      [ 4 시간▾]  [ 1 일 ▾]      [ 3 일 ▾]      [ 5 일 ▾]     [   —   ]
  기타업무      [   —   ]   [   —   ]      [   —   ]      [   —   ]     [   —   ]
  답사          [ 1 일 ▾]   [   —   ]      [   —   ]      [ 7 일 ▾]     [   —   ]
  설치계획      [ 1 일 ▾]   [   —   ]      [   —   ]      [ 7 일 ▾]     [   —   ]
  프로젝트      [   —   ]   [   —   ]      [ 14 일▾]      [ 14 일▾]     [   —   ]
  순수 티켓     [ 4 시간▾]  [ 1 일 ▾]      [   —   ]      [   —   ]     [   —   ]
  + 유형 행 추가(그룹·CTI 스코프)
```

- 셀 = `sla_targets` 1행(`metric='DWELL'`, `status_scope=<상태>`). **빈 셀(—) = 그 상태는 감지 안 함**
- 입력은 **숫자 + 단위(분·시간·일) 셀렉트**, 저장은 `threshold_min`(분) 단일 단위
- 행 = 정책. 기본 행은 폴백 정책(전체), 그 아래 유형별 행. **"+ 행 추가"** 로 그룹·CTI 스코프 정책도 만들 수 있다(유형만이 축이 아니다)
- 행 순서 = 우선순위(드래그 정렬). **위 행이 이긴다**는 규칙을 화면에 문장으로 표시
- `[고급: Sev별 세분]` 체크 시 각 행이 Sev1~5 하위 행으로 펼쳐진다(기본은 접힘 — Sev 세분이 필요 없는 조직이 대부분)

#### 화면 2 — 처리 목표 매트릭스 (유형 × metric)

```
처리 목표(SLA)                                        [고급: Sev별 세분 ▢]

  유형          배정까지(ASSIGN) 첫응답(FIRST_RESP) 해결까지(RESOLVE) 무응답(UPDATE_STALE) 도메인기한
  ─────────────────────────────────────────────────────────────────────────────────────────
  전체(기본)    [   —   ]        [   —   ]          Sev별 ▸ 1/1/3/7일  [   —   ]            ▢
  유지보수      [ 1 일 ▾]        [   —   ]          Sev별 ▸ 1/1/3/7일  [ 3 일 ▾]            ▢
  프로젝트      [   —   ]        [   —   ]          [   —   ]          [ 14 일▾]            ☑ 완료예정일
  고객지원(그룹)  [ 2 시간▾]       [ 4 시간▾]         [ 3 일 ▾]          [ 2 일 ▾]            ▢
```

- 도메인기한 열 = `DOMAIN_DUE` 체크박스(refType이 지원하는 행에서만 활성 — PROJECT·SITE_VISIT·INSTALL_PLAN)
- 임박 예고(`warn_ratio`)는 행별 1개 값으로 우측에 배치(기본 80%)

#### 화면 3 — 유형별 알림 발생 여부·채널 (§5.1 라우팅 규칙과 동일 데이터)

상태 지연·SLA 초과가 **감지**되는 것과 그것을 **어디로 알리는지**는 분리된 설정이다. 관리자가 두 화면을 오가지 않도록, 지연 매트릭스 각 행에 **"알림 대상"** 요약 칩(예: `#운영공지, #CS긴급`)을 표시하고 클릭 시 라우팅 규칙 탭으로 이동한다.

#### 설정 변경의 적용 범위 (중요)

기본 원칙은 §4.3의 "진행 중 시계는 불변"이지만, 관리자가 "OPEN 지연 3일 → 1일"로 바꿨다면 **이미 열려 있는 티켓에도 적용되길 기대**하는 것이 자연스럽다. 그래서 저장 시 선택지를 준다:

| 선택 | 동작 |
|---|---|
| **신규 티켓부터 적용** (기본) | 진행 중 시계 불변 — 알림 폭주 없음 |
| **열린 티켓에 지금 적용** | 열린 티켓의 해당 metric 시계를 재계산. 재계산으로 즉시 초과가 된 건은 **quiet 마킹**(알림 없이) 후 다음 다이제스트에 포함 — 저장 버튼 한 번에 수십 건 알림이 날아가는 사고를 막는다 |

저장 전 **영향 미리보기**: "이 변경으로 열린 티켓 12건이 새로 초과 상태가 됩니다"를 숫자로 보여준다.

---

## 5. Slack 알림 개선 (R4·R5·R6·R7)

### 5.1 채널 라우팅 규칙

env 상수(`SLACK_CHANNEL_MAIN`/`DELAY`) 의존을 끊고 **DB 규칙**으로 전환한다.

```sql
-- ④ 채널 마스터
CREATE TABLE notify_channels (
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(60) NOT NULL,          -- 표시명 (예: 운영 공지)
  slack_channel_id VARCHAR(40) NOT NULL,          -- C09XXXXXX
  description      TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMP NOT NULL DEFAULT now()
);

-- ⑤ 라우팅 규칙
CREATE TABLE notify_routes (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  event_type   VARCHAR(30) NOT NULL,   -- TICKET_CREATED|TICKET_STATUS_CHANGED|TICKET_QUEUE_TRANSFERRED
                                       -- |SEV_ESCALATED|SLA_BREACH|SLA_WARNING|DAILY_DIGEST
  channel_id   INT NOT NULL REFERENCES notify_channels(id) ON DELETE CASCADE,
  ref_types    TEXT[] NOT NULL DEFAULT '{}',
  queue_ids    INT[]  NOT NULL DEFAULT '{}',
  cti_ids      INT[]  NOT NULL DEFAULT '{}',
  severities   TEXT[] NOT NULL DEFAULT '{}',
  status_to    TEXT[] NOT NULL DEFAULT '{}',      -- 상태변경 이벤트에서 "이 상태로 바뀔 때만"
  metrics      TEXT[] NOT NULL DEFAULT '{}',      -- SLA_BREACH/WARNING에서 대상 metric 한정
  mention_mode VARCHAR(20) NOT NULL DEFAULT 'none', -- none|queue_members|channel|here
  digest_hour  SMALLINT,                          -- DAILY_DIGEST 전용 (KST 0~23)
  digest_opts  JSONB,                             -- { kinds:[...], groupBy:'queue'|'refType'|'none', maxPerSection:20 }
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX notify_routes_event_idx ON notify_routes (event_type, is_active);
```

매칭 의미론 (SLA 정책과 **동일한 규칙** — 두 곳에서 다른 방식을 쓰면 운영자가 혼동한다):

- 축 간 **AND**, 배열 내부 **OR**, 빈 배열 = 제한 없음, `cti_ids`는 서브트리 상속
- **정책과 달리 라우팅은 매칭된 규칙 전부 실행**(다중 채널이 요구사항 R7이므로). 단 **같은 채널로 중복 매칭되면 1건만 발송**(채널 단위 dedup)
- 규칙 0건 매칭 = 발송 없음 (조용한 실패가 아니라 정상 동작 — `notification_logs`에 `skipped/no_route` 기록)

기존 동작 보존을 위한 **시드 규칙 3행**(마이그레이션 시 생성):

| 규칙 | event_type | 채널 | 스코프 |
|---|---|---|---|
| 전체 티켓 등록 | `TICKET_CREATED` | 현 `SLACK_CHANNEL_MAIN` | 전체 |
| 전체 티켓 상태변경 | `TICKET_STATUS_CHANGED` | 현 `SLACK_CHANNEL_MAIN` | 전체 |
| SLA 일일 요약 | `DAILY_DIGEST` | 현 `SLACK_CHANNEL_DELAY` | 전체, `digest_hour=9` |

→ 배포 직후 동작은 1.0과 동일. 유형별 분리는 운영자가 규칙을 추가하면서 점진 적용.

### 5.2 SLA 초과 즉시 알림 (R4)

스케줄러 tick(기본 5분)에서:

```
1) SELECT ... FROM ticket_sla_clocks
   WHERE state='RUNNING' AND notified_breach_at IS NULL AND due_at <= now()
   ORDER BY due_at LIMIT :tickCap                    -- 부분 인덱스 사용
2) 각 시계: state='BREACHED', breached_at=now() 마킹
3) notify-center emit(kind='SLA_BREACH')             -- 내부 알림(owner·참여자)
4) notify_routes(event_type='SLA_BREACH') 매칭 채널로 개별 발송
5) notified_breach_at=now() 기록 (1회성 보장)
```

**폭주 방지 3중 장치** — 이게 없으면 기능을 켜는 순간 수백 건이 쏟아진다:

1. **quiet backfill**: 최초 도입 시(P1 백필) 이미 기한이 지난 시계는 `state='BREACHED'` + `notified_breach_at=now()`로 **알림 없이 마킹**. 이후 새로 초과되는 건만 알림
2. **tick 캡**(`notify_breach_tick_cap`, 기본 20): 초과분이 캡을 넘으면 남은 건은 다음 tick으로 밀고, 미발송분은 다이제스트가 커버
3. **metric 한정**: 규칙의 `metrics[]`로 "즉시 알림은 ASSIGN·SEV1 RESOLVE만" 같은 축소가 가능 (⏳ D5)

임박 알림(`SLA_WARNING`)도 같은 흐름 — `warn_ratio` 경과 시 `notified_warn_at` 1회.

### 5.3 일 1회 다이제스트 (R5)

- `notify_routes` 중 `event_type='DAILY_DIGEST'` 규칙마다 `digest_hour`(KST) 보유
- tick마다 판정: **"지금 KST 시각 ≥ digest_hour" AND "오늘(KST) 이 규칙으로 발송한 로그가 없음"** → 발송
  - 발송 여부 근거는 `notification_logs`(`event_type='delayed'`, `payload.routeId`, `created_at` KST 당일) — 서버 재시작에도 중복되지 않는다(현행 `setInterval` 방식의 약점 해소)
- 내용: 초과 전체 리스트(+임박·체류는 `digest_opts.kinds`로 선택), `groupBy`(큐/유형)로 섹션 분리, 섹션당 최대 `maxPerSection`(기본 20, 현행 10에서 상향), 초과분은 **metric 표기**("ASSIGN 3시간 초과", "완료예정일 5일 경과")
- 현행 `sendDelayChannelSummary`의 12시간 dedup은 **삭제**(하루 1회 규칙이 그 역할을 대체)

### 5.4 유형별 생성·상태변경 알림 (R6·R7)

- 발송 판단은 기존 sig v2 4축 비교를 **그대로 유지**(실변경만 발송·이중발송 0건 보장은 P11에서 검증된 자산)
- 달라지는 건 **"어디로 보내나"** 뿐: 단일 MAIN → `notify_routes` 매칭 결과 N개 채널
- `status_to[]`로 "완료로 바뀔 때만 공지 채널", `severities[]`로 "Sev1~2만 임원 채널" 같은 제어 (R7)
- 기존 `notify_types_enabled`(타입 on/off)·`notify_event_toggles`(이벤트 on/off)는 **전역 킬스위치로 존치** — 규칙보다 상위 게이트. 규칙이 늘어도 "일단 다 끄기"가 가능해야 한다

### 5.5 설정 UI 변경 (`/settings/notifications`)

현 412줄 단일 페이지를 **탭 4개**로 재편:

| 탭 | 내용 | Phase |
|---|---|---|
| **① SLA 기준** | §4.8 화면 1·2 — 상태 지연 매트릭스(유형 × 상태) + 처리 목표 매트릭스(유형 × metric) + 정책 행 추가·정렬 + 적용 범위 선택 + 영향 미리보기 | **P2** |
| **② 발송 채널·규칙** | 채널 목록(등록·연결 테스트 발송) + 규칙 테이블(이벤트·스코프·채널·멘션·활성) + **"이 규칙에 매칭되는 최근 티켓 5건" 미리보기** + 다이제스트 시각 | **P3** |
| **③ 전역·DM·이력** | 기존 전역 토글(킬스위치)·유형별 on/off·이벤트별 토글·DM 정책·발송 이력(최근 50건) | P3 |
| **④ 내부 알림** | kind별 기본 수신값·개인 설정 안내 | P5 |

**탭 ①이 P2로 앞당겨진 이유**: 알림이 실제로 발송되기 시작하는 P4보다 **먼저** 관리자가 기준을 만질 수 있어야 한다. 설정 화면 없이 알림을 켜면 값 조정이 SQL 작업이 되고, 그 상태로는 운영에 넘길 수 없다.

### 5.6 관리자가 설정에서 제어할 수 있는 항목 — 전수표

> 요구사항 "상세 알림 제어를 설정 메뉴에서" 의 추적 표. **코드 배포 없이 바꿀 수 있는 것**의 전체 목록이다.

| 구분 | 제어 항목 | 어디서 | 저장 위치 |
|---|---|---|---|
| **SLA — 상태 지연** | 상태별 지연 시간(분·시간·일) | 탭① 화면1 셀 | `sla_targets`(DWELL) |
| | **유형별 구분**(유지보수/답사/프로젝트/기타/순수…) | 탭① 화면1 행 | `sla_policies.ref_types` |
| | 그룹·CTI 스코프 정책 추가 | 탭① 행 추가 | `sla_policies.queue_ids/cti_ids` |
| | Sev별 세분(선택) | 탭① 고급 토글 | `sla_targets.severity` |
| | 우선순위(어느 정책이 이기나) | 탭① 행 드래그 | `sla_policies.priority` |
| | 감지 끄기(상태·유형 단위) | 셀 비우기 / 행 비활성 | `sla_targets.is_active` |
| **SLA — 처리 목표** | 배정까지·첫응답·해결까지·무응답 시간 | 탭① 화면2 | `sla_targets` |
| | 도메인 기한 사용 여부(완료예정일 등) | 탭① 화면2 체크 | `sla_targets`(DOMAIN_DUE) |
| | 임박 예고 비율(기본 80%) | 탭① 행 우측 | `sla_targets.warn_ratio` |
| | 변경의 적용 범위(신규만 / 열린 것도) | 탭① 저장 시 선택 | (액션) |
| **Slack — 어디로** | 채널 등록·비활성·연결 테스트 | 탭② | `notify_channels` |
| | 이벤트별 채널 라우팅(유형·그룹·CTI·Sev·전이 후 상태 조건) | 탭② 규칙 행 | `notify_routes` |
| | 멘션 방식(없음/그룹 멤버/@channel/@here) | 탭② | `notify_routes.mention_mode` |
| | **다이제스트 시각·포함 섹션·그룹 기준** | 탭② | `notify_routes.digest_hour/opts` |
| | 즉시 초과 알림 대상 metric 한정 | 탭② | `notify_routes.metrics` |
| **Slack — 보낼지** | 전역 킬스위치 / 유형별 on-off / 이벤트별 on-off | 탭③ | AppSetting(기존 키 유지) |
| | SLA 초과 DM·배정 DM on-off, DM 재발송 간격 | 탭③ | AppSetting(기존) |
| | tick 주기(off/1m/5m/10m/15m), tick당 발송 캡 | 탭③ | AppSetting `notify_tick_interval` / `notify_breach_tick_cap` |
| **내부 알림** | kind별 기본 수신 여부 | 탭④ | 코드 기본값 + `notification_prefs` |
| | 개인별 수신 설정(본인) | `/settings/profile` | `notification_prefs` |

**코드 배포가 필요한 것**(설정으로 열지 않는 것)과 그 이유:

- **metric 종류 추가**(ASSIGN·DWELL 등) — 판정 로직이 metric마다 다르다
- **`DOMAIN_DUE` 앵커 필드 매핑** — 도메인 스키마와 결합
- **알림 kind 종류·수신자 산출 규칙** — 권한·참여자 계산 로직
- **메시지 문안 골격** — 필드 선택은 설정, 배치·이모지는 코드(기존과 동일 방침)

---

## 6. 시스템 내부 알림 (R2·R9)

### 6.1 스키마

```sql
-- ⑥ 개인 알림함
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(30) NOT NULL,   -- 6.2 표 참조
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  link        VARCHAR(300) NOT NULL,  -- 앱 내부 경로 (/tickets/TK-…)
  ticket_id   INT,                    -- FK 없이 ID만 (티켓 삭제 후에도 알림 이력 보존 — ai_usage_logs 선례)
  ref_type    VARCHAR(20),
  ref_code    VARCHAR(50),
  severity    VARCHAR(10),
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(60),            -- 스냅샷
  dedup_key   VARCHAR(160),           -- 예: SLA_BREACH:42:ASSIGN:user
  read_at     TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, created_at DESC);
CREATE UNIQUE INDEX notifications_dedup_uniq ON notifications (dedup_key) WHERE dedup_key IS NOT NULL;

-- ⑦ 개인 알림 설정 (kind별 수신 여부)
CREATE TABLE notification_prefs (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind      VARCHAR(30) NOT NULL,
  in_app    BOOLEAN NOT NULL DEFAULT true,
  slack_dm  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, kind)
);
```

행이 없으면 코드 기본값 적용(전 kind in_app=on / slack_dm은 `TICKET_ASSIGNED`·`SLA_BREACH`만 on) — 계정마다 미리 행을 만들지 않는다.

### 6.2 알림 종류와 수신자

| kind | 수신자 | 트리거 |
|---|---|---|
| `TICKET_ASSIGNED` | 신규 owner | 배정(`/assign`, 생성 시 owner 지정) |
| `TICKET_UNASSIGNED_IN_MY_QUEUE` | 그룹 멤버 | 내 큐에 미배정 티켓 유입 (Sev·metric 조건은 규칙 없이 코드 기본) |
| `TICKET_STATUS_CHANGED` | owner + 참여자 | 상태 전이 |
| `TICKET_COMMENT` | owner + 참여자 | 타임라인 코멘트 작성 |
| `SLA_WARNING` | owner(없으면 그룹 멤버) | 시계 임박(`warn_ratio` 경과) |
| `SLA_BREACH` | owner(없으면 그룹 멤버) + 참여자 | 시계 초과 |
| `TICKET_LINKED` | 양쪽 owner | 마스터-서브 연결/해제 |

- **본인 행동 제외**: `actor_id == user_id`면 생성 스킵(자기가 바꾼 걸 자기에게 알리지 않는다)
- **VIEWER 포함**: 조회 전용 계정도 참여자로 지정될 수 있어 알림 자체는 허용
- 생성은 `lib/notify-center.ts` `emit()` 단일 진입점. 기존 `notifyTicketCreated`/`notifyTicketChanged` 안에서 호출 → **호출부(도메인 라우트) 수정 없음**

### 6.3 UI

| 화면 | 내용 |
|---|---|
| **전역 벨** (`app/components/Navigation.tsx`) | 미읽음 뱃지 + 드롭다운 최근 10건 + 60초 폴링. 데스크톱 헤더·모바일 드로어 양쪽 |
| **알림함** (`/notifications`) | 전체 목록(무한/페이지네이션), 필터(미읽음·종류), 개별/일괄 읽음, 항목 클릭 → 링크 이동 후 자동 읽음 |
| **읽음 처리** | `PATCH /api/notifications`(ids 없으면 전체), 알림 클릭 시 개별 |

API: `GET /api/notifications`(목록+미읽음수), `PATCH /api/notifications`(읽음), `GET/PUT /api/notifications/prefs`

### 6.4 위키 알림과의 관계 (모듈 경계 준수)

`wiki.wiki_notifications`는 **그대로 둔다**. CLAUDE.md 규칙 #7(메인 → 위키 코드 import 금지)·#8(`public.*`이 `wiki.*`를 FK 참조 금지) 때문에 이관·통합 테이블은 경계 위반 위험이 있다.

1.1 방식: 전역 벨이 **두 소스를 각각 HTTP로 조회**해 합산 표시(`/api/notifications` + `/api/wiki/notifications`). HTTP 호출은 규칙이 명시적으로 허용한 방향이다. 통합 여부는 후속 판단 (⏳ D7)

---

## 7. 첫 화면 개인화 (R8·R9)

### 7.1 구성

`app/page.tsx` 최상단에 **My Work 블록**을 추가하고, 기존 전사 KPI·현황은 그 아래로 유지(사용자 요구: "기본 대시보드로서 제공할 기본정보들과 **거기에 더해서**").

```
┌─ 내 업무 ─────────────────────────────────────────────────┐
│ [내 티켓 12]  [SLA 초과 3 ●적색]  [임박 2]  [내 큐 미배정 5] │  ← 클릭 시 필터된 /tickets
├──────────────────────────────────────────────────────────┤
│ ⚠ SLA 위험 (최대 5건)                                     │
│  TK-202607-00042 · Sev2 · ASSIGN 3시간 초과 · 서울아산      │
│  TK-202607-00031 · Sev3 · 완료예정일 5일 경과 · 원광대       │
│  … 전체 보기 →                                            │
├──────────────────────────────────────────────────────────┤
│ 🔔 최근 알림 5건 (미읽음 강조)          알림함 전체 →        │
└──────────────────────────────────────────────────────────┘
   ↓ 이하 기존 전사 KPI 6타일 · 이번주/차주 구축 · 유지보수 · 월별 추이
```

- **SLA 초과 인지**(R9)의 1차 경로는 이 블록. 2차는 벨/알림함, 3차는 `/tickets` 목록의 SLA 필터
- 개인 블록은 **접근 권한이 있고 티켓이 연결된 계정에만** 렌더. 대웅 계정·티켓 무관 계정은 블록 자체를 숨겨(0건 카드 나열은 소음) 기존 화면과 동일하게 보인다

### 7.2 API

`GET /api/me/dashboard` **1콜**로 전부 반환(기존 대시보드가 이미 5콜을 쓰므로 개인 블록에 콜을 더 늘리지 않는다):

```json
{
  "myTickets": { "open": 4, "assigned": 5, "inProgress": 2, "pending": 1, "total": 12 },
  "slaRisk":   { "overdueCount": 3, "warningCount": 2,
                 "items": [{ "ticketCode": "...", "severity": "SEV2", "metric": "ASSIGN",
                             "overdueMin": 180, "label": "ASSIGN 3시간 초과", "hospitalName": "...", "link": "..." }] },
  "unassignedInMyQueues": 5,
  "notifications": [{ "id": 1, "kind": "SLA_BREACH", "title": "...", "link": "...", "readAt": null, "createdAt": "..." }],
  "unreadCount": 7
}
```

### 7.3 부수 확장

- `/tickets` 목록에 **SLA 필터**(초과·임박) + 목록 컬럼에 SLA 상태 표시(초과 시 적색 칩) — 개인 블록의 "전체 보기" 착지점
- 티켓 상세에 **SLA 시계 패널**: metric별 기한·잔여/초과·정지 이력. 담당자가 "무엇 때문에 위반인지" 알 수 있어야 한다

---

## 8. 지표 반영 (기존 P12 대시보드 확장)

`/tickets/dashboard`에 metric 기반 지표 추가:

- **metric별 SLA 준수율**(ASSIGN / RESOLVE / DOMAIN_DUE) 추이 — 현행 "dueAt 보유 종결 건 준수율" 단일 값을 대체
- **평균 배정 소요시간**(ASSIGN 시계 실측) — CS 응답성의 핵심 지표
- **초과 발생 Top 그룹·유형**, metric별 위반 건수
- 데이터 소스는 `ticket_sla_clocks`(달성·초과가 행에 남아 있으므로 raw SQL 집계 가능)

---

## 9. Phase 계획·게이트

> **순서 원칙 (2026-07-26 사용자 요구 반영)**: **관리자가 설정에서 기준을 만질 수 있는 상태가 알림 발송보다 먼저**여야 한다. 그래서 SLA 설정 UI를 P6 → **P2로 앞당기고**, 발송(즉시 알림·다이제스트)을 뒤로 미뤘다. 또한 P1~P3은 **알림 동작이 전혀 바뀌지 않는 구간**이라 운영 리스크 없이 선행할 수 있다.

| Phase | 범위 | 게이트(검증 통과 조건) |
|---|---|---|
| **P0** | 이 설계 확정 — ⏳ 결정 항목 | 사용자 승인 |
| **P1** | **SLA 엔진**: 스키마 ①②③ + `lib/sla.ts`(정책 매칭·시계 생성/갱신/정지/판정) + 티켓 mutation 훅 + 폴백 정책 시드(기존 값 이관) + **quiet backfill** | 시계 단위 테스트(정지·재개·달성·초과·UPDATE_STALE 리셋) / 기존 `dueAt` 값 동등성 / 백필 후 알림 0건 / `tsc` 0오류 |
| **P2** | **SLA 설정 화면**(탭①): 상태 지연 매트릭스 + 처리 목표 매트릭스 + 정책 행 추가·정렬 + 적용 범위 선택 + 영향 미리보기 + 정책·타깃 CRUD API | 유형×상태 셀 편집 → 신규 티켓 시계에 반영 / "열린 티켓에 지금 적용" 재계산 후 **알림 0건**(quiet) / 미리보기 숫자 = 실제 매칭 / 우선순위 드래그 반영 / ADMIN 이상만 접근 |
| **P3** | **채널·라우팅**(탭②③): 스키마 ④⑤ + `lib/notify-routes.ts` + `notify.ts` 채널 결정 전환 + 규칙 CRUD·미리보기 | 시드 규칙만으로 **1.0과 동일 발송**(회귀) / 다중 채널 매칭·같은 채널 dedup / 규칙 0건 = 미발송+로그 / test 모드 강등 유지 |
| **P4** | **즉시 초과 알림 + 다이제스트**: tick 재설계(`notify_tick_interval`) + breach 스캔 + 지정 시각 다이제스트 | 초과 → 5분 내 1건, 재발송 0 / tick 캡 / 재시작 후에도 하루 1회 / KST 시각 정확 / **설정 변경이 다음 tick부터 반영** |
| **P5** | **내부 알림**(탭④): 스키마 ⑥⑦ + `lib/notify-center.ts` + 벨 + `/notifications` + 개인 설정 | Slack off에서도 적재 / 본인 행동 제외 / dedup / 읽음 처리 / 위키 알림 합산 / 모바일 |
| **P6** | **첫 화면 개인화**: `/api/me/dashboard` + My Work 블록 + 목록 SLA 필터 + 상세 SLA 시계 패널 | 1콜 < 300ms / 권한별 렌더 / 초과 클릭 → 해당 티켓 / 모바일 카드 |
| **P7** | 지표 확장 + 문서(README·DEV_HISTORY·CLAUDE.md 규칙) + PROD 배포 | 지표 수기 대조 / 배포 절차서(마이그레이션 7종·시드·quiet backfill 순서) / 스모크 |

각 Phase는 **게이트 통과 후 다음 진행**(1.0 티켓 프로젝트와 동일 방식).

---

## 10. 마이그레이션·리스크·롤백

### 10.1 마이그레이션

신규 테이블 **7종**(`sla_policies`, `sla_targets`, `ticket_sla_clocks`, `notify_channels`, `notify_routes`, `notifications`, `notification_prefs`) — 모두 **순수 추가**. 기존 테이블 변경은 없다(`tickets.due_at` 재활용).

배포 순서: 마이그레이션 → `prisma generate` → 시드(기본 정책·타깃·채널·규칙 3행) → **quiet backfill**(기존 티켓 시계 생성 + 초과분 알림 없이 마킹) → 빌드 → PM2 재시작 → 스모크. **PROD DB 작업은 사용자 명시 허락 후**(절대규칙 #5).

### 10.2 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| **초과 알림 폭주** | 도입 순간 수백 건 발송 | quiet backfill + tick 캡 + metric 한정 (§5.2) |
| **채널 오발송** | 잘못된 채널에 업무 정보 노출 | test 모드 유지 + 채널 등록 시 연결 테스트 발송 필수 + 규칙 미리보기 |
| **시계 오계산** | 오탐 알림 → 알림 신뢰도 붕괴 | P1 게이트에서 단위 테스트 + 기존 dueAt 동등성 대조. 오탐 1건이 기능 전체를 불신하게 만드므로 P1을 알림 없이 먼저 안정화 |
| **tick 부하**(5분 주기) | DB 부하 | 부분 인덱스(`state='RUNNING' AND notified_breach_at IS NULL`) + LIMIT 스캔. 전 티켓 재계산(현행 방식)보다 가벼움 |
| **내부 알림 스팸** | 벨 무시 → R2 무의미 | kind별 기본값 보수적(상태변경은 owner·참여자 한정) + 개인 설정 + 본인 행동 제외 |
| **규칙 폭발** | 운영자가 규칙을 이해 못 함 | 규칙 목록에 매칭 미리보기·정렬·활성 토글. 정책은 "1개 승리", 라우팅은 "전부 실행"이라는 차이를 UI에 명시 |
| **이중 발송** | 같은 이벤트가 여러 규칙에 걸림 | 채널 단위 dedup + sig v2 유지. P2 게이트 항목 |

### 10.3 롤백

- 알림 동작만 되돌리려면 `notify_routes` 전 행 비활성 또는 `notify_enabled=off`(기존 킬스위치) → 즉시 무발송
- 코드 롤백은 이전 커밋으로 PROD `git pull` + 빌드. 신규 테이블은 남겨도 무해(순수 추가)
- 시계 계산이 잘못되면 `ticket_sla_clocks` 전체 삭제 후 재백필 가능(원본이 아니라 파생 데이터)

---

## 11. ⏳ 착수 전 결정 필요 항목

> CLAUDE.md 설계 게이트 원칙에 따라 **결정 없이 임의 진행하지 않는다.**

| # | 항목 | 선택지 (권장 ★) |
|---|---|---|
| **D1** | metric 초기 세트 | ★ASSIGN·RESOLVE·UPDATE_STALE·DWELL·DOMAIN_DUE 5종 / FIRST_RESPONSE까지 6종 |
| **D2** | 초기 정책·목표 실제 값 | §4.7 예시대로 시작 후 조정 / 값 직접 지정 (특히 **CS 배정 목표**가 핵심) |
| **D3** | 영업시간 시계(평일 09~18시만 카운트) | ★1.1은 24시간 시계만, 영업시간은 후속 / 1.1에 포함(공휴일 미지원 전제) |
| **D4** | 다이제스트 시각·포함 섹션 | ★09:00 KST · 초과+임박 / 다른 시각·섹션 |
| **D5** | 즉시 초과 알림 대상 범위 | ★전 metric 초과 / ASSIGN·Sev1~2만 (알림량 최소화) |
| **D6** | 즉시 알림 채널 | ★현 지연 채널 재사용 / 신규 전용 채널 개설 |
| **D7** | 위키 알림 통합 | ★벨에서 합산 표시(테이블 분리 유지) / `notifications`로 이관(모듈 경계 예외 승인 필요) |
| **D8** | 내부 알림 기본 수신 범위 | ★배정·SLA·코멘트·내 큐 미배정 / 상태변경까지 포함(알림량 증가) |
| **D9** | Slack DM 정책 | ★내부 알림 도입 후 DM은 SLA 초과·배정만 유지 / 현행 유지 / DM 전면 중단 |
| **D10** | 첫 화면 개인 블록 위치 | ★최상단(KPI 위) / KPI 아래 |
| **D11** | Phase 순서 | ★P1→P7 순차(설정 화면이 발송보다 선행) / 다른 순서 |
| **D12** | 설정 변경의 **기본 적용 범위** | ★"신규 티켓부터" 기본 + "열린 티켓에 지금 적용"은 명시 선택 / 항상 열린 티켓까지 즉시 |
| **D13** | Sev별 세분 편집 노출 | ★기본 접힘(고급 토글) / 항상 펼침 |

### 착수 시 적용하는 기본값 (2026-07-26)

사용자가 "전반적으로 괜찮다"고 검토 완료 → **D1~D13의 ★권장안을 기본값으로 적용해 착수**한다. 실사용 후 조정은 전부 설정 화면에서 가능(§5.6)하므로 착수를 막지 않는다. 단 아래 2건은 **값 자체가 운영 판단**이라 P2 설정 화면 완료 후 사용자가 직접 입력한다:

- **D2 초기 정책 값** — 시드는 폴백 정책(기존 `notify_sla_rules` 값 1/1/3/7일)까지만. CS 배정 목표·유형별 상태 지연 시간은 설정 화면에서 입력
- **D6 즉시 알림 채널** — P3 채널 등록 단계에서 지정

---

## 12. 범위 외 — 페이저 앱으로 가는 길

이번 설계가 페이저 앱(R3)의 **필요 조건 3개를 미리 만든다**:

1. **사용자별 알림 레코드**(`notifications`) — 푸시할 대상 데이터가 DB에 있어야 앱이 붙는다
2. **kind·severity 체계** — 페이저는 "깨울 것/안 깨울 것"을 구분해야 하고, 그 판단 축이 kind + severity + SLA metric이다
3. **개인 수신 설정**(`notification_prefs`) — 채널만 늘리면(`push` 컬럼 추가) 그대로 확장된다

향후 앱 도입 시 추가로 필요한 것(이번 범위 아님): 디바이스 토큰 테이블, 푸시 게이트웨이(FCM/APNs 또는 웹푸시), 미확인 시 에스컬레이션 체인, 당직(on-call) 스케줄. **온콜 개념은 그룹 멤버십(`ticket_queue_members`)의 자연스러운 확장**이 될 것이다.
