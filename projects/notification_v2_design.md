# 알림 v2 설계안 — 티켓 단일 소스 재편

> **상태: 완료 — P1~P5 구현 + PROD 배포 (2026-08-03)**
> 구현 편차: ①P3 UI는 "2종 폼 신규"가 아니라 **기존 매트릭스 유지 + CTI 스코프·정책 채널 추가**(기존 화면이 상태·Sev 세분을 이미 충족 — 재편 원칙 우선) ②설정 탭은 4탭이 아닌 **3탭 유지**(채널·발송 규칙이 이미 한 탭) ③SLA_WARNING 배선은 선택이 아닌 포함으로 구현
> 작성 2026-08-03 / 근거: 현행 형상 실사(동일자) + 사용자 확정사항 11건
> 선행 문서: `projects/notification_v1.1_design.md` (1.1 P1~P6 — 이 문서는 그 후속 재편)

---

## 0. 확정사항 (사용자 결정, 2026-08-03)

| # | 결정 |
|---|---|
| 1 | 알림 기준 축은 **티켓** — 도메인 기준 지연 판정(delay-rules)은 폐기, SLA로 일원화 |
| 2 | 발송 모드(off/test/live)는 **env 유지** (PROD→DEV 데이터 동기화 시 오발송 차단) |
| 3 | SLA 시계는 **달력시간**(주말 포함). BUSINESS_HOURS 옵션 제거 |
| 4 | SLA 프레임 = **응답(배정까지) + 해결(해결까지) 2종 시계**, PENDING 중 정지 |
| 5 | 그룹 할당·담당 배정 알림 채널 = **Assignment Group 마스터에 채널 필드** (CTI별 채널은 차기, 도입 시 CTI 지정이 우선) |
| 6 | **'개인 업무' 그룹은 채널 알림 제외**. 그 외 폭주 가능성은 감수 |
| 7 | **DM 불필요.** 채널 메시지에 담당자 **@멘션은 발송** (Slack 계정 = 시스템 이메일) |
| 8 | 채널은 **ID로 저장 + 표시용 채널명 병기** |
| 9 | SLA 초과 알림은 폴링 오차 감수, 놓친 건 다음 주기에 발송(캐치업) |
| 10 | SLA 초과 요약 = **전역 요약 채널 1개 + 관리자 지정 시각** |
| 11 | "메시지에 포함할 필드(타입별)" 카탈로그는 유지 |

---

## 1. 현행 실사 요약 — 유지 / 폐기 / 개조

이번 개편은 신규 구축이 아니라 **1.1 인프라의 재편**이다. 실사 결과:

### 유지 (재사용)
- **`lib/sla.ts` 시계 엔진** — 응답(`FIRST_RESPONSE`)·해결(`RESOLVE`) 시계, PENDING 정지/재개, 정책 우선순위 매칭(refType×queue×CTI서브트리×Sev), 유령 초과 해제까지 이미 완비
- **`lib/notify-routes.ts` + `notify_channels`/`notify_routes`** — 채널 DB 관리·6축 라우팅·채널 병합·멘션 강도·테스트 발송 완비 (요구 "채널을 env에서 빼라"는 이미 충족, env 채널은 잔재만 남음)
- **`lib/sla-alerts.ts`** — 초과 즉시 1회 알림(`notifiedBreachAt` 플래그·재시작 캐치업) + 지정 시각 요약 골격
- **`lib/notify.ts` 디스패치·시그니처 dedup·`lib/notifyFields.ts` 필드 카탈로그** (확정 11)
- **`lib/notify-center.ts` 내부 알림함** — Slack과 병렬 파이프라인, 변경 없음

### 폐기
- **`findDelayedTickets()` + `runSlaOwnerDms()`** — 구 지연 판정과 owner DM (확정 1·7). 호출처 각 1곳뿐이라 제거 용이
- **구 SLA 규칙 축** — AppSetting `notify_sla_rules`(Sev별 일수)·`notify_status_dwell`(상태 체류) + 설정 화면 SlaMatrixTab의 해당 UI + `computeTicketDueAt()`/`getSlaRules()` 호출 8곳
- **`sendConnectionTest()`**(호출처 0) + env `SLACK_CHANNEL_MAIN` 의존 — 삭제
- **`notify_delay_interval`** 구 설정 키 + UI 셀렉트
- **`clockType='BUSINESS_HOURS'`** — 스키마 검증 상수에만 존재, 엔진 미구현 (확정 3에 따라 옵션 자체 제거)
- **`DAILY_DIGEST` 라우팅 규칙 방식** — 전역 요약 1개로 대체 (확정 10)

