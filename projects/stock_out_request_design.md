# 출고업무(출고요청) 설계 — 프로젝트 자재 출고요청의 시스템화

> 작성일: 2026-09-03 · 상태: **P1·P2 구현 완료 (dev2, 2026-09-03) — PROD 미반영** · P2 검증: tsc 0·스모크 22/22(P1 회귀 31/31) · P1 개정: 상태 5종(취소 추가)·완료→CLOSED 직행 · 검증: tsc 0·스모크 31/31
> 선행 SOP: `cs_ticket_workflow_design.md` §3.4 (도메인 어댑터 추가 절차) — VOC접수(6번째)에 이은 **7번째 티켓 도메인**

---

## 1. 취지·배경

- 구축 프로젝트 진행 중 필요한 품목 출고를 현재 **Slack으로 요청** → 운영관리시스템의 정식 업무로 편입
- 1.0 전역 결정(티켓 = 공통 워크플로 껍데기, 도메인 레코드 = 구조화 본문)에 따라 **도메인 레코드 + 메인 티켓 자동 생성·양방향 동기화** 구조
- v1 원칙: **아주 심플하게** — 프로젝트 필수 연결 · 품목×수량 · 희망 출고일 · 비고. WMS 전표 연결 등은 후속

## 2. 확정 결정 (2026-09-03 사용자 답변)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 품목 마스터 | 전용 테이블 `stock_out_items` + 설정 페이지 '출고 품목 관리' + 12종 시드 (관리자가 추가·중단) |
| 2 | 출고요청일 | **희망 출고일** (사용자 입력 date). 등록일시는 자동 기록 |
| 3 | 상태 체계 | 도메인 상태 5종: **요청 / 처리중 / 완료 / 보류 / 취소** (2026-09-03 개정 — '취소' 추가) |
| 4 | CTI | 사용자가 PROD에 신설 완료. dev 시드는 기존 CTI를 임시 지정 → 사용자가 설정 화면에서 변경 |
| 5 | 권한 | 생성·상태 처리 USER 이상, 조회 로그인 전원 (VIEWER 읽기 전용) |
| 6 | 수정·취소 | 완료 전: 요청자 본인 + ADMIN / 완료 후: ADMIN만 |
| 7 | 비고 | 추가 (티켓 설명 자동입력 소스) |
| 8 | v1 제외 | WMS 출고 전표 연결 · 프로젝트 티켓 하위(parentId) 연결 · 배송지/수령인 필드 |
| 9 | 프로젝트 상세 | '출고요청' 버튼(저장 좌측) + 해당 프로젝트 출고요청 이력 목록 노출 |

파생 결정(설계 판단 — 검토 포인트 §11 참조):
- 취소는 **상태 '취소'** (2026-09-03 개정 — 삭제 아님). 삭제는 별도로 유지: 완료·취소 전 요청자 본인+ADMIN / 이후 ADMIN — 삭제 시 연결 티켓 동반 삭제 (유지보수 P5·VOC 선례)
- **담당 배정은 티켓 단독 소유** (VOC 2026-08-15 개정 선례) — 도메인에는 생성자(createdBy)만 기록
- **생성 진입점은 프로젝트 상세만** (v1) — 목록 화면은 조회·처리 중심, [+ 등록] 버튼 없음

## 3. 명명

| 항목 | 값 |
|---|---|
| 도메인 refType | `STOCK_OUT` |
| 요청 코드 | `SOR-YYYYMM-NNNN` (Stock-Out Request, KST 월별 시퀀스 — MNT/IP/VOC 발번 패턴) |
| 테이블 | `stock_out_requests` · `stock_out_request_items` · `stock_out_items` (public) |
| 경로 | `/stock-out-requests` (목록·상세) · `/settings/stock-out-items` (품목 관리) |
| nav | '출고업무' (operations, sort 42 — 프로젝트 관리 40과 VOC 45 사이) |
| 상태 카테고리 | StatusCode `STOCK_OUT_STATUS` |
| 도메인 라벨(meta) | **'출고요청'** (티켓 배지·필터·설정 표기 — nav '출고업무'와 구분) |
| 시드 | `scripts/seed-stock-out-masters.sql` (idempotent — 티켓 규칙 4의 재실행 대상에 합류) |

> 명칭 주의: 기존 WMS의 `stock-out-type`(출고 유형 StatusCode)·`/settings/stock-reasons`와는 별개 모듈이다.

## 4. 데이터 모델 (public 스키마)

