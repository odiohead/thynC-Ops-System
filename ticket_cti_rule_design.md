# 티켓 자동생성 규칙 (도메인별 CTI·Assignment Group·설명) — 설계

> 승인일 2026-07-26 / 대상: 도메인 업무 5종(답사·설치계획·프로젝트·기타업무·유지보수)
> 관련 문서: `ticket_system_design.md` §2, `ticket_dev_schedule.md` P5~P9

---

## 1. 배경 — 무엇이 문제인가

도메인 업무에서 티켓이 자동 생성될 때 붙는 **CTI 분류와 Assignment Group이 코드에 하드코딩**돼 있다.

| 업무 | 현재 CTI | Assignment Group | 결정 방식 |
|---|---|---|---|
| 답사 | 영업/신규도입/답사요청 | 설치·답사 | 이름 조회, 고정 |
| 설치계획 | 영업/신규도입/설치계획(가안)요청 | 설치·답사 | 고정 |
| 프로젝트 | 영업/신규도입/구축 | 설치·답사 | 고정 |
| 기타업무 | 내부/기타업무/일반 | 내부운영 | 고정 |
| 유지보수 | 고객지원/장애/`<장애유형명>` | 유지보수 | **장애유형 이름 문자열 매칭**, 실패 시 '기타' |

문제 셋:

1. **운영자가 바꿀 수 없다.** 분류 체계를 조정해도 자동생성 티켓은 코드에 박힌 CTI로만 들어온다. CTI 관리 화면(`/settings/ticket-cti`)은 트리를 편집하게 해 주면서, 정작 그 트리가 **어디에 자동으로 쓰이는지는 어디에도 드러나지 않는다.**
2. **유지보수 매칭이 조용히 깨진다.** `/settings/maintenance-type`에서 장애유형 이름을 바꾸면 같은 이름의 CTI Item이 없어져 **경고 없이 '기타'로 떨어진다.** 이름이 키인 구조의 전형적 취약점.
3. **도메인 티켓의 설명이 항상 비어 있다.** `tickets.description_html`은 순수 티켓 생성 UI에서만 채워지고, 도메인 자동생성 경로 5곳은 이 필드를 건드리지 않는다. 답사 노트·설치계획 비고 같은 **이미 입력된 맥락이 티켓으로 넘어오지 않는다.**

## 2. 설계 원칙

- **규칙은 테이블, 값은 FK.** AppSetting JSON이 아니라 테이블로 둔다. CTI를 FK로 잡아야 "규칙에 물린 CTI 삭제 금지"가 앱 검증 + DB 제약 이중으로 보장된다.
- **배포 직후 동작은 100% 동일.** 현행 하드코딩과 같은 규칙 9행을 시드로 넣는다(`seed-notify-routes.sql` 선례).
- **소급 적용하지 않는다.** 규칙 변경은 이후 생성분에만 적용. 이미 만들어진 티켓의 CTI는 건드리지 않는다(SLA 정책이 진행 중 시계를 소급 변경하지 않는 것과 같은 이유 — 과거 지표가 흔들린다).
- **코드 폴백을 남긴다.** 규칙 행이 없어도 기존 하드코딩 경로로 동작한다. 시드가 유실되거나 신규 환경에서 시드 전에 티켓이 생겨도 실패하지 않는다.

## 3. 데이터 모델 — `ticket_domain_cti_rules`

```
id                    serial PK
ref_type              varchar(20)  -- SITE_VISIT | INSTALL_PLAN | PROJECT | ETC | MAINTENANCE
match_status_code_id  int NULL     -- FK status_codes ON DELETE CASCADE (유지보수 장애유형별)
                                   -- NULL = 해당 업무 기본 규칙
cti_id                int NOT NULL -- FK ticket_cti  ON DELETE RESTRICT   ★삭제 가드의 근거
queue_id              int NULL     -- FK ticket_queues ON DELETE SET NULL
                                   -- NULL이면 CTI의 default_queue → 그것도 없으면 코드 폴백
fill_description      bool default true   -- 도메인 비고 → 티켓 설명 자동 입력 (기본 행에만 의미)
is_active             bool default true
updated_by            text NULL    -- FK users ON DELETE SET NULL
created_at / updated_at

UNIQUE (ref_type, match_status_code_id)
UNIQUE (ref_type) WHERE match_status_code_id IS NULL    -- 부분 유니크: 업무당 기본 규칙 1행
```

