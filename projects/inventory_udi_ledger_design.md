# 자재관리 — UDI 입출고대장 리포트 설계안

> **상태: 구현 완료 (dev2, 2026-08-04) — PROD 미반영** (2026-08-04 작성·착수 승인)
>
> ⚠️ **§4.1의 최초 설계(UDI = 모델 단위)는 폐기되었습니다.** UDI는 **품목(inventory_items) 속성**입니다.
> 정정 경위와 최종 형상은 **§9 착수 후 확정**을 먼저 읽으세요.
>
> 대상: 자재관리(WMS) 모듈에 GMP 품질기록 양식 **F707-1(rev.4) 「입출고대장」** 출력 기능 추가
> 선행 문서: `function_wms.md` (자재관리 본 설계)

---

## 1. 배경

씨어스테크놀로지는 의료기기 제조사로서 모델×LOT 단위 **입출고대장**을 품질기록으로 관리하고 있으며, 현재는 Word 문서로 수기 작성한다. 자재관리(WMS)에 이미 LOT·시리얼 단위 입출고 원장이 축적되어 있으므로, 이 데이터로 동일 양식을 자동 생성한다.

참조 원본: `MP100W(MP6414).docx` (모델 MP100W Series × LOT MP6414, 2026년 7월분)

### 대장의 성격
"재고 현황 리포트"가 아니라 **모델 1종 × LOT 1개 = 문서 1장**의 LOT 추적 대장이다. 이 단위가 전체 설계를 규정한다.

| 블록 | 내용 |
|---|---|
| 헤더 표 | 모델명 / 품명 / 원자재식별 NO |
| 입고정보 표 | 입고일자 · UDI · 상품명 · LOT NO · 입고수량 · 발송처정보 · 동일 LOT NO 제품 출고완료 |
| 출고정보 표 | 출고일자 · UDI · 상품명 · LOT NO · 출고수량 · 입고처정보 · 비고 |
| 하단 | 비고 — 현재고 N개 |
| 머리글/바닥글 | 문서번호 `ST-G1000-1593` / 문서양식 변경적용 `2026.03.31 ~` / `F707-1(rev.4)` / `(주)씨어스테크놀로지` |

---

## 2. 확정된 결정 사항 (2026-08-04 사용자)

| # | 결정 |
|---|---|
| 1 | 대장 기본 단위는 **모델+LOT 합산**(인벤토리 경계 무시). 출력 시 **인벤토리 필터를 옵션**으로 제공 |
| 2 | 인벤토리 간 **MOVE/이관은 대장에 표시하지 않음** (사내 이동은 대외 공급이 아님) |
| 3 | 출력 포맷은 **docx** — 원본 양식의 문서번호·개정이력 유지 + **수정 기능** 제공 |
| 4 | **시스템에 등록된 데이터부터** 대상 (과거 이력 소급 입력 없음 → 대장 시작점 2026-07-01) |
| 5 | UDI 귀속은 **정공법 = `device_info` 모델 마스터 승격**. UDI 값 자체는 나중에 입력 (nullable) |

---

## 3. 현황 진단 (2026-08-04 DEV DB 실측)

### 3.1 UDI — 시스템에 존재하지 않음
코드·DB·설계문서 전체 검색 결과 **0건**. 신규 도입 대상이다.

UDI는 두 부분으로 구성된다.

```
UDI = UDI-DI (기기식별자 — 모델 + 포장단위마다 고정)
    + UDI-PI (생산식별자 — LOT / 시리얼 / 제조일·유효기한)
```

원본 문서의 `0880096401536`은 13자리 GS1 GTIN 형식의 **UDI-DI**다. 입고 2행·출고 12행 전부 동일 값이고 개체 구분은 LOT NO가 담당하는 것이 근거다.

**따라서 UDI를 `inventory_items`에 두면 안 된다.** 품목은 인벤토리별로 분리되어 있어 물리적으로 같은 제품이 복수 행으로 존재한다.