### 4.1 `stock_out_items` — 출고 품목 마스터

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | SERIAL PK | |
| name | TEXT NOT NULL UNIQUE | 품목명 |
| item_group | TEXT NOT NULL | CHECK `('SYSTEM','WEARABLE')` — 라벨 '시스템' / '웨어러블 디바이스' |
| sort_order | INT NOT NULL DEFAULT 0 | |
| is_active | BOOL NOT NULL DEFAULT true | 중단 품목은 비활성 (신규 요청 폼 미노출, 기존 라인 표시는 유지) |
| created_at / updated_at | timestamptz | |

시드 12행: 시스템 — thynC 시스템 10 / 20 / 30 / 40 / 50 / 100, MGW1010 · 웨어러블 — MC200M-T, MP100W, MP1000F, MP2000F, MP2000R
(WMS `inventory_items`·`device_info`와 독립 — MP1000F 등 기존 마스터에 없는 품목 포함. 후속 WMS 연계 시 매핑 컬럼 추가 여지)

### 4.2 `stock_out_requests` — 출고요청 (도메인 레코드)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | SERIAL PK | |
| sor_code | VARCHAR(20) NOT NULL UNIQUE | SOR-YYYYMM-NNNN |
| project_code | TEXT NOT NULL → projects(project_code) | **필수 연결**, ON DELETE RESTRICT (프로젝트 삭제 보호) |
| status_id | INT → status_codes ON DELETE SET NULL | STOCK_OUT_STATUS |
| status_changed_at | timestamptz DEFAULT now() | 상태 진입 시각 (기존 도메인 패턴) |
| request_date | DATE NOT NULL | **희망 출고일** |
| note | TEXT | 비고 — 티켓 설명 자동입력 소스 (plain text) |
| resolved_at | DATE | 완료일 — 종결 버킷(CLOSED 매핑: 완료·취소) 진입 시 자동 기록·이탈 시 해제 (VOC 패턴) |
| created_by_id | TEXT → users ON DELETE SET NULL | 요청자(생성자) — 수정 권한 판정 기준 |
| ticket_id | INT UNIQUE → tickets ON DELETE SET NULL | 도메인 1:1 연결 티켓 |
| created_at / updated_at | timestamptz | |

인덱스: `(project_code)` `(status_id)` `(request_date)` `(created_at)`
병원은 컬럼으로 갖지 않는다 — 프로젝트에서 파생(목록 include·티켓 hospitalCode 스냅샷).

### 4.3 `stock_out_request_items` — 요청 품목 라인

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | SERIAL PK | |
| request_id | INT NOT NULL → stock_out_requests ON DELETE CASCADE | |
| item_id | INT NOT NULL → stock_out_items ON DELETE RESTRICT | 사용 중 품목 삭제 보호 |
| quantity | INT NOT NULL CHECK (quantity > 0) | |

UNIQUE `(request_id, item_id)` + 인덱스 `(item_id)`. 수량이 입력된 품목만 라인으로 저장.

Prisma 역관계: `Project.stockOutRequests`, `Ticket.stockOutRequest`, `StatusCode`·`User` named relation. 신규 헬퍼 `lib/stockOut.ts` — `nextSorCode`(발번)·품목 요약 문자열(`시스템 30 외 2종 · 총 5개`)·수정 권한 판정 `canEditStockOutRequest`.

## 5. 상태 워크플로 · 티켓 매핑

STOCK_OUT_STATUS 5행 (+ `ticket_status` 매핑 — 규칙 6, 신설 시 매핑 필수):

| 상태 | order | 티켓 매핑 | 비고 |
|---|---|---|---|
| 요청 | 10 | OPEN (owner 있으면 엔진이 ASSIGNED 판정) | 생성 기본값 |
| 처리중 | 20 | IN_PROGRESS | |
| 보류 | 30 | PENDING (사유 '기타') | |
| 완료 | 40 | **CLOSED** (2026-09-03 사용자 결정 — "완료로 바꾸면 메인티켓도 closed") | resolved_at 자동 기록 |
| 취소 | 50 | CLOSED | 2026-09-03 개정 — 취소는 삭제가 아니라 상태 |

역방향(티켓→도메인): `pickDomainStatus` 표준 — keep-if-consistent → 버킷 최소 order. 티켓 RESOLVED/CLOSED는 같은 버킷 → 도메인이 이미 취소면 유지(keep-if-consistent), 아니면 order 최소인 **'완료'** 선택. 티켓을 RESOLVED로만 두는 경로는 없다(도메인에 RESOLVED 매핑 상태 없음 — 자동 종결 배치 무관). 상태 관리 화면은 `WorkflowStatusManager` 재사용(`/settings/stock-out-status` + `/api/settings/stock-out-status` — voc-status 복제 패턴).

