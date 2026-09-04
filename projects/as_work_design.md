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
5. **상태 단계형**: 접수→수거중→입고→처리중→발송→완료 (+보류·취소). 선교체(실측 715건, 20%)는 발송이 수거보다 먼저일 수 있으므로 **단계 순서 강제 없음**
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

### 4.3 상태 마스터 — StatusCode `AS_STATUS` 시드 8종 (+티켓 매핑, 규칙 6)

| 상태 | order | ticket_status |
|---|---|---|
| 접수 | 10 | OPEN |
| 수거중 | 20 | IN_PROGRESS |
| 입고 | 30 | IN_PROGRESS |
| 처리중 | 40 | IN_PROGRESS |
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
- `scripts/seed-as-masters.sql` (멱등): AS_STATUS 8종+티켓 매핑 · CTI 규칙 기본 행 · nav 2행(AS업무·설정 상태 관리)

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