### 개조 / 실사에서 발견된 결함 수정
| # | 발견 | 처리 |
|---|---|---|
| F1 | `tickets.due_at`을 구 규칙과 SLA 캐시가 **이중 소유**(경합) | SLA 엔진 단일 소유로 정리 — 구 계산 8곳 제거, 정책 미매칭 시 NULL 허용 |
| F2 | `SLA_WARNING`(임박)이 상수·UI·컬럼까지 있는데 **발송 배선 없음** | P3에서 배선 (warnRatio 기존 필드 활용, `notifiedWarnAt` 세팅) — 선택 항목 |
| F3 | 설정 저장 시 `notify_tick_interval`이 **5m으로 조용히 리셋** | PUT 페이로드에 포함 + UI 입력 추가 |
| F4 | `getSlackMode()==='off'`가 SLA **내부 알림까지 차단** | 내부 알림 적재를 Slack 게이트 앞으로 |
| F5 | 로그 조회 필터에 `ticket_assigned` 누락 | 화이트리스트 추가 |
| F6 | 변경 감지 sig가 `notification_logs`에 저장 — 로그 purge 시 오동작 | `tickets.notify_sig` 컬럼으로 이전 |
| F7 | 다이제스트 `queueIds` 스코프 무시 | 전역 요약 전환으로 자연 해소 |

---

## 2. 목표 상태 (한 장)

```
[티켓 이벤트]                          [SLA 엔진 (기존)]
 생성/배정/이관/상태변경                  응답·해결 시계 (CTI×Sev 정책)
      │                                     │
      ▼                                     ▼
 그룹 채널 발송                        초과 즉시 → 정책 지정 채널
 (TicketQueue.notifyChannelId,         (SlaPolicy.notifyChannelId,
  개인 업무 제외, 담당자 @멘션)          없으면 SLA_BREACH 라우팅 폴백)
      │                                     │
      └────────────┬────────────────────────┘
                   ▼
        전역 요약 (지정 시각 1회, 초과 티켓 모음 → 전역 요약 채널)
                   +
        내부 알림함 (변경 없음, Slack과 독립)

발송 모드: env(SLACK_NOTIFY_MODE) 그대로 — test 모드 전량 SLACK_CHANNEL_TEST 리라우팅
채널 마스터: notify_channels (ID+표시명, 테스트 발송) — 기존 화면 재사용
```

**설정 IA (재편 후)** — `/settings/notifications` 단일 허브 4탭:
① **SLA 정책** (CTI×Sev × 응답/해결 임계 + 정책별 알림 채널) ② **채널** (notify_channels CRUD + 테스트) ③ **발송 규칙** (이벤트 라우팅 — 고급) ④ **전역** (토글·필드 카탈로그·요약 시각/채널·tick 주기·이력).
Assignment Group별 채널은 `/settings/ticket-queues`에서 지정 (그룹 관리와 같은 자리).

---

## 3. Phase 계획

### P1 — 구체계 정리 (파괴적 변경 없음, 폐기·결함 수정)
1. `runSlaOwnerDms`·`findDelayedTickets` 제거 (DM 경로 소멸 — 확정 7)
2. `tickets.due_at` 단일 소유화: `computeTicketDueAt`/`getSlaRules` 호출 8곳(`app/api/tickets/*` 2, `lib/ticketDomain.ts` 6) 제거 → SLA `syncTicketDueAtCache`만 기록. 미매칭 티켓 due_at NULL 허용(목록 '-' 표시 확인)
3. `sendConnectionTest` 삭제, `notify_delay_interval` 제거, BUSINESS_HOURS 상수·검증 제거
4. 결함 수정: F3(tick 리셋), F4(내부 알림 게이트), F5(로그 필터), F6(sig → `tickets.notify_sig` 컬럼, 마이그레이션 1건)
5. 구 SLA 기준 UI(SlaMatrixTab 내 Sev별 일수·상태 체류 부분) 제거
- **게이트**: tsc 0 + 기존 스모크(`sla-smoke`·`notify-routes-smoke`) 통과 + 티켓 생성→알림 로그 정상

### P2 — 그룹 채널 발송 (요구 1·2·3)
1. **DB**: `ticket_queues.notify_channel_id INT NULL REFERENCES notify_channels(id) ON DELETE SET NULL` (마이그레이션 1건, 수동 절차)
2. **설정 UI**: `/settings/ticket-queues` 행에 채널 셀렉트 + 테스트 발송 버튼 (기존 `kind:'test'` 패턴 재사용). '개인 업무' 그룹은 채널 지정 UI 비활성(제외 안내)
3. **발송 로직** (`lib/notify.ts`): 생성·큐 이관·담당 배정 이벤트 시 — 라우팅 규칙 매칭 결과에 **큐 채널을 추가 병합**(같은 채널이면 1건). 큐 이름이 `PERSONAL_QUEUE_NAME`이면 채널 발송 전체 스킵
4. **@멘션** (요구 3): 담당자 있는 티켓 메시지에 `buildMentionLine` 확장 — `resolveSlackUserId`(이메일 lookup + `User.slackUserId` 캐시)로 `<@Uxxx>` 태그, 미매핑 시 이름 텍스트 폴백. `slackNotifyEnabled=false`여도 채널 멘션은 발송(확정 7 — DM 아님)
- **게이트**: 그룹 채널 지정 → 티켓 생성/배정 시 해당 채널 수신 + 멘션 확인(테스트 모드, 알림 개인 테스트는 이준호 대상)

