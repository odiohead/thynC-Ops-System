# AS업무(AS접수) 설계 — 기기 수리·교체 업무의 도메인화

> 상태: **완료 (PROD 배포 2026-09-04, 커밋 990c0d2)** · §13 전건 제안대로 승인(2026-09-04) · 후속: PROD CTI 규칙 사용자 신설(비소급)·과거 이력 소급(§11)·WMS 연동(§12)
> 근거 데이터: `/mnt/c/Users/USER/Documents/thynC_AS이력.xlsx` (시트 'AS', 3,537행, 2025-05~2026-09, 174병원, 월 ~220건)
> 관련 문서: `thync_as_migration_design.md` (과거 이력 소급 — **기능 완료 후 별도 진행**, §11)
> 재개 방법: "projects/as_work_design.md 읽고 AS업무 도메인 이어서 진행해줘"

---

## 1. 취지·배경

- 웨어러블·단말 AS(수리·교체·분실)를 수기 엑셀(A~Y열)로 운영 중 — 월 ~220건, 증가 추세. 시스템 업무로 편입한다 (**8번째 티켓 도메인**).
- **유지보수와의 경계**: "기기 실물이 움직이면 AS, 사람이 움직이면 유지보수".
  - 유지보수 실측(dev2, 263건/7개월): 라우터·서버·PC·대시보드 등 현장 인프라 방문 작업 중심 — AS 엑셀 월 220건은 시스템 밖에서 별도 운영되고 있었음(실무가 이미 분리).
  - 유지보수 도메인은 불변. 유지보수의 센서교체(소모품) 건은 이 기능과 무관(사용자 확정).
- 엑셀 A~Y열이 이미 5단계 워크플로(접수→수거→입고→처리→발송/완료)로 완결 — 필드 설계의 원본.

## 2. 확정 결정 (2026-09-04 사용자 답변)

1. **별도 도메인 신설** — 유지보수 편입 안 함. 유지보수→AS 자동 파생 없음(서브티켓 개념 없음), 사람이 직접 등록
2. **수거방법 플래그**: 택배수거/방문수거. 발송도 동일하게 방법 구분(택배/방문) — 단계 일괄 스킵 없음 (방문수거+택배발송 조합 가능)
3. **과거 이력 3,537행은 기능 완료 후 전체를 도메인 레코드로 소급** (별도 마이그 트랙 — §11)
4. **WMS 연동 1차 제외** — 기기현황 연동만. 전표 연동은 후속(§12)
5. **상태 단계형**: 접수→수거중→입고→발송→완료 (+보류·취소). ~~처리중~~ 은 2026-09-10 제거(수거중·입고·발송이 모두 IN_PROGRESS라 중복). 선교체(실측 715건, 20%)는 발송이 수거보다 먼저일 수 있으므로 **단계 순서 강제 없음**
6. **라인 단위 처리**: 접수 1건 : 기기 N대. 라인별 결과·발송일 기록, 부분 발송 허용. 전 라인 종결 시 헤더 자동 '완료'
7. **미등록 시리얼 경고 후 허용**: 원장에 없는 시리얼도 접수 가능('미등록' 표시, 기기현황 연동 스킵, 추후 백필 — §12)
8. **기기현황 수동 [AS 접수]/[AS 해제] 버튼 유지** (보정·이력 소급용) + AS업무 등록 권장 안내 문구 추가
9. **접수 구분은 고장/분실 2종** — 엑셀 D열의 '추가 제공'(19건)은 AS 밖(별도 경로), '분실 철회'(18건)는 분실 건의 취소/정정 흐름으로 처리
10. **명칭 이원화**: nav **'AS업무'** / 도메인 레코드 **'AS접수'** (출고업무/출고요청 선례)

## 3. 명명