- `cti_id`는 **level=3(Item)만** 허용(API 검증). 티켓이 Item에 붙는 원칙과 동일.
- 비활성(`is_active=false`) CTI는 규칙에 지정할 수 없다(API 400).
- `match_status_code_id`는 현재 유지보수 장애유형(`MAINTENANCE_TYPE`)에만 쓴다. 다른 업무는 조건 축이 의미 없어 기본 행만 갖는다.

## 4. 규칙 해석 — `lib/ticketCtiRules.ts`

```
resolveDomainTicketRule(client, refType, { statusCodeId? })
  1) (ref_type, match_status_code_id) 정확 일치 + is_active   ← 유지보수 장애유형별
  2) (ref_type, NULL) 기본 행 + is_active                     ← 전 업무
  3) 없으면 null → 호출부가 기존 하드코딩 폴백 사용
```

반환: `{ ctiId, queueId | null, fillDescription }`
Assignment Group 결정 순서: `rule.queue_id` → CTI의 `default_queue_id` → 코드 폴백(`'설치·답사'` 등).

기존 `siteVisitCtiId()` / `installPlanCtiId()` / `projectCtiId()` / `etcTaskCtiId()` / `maintTypeToCtiId()`는 **폴백 전용**으로 남긴다. 생성·동기화 경로는 전부 단일 진입점을 거친다(티켓 규칙 #3의 단일 소스 원칙).

**유지보수만 예외**: 장애유형이 바뀌면 연결 티켓의 CTI도 따라 바뀌는 현행 동작(`syncMaintenanceToTicket`)을 유지한다. 이때도 규칙 테이블을 경유하므로 ID 기반이 되어 §1의 문제 2가 해소된다.

## 5. 설명 자동 채움

| 업무 | 소스 필드 | 형식 | 변환 |
|---|---|---|---|
| 답사 | `site_visits.notes` (노트) | Tiptap HTML | 그대로 |
| 설치계획 | `install_plans.note` (비고) | Tiptap HTML | 그대로 |
| 기타업무 | `etc_tasks.note` (비고) | Tiptap HTML | 그대로 |
| 유지보수 | `maintenances.symptoms` (증상) | plain text | `<p>` 이스케이프 |
| 프로젝트 | `projects.remark` (비고) | plain text | `<p>` 이스케이프 |

- 저장 전 `sanitizeRichTextHtml()` 통과. 소스가 비면 `NULL`(빈 설명 박스를 만들지 않는다).
- 본문 상단에 출처 한 줄을 붙인다 — `※ 답사 VISIT-202607-00012 노트에서 자동 입력`. 티켓만 보는 사람이 원본을 찾을 수 있어야 한다.
- **생성 시 1회 스냅샷.** 이후 도메인 비고를 고쳐도 티켓 설명은 갱신하지 않는다. 티켓 상세의 설명 편집 기능이 살아 있으므로(사용자가 티켓에서 쓴 내용) 계속 밀어 넣으면 **덮어쓰기 사고**가 된다.
- 적용 경로: 도메인 POST 5곳 + 승격 2곳(`mail-queue`·`site-visit-queue`).

## 6. 설정 UI

공용 컴포넌트 1개(`TicketRuleSettingModal`, props = refType)를 5곳에서 재사용한다. 메뉴마다 별도 화면을 만들면 5벌을 유지보수하게 된다.

```
┌ 답사 → 티켓 자동생성 설정 ─────────────────────┐
│ 티켓 분류(CTI)   [영업 ▾][신규도입 ▾][답사요청 ▾]  │
│ Assignment Group [설치·답사 ▾]  (미지정=CTI 기본)  │
│ ☑ 답사 '노트'를 티켓 설명으로 자동 입력            │
│ ⓘ 변경은 이후 새로 등록되는 답사부터 적용됩니다     │
└───────────────────────────────────────────┘
```

- 유지보수는 아래에 **장애유형별 표**가 추가된다(장애유형 N행 × CTI 셀렉트). 규칙이 없는 장애유형은 `규칙 미지정` 배지 + 기본 행 폴백 안내 — 현재는 조용히 '기타'로 떨어지던 상태가 눈에 보이게 된다.
- 진입: 각 목록 페이지 우측 상단 버튼(ADMIN 이상에만 노출) + `/settings/ticket-cti-rules` 통합 페이지.
- 권한 ADMIN 이상, 감사 로그 `resource='setting:ticket_cti_rule'`.

## 7. CTI 삭제·비활성 가드

1. `DELETE /api/settings/ticket-cti/[id]` 검사에 **규칙 참조 건수** 추가 → 400 + 어느 업무 규칙인지 명시.
2. DB `ON DELETE RESTRICT`로 이중 방어.
3. **비활성화도 위험** — 삭제만 막으면 비활성 CTI가 신규 티켓에 계속 붙는다. 규칙에 물린 CTI 비활성화는 **경고 후 진행**(차단은 과함).
4. CTI 관리 화면에 `규칙 사용 중` 배지 — 트리가 어디에 쓰이는지 드러낸다(§1의 문제 1).

## 8. 시드 (배포 직후 동작 동일)

| ref_type | 조건 | CTI | Group | 설명 소스 |
|---|---|---|---|---|
| SITE_VISIT | 기본 | 영업/신규도입/답사요청 | 설치·답사 | 노트 |
| INSTALL_PLAN | 기본 | 영업/신규도입/설치계획(가안)요청 | 설치·답사 | 비고 |
| PROJECT | 기본 | 영업/신규도입/구축 | 설치·답사 | 비고 |
| ETC | 기본 | 내부/기타업무/일반 | 내부운영 | 비고 |
| MAINTENANCE | 기본 | 고객지원/장애/기타 | 유지보수 | 증상 |
| MAINTENANCE | 장애유형=하드웨어 | 고객지원/장애/하드웨어 | 〃 | — |
| MAINTENANCE | 장애유형=소프트웨어 | 고객지원/장애/소프트웨어 | 〃 | — |
| MAINTENANCE | 장애유형=네트워크 | 고객지원/장애/네트워크 | 〃 | — |
| MAINTENANCE | 장애유형=기타 | 고객지원/장애/기타 | 〃 | — |

`scripts/seed-ticket-cti-rules.sql` — idempotent. PROD의 장애유형 ID가 DEV와 다를 수 있으므로 **이름 조회 기반**으로 작성한다(1회성 이관이라 이름 매칭이 안전한 유일한 지점).

## 9. 하지 않는 것

- 기존 티켓 CTI **백필 없음** (규칙 변경 비소급 원칙).
- 설명 **재동기화 없음** (생성 시 1회 스냅샷).
- CTI 트리 자체의 구조 변경 없음.

## 10. 단계

| P | 내용 |
|---|---|
| P1 | 마이그레이션 + `lib/ticketCtiRules.ts` + `ticketDomain.ts` 전환 + 시드 |
| P2 | 설정 API + 공용 모달 + 목록 5곳 버튼 + 통합 설정 페이지 |
| P3 | 설명 자동 채움 (생성 5 + 승격 2) |
| P4 | CTI 삭제 가드 + 비활성 경고 + 사용처 배지 |
| 검증 | `scripts/ticket-cti-rules-smoke.mts` — 우선순위·폴백·삭제 가드·설명 변환·비활성 CTI |
