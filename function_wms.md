# 자재관리(WMS) 기능 설계서 (function_wms.md)

> **이 문서는 구현 담당 AI(OPUS)가 참고하는 설계·진행 기준 문서입니다.**
> 작업 시작 전 반드시 `CLAUDE.md` → `README.md` → `DEV_HISTORY.md` 최근 항목 → 이 문서 순으로 읽으세요.
> 각 Phase 완료 시 이 문서 하단의 **진행 체크리스트**를 갱신하고, `DEV_HISTORY.md` 상단에 기록하세요.

---

## 1. 목표

구축·판매 과정에서 취급하는 하드웨어 자재(약 50~100 품목)의 재고를 관리한다:

- **자사 기기**: 게이트웨이, MC200M-T 등 → 시리얼 번호 개별 추적
- **전자제품**: 사이니지, PC, 모니터 등 → 품목에 따라 시리얼 또는 수량 관리
- **잡자재**: 각종 케이블 등 → 수량만 관리

핵심 기능: **품목 마스터 / 위치(창고)별 재고 / 입고·출고·이동 원장 / 시리얼 개체 추적 / 병원·업무 연결 / 안전재고 Slack 알림**.

**과하지 않게.** 회계 수준의 재고자산 평가·발주(PO) 관리·바코드 스캔은 범위 밖. 운영관리시스템에 얹는 실용적 재고 장부 수준을 유지한다. 신규 시스템이 아니라 기존 시스템에 대한 기능 추가이므로 **기존 패턴을 최대한 재사용하고 새 패턴 발명을 최소화**한다.

### 사용자와 확정된 핵심 결정 (2026-07-07)

| 결정 항목 | 확정 내용 |
|---|---|
| 추적 단위 | **혼합** — 품목별 `시리얼 관리 여부` 플래그. 시리얼 품목은 개체 단위, 나머지는 수량만 |
| 위치 구조 | **다중 위치** — 위치(창고) 마스터 등록, 품목×위치별 재고 + 위치 간 이동 |
| 업무 연동 | 출고 시 **병원 + 업무(프로젝트/유지보수/기타업무) 선택 연결** (없어도 출고 가능) |
| 안전재고 알림 | **기존 Slack 인프라(lib/slack.ts·notify.ts) 재사용** — 미달 시 채널 알림 |
| 승인 절차 | **즉시 확정** (승인 워크플로 없음). 잘못된 입력은 취소(역방향 반영)로 보정 |
| 처리 권한 | **별도 재고 담당자 풀** — 신규 `inventory_managers` 테이블. **FieldEngineer(업무 담당자)와 직무 분리** — 그 테이블·탭에 얹지 않음 (§5) |
| 단가 관리 | **참고용 단가만** (품목당 nullable 필드 1개). 입고별 단가·재고액 평가 없음 |
| 품목 마스터 | **DeviceInfo와 별도** 신규 마스터 + 자사 기기는 DeviceInfo **선택 참조**(nullable FK) |

---

## 2. 기존 시스템 접점 (재사용할 인프라)

구현 전 아래 파일들을 반드시 읽고 패턴을 파악할 것:

| 기존 자산 | 위치 | 이 기능에서의 역할 |
|---|---|---|
| **StatusCode 다용도 상태값** | `prisma/schema.prisma` `StatusCode`, `app/settings/status/` 등 | 품목 분류(카테고리)를 신규 category `ITEM_CATEGORY`로 추가 — 설정 페이지·CRUD 패턴 그대로 재사용 |
| **FieldEngineer 담당자 풀** | `app/settings/field-engineers/`, `app/api/settings/field-engineers/` | **UI·API 패턴만 참고** (후보 검색 모달·목록 테이블 구조). 재고 담당자 풀 자체는 별도 테이블 `inventory_managers` + 별도 설정 페이지 — 필드 엔지니어 직무와 섞지 않음 |
| **Excel 일괄 가져오기** | `app/api/hospitals/` Excel import (미리보기 모드 포함) | 품목 초기 등록(50~100건) Excel 업로드 패턴 재사용 |
| **자동 발번** | 유지보수 `MNT-YYYYMM-NNNN` 채번 로직 | 입출고 전표 코드 `STK-YYYYMM-NNNN` 동일 패턴 |
| **Slack 알림 인프라** | `lib/slack.ts`, `lib/notify.ts`, `notification_logs` | 안전재고 미달 알림. 신규 이벤트 함수 1개 추가 (`notifyStockLow`), dedup·모드 라우팅·로그 전부 재사용 |
| **실시간 권한 차단 패턴** | 차량예약 `vehicleReservationBlocked` 서버 검사 | 입출고 API 진입 시 DB로 풀 등록 여부 실시간 확인(403) |
| **삭제 대신 비활성화** | `Vehicle` (예약 이력 있으면 비활성화) | 이력 있는 품목·위치는 삭제 대신 `isActive=false` |
| **동시성 이중 방어** | 차량예약 (앱 트랜잭션 검사 + DB EXCLUDE 제약) | 재고 음수 방지: 앱 `$transaction` 조건부 차감 + DB `CHECK (quantity >= 0)` |
| **병원 검색 모달** | 유지보수·기타업무 등록 폼의 병원 검색 | 출고 시 병원 연결 UI 재사용 |
| **감사 로그** | `lib/audit.ts` | 모든 mutation을 `resource='inventory_item' / 'inventory_tx' / 'warehouse'`로 기록 |
| **역할 헬퍼** | `lib/auth.ts` `isAdminOrAbove` | 마스터 관리 권한 체크 |
| **네비 메뉴** | `nav_menu_items` | `inventory` 메뉴 행 추가 (기타업무 선례: 기본 SEERS만 노출) |

> **위키 모듈 경계 무관** — 이 기능은 전부 메인 모듈(public 스키마). `app/wiki/*`, `lib/wiki/*`를 건드리지 않는다.
> **Task 통합 미러 무관** — 자재 전표는 '업무'가 아니므로 Task를 만들지 않는다.

---

## 3. 아키텍처

```
[재고 화면 /inventory/*] ──▶ [API /api/inventory/*] ──▶ Prisma $transaction
                                     │                    ├─ inventory_transactions (원장, append-only + 취소 마킹)
                                     │                    ├─ inventory_stocks (품목×위치 현재고 스냅샷, CHECK >= 0)
                                     │                    └─ inventory_units (시리얼 개체 상태)
                                     │
                                     └─ (커밋 성공 후, best-effort) lib/notify.ts notifyStockLow() ──▶ Slack
```

**재고 수량의 진실은 `inventory_stocks`** (품목×위치 스냅샷, 전표와 같은 트랜잭션에서 증감). 원장(`inventory_transactions`)은 이력·취소 근거. 시리얼 품목은 `inventory_units`의 IN_STOCK 개수가 스냅샷 수량과 항상 일치해야 한다(같은 트랜잭션에서 갱신).

### 신규 파일