| 항목 | 값 |
|---|---|
| 코드 | `AS-YYYYMM-NNNN` (P2002 재시도 — SOR 패턴) |
| 테이블 | `as_receipts` · `as_receipt_items` |
| 라우트 | `/as-receipts` · API `/api/as-receipts` |
| refType/taskType | `AS` (라벨 'AS접수') |
| 상태 카테고리 | `AS_STATUS` (StatusCode + ticket_status 매핑 필수) |
| 기기현황 ref | `REGISTRY_REF_TYPES`에 `'AS'` 추가 — refCode = AS 코드. `asRefCode` 세팅 조건을 MAINTENANCE 외 `'AS'`도 포함하도록 확장 |

## 4. 데이터 모델 (public 스키마)

### 4.1 `as_receipts` — AS접수 (헤더, 도메인 레코드)

- `id` · `as_code` UNIQUE VarChar(20)
- `hospital_code` FK(hospitals) — 필수
- `category` VarChar CHECK — `FAULT`(고장) / `LOST`(분실)
- `receipt_date` Date — 접수일 (A열)
- `reporter_name` VarChar? — 고객명/카카오채널명 (J열, 자유 텍스트)
- `pickup_method` VarChar? CHECK — `PARCEL`(택배수거) / `VISIT`(방문수거)
- `pickup_tracking_no` VarChar? — 수거 송장 (L열의 송장 부분)
- `picked_up_at` Date? — 수거일 (M열) · `received_at` Date? — 입고일 (N열)
- `pre_replace` Boolean default false — 선교체요청 (P열)
- `dest_type` VarChar? CHECK — `HOSPITAL`(병원) / `OTHER`(기타 — 대웅 등) (S열) · `dest_info` Text? — 발송지 정보 (T열)
- `expected_ship_date` Date? — 예상 출하일 (U열)
- `status_id` FK(StatusCode AS_STATUS) · `status_changed_at`
- `note` Text? — 비고 (Y열 — 실측상 자유 메모란)
- `resolved_at` Date? — 종결 버킷(완료·취소) 진입 시 자동
- `created_by_id` FK(users)? — 등록자(접수담당자 K열 대응 — 별도 필드 없이 등록자로 갈음, 담당 배정은 티켓 단독 소유)
- `ticket_id` UNIQUE FK(tickets)? — 1:1 연결
- 인덱스: hospital_code · status_id · receipt_date · created_at

### 4.2 `as_receipt_items` — 기기 라인

- `id` · `receipt_id` FK CASCADE
- `serial_no` VarChar — 정규화(대문자) 시리얼, UNIQUE(receipt_id, serial_no)
- `device_id` Int? FK(device_units) SET NULL — 접수 시점 원장 매칭 개체 (**NULL = 미등록 라인**)
- `device_kind` VarChar? — 미등록 라인용 기기종류 선택(심전도/산소포화도/GW 등, 원장 연결 라인은 모델에서 파생)
- `ward_name` VarChar? — 병동 힌트(표시용, 원장 연결 시 원장 병동 우선)
- `symptom` Text? — 접수사유 (I열, 기기별)
- `process_note` Text? — 처리내용 (Q열, 기기별)
- `outcome` VarChar? CHECK — NULL(진행) / `REPAIR_RETURN`(수리반환) / `REPLACE`(교체) / `LOST`(분실종결) / `CANCELED`(라인 취소)
- `new_serial_no` VarChar? — 교체 발송기기 (W열, outcome=REPLACE 필수)
- `ship_method` VarChar? CHECK `PARCEL`/`VISIT` · `ship_tracking_no` VarChar? · `shipped_at` Date? — 라인 단위 발송 (V·R열, 부분 발송 지원 — 일괄 발송 UI가 선택 라인에 공통값 기록)
- 파생: 라인 종결 = `outcome IS NOT NULL` · 기기종류/수량 집계(엑셀 E·G·H열)는 라인에서 파생 — 헤더에 수량 필드 없음

### 4.3 상태 마스터 — StatusCode `AS_STATUS` 시드 7종 (2026-09-10 '처리중' 제거) (+티켓 매핑, 규칙 6)

