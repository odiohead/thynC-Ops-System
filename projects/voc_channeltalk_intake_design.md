# 채널톡 상담 원천 적재 (voc-channeltalk-intake) — 설계안

> **상태: 1단계(원천 적재) 구현 완료 (dev2 2026-09-28 — 빌드·재시작, PROD 미반영)** — 추천안 §8 A~H 전건 승인. 열람 화면은 사용자 지시로 **nav 미등록(URL `/voc/inbox` 직접 진입)**. 전체 이력 백필은 미실행(PROD 반영 시 수행). §13 구현 노트
> 상위 문서: `cs_ticket_workflow_design.md`(VOC접수 도메인 본체), 선례: `channeltalk_as_intake_design.md`(채널톡 AS 시트 폴링)
>
> 채널톡(Channel Talk)에 인입되는 **모든 고객 상담(userChat)을 Open API로 수집해 원본 그대로 적재**한다. 이 문서의 범위는 **원천 적재층까지**이며, 적재된 상담을 `voc_receipts`(VOC 레코드)로 승격하는 규칙·화면은 **다음 단계 문서**로 분리한다(사용자 결정 2026-09-28).

---

## 1. 배경·목표

- CS 처리의 모든 업무를 **VOC 도메인에서 출발**시키려 한다. VOC 도메인(`voc_receipts`, `/voc`, CS 마스터 티켓, 하위 티켓 생성)은 2026-08-15에 구축됐으나 **인입 경로가 수동 등록뿐**이라 실사용 0건이다.
- 고객 접점은 채널톡이다. 현재 시스템은 채널톡 중 **AS 문의만** ALF 태스크→구글시트→1분 폴링 경로로 받는다(`lib/channeltalkAsSync.ts`). 그 외 문의(사용법·장애·요청·불만 등)는 시스템에 흔적이 없다.
- Open API 키 발급이 가능하다(사용자 확인 2026-09-28). 시트 중계 없이 **채널톡 원본을 직접 읽는다**.

### 1.1 2층 구조 원칙 (사용자 합의)

| 층 | 역할 | 본 문서 |
|---|---|---|
| **원천 적재층** | 채널톡 userChat·메시지·고객을 **원문 그대로, 멱등하게** 쌓는다. 업무 판단 없음 | **범위 내** |
| **VOC 승격층** | 적재된 상담을 규칙에 따라 `voc_receipts`로 만들고 AS접수 등과 연결 | 다음 단계 |

원본을 먼저 잃지 않고 쌓아두면, 승격 규칙(전건/태그 기준/종료 건만 등)·AS접수와의 관계를 나중에 바꿔도 **재승격이 가능**하다. AS 시트 폴링에서 원본을 남기지 않아 행 밀림·재처리에 비용을 치른 경험(`channeltalk_as_intake_design.md` 2026-09-19 행 이동 가드)이 근거.

### 1.2 범위 밖 (명시)

- `voc_receipts` 생성·연결, VOC 분류 자동 판정, AS접수와의 중복 처리 → 다음 단계
- 채널톡으로 **메시지 발송**(양방향) → 미정. 본 단계는 읽기 전용
- 기존 AS 시트 폴링(`channeltalkAsSync`)은 **무변경** — 별도 모듈로 병존. 통합 여부는 승격 단계에서 판단

---

## 2. 채널톡 Open API 조사 (2026-09-28, 공개 문서 기준 — 키 발급 후 실측 필요 §9)

