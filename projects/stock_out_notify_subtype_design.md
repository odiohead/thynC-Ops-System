# 출고업무 알림 — 유형별 규칙 조건 + 지정 Assignment Group 멘션 설계안

> **상태**: 완료 — PROD 배포 2026-11-09 (7a783e6, 마이그 적용). 운영 설정(Assignment Group '오산영업소 출고' + 출고요청 등록 규칙)은 §3.3 절차대로 사용자 등록 · 작성 2026-11-09
> 선행 문서: `stock_out_notify_design.md`(출고 도메인 이벤트 2종), `stock_out_sales_request_design.md`(영업 유형 3종), `notification_v1.1_design.md` §5.1(채널 라우팅), `domain_event_notify_design.md`

---

## 1. 요구

- 출고요청 **등록** 알림에서, 유형이 **오산영업소**인 건만 **지정된 사람들**을 Slack에서 태그한다.
- 사람·유형을 코드에 박지 않는다. **설정 > Slack 알림 > 출고업무** 영역에서 유형별 규칙과 태그 대상을 운영자가 바꾼다.
- 태그 대상은 개인 목록이 아니라 **Assignment Group**으로 지정한다 (멤버 변경은 기존 그룹 설정 화면에서).
- 출고요청 티켓의 Assignment Group 자체는 바꾸지 않는다 (2026-11-09 확정 — 그룹 분기안 대신 규칙 조건안).

## 2. 현재 구조와 빈 자리

| 항목 | 현재 | 빈 자리 |
|---|---|---|
| 출고 이벤트 | `STOCK_OUT_CREATED`·`STOCK_OUT_COMPLETED` 2종, 카탈로그(`lib/notify-events.ts`)에 고정 | 이벤트 자체는 유지. 조건·멘션만 확장 |
| 규칙 조건 축 | 업무 유형·Assignment Group·CTI·Severity·바뀐 상태·metric | **도메인 세부 유형**(출고 유형) 축이 없음 → 오산영업소만 골라낼 수 없음 |
| 멘션 모드 | 없음 / 그룹 멤버(티켓의 그룹) / @here / @channel / 요청자 | **티켓과 무관한 지정 그룹**의 멤버를 태그하는 모드가 없음 |
| 같은 채널 다중 매칭 | 1건으로 합치고 멘션은 강한 쪽(`MENTION_RANK`) | 그대로 활용 — 공통 규칙(멘션 없음) + 오산영업소 규칙(지정 그룹)이 같은 채널이면 멘션 1줄 붙은 1건 |

## 3. 설계 — 라우팅 모델 범용 확장 2가지

출고 전용 코드가 아니라 **규칙 모델의 축 2개**를 늘린다. 다른 도메인 이벤트(AS 고장/분실 등)도 같은 축을 쓸 수 있다.

### 3.1 규칙 조건 축 `subTypes` (도메인 세부 유형)

- `notify_routes.sub_types TEXT[] NOT NULL DEFAULT '{}'` — 기존 축과 같은 의미론(빈 배열 = 전체, 배열 내부 OR, 축 간 AND).
- 카탈로그 `NotifyEventDef`에 선택 필드 추가:
  ```
  subTypeAxis?: { label: string; options: { code: string; label: string }[] }
  conditions에 'subTypes' 추가
  ```
  출고 이벤트 2종: `subTypeAxis = { label: '출고 유형', options: STOCK_OUT_PURPOSES × STOCK_OUT_PURPOSE_LABELS }` (구축·유지보수·사업업무·평가용·판매용·오산영업소 6개, `lib/stockOutShared.ts` 단일 소스).
- 발생 지점: `notifyDomainEvent` 입력에 `subType?: string` 추가 → `lib/stockOutNotify.ts`가 `r.purpose`를 넘긴다 (등록·완료 둘 다).
- 매칭: `RouteMatchInput.subType`, `matches()`에 `sub_types` 비교 1줄. subType을 안 넘기는 이벤트(티켓 공통·SLA)는 규칙에 sub_types가 있어도 매칭 실패 → 카탈로그에 축이 없는 이벤트는 API가 `[]`로 강제 저장하므로 실제로는 발생하지 않음.
- 설정 화면(`EventsTab`): 카탈로그에 축이 있는 이벤트만 "출고 유형 (비우면 전체)" 칩 행을 추가 표시. 규칙 행 요약에 선택 유형 표기.

### 3.2 멘션 모드 `named_queue` (지정 Assignment Group 멤버)

- `notify_routes.mention_queue_id INTEGER NULL REFERENCES ticket_queues(id) ON DELETE SET NULL`.
- `MENTION_MODES`에 `'named_queue'` 추가, 라벨 **'지정 Assignment Group 멤버'**. 멘션 선택이 이 값이면 그룹 선택 셀렉트 노출(기존 `masters.queues`, '개인 업무' 제외).
- `ResolvedChannel`에 `mentionQueueId` 전달. `buildMentionLine`: `case 'named_queue'` → `queueMemberMentions(ch.mentionQueueId)` 재사용, 문구는 기존 그룹 멤버와 동일 `"{그룹명}: <@U..> <@U..>"`. 전역 킬스위치 `notify_queue_mentions`도 동일 적용(그룹 멘션 계열).
- 멘션 강도: `named_queue = queue_members`와 같은 2. 동률이면 먼저 매칭된 규칙(sortOrder) 유지.
- 검증(생성·수정 API 공통): `named_queue`인데 그룹이 없거나 비활성·개인 업무 그룹이면 400. 그룹이 나중에 삭제되면 FK SET NULL → 멘션 없이 발송하고 규칙 행에 "(그룹 삭제됨)" 경고 표시.
- 멤버 중 Slack 매핑·발송 ON인 사람이 0명이면 멘션 줄 생략(기존 그룹 멤버 모드와 동일).