| model_name | 품목 수 | item_code |
|---|---|---|
| MC200M-T | 3 | ITEM-0001 / 0009 / 0016 |
| MP100W | 3 | ITEM-0002 / 0010 / 0017 |
| MP1000F · MP2000F · MP2000R · MGW1010 · comFiX-Electrode | 각 3 | — |
| CR2450 · thynC시스템10 | 각 1 | — |

MP100W 3개 품목의 UDI-DI는 모두 같은 값이어야 하므로 품목 단위 UNIQUE는 즉시 위반된다. → **모델 단위 마스터(`device_info`)에 귀속**한다.

### 3.2 `device_info` 현황 — 마스터 확충 필요
| 항목 | 값 |
|---|---|
| 등록 행 | **2행** (MC200M-T, MP100W) |
| 품목 모델 종류 | 9종 |
| `inventory_items.device_info_id` 연결 | **0 / 24건** |
| 참조 테이블 | `hospital_devices`, `project_devices`, `sales_deal_devices`, `inventory_items` |

### 3.3 LOT 해석 경로가 이원화되어 있음 (핵심)
| 품목 유형 | LOT 저장 위치 | IN 기록률 | OUT 기록률 |
|---|---|---|---|
| 시리얼 관리(`is_serial_managed`) | `inventory_units.lot_no` (개체별) | tx 27/34 | **tx 0/27** |
| 비시리얼 LOT 관리 | `inventory_transactions.lot_no` (전표) | 28/29 | 58/59 |

**기존 `/api/inventory/items/[id]/lot-history` API는 `transaction.lot_no`만 조회한다.** 시리얼 품목은 OUT 전표의 `lot_no`가 전부 비어 있으므로 LOT별 요약이 뭉개진다. ITEM-0010 실측:

```
현행 API 결과 :  (빈 LOT)  IN 169 / OUT 40      ← LOT 소실
units 경유    :  MP6414    IN 169 / OUT 40      ← 정확
```

즉 **시리얼 관리 품목(본체·심전계·게이트웨이)의 LOT별 요약이 현재 화면에서 사실상 동작하지 않는다.** 대장은 반드시 units 경로를 써야 하며, 이 기회에 lot-history도 함께 수정한다.

전표–개체 무결성은 양호하다.

| 검사 | 결과 |
|---|---|
| 시리얼 전표 개체 미연결 | IN 0건 / OUT 0건 |
| 전표 수량 ≠ 개체 수 | 0건 |
| 개체 LOT 미기록 | IN 1건 / OUT 1건 |
| **한 전표에 복수 LOT 혼재** | **5건** (최대 3개 LOT) → 대장에서 행 분해 필요 |

`inventory_units.status` 값은 `IN_STOCK`(18,783) / `OUT`(580) 두 가지뿐이다.

### 3.4 입고 발송처 필드 부재
`inventory_transactions.destination`은 OUT 전용으로 정의되어 있고 **IN 전표 111건 전부 공란**이다. 대장의 "발송처정보"를 채울 필드가 없다. (일부 사용자가 `requester`에 '평택본사'를 입력한 흔적 31건)

| tx_type | 총 건수 | destination 채움 | requester 채움 |
|---|---|---|---|
| IN | 111 | **0** | 31 |
| OUT | 152 | 146 | 152 |
| MOVE | 5 | 0 | 0 |

### 3.5 데이터 정합성 — 잔량 일치 확인
원본 문서(MP6414)와 DEV DB 대조 결과다.

| | 입고 | 출고 | 현재고 |
|---|---|---|---|
| 문서(수기) | 195 (7/1) + 40 (7/16 반납) | 12건 106개 | **129** |
| 시스템 (ITEM-0010) | 169 (7/1 일괄 적재) | 40 (7/29 아주대 CS병동) | **129** |