- 베이스: `https://api.channel.io/open/v5/` · 인증 헤더 `x-access-key` / `x-access-secret` (채널 데스크에서 발급)
- **userChat 목록** `GET /user-chats?state={opened|snoozed|closed}&sortOrder={asc|desc}&limit≤500&since=<cursor>` — 응답 루트 `next` 커서로 페이지 이동. **갱신시각(updatedAt) 필터가 없다** → 증분 전략은 §4.2
- **userChat 단건** `GET /user-chats/{id}` — userChat + 연관 `user`·`managers`·`message`(최근)·`session`
- **메시지** `GET /user-chats/{id}/messages?sortOrder=asc&limit≤500&since=<cursor>` — `next` 커서
- **UserChat 필드**(문서 확인분): `id, channelId, state(opened/snoozed/closed), managed, userId, name, description, handling, source, managerIds, assigneeId, tags[], priority, workflowId, firstOpenedAt, openedAt, createdAt, closedAt, firstAskedAt, askedAt`
- **Message 필드**: `id, chatId, chatType, personType(user/manager/bot), personId, plainText, blocks[], files[], createdAt, state, options`
- **User 필드**: `id, memberId, name, profile{name, mobileNumber, email, 커스텀 키…}, tags[], unifiedId, language, createdAt, lastSeenAt`
- **웹훅**: 데스크 Settings > Webhook 등록, 이벤트는 현재 **메시지 생성 중심**(userChat/user 이벤트 확대 예정). 서명 검증·재시도 정책은 문서에서 미확인 → **본 단계 불채택**(§8 F)
- **레이트리밋**: `x-ratelimit-*` 응답 헤더 존재. 수치는 문서에서 확인 실패 → 실측 후 §4.4 상수 확정. 429 시 지수 백오프

---

## 3. 데이터 모델 (public 스키마, 신규 4테이블 — 기존 테이블 변경 없음)

설계 원칙: **원문 JSON 컬럼(raw) + 조회·정합에 필요한 추출 컬럼**. 추출 컬럼은 raw에서 언제든 재계산 가능(재계산 스크립트 §6).

### 3.1 `channeltalk_user_chats` — 상담 1건 = 1행

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | VARCHAR(40) PK | 채널톡 userChat id (자체 PK, autoincrement 없음) |
| `channel_id` | VARCHAR(40) | 채널톡 채널 id |
| `user_id` | VARCHAR(40) FK→`channeltalk_users.id` (SET NULL) | 고객 |
| `state` | VARCHAR(16) | opened / snoozed / closed |
| `assignee_id` | VARCHAR(40) NULL | 담당 매니저 id |
| `manager_ids` | TEXT[] | 참여 매니저 |
| `tags` | TEXT[] | 채널톡 태그 (승격 규칙 축 후보) |
| `name` | TEXT NULL | 채널톡이 붙인 상담 제목 |
| `description` | TEXT NULL | |
| `source_type` | VARCHAR(32) NULL | `source.type` (웹·모바일·카카오 등 인입 매체) |
| `first_ask_text` | TEXT NULL | **고객 첫 질문 본문**(메시지 중 personType=user 최초 plainText) — 목록·승격 제목용 |
| `first_asked_at` / `opened_at` / `closed_at` / `created_at_ct` | TIMESTAMPTZ NULL | 채널톡 시각(epoch ms → tz) |
| `raw` | JSONB | userChat 원문 전체 |
| `message_cursor` | TEXT NULL | 메시지 증분 `next` 커서 (마지막 수집 지점) |
| `message_count` | INT DEFAULT 0 | 적재된 메시지 수 |
| `messages_synced_at` | TIMESTAMPTZ NULL | 메시지 마지막 수집 시각 |
| `hospital_code` | VARCHAR NULL FK→`hospitals` (SET NULL) | **참고용 자동 매칭**(§4.3) — 승격 시 확정, 적재층은 힌트만 |
| `hospital_match_note` | TEXT NULL | 매칭 실패 사유·후보 |
| `first_seen_at` / `last_synced_at` | TIMESTAMPTZ | 시스템 최초 적재·마지막 갱신 |
| `raw_hash` | VARCHAR(64) | raw의 sha256 — 변경 감지(무의미 UPDATE 방지) |

인덱스: `(state)`, `(closed_at)`, `(first_asked_at)`, `(user_id)`, `(hospital_code)`, `tags` GIN

### 3.2 `channeltalk_messages` — 메시지 1건 = 1행