### 3.3 운영 시나리오 (오산영업소)

1. 설정 > 티켓 > Assignment Group에 **'오산영업소 출고'** 그룹 생성, 태그받을 사람 멤버 등록.
2. 설정 > Slack 알림 > 출고업무 > 출고요청 등록에 규칙 추가:
   - 채널: 출고업무 (기존 규칙과 같은 채널)
   - 출고 유형: 오산영업소
   - 멘션: 지정 Assignment Group 멤버 → 오산영업소 출고
3. 결과
   - 오산영업소 등록: 기존 규칙(멘션 없음) + 새 규칙 → 같은 채널 1건, 마지막 줄 `오산영업소 출고: @a @b`
   - 다른 유형 등록: 기존 규칙만 → 멘션 없음 (지금과 동일)
   - 완료 알림: 변경 없음(요청자 태그 유지). 원하면 같은 축으로 "오산영업소 완료 → 다른 채널"도 설정 가능

## 4. 변경 범위

| 구분 | 파일 | 내용 |
|---|---|---|
| DB | `prisma/migrations/2026110xxxxxxx_notify_route_subtype_mention_queue/migration.sql` | `sub_types TEXT[]`, `mention_queue_id INT FK` 2컬럼 (규칙 1: psql → 파일 → resolve) |
| 스키마 | `prisma/schema.prisma` NotifyRoute | `subTypes String[]`, `mentionQueueId Int?` + `mentionQueue TicketQueue?` 관계 (TicketQueue 측 역참조 `mentionRoutes`) |
| 카탈로그 | `lib/notify-events.ts` | `NotifyCondition`에 `'subTypes'`, `NotifyEventDef.subTypeAxis`, 출고 2종에 축 부여, 그룹 설명 갱신 |
| 라우팅 | `lib/notify-routes.ts` | `MENTION_MODES`·`MENTION_RANK`에 named_queue, `RouteMatchInput.subType`, `ROUTE_SELECT`·`RouteRow`·`ResolvedChannel`에 필드, `matches()` 1줄 |
| 발송 | `lib/notify.ts` | `notifyDomainEvent` 입력 `subType`, `dispatchToRoutes` match 전달, `buildMentionLine` case 추가 |
| 출고 | `lib/stockOutNotify.ts` | 등록·완료 호출에 `subType: r.purpose` |
| API | `app/api/settings/notify-routes/route.ts`, `[id]/route.ts` | subTypes 정제(카탈로그 축 옵션에 있는 코드만, 축 없는 이벤트는 `[]`), mentionQueueId 검증·저장, GET 응답에 `mentionQueue` 이름 |
| UI | `app/settings/notifications/EventsTab.tsx` | 유형 칩 행, 멘션 라벨·그룹 셀렉트, 규칙 행 요약(`· 유형: 오산영업소 · 지정 그룹: …`), 삭제된 그룹 경고 |
| 문서 | README(스키마·기능), DEV_HISTORY, projects/README | |

스키마 변경 2컬럼, 코드 변경 8파일. 작업량 소형(반나절). 출고 요청 등록·처리 흐름은 건드리지 않는다.

## 5. 검증 계획

- 스모크 스크립트(scratchpad): 규칙 2건(공통·오산영업소 지정 그룹) 세팅 → `resolveChannels` 호출로 (OSAN_OFFICE → 1채널·named_queue), (SALES → 1채널·none), 다른 채널 지정 시 2채널 분리 확인 → 정리.
- Slack 실발송은 dev2 `SLACK_NOTIFY_MODE=test` 채널로 1회, 멘션 줄 형식 확인. 개인 알림 테스트 대상은 '이준호'만(메모리 규칙).
- 화면: Playwright로 규칙 추가 폼에서 출고 유형 칩·그룹 셀렉트 노출, 저장 후 행 요약 표기, 축 없는 이벤트(티켓 등록)에는 칩 미노출 확인.

## 6. 결정 사항·열어둔 점

- **D1 티켓 그룹 분기안 기각** (2026-11-09): CTI 규칙에 유형 축을 넣어 오산영업소 티켓을 별도 그룹으로 보내는 안은 티켓 소유·목록 범위가 바뀌는 부작용이 있어, 알림 규칙 조건으로 해결하기로 함.
- **D2 범용 축 이름 `subTypes`**: 출고 전용 `purposes` 컬럼 대신 도메인별 세부 유형 축으로 둬서 AS(고장/분실)·VOC 분류 등에 재사용. 축의 라벨·옵션은 카탈로그가 소유.
- **D3 지정 그룹은 멘션 전용**: 규칙이 가리키는 그룹은 태그 대상일 뿐 티켓의 Assignment Group을 바꾸지 않는다. 다만 Assignment Group 목록에 '오산영업소 출고'가 추가되므로 티켓 이관 선택지에도 나타남(허용).
- **열어둔 점**: 멘션 모드를 조합(요청자 + 지정 그룹 동시)하는 요구는 현재 단일 모드 구조라 미지원. 필요해지면 `mention_modes` 배열화는 별도 건.