## 6. 티켓 편입 (SOP §3.4 그대로)

1. **Prisma** — §4 테이블 + Ticket 1:1 역관계, 수동 마이그레이션 (§9)
2. **상태 마스터** — §5 + 시드 (본 건은 `seed-stock-out-masters.sql`이 담당, `seed-ticket-status-map.sql` 방식과 동일하게 NULL인 행만 UPDATE)
3. **CTI 자동생성 규칙** — `ticket_domain_cti_rules` 기본 행 1개 (`ref_type='STOCK_OUT'`, match NULL, fill_description true, queue_id NULL → CTI 기본 그룹 승계).
   **dev 시드는 ETC 기본 규칙의 CTI를 임시 재사용** (`SELECT cti_id FROM ticket_domain_cti_rules WHERE ref_type='ETC' AND match_status_code_id IS NULL`) — PROD는 사용자가 신설한 CTI로 설정 > '티켓 자동생성 규칙'에서 변경(규칙 변경 비소급). 조건 축(matchCategory) 없음 — 기본 행만
4. **어댑터 1파일** — `lib/ticket-domains/stockOut.ts` + `registry.ts`·`meta.ts` 등록
   - meta: label '출고요청' · listPath `/stock-out-requests` · detailHref id 기반 · codePrefix 'SOR' · descriptionSource '비고'(plain) · matchCategory null · fallbackQueueName '내부운영'(안내 표시용) · taskType 'STOCK_OUT' · statusCategory 'STOCK_OUT_STATUS' · childCreate 미정의
   - `createTicketForStockOut`: 규칙 해석(코드 폴백 없음 — 없으면 '시드 적용' 에러, VOC 방식) → 티켓 생성 `[출고요청] {프로젝트명}` · hospitalCode=프로젝트 병원 · SEV4 · 도메인과 **단일 트랜잭션**
   - `syncStockOutToTicket`: 상태·제목·병원 (CTI 재동기화 없음 — 조건 축 없음)
   - `syncTicketToStockOut`: 상태 역동기화 + resolved_at 백필/해제 (VOC 동일)
   - `buildLinkedWork` 배너: `SOR-… · 프로젝트 {명} · 품목 n종 m개 · 희망 출고일 · 요청자`
5. **도메인 CRUD·페이지·nav** — §7·§8
6. **검증** — §10

**TaskType 'STOCK_OUT' 확장 터치포인트** (Record 타입이라 누락은 컴파일 오류):
- `lib/notify.ts` — `TaskType` union + `enrichTask` case (sor_code로 조회 → hospitalName=프로젝트 병원, title=품목 요약, url, 필드: status·requestDate·items·createdBy·resolvedAt)
- `lib/notifyFields.ts` — `TASK_TYPE_LABELS`('출고요청')·`FIELD_CATALOG`·`DEFAULT_FIELDS`·`TASK_TYPES`
- `app/tickets/components/TicketRefTypeBadge.tsx` — `REF_TYPE_TONES.STOCK_OUT` (teal 계열 — 미사용 색)

비영향(확인 완료): `tickets.ref_type`·`ticket_domain_cti_rules.ref_type`에 DB CHECK 없음(마이그레이션 불필요) · SLA DOMAIN_DUE 앵커 미등록(일반 metric은 정책 설정으로 가능) · `lib/workItemReassign.ts` 무변경(요청은 프로젝트 귀속 — 프로젝트 이동을 따라감) · 티켓 목록 필터·CTI 규칙 설정 페이지는 `DOMAIN_REF_TYPES` 순회라 자동 포함

## 7. API

