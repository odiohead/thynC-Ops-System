# AS접수 분할 설계 — 병동별 · 구분별

> **상태**: 구현 완료 (dev2 빌드·재시작 2026-11-07 — 스모크 31/31·Playwright 16/16) — PROD 미반영. 결정 D1~D6 제안대로 적용(사용자 '추천대로 하고 보고 수정'), P3(분할 취소)·D7 별건은 보류
> 상위 문서: `as_work_design.md`(AS 도메인) · `as_channeltalk_intake_design.md`(채널톡 인입·변경 감지) · `device_condition_location_design.md` §7(되돌림 게이트)

---

## 1. 배경 — 실측

고객은 AS를 1건으로 접수하지만, 운영은 **발송 단위**(병동별 주소·수취인)와 **처리 단위**(고장/분실은 처리방법·수거 기본값·한도 집계가 다름)로 나뉜다. 현재 접수는 헤더 1 : 라인 N 구조라 발송지가 헤더에 하나뿐이고, 구분도 헤더 단일값이다.

### 1.1 PROD 실제 사례 — AS-202611-0099 동아대학교병원 (2026-11-05, 읽기 전용 조회)

| 시각(UTC) | 행위자 | 내용 |
|---|---|---|
| 07:24:19 | 채널톡 접수봇 | 상담 `6aec2d0c…`에서 AS-202611-0099 자동 생성 — 14대, 병동 4곳(85·111·112·122) 혼재, 발송지 1개 |
| 07:25~07:26 | 담당자 | 원장 확정 3회 |
| 07:27:59 | 담당자 | **AS-202611-0099 삭제**(14라인 전부) |
| 07:29:44 | 담당자 | 수동 등록 AS-202611-0099(번호 재사용) — 85병동 4대 |
| 07:31:28 | 담당자 | AS-202611-0100 — 111병동 6대 |
| 07:33:42 | 담당자 | AS-202611-0101 — 112병동 3대 |
| 07:38:30 | 담당자 | AS-202611-0102 — 122병동 1대 |

4+6+3+1 = 14대로 원본 시리얼과 정확히 일치. 4건 모두 발송지가 병동별로 다르고 합포장 플래그 on, 티켓 4개(16327~16330) 분리.

**수동 우회의 부작용**
- 봇 원본 삭제로 채널톡 상담 연결(`as_intake_links` 212)이 `receipt_id NULL · LINKED` 고아로 잔존. 새 4건은 상담·VOC 연결이 없어 변경 감지·채널톡 링크 기능이 작동하지 않음
- 삭제된 번호를 다음 수동 등록이 다시 받아(`nextAsCode` = max+1) 감사 로그상 AS-202611-0099가 두 접수를 가리킴
- 원본 삭제 시 14대 전부 IN_USE 복귀(`setUnitInUse`) → 재등록 시 다시 AS_OPEN — 기기 이력에 불필요한 AS 해제/접수 쌍 14개
- 14대를 4번에 걸쳐 재입력(오타 위험), 접수 생성 시각이 실제 접수 시각과 어긋남

같은 병원 10-15에도 AS-202610-0222~0227 6건이 7분 안에 병동별로 생성된 선례가 있다(시트 원천이라 봇이 병동별 행을 각각 등록). 병동이 많은 대형 병원에서 반복되는 패턴.

### 1.2 왜 "한 티켓에서 처리"가 어려운가 (현 구조 기준)

| 축 | 헤더 단일값 | 라인에서 갈라지는 것 |
|---|---|---|
| 발송지 | `dest_type` · `dest_info` 1개 | 병동마다 주소·수취인·연락처 |
| 구분 | `category` FAULT/LOST 1개 | 처리방법 선택지(`asResolveOutcomesFor` — 분실은 수리반환 불가), 수거 기본값(분실=수거없음), 분실 한도·계약 한도 집계, 티켓 제목 `[AS접수·고장]` |
| 상태 | `status_id` 1개 | 병동 A는 발송완료, 병동 B는 아직 입고 전 — 헤더 상태 하나로 표현 불가 |
| 수거 송장 | 1개 | 병동별 택배가 따로 올 수 있음(현재는 합포장 태그로 우회) |