| 컬럼 | 비고 |
|---|---|
| `id` VARCHAR(40) PK | 채널톡 message id |
| `chat_id` FK→`channeltalk_user_chats.id` **ON DELETE CASCADE** | |
| `person_type` VARCHAR(16) · `person_id` VARCHAR(40) NULL | user / manager / bot |
| `plain_text` TEXT NULL | 본문 (blocks 렌더는 raw 보존) |
| `has_files` BOOL · `file_meta` JSONB NULL | 파일은 **메타(이름·타입·크기·URL)만** 저장, 바이너리 미수집 (§8 C) |
| `created_at_ct` TIMESTAMPTZ | |
| `raw` JSONB | 원문 |

인덱스: `(chat_id, created_at_ct)`

### 3.3 `channeltalk_users` — 고객 프로필 (최신 스냅샷 1행)

| 컬럼 | 비고 |
|---|---|
| `id` VARCHAR(40) PK | |
| `member_id` · `unified_id` VARCHAR NULL | |
| `name` TEXT NULL · `mobile_number` VARCHAR NULL · `email` VARCHAR NULL | profile에서 추출 (§8 D 개인정보) |
| `profile` JSONB NULL | 커스텀 필드 포함 원문 — **병원명 필드가 어디 있는지 실측 후 매칭 규칙 확정** |
| `tags` TEXT[] | |
| `raw` JSONB · `last_synced_at` | |

### 3.4 `channeltalk_sync_runs` — 틱 실행 로그 (운영 가시성)

`id serial · started_at · ended_at · mode(backfill/incremental/manual) · scanned_chats · upserted_chats · fetched_messages · api_calls · rate_limited(int) · error TEXT NULL · stats JSONB` — 30일 보관(틱에서 오래된 행 삭제)

### 3.5 Prisma

모델 `ChanneltalkUserChat`·`ChanneltalkMessage`·`ChanneltalkUser`·`ChanneltalkSyncRun` (`@@schema("public")`). `Hospital`에 역참조 1건 추가. **`VocReceipt`는 본 단계에서 변경하지 않는다**(승격 단계에서 `channeltalkChatId` 추가 — §8 G).

마이그레이션은 CLAUDE.md 규칙 1(psql 직접 실행 → 파일 수동 생성 → `migrate resolve --applied` → `prisma generate`).

---

## 4. 수집 흐름

### 4.1 모듈 구성 (AS 시트 폴링 패턴 그대로)

```
lib/channeltalk/client.ts        Open API 클라이언트 — 인증 헤더·페이지 순회·429 백오프·호출 카운트
lib/channeltalk/vocSync.ts       runChanneltalkVocSync(mode) — §4.2 알고리즘, 결과 요약 반환
lib/channeltalk-voc-scheduler.ts 주기 실행 (channeltalk-as-scheduler 복제, 재진입 가드)
instrumentation.ts               기동 시 AppSetting channeltalk_voc_interval 로 시작 (기본 off)
```

인증: `.env` `CHANNELTALK_ACCESS_KEY` / `CHANNELTALK_ACCESS_SECRET` (dev2·dev·PROD 각각 — 키가 같으면 같은 채널을 읽으므로 dev도 실데이터가 들어옴. dev는 읽기만 하므로 무해)

### 4.2 증분 알고리즘 (updatedAt 필터 부재 대응)

틱마다 3단계. 모두 **upsert(id 기준) + raw_hash 비교로 변경 시에만 UPDATE**.

1. **활성 상담 전량**: `state=opened`, `state=snoozed` 를 `asc`로 끝까지 순회. 활성 건수는 수십 건 수준으로 가정(실측 §9) → 매 틱 전량이 가장 단순·정확. 상태·담당·태그 변화를 놓치지 않음
2. **종료 상담 증분**: `state=closed&sortOrder=desc` 로 최신부터 순회하다가 **`closedAt ≤ (DB closed_at 최대값 − 안전 마진 24h)` 인 행을 만나면 중단**. 리오픈된 상담은 1단계에서 잡히고, 다시 닫히면 closedAt이 갱신돼 2단계에서 다시 잡힌다
3. **메시지 증분**: 1·2단계에서 **신규이거나 raw_hash가 바뀐 상담**에 대해 `messages?sortOrder=asc&since=<message_cursor>` 로 이어서 수집. `first_ask_text`가 비어 있으면 첫 user 메시지로 채움. 고객(`user_id`)은 상담 응답에 포함된 user 객체를 upsert(별도 호출 없음, 없으면 `GET /users/{id}`)

