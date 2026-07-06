# Slack Notification 기능 설계서 (function_notification.md)

> **이 문서는 구현 담당 AI(OPUS)가 참고하는 설계·진행 기준 문서입니다.**
> 작업 시작 전 반드시 `CLAUDE.md` → `README.md` → `DEV_HISTORY.md` 최근 항목 → 이 문서 순으로 읽으세요.
> 각 Phase 완료 시 이 문서 하단의 **진행 체크리스트**를 갱신하고, `DEV_HISTORY.md` 상단에 기록하세요.

---

## 1. 목표

thynC Operations System의 주요 업무(프로젝트/답사/설치계획/유지보수/기타업무)에 대해:

1. **이벤트 알림** — 업무가 **등록**되거나 **완료**되었을 때 Slack 채널에 알림
2. **지연 알림** — 일정이 지연 중인 업무를 주기적으로 감지하여 **채널 알림 + 담당자 DM**
3. **설정 관리** — 알림 on/off, 지연 규칙, 발송 이력을 시스템 안에서 관리

**신규 시스템이 아니라 기존 시스템에 대한 기능 추가**다. 기존 패턴을 최대한 재사용하고, 새 패턴 발명을 최소화한다.

---

## 2. 기존 시스템 접점 (재사용할 인프라)

구현 전 아래 파일들을 반드시 읽고 패턴을 파악할 것:

| 기존 자산 | 위치 | 이 기능에서의 역할 |
|---|---|---|
| **Task 통합 미러** | `prisma/schema.prisma` `Task` 모델, 각 업무 API route | 5개 업무 타입의 등록/완료를 **단일 시맨틱으로 감지하는 훅 지점**. 모든 업무 API가 생성 시 Task row를 만들고, 완료 시 `isCompleted`를 동기화함 |
| **인터벌 스케줄러 패턴** | `lib/mail-scheduler.ts` + `instrumentation.ts` | 지연 감지 스케줄러를 동일 패턴으로 구현 (`instrumentation.ts`에서 기동, AppSetting으로 간격 제어) |
| **AppSetting** | `prisma/schema.prisma` `AppSetting` (key-value) | 알림 전역 on/off·지연 규칙 JSON 저장소 (별도 설정 테이블 불필요) |
| **best-effort 외부연동 패턴** | `lib/googleCalendar.ts` | Slack 발송 실패가 **본 작업(API mutation)을 절대 실패시키지 않는** 패턴의 선례. try/catch + console.error 후 정상 진행 |
| **감사 로그** | `lib/audit.ts` | 참고용. 알림 발송 이력은 별도 `notification_logs` 테이블로 관리 (audit_logs에 섞지 않음) |
| **설정 페이지 패턴** | `app/settings/mail-sync/` 등 | Phase 5 알림 설정 UI의 레이아웃·권한 패턴 재사용 |
| **역할 헬퍼** | `lib/auth.ts` `isAdminOrAbove` | 설정 API 권한 체크 |

### 완료 시맨틱 통일 (핵심 설계 결정)

업무 타입마다 "완료"의 정의가 다르지만(프로젝트=buildStatus 라벨 '완료' 포함, 유지보수=상태 '완료', 설치계획=회신 '완료' 등), **각 API route는 이미 이 판정을 해서 `Task.isCompleted`에 동기화하고 있다.**

→ 알림은 이 판정을 재구현하지 않는다. **각 route에서 Task 미러를 갱신하는 바로 그 지점**에서:
- Task **생성** → `등록` 알림
- `isCompleted`가 **false → true 전이** → `완료` 알림 (true→true 재저장은 미발송)

메일큐 자동등록 경로(`app/api/mail-queue/[id]/route.ts`, `app/api/site-visit-queue/[id]/route.ts`)도 Task를 생성하므로 동일 훅 적용 (메시지에 `자동등록` 표기).

---

## 3. 아키텍처