| 상태 | order | ticket_status |
|---|---|---|
| 접수 | 10 | OPEN |
| 수거중 | 20 | IN_PROGRESS |
| 입고 | 30 | IN_PROGRESS |
| 발송 | 50 | IN_PROGRESS |
| 완료 | 60 | **CLOSED 직행** (SOR 선례) |
| 보류 | 70 | PENDING |
| 취소 | 80 | **CLOSED 직행** |

- 상태 변경은 수동(select) 기본 + 자동 2건: 등록 시 '접수', **전 라인 종결 시 '완료' 자동**(어댑터 동기화로 티켓 CLOSED)
- 단계 순서 강제 없음(선교체·방문교체 대응) — 날짜 필드는 상태와 독립 입력

## 5. 워크플로 · 기기현황 연동 (핵심 — 1차 범위)

| 시점 | 도메인 동작 | 기기현황 이벤트 |
|---|---|---|
| 접수 등록 | 헤더+라인+티켓 단일 트랜잭션 | 라인별 원장 매칭(같은 병원 ACTIVE) → `openDeviceAs`(ref `AS`) — 미등록·이미 AS중(409)은 **경고 수집 후 스킵**, 접수 저장은 성공 |
| 수거·입고 | 날짜·송장 기록 | 없음 |
| 라인 수리반환 | outcome=REPAIR_RETURN + 발송 기록 | `clearDeviceAs`(발송일) |
| 라인 교체 | outcome=REPLACE + new_serial + 발송 기록 | `replaceDevice`(발송일, 사유 DEFECT — 분실 건은 LOST) — AS 플래그 fold 자동 해제 |
| 라인 분실종결 | outcome=LOST | `recoverDevice`(LOST) |
| 라인 취소 | outcome=CANCELED | `clearDeviceAs` (플래그 있으면) |
| 분실 철회 | 접수/라인 취소로 처리 | 이미 회수된 기기 복원은 기기현황 보정 경로(수동 버튼·관리자) 안내 |
| 접수 삭제 | 티켓 동반 삭제 (ADMIN) | 진행 중 AS 플래그 해제 시도 (기록된 이벤트는 보존) |

- 미등록 라인: 이벤트 전부 스킵 + '미등록' 배지. 임포트 완료 후 백필 도구는 후속(§12)
- 연동은 서비스 함수(`lib/deviceRegistry/write`) 경유 — ctx `{ hospitalCode, actor, occurredOn, source:'MANUAL', ref:{type:'AS', code} }`

## 6. 티켓 편입 (SOP §3.4 — 8번째 도메인)

- 어댑터 `lib/ticket-domains/asReceipt.ts` + `meta.ts`(DOMAIN_REF_TYPES 8종) + `registry.ts` 등록
- meta: label 'AS접수' · listPath '/as-receipts' · codePrefix 'AS' · descriptionSource '접수사유 요약'(라인 symptom 상위 병합) · matchCategory null · fallbackQueueName 'CS' · statusCategory 'AS_STATUS'
- TaskType `AS` — `lib/notify.ts` union·enrichTask, `lib/notifyFields.ts` 라벨 'AS접수'·필드 카탈로그(status/receiptDate/category/기기수/createdBy/resolvedAt), `TicketRefTypeBadge` 색 추가
- CTI·Assignment Group: `ticket_domain_cti_rules` 단일 소스(규칙 5) — dev 임시는 ETC 기본 규칙 재사용, PROD는 사용자 신설 CTI로 변경(비소급, SOR 선례)
- Slack 알림·SLA: 티켓 파이프라인 단일 소스(규칙 1) — 도메인 직발송 없음

## 7. API

- `GET/POST /api/as-receipts` — 필터 hospital·statusId·category·기간·q(코드·시리얼·병원명) / 등록(단일 트랜잭션+AS_OPEN 연동, 경고 배열 반환)
- `GET/PUT/DELETE /api/as-receipts/[id]` — 헤더 수정·상태 변경(어댑터 동기화)·삭제(티켓 동반)
- `PUT /api/as-receipts/[id]/items/[itemId]` — 라인 결과 확정(outcome·발송 기록 + §5 기기현황 이벤트, 단일 트랜잭션)
- `POST /api/as-receipts/[id]/ship` — 선택 라인 일괄 발송(공통 발송일·방법·송장 + 라인별 outcome)
- 시리얼 원장 매칭: 기존 `/api/devices/lookup` 재사용
- 권한: 조회 로그인 전원 · 등록/수정 USER+ · 종결 전 본인+ADMIN, 종결 후 ADMIN(SOR `canEdit` 패턴) · 별도 처리 풀 없음(1차)