라인에 발송지를 붙이는 대안(라인별 `dest_info`)은 상태·송장·알림·시트 역기입이 전부 헤더 단위라 반쪽이 된다. **접수를 쪼개는 쪽이 기존 구조(헤더=발송·상태 단위)와 정합**.

---

## 2. 목표 · 비목표

**목표**
- 접수 상세에서 **[분할]** 한 번으로 라인을 묶어 새 접수(+티켓)로 분리. 축은 2가지로 고정: **병동별** / **구분별**(고장↔분실)
- 분할 시 기기 라인 행을 **이동**(삭제·재생성 아님) — 입고 대조·초안·수리완료 등 라인 상태 보존
- 기기 원장 연결(AS 플래그 `as_ref_code`·되돌림 게이트)을 새 접수 코드로 **정정 이동** — 자식 접수에서 수리반환·교체 처리가 막히지 않게
- 원본↔자식 관계를 데이터로 남기고(`split_from_id`), 상세·타임라인·티켓 이력에서 서로 오갈 수 있게
- 채널톡 상담·VOC 연결은 원본이 유지하되, 변경 감지가 분할 때문에 오탐하지 않게

**비목표 (v1 제외)**
- 접수 병합(merge), 기존 두 접수 사이의 라인 이동 — 수요 확인 후
- 자유 선택 분할(아무 라인이나 체크) — 사용자 결정으로 2축 단순화. 병동 축은 "병동 그룹 단위 체크"라 사실상 임의 조합이 가능하므로 별도 축 불필요
- 분할 자동 제안(등록 시 병동 2개 이상이면 안내) — P2 후보
- 종결(outcome 확정) 라인 이동 — 발송·이벤트가 이미 기록된 라인은 원본에 남긴다

---

## 3. 기능 정의

### 3.1 진입·조건

- 위치: 접수 상세 헤더 액션(상태 변경 · 수정 · **분할** · 리오픈 · 삭제)
- 노출: `canEdit`(ADMIN 이상 / USER 이상 종결 전 / `as_receipt.admin`) **AND** 비종결 **AND** 미종결 라인(`outcome IS NULL`) 2개 이상
- 종결 접수는 리오픈 후에만 분할 가능(현 수정 규칙과 동일)

### 3.2 축 1 — 병동별

1. 미종결 라인을 **병동**으로 자동 그룹핑. 병동 키 = 원장 배치 병동(라인 `device.placement.ward`) 우선, 없으면 라인 `ward_name`, 둘 다 없으면 `(병동 미지정)` 그룹
2. 그룹 목록을 표로 제시: 병동 · 기기 n대(시리얼) · **[원본에 남김] 라디오**(기본: 라인 수 최대 그룹, 동률이면 먼저 나온 그룹) · **발송지**(원본 `dest_info` 프리필, 그룹별 편집 가능)
3. 체크한 그룹마다 새 접수 1건 생성. 라디오 그룹 + 체크 해제 그룹은 원본에 남음(`(병동 미지정)`은 기본 체크 해제)
4. 자식 헤더는 원본 복사(§4.2), `dest_info`만 그룹 값. 구분은 원본과 동일

### 3.3 축 2 — 구분별

1. 원본 구분이 고장이면 "분실로 분리", 분실이면 "고장으로 분리" — 반대 구분 1개만(2종 고정)
2. 미종결 라인 목록에 체크박스 — 체크한 라인이 새 접수로. 최소 1개, 전부 체크 금지(원본에 1개 이상)
3. 자식 헤더는 원본 복사하되 **구분 = 반대값**, 수거방법은 `defaultAsPickupMethod(category)`(분실 → 수거없음, 고장 → 원본 값 유지), 분실 자식은 수거 송장 비움
4. 이동 라인의 `draft_outcome`이 새 구분에서 허용되지 않으면(`asResolveOutcomesFor`) 초안 해제 + 경고 (예: 고장→분실 이동 라인의 '수리반환' 초안)
5. 발송지는 원본 값 프리필(편집 가능)

### 3.4 공통 결과