```
[업무 API routes]───┐ (등록/완료 이벤트, best-effort 호출)
                    ▼
             lib/notify.ts          ← 도메인 이벤트 → 메시지 구성 → 발송 결정(설정·중복·모드)
                    │
                    ▼
             lib/slack.ts           ← 저수준 Slack Web API 어댑터 (postMessage, lookupByEmail)
                    │
                    ▼ fetch (https://slack.com/api/*)
                 Slack

[instrumentation.ts]──▶ lib/notify-scheduler.ts   ← 지연 감지 주기 실행 (mail-scheduler 패턴)
                              │  지연 규칙(AppSetting JSON) 평가 → 대상 추출
                              ▼
                        lib/notify.ts (채널 알림 / 담당자 DM, notification_logs로 중복 방지)
```

### 신규 파일 (전부 메인 모듈 — 위키 경계와 무관)

| 파일 | 역할 |
|---|---|
| `lib/slack.ts` | Slack Web API 어댑터. **의존성 0** (`fetch` 직접 사용, SDK 미설치). `postToChannel()`, `postDM()`, `lookupUserByEmail()`. 토큰 미설정 시 자동 스킵(googleCalendar 패턴) |
| `lib/notify.ts` | `notifyTaskCreated()`, `notifyTaskCompleted()`, `notifyDelayed()`. 설정 확인 → 메시지 빌드(Block Kit) → 발송 → `notification_logs` 기록. **모든 함수는 절대 throw하지 않음** |
| `lib/notify-scheduler.ts` | 지연 감지 루프. `startNotifyScheduler()`/`stopNotifyScheduler()` — `lib/mail-scheduler.ts`와 동일 구조 |
| `lib/delay-rules.ts` | 타입별 지연 판정 로직 + 규칙 기본값 + AppSetting JSON 파서 |
| `app/api/settings/notifications/route.ts` | 설정 조회/저장 API (ADMIN 이상) |
| `app/settings/notifications/page.tsx` | 설정 UI (Phase 5) |

### 수정 파일

- 업무 API routes 10곳 내외 (projects/site-visits/install-plans/maintenances/etc-tasks의 route.ts + [id]/route.ts + 큐 2곳) — Task 미러 갱신 지점에 알림 호출 1~2줄 추가
- `instrumentation.ts` — notify-scheduler 기동 추가
- `prisma/schema.prisma` — `NotificationLog` 모델 + `User.slackUserId`

---

## 4. DB 설계

> ⚠️ **CLAUDE.md 절대 규칙**: `prisma migrate dev` 금지. psql 직접 실행 → 마이그레이션 파일 수동 생성 → `migrate resolve --applied` → schema.prisma 수동 갱신 → `npx prisma generate` 순서 엄수. **PROD DB 적용은 배포 시점에 별도 확인 후.**

### 4-1. `notification_logs` (Phase 1)

발송 이력 + 중복 발송 방지(dedup)의 근거 테이블.

```sql
CREATE TABLE notification_logs (
  id          SERIAL PRIMARY KEY,
  event_type  VARCHAR(30) NOT NULL,   -- 'task_created' | 'task_completed' | 'delayed'
  task_type   VARCHAR(20),            -- PROJECT | SITE_VISIT | INSTALL_PLAN | MAINTENANCE | ETC
  ref_code    VARCHAR(50),            -- 원본 업무 코드
  target_type VARCHAR(10) NOT NULL,   -- 'channel' | 'dm'
  target_id   VARCHAR(50) NOT NULL,   -- 채널 ID 또는 Slack user ID
  status      VARCHAR(10) NOT NULL,   -- 'sent' | 'failed' | 'skipped'
  error       TEXT,
  payload     JSONB,                  -- 발송한 메시지 요약 (디버깅용)
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_logs_dedup ON notification_logs (event_type, ref_code, target_id, created_at);
CREATE INDEX idx_notif_logs_created ON notification_logs (created_at);
```

- **dedup 쿼리**: "이 업무(ref_code)의 delayed 알림이 이 대상(target_id)에게 최근 N시간 내 sent 있는가" — 있으면 skip
- public 스키마 (`@@schema("public")`)