**현재고가 정확히 일치한다.** 다만 시스템 도입 시 7/1 스냅샷으로 적재했기 때문에 7/1~7/16의 출고·회수 이력은 시스템에 없다. 결정 4에 따라 소급 입력은 하지 않으며, **대장 시작점은 2026-07-01**이 된다.

### 3.6 docx 템플릿 재사용 가능성 — 검증 완료
| 검사 | 결과 | 의미 |
|---|---|---|
| 중첩 표 | **0개** | `<w:tr>` 단위 문자열 처리 안전 |
| 셀당 `<w:t>` run 수 | 1개 = 109셀 / 2개 = 1셀(정적 헤더) / 0개 = 106셀 | **분할 run 없음 → 치환 안전** |
| 표 구조 | 3개 표 (3행 / 4행 / 28행) | 헤더·입고·출고 명확 분리 |
| 문서번호·양식번호 | header1.xml·footer1.xml에 **단일 run** | 치환 용이 |
| document.xml 크기 | 178KB | 문자열 처리 부담 없음 |

라이브러리로 문서를 새로 그리는 대신 **원본 docx를 템플릿 자산으로 사용**하면 글꼴·테두리·머리글/바닥글·여백이 100% 보존된다.

---

## 4. 데이터 모델 변경

### 4.1 `device_info` — 모델 마스터 승격

```sql
ALTER TABLE device_info
  ADD COLUMN udi_di        VARCHAR(50),                        -- UDI-DI (GS1 GTIN 등). NULL=미등록
  ADD COLUMN ledger_name   VARCHAR(100),                       -- 대장 표기 상품명 (예: 'MP100W Series')
  ADD COLUMN product_class VARCHAR(20),                        -- 완제품 | 반제품 | 원자재
  ADD COLUMN material_no   VARCHAR(50),                        -- 원자재식별 NO (완제품은 NULL → '-' 출력)
  ADD COLUMN pack_unit     VARCHAR(20) NOT NULL DEFAULT 'EA',  -- 포장단위 (표기용)
  ADD COLUMN is_udi_target BOOLEAN NOT NULL DEFAULT false;     -- UDI 관리 대상 여부

CREATE UNIQUE INDEX device_info_udi_di_key ON device_info (udi_di) WHERE udi_di IS NOT NULL;
```

- `udi_di`는 **nullable + 부분 UNIQUE** — 결정 5에 따라 값은 나중에 채우되, 채운 값끼리는 중복 불가
- `is_udi_target=false`인 모델(전극·배터리·에바폼 등 매입품·비대상품)은 대장 생성 대상에서 제외
- **포장단위별 복수 UDI-DI**(낱개/박스)는 현재 전 품목 EA 단일이므로 `pack_unit`을 표기용 컬럼으로만 둔다. 실제로 필요해지면 `device_udi(device_info_id, pack_unit, udi_di)` 자식 테이블로 확장 — 지금 도입하면 `device_model` UNIQUE와 충돌하는 과설계

### 4.2 품목 → 모델 연결
`inventory_items.device_info_id`(nullable, SetNull)는 이미 존재하나 연결이 0건이다. 모델명 일치로 백필한다.

```sql
UPDATE inventory_items i SET device_info_id = d.id
  FROM device_info d
 WHERE d.device_model = i.model_name AND i.device_info_id IS NULL;
```

현재 `device_info`에 2행뿐이므로 1차 백필은 6건(MC200M-T·MP100W 각 3)만 매칭된다. UDI 대상 모델 행을 추가한 뒤 재실행한다.

> **⚠️ 부작용 주의** — `GET /api/hospitals/[code]/devices`는 `deviceInfo.findMany()`를 **`isActive` 필터 없이** 호출한다. `device_info`에 행을 추가하면 병원 장비 배정 드롭다운에 즉시 노출된다. 대응 방안은 §8 미결 3 참조.

### 4.3 입고 발송처 — `destination` 겸용
신규 컬럼을 만들지 않고 기존 `destination`(VARCHAR 100)을 **상대처(counterpart)** 로 의미 확장한다.