- 자식 접수: 새 `as_code`(일반 채번), 상태 = 원본 상태(`status_changed_at` = now), 등록자 = 분할 실행자, `source` = 원본 값 승계, `split_from_id` = 원본
- 자식 티켓: 어댑터 `createTicketForAsReceipt`로 생성(규칙 3 — CTI·그룹은 규칙 단일 소스). 원본 티켓의 **담당자(owner)·상위 티켓(parent, VOC)** 승계
- 원본: 라인만 줄어듦. 비고에 시스템 줄 1개 `[분할 2026-11-06 홍길동] 111병동 6대 → AS-202611-0100 · 112병동 3대 → AS-202611-0101`(`appendAsNote`), 티켓 `link` 이벤트 `split_to`
- 자식 비고 첫 줄: `[분할 2026-11-06 홍길동] AS-202611-0099에서 분리 (병동별 · 111병동)`, 티켓 `link` 이벤트 `split_from`
- 합포장: 수거 송장이 같으면 기존 `syncCombinedPackByTracking`이 양쪽 자동 on

---

## 4. 데이터 모델

### 4.1 변경 — 컬럼 1개

```sql
ALTER TABLE as_receipts ADD COLUMN split_from_id INTEGER
  REFERENCES as_receipts(id) ON DELETE SET NULL;
CREATE INDEX as_receipts_split_from_idx ON as_receipts(split_from_id);
```

- Prisma: `AsReceipt.splitFromId Int?` + self relation `splitFrom AsReceipt?` / `splitChildren AsReceipt[]`
- 새 테이블 없음. 분할 시각·실행자는 감사 로그(action `SPLIT`)와 비고 줄이 담당
- `source` CHECK 어휘 변경 없음(승계). 자식을 구분하는 키는 `split_from_id IS NOT NULL`

### 4.2 자식 헤더 복사 규칙

| 필드 | 처리 |
|---|---|
| hospital_code, receipt_date, reporter_name, pickup_dest_differs, pickup_dest_info, picked_up_at, received_at, checked_at, expected_ship_date, pre_replace, priority_repair, firmware_update, accessory_included, combined_pack, dest_type, voc_id, source | 복사 |
| category | 병동 축: 복사 / 구분 축: 반대값 |
| pickup_method, pickup_tracking_no | 병동 축: 복사 / 구분 축: 분실 자식은 `NONE`·송장 NULL, 고장 자식은 복사 |
| dest_info | 모달 그룹 값(기본 원본 값) |
| status_id | 복사, status_changed_at = now |
| note | 분할 시스템 줄 1개(원본 비고 본문은 복사하지 않음 — 원본 참조로 충분, 중복 방지) |
| resolved_at, sheet_done_synced | NULL |
| created_by_id | 실행자 |
| ticket_id | 새 티켓 |
| split_from_id | 원본 id |

### 4.3 라인 이동

`UPDATE as_receipt_items SET receipt_id = :child WHERE id IN (...)` — id·`intake_state`·`received_at`·`receipt_serial_no`·`intake_source`·`draft_*`·`repair_result`·`repaired_at` 전부 보존. UNIQUE(receipt_id, serial_no)는 이동이라 충돌 없음.

---

## 5. 기기 원장 연결 이동 (핵심 — 빠뜨리면 자식에서 처리 불가)

원장은 `hospital_devices.as_ref_code`를 이벤트 fold로 만든다(`core.ts` — AS_OPEN 이벤트의 `ref_code`). 되돌림 게이트 `ownsDeviceState`는 유닛의 **마지막 스냅샷 이벤트 ref**가 "다른 접수"면 불통과(`setUnitInUse` 경고·유지). 라인만 옮기고 이벤트 ref를 두면:

- 자식에서 수리반환 확정 → 게이트가 원본 코드를 "다른 접수"로 판정 → IN_USE 복귀 실패 경고, AS 플래그 잔존
- 입고처리 `intakeDevice`의 ref별 1회 스킵(B-37)이 원본 코드 기준으로 남음

**처리**: 이동 라인 중 `device_id`가 있는 라인마다, 그 유닛의 이벤트 중 `ref_type='AS' AND ref_code=원본코드`를 **전부** `editEvent({ ref: { type:'AS', code: 자식코드 } })`로 인플레이스 정정(AS_OPEN·INTAKE·REPAIR_DONE·CORRECT 등). `editEvent`는 ref 정정 시 게이트·스킵 판정이 바뀐다고 명시된 공식 경로(`admin.ts` 주석)이며 투영 재구성을 함께 수행한다 → `as_ref_code`가 자식 코드로 바뀐다.