## 8. 화면 (초기 단순 원칙 — 메인 축 최소)

- `/as-receipts` 목록: 상태(단계) 필터·병원·구분·기간·검색. 행 = 코드·병원·구분·기기 n대(요약)·상태·접수일. [+ 접수]
- `[id]` 상세: 기본 정보 카드(단계 날짜·수거/발송 정보) → **기기 라인 표**(시리얼·원장 링크/미등록 배지·증상·결과·발송) + 라인 처리·일괄 발송 → 티켓 연결 배너
- 등록 모달: 병원 검색 → 구분(고장/분실) → 시리얼 여러 줄 입력(원장 매칭 미리보기 — 미등록 경고) → 접수사유·수거방법
- 설정: 'AS업무 상태 관리'(WorkflowStatusManager 패턴). 구분(고장/분실)은 고정 2종 — 마스터 페이지 없음
- nav: 'AS업무'(operations, 유지보수 인근) + 설정 1행. `/devices` 수동 AS 버튼에 'AS업무 등록 권장' 안내
- 병원 상세·기기현황에서의 등록 진입은 v1 제외(§12)

## 9. 마이그레이션·시드 (CLAUDE.md 절대 규칙 1 준수)

- 마이그레이션 1개: `as_receipts`·`as_receipt_items` (+CHECK·인덱스) — psql 직접 실행 → 파일 수동 생성 → `migrate resolve --applied` → schema.prisma 갱신 → generate
- `scripts/seed-as-masters.sql` (멱등): AS_STATUS 7종+티켓 매핑('처리중' 삭제 포함) · CTI 규칙 기본 행 · nav 2행(AS업무·설정 상태 관리)

## 10. 구현 순서·검증

- P1(단일 단계): DB → 어댑터·meta·registry → API → 화면(목록·상세·등록·설정) → nav → 스모크
- 스모크(`scripts/as-receipt-smoke.mts`): 마스터 매핑 · 어댑터 8종 등록 · 접수 생성(코드 형식·티켓 CTI 규칙·AS_OPEN·미등록 스킵 경고) · 라인 결과 3종(수리반환 AS_CLEAR·교체 replaceDevice fold·분실 recoverDevice) · 부분 발송 · 전 라인 종결→헤더 완료 자동→티켓 CLOSED · 도메인↔티켓 양방향 · 권한 판정 · CASCADE — 테스트 데이터 전량 삭제
- tsc·eslint 0 · 힙 4GB 빌드 (push·PROD 반영은 사용자 명시 요청 시)
- **P1 구현 결과 (2026-09-04, dev2)**: 스모크 `as-receipt-smoke.mts` **43/43 pass** · 회귀 stock-out 31/31·cs-workflow 23/23·stock-out-fulfill 23/23·기기현황 서비스 500/500·shared 121/121(B-24 이전 구식 기대값 9건 현행화) · tsc 0(4GB)·eslint 0 · 마이그 `20260904090000_as_receipts`·시드 `seed-as-masters.sql` 적용(dev2). 빌드·커밋·PROD 미실행

## 11. 과거 이력 소급 (기능 완료 후 별도 트랙 — 사용자 확정)