| 파일 | 역할 |
|---|---|
| `lib/inventory.ts` | 전표 코드 발번, 재고 증감 트랜잭션 헬퍼(`applyStockDelta`), 권한 체크(`canManageStock` — ADMIN 이상 or INVENTORY 풀), 안전재고 판정 |
| `app/api/inventory/items/route.ts` + `[id]/route.ts` | 품목 CRUD |
| `app/api/inventory/items/import/route.ts` | 품목 Excel 일괄 등록 (preview 모드 포함) |
| `app/api/inventory/transactions/route.ts` + `[id]/route.ts` + `[id]/cancel/route.ts` | 전표 목록/등록 + 메타 수정(ADMIN) + 취소 |
| `app/api/inventory/transactions/bulk-serial/route.ts` | 시리얼 품목 Excel 일괄 입출고 (preview 모드 포함) — A열 품목명·B열 시리얼·C열 LOT |
| `app/api/inventory/stocks/route.ts` | 재고 현황 집계 조회 |
| `app/api/inventory/units/route.ts` + `[id]/route.ts` | 시리얼 개체 목록/수정 |
| `app/api/settings/warehouses/route.ts` + `[id]/route.ts` | 위치(창고) CRUD |
| `app/api/settings/inventory-managers/route.ts` + `[id]/route.ts` + `candidates/route.ts` | 재고 담당자 풀 CRUD + 후보 검색 (field-engineers API 패턴 복제) |
| `app/inventory/page.tsx` | 재고 현황 (기본 진입 화면) |
| `app/inventory/transactions/page.tsx` | 입출고 이력 |
| `app/inventory/items/page.tsx` + `[id]/page.tsx` | 품목 관리 + 품목 상세 |
| `app/settings/warehouses/page.tsx` | 위치 관리 |
| `app/settings/inventory-managers/page.tsx` | 재고 담당자 관리 (field-engineers 페이지 패턴 복제) |

### 수정 파일

- `prisma/schema.prisma` — 신규 모델 7개 (§4)
- 품목 분류: StatusCode `ITEM_CATEGORY` — 기존 설정 CRUD 페이지 신설(기존 status 페이지 복제 수준) 또는 기존 패턴 페이지 추가
- `lib/notify.ts` — `notifyStockLow()` 추가 (Phase 5)
- `app/api/settings/notifications/route.ts` + 설정 페이지 — `notify_stock_enabled` 토글 (Phase 5)
- 병원 상세 페이지 — "사용 자재" 카드 (Phase 4)
- `nav_menu_items` — `inventory` 행 INSERT

---

## 4. DB 설계

> ⚠️ **CLAUDE.md 절대 규칙**: `prisma migrate dev` 금지. psql 직접 실행 → 마이그레이션 파일 수동 생성 → `migrate resolve --applied` → schema.prisma 수동 갱신 → `npx prisma generate` 순서 엄수. **PROD DB 적용은 배포 시점(Phase 6)에 별도 확인 후.** 전부 public 스키마.

### 4-1. `inventory_items` (품목 마스터)

```sql
CREATE TABLE inventory_items (
  id                SERIAL PRIMARY KEY,
  item_code         VARCHAR(20) UNIQUE NOT NULL,      -- 'ITEM-NNNN' 자동 발번 (순번)
  name              VARCHAR(100) NOT NULL,
  category_id       INT REFERENCES status_codes(id),  -- StatusCode category='ITEM_CATEGORY'
  spec              VARCHAR(200),                     -- 규격/모델 (예: 'Cat.6 UTP 305m')
  unit              VARCHAR(20) NOT NULL DEFAULT 'EA',-- 단위 (EA/M/BOX/SET ...)
  is_serial_managed BOOLEAN NOT NULL DEFAULT false,   -- 시리얼 개체 추적 여부
  device_info_id    INT REFERENCES device_info(id),   -- 자사 기기 ↔ DeviceInfo 선택 연결
  ref_price         INT,                              -- 참고 단가(원, nullable)
  safety_stock      INT NOT NULL DEFAULT 0,           -- 안전재고 (0=미사용)
  memo              TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_inv_items_category ON inventory_items (category_id);
```

- **`is_serial_managed`는 재고 이력이 생긴 후 변경 금지** (수량↔개체 정합이 깨짐). API에서 전표 존재 시 409
- 이력 있는 품목 삭제 → 비활성화로 대체 (Vehicle 패턴)

### 4-2. `warehouses` (위치 마스터)