- `validateRef`가 자식 접수 존재를 확인하므로 **자식 헤더 생성 후** 호출
- 미등록 라인(`device_id NULL`)·이벤트 없는 유닛은 스킵
- 정정 실패(RegistryError)는 **트랜잭션 중단**(409 응답) — 반쯤 옮겨진 상태를 만들지 않는다. 원장 이력은 `edited_at/edited_by`로 추적되며 AS_CLEAR/AS_OPEN 쌍을 새로 만들지 않는다
- 라인 삭제·재생성 방식(현 `applyItemChanges`)을 쓰지 않는 이유: 입고된 라인(AS_WAITING·센터 위치)이 AS_CLEAR로 IN_USE 복귀됐다가 다시 AS_OPEN 되며 상태·위치 축이 망가짐

---

## 6. 트랜잭션 순서 (서비스 `splitAsReceipt`, `lib/asReceiptService.ts`)

```
입력: { receiptId, mode:'WARD'|'CATEGORY', groups:[{ key, itemIds[], destInfo?, category? }], actor }
0. 검증(§8) — 400/403/409
1. 자식마다 반복
   a. as_receipts INSERT (§4.2, nextAsCode — P2002 1회 재시도는 전체 tx 재시도)
   b. 라인 UPDATE receipt_id (§4.3) + 구분 축 초안 해제(§3.3-4)
   c. createTicketForAsReceipt(child, actor, 'domain') → owner·parent 승계 + ticket_logs link{split_from}
   d. 이동 라인 유닛 이벤트 ref 정정 (§5)
2. 원본: note 시스템 줄 append · syncAsReceiptToTicket(원본) · ticket_logs link{split_to}
3. 반환 { children:[{id, asCode, category, count}], warnings }
tx 밖(best-effort): logAudit SPLIT(원본, before.items/after.items+children) + CREATE(자식별, 라벨 "AS-… 병원명 (분할 ← AS-원본)")
                  · syncCombinedPackByTracking(자식) · syncTicketClocksSafe(원본·자식) · notifyTicketCreated(자식별) · notifyTicketChanged(원본)
```

timeout 60s(현 PUT와 동일). 자식 수 상한 10(병동 수 현실 상한, 비정상 입력 방지).

---

## 7. API

| 메서드·경로 | 내용 |
|---|---|
| `POST /api/as-receipts/[id]/split` | body `{ mode, groups }` → 201 `{ children, warnings }`. 권한 `canEditAsReceipt` + 종결 전 |
| `GET /api/as-receipts/[id]` (확장) | 응답에 `split: { from: {id, asCode} \| null, children: [{id, asCode, category, statusName, itemCount}] }` 추가 |
| `GET /api/as-receipts/[id]/timeline` (확장) | 감사 `SPLIT` → "분할: 111병동 6대 → AS-… · …" / 자식 `CREATE` 라벨에 "분할 ← AS-…" |
| `GET /api/as-receipts` (목록) | 변경 없음. 필요 시 P2에서 `split_from` 배지 |

미리보기 API는 두지 않는다 — 그룹핑은 상세 응답의 라인(원장 병동·`wardName`)으로 클라이언트가 계산.

---

## 8. 검증 규칙 (서버)

| # | 규칙 | 응답 |
|---|---|---|
| V1 | 접수 존재 · 비종결 · `canEditAsReceipt` | 404 / 409 / 403 |
| V2 | `mode` ∈ WARD, CATEGORY · groups 1~10개 · 각 group itemIds 1개 이상 · 중복 없음 | 400 |
| V3 | itemIds 전부 이 접수 소속 · `outcome IS NULL`(종결 라인 이동 금지) | 400 |
| V4 | 원본에 미종결 라인 1개 이상 잔류 (종결 라인만 남는 분할 금지 — 원본이 '빈 접수'가 되는 것 방지) | 400 |
| V5 | CATEGORY: group.category = 원본 반대값만 허용 · group 1개만 | 400 |
| V6 | WARD: group.category 무시(원본 승계) | — |
| V7 | destInfo 길이 ≤ 기존 헤더 제한(Text, 5000) | 400 |
| V8 | 원장 ref 정정 실패 | 409 (tx 롤백) |

