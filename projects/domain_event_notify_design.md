# 도메인 이벤트 Slack 알림 (domain-event-notify) — 설계안

> **상태: 구현 완료 (dev2 2026-10-27, 빌드·적용) — PROD 미반영** — 사용자 결정: 재편 + AS 입고확인 동시 진행, 3겹 토글 → 라우트 일원화 동의, 채널은 기존 'AS업무'. §5 재편 설계·§6 구현 노트 참조.
> 상위: `notification_v1.1_design.md` §5(채널 라우팅) · 규칙: CLAUDE.md 티켓 시스템 규칙 1(알림은 `lib/notify.ts` 단일 소스, 도메인 라우트에서 직접 발송 금지)

---

## 1. 배경

- 요구: AS업무에서 담당자가 **입고확인**을 수행하면 특정 Slack 채널에 "입고 완료" 알림. 앞으로도 주요 기능마다 알림 여부·채널을 세밀하게 제어하고 싶음.
- 현재 Slack 알림은 **티켓 이벤트** 7종(TICKET_CREATED·TICKET_STATUS_CHANGED·TICKET_QUEUE_TRANSFERRED·SEV_ESCALATED·SLA_BREACH·SLA_WARNING·DAILY_DIGEST)만 `notify_routes`(이벤트 × 조건 → 채널, 멘션)로 라우팅. 입고확인은 AS 상태가 '접수'→'입고'로 바뀌는 첫 1회만 TICKET_STATUS_CHANGED에 걸릴 수 있고(부분 입고 2회째부터는 상태 불변), 메시지도 "상태 변경" 일반 문구라 **입고된 기기·수량·입고일**이 안 담김.
- 기존 자산: `NotifyChannel`(채널 마스터, 설정 화면) · `NotifyRoute` + `lib/notify-routes.resolveChannels`(조건 매칭, 같은 채널 1건 합침) · `dispatchToChannel`(Slack 모드 off/test/live, `notification_logs` 기록) · `/settings/notifications` 라우팅 탭.

## 2. 설계 — "도메인 이벤트"를 라우팅 이벤트의 한 종류로

### 2.1 이벤트 카탈로그 `lib/notify-events.ts` (클라이언트 안전, 단일 소스)
```ts
export const DOMAIN_EVENTS = {
  AS_INTAKE_CONFIRMED: { label: 'AS 입고확인', module: 'AS', description: '담당자가 입고확인을 실행했을 때(부분 입고 포함, 실행 1회 = 알림 1건)', refType: 'AS' },
  // 후보(이번엔 키만 예약, 발송 코드는 요청 시): AS_SHIPPED(발송정보 입력) · AS_REGISTRY_CONFIRMED(원장확정) · AS_INTAKE_QUEUED(채널톡 등록대기 적재) · VOC_… 
} as const
```
- 권한 카탈로그(`lib/permissions.ts`)와 같은 방식: **새 알림 = 카탈로그에 키 1개 + 발생 지점에 `notifyDomainEvent()` 1줄**. 전용 테이블·설정 키 신설 금지.
- `notify_routes.event_type`에 **이벤트 키를 그대로** 저장(VarChar 30, 기존 매처 무변경). 설정 화면 이벤트 선택지는 "티켓 이벤트 / 도메인 이벤트" 두 그룹.

### 2.2 발송 `lib/notify.ts` — `notifyDomainEvent(input)`
```
input: { event: DomainEventKey, ticketId, refCode, hospitalName, actor, title, fields: {label, value}[], link }
① resolveChannels(event, 티켓 컨텍스트: refType·queue·cti·severity) → 채널 N개(조건은 기존 축 그대로, statusTo·metrics는 무시)
② 메시지 = `[AS 입고확인] {병원} · {AS코드}` + 필드 줄(입고 기기 n대 · 시리얼 · 입고확인일 · 처리자 · 불일치/미식별 있으면 경고 줄) + 링크
③ dispatchToChannel per 채널 (eventType=키, refCode=AS코드, notification_logs 기록). 멘션은 route.mentionMode
```
- **멱등성**: 티켓 생성 알림의 1시간 멱등 규칙은 적용하지 않음 — 입고확인은 부분 입고로 여러 번 실행되고 매번 알려야 함. 단 같은 요청 내 중복 발송만 방지(채널 합침).
- 실패는 best-effort(기존과 동일, 로그에 failed).

### 2.3 발생 지점 — AS 입고확인
- `POST /api/as-receipts/[id]/intake` 성공 후: `notifyDomainEvent({ event: 'AS_INTAKE_CONFIRMED', … fields: 입고 처리 시리얼·수량·입고확인일·불일치(MISMATCH)/미식별(EXTRA) 건수 })`. 기존 `notifyTicketChanged`(상태 변경 알림)는 그대로 — 두 알림은 라우팅 설정으로 각각 켜고 끔.