| Method·경로 | 권한 | 내용 |
|---|---|---|
| GET `/api/stock-out-requests` | 로그인 | 목록 — 필터 projectCode·statusId·q(코드/프로젝트명/병원명/비고)·from/to(희망 출고일)·페이징. include: project(+hospital)·status·createdBy·ticket(+owner)·items(+item) |
| POST `/api/stock-out-requests` | USER+ | 생성 — projectCode 존재 검증(필수)·requestDate 필수·items ≥1행(활성 품목·정수 qty>0·중복 itemId 400)·note 선택. 기본 상태 '요청'. **레코드+라인+티켓 단일 트랜잭션**(발번 P2002 1회 재시도) → audit → `syncTicketClocksSafe`+`notifyTicketCreated` |
| GET `/api/stock-out-requests/[id]` | 로그인 | 상세 |
| PUT `/api/stock-out-requests/[id]` | §2-6 | requestDate·note·statusId(STOCK_OUT_STATUS 검증)·items 전체 교체. 상태 실변경 시 status_changed_at·resolved_at 자동 관리 → `syncStockOutToTicket`(어댑터, 규칙 3) → notify |
| DELETE `/api/stock-out-requests/[id]` | §2-6 | 취소 — 연결 티켓 동반 삭제, audit |
| GET/POST `/api/settings/stock-out-items`, PUT/DELETE `…/[id]` | ADMIN | 품목 마스터 CRUD — 사용 중(라인 존재) 삭제 409 → 비활성 안내, name UNIQUE 409, audit |
| GET/PUT `/api/settings/stock-out-status` + `[id]` | ADMIN | 상태 마스터 (voc-status 라우트 복제 — WorkflowStatusManager 계약) |

수정·삭제 권한 판정: ADMIN 이상 항상 허용 / USER는 `created_by_id = 본인` AND 현재 상태의 티켓 매핑이 RESOLVED·CLOSED 버킷이 아님. `app/api/projects/[code]` DELETE에 출고요청 존재 시 409 선검사 추가(FK RESTRICT의 친절한 안내).

## 8. 화면

- **nav**: `('stock-out-requests','출고업무','/stock-out-requests', icon 신규, 'operations', 42)` + `('settings/stock-out-items','출고 품목 관리', …, group '자재관리', 82, ADMIN)` + `('settings/stock-out-status','출고업무 상태 관리', …, group '업무 유형·상태', 56 인근, ADMIN)`. NavIcons에 아이콘 1개 추가(lucide `PackageMinus` 계열)
- **목록 `/stock-out-requests`** (VOC 목록 패턴, client): 컬럼 코드 | 프로젝트(병원) | 품목 요약 | 희망 출고일 | 상태 | 요청자 | 티켓(코드·상태·owner) | 등록일. 필터 상태·검색·기간. 우상단 `TicketRuleSettingButton`. 행 클릭 → 상세. [+ 등록] 없음(§2 파생 결정)
- **상세 `/stock-out-requests/[id]`**: 헤더(코드·상태 배지·티켓 링크) / 프로젝트 카드(프로젝트·병원 링크) / 품목 라인 표(그룹·품목·수량) / 희망 출고일·비고 / 상태 변경 / [수정][취소(삭제)] — 권한 게이트
- **등록 팝업**: `app/stock-out-requests/_components/StockOutRequestFormModal.tsx` (등록·수정 겸용) — 프로젝트 정보 읽기 전용, 희망 출고일(date), **품목 그리드**(그룹 헤더 '시스템'/'웨어러블 디바이스' + 품목별 수량 입력, 빈/0 = 미요청), 비고. 성공 → 토스트 + `router.refresh()`
- **프로젝트 상세**: 상단 [저장] 좌측에 **[출고요청]** 버튼(USER+) → 위 모달. 페이지 하단에 '출고요청 이력' 섹션(코드·품목 요약·희망일·상태·상세 링크 — `GET ?projectCode=` 재사용)
- **설정 '출고 품목 관리'**: 전용 CRUD 페이지(inventories 페이지 패턴) — 그룹 select·이름·순서·활성

## 9. 마이그레이션·시드 (CLAUDE.md 절대 규칙 1 준수)

1. psql 직접 실행(dev2) → `prisma/migrations/<ts>_stock_out_requests/migration.sql` 수동 생성(3 테이블+인덱스+FK) → `migrate resolve --applied` → schema.prisma 수동 갱신 → `prisma generate`
2. `scripts/seed-stock-out-masters.sql` (idempotent): ① STOCK_OUT_STATUS 5행 + 매핑(NULL만 UPDATE) ② 품목 12행 `ON CONFLICT (name) DO NOTHING` ③ 규칙 기본 행(ETC CTI 임시) ④ nav 3행 `ON CONFLICT (menu_key) DO NOTHING`
3. PROD 반영 시: git pull → migrate deploy → seed 실행 → 사용자 CTI로 규칙 변경(설정 화면). **PROD DB 작업은 명시 허락 후에만**

## 10. 구현 순서·검증