- `thync_as_migration_design.md`의 마이그 목적지가 **'기기현황 이벤트만' → '도메인 레코드(AS접수) + 기기현황 이벤트'로 변경**됨. 파싱·분류·보정 규칙(§3)은 그 문서 단일 소스 유지
- 엑셀 1행 = AS접수 1건(+라인), 기기현황 이벤트는 도메인 처리 로직 재사용으로 생성 — 수작업 이중 규칙 방지
- **소급 시 결정 필요(그 시점에)**: 종결 티켓 ~3,500건 생성 부작용 처리 — 티켓 createdAt 소급 세팅(기간 지표 밖으로)·알림 발송 억제 등
- 메디인 리허설(dev2 적용분)은 기기현황 이벤트만 있는 상태 — 소급 시 도메인 레코드 백필 대상에 포함

## 12. v1 제외·후속

- WMS 전표 연동(수거 입고·교체기/수리품 발송 출고 — 출고업무 P2 코어 재사용 후보)
- 미등록 라인 백필 도구(병원 임포트 완료 후 일괄 원장 연결)
- 병원 상세·기기현황·VOC에서의 접수 생성 진입점
- 첨부파일(접수 사진 등)
- '추가 제공' 유형의 시스템 경로(출고업무 확장 등 — AS 밖)

## 13. 검토 요망 → **2026-09-04 전건 제안대로 확정 (사용자 승인)**

1. 접수담당자(K열)는 별도 필드 없이 **등록자(created_by)로 갈음** — 담당 배정은 티켓 단독 소유(VOC·SOR 선례)
2. 어댑터 fallbackQueueName **'CS'** (접수 채널이 카카오 CS)
3. 발송지 구분 라벨: '병원' / '기타(대웅 등)' — 엑셀 "대웅 or 그외"의 정리 표기
4. 전 라인 종결 시 헤더 '완료' **자동 전이** (수동 전환 부담 제거)
5. 미등록 라인의 기기종류 선택 필드(`device_kind`) — 통계용 최소 입력

---

## 14. 입고 대조 (2026-09-11 확정 — 접수 시리얼 vs 실물 시리얼)

**배경**: 접수 기기 목록은 고객이 채널톡에 입력 → 시트 → 폴링으로 들어오므로 시리얼 오타·수량 차이가 생긴다. '접수 기기상태'(원장 정합)는 등록 시점 검증이고, 실물이 도착한 뒤 AS담당자가 대조하는 단계가 없었다.

**흐름**: 입고처리(AS담당자) → 자동 판정 → 접수자 확인 → 라인 처리(AS담당자)

| 단계 | 동작 | 저장 |
|---|---|---|
| 입고처리 `POST /intake` | 실물 시리얼 입력(줄 단위) + 입고일(N)·확인일(O). **누적 실행 가능**(부분 입고) | 일치 → 라인 `intake_state=RECEIVED` **정상입고**(+`received_at`) / 접수됐으나 없음(대기 라인) → `MISMATCH` **미입고** / 입력했으나 접수에 없음 → `EXTRA` **미식별입고** 라인 생성(`intake_source=INTAKE`, 원장 매칭만·AS 표시는 편입 시). 헤더 `received_at`(최초만)·`checked_at` 갱신, 상태가 '입고' 이전이면 '입고' 자동(티켓 동기화) |
| 접수자 확인 `POST /intake-confirm` | MISMATCH(미입고): **치환**(EXTRA 시리얼로 교체 — `receipt_serial_no`에 원 시리얼 보존, AS 표시 이전) · **정상입고 확정**(수동) · **미회수**(결과 `NOT_RECEIVED`, 코멘트 필수 → `process_note`, AS 표시 해제) / EXTRA(미식별입고): **신규 라인 편입**(RECEIVED, 원장 매칭·AS 표시, 미등록이면 시리얼 접두로 기기종류 추정) · **삭제** | 미회수는 종결로 간주 — 나머지 라인이 끝나면 접수 자동 완료 |
| 라인 처리 게이트 | `MISMATCH`·`EXTRA` 라인은 409로 처리 거부. **`PENDING`은 허용** — 방문교체·선교체는 입고 없이 처리되며, 기존 미종결 접수(입고처리 미실행)도 그대로 처리 가능 | `NOT_RECEIVED`는 라인 처리 패널에서 선택 불가(확인 절차 전용) |
| 수리완료(`repaired_at`) `POST /repair-done` | **제3축**(2026-09-17 — `device_condition_location_design.md` §7.2, §17): `intake_state='RECEIVED'` ∧ `outcome ∉ {LOST, CANCELED, NOT_RECEIVED}` 라인만 체크 가능(D5 입고된 라인만), 결과 확정 라인·**종결 접수도 허용**(A-2). outcome·헤더 전이·완료 판정에 불개입 | 라인 `repaired_at/by` + 기기 `condition=REPAIRED`(같은 tx, 해제는 CORRECT). 체크된 라인이 분실·취소·미회수로 확정되면 NULL |