### 4-2. `users.slack_user_id` (Phase 4)

```sql
ALTER TABLE users ADD COLUMN slack_user_id VARCHAR(20);
```

- nullable. 최초 DM 발송 시 `users.lookupByEmail`(Slack API)로 자동 매핑 후 캐시 저장
- 매핑 실패(이메일 불일치) 시 DM skip + log 기록 (에러 아님)

### 4-3. 설정값 — AppSetting key-value (신규 테이블 없음)

| key | value 예시 | 설명 |
|---|---|---|
| `notify_enabled` | `"on"` / `"off"` | 전역 스위치 (기본 off — 켜기 전까지 아무것도 발송 안 함) |
| `notify_events_enabled` | `"on"` / `"off"` | 등록/완료 이벤트 알림 스위치 |
| `notify_delay_interval` | `"off"` / `"1h"` / `"6h"` / `"24h"` | 지연 감지 주기 (mail_sync_interval과 동일 컨벤션) |
| `notify_delay_rules` | JSON (아래 §6-2) | 타입별 지연 규칙 |
| `notify_dm_policy` | JSON (아래 §6-3) | DM 빈도·조용시간·에스컬레이션 |

---

## 5. 환경변수 & DEV/PROD 분리

`.env`에 추가 (dev2 / dev / PROD 각각 별도 설정):

```bash
SLACK_BOT_TOKEN=xoxb-...          # Slack 봇 토큰 (미설정 시 모든 발송 자동 스킵)
SLACK_CHANNEL_MAIN=C0XXXXXXX      # 이벤트 알림 채널 ID
SLACK_CHANNEL_DELAY=C0XXXXXXX     # 지연 알림 채널 ID (MAIN과 같아도 됨)
SLACK_NOTIFY_MODE=test            # off | test | live
SLACK_CHANNEL_TEST=C0XXXXXXX      # test 모드에서 모든 메시지가 가는 채널
```

**모드 동작 (스팸/오발송 방지의 핵심):**

| 모드 | 채널 알림 | DM | 용도 |
|---|---|---|---|
| `off` | 미발송 (log만 skipped) | 미발송 | 기본값 |
| `test` | **전부 TEST 채널로** + 메시지 앞 `[DEV]` prefix | **DM도 TEST 채널로** (실제 사람에게 절대 안 감) | dev2·dev 상시 |
| `live` | 정상 발송 | 정상 발송 | PROD 전용 |

> dev2/dev의 `.env`에는 `live`를 **절대 넣지 않는다.** 코드에서도 `NODE_ENV !== 'production'`이면 live를 test로 강등하는 이중 안전장치를 넣을 것.

---

## 6. 로직 설계

### 6-1. 이벤트 알림 (등록/완료)

**훅 위치**: 각 업무 API route에서 mutation 트랜잭션 **성공 후** (Google Calendar 동기화 호출과 같은 층위).

```typescript
// 예: app/api/maintenances/route.ts POST 성공 후
notifyTaskCreated({ taskType: 'MAINTENANCE', refCode, title, hospitalName, assigneeNames, url })
  .catch(() => {})   // notify 내부에서 이미 throw 안 하지만 이중 방어
```

- `await`는 하되 실패는 삼킨다 (응답 지연 최소화 위해 fire-and-forget도 허용 — 구현 시 판단)
- **메시지 구성 (Block Kit)**: 이모지+업무타입, 제목(상세 페이지 링크 — `NEXT_PUBLIC_APP_URL` 기반), 병원명, 담당자, 등록자/완료자
  - 예: `🆕 [유지보수] OO병원 — 게이트웨이 통신 장애 (담당: 홍길동 외 1명)` / `✅ [프로젝트] OO병원 구축 완료`