- P0 스키마·시드 → P1 헬퍼·어댑터·TaskType 확장 → P2 API → P3 화면 → P4 검증
- 검증: tsc 0(4GB 힙) · eslint 0(터치 디렉토리) · 스모크 `scripts/stock-out-smoke.mts` — 생성 검증(품목 중복·qty 0·비활성 품목·프로젝트 필수)·티켓 자동 생성(규칙 CTI·설명·병원)·상태 왕복(도메인→티켓 4상태·티켓→도메인 CLOSED→완료·보류 사유)·권한(VIEWER 403·타인 수정 403·완료 후 본인 403·ADMIN 허용)·삭제 동반 티켓 삭제·프로젝트 삭제 409·품목 사용 중 삭제 409·테이블 원상복구
- 빌드·PM2·git push는 사용자 명시 요청 시에만 (규칙 3)

## 11. 검토 결과 (2026-09-03 사용자 승인)

1. 생성 진입점 프로젝트 상세 한정 — **승인**
2. 라벨 이원화 (nav '출고업무' / 도메인 '출고요청') — **승인**
3. 취소 → **상태 '취소' 신설로 변경** (삭제 아님. 삭제 기능은 별도 유지 — 티켓 동반 삭제)
4. dev 임시 CTI = ETC 규칙 CTI 재사용 — **승인** (PROD는 사용자 신설 CTI로 변경)
5. **'완료' → 티켓 CLOSED 직행으로 변경** ("도메인에서 완료로 바꾸면 메인티켓도 closed") — RESOLVED 매핑 미사용

## 12. v1 제외·후속 (결정 8 확정)

WMS 출고 전표 연결(요청→전표 프리필·`ref_code` 소프트 링크) · 프로젝트 티켓 하위(parentId) 연결 · 배송지/수령인 필드 · Excel 내보내기 · 품목-WMS/기기 마스터 매핑

---

# P2 — 출고 처리 (자재담당자 · WMS 연동) — 2026-09-03 설계

## 13.1 확정 결정 (2026-09-03 사용자 답변)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 센서 3종(MP1000F/2000F/2000R) | WMS는 현재 비시리얼·LOT 관리 → **LOT+수량 차감 + 시리얼 선택 기록**(과도기 — 필수 아님, 개체 미생성). WMS 시리얼 전환은 별도 과제(§13.7) |
| 2 | MGW1010 | WMS 시리얼 관리 → **시리얼 스캔 출고** (기기현황 등록은 제외 — 웨어러블만) |
| 3 | 품목 미존재(시스템이 판매용·평가용재고에 없음 등) | **'재고 없음'으로 표시, 처리 불가** (품목 추가는 운영 판단) |
| 4 | 출고유형 | **처리 시 자재담당자 선택** — 판매(대웅)→대웅제약재고 / 판매(자체)→판매용재고 / DEMO·PoC→평가용재고. 전표 reason: 판매→'판매', DEMO·PoC→'영업' |
| 5 | 부분 출고 | **없음** — 전량 일치(all-or-nothing), 재고 부족 시 출고 불가 |
| 6 | 타 병원 배치 중 시리얼 | **오류 표시·진행 불가** (이관 기능 추가 안 함) |
| 7 | 처리 완료 시 (설계 판단) | 요청 상태 자동 **'완료'** → 기존 동기화로 티켓 CLOSED. 재고 차감·기기현황 등록·상태 전환은 **단일 트랜잭션** |

처리 UI는 품목의 `isSerialManaged`로 분기 — 추후 센서가 WMS에서 시리얼 품목으로 전환되면 이 화면은 코드 수정 없이 시리얼 필수 경로를 탄다.

## 13.2 데이터 모델 델타 (마이그레이션 1개 — ALTER 4건)

| 테이블 | 추가 컬럼 | 용도 |
|---|---|---|
| `inventory_transactions` | `stock_out_request_id` INT NULL FK→stock_out_requests **SET NULL** + 인덱스 | 요청↔전표 링크 — 상세 '처리 내역'이 전표를 역조회(취소 여부 포함 표시) |
| `stock_out_items` | `wms_model_name` TEXT NULL | 품목 해석 키 = `inventory_items.model_name` (인벤토리별 findFirst). 시드 12종 백필, 설정 페이지 편집 필드 |
| `stock_out_request_items` | `fulfilled_serials` TEXT NULL | 과도기 시리얼 기록(비시리얼 품목 전용 — 줄 단위 원문 보존, 개체 미생성) |
| `stock_out_requests` | `fulfilled_at` TIMESTAMP NULL · `fulfilled_by_id` TEXT NULL FK→users SET NULL | 처리 스탬프 — 이중 처리 가드(409)·처리 내역 표시 |