**초기 백필(mode=backfill)**: `state=closed&sortOrder=asc` 로 처음부터 끝까지 + 활성 전량. 500건/페이지, 레이트리밋 준수. **백필 범위는 §8 A** (전체 이력 vs 컷오버일 이후). 진행 커서를 `AppSetting channeltalk_voc_backfill_cursor`에 저장해 **중단·재시작 시 이어서** 진행. 백필 완료 후 자동으로 incremental 모드

### 4.3 병원 자동 매칭 (힌트)

`lib/hospitalNameMatcher`(AS 폴링·마이그에서 검증)로 **후보 문자열 순서**: ① `channeltalk_users.profile`의 병원 필드(실측 후 키 확정) ② user.name ③ userChat.name ④ 첫 질문 본문의 `OO병원` 패턴. 유일 매칭이면 `hospital_code`, 아니면 `hospital_match_note`에 후보 기록. **적재층은 확정하지 않는다** — 승격 단계에서 사람이 검토·확정.

### 4.4 안전장치

- 재진입 가드(이전 틱 진행 중 스킵), 틱당 API 호출 상한(기본 200회 — 초과 시 다음 틱으로 이월), 429 → `Retry-After`/지수 백오프(최대 3회) 후 틱 종료
- 채널톡 장애·키 오류: `channeltalk_sync_runs.error` 기록 + 연속 3회 실패 시 콘솔 경고. Slack 알림은 **미발송**(규칙 1 — 티켓 파이프라인 외 알림 신설 금지, 운영 알림은 후속)
- 채널톡에서 상담이 **삭제**된 경우: 감지 수단 없음(목록에 안 나올 뿐). 적재본은 유지(원장 성격). 필요 시 §6 재검 스크립트
- 페이로드 크기: raw JSONB 상담당 수 KB, 메시지 수백 B. 연 수천 건 규모면 수십 MB — 무시 가능

---

## 5. 화면·API (초기 단순 원칙 — `ui-start-simple`)

### 5.1 설정 `/settings/channeltalk-sync` (ADMIN 이상, nav 설정 그룹)

`mail-sync` 설정 페이지 패턴 복제: 주기(off/1m/5m/10m) 저장 · 마지막 실행 결과(최근 `sync_runs` 10건 표) · **[지금 실행]** 버튼(incremental) · **[백필 시작/이어서]** 버튼 · 키 설정 여부 표시(값 노출 없음).
API: `GET/PUT /api/settings/channeltalk-sync`(interval·상태) · `POST /api/settings/channeltalk-sync/run` `{mode}` (재진입 시 409)

### 5.2 원본 열람 `/voc/inbox` (읽기 전용 — §8 E)

승격 전이라도 **데이터가 들어오는지 사람이 확인할 수단**은 필요. VOC 접수 화면과 같은 게이트(`/voc` 진입 조건 동일). 초기 버전:
- 상단 요약 한 줄: 활성 n · 오늘 인입 n · 마지막 동기화 시각
- 필터: 상태(활성/종료) · 기간(firstAskedAt) · 태그 · 병원(매칭 힌트) · 검색(첫 질문·고객명)
- 표: 인입시각 · 고객(이름·병원 힌트) · 첫 질문(1줄 말줄임) · 태그 · 담당 · 상태 · 메시지 수
- 행 클릭 → 우측 패널(또는 상세 `/voc/inbox/[id]`)에 **메시지 타임라인**(user/manager/bot 구분, 파일은 링크)과 채널톡 데스크 딥링크
- **액션 없음**(승격 버튼은 다음 단계에서 이 화면에 붙는다)

API: `GET /api/channeltalk/chats`(필터·페이지) · `GET /api/channeltalk/chats/[id]`(상담+메시지)