**결정**
- 확인 권한: USER 이상 전원(라인 처리와 동일, 별도 권한키 없음) — 채널톡 인입 건은 등록자가 봇이라 본인 제한이 성립하지 않음
- 라벨(2026-09-11 사용자 확정): 정상입고 / 미입고 / 미식별입고 — **원장 정합 태그(타병원·회수·미배치·미등록)와 별개 축**으로 관리. 목록 '접수 기기상태'는 두 축 중 하나라도 있으면 '확인필요', 툴팁에 사유 구분
- 확인 이력은 접수 비고에 자동 추가(`[입고처리 …]`, `[입고확인 …] 시리얼 치환 X → Y` 등)
- 시트 역기입 ⑤: N(입고일)·O(확인일) — 값이 있고 시트와 다를 때만(단방향)
- Excel: 라인 컬럼 입고상태·라인입고일·접수시리얼 추가

**스키마**: `as_receipts.checked_at` / `as_receipt_items.intake_state`(CHECK 4종)·`received_at`·`receipt_serial_no`·`intake_source`(CHECK 2종) / `outcome` CHECK에 `NOT_RECEIVED` 추가 (마이그 `20260911100000_as_intake_check`)

---

## 15. 원장 정합 확정 (2026-09-11 확정 — 접수 시리얼 보정)

**배경**: 접수 시리얼이 원장에 없거나(미등록·미배치), 회수 상태이거나, 타병원 ACTIVE인 경우 목록이 '확인필요'로 뜨지만 보정 수단이 기기현황 화면뿐이었다. 접수자가 AS 상세에서 바로 "이 병원에 있는 기기"로 확정할 수 있어야 한다.

**동작** `POST /api/as-receipts/[id]/registry-confirm { itemId, modelInput?, productType?, wardName? }` (USER 이상)
- 라인의 현재 원장 상태를 `matchSerials`로 재판정 → ACTIVE_HERE면 409(이미 정상)
- `registerDevicesIn` 1회 호출로 분기: 미등록 → **신규 등록**(모델은 시리얼 접두 추정, 접두로 판별 불가하면 `modelInput` 필수) / 회수·미배치 → **재등록** / 타병원 ACTIVE → **이관**(`conflicts[serial]='TRANSFER'` opt-in — 상대 병원에 회수 이벤트 + 이 병원 REGISTER). 업무일자 오늘, ref AS, memo '원장 확정'
- 상품유형은 원장 규칙(딜 1종 → 자동, 혼합 → 400 필수)을 그대로 따름 — 화면에서 선택 가능
- 성공 시 라인 `deviceId` 연결(기기종류 null, 병동 갱신) + AS 표시(`openAsFlags`) → 다음 조회부터 태그 없음(정상). 비고에 `[원장확정 날짜 이름] 시리얼 → 병원 배치 (신규 등록|재등록|타병원(X)에서 이관, 병동)` 추가
- 화면: 기기군 카드 하단 '원장 정합 확인' 패널(라인별 원장 태그·예정 동작·모델(미등록 시)·병동·상품유형·[확정]). 입고 대조 패널과 별개 축

---

## 16. 발송완료 상태 + 4. 기기등록 카드 (2026-09-11 확정)