### 2.4 설정 화면 `/settings/notifications` 라우팅 탭
- 이벤트 드롭다운에 도메인 이벤트 그룹 추가(라벨·설명). 조건 축은 기존(refType 고정·Assignment Group·CTI·Sev)·멘션 모드·활성.
- 시드(`scripts/seed-notify-domain-events.sql`, idempotent): 'AS 입고확인' 라우트 1건 → 채널은 사용자가 지정(§4 Q1).

### 2.5 범위 밖
- DM 알림(개인)·시스템 내부 알림 연동 — 요청 시. 메시지 필드 토글(타입별 포함 필드)은 1차엔 고정, 필요 시 기존 "메시지에 포함할 필드" 설정을 이벤트별로 확장.

## 3. 파일
`lib/notify-events.ts`(신규) · `lib/notify.ts`(notifyDomainEvent) · `lib/notify-routes.ts`(이벤트 목록 확장) · `app/api/as-receipts/[id]/intake/route.ts`(1줄) · `app/settings/notifications/RoutesTab.tsx`(그룹 드롭다운) · `scripts/seed-notify-domain-events.sql` · README·DEV_HISTORY. **스키마 변경 없음.**

## 4. 결정 요청

| # | 질문 | 추천 |
|---|---|---|
| Q1 | 입고 알림 채널 — 기존 'AS업무'(지금은 'SLA 지연'과 같은 Slack 채널 ID를 쓰고 있음) vs 새 채널 | 새 채널을 만드시면 ID 주세요. 채널 마스터에 등록 후 라우트 연결 |
| Q2 | 메시지 필드 | 병원 · AS코드 · 입고 기기 n대(시리얼 목록, 10대 초과 시 "외 n대") · 입고확인일 · 처리자 · 불일치/미식별 경고 · 상세 링크 |
| Q3 | 멘션 | 없음(기본). 필요 시 라우트에서 @here/그룹 멤버 |
| Q4 | 부분 입고 | 실행할 때마다 1건(그 회차 기기만 표기). "전 라인 입고 완료" 시점에만 보내는 옵션은 2차 |
| Q5 | 이번에 같이 켤 이벤트 | 입고확인만. AS_SHIPPED(발송정보 입력)도 원하시면 같은 패턴으로 동시 작업 가능 |

## 5. 설정 화면 재편 (사용자 결정 2026-10-27 — "SLA가 메인을 차지한 건 먼저 만들어졌기 때문")

- 탭: **① 이벤트**(기본) — 카탈로그 전체를 모듈별(티켓 공통·SLA·AS업무·VOC·운영)로 나열, 행마다 사용 스위치 + 규칙(채널·조건·멘션) 인라인. 켜고 끄기 = 사용 스위치, 어디로 = 규칙. 미구현 이벤트는 "발송 지점 미구현 — 키만 예약"으로 표시(규칙 추가 불가, API 400) · **② 채널** 마스터 · **③ SLA 기준** 매트릭스(알림이 아니라 기준값이라 뒤로) · **④ 공통** 모드·전체 on/off·멘션 킬스위치·SLA 엔진(tick·상한·일일 요약)·자동 종결·메시지 필드·이력
- 레거시 3겹 토글 제거: `notify_event_toggles`·`notify_types_enabled`·`notify_events_enabled` → `notify_event_enabled`(이벤트 키별) + 라우트 `ref_types` 조건. 마이그 `scripts/migrate-notify-toggles.mts`(dry-run 기본, `--apply`): 꺼져 있던 업무 타입(PROD: 유지보수·기타업무)은 전체 대상 라우트 5건의 업무 유형 조건으로 이관해 **현재 동작 보존**. `TICKET_ASSIGNED`가 라우팅 이벤트로 승격(기존엔 그룹 알림 채널로만)
- 스키마 변경 없음. `notify_routes.event_type` 에 카탈로그 키 그대로

## 6. 구현 노트 (2026-10-27)

- `lib/notify-events.ts` 카탈로그 16종(구현 9 + 예약 7) · `lib/notify-routes.ts` 이벤트 목록 = 카탈로그 · `lib/notify.ts` `getEventEnabledMap`/`isNotifyEventOn`(새 키 없으면 구 토글에서 파생)·`notifyDomainEvent` · `lib/sla-alerts.ts` 타입 게이트 → 이벤트 스위치 · 설정 API 2종 · `app/settings/notifications/{page,EventsTab,ChannelsTab}.tsx`(RoutesTab 삭제)
- dev2 적용: 마이그 `--apply`(유지보수·기타업무 꺼짐 → 라우트 5건 ref_types 7종) + 시드(AS 입고확인 → AS업무, route #7)
- PROD 반영 시: pull → 빌드·재시작 → `npx tsx scripts/migrate-notify-toggles.mts --apply` → `psql -f scripts/seed-notify-events.sql` (둘 다 idempotent) → 설정 화면 이벤트 탭 확인