nav: `voc/inbox`('채널톡 상담', parent `voc` 또는 운영현황 하위 — §8 E) — `scripts/seed-cs-masters.sql`에 행 추가(규칙 4 유사, idempotent)

---

## 6. 운영 스크립트

- `scripts/channeltalk-voc-backfill.mts [--dry] [--since=YYYY-MM-DD]` — 백필을 서버 밖에서 돌릴 때(대량 이력·PROD 첫 적재). 서버 스케줄러와 **동시 실행 금지**(같은 upsert라 데이터는 안전하나 레이트리밋 공유)
- `scripts/channeltalk-voc-recompute.mts` — raw에서 추출 컬럼·병원 힌트 재계산(매칭 규칙 개선 시)
- `scripts/tmp-channeltalk-probe.mts`(일회용, 커밋 제외) — 키 발급 직후 §9 실측: 필드 형상·profile 키·활성 건수·총 건수·레이트리밋 헤더

---

## 7. 파일 목록 (예정)

| 구분 | 파일 |
|---|---|
| DB | `prisma/schema.prisma`, `prisma/migrations/2026MMDDHHMMSS_channeltalk_raw_intake/migration.sql` |
| 수집 | `lib/channeltalk/client.ts`, `lib/channeltalk/vocSync.ts`, `lib/channeltalk/shared.ts`(라벨·상태 상수, 클라이언트 안전), `lib/channeltalk-voc-scheduler.ts`, `instrumentation.ts` |
| API | `app/api/settings/channeltalk-sync/route.ts`, `.../run/route.ts`, `app/api/channeltalk/chats/route.ts`, `.../[id]/route.ts` |
| 화면 | `app/settings/channeltalk-sync/page.tsx`, `app/voc/inbox/page.tsx`, `app/voc/inbox/_components/ChatTimeline.tsx` |
| 시드·스크립트 | `scripts/seed-cs-masters.sql`(nav 행), `scripts/channeltalk-voc-backfill.mts`, `scripts/channeltalk-voc-recompute.mts` |
| 문서 | `projects/README.md`, `README.md`(기술 스택·스키마·API·디렉토리·주요 기능), `DEV_HISTORY.md` |

---

## 8. 결정 요청 (사용자)

| # | 질문 | 추천 |
|---|---|---|
| A | **백필 범위** — 채널톡 전체 이력 vs 특정 일자 이후 | **전체 이력** — 원장 성격이고 과거 VOC 분석 가치 있음. 규모가 크면(수만 건) 스크립트(§6)로 야간 실행 |
| B | **폴링 주기 기본값** | **5m** — AS처럼 사람 처리 대기가 아니라 열람용. 승격 단계에서 1m로 조정 가능 |
| C | **파일 첨부** — 메타만 vs S3 복제 | **메타만** — 채널톡 URL로 열람. 만료·권한 문제 생기면 후속 |
| D | **고객 개인정보**(전화·이메일) 저장 | **저장** — 승격 시 `customerPhone`으로 옮길 원천. 사내 도구·접근 게이트 있음. 원치 않으면 컬럼만 비움(raw에서도 마스킹) |
| E | **원본 열람 화면** 포함 여부·위치 | **포함, `/voc/inbox`** — nav '채널톡 상담'을 VOC 접수 옆에. 승격 버튼이 붙을 자리 |
| F | **웹훅 병행** | **불채택** — 이벤트가 메시지 생성 중심이고 서명 검증 미확인. 폴링만 |
| G | `VocReceipt.channeltalkChatId` 지금 추가 | **다음 단계** — 본 단계는 VOC 테이블 무변경 |
| H | AS 시트 폴링과의 관계 | **무변경 병존** — AS 채팅도 원본으로 적재됨(중복 아님, 층이 다름). 통합은 승격 단계 |

---

## 9. 실측 결과 (2026-09-28, Open API 키로 직접 조회 — 확인 필요 6건 전부 해소)