| tx_type | 의미 | UI 라벨 |
|---|---|---|
| IN | 보내온 곳 | 발송처 |
| OUT | 받는 곳 | 출고처(입고처정보) |

- 기존 IN 111건이 전부 공란이라 **데이터 충돌 없음**, 마이그레이션 불필요(스키마 주석만 갱신)
- 입고 모달에 필드 추가, 이력 화면·Excel export 라벨을 tx_type별로 분기

### 4.4 문서 메타 — `AppSetting`
기존 key-value 패턴(`gw_planner_rules` 등)을 따른다. key = **`udi_ledger_doc_meta`**

```json
{
  "docNumber": "ST-G1000-1593",
  "formNumber": "F707-1",
  "revision": "4",
  "effectiveFrom": "2026.03.31 ~",
  "companyName": "(주)씨어스테크놀로지",
  "revisions": [
    { "rev": "4", "date": "2026.03.31", "note": "문서양식 변경적용" }
  ]
}
```

- 출력 시 머리글에 `문서번호 : {docNumber}` · `문서양식 변경적용 : {effectiveFrom}`, 바닥글에 `{formNumber}(rev.{revision})` · `{companyName}` 을 주입
- `revisions[]`는 개정 이력 보관용(현 양식은 최신 rev만 인쇄). 개정 시 배열에 행 추가 → `revision`·`effectiveFrom` 갱신

---

## 5. 핵심 로직

### 5.1 LOT 해석 공용 헬퍼 — `lib/inventoryLot.ts` (신규)

```
resolveTxLotRows(tx, item) → { lotNo, quantity }[]
  · 시리얼 품목  : transaction_units → units.lot_no 로 그룹핑, LOT별 개수 산출
  · 비시리얼 품목: tx.lot_no 단일 행 (없으면 '')
  · 복수 LOT 전표는 LOT 수만큼 행으로 분해   ← 실측 5건 존재

getLotStock(itemIds, lotNo, inventoryIds?) → number
  · 시리얼 품목  : units where lot_no=X and status='IN_STOCK'
  · 비시리얼 품목: inventory_stocks where lot_no=X
```

제외 규칙: `canceled_at IS NOT NULL` 전표 제외 / `tx_type IN ('MOVE','TRANSFER')` 제외(결정 2).

**기존 `/api/inventory/items/[id]/lot-history`를 이 헬퍼로 교체**하여 §3.3 결함을 함께 해소한다.

### 5.2 대장 조립 — `lib/udiLedger.ts` (신규)

```
buildLedger({ deviceInfoId, lotNo, inventoryIds?, from?, to? })
  → { header, inRows[], outRows[], currentStock }
```

| 단계 | 처리 |
|---|---|
| 1 | `deviceInfoId` → 연결된 `inventory_items` 전체 수집 (인벤토리 합산 = 기본). `inventoryIds` 지정 시 제한 |
| 2 | 해당 품목들의 IN/OUT 전표 조회 (취소·MOVE 제외) |
| 3 | 각 전표를 `resolveTxLotRows`로 분해 → 지정 `lotNo`만 남김 |
| 4 | 정렬: `tx_date` asc → `id` asc |
| 5 | `currentStock = getLotStock(...)` |

행 매핑:

| 대장 컬럼 | 소스 |
|---|---|
| 입고/출고일자 | `tx.tx_date` (YYYY.MM.DD) |
| UDI | `device_info.udi_di` (미등록 시 공란) |
| 상품명 | `device_info.ledger_name` ?? `device_model` |
| LOT NO | 해석된 `lotNo` |
| 수량 | 분해된 `quantity` |
| 발송처/입고처정보 | `tx.destination` |
| 비고(출고) | `tx.note` |
| 동일 LOT 출고완료 | §8 미결 1 |

헤더 표: 모델명 = `ledger_name`, 품명 = `product_class`, 원자재식별 NO = `material_no ?? '-'`
하단: `현재고 {currentStock}개`