## 13.3 처리 API — `POST /api/stock-out-requests/[id]/fulfill` (canManageStock)

- **입력**: `outType`(`DAEWOONG_SALE`\|`SELF_SALE`\|`DEMO` — 인벤토리 이름 매핑 상수) · `warehouseId` · `txDate?` · `lines[]`(요청 라인 전부: `itemId` + 시리얼 품목 `serials[]` / 비시리얼 LOT 품목 `lots[{lotNo,quantity}]`+`serialsNote?` / 시스템 품목은 수량 고정)
- **검증**: 미처리(fulfilled_at NULL)·종결 전 상태 / 요청 라인 전부 포함 / 품목 해석 실패 → '선택한 인벤토리에 재고 품목 없음' / **전량 일치**(시리얼 수·LOT 합 = 요청 수량) / 시리얼·재고·LOT 검증은 기존 엔진(`planInventoryTransaction`) 위임 / **기기현황 사전 검증**: 심전계·산소포화도본체 시리얼이 타 병원 ACTIVE면 라인 오류(진행 불가), 같은 병원 ACTIVE는 등록 skip 경고
- **`?preview=true`**: 검증만 수행, 라인별 판정 반환 (임포트 미리보기 선례)
- **실행 (단일 prisma.$transaction)**: ① 라인별 `planInventoryTransaction`(OUT — LOT 분할 시 LOT당 전표 1건, 시리얼은 `serials` 직접 전달) → `applyInventoryTransaction` → 전표에 `stock_out_request_id` 스탬프. 전표 필드: requester=요청자명, destination=병원명, hospitalCode는 대웅재고만(linkHospital 규칙), workType 'PROJECT'+refCode=프로젝트코드(기존 어휘) ② 심전계·산소포화도본체 시리얼 → `registerDevicesIn`(병원=프로젝트 병원, source 'WMS', ref `INVENTORY_TX`+전표코드, `usageTypeInput` 판매→판매용/DEMO→평가용, 계약건·상품유형 기존 기본값 규칙, 병동 미지정) ③ 요청 `fulfilled_at/by`·라인 `fulfilled_serials`·상태 '완료' + `syncStockOutToTicket`(티켓 CLOSED) → audit·notifyTicketChanged·SLA

## 13.4 화면 — 출고요청 상세 '출고 처리' 카드

- 노출: `canManageStock` + 미처리 + 종결 전. **카드 순서(2026-09-03 개정): 기본 정보 → 출고 품목(요청 내역) → 출고 처리 카드**
- 흐름(2026-09-03 개정): 출고유형 3버튼(→ 인벤토리 자동 — **창고 선택 없음**: 시리얼=개체 실위치 그룹핑·LOT=버킷(창고×LOT) 선택 내장·수량=잔량 많은 버킷부터 자동 배분, 창고별 전표 분할) → **품목별 입력 후 [확인]**(라인 단위 검증 — 클라 선제(개수·중복 시리얼)+서버 preview(존재·상태·재고·기기현황 충돌) — 통과 시 잠금 ✓, [수정]으로 해제) → 전 품목 확인 완료 시 **[출고 실행]**
- 처리 후: '처리 내역' 카드 — 처리자·일시·출고유형·전표 목록(WMS 전표 링크·취소 여부)·기기현황 등록 결과·기록 시리얼. 처리된 요청은 수정·삭제 잠금(기존 종결 규칙과 동일 판정)
- 전표 취소는 기존 WMS 취소 기능 사용 — 요청 상태 되돌림은 수동(관리자, v1 한계 명기)

## 13.5 시드·검증

- `seed-stock-out-masters.sql`에 `wms_model_name` UPDATE 12종 추가(멱등 — NULL만)
- 스모크 확장: 품목 해석(모델명·인벤토리)·전량 불일치 400·재고 부족 409·시리얼 검증(미등록/타 위치/출고됨)·LOT 분할 전표·시스템 수량 차감·기기현황 등록(용도 자동·ref INVENTORY_TX)·타 병원 ACTIVE 차단·같은 병원 skip·이중 처리 409·상태 완료→티켓 CLOSED·전표 링크·재고 원상복구

## 13.6 v1(P2) 제외 — 후속

WMS 센서 시리얼 전환(별도 과제 — 시리얼 플래그는 이력 잠금이라 기존 재고 개체화 마이그레이션 필요) · 부분 출고 · 타 병원 시리얼 이관 · 전표 취소 시 요청 상태 자동 복귀 · GW 기기현황 등록