| # | 항목 | 실측 |
|---|---|---|
| 1 | 규모 | opened **19** · snoozed 0 · closed **3,038**(2026-03-31~09-28, 실질 7월부터 월 800~1,300건 ≈ 하루 30~40건). 백필 = 500건×9페이지 + 상담별 메시지 호출 ≈ 3,100회 |
| 2 | 병원 식별 | `user.profile.OpsCode` = **우리 `hospital_code`(HOSP-xxxxxx)** — 최근 475명 중 276명 보유, **276/276 DB 일치**. 나머지는 `profile.hospital`(자유 표기 병원명, 법인명 혼재) → 매처 폴백. 기타 키: `name·mobileNumber·landlineNumber·adress·adress2·description·ward·email` |
| 3 | 레이트리밋 | `x-ratelimit-limit: 1000`, 500건 페이지 9회 연속 호출 후 remaining 998 → 짧은 윈도 기준 1,000회. 틱당 상한 200회면 여유 |
| 4 | 필드 형상 | `tags[]`는 **값이 있을 때만 키 존재**(1,500건 중 923건, 예 `f_AS_고장접수`·`팀/사업지원팀` — 팀 태그와 분류 태그 혼재, 태그 마스터 40종 `GET /chat-tags`). `source`는 workflow/medium 객체(카카오 `contactMediumType=appKakao` 81%). `updatedAt`은 종료 후에도 계속 갱신(통계 필드 영향) → 변경 감지는 raw_hash 유지. `goalState`·`oneStop`·`priority`·응답시간 통계 필드 다수 → raw에만 보존 |
| 5 | 메시지 | 목록 응답 루트 `messages`는 **상담당 마지막 1건**(대부분 bot 종료 메시지) → 첫 질문은 반드시 `/messages` 호출. `personType` user/manager/bot, `blocks[{type:'text',value}]`, 파일은 `files[{id,name,type,size,contentType,bucket,key}]`(URL 아님 — 열람은 데스크 딥링크). 응답에 `bots` 마스터 동봉 |
| 6 | 키 권한 | 발급 키로 목록·단건·메시지·managers·chat-tags·webhooks 조회 전부 200. 매니저 15명(`GET /managers` — 담당 표시용 마스터). 데스크에 테스트 웹훅 1건(message.created 스코프)만 등록돼 있음 — 본 단계 미사용 |

**실측에 따른 설계 조정**
- §3.1 병원 힌트: `hospital_code`는 **OpsCode 우선 확정**(정확 일치) → 없으면 `profile.hospital`·이름 매처. `hospital_match_source`(opscode/name/none) 컬럼 추가
- §3.3 `channeltalk_users`에 `ops_code`·`hospital_name_raw`·`ward`·`address`(adress+adress2) 추출 컬럼 추가
- **§3.6 `channeltalk_managers` 신설**(id·name·email·raw·last_synced_at) — 담당·참여자 이름 표시용, 틱마다 1회 갱신
- §4.2 3단계: 목록 응답에 동봉된 `users`로 고객 upsert(별도 호출 없음). 메시지는 **신규 상담은 전량, 기존 상담은 raw_hash 변경 시 커서 이후만**
- **데이터 거버넌스 주의**: 병원 직원이 보내는 상담 본문에 환자 이름·등록번호 등이 **부수적으로 포함될 수 있음**(실측 샘플에서 확인). 본 시스템은 환자 데이터를 다루지 않는 원칙이므로 열람 화면은 VOC 게이트 뒤에만 두고, 본문은 AI 검색 인덱스·Slack 알림 등 다른 경로로 **재전파하지 않는다**. 마스킹 여부는 승격 단계에서 결정

### 9.1 (기록) 착수 전 확인 목록 — 위 표로 해소

1. 활성(opened+snoozed) 건수·전체 closed 건수·하루 인입량 → §4.2 상수·백필 시간 산정
2. `user.profile` 커스텀 키 — 병원명이 어느 키에 들어오는지(없으면 §4.3 ②~④만)
3. 레이트리밋 헤더 실값(`x-ratelimit-limit/remaining/reset`) → 틱당 호출 상한 확정
4. `source`·`handling`·`priority`·`workflowId` 실제 값 형상 (추출 컬럼 확정)
5. 메시지 `blocks` 형식 — plainText만으로 충분한지(서식·이미지 인라인)
6. 키 권한 범위 — 데스크에서 발급 시 읽기 스코프만 선택 가능한지