- **배경**: 발송을 마쳐도 고객 시스템에 기기를 등록해 주는 후속업무가 있어, 전 라인 처리 종료를 '완료'로 보면 안 됨
- **상태**: `AS_STATUS` **'발송완료'**(order 55, IN_PROGRESS, 비종결) 추가 → 8종. 전 라인 종결(라인 처리·미회수 확정) 시 자동 전이 대상은 '완료'가 아니라 **'발송완료'**(`advanceToShippedDone` — 현재 상태가 더 뒤 단계·종결·보류면 유지)
- **최종 완료**: 상세 **4. 기기등록** 카드(비고는 5로) — 1차는 기능 없이 [완료] 버튼만. `POST /api/as-receipts/[id]/complete`(USER 이상): 미종결 라인 0 필수(409) → '완료'(CLOSED)·완료일·티켓 CLOSED·비고 `[기기등록 완료 …]`
- 리오픈 기본 대상: 전 라인 종결이면 '발송완료', 아니면 입고/접수
- 영향: 시트 X열 '완료'는 기기등록 [완료] 시점에 기입됨(발송완료 단계에서는 '미완료' 유지). 시드·스모크 8종

---

## 17. 수리완료 체크·기기 상태 연동 (2026-09-17 확정 — `device_condition_location_design.md`)

- **배경**: 10대 접수 중 몇 대가 수리됐는지, 회수·입고된 기기가 지금 어떤 상태로 어디 있는지를 라인 결과(outcome)만으로는 답할 수 없었다. 기기현황에 **기기 상태(condition 6종: 사용중·AS접수·수리완료·출고 전·분실·폐기)·위치(병원/리프레시센터/thynC Connected Hub)** 유닛 축이 생겼고, AS 흐름의 각 단계가 그 축을 자동으로 옮긴다.
- **수리완료 = 제3축** `as_receipt_items.repaired_at/repaired_by_id` — `intake_state × outcome` 2축 게이트(§14)와 독립. **outcome·헤더 상태 전이·`advanceToShippedDone`·`completeAsReceipt`·리오픈에 절대 개입하지 않는다.**
  - 체크 가능 = `canMarkAsLineRepaired`: `intake_state='RECEIVED'` ∧ `outcome ∉ {LOST, CANCELED, NOT_RECEIVED}`(D5 입고된 라인만). 결과 확정 라인(수리반환·교체 — 선교체)도 가능, **종결(완료·취소) 접수도 허용**(A-2 — 완료 전 사후 입고된 선교체 REPLACE·RECEIVED 라인 19건 실존). 권한 VIEWER 제외(`canEditAsReceipt` 미사용 — 다른 라인 API의 409 규약과 다름을 라우트 주석에 명시)
  - `POST /api/as-receipts/[id]/repair-done { itemId, repaired }` → 라인 `repaired_at`(서버 오늘 KST)·`repaired_by` + 기기 `condition=REPAIRED`(REPAIR_DONE 이벤트, ref AS) / 해제는 CORRECT(AS접수 복귀) + 비고 `[수리완료 09-17 홍길동] P018330`. 미등록·사용중·폐기 기기는 라인만 기록 + 경고. 재체크 멱등(경고 '변경 사항 없음'). 낙관 가드 409 '동시에 변경되어 다시 시도하세요'는 전파(tx 롤백 — 라인만 커밋되는 반쪽 상태 방지)
  - 화면: 3. AS상세내역 라인 표 '처리내용'과 '결과' 사이 '수리완료' 체크박스(해제는 confirm), 카드 헤더 `수리완료 n/m`(m = 체크 가능 라인), 시리얼 셀 기기 상태 배지(수리완료·폐기·분실 + 위치 툴팁), 목록 '기기' 배지 `수리 n/m`, Excel '수리완료일', 타임라인 접미어 수리완료/수리완료 해제/폐기
  - 체크된 라인이 이후 분실·취소·미회수로 확정되면 그 분기에서 `repaired_at/by` NULL + 비고(n이 m 밖에 남지 않게)