```sql
CREATE TABLE warehouses (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(50) UNIQUE NOT NULL,   -- 예: '본사 창고', '사무실', '불량/수리 대기'
  memo       TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

- 불량품 보관은 별도 상태값이 아니라 **'불량/수리 대기' 같은 위치로 표현** (이동 전표로 처리 — 모델 단순화)
- 재고·이력 있는 위치 삭제 → 비활성화로 대체

### 4-3. `inventory_stocks` (현재고 스냅샷)

```sql
CREATE TABLE inventory_stocks (
  item_id      INT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  warehouse_id INT NOT NULL REFERENCES warehouses(id),
  quantity     INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, warehouse_id)
);
```

- 전표 처리와 **같은 `$transaction`에서 upsert 증감**. `CHECK`가 음수 재고의 최종 방어선 (차량예약 EXCLUDE 패턴과 같은 이중 장치)

### 4-4. `inventory_transactions` (입출고 원장)

```sql
CREATE TABLE inventory_transactions (
  id              SERIAL PRIMARY KEY,
  tx_code         VARCHAR(20) UNIQUE NOT NULL,  -- 'STK-YYYYMM-NNNN' (MNT 채번 패턴)
  tx_type         VARCHAR(10) NOT NULL,         -- 'IN' | 'OUT' | 'MOVE'
  reason          VARCHAR(20) NOT NULL,         -- §6-1 사유 코드
  item_id         INT NOT NULL REFERENCES inventory_items(id),
  warehouse_id    INT NOT NULL REFERENCES warehouses(id),  -- IN: 입고처 / OUT: 출고원 / MOVE: 출발지
  to_warehouse_id INT REFERENCES warehouses(id),           -- MOVE 전용 (도착지)
  quantity        INT NOT NULL CHECK (quantity > 0),
  hospital_code   VARCHAR(50) REFERENCES hospitals(hospital_code),  -- OUT 선택 연결
  work_type       VARCHAR(20),                  -- 'PROJECT' | 'MAINTENANCE' | 'ETC' (선택)
  ref_code        VARCHAR(50),                  -- projectCode / maintenanceCode / etcTaskCode
  note            TEXT,
  actor_id        TEXT NOT NULL REFERENCES users(id),
  canceled_at     TIMESTAMP,                    -- NULL=유효, 값=취소됨
  canceled_by_id  TEXT REFERENCES users(id),
  created_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_inv_tx_item ON inventory_transactions (item_id, created_at DESC);
CREATE INDEX idx_inv_tx_hospital ON inventory_transactions (hospital_code);
CREATE INDEX idx_inv_tx_ref ON inventory_transactions (work_type, ref_code);
CREATE INDEX idx_inv_tx_created ON inventory_transactions (created_at DESC);
```

- **원장은 append-only.** 수정 기능 없음 — 잘못 입력하면 취소(§6-3) 후 재입력
- `users.id` 타입은 schema.prisma의 실제 User PK 타입에 맞출 것 (구현 시 확인)

### 4-5. `inventory_units` (시리얼 개체) + `inventory_transaction_units`

```sql
CREATE TABLE inventory_units (
  id            SERIAL PRIMARY KEY,
  item_id       INT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  serial_no     VARCHAR(100) NOT NULL,
  status        VARCHAR(10) NOT NULL DEFAULT 'IN_STOCK',  -- 'IN_STOCK' | 'OUT' | 'DISPOSED'
  warehouse_id  INT REFERENCES warehouses(id),            -- IN_STOCK일 때 위치
  hospital_code VARCHAR(50) REFERENCES hospitals(hospital_code),  -- OUT일 때 설치처(선택)
  memo          TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (item_id, serial_no)
);
CREATE INDEX idx_inv_units_status ON inventory_units (item_id, status);
CREATE INDEX idx_inv_units_hospital ON inventory_units (hospital_code);

CREATE TABLE inventory_transaction_units (
  transaction_id INT NOT NULL REFERENCES inventory_transactions(id) ON DELETE CASCADE,
  unit_id        INT NOT NULL REFERENCES inventory_units(id),
  PRIMARY KEY (transaction_id, unit_id)
);
```

- 개체 이력 = `inventory_transaction_units` 조인으로 산출 (별도 이력 테이블 없음)
- `OUT` + reason `폐기`/`불량` → status `DISPOSED`. 그 외 OUT(설치/판매)은 `OUT` + hospital_code 기록

### 4-6. `inventory_managers` (재고 담당자 풀)

```sql
CREATE TABLE inventory_managers (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

- **FieldEngineer와 별개의 직무** — `field_engineers` 테이블에 workType을 추가하지 않는다 (사용자 확정)
- `user_id` 타입은 schema.prisma의 실제 User PK 타입에 맞출 것

### 4-7. 설정값 — AppSetting key-value (신규 테이블 없음)

| key | value 예시 | 설명 |
|---|---|---|
| `notify_stock_enabled` | `"on"` / `"off"` | 안전재고 미달 Slack 알림 스위치 (기본 off). 전역 `notify_enabled`와 AND 조건 |

### 4-8. 재고 구분 2차원 — 소유 × 용도 (Phase 7)

같은 품목이라도 **소유 주체**와 **용도**가 다르면 별개 재고로 관리한다 (예: MC200M-T — 대웅제약 재고 / 평가용 / 판매용). 재고 = **품목 × 위치 × 소유 × 용도** 4차원.

- **마스터 2종** — StatusCode 신규 category (설정 페이지에서 편집, item-category 패턴 복제):
  - `STOCK_OWNER` (소유): 시드 `대웅제약 재고`(0) / `씨어스 재고`(1)
  - `STOCK_PURPOSE` (용도): 시드 `판매용`(0) / `평가용`(1) / `기타`(2)
- **컬럼 추가** (전부 `INT NOT NULL REFERENCES status_codes(id)`):
  - `inventory_stocks`: `owner_id`, `purpose_id` + **PK 재구성** `(item_id, warehouse_id, owner_id, purpose_id)`
  - `inventory_transactions`: `owner_id`, `purpose_id`
  - `inventory_units`: `owner_id`, `purpose_id` + 인덱스 `(item_id, status)` 유지
- **기존 행 백필**: 마이그레이션에서 기존 stocks/transactions/units 행은 (`씨어스 재고`, `기타`)로 백필 후 NOT NULL 부여 (dev2는 실데이터 없음 — E2E 정리됨)
- **⚠️ 구분 간 전환 없음 (사용자 확정)**: (소유, 용도)는 **입고 시 확정되어 출고까지 불변**. 전환 전표·CONVERT 유형·to_owner/to_purpose 컬럼을 만들지 않는다. MOVE는 같은 (소유, 용도) 버킷 안에서 물리 위치만 변경
- **로직 변경** (`lib/inventory.ts`):
  - `CreateTxInput`에 `ownerId`/`purposeId` 필수. 재고 증감·조회 키가 4차원으로
  - 시리얼: 입고 시 개체에 (소유, 용도) 기록, OUT/MOVE 개체 검증에 **버킷 일치 확인** 추가, 취소 원복도 동일 버킷
  - 사용 중(재고>0 또는 전표 존재)인 owner/purpose StatusCode 삭제 시 409
- **UI 변경**:
  - `TransactionModal`: 소유/용도 select 2개 — IN은 자유 선택(필수), 비시리얼 OUT/MOVE는 재고 있는 버킷을 선택(버킷별 현재고 표시), 시리얼 OUT/MOVE는 개체 선택이 곧 버킷(개체 목록에 소유·용도 표시)
  - `/inventory` 현황: 재고 칩을 `위치·소유·용도 N`으로 확장 + 소유/용도 필터 select. stocks 집계 API에 구분 포함
  - 품목 상세: 위치×구분 재고 표, 개체 목록에 소유·용도 컬럼, 이력에 구분 표시
- 안전재고 판정은 **구분 무관 품목 총합** 기준 유지 (구분별 안전재고는 도입하지 않음)

### 4-9. 계층형 분류 + 제조사 (Phase 8)

품목 기본정보 강화 — 대/중/소분류 트리 + 제조사 마스터.

```sql
-- 계층형 분류 (최대 3단계: 대 > 중 > 소)
CREATE TABLE inventory_categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(50) NOT NULL,
  parent_id  INT REFERENCES inventory_categories(id),  -- NULL=대분류
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
-- 같은 부모 아래 중복명 방지 (대분류는 parent NULL끼리 비교)
CREATE UNIQUE INDEX idx_inv_cat_name ON inventory_categories (COALESCE(parent_id, 0), name);
```

- **깊이 3단계 제한 + 순환 방지는 API에서 검증**. 품목은 어느 단계 노드에나 연결 가능 (소분류까지 강제 아님)
- **이관**: 기존 StatusCode `ITEM_CATEGORY` 4행(자사기기/전자제품/네트워크/잡자재)을 `inventory_categories` 대분류로 복사 → `inventory_items.category_id` FK를 status_codes → inventory_categories로 교체(매핑 이전) → StatusCode ITEM_CATEGORY 행과 구 설정 페이지 로직은 제거(페이지 경로 `/settings/item-category`는 트리 관리 UI로 교체)
- **하위 분류·연결 품목 있는 노드 삭제 금지** (409)
- **제조사**: StatusCode 신규 category `MANUFACTURER` + `/settings/manufacturers` 설정 페이지(패턴 복제) + `inventory_items.manufacturer_id INT NULL REFERENCES status_codes(id)`. 추가 필드는 제조사만 (구매처·바코드·보증기간은 사용자 미선택 — 도입하지 않음)
- **품목 폼**: 분류를 대>중>소 연동 select(상위 선택 시 하위 로드), 제조사 select. 목록·현황·상세·필터에 반영
- **Excel 가져오기 컬럼 확장**: `품목명 | 대분류 | 중분류 | 소분류 | 제조사 | 규격 | 단위 | 시리얼여부 | 안전재고 | 참고단가` — 분류는 이름 경로 매칭(없으면 미지정+경고), 제조사도 이름 매칭

### 4-10. 재설계 — 인벤토리 1차원 + 주자재/부자재 + 유형 마스터 (Phase 9, 2026-07-08 사용자 확정)

**소유×용도 2차원(§4-8)을 폐기**하고 단일 **인벤토리** 축으로 재설계. 재고 = **품목 × 위치 × 인벤토리**.

```sql
-- 인벤토리 마스터 (시드 3행)
CREATE TABLE inventories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,          -- 대웅제약재고 / 평가용재고 / 판매용재고
  is_transfer_locked BOOLEAN NOT NULL DEFAULT false,  -- true = TRANSFER 출발·도착 모두 불가 (평가용재고)
  memo TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- 주자재-부자재 매핑 (1단계 깊이 — 부자재는 주자재가 될 수 없음, API 검증)
CREATE TABLE inventory_item_components (
  parent_item_id INT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  child_item_id  INT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),  -- 주자재 1개당 구성 수량
  sort_order INT NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_item_id, child_item_id), CHECK (parent_item_id <> child_item_id)
);
```

- **컬럼 치환**: stocks/transactions/units의 `owner_id`/`purpose_id` → `inventory_id`(NOT NULL). stocks PK `(item_id, warehouse_id, inventory_id)`. 기존 데이터는 **판매용재고**로 백필(사용자 확정). STOCK_OWNER/STOCK_PURPOSE StatusCode·설정 페이지 제거
- **전표 유형 4종**: `IN` / `OUT` / `MOVE`(같은 인벤토리 내 위치 이동) / **`TRANSFER`(인벤토리 간 이관)** — `to_inventory_id`(+선택적 `to_warehouse_id`). **이관 규칙**: 출발·도착 인벤토리 모두 `is_transfer_locked=false`여야 허용 → 대웅제약↔판매용 가능, **평가용재고는 양방향 이관 금지**(사용자 확정). 시리얼 개체는 이관 시 `inventory_id` 소속 변경
- **입고/출고 유형 마스터화**: `reason` VARCHAR → `reason_id` FK(StatusCode `STOCK_IN_TYPE`/`STOCK_OUT_TYPE`). 설정 `/settings/stock-reasons`에서 추가·삭제 가능(사용자 요청). **value 있는 행은 시스템 유형**(회수(반품)=`RETURN` — OUT 개체 복귀, 폐기/불량=`DISPOSE` — 개체 DISPOSED)으로 삭제 금지, 사용 중 유형도 삭제 409. MOVE/TRANSFER는 reason 없음(고정 라벨). '실사조정' 유형 미시드(부가기능 제외 — 사용자 확정)
- **출고처 (`destination` VARCHAR(100))**: OUT 전표에 자유 텍스트 출고처. 병원 연결(hospital_code)은 별도 유지 — 대웅제약재고는 병원 매핑 권장, 평가용/판매용은 텍스트만도 가능(유관부서 출고요청 구조)
- **세트출고**: OUT 시 주자재에 매핑된 **비시리얼 부자재**를 같은 위치·인벤토리에서 동시 출고. 부자재별 자식 전표 생성(`parent_tx_id` 연결), 수량 기본값 = 출고수량×구성수량(수정 가능). **시리얼 부자재는 세트출고 제외**(개별 출고 안내 — v1 결정). 주자재 전표 취소 시 자식 전표 일괄 취소
- **Excel export**: 재고 현황(`/api/inventory/stocks/export`)·입출고 내역(`/api/inventory/transactions/export`) — 화면 필터 그대로 xlsx 생성(기존 `xlsx` 라이브러리 쓰기 재사용, 신규 패키지 없음)
- **안전재고·실사조정 기능 제거**(사용자 확정 — 수량·입출고 관리에 집중): `safety_stock` 컬럼·부족 뱃지·`notify_stock_enabled`·`maybeNotifyLowStock` 전부 삭제
- **DB 필드 분리 원칙**: 인벤토리·위치·상태는 각각 독립 컬럼(FK) — UI 표기만 결합, 저장은 항상 분리(사용자 요청 확인). 품목 마스터는 단일 테이블 유지 — PostgreSQL `ALTER TABLE ADD/DROP COLUMN`이 저비용이라 서브테이블(EAV) 분리 없이 컬럼 추가·제거 용이

**보완 (2026-07-08 사용자 피드백, 마이그레이션 `20260708150000`)**:
- **인벤토리 분리 레벨 상향**: 자재 현황·입출고 이력에 **인벤토리 탭**(전체/대웅제약/평가용/판매용). 현황↔이력 이동 시 탭 유지(`?inv=`). 전표 모달의 기본 인벤토리 = **현재 선택된 탭**(입고 preselect, 출고/이동/이관은 해당 버킷 우선 선택)
- **인벤토리 자재 상세 라우트** `/inventory/[invId]/items/[itemId]` (사용자 승인 재설계): 인벤토리 탭에서 자재 클릭 시 진입하는 **경로 고정 스코프 페이지** — 그 인벤토리의 재고·이력·개체만 표시, 타 인벤토리 탭 없음(철저 분리), 입출고 모달 인벤토리 고정(`fixedInventoryId`). 품목 마스터 상세(`/inventory/items/[id]`)는 기준정보·부자재 구성 + 인벤토리별 재고 요약 카드(→각 인벤토리 상세 링크) + 전체 이력·개체의 관리 관점 페이지로 정리(인벤토리 탭 제거). 진입 규칙: 인벤토리 탭 클릭→스코프 상세 / 전체 탭·품목 관리→마스터 상세. (초기의 `?inv=` 쿼리 승계 방식은 클라이언트 전환 시 URL 판독 시점 문제로 폐기)
- **병원 연결 인벤토리 제한**: `inventories.link_hospital`(BOOLEAN, 대웅제약재고만 true) — 출고 시 병원·업무 연결은 이 플래그가 켜진 인벤토리에서만(UI 숨김 + 서버 400). 설정 페이지에서 편집
- **시리얼 대량 처리 (바코드 스캔)**: 재고 1만 개·1회 100~200개 출고 대응 — 출고/이동/이관 시 개체 지정을 체크박스 목록 대신 **시리얼 직접 입력 textarea**(줄 단위 붙여넣기·바코드 리더기 연속 스캔)로. 서버가 시리얼→개체 해석(`serials[]` 지원) 후 버킷(위치·인벤토리·IN_STOCK) 일치 검증 — 미등록/버킷 불일치 시리얼은 목록 명시하며 거부. 가용 개체 목록(≤200개 표시)에서 클릭 선택도 병행
- **이관 일자·단가** (마이그레이션 `20260708200000`): TRANSFER 전표에 `transfer_date`(DATE, 기본 오늘 KST)·`transfer_price`(INT, 참고용 선택 — 대웅제약→판매용 이관은 재판매 개념) 기록. 이력·인벤토리 자재 상세·Excel export 표시. 출고/이동/이관 모달은 현재 창고에 재고 없으면 재고 있는 창고 1회 자동 선택(빈 입력 화면 방지)
- **품목 모델명** (마이그레이션 `20260708220000`): `inventory_items.model_name`(VARCHAR(100)) — 제조사 모델 식별자(규격과 별개). 품목 폼·목록·현황·상세(마스터/인벤토리)·검색·Excel 가져오기(2번째 컬럼)·재고 export 반영

---

## 5. 권한 설계

| 행위 | 허용 대상 |
|---|---|
| 재고·이력·품목 **조회** | 로그인 전체 (VIEWER 포함) |
| **입고/출고/이동/취소** | **재고 담당자 풀**(`inventory_managers`) 등록자 + ADMIN 이상 |
| 품목 마스터 관리 (등록/수정/비활성/Excel) | ADMIN 이상 |
| 위치·분류·재고 담당자 풀 관리 | ADMIN 이상 |

- 재고 담당자는 **FieldEngineer(업무 담당자)와 별개 직무** — 별도 테이블·별도 설정 페이지. 한 사람이 둘 다일 수는 있음(테이블만 분리)
- 풀 검사는 **서버에서 DB 실시간 조회** (`inventory_managers WHERE user_id=?`) — 차량예약 차단 패턴. JWT에 넣지 않음
- ADMIN 이상은 풀 미등록이어도 처리 가능 (운영 편의 — 풀은 USER 역할에게 권한을 주는 수단)
- 재고 담당자 후보: 활성 계정 전체 (소속 무관 — 좁힐 필요 생기면 추후 조건 추가)

---

## 6. 로직 설계

### 6-1. 전표 유형과 사유

조정(실사 보정)은 별도 유형이 아니라 **IN/OUT + 사유 `실사조정`**으로 처리 (유형 3개 유지, 모델 단순화).

| tx_type | 사유(reason) 선택지 | 재고 효과 |
|---|---|---|
| `IN` | `구매` / `회수(반품)` / `실사조정` / `기타` | warehouse_id +qty |
| `OUT` | `설치` / `판매` / `폐기` / `불량` / `실사조정` / `기타` | warehouse_id −qty |
| `MOVE` | `이동` (고정) | warehouse_id −qty, to_warehouse_id +qty |

- 사유는 코드 상수로 관리 (`lib/inventory.ts`) — StatusCode로 뺄 필요 없음 (변동 가능성 낮음, 로직 결합 높음)
- `OUT` 시 병원 검색 모달로 병원 연결(선택) + 병원 선택 시 그 병원의 진행 중 업무(프로젝트/유지보수/기타업무) 드롭다운 연결(선택)

### 6-2. 재고 증감 트랜잭션 (음수 방지)

모든 전표는 하나의 `$transaction`으로:

1. 전표 INSERT (tx_code 발번 포함)
2. `inventory_stocks` upsert 증감 — **감소는 조건부** `UPDATE ... SET quantity = quantity - $n WHERE item_id=? AND warehouse_id=? AND quantity >= $n`, 영향 행 0이면 롤백 + 409 "재고 부족 (현재 N개)"
3. 시리얼 품목이면 `inventory_units` 상태 갱신 + `inventory_transaction_units` INSERT
4. 커밋 성공 후 감사 로그 + (Phase 5) 안전재고 체크 → `notifyStockLow` (best-effort)

**시리얼 품목 정합 규칙** (트랜잭션 안에서 강제):
- IN: 입력한 시리얼 개수 = quantity. 시리얼 중복(같은 품목 내) 시 409. 개체 신규 생성 (`IN_STOCK`, 입고 위치)
  - `회수(반품)` 입고: 기존 `OUT` 개체의 시리얼 입력 → 해당 개체를 `IN_STOCK`으로 복귀 (신규 생성 아님)
- OUT: 해당 위치 `IN_STOCK` 개체 중에서 quantity개 **선택** (체크박스). 선택 개체 수 ≠ quantity면 400
- MOVE: 선택 개체들의 warehouse_id 변경

### 6-3. 전표 취소

- 취소 = **원장에 canceled_at 마킹 + 재고를 역방향으로 되돌림** (역방향 전표를 새로 만들지 않음 — 원장 조회가 단순해짐)
- 되돌림이 재고를 음수로 만들면 409 거부 (예: 입고 100 → 출고 80 후, 그 입고 전표를 취소하려는 경우 → "먼저 관련 출고를 취소하세요" 안내)
- 시리얼 개체 상태도 원복 (OUT 취소 → IN_STOCK 복귀 등). 원복 대상 개체가 이미 다른 전표로 이동했으면 409
- 취소된 전표는 이력 목록에 취소선 + 취소자·시각 표시. 취소의 취소는 없음 (재입력으로 처리)
- 취소 권한: 처리 권한과 동일 (풀 + ADMIN 이상)

### 6-4. 안전재고 Slack 알림 (Phase 5)

- **판정 시점**: 재고 감소 전표(OUT, MOVE 아님) 커밋 성공 후 — 품목 **전 위치 합계**가 `safety_stock` 미만이면 발송 (safety_stock=0은 미사용)
- **게이트**: `notify_enabled`(전역) AND `notify_stock_enabled` (기본 off)
- **dedup**: `notification_logs` — `event_type='stock_low'`, `ref_code=item_code`, 같은 품목 **24시간 내 1회**
- **메시지**: `📦 [재고 부족] 게이트웨이 — 현재 3EA (안전재고 10EA)` + 재고 현황 링크. 발송 모드(off/test/live)·`[DEV]` prefix·로그는 기존 인프라 그대로
- 스케줄러 불필요 (이벤트 시점 발송으로 충분). 발송 실패는 전표 처리를 절대 깨지 않음

### 6-5. 자동 발번

- 품목: `ITEM-NNNN` (전체 순번 4자리)
- 전표: `STK-YYYYMM-NNNN` (월별 순번 — 유지보수 MNT 채번 로직 패턴 재사용, 트랜잭션 내 채번으로 중복 방지)

---

## 7. 화면 설계

모든 화면은 기존 디자인 시스템(`components/ui/*`) + 모바일 카드 뷰 컨벤션(md 미만) 준수. mutation 후 `router.refresh()` 필수.

### `/inventory` — 재고 현황 (메뉴 기본 진입)

- 품목 목록 테이블: 품목코드 | 분류 | 품목명 | 규격 | 단위 | **위치별 재고 칩** | 총재고 | 안전재고 | 상태
- 총재고 < 안전재고 → 행 강조(빨간 뱃지 `부족`)
- 필터: 분류 select / 위치 select / 품목명 검색 / "부족만 보기" 토글 / 비활성 포함 토글
- 상단 버튼(권한자만): `+ 입고` / `− 출고` / `⇄ 이동` → 전표 등록 모달 (§7-1)
- 행 클릭 → 품목 상세

### 7-1. 전표 등록 모달 (입고/출고/이동 공용)

- 공통: 품목 검색 select → 선택 시 현재고 표시, 위치 select, 수량, 사유, 비고
- 출고: + 병원 검색 모달(선택) → 병원 선택 시 해당 병원 진행 업무 드롭다운(선택)
- 시리얼 품목: 수량 입력 대신 — 입고는 시리얼 textarea(줄 단위 벌크 입력), 출고/이동은 재고 개체 체크박스 목록
- 이동: 출발 위치 → 도착 위치

### `/inventory/items/[id]` — 품목 상세

- 기본 정보 카드 (분류·규격·단위·참고단가·안전재고·DeviceInfo 연결·메모) + 수정(ADMIN)
- 위치별 재고 카드
- 입출고 이력 (이 품목만, 최근 50건 + 더보기)
- 시리얼 품목: 개체 목록 탭 (시리얼 | 상태 | 위치/설치 병원 | 메모) — 상태 필터

### `/inventory/transactions` — 입출고 이력

- 전표 목록: 전표코드 | 일시 | 유형 | 사유 | 품목 | 수량 | 위치(→도착지) | 병원/업무 | 처리자 | 비고
- 필터: 유형 / 품목 / 위치 / 병원 / 기간. 취소 전표는 취소선 표시
- 행 액션(권한자): 취소 (확인 모달 + 사유 입력)

### `/inventory/items` — 품목 관리 (ADMIN 이상)

- 품목 CRUD + 순서 + 활성 토글 + **Excel 일괄 가져오기** (컬럼: 품목명·분류·규격·단위·시리얼여부·안전재고·참고단가 / 미리보기 모드 — 병원 Excel 패턴)

### 설정 (ADMIN 이상)

- `/settings/warehouses` — 위치 CRUD·순서·활성 (기존 설정 페이지 패턴)
- 품목 분류 — StatusCode `ITEM_CATEGORY` 설정 페이지 (기존 status 페이지 패턴)
- `/settings/inventory-managers` — **재고 담당자 관리** (별도 페이지 — field-engineers의 후보 검색 모달·목록 UI 패턴만 복제, 데이터는 `inventory_managers`)

### 병원 상세 — "사용 자재" 카드 (Phase 4)

- 해당 병원으로 출고된 이력 요약 (품목·수량·일자·연결 업무) + 설치된 시리얼 개체 목록 (`inventory_units WHERE hospital_code=? AND status='OUT'`)
- 기존 답사/설치계획/프로젝트 카드와 같은 패턴·위치

### 네비게이션

- `nav_menu_items`에 `inventory` (표시명 "자재관리", 메인 메뉴) INSERT — 기본 노출: SEERS만 (기타업무 선례, 메뉴 관리에서 변경 가능)
- 설정 하위 메뉴 행 추가: `settings/warehouses`, `settings/inventory-managers`, 품목 분류 (기존 설정 하위 메뉴 컨벤션 — `parentKey='settings'`, ADMIN 이상)

---

## 8. Phase 진행 계획

> 각 Phase는 **게이트(검증 통과) 후 다음 진행**. ⏳ 표시는 해당 Phase 시작 시 사용자 결정 필요 항목 — **결정 없이 임의 진행 금지, AskUserQuestion 등으로 반드시 확인.**

### Phase 0 — 마스터 데이터 준비 (사용자 작업 병행, 코딩 없음)

- [ ] ⏳ 품목 분류 체계 확정 (예: 자사기기/전자제품/네트워크/케이블·잡자재 — 사용자 확인)
- [ ] ⏳ 위치(창고) 목록 확정 (예: 본사 창고, 불량/수리 대기 등)
- [ ] ⏳ 품목 리스트 수령 (Excel — 품목명·분류·규격·단위·시리얼 관리 여부·안전재고) ※ 없으면 Phase 1은 수동 등록 UI만으로 진행 가능
- [ ] 초기 재고 수량(+시리얼 품목은 시리얼 목록)은 Phase 4에서 `실사조정` 입고로 적재 — 미리 준비 요청

**게이트**: 분류·위치 목록 확정 (품목 리스트는 후행 가능)

### Phase 1 — 품목·위치 마스터

- 마이그레이션: `inventory_items`, `warehouses`, `inventory_managers` (§4-1, 4-2, 4-6 — **CLAUDE.md 마이그레이션 패턴 준수**)
- StatusCode `ITEM_CATEGORY` 카테고리 + 분류 설정 페이지
- 품목 관리 페이지 + CRUD API + Excel 가져오기(미리보기)
- 위치 관리 페이지 + CRUD API
- **재고 담당자 관리 페이지/API** (`/settings/inventory-managers` — field-engineers 패턴 복제, 별도 테이블)
- 네비 메뉴 행 추가(메인 + 설정 하위), 감사 로그 연결

**게이트**: `tsc --noEmit` 0오류. 품목 등록/수정/비활성 + Excel 미리보기→반영 + 위치·분류·재고 담당자 풀 관리 E2E. 시리얼 플래그 잠금(이력 후 변경 409)은 Phase 2 게이트에서 확인

### Phase 2 — 재고 원장 + 입출고 (비시리얼)

- 마이그레이션: `inventory_stocks`, `inventory_transactions` (§4-3, 4-4)
- `lib/inventory.ts` (발번·권한·증감 트랜잭션)
- 전표 등록 API/모달 (IN/OUT/MOVE — 수량 품목), 취소 API (§6-3)
- 재고 현황 페이지 + 입출고 이력 페이지
- 음수 방지 (조건부 UPDATE + CHECK), 권한 실시간 검사(403)

**게이트**: E2E — 입고→현황 반영→출고→이동→취소(역방향 복원). 재고 초과 출고 409. 풀 미등록 USER 403 / 풀 등록 후 정상. 입고 전표 취소가 음수를 만들 상황 409. `tsc` 0오류

### Phase 3 — 시리얼 개체 관리

- 마이그레이션: `inventory_units`, `inventory_transaction_units` (§4-5)
- 시리얼 입고(벌크 입력·중복 검사) / 출고·이동(개체 선택) / 회수 입고(기존 개체 복귀) / 폐기·불량(DISPOSED)
- 품목 상세 개체 목록 탭, 전표 취소 시 개체 상태 원복

**게이트**: E2E — 시리얼 3개 입고→2개 출고(병원 연결)→1개 회수→1개 폐기, 각 단계에서 stocks 수량 = IN_STOCK 개체 수 일치. 중복 시리얼 409. 취소 시 개체 원복. 수량-개체 불일치 400

### Phase 4 — 병원·업무 연동 + 초기 재고 적재

- 출고 모달: 병원 검색 + 진행 업무 드롭다운 연결 (§6-1)
- 병원 상세 "사용 자재" 카드 (출고 이력 + 설치 개체)
- ⏳ **초기 재고 실사값 수령 → `실사조정` 입고로 일괄 적재** (스크립트 또는 Excel — 사용자와 방식 확정)

**게이트**: 출고→병원 상세 카드 표시 확인. 업무 연결 전표가 이력 필터(병원/업무)로 조회됨. 초기 재고 적재 후 현황 = 실사값 일치 확인

### Phase 5 — 안전재고 Slack 알림 + 마무리

- `notifyStockLow()` (§6-4) + `notify_stock_enabled` 토글 (알림 설정 페이지에 카드 추가)
- 재고 현황 "부족만 보기" 최종 점검, 모바일 카드 뷰 점검
- ⏳ **결정**: 알림 채널 — `SLACK_CHANNEL_MAIN` 재사용 vs 별도 채널

**게이트**: dev2(test 모드)에서 출고로 안전재고 미달 → 테스트 채널 수신 + 로그 기록. 24h dedup 확인. 토글 off 시 미발송. Slack 토큰 제거 상태에서 전표 API 정상(발송만 skip)

### Phase 6 — PROD 배포 (사용자 명시 요청 시에만)

- **PROD DB 마이그레이션은 사용자 확인 후** 적용 (테이블 7개 + StatusCode 시드 + nav_menu_items 메인 1행·설정 하위 행)
- 배포 절차: dev2 커밋·push → PROD pull → 마이그레이션 → `npx prisma generate` → 힙4GB 빌드 → `pm2 restart thync-prod` → 스모크
- PROD 초기: `notify_stock_enabled` off 유지, 마스터(분류·위치·품목)·초기 재고 적재 → 검수 후 운영 시작
- **Phase 7·8이 완료된 경우 배포 범위에 포함** (마이그레이션 누적 적용)

### Phase 7 — 재고 구분 2차원 (소유 × 용도) — §4-8

- 마이그레이션: STOCK_OWNER/STOCK_PURPOSE 시드 + stocks/transactions/units 컬럼 추가·백필·PK 재구성
- `lib/inventory.ts` 4차원 확장 (전환 없음 — CONVERT 만들지 말 것), 전표 모달·현황·상세 UI 반영
- 설정 페이지 2종 (`/settings/stock-owner`, `/settings/stock-purpose` — item-category 패턴)

**게이트**: E2E — 같은 품목·같은 창고에 (대웅,판매용) 5 + (씨어스,평가용) 3 입고 → 버킷별 독립 표시·차감, (대웅,판매용) 재고로 (씨어스,평가용) 출고 시도 시 409, MOVE 후 버킷 유지, 취소 복원, 시리얼 개체 버킷 불일치 선택 409. `tsc` 0오류

### Phase 8 — 품목 기본정보 강화 (계층 분류 + 제조사) — §4-9

- 마이그레이션: `inventory_categories` + 기존 분류 이관(FK 교체) + `manufacturer_id`
- 분류 트리 관리 UI(3단계·순환 방지), 제조사 설정 페이지, 품목 폼 연동 select, Excel 컬럼 확장

**게이트**: 분류 트리 CRUD(3단계 초과·순환·사용 중 삭제 409), 기존 품목 4분류 이관 무손실 확인, 제조사 등록→품목 연결→필터, Excel 확장 미리보기→반영. `tsc` 0오류

---

## 9. 구현 시 절대 준수 사항 (OPUS용 리마인더)

1. **CLAUDE.md 절대 규칙 전부 적용** — 특히: `prisma migrate dev` 금지 / 빌드·git push·PM2 재시작은 사용자 명시 요청 시에만 / PROD DB·소스 직접 작업 금지 / 빌드 시 힙 4GB
2. **재고 정합성이 최우선** — 모든 재고 변동은 전표와 같은 `$transaction` 안에서. 스냅샷(stocks)·개체(units)·원장(transactions)이 어긋나는 코드 경로를 만들지 않는다. 조건부 감산 + CHECK 이중 방어 유지
3. **원장 불변** — 전표 UPDATE/DELETE API를 만들지 않는다. 보정은 취소 + 재입력만
4. **Slack 알림은 절대 본 기능을 깨지 않는다** — 발송 경로 전부 try/catch, 전표 API로 예외 전파 금지 (notification 시스템과 동일 원칙)
5. **새 npm 패키지 설치 금지** — Excel은 기존 병원 import가 쓰는 라이브러리 재사용. 불가피하면 사용자에게 먼저 확인
6. **위키 모듈 경계 무관** — 전부 메인 모듈. `app/wiki/*`, `lib/wiki/*` 건드리지 않음
7. **⏳ 항목은 임의 결정 금지** — 각 Phase 시작 시 사용자에게 확인
8. Phase 완료마다: 이 문서 체크리스트 갱신 → `DEV_HISTORY.md` 상단 기록 → `README.md` 해당 섹션(기능·API·스키마·디렉토리) 갱신
9. 역할 체크는 `isAdminOrAbove` 등 헬퍼 사용, mutation 후 `router.refresh()`, 컴포넌트 PascalCase·파일 kebab-case 등 기존 컨벤션 준수

---

## 10. 진행 체크리스트

| Phase | 내용 | 상태 | 완료일 |
|---|---|---|---|
| 0 | 마스터 데이터 준비 (분류·위치·품목 리스트) | ✅ 분류·위치 확정 (품목 리스트 후행) | 2026-07-07 |
| 1 | 품목·위치 마스터 + 담당자 풀 + Excel | ✅ 구현 완료 (런타임 E2E는 빌드 후) | 2026-07-07 |
| 2 | 재고 원장 + 입출고 (비시리얼) | ✅ 구현 완료 | 2026-07-07 |
| 3 | 시리얼 개체 관리 | ✅ 구현 완료 | 2026-07-07 |
| 4 | 병원·업무 연동 + 초기 재고 적재 | ✅ 연동 완료 (실데이터 적재는 데이터 수령 후) | 2026-07-07 |
| 5 | 안전재고 Slack 알림 + 마무리 | ✅ 구현 완료 | 2026-07-07 |
| 6 | PROD 배포 (Phase 1~9 + 보완 전체, 마이그레이션 8건) | ✅ 배포 완료 | 2026-07-08 |
| 7 | 재고 구분 2차원 (소유×용도) | ✅ 구현·E2E 완료 → **Phase 9로 대체(폐기)** | 2026-07-07 |
| 8 | 품목 기본정보 강화 (계층 분류·제조사) | ✅ 구현·E2E 완료 | 2026-07-07 |
| 9 | 재설계 — 인벤토리 1차원·주자재/부자재·유형 마스터·출고처·Excel export (§4-10) | ✅ 구현·E2E 완료 | 2026-07-08 |
| 10 | 재설계 — 인벤토리별 완전 분리(품목·위치 귀속, 이관 폐지, 첫페이지 카드 섹션) | ✅ 구현·E2E 23/23 완료 (**DEV만 — PROD 미배포**) | 2026-07-16 |

### 결정 이력 (확정 시 여기에 기록)

- **2026-07-16 (Phase 10 재설계, 사용자 확정 + Fable)**: ①**인벤토리별 완전 분리** — 품목(`inventory_items.inventory_id`)·위치(`warehouses.inventory_id`)를 인벤토리에 귀속. 같은 물건(MC200M-T)도 인벤토리마다 자재코드를 새로 따서 별도 품목으로 관리(코드 채번은 ITEM-NNNN 전체 순번 유지). 위치명 UNIQUE는 인벤토리 내로 완화 ②**이관(TRANSFER) 폐지(사용자 확정)** — 전표 유형 IN/OUT/MOVE 3종, 인벤토리 간 이동은 출고+입고로 각각 처리. 과거 이관 전표는 '이관(구)' 이력 표시만(취소 409), `to_inventory_id`/`transfer_date`/`transfer_price` 컬럼은 표시용 보존(deprecated). `is_transfer_locked` 삭제 ③**첫페이지 = 인벤토리별 카드 섹션**(탭 폐기), 자재 행별 입출고 버튼 제거 → 섹션 헤더 입고/출고/이동 버튼(품목은 모달에서 검색·선택 — Fable 추천을 사용자 위임) ④전표의 인벤토리는 품목에서 파생(입력값 아님), 위치·부자재 매핑도 같은 인벤토리 검증 ⑤기존 데이터 백필은 범용 plpgsql(품목: 재고 최다 인벤토리 주 소속+사용 인벤토리별 복제, 위치: 활성 위치 전 인벤토리 복제+참조 재매핑) — PROD 배포 시 그대로 재적용 가능. 마이그레이션 `20260716100000_inventory_scoped_items_warehouses`.

- **2026-07-08 (Phase 9 재설계, 사용자 확정 + Fable)**: ①**인벤토리 1차원 전환** — 소유×용도 2차원 폐기, `inventories` 마스터(대웅제약재고/평가용재고/판매용재고). 같은 품목도 인벤토리별 수량·입출고 완전 독립 ②**이관(TRANSFER)** — 대웅제약↔판매용 상호 이관 허용, **평가용재고는 양방향 이관 금지**(`is_transfer_locked`) ③**주자재/부자재** — `inventory_item_components` 매핑(1단계 깊이) + 구성 수량 + **세트출고**(비시리얼 부자재 자동 동시 출고, 자식 전표 `parent_tx_id`, 시리얼 부자재는 v1 제외) ④**입고/출고 유형 설정화** — StatusCode STOCK_IN_TYPE/OUT_TYPE, 시스템 유형(RETURN/DISPOSE value)은 삭제 보호 ⑤**출고처 destination** 텍스트 필드(병원 매핑과 병행) ⑥**안전재고·실사조정 제거**(수량·입출고 집중) ⑦기존 데이터(판매용 외 백필분)는 판매용재고로 이관 ⑧Excel export 2종(재고 현황·입출고 내역, 화면 필터 반영). 마이그레이션 `20260708100000_redesign_inventory_inventories`.

- **2026-07-07 (Phase 7·8 구현 + 검수 보완, Fable)**: 설계대로 구현 완료, dev2 빌드·재시작·E2E 31/31 통과. **구현 세부**: stocks PK 4컬럼 재구성 + 기존 행 (씨어스 재고, 기타) 백필. 회수(반품)도 원래 구분과 일치해야 함(400 — 회수를 통한 우회 전환 차단). OUT/MOVE의 버킷 선택 UI = 재고 있는 버킷만 select(가용수량 표시). 분류 트리 UNIQUE는 `COALESCE(parent_id,0)+name`(SQL 전용, Prisma 미표현), 3단계·순환·사용 중 삭제는 API 검증. 공용 `StatusCodeManager` 컴포넌트 신설(소유/용도/제조사 설정 페이지 공유). **병행 검수 보완 5건**(OPUS Phase 1~5): ①품목 시리얼 플래그 잠금(이력 시 409 — 설계 §4-1 요구 미구현 발견) ②이력 품목 DELETE→비활성화(기존 FK 500) ③창고 DELETE 보호(재고 잔존 409/이력 비활성화) ④시리얼 동시성 가드(조건부 updateMany+건수 검증 — 동시 이중 출고 차단, 취소 원복 포함) ⑤IN 취소 안전재고 알림 훅 + 전표코드 P2002 재시도. **후속 잔여**: 모바일 카드 뷰(가로 스크롤로 대응 중), 구분별 안전재고(미채택 유지).

- **2026-07-07 (Phase 7·8 설계, 사용자 확정 + Fable)**: ①**재고 구분 2차원 도입** — 사용자 제안으로 소유(대웅제약 재고/씨어스 재고) × 용도(판매용/평가용/기타) 분리. 재고 = 품목×위치×소유×용도. 원래 요구("MC200M-T가 대웅제약 재고/평가용/판매용 3유형")는 소유·용도가 섞인 목록이었고 2차원으로 정규화. 목록은 StatusCode `STOCK_OWNER`/`STOCK_PURPOSE`로 설정에서 편집(미래 유형 추가 대응). ②**구분 간 전환 없음(사용자 확정)** — 입고 시 확정, 출고까지 불변. CONVERT 유형·전환 UI 미구현. ③**품목 기본정보 강화** — 계층형 분류 마스터(대>중>소 3단계 트리, 기존 4분류는 대분류로 이관), 제조사 마스터(StatusCode `MANUFACTURER`). 추가 필드는 제조사만(구매처·바코드·보증기간 미채택). 기존 백필 기본값 (씨어스 재고, 기타)은 Fable 판단.

- **2026-07-07 (Phase 2~5 구현, Opus)**: 재고 원장·입출고·시리얼·병원연동·안전재고 알림 완성. **DB**: `inventory_stocks`(품목×위치 스냅샷, CHECK quantity>=0), `inventory_transactions`(원장 append-only, tx_code `STK-YYYYMM-NNNN`), `inventory_units`+`inventory_transaction_units`(시리얼 개체). **핵심 로직**(`lib/inventory.ts`): `createInventoryTransaction`/`cancelInventoryTransaction`을 `$transaction`으로 — IN/OUT/MOVE 증감(감소는 조건부 updateMany+CHECK 이중방어), 시리얼 정합(IN 벌크·중복검사, 회수는 OUT개체 복귀, OUT 개체선택·폐기 DISPOSED, MOVE 위치이동), 취소는 역방향 되돌림+canceled_at(음수/개체이동 시 409). **API**: transactions(목록/등록/cancel), stocks(집계), units(조회/정정), hospital-works(출고 업무연결), can-manage. **UI**: /inventory 현황(위치별 재고칩·부족뱃지·입출고 모달), /inventory/transactions 이력(취소), /inventory/items/[id] 상세(재고·이력·개체탭), 공용 TransactionModal(유형토글+시리얼+병원/업무연결), 병원상세 '사용 자재' 카드. **Phase 5**: `notify.ts maybeNotifyLowStock`(OUT 커밋 후 best-effort, `notify_stock_enabled` 게이트 기본 off, 품목 24h dedup, SLACK_CHANNEL_MAIN 재사용) + 설정페이지 토글. **구현 판단**: 초기 실사재고 적재는 실데이터 미수령으로 메커니즘(실사조정 입고)만 제공. `tsc` 0오류.

- **2026-07-07 (Phase 1 구현, Opus)**: 마스터 계층 완성. 시드 확정 — 분류 4종(자사기기/전자제품/네트워크/잡자재), 위치 2종(본사 창고/불량·수리 대기). 재고 담당자 후보는 **활성 계정 전체(소속 무관)**로 오픈. **구현 판단(Phase 2로 이월)**: ①`/inventory`는 Phase 1에서 **읽기전용 품목 목록**(stocks 테이블 없음) — Phase 2에서 위치별 재고 칩·입출고 버튼 추가 ②`/inventory/items/[id]` 품목 상세는 재고·이력이 생기는 Phase 2로 연기 ③품목 `is_serial_managed` 잠금·위치/품목 삭제 시 이력 검사는 전표 테이블이 생기는 Phase 2에서 추가(현재는 hard delete) ④Excel 가져오기는 병원(전체 교체)과 달리 **추가형**(기존 품목명 스킵). 채번은 시작 순번 1회 조회 후 로컬 증가. 분류명 미매칭은 분류 없이 등록+경고.

- **2026-07-07 (권한 풀 분리, 사용자 확정)**: 재고 담당자를 FieldEngineer(업무 담당자)에 얹지 않고 **별도 직무로 분리** — 신규 테이블 `inventory_managers` + 별도 설정 페이지 `/settings/inventory-managers`. field-engineers는 UI·API 패턴 참고만. 후보는 활성 계정 전체(소속 무관, Fable 판단 — 필요 시 추후 조건 추가).

- **2026-07-07 (설계 확정, Fable)**: ①추적 단위 = **혼합**(품목별 시리얼 관리 플래그) ②위치 = **다중 위치 마스터** ③출고 연동 = **병원 + 업무 선택 연결** ④안전재고 = **기존 Slack 인프라 재사용** ⑤승인 = **즉시 확정**(취소로 보정) ⑥권한 = **전용 담당자 풀**(ADMIN 이상은 풀 무관 처리 가능) ⑦단가 = **참고용 단가만** ⑧품목 마스터 = **DeviceInfo와 별도 + 선택 연결**(nullable FK). 설계 세부(Fable 판단): 조정은 IN/OUT+사유 `실사조정`으로 통합, 불량 보관은 위치로 표현, 전표 취소는 역방향 되돌림+canceled_at 마킹(역전표 미생성), 안전재고 알림은 이벤트 시점 발송(스케줄러 없음)·24h dedup, 원장 append-only.