---

## 10. 검증 계획 (dev2)

- tsc 0 · eslint 0 · 힙 4GB 빌드
- probe 실측 → 백필 dry → 백필 소량(`--since` 최근 7일) → 건수 = 채널톡 데스크 표시 건수 대조
- 증분: 데스크에서 상담 1건 생성·답변·종료·리오픈 → 다음 틱에 state·closed_at·메시지 증가 반영, 무변경 틱은 UPDATE 0(raw_hash)
- 장애: 잘못된 키 → sync_runs.error 기록·서버 정상, 429 모의(클라이언트 testIo 주입) → 백오프·이월
- 화면: 목록 필터 6종·상세 타임라인·설정 저장·[지금 실행] 409 재진입
- 테스트로 만든 상담은 채널톡에서 정리(시스템 적재본은 운영 데이터와 구분 불가 → 테스트 상담 제목 접두 `[TEST]` 규약)

---

## 11. 구현 순서

1. 키 수령 → probe 실측 → §3 추출 컬럼·§4 상수 확정(문서 갱신)
2. 마이그·Prisma 모델
3. `client.ts` + `vocSync.ts`(incremental) + 스케줄러 + instrumentation
4. 백필 스크립트 → dev2 소량 적재
5. 설정 페이지·API
6. 열람 화면·API·nav 시드
7. 검증·문서 → **빌드·PM2·push는 사용자 요청 시**

---

## 12. 다음 단계 개요 (본 문서 범위 밖 — 별도 설계 `voc_channeltalk_promotion_design.md`)

- 승격 규칙: 전건 자동 vs 태그/종료 조건 vs 열람 화면에서 수동 [VOC 생성] — 초기는 수동+선택 자동 권장
- `VocReceipt.channeltalkChatId`(unique) + VOC_CHANNEL '채널톡' 시드 + 상세에 채널톡 타임라인 임베드
- AS 문의 상담 ↔ 기존 AS접수 연결(VOC 마스터 ← AS 하위 티켓, parentId) — 시트 폴링 통합 여부
- 채널톡 태그 ↔ VOC 분류(VOC_TYPE) 매핑 마스터

---

## 13. 구현 노트 (2026-09-28)

- **설계 대비 변경**: ① 메시지 증분은 `message_cursor` 대신 desc 순회로 저장된 id를 만나면 중단(채널톡이 마지막 페이지에 `next`를 주지 않음 — 컬럼은 마지막 메시지 id 참고용) ② `raw_hash`는 유의미 필드만(state·assignee·managerIds·tags·name·description·userId·시각 3종·마지막 메시지 id 3종) — `updatedAt`은 종료 후에도 통계 갱신으로 계속 바뀜 ③ `channeltalk_managers` 신설(§9) ④ 병원 힌트 ④(첫 질문 본문 패턴)는 미구현 — OpsCode 커버리지가 높아 불필요 ⑤ 부분 백필(`--since`)은 커서를 남기지 않음(전체 백필 미완료 상태 유지) ⑥ 스크립트는 호출 상한 무제한, 서버 틱은 AppSetting 기본 200
- **nav**: `/voc/inbox`는 사용자 지시로 미등록. `/settings/channeltalk-sync`는 설정 > 연동·알림 그룹(sort 103, ADMIN 이상)에 등록(`seed-cs-masters.sql` 7 — 사용자 지적 2026-09-28)
- **PROD 반영 절차(예정)**: `.env` 키 2줄 → git pull → 마이그 psql 적용·resolve → generate → 빌드·재시작 → `scripts/channeltalk-voc-backfill.mts --dry` → `--loop` 전체 백필(≈3,100 호출, 수 분) → 설정 화면에서 주기 5m