- **[폐기]** `POST /api/as-receipts/[id]/scrap-line { itemId, memo(필수) }` — 회수(RECOVERED)된 라인 기기만(배치 ACTIVE 409 '배치 중 기기는 먼저 회수하세요'), 권한은 AS 업무 권한과 동일(VIEWER 제외 — 사용자 결정 A-5). 기기 SCRAPPED·위치 없음 + 라인 repaired_at NULL + 비고 `[폐기 …] memo`. 되돌림은 기기현황 admin 보정·LIFO 취소
- **AS 흐름 → 기기 상태·위치**(`lib/asReceiptService.ts` 훅, 그쪽 §7.3):

| 단계 | 기기 상태 · 위치 |
|---|---|
| 접수 등록(AS_OPEN) | AS접수 · 병원 유지 |
| 입고처리 일치 라인·입고 확인(정상입고 확정·미식별 편입·치환 후 기기) | INTAKE → AS접수 · **리프레시센터**(배치 ACTIVE 유지 — D2). 결과 NULL·교체 라인만, ref별 1회 기록 |
| 수리완료 체크 | 수리완료 · 센터 (→ 교체품 가용 — 회수 목록 `condition=REPAIRED&location=REFRESH_CENTER`) |
| 수리반환 확정 | 사용중 · 병원 — **되돌림 게이트 `ownsDeviceState`**(그 기기의 마지막 스냅샷 이벤트가 이 접수 ref 또는 비AS ref일 때만; 타 접수면 경고 '다른 접수(AS-…)가 최근 상태를 기록 — 유지'). 이 접수가 켠 플래그면 AS_CLEAR(처리일 < 표시 시작일이면 업무일자 클램프 + 경고), 아니면 CORRECT 폴백 |
| 교체 확정 구기기 | 배치 RECOVERED(DEFECT) · AS접수 · 리프레시센터(A-4 스냅샷 note '입고 미확인'). 신기기 REGISTER → 사용중 · 병원(폐기 기기 409, 수리완료 아니면 경고) |
| 분실종결 · 분실 접수의 교체 | 분실 · 위치 없음 |
| 라인 취소 | 사용중 · **위치 유지**(센터면 센터 → 기기현황 [병원 반환]) |
| 미회수 확정 · 라인 제거 · 접수 삭제 · 시리얼 보정 구기기 · 치환 전 기기 | 사용중 · 병원(실물 이동 근거 없음) — 게이트 통과 시, memo '미회수 확정/라인 제거/접수 삭제/시리얼 보정/시리얼 치환 AS-…' |
| 원장 확정 · 시리얼 보정 신기기 · 병원 변경 재생성 라인 | 라인이 RECEIVED면 INTAKE(occurredOn=입고일), repaired_at 있으면 REPAIR_DONE(occurredOn=repaired_at) **재적용**. 병원 변경 재생성 시 입고 상태·입고일·접수 시리얼·입고 출처·수리완료 필드 보존(기존 유실 결함 동반 수정) |

- **초안/최종확정·선교체 사후 입고·종결 게이트 조건부 완화(문서 미반영분 동반 기재)**: 초안(`draft-lines`)은 기기현황에 쓰지 않고 [최종확정](`confirm-lines`)이 `resolveAsLines`를 경유해 위 표를 따른다(기준일 `effectiveDate`, 발송 라인은 라인 발송일 우선). **종결 접수 사후 입고**: `intakeAsLines`의 종결 게이트를 조건부 완화 — 입력 시리얼 전부가 `outcome='REPLACE'` ∧ `intake_state ∈ {PENDING, RECEIVED}` 라인과 일치할 때만(RECEIVED 재입력은 무변경 통과, 불일치 1건이라도 있으면 400·EXTRA 생성 금지), 헤더 status/received_at/checked_at 불변·`advanceToShippedDone` 미호출·비고만(전환 0건이면 비고도 없이 경고 '변경 사항 없음'). 종결 우회(PUT statusId·티켓 전이)로 '취소'에 들어간 접수의 AS접수 기기 정리는 v1 비범위(백필 `--dry` 목록)
- 스모크 `scripts/as-receipt-smoke.mts` '▶ 수리완료' [C-1]~[C-16]·[C-I6](39항목)