### 5.3 docx 생성 — `lib/udiLedgerDocx.ts` (신규)

**템플릿 자산**: `assets/templates/udi-ledger-F707-1.docx` (원본 docx를 데이터 행만 남기고 커밋)

| 단계 | 처리 |
|---|---|
| 1 | jszip으로 템플릿 로드 → `word/document.xml`·`header1.xml`·`footer1.xml` 추출 |
| 2 | 각 표의 **첫 데이터 행 `<w:tr>…</w:tr>` 문자열을 행 템플릿으로 확보** |
| 3 | 행 템플릿 내 `<w:t …>값</w:t>` 를 순서대로 치환 (셀당 1 run 검증 완료) → 데이터 수만큼 복제 |
| 4 | 출고 표는 원본 레이아웃 유지를 위해 **빈 행으로 24행까지 패딩** |
| 5 | 헤더 표·마지막 비고행·머리글·바닥글 치환 |
| 6 | zip 재패킹 → `Content-Disposition: attachment` 응답 |

구현 주의사항:
- 값은 **XML escape 필수** (`&`, `<`, `>`)
- 공백 보존을 위해 `<w:t xml:space="preserve">` 유지
- 중첩 표가 없으므로 `<w:tr>` 문자열 슬라이스가 안전 (§3.6 검증)
- **jszip을 직접 의존성으로 승격 필요** — 현재 `pptxgenjs`의 전이 의존성(3.10.1)으로만 설치되어 있어 그대로 쓰면 취약. `npm i jszip` (물리적으로 이미 설치되어 있어 신규 다운로드 없음)

---

## 6. 화면·API

### 6.1 대장 조회·출력 — `/inventory/ledger`
| 항목 | 내용 |
|---|---|
| 진입 | 자재관리 > 입출고대장 |
| 입력 | 모델(UDI 대상만) · LOT NO · 인벤토리 필터(옵션, 기본 전체) · 기간(옵션) |
| 표시 | 헤더 정보 + 입고/출고 표 미리보기 + 현재고 |
| 액션 | **docx 다운로드** |
| 권한 | ADMIN 이상 또는 재고 담당자(`canManageStock`) — 품질기록이므로 일반 조회보다 상향 |

### 6.2 API
| 메서드·경로 | 설명 |
|---|---|
| `GET /api/inventory/ledger` | 대장 데이터 조회 (모델·LOT·인벤토리·기간) |
| `GET /api/inventory/ledger/lots` | 선택 모델의 LOT 목록 + 잔량 (선택 UI용) |
| `GET /api/inventory/ledger/docx` | docx 생성·다운로드 |
| `GET·PUT /api/settings/udi-ledger` | 문서 메타(문서번호·개정이력) 조회·수정 |
| `GET·PUT /api/settings/devices/[id]` | 기존 라우트에 UDI 필드 추가 |

### 6.3 설정 화면 — `/settings/udi-ledger` (ADMIN 이상)
문서번호 · 양식번호 · 개정(rev) · 변경적용일 · 회사명 편집 + 개정 이력 테이블 관리(추가/삭제).
UDI 값 자체는 기존 **`/settings/devices`(장비 정보 관리)** 에 필드를 추가해 입력한다.

---

## 7. 개발 Phase

| Phase | 작업 | 산출물 |
|---|---|---|
| **P0** | jszip 직접 의존성 승격 · 원본 docx → 템플릿 자산 정리·커밋 | `assets/templates/` |
| **P1** | `device_info` UDI 필드 마이그레이션 + `/settings/devices` 입력 UI + 품목 연결 백필 | 마이그레이션 1건 |
| **P2** | IN 전표 발송처(`destination` 겸용) — 입고 모달·이력 화면·Excel export 라벨 | UI 변경 |
| **P3** | `lib/inventoryLot.ts` LOT 해석 헬퍼 + **기존 lot-history API 교체(결함 수정)** | 공용 로직 |
| **P4** | `lib/udiLedger.ts` + 조회 API + `/inventory/ledger` 화면 | 화면 1개 |
| **P5** | `lib/udiLedgerDocx.ts` + docx 다운로드 + `/settings/udi-ledger` 문서 메타 | 출력 기능 |