- **완료 판정**: `Task.isCompleted` false→true 전이 시에만. 각 route가 이미 이 값을 계산하므로 **갱신 전 기존 값을 조회해 비교** (또는 이미 조회한 기존 엔티티에서 판단)
- 업무 **삭제**·수정(완료 외)은 알림 대상 아님 (소음 방지)

### 6-2. 지연 감지 (스케줄러)

`lib/notify-scheduler.ts` — mail-scheduler와 동일하게 `instrumentation.ts`에서 기동, `notify_delay_interval` AppSetting으로 제어.

**타입별 지연 규칙 — 기본값 제안 (⏳ Phase 3 시작 시 사용자와 확정):**

```jsonc
// AppSetting 'notify_delay_rules'
{
  "PROJECT":      { "type": "endDateExpected",              "graceDays": 0 },   // 완료예정일 경과 & 미완료
  "SITE_VISIT":   { "type": "sinceRequest",  "days": 7 },                       // 요청일 +7일 미완료
  "INSTALL_PLAN": { "type": "sinceRequest",  "days": 7 },                       // 요청일 +7일 회신 미완료
  "MAINTENANCE":  { "type": "sinceReportedByPriority",
                    "days": { "긴급": 1, "높음": 3, "보통": 7, "낮음": 14 } },   // 접수일 + 우선순위별
  "ETC":          { "type": "sinceReported", "days": 14 }                       // 접수일 +14일 미완료
}
```

- 판정은 `lib/delay-rules.ts`에 타입별 함수로 구현. 원본 테이블(Project 등)을 직접 조회 (Task 미러에는 날짜·상태 세부가 없음)
- 날짜 비교는 **KST 기준** 자정 단위 (`Asia/Seoul`)
- 지연 목록 → 채널 알림은 **1건씩이 아니라 요약 1메시지** (예: "⏰ 지연 업무 5건" + 목록). 스팸 방지
- 상태 '보류' 업무는 지연 판정에서 제외 (프로젝트 보류 상태 등)

### 6-3. 담당자 DM + 스팸 방지

**DM 정책 기본값 제안 (⏳ Phase 4 시작 시 사용자와 확정):**

```jsonc
// AppSetting 'notify_dm_policy'
{
  "dedupHours": 24,          // 같은 업무·같은 대상에게 24시간 내 재발송 금지
  "quietHours": [19, 9],     // 19시~익일 9시(KST) 미발송 (다음 주기로 이월)
  "skipWeekend": true,       // 주말 미발송
  "maxDmPerItem": 3,         // 같은 업무 DM 3회 도달 시
  "escalation": "channel"    //   → 이후 DM 중단, 지연 채널 요약에만 포함 (담당자 멘션)
}
```

- DM 대상 = 해당 업무의 담당자(Assignee) 전원. `users.slack_user_id` 캐시 → 없으면 `lookupUserByEmail` → 실패 시 skip+log
- dedup·발송횟수는 `notification_logs` 집계로 판단 (별도 카운터 테이블 없음)
- DM 문구는 독촉이 아닌 정보성 톤: 업무 링크 + 지연 일수 + "완료됐다면 상태를 갱신해주세요"

---

## 7. Phase 진행 계획

> 각 Phase는 **게이트(검증 통과) 후 다음 진행**. ⏳ 표시는 해당 Phase 시작 시 사용자 결정 필요 항목 — **결정 없이 임의 진행 금지, AskUserQuestion 등으로 반드시 확인.**

### Phase 0 — 사전 준비 (사용자 작업, 코딩 없음)