---

## 9. 화면

### 9.1 분할 모달 (`app/as-receipts/_components/AsSplitModal.tsx`, 신규)

```
┌ AS-202611-0099 분할 ───────────────────────────────────────┐
│ 분할 기준  (●) 병동별   ( ) 구분별(고장 → 분실)               │
├───────────────────────────────────────────────────────────┤
│ 병동      기기                        원본에 남김  분리   발송지            │
│ 111병동   6대  A128152 A128302 …        (●)       [ ]    (원본 유지)       │
│ 85병동    4대  P016145 P016452 …        ( )       [v]    [부산 서구 … 85병동 …] │
│ 112병동   3대  P016666 P019252 P020783  ( )       [v]    [… 112병동 …]      │
│ 122병동   1대  P016704                  ( )       [v]    [… 122병동 …]      │
│ (병동 미지정) 0대                                                            │
├───────────────────────────────────────────────────────────┤
│ 결과: 원본 AS-0099 111병동 6대 + 새 접수 3건(4·3·1대). 상태·수거·태그·상담 연결 승계 │
│                                              [취소]  [3건으로 분할]        │
└───────────────────────────────────────────────────────────┘
```

- 구분별 탭: 라인 표(시리얼·기기·병동·접수사유) + 체크박스, 상단 "체크한 라인 → **분실** 접수(수거없음)". 초안 해제 대상 라인에는 경고 아이콘
- 발송지 칸은 원본 값 프리필. 병동명 자동 치환은 하지 않는다(주소 포맷이 자유 텍스트라 오치환 위험 — 사용자가 편집)
- 확인 다이얼로그 1회 → 성공 시 모달 닫고 상단 알림 영역(`AsNoticeArea`)에 결과 + 자식 링크, `router.refresh()` + 재조회

### 9.2 상세 헤더

- 자식: 코드 옆에 배지 `분할 ← AS-202611-0099`(링크)
- 원본: `분할 → AS-0100(111병동 6) · AS-0101(112병동 3) · AS-0102(122병동 1)` 칩(링크). 자식 상태 배지 동반
- 자식의 '채널톡 상담 ↗' 링크: 원본 intake 링크를 그대로 노출(원본 참조), 변경 감지 패널은 원본에만

### 9.3 목록
v1 변경 없음(기기 n대·병동 열이 이미 분리된 결과를 보여줌).

---

## 10. 연동 영향 · 함께 손볼 것

| 영역 | 영향 | 조치 |
|---|---|---|
| 채널톡 변경 감지 `diffExtractAgainstReceipt` | 원본 라인이 줄어 상담 추출 시리얼과 불일치 → 매 틱 '시리얼' 변경 오탐 | 비교 집합을 **분할 가족**(원본 + `split_from_id` 자식들)의 RECEIPT 라인 합집합으로. 증상·병동 비교도 가족 라인에서 찾음 |
| 채널톡 변경 반영 `chat-change` | 라인 증상/병동 반영이 원본 `receiptId` 기준 `updateMany` | 가족 라인 대상으로 확장(같은 수정) |
| 시트 폴러(연결 전용) 완료 역기입 | AI열 코드 = 원본. 원본 완료 시 '완료' 기입 — 자식 미완료여도 기입됨 | 역기입 판정에 가족 전원 종결 조건 추가(`sheetDoneSynced`는 원본에만) |
| 분실 한도 `computeAsLostQuota` · 계약 한도 `computeAsDealQuota` | 병원·접수 기준 집계 — 자식도 같은 병원이라 그대로 | 없음 |
| 중복접수 배지 `findOpenLinesBySerial` | 이동이라 겹침 없음 | 없음 |
| 수리대기 큐 `/as-receipts/queue` | 라인 기준 — 자식 코드로 표시 | 없음 |
| Slack 알림 | 자식 티켓 생성 알림 n건 + 원본 변경 알림 1건 | 규칙 1(티켓 파이프라인). 자식 생성 알림 머리줄에 '분할 ← AS-…' 포함(`enrichTask` AS 분기 fieldValues) |
| 접수 삭제 | 자식 삭제 시 라인은 원본으로 돌아가지 않음(일반 삭제 — IN_USE 복귀) | 자식 삭제 confirm 문구에 명시. 되돌리기는 P2 '분할 취소' |
| 접수 수정 모달(라인 편집) | 자식에서 라인 추가·제거 가능 — 분할과 무관한 기존 동작 | 없음 |