P3은 기존 결함 수정이므로 대장과 별개로 선행 착수해도 무방하다.

---

## 8. 미결 사항 (착수 전 확인 필요)

1. **"동일 LOT NO 제품 출고완료" 판정 규칙**
   원본 문서에서 195 입고 행에 '확인'이 있으나 해당 LOT 잔량은 129개다(전량 출고 아님). 즉 수기 문서의 '확인'은 계산값이 아니라 **담당자 판단 표기**로 보인다.
   - (a) 자동 — LOT 잔량 0이면 전 입고 행에 '확인'
   - (b) 수동 — 대장 화면에서 행별 체크
   - (c) 공란 출력 후 인쇄물에 수기 기입
   → 자동 계산은 기존 문서와 값이 달라질 수 있어 **사용자 확인 필요**

2. **UDI 대상 모델 확정** — 자사 제조 의료기기만 대상이다. MP100W·MC200M-T는 확실하나 센서(MP1000F/MP2000F/MP2000R)·게이트웨이(MGW1010)·`thynC시스템10`의 포함 여부, 전극(comFiX — 타사 제품)·배터리(CR2450)·에바폼의 제외 여부 확인 필요

3. **`device_info` 행 추가 시 기존 셀렉터 노출** — 병원 장비 배정 API가 `isActive` 필터 없이 전량 반환한다.
   - (a) 신규 행을 `is_active=false`로 추가 (대장은 무관하게 동작)
   - (b) 해당 API에 `isActive` 필터 추가 (기존 동작 변경)
   → 권장 (a)

4. **품명 구분·원자재식별 NO 입력 주체** — 완제품/반제품/원자재 구분과 원자재식별 NO는 자동 판정이 불가하여 마스터 수동 입력으로 설계했다. 입력 담당 확인 필요

5. **대장 표기명** — `ledger_name`에 넣을 값 확정 (예: `MP100W` → `MP100W Series`)

---

## 9. 착수 후 확정 (2026-08-04)

### 9-0. 설계 정정 — UDI는 모델이 아니라 품목 속성 ⚠️

최초 설계(§4.1)는 UDI-DI를 `device_info`(모델)에 뒀다. **폐기한다.**

| | 최초 설계 (폐기) | 확정 |
|---|---|---|
| UDI 저장 위치 | `device_info.udi_di` | **`inventory_items.udi_di`** (UNIQUE 아님 — 인벤토리별 품목이 같은 값 공유) |
| UDI 변경 시 | 모델 값 수정 | **신규 품목으로 등록** (인벤토리별로 각각) |
| 문서 1부 단위 | 모델 × LOT | **모델 1종** (내용은 UDI × LOT 행으로 구분) |
| 설정 진입점 | 설정 > 기기 관리 | **없음** — 기기 관리는 자재관리와 무관한 메뉴. 입력은 자재관리 > 품목 관리 |

**정정 근거**

1. **같은 모델이라도 사양·포장 변경으로 UDI-DI가 바뀔 수 있다.** 그때는 신규 품목으로 분리하는 편이 관리가 쉽다(사용자 판단).
2. **재고 차원이 이미 그 구조다.** `inventory_stocks` PK가 `(item_id, warehouse_id, inventory_id, lot_no)`이므로, UDI를 품목에 두면 재고가 곧 **UDI × LOT** 단위가 된다 — 재고 로직 변경 0.
   반대로 모델에 두고 한 품목이 복수 UDI를 담으면 재고 PK에 `udi` 차원을 추가해야 하고, 재고를 직접 다루는 파일 7개 + 입고·출고·이동·취소·일괄 처리 전 경로를 고쳐야 했다.