- [ ] Slack 앱 생성 (https://api.slack.com/apps → Create New App)
- [ ] Bot Token Scopes: `chat:write`, `users:read`, `users:read.email`, `im:write`
- [ ] 워크스페이스 설치 → `xoxb-` Bot Token 확보
- [ ] 알림 채널(운영)·테스트 채널 생성 + **봇 초대**(`/invite @봇이름`) + 채널 ID 확보
- [ ] dev2 `.env`에 §5 변수 입력 (`SLACK_NOTIFY_MODE=test`)

**게이트**: `curl`로 `chat.postMessage` 테스트 채널 발송 성공

### Phase 1 — 전송 기반 (lib/slack.ts + notification_logs)

- `lib/slack.ts` 구현 (fetch 기반, 토큰 미설정 시 스킵, test 모드 라우팅)
- `notification_logs` 마이그레이션 (dev2 로컬만, §4-1 — **CLAUDE.md 마이그레이션 패턴 준수**)
- `lib/notify.ts` 골격 (설정 확인 → 발송 → 로그)

**게이트**: 테스트 스크립트로 채널 발송 + `notification_logs`에 sent 기록 확인. `tsc --noEmit` 0오류

### Phase 2 — 이벤트 알림 (등록/완료)

- 업무 API 5종 + 큐 2종 route에 훅 추가 (Task 미러 갱신 지점, best-effort)
- Block Kit 메시지 빌더 (타입별 이모지·필드·상세링크)
- AppSetting `notify_enabled`/`notify_events_enabled` 게이팅
- ⏳ **결정**: 채널 1개로 모을지, 업무 타입별 채널 분리할지 / 메시지에 포함할 필드 최종안

**게이트**: dev2에서 5개 타입 각각 등록·완료 E2E → 테스트 채널 수신 + 로그 확인. 완료 재저장(true→true) 미발송 확인. Slack 토큰 제거 상태에서 API 정상 동작(발송만 skip) 확인

### Phase 3 — 지연 감지 + 채널 요약 알림

- `lib/delay-rules.ts` + `lib/notify-scheduler.ts` + `instrumentation.ts` 연결
- 지연 요약 메시지 (N건 목록, 각 항목 상세링크)
- ⏳ **결정**: §6-2 지연 규칙 기본값 확정 (특히 답사·설치계획 기준일, 유지보수 우선순위별 일수)

**게이트**: dev2에서 과거 날짜 테스트 데이터로 지연 감지 → 요약 1건 수신. dedup(같은 주기 내 재실행 시 미발송) 확인. 보류 상태 제외 확인

### Phase 4 — 담당자 DM + 스팸 방지

- `users.slack_user_id` 마이그레이션 + lookupByEmail 자동 매핑
- DM 발송 + dedup/조용시간/주말/에스컬레이션 (§6-3)
- ⏳ **결정**: DM 정책 값 확정 (dedup 시간, 조용시간, 최대 횟수) / DM 활성 대상 (전 담당자 vs 특정 역할만)

**게이트**: 테스트 모드에서 DM이 테스트 채널로 라우팅되는지, dedup 24h·quiet hours 동작, 매핑 실패 시 skip 로그 확인

### Phase 5 — 설정 UI + 발송 이력

- `/settings/notifications` (ADMIN 이상): 전역 on/off, 이벤트 알림 on/off, 지연 주기, 지연 규칙 편집, DM 정책 편집
- 발송 이력 조회 (최근 N건, 상태 필터) — audit-logs 페이지 패턴 참고
- 설정 변경은 감사로그 기록 (`resource='setting:notifications'`)

**게이트**: 설정 변경 → 즉시 반영(스케줄러 재기동 포함, mail-sync 설정 페이지 패턴), `tsc` 0오류·빌드 통과

### Phase 6 — PROD 배포 (사용자 명시 요청 시에만)

- PROD Slack 채널·`.env`(`SLACK_NOTIFY_MODE=live`) 준비 확인
- **PROD DB 마이그레이션은 사용자 확인 후** 적용 (notification_logs, users.slack_user_id)
- 배포 절차: dev2 커밋·push → PROD pull → 마이그레이션 → 힙4GB 빌드 → `pm2 restart thync-prod` → 스모크
- 초기에는 `notify_enabled=off`로 배포 → 운영 채널에서 수동 테스트 후 on

---

## 8. 구현 시 절대 준수 사항 (OPUS용 리마인더)

1. **CLAUDE.md 절대 규칙 전부 적용** — 특히: `prisma migrate dev` 금지 / 빌드·git push·PM2 재시작은 사용자 명시 요청 시에만 / PROD DB·소스 직접 작업 금지 / 빌드 시 힙 4GB
2. **알림은 절대 본 기능을 깨지 않는다** — Slack 장애·토큰 만료·설정 오류 상황에서도 업무 API는 100% 정상 동작해야 함. 모든 발송 경로에 try/catch, `lib/notify.ts` 외부로 예외 전파 금지
3. **새 npm 패키지 설치 금지** (fetch로 충분). 불가피하면 사용자에게 먼저 확인
4. **위키 모듈 경계 무관** — 이 기능은 전부 메인 모듈. `app/wiki/*`, `lib/wiki/*` 건드리지 않음
5. **⏳ 항목은 임의 결정 금지** — 각 Phase 시작 시 사용자에게 확인
6. Phase 완료마다: 이 문서 체크리스트 갱신 → `DEV_HISTORY.md` 상단 기록 → `README.md` 해당 섹션(기능·API·스키마·디렉토리) 갱신
7. dev2에서 실데이터로 테스트할 때도 `SLACK_NOTIFY_MODE=test` 유지 — 실제 담당자에게 발송되는 일이 없어야 함

---

## 9. 진행 체크리스트

| Phase | 내용 | 상태 | 완료일 |
|---|---|---|---|
| 0 | Slack 앱·토큰·채널 준비 (사용자) | ✅ 완료 | 2026-07-06 |
| 1 | 전송 기반 (slack.ts + notification_logs) | ✅ 완료 | 2026-07-06 |
| 2 | 이벤트 알림 (등록/완료 → 채널) | ✅ 완료 | 2026-07-06 |
| 3 | 지연 감지 스케줄러 + 채널 요약 | ✅ 완료 | 2026-07-06 |
| 4 | 담당자 DM + 스팸 방지 | ✅ 완료 | 2026-07-07 |
| 5 | 설정 UI + 발송 이력 | ✅ 완료 | 2026-07-07 |
| 6 | PROD 배포 | ✅ 완료 | 2026-07-07 |

### 결정 이력 (확정 시 여기에 기록)

- **2026-07-07 (검수 + 단계 체류 지연)**: 전체 구현 검수(Fable) — 발견·수정 3건: ①**레거시 오알림 버그**(알림 도입 전 업무는 발송 이력이 없어 첫 PUT에서 상태 안 바뀌어도 "상태 변경" 발송됨 → 기준선 없으면 무발송 baseline 캡처(`skipped/baseline` 로그) 후 다음 실변경부터 감지), ②DM 루프 개선(mode off 시 Slack 매핑 API 미호출, opt_out·매핑실패 스킵 로그 dedupHours당 1건만 — 무한 누적 방지), ③users API 일관성(POST 생성 `slackNotifyEnabled` 수용 + 응답 select 포함). **추가 기능 — 단계(상태) 체류 지연**: 4테이블(projects/site_visits/maintenances/etc_tasks)에 `status_changed_at`(기존 행 NULL·신규 DEFAULT now, 마이그레이션 `20260707..._add_status_changed_at`), 4개 PUT 라우트가 상태 실변경 시 갱신. `notify_status_dwell`(JSON, 기본 빈값=미사용)로 타입별·상태별 임계일 설정 — 설정 페이지 "단계 체류 지연 기준" 카드(상태 목록 동적: BuildStatus/StatusCode, 완료·보류성 상태 제외. 0=미사용). 판정: 앵커 규칙 우선, 아니면 체류(진입시각 = statusChangedAt → 레거시는 앵커일/생성일 fallback), 라벨 `'처리중' 상태 N일째`. **부수 이득**: 완료예정일 미입력 프로젝트도 체류 규칙으로 지연 감지 가능(기존엔 감지 불가 빈틈). INSTALL_PLAN은 2-플래그 구조라 체류 제외.

- **2026-07-07 (추가기능 2건)**: ①**지연 기준일 설정 UI** — 설정 페이지에 타입별 기준 일수(답사·설치계획·기타업무·프로젝트) + 유지보수 우선순위별(긴급/높음/보통/낮음) 입력칸. 저장은 `notify_delay_rules`(JSON), API에서 sanitize(음수·비수치 방지). ②**계정별 Slack 발송 플래그** — `users.slack_notify_enabled`(기본 true) 추가. false면 그 계정에게 DM 미발송(로그 `user_opt_out`). 계정관리 타계정 수정 모달에서 토글(ADMIN). `sendDelayDMs`가 매핑 전에 플래그 확인. dev2 검증: OFF→skip/user_opt_out, ON→sent.

- **2026-07-07 (Phase 4·5 확정)**: DM 정책 — 대상=지연 업무 담당자 전원, 매핑=`users.email`→Slack `lookupByEmail` 후 `users.slack_user_id` 캐시(실패 시 그 사람만 스킵), 재알림=같은 건·같은 사람 **24h 내 1회**(`notify_dm_policy.dedupHours`), **조용시간·주말 제한 없음**, **상한 무제한**(해소 시까지 매일). test 모드는 DM도 테스트 채널로(`[DEV][DM→이름]`). DM 게이트 `notify_dm_enabled`(기본 off). 지연 스케줄러가 채널 요약 + (DM on 시) 담당자 DM 실행(`runDelayNotifications`). Phase 5 = `/settings/notifications`에 지연 주기·DM 토글 + **발송 이력**(최근 50건, 상태 필터, `GET /api/settings/notifications/logs`). dev2 매핑 표본 11/15 성공 확인, 해피패스 DM 발송·캐시 저장 검증. dev2 기본값: enabled on·events on·delay 24h·**dm off**.

- **2026-07-06 (Phase 3 확정)**: ⏳ 지연 기준 확정 — 답사·설치계획 요청일+**7일**, 기타업무 접수일+**14일**, 프로젝트 **완료예정일 경과**(graceDays 0), 유지보수 **우선순위별**(긴급1·높음3·보통7·낮음14). 완료/회신완료·**보류** 상태 제외, KST 자정 기준. 감지 주기 = **매일 1회(24h)**. 요약 1메시지(⏰ N건 목록·상세링크, 최대 20건+"외 N건"), 지연 채널(`SLACK_CHANNEL_DELAY`). 12시간 내 **동일 멤버십(refCode 집합) 재발송 스킵**. 기준값은 AppSetting `notify_delay_rules`(JSON)로 덮어쓰기 가능(미지정=기본). 스케줄러는 mail-scheduler 패턴, `notify_delay_interval`(off/1h/6h/24h)로 제어·instrumentation 기동·설정 페이지에서 변경. dev2 검증: 실데이터 48건 감지·요약 발송·dedup 스킵 확인.

- **2026-07-06 (Phase 2 트리거 변경 — 완료 → 상태변경)**: 사용자 요구로 이벤트를 **등록 + (완료 한정이 아닌) 모든 상태 변경**으로 확장. `task_completed` → `task_status_changed`. 완료는 "→ 완료"라는 상태 변경의 한 경우. **구현**: enrich가 타입별 상태 시그니처(PROJECT=buildStatus 라벨, SITE_VISIT/MAINTENANCE/ETC=상태명, INSTALL_PLAN=`작성:x/회신:y`) 산출 → `notifyTaskStatusChanged`가 **직전 발송 로그의 sig와 비교해 실제 변경 시에만 발송**(from→to 표시). 각 route(5개 [id] PUT)는 조건 없이 호출만, 비상태 필드만 바꾼 저장은 자동 스킵. 시그니처는 notification_logs payload.sig에 기록(등록 알림이 baseline). **업무현황(/tasks) 완료 체크박스 훅은 제거** — Task.isCompleted 플래그만 토글하고 원본 상태를 안 바꾸므로 상태변경 알림 대상 아님(원본 업무 상세에서 상태 바꾸면 발송).

- **2026-07-06 (Phase 2 추가요구 — 필드 설정화)**: 사용자 요구로 **타입별 메시지 포함 필드를 설정 페이지에서 지정** 가능하게 구현(Phase 5의 필드 설정 부분을 앞당김). ⏳ 확정: 등록/완료 **공통 필드셋** + **타입별 추천 세트 기본 on**. 카탈로그·기본값은 `lib/notifyFields.ts`, 저장은 AppSetting `notify_event_fields`(JSON). 페이지 `/settings/notifications`(ADMIN+, 전역/이벤트 토글 + 타입별 체크박스), API `/api/settings/notifications` GET/PUT. 고정 표시(업무타입·병원명/제목·링크)는 토글 대상 아님. 값 없는 필드는 자동 생략. 네비 `settings/notifications`(sort 45, {SUPER_ADMIN,ADMIN}) 추가. **부수 수정**: test 모드 `[DEV]` prefix를 blocks 본문에도 적용(기존엔 fallback text에만 붙어 실제 표시 안 됨), notification_logs payload에 렌더 본문 저장.

- **2026-07-06 (Phase 2)**: ⏳ 확정 — ①채널 전략 = **단일 채널**(`SLACK_CHANNEL_MAIN` 하나로 전 타입 등록/완료 알림, 나중에 분리 여지). ②메시지 = **핵심 필드**(이모지·업무타입·병원명·제목·담당자·상세링크). 등록=🆕 / 완료=✅. 담당자는 "이름 외 N명" 규칙.
- **2026-07-06 (Phase 2 구현 결정)**: ①**Task 미러 불완전 대응** — 프로젝트·답사 POST는 Task를 생성하지 않음(PROJECT 235건 중 Task 199건). 따라서 훅을 "Task 갱신"이 아니라 **엔티티 생성/완료 지점**에 걸고, notify.ts는 `(taskType, refCode)`로 **원본 엔티티를 직접 조회(enrich)**해 병원명·담당자·상세 id를 얻음(Task 유무 무관). ②**멱등성 = notification_logs dedup** — `refCode`+`eventType`에 `sent` 로그 있으면 스킵. 이전 상태 판정 불필요, 재저장·재시도·완료 재PUT 중복 자동 차단. ③완료 훅은 "isCompleted=true면 호출"만, 나머지는 dedup이 처리. ④완료 경로에 `tasks/[id]` PATCH(업무현황 체크박스) 포함 완료.
- **2026-07-06 (Phase 0)**: Slack 봇 `thync_ops_bot`(워크스페이스 SEERS) 생성. 테스트 채널 `C0794GUQQ8Z` 확보. 운영 채널(`SLACK_CHANNEL_MAIN`/`DELAY`)은 당분간 테스트 채널과 동일 ID로 두고 Phase 6(live 전환) 시점에 실제 운영 채널로 교체 예정. `SLACK_NOTIFY_MODE=test`. Phase 0 게이트(auth.test + chat.postMessage) 통과.
- **2026-07-06 (Phase 2 예정 보완)**: 설계서 §6-1 완료 훅 인벤토리에 `app/api/tasks/[id]/route.ts` PATCH(업무현황 완료 체크박스, Task.isCompleted 직접 토글) 추가 필요 — 이 경로 누락 시 업무현황에서 완료 처리한 건은 알림 미발송. Phase 2에서 반영.
- **2026-07-06 (Phase 1 구현 메모)**: 레이어 분리 — `lib/slack.ts`는 순수 전송·모드 라우팅(off/test/live, live→test 강등), `lib/notify.ts`는 정책·로그(dispatchToChannel + recordLog). AppSetting `notify_enabled` 등 기능 토글 게이트는 상위 이벤트 함수(Phase 2 `notifyTaskCreated`/`notifyTaskCompleted`)에서 확인하는 것으로 확정 — Phase 1 `dispatchToChannel`은 env 모드만 확인. `payload`는 `Prisma.InputJsonValue` 캐스팅 필요.