**선택 — 같은 사건에서 드러난 별건 2가지** (이 설계와 독립, 사용자 결정 시 별도 처리)
1. `nextAsCode` max+1 채번이 삭제된 코드를 재사용 → 감사 로그·원장 ref 소프트 참조가 다른 접수를 가리킬 수 있음. 월별 시퀀스 테이블 또는 "감사 로그 포함 최대값" 채번으로 교체 검토
2. PROD `as_intake_links` 212(receipt NULL · LINKED) 고아 1건 — 자식 AS-202611-0099(재사용 코드)에 재연결하는 1회성 보정(PROD DML — 규칙 5 명시 허락 필요)

---

## 11. 권한 · 감사 · 알림 요약

- 권한: 분할 = 수정 권한과 동일(`canEditAsReceipt`). 별도 권한 키 신설 없음(RBAC 규칙 1 — 카탈로그 추가 불필요)
- 감사: `SPLIT`(원본) + `CREATE`(자식별). 타임라인 양쪽 표기
- 티켓 이력: 원본 `link{event:'split_to', codes}` · 자식 `link{event:'split_from', code}` · 자식 parent 승계 시 `link{event:'parent_set', via:'as_split'}`
- 알림: 자식 `notifyTicketCreated` · 원본 `notifyTicketChanged` — 기존 파이프라인, 추가 채널 없음

---

## 12. 구현 순서 · 검증

| 단계 | 작업 | 검증 |
|---|---|---|
| P1 백엔드 | 마이그(§4.1, 규칙 1 절차) · Prisma · `splitAsReceipt` 서비스(§6) · `POST …/split` · GET 확장 · 타임라인 · §10 변경 감지/역기입 가족 확장 | 서비스 스모크 스크립트(`scripts/as-split-smoke.mts`): dev2에서 14라인·4병동 접수 생성 → 병동별 3분할 → 자식 코드·라인 이동·`as_ref_code` 정정·게이트 통과(자식에서 수리반환 확정 → IN_USE 복귀 OK)·원본 잔류 6 → 구분별 분할(초안 해제 경고) → 검증 400/403/409 8종 → 생성물 삭제·원복. tsc·eslint 0 |
| P2 화면 | `AsSplitModal` · 헤더 배지/칩 · 알림 영역 결과 · 자식 삭제 confirm 문구 | Playwright 헤드리스로 모달 시나리오·DB 대조·스크린샷(화면 검증 메모 준수) |
| P3 (선택) | 분할 취소(자식이 미처리 상태 — 전 라인 PENDING·초안 없음·수리기록 없음 — 일 때 라인 복귀 + ref 복원 + 자식 삭제) · 목록 배지 · 등록 시 병동 2개 이상 안내 | 사용자 수요 확인 후 |

PROD 반영 시: 마이그 SQL psql 적용·resolve → 빌드·재시작(협업 번들 불변). 시드 변경 없음(CTI 규칙·상태 마스터 그대로).

---

## 13. 결정 필요 (검토 요청)

| # | 항목 | 제안 |
|---|---|---|
| D1 | 병동 축 "원본에 남김" 기본 | 라인 수 최대 그룹 |
| D2 | 자식 티켓 담당자(owner) | 원본 담당자 승계(배정 알림은 없음 — 생성 알림만) |
| D3 | 자식 발송지 입력 | 모달에서 그룹별 편집(원본 프리필). 등록 후 상세 '접수정보 저장'으로도 수정 가능 |
| D4 | 종결 라인 이동 | 금지(원본 잔류). 이미 발송·이벤트 기록된 라인을 옮기면 이력이 두 접수에 걸침 |
| D5 | Slack 알림 | 자식별 생성 알림 발송(현 파이프라인). 과다하면 머리줄에 분할 표기로 식별 |
| D6 | 분할 취소 | P3 선택. v1은 자식 삭제 confirm 문구로 갈음 |
| D7 | §10 선택 2건(채번 재사용·고아 링크 보정) | 별건 — 이 설계와 분리해 결정 |