### P3 — SLA 정책 개편 (요구 5·5-1·5-2·6)
1. **DB**: `sla_policies.notify_channel_id INT NULL REFERENCES notify_channels(id) ON DELETE SET NULL`
2. **정책 등록 UI 재편** (탭①): "CTI 선택(트리, 서브트리 상속 명시) × Sev(다중) → 응답 임계 + 해결 임계(시간 단위 입력) + 알림 채널" 폼. 내부적으로 기존 SlaPolicy(+ SlaTarget metric=ASSIGN 또는 FIRST_RESPONSE / RESOLVE)로 저장 — **엔진 무변경**. 응답 시계의 metric은 `ASSIGN`(배정까지)으로 통일(FIRST_RESPONSE는 유지하되 UI 비노출)
3. **초과 발송 채널**: `runSlaBreachAlerts`에서 시계의 policy에 `notifyChannelId` 있으면 그 채널로, 없으면 기존 `SLA_BREACH` 라우팅 폴백
4. (선택 — F2) `SLA_WARNING` 배선: warnRatio 경과 시 1회 발송(`notifiedWarnAt` 세팅). 기본 라우팅 규칙 없음 = 만들지 않으면 미발송
5. 기존 정책 데이터: 이관 스크립트 불요(정책 수 소수) — 새 UI에서 재등록 안내, 구 정책은 남겨도 무해
- **게이트**: CTI별 정책 등록 → 해당 CTI 티켓 생성 → 시계 생성·임계 초과 시 지정 채널 수신 확인

### P4 — 전역 요약 (요구 7)
1. AppSetting 2키: `notify_digest_hour`(KST 0~23 | off) + `notify_digest_channel_id`(notify_channels FK)
2. `runDailyDigests` 단순화: 라우팅 규칙 순회 → **전역 설정 1건** 발송(초과 전체 + 임박 옵션, 그룹별 섹션 정렬 유지). 1일 1회 판정은 기존 로그 방식 유지
3. `DAILY_DIGEST` 이벤트 타입·규칙 UI 제거 (기존 규칙 레코드는 비활성 처리)
- **게이트**: 지정 시각 도래 tick에서 요약 1건 발송·중복 없음

### P5 — 설정 IA·문서 마감
1. 탭 재편(§2), env 잔재 정리(SLACK_CHANNEL_MAIN 문서 제거, `.env.example`에 Slack 4변수 문서화)
2. `seed-notify-routes.sql` 갱신(다이제스트 규칙 제거·기본 규칙 정리), 스모크 스크립트 갱신
3. README·DEV_HISTORY·이 문서 상태 갱신
- **게이트**: PROD 배포 + 실채널 1건 검증 후 완료 처리

---

## 4. 마이그레이션 (수동 절차 — CLAUDE.md 규칙 1)

| 시점 | SQL |
|---|---|
| P1 | `ALTER TABLE tickets ADD COLUMN notify_sig TEXT` |
| P2 | `ALTER TABLE ticket_queues ADD COLUMN notify_channel_id INT REFERENCES notify_channels(id) ON DELETE SET NULL` |
| P3 | `ALTER TABLE sla_policies ADD COLUMN notify_channel_id INT REFERENCES notify_channels(id) ON DELETE SET NULL` |

전부 추가형 — 기존 데이터 무영향. PROD 반영 시 각 Phase 배포와 함께 적용.

## 5. 리스크·미결

- **due_at NULL 증가**: 정책 미매칭 티켓은 due_at이 비게 됨 — 전 티켓 커버용 기본(catch-all) 정책 1건을 시드로 둘지는 P3에서 운영 데이터 보고 결정
- **기존 발송 규칙과 큐 채널의 중복 수신**: 같은 채널이면 병합되지만 다른 채널이면 양쪽 발송 — 의도된 동작(규칙은 고급 경로로 유지), 운영하며 규칙 정리
- **CTI별 채널(차기 예고)**: 도입 시 우선순위 = CTI 지정 > 그룹 채널 (확정 5의 단서). P2 발송 로직에 주석으로 확장점 명시
- 로그 보존 정책(purge)은 이번 범위 외 — F6 처리로 sig 의존은 해소되므로 추후 안전

## 6. 검증 계획

- 단계별 스모크: 기존 `scripts/sla-smoke.mts`·`notify-routes-smoke.mts` 확장 (그룹 채널·정책 채널·전역 요약 케이스 추가)
- 발송 검증은 test 모드(`SLACK_CHANNEL_TEST` 리라우팅)로 dev2에서, 개인 멘션 테스트는 '이준호' 대상만
- PROD 반영은 Phase별이 아니라 **P1~P4 완료 후 일괄** 권장 (알림은 반쪽 배포 시 혼선)