3. **규제 관점에서도 UDI-DI가 다르면 다른 기기 식별**이다. 재고·이력이 섞이지 않는 편이 옳다.

**부가정보 위치**: 대장 표기명·품명 구분·원자재식별 NO·포장단위도 **품목에 함께** 둔다(§8 미결 1 → 사용자 확정).
인벤토리별로 같은 값을 중복 입력하게 되지만 마스터 테이블을 늘리지 않는 쪽을 택했다.
값이 어긋나면 대장 화면이 경고하고, 문서에는 첫 번째 값이 쓰인다.

### 9-1. §8 미결 처리 결과

| # | 미결 | 확정 |
|---|---|---|
| 1 | 출고완료 판정 | **수동 체크**. `udi_ledger_checks(transaction_id, lot_no)` 신설, 대장 화면 체크박스. 자동 판정(잔량 0)은 원본 수기 대장과 값이 어긋나 미채택 |
| 2 | UDI 대상 | 품목 속성이므로 **별도 플래그 없음** — `udi_di` 값이 있으면 대장 대상. 등록된 5종: MC200M-T · MP100W · MP1000F · MP2000F · MP2000R (MGW1010은 UDI 미제공) |
| 3 | device_info 관련 | 전면 원복 — 추가했던 UDI 컬럼 6개·모델 4행 모두 제거 |
| 4 | 품명 구분·원자재식별 NO | 품목 수동 입력 (품목 관리 등록/수정 폼) |
| 5 | 대장 표기명 | `inventory_items.ledger_name` + 미입력 시 `model_name` → 품목명 폴백. 원본 양식 근거가 있는 MP100W만 `MP100W Series`·`완제품` 시드 |

### 9-2. 등록된 UDI-DI (2026-08-04 사용자 제공)

| 모델 | UDI-DI | 검증 |
|---|---|---|
| MC200M-T | `08800096401314` | GTIN 체크디지트 유효 |
| MP100W | `08800096401536` | 〃 |
| MP2000F | `08800096401642` | 〃 |
| MP2000R | `08800096401680` | 〃 |
| MP1000F | `8800096400508` | 〃 (13자리 — 나머지는 선행 0 붙은 14자리) |

- 전부 GS1 프리픽스 `8800096`으로 일관
- **원본 문서(MP100W(MP6414).docx)의 UDI `0880096401536`은 위 값과 다르다** — 선행 0을 떼면 12자리가 되어 나머지와 패턴이 어긋난다(문서 쪽 오기로 판단). 시스템은 사용자 제공 값을 사용
- MGW1010(게이트웨이)은 UDI 미제공 → 대장 대상 아님

### 구현 검증 (DEV 실데이터)

MP100W 대장 × 판매용재고 필터 — **입고 169 / 출고 40 / 현재고 129로 원본 문서와 일치**.
전체 인벤토리 합산 시 7개 LOT · 현재고 9,079로 UDI × LOT 소계가 정상 산출됨.
생성된 docx를 XML로 재파싱해 표 구조·머리글·바닥글 유효성 확인.

### 남은 작업

- MP100W 외 모델의 대장 표기명·품명 구분·원자재식별 NO 입력 (품목 관리 등록/수정 폼)
- MGW1010 UDI 확보 시 품목 3개에 입력
- MP1000F UDI 자릿수 통일 여부 결정 (13자리 → 14자리)
- PROD 배포 (마이그레이션 4건 `prisma migrate deploy`로 nav 메뉴까지 자동 반영)

---

## 10. 범위 밖

- 과거 이력 소급 입력 (결정 4 — 대장 시작점은 2026-07-01)
- 인벤토리 간 MOVE/이관의 대장 표시 (결정 2)
- 포장단위별 복수 UDI-DI (필요 시 자식 테이블로 확장, §4.1)
- 의료기기 통합정보시스템(공급내역보고) 연동 — 별건
- 바코드 스캔 (`function_wms.md`에서 이미 범위 밖으로 확정)
