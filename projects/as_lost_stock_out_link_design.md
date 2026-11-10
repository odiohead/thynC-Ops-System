# 분실 AS ↔ 출고업무 연동 설계안 — 분실 접수에서 [출고요청] → 출고 처리 시 AS 교체 자동 확정

> **상태**: dev2 구현·빌드 완료 (2026-11-10 — 스모크 32/32 · Playwright 화면 검증) — PROD 미반영 · 작성 2026-11-10
> 선행: `stock_out_v2_design.md`(출고 처리 코어·품목), `stock_out_sales_request_design.md`(영업 유형·판매용 재고·'분실기기 제공' 목적), `as_lost_found_design.md`(되찾음·분실 수량 정의), `as_receipt_design.md`(라인 결과·교체 확정)

---

## 1. 배경·정책 (2026-11-10 사용자)

- 고장 AS는 AS 도메인 안에서 처리가 끝나지만, **분실 AS의 기기 제공은 다른 부서가 출고업무로** 처리한다. 지금은 AS 담당자가 출고요청을 수동으로 만들고, 출고 후 AS 라인에 교체기 시리얼을 다시 손으로 적는다.
- 분실기기 제공은 **전부 판매용 재고**에서 나간다(출고 유형 판매용 · 목적 '분실기기 제공').
- 결정: **D1** 분실 접수 처리방법에서 '교체'(시리얼 직접 입력) 숨김 — 기기 제공 경로는 출고요청 하나 · **D2** 출고 시리얼의 모델이 분실 기기와 달라도 같은 기기군이면 허용(출고 품목은 실제 시리얼 기준 자동 보정) · **D3** 송장번호는 출고 완료 시점에 모르므로 AS 상세 발송정보에서 추후 수동 입력(출고 처리 카드에 송장 칸 없음).

## 2. 사용자 흐름

```
[분실 AS 상세 3. AS상세내역]  라인 체크 → 처리방법 '출고요청' → [저장]
      → 모달(희망 출고일·수령지·수취인·비고, 접수 발송지로 프리필) → [출고요청 생성]
      → 출고업무 티켓 SOR-… 생성(판매용·분실기기 제공·납품처=접수 병원), 라인에 '출고요청 SOR-… 대기' 배지·잠금
[출고업무 상세]  출고 처리 카드(AS 연동형)
      상단 본체: 접수 기기(심전계·산소포화도) 한 줄씩 → 출고 시리얼 1개 입력 → [확인]
      하단 센서류·부자재(선택): 판매용 노출 품목에서 [+ 품목 추가] → LOT 선택·수량(·시리얼 기록) → [확인]
      [출고 실행] → 재고 차감 + AS 라인 교체 확정(교체기 시리얼 자동 기입·분실 기기 회수·새 기기 병원 배치) + 요청 '완료'
[분실 AS 상세]  라인 결과 '교체', 교체기 열 채워짐, 발송일 = 출고일 → 송장은 발송정보에서 추후 입력
```

체크하지 않은 라인은 기존대로 '분실종결'·'라인취소'. 발송 전 되찾음은 라인 취소, 발송 후 되찾음은 [되찾음](`as_lost_found_design.md`) 그대로.

## 3. 데이터 모델 (public)

| 변경 | 내용 |
|---|---|
| `stock_out_requests.as_receipt_id INT NULL` | FK `as_receipts(id) ON DELETE SET NULL` + 인덱스. AS 연동 출고요청 표식(접수 1건에 요청 N건 가능 — 취소 후 재요청) |
| `as_receipt_items.stock_out_request_id INT NULL` | FK `stock_out_requests(id) ON DELETE SET NULL` + 인덱스. 라인 ↔ 요청 연결(대기 중 잠금 근거). 완료 후에도 남겨 추적 |
| 시리얼 매핑 | 별도 테이블 없음 — 완료 시 `as_receipt_items.new_serial_no / new_device_id / shipped_at / ship_method`에 기록(기존 교체 확정 컬럼) |
| 요청 품목 | `stock_out_request_items` 그대로. 생성 시 본체 **자리표시 품목**(§4.2), 출고 실행 시 실제 시리얼 품목으로 보정 + 센서류 라인 추가 |

마이그레이션 1건(`…_as_stock_out_link`): 컬럼 2 + 인덱스 2. CHECK 없음.

## 4. 기능 A — 분실 AS에서 출고요청 생성

### 4.1 화면 (AS 상세 3. AS상세내역, 분실 접수만)
- 처리방법 선택지: **출고요청** / 분실종결 / 라인취소 (교체 숨김 — D1. 고장 접수는 변화 없음). '출고요청'은 UI 전용 값이며 [저장]을 누르면 초안 저장 대신 **출고요청 모달**이 열린다.
- 모달 `AsStockOutRequestModal`: **대상 라인 체크리스트**(접수의 미종결·미잠금 라인 전부, 기기군별 묶음 — 카드에서 고른 라인은 미리 체크. 3. AS상세내역이 기기군 카드로 나뉘어 있어 심전계·산소포화도를 **한 번의 출고요청**으로 묶으려면 여기서 추가 체크, 2026-11-10 화면 검증 중 보완) · 희망 출고일(필수, 기본 오늘) · 수령지(접수 `destInfo` 프리필) · 수취인(접수 `reporterName` 프리필) · 비고(`AS ${asCode} 분실기기 제공 ${n}대` 프리필) → [출고요청 생성].
- 생성 후 라인에 **'출고요청 SOR-… · 요청/완료/취소' 배지**(링크) · 활성 요청에 묶인 라인은 체크박스 비활성(툴팁 '출고요청 SOR-… 처리 대기 — 취소하려면 출고요청을 취소하세요') · [최종확정] 대상에서 제외. 헤더 영역에 '연결 출고요청' 칩 목록.

### 4.2 서버 `POST /api/as-receipts/[id]/stock-out-request { itemIds, requestDate, shipAddress, recipient, note }` → `createStockOutForAsLines`
- 검증(400/409): 분실 접수 · 미종결 접수 · 라인 전부 이 접수의 **미종결(outcome NULL)** 라인 · 활성 요청에 이미 묶이지 않음 · 시리얼 형식 정상(`isValidAsSerial`) · 수령지·수취인·희망 출고일 필수.
- 본체 자리표시 품목: 라인을 기기군(`asDeviceGroupOf`)으로 접고, 기기군마다 **판매용 노출 품목**(`stock_out_item_purposes.purpose='SALES'` ∧ 시리얼 추적 device_info ∧ 같은 기기군) 중 분실 기기 모델과 같은 device_info 품목 → 없으면 그 기기군의 첫 노출 품목(정렬순)을 `quantity = 라인 수`로. 기기군에 노출 품목이 0이면 409 '설정 > 출고 품목 관리 > 판매용에 심전계/산소포화도 본체를 노출하세요'. '기타' 기기군 라인은 400.
- 출고요청 생성은 기존 `POST /api/stock-out-requests` 본문을 `lib/stockOutCreate.ts` `createStockOutRequest(input, actor, tx?)`로 추출해 **API 라우트와 AS 서비스가 같은 함수**를 쓴다(발번·티켓 생성·상태 '요청'·알림 호출 위치 동일). 입력: `purpose 'SALES'`, `subPurpose 'LOST_REPLACE'`, `destType 'HOSPITAL'`, `destHospitalCode = 접수 병원`, `asReceiptId`.
- 같은 트랜잭션: 라인 `stock_out_request_id` 세팅 · AS 비고 `[출고요청 YYYY-MM-DD 처리자] SOR-… 분실기기 제공 n대 (A123, A124 …)` · AS 티켓 이벤트 `link stock_out_requested` · 감사 `${asCode} 출고요청` · 출고 생성 알림(기존 STOCK_OUT_CREATED, 요청자 = AS 담당자).
- 권한: `canResolve`(VIEWER 제외, 미종결 접수) — 라인 처리와 동일 축.

## 5. 기능 B — 출고 처리 카드 AS 연동형

### 5.1 조회
`GET /api/stock-out-requests/[id]` 응답에 `asLink: { receipt: { id, asCode, hospitalName }, lines: [{ asItemId, lostSerialNo, deviceGroup, deviceName, wardName, newSerialNo(완료 후) }] }`(`as_receipt_id`가 있을 때). 목록·알림 머리줄에 `AS-…` 칩.

### 5.2 화면 (`FulfillCard` AS 모드 — `asLink`가 있으면)
- **본체** 섹션: 기기군별 묶음("심전계 2대 · 산소포화도 1대"), 줄마다 `분실 A123 → [출고 시리얼]`(1개, 형식 검사 즉시). 요청 품목 수량 입력 없음(라인 수가 수량).
- **센서류·부자재(선택)** 섹션: [+ 품목 추가] → 판매용 노출 품목 중 본체(시리얼 추적 device_info) 제외 목록에서 선택 → 수량 + 기존 LOT 행 UI(LOT 선택·수량·시리얼 기록) 또는 수량 모드. 비워도 실행 가능.
- 출고일 · 섹션별 [확인](서버 preview) · [출고 실행]. 기존 일반 모드 UI는 그대로(분기만 추가).

### 5.3 서버 — `FulfillInput` 확장·실행 (`lib/stockOutFulfill.ts`)
- 입력: `asLines: [{ asItemId, serial }]`, `extraLines: [{ inventoryItemId, quantity, lots?, serialsNote? }]`. 일반 `lines`와 배타(AS 모드에서는 무시).
- preview: 시리얼 → `inventory_units`(판매용 인벤토리 ∧ SALES 노출 품목 ∧ 시리얼 추적 device_info ∧ **같은 기기군**(D2) ∧ 재고 있음 ∧ 중복 없음) 판정, 라인별 메시지. 센서류는 기존 LOT/수량 판정 재사용.
- execute(단일 트랜잭션, 전량 일치):
  1. **요청 품목 보정** — 본체 자리표시 품목을 실제 시리얼이 가리키는 품목×수량으로 교체(`stock_out_request_items` upsert/삭제), 센서류 라인 추가.
  2. WMS OUT 전표 — 기존 로직(시리얼 품목 개체 OUT·창고 자동 그룹핑, LOT/수량 차감, `stock_out_request_id` 연결).
  3. **본체 기기현황 — 기존 `registerDevicesIn` 대신 AS 교체 확정** `resolveAsLinesIn(tx, receiptId, actor, { lines: [{ itemId: asItemId, outcome: 'REPLACE', newSerial }], effectiveDate: txDate, shipMethod: 'PARCEL' })` → `replaceDevice`가 분실 기기 RECOVER(사유 분실)·새 기기 REGISTER(관련 기기 연결·계약건/상품유형 승계)·라인 `outcome/new_serial_no/new_device_id/shipped_at/ship_method` 기록·'발송완료' 자동 전이(전 라인 종결 시)까지 수행. 새 기기 유닛은 WMS 출고 전(PRE_SHIP·창고) 상태에서 REGISTER 전이표로 사용중·병원 배치. `resolveAsLines`는 트랜잭션 주입형 `resolveAsLinesIn`으로 코어를 분리(기존 호출부는 래퍼 유지).
  4. 요청 `fulfilled_at`·상태 '완료'(티켓 CLOSED)·`syncStockOutToTicket` — 기존. AS 비고 `[출고 완료 YYYY-MM-DD 처리자] SOR-… : A123→B001, A124→B002 · 센서 MP2000F 3개`.
- 실패 시 전부 롤백(기존 all-or-nothing). 센서류만 있는 실행·본체 미입력은 400.
- 알림: 기존 STOCK_OUT_COMPLETED(요청자 = AS 담당자 태그) 그대로. 머리줄 '분실기기 제공 · AS-…'.

## 6. 취소·편집·가드

- **출고요청 취소**(상태 '취소'로 변경) 또는 **삭제** → 같은 트랜잭션에서 연결 라인 `stock_out_request_id = NULL`(잠금 해제, 재요청·분실종결 가능), AS 비고 `[출고요청 취소 …] SOR-…`. 완료된 요청은 취소·삭제 불가(기존 규칙).
- AS 연동 요청의 **품목 편집 비활성**(품목은 라인·출고 시리얼이 결정). 헤더(희망 출고일·수령지·수취인·비고·첨부)는 편집 가능. 수동 생성 요청은 변화 없음.
- 활성 요청에 묶인 AS 라인: 처리방법 변경·최종확정·라인 제거·시리얼 보정·**접수 분할 이동**·접수 삭제 → 409 '출고요청 SOR-… 처리 대기 중 — 먼저 출고요청을 취소하세요'.
- AS 라인이 이미 결과 확정됐는데 출고 실행이 오면(경합) → 409.

## 7. 변경 범위

| 구분 | 파일 | 내용 |
|---|---|---|
| DB | `prisma/migrations/…_as_stock_out_link/migration.sql` | 컬럼 2·인덱스 2 |
| 스키마 | `prisma/schema.prisma` | StockOutRequest.asReceiptId(+관계) · AsReceiptItem.stockOutRequestId(+관계) |
| 생성 공용 | `lib/stockOutCreate.ts`(신규) · `app/api/stock-out-requests/route.ts` | 생성 로직 추출·라우트는 호출만 |
| AS 서비스 | `lib/asReceiptService.ts` | `createStockOutForAsLines`, `resolveAsLinesIn`(tx 주입 코어), 활성 요청 잠금 가드(초안·확정·제거·보정·분할·삭제), 취소 시 해제 헬퍼 |
| AS API | `app/api/as-receipts/[id]/stock-out-request/route.ts`(신규 POST) · `[id]/route.ts`(GET `stockOutLinks`) · `timeline`(접미어 '출고요청') | |
| 출고 코어 | `lib/stockOutFulfill.ts` | `asLines`·`extraLines` 입력, preview 판정, 품목 보정, 교체 확정 호출 |
| 출고 API | `app/api/stock-out-requests/[id]/route.ts` | GET `asLink`, PUT 상태 '취소'·DELETE 시 라인 해제, AS 연동 품목 편집 400 · `[id]/fulfill/route.ts` 입력 전달 |
| 공용 | `lib/asReceiptShared.ts` | `asResolveOutcomesFor(LOST)`에서 REPLACE 제외(UI), 출고요청 UI 값 상수 · `lib/stockOutShared.ts` 본체/센서 판정 헬퍼 |
| 화면 | `app/as-receipts/[id]/page.tsx` + `_components/AsStockOutRequestModal.tsx`(신규) · `app/stock-out-requests/_components/FulfillCard.tsx`(AS 모드) · `[id]/page.tsx`(AS 칩·품목 편집 비활성) · `app/stock-out-requests/page.tsx`(AS 칩) | |
| 알림 | `lib/stockOutNotify.ts` | 머리줄에 AS 코드 |
| 문서 | README(스키마·API·기능·디렉토리) · DEV_HISTORY · projects/README | |

작업량 **중~대형(2일)**. 스모크: 분실 접수 3라인(심전 2·산소 1) → 2라인 출고요청(자리표시 품목·링크·잠금·비고) → 잠긴 라인 초안 409 → 출고 실행(본체 2 시리얼 + 센서 LOT 1) → WMS 전표·AS 라인 REPLACE·교체기·발송일·원장(분실 회수·새 기기 배치)·요청 완료·분실 수량 +2 → 취소 시 해제 경로 → 모델 다른 시리얼 허용·다른 기기군 거부·중복 거부. Playwright: AS 상세 '출고요청' 선택→모달→배지, 출고 상세 AS 모드 카드 입력→실행→AS 교체기 열.

## 8. 결정 사항 (D)

- **D1** 분실 접수 처리방법에서 '교체' 숨김(UI). 서버는 출고 실행 경로·과거 데이터 호환을 위해 REPLACE를 계속 받는다.
- **D2** 출고 시리얼은 같은 기기군이면 모델이 달라도 허용. 요청 품목은 실제 시리얼 기준으로 자동 보정.
- **D3** 송장번호는 AS 상세 발송정보에서 추후 수동 입력. 출고 처리 카드에 송장 칸 없음. 출고 실행 시 발송일 = 출고일·방법 = 택배로 기록.
- **D4** 센서류는 자재담당자가 출고 시점에 선택(필수 아님). 요청 생성 시 센서 품목은 넣지 않는다.
- **D5** 출고요청 생성 입력은 희망 출고일·수령지·수취인·비고 4개(접수 정보 프리필).
- **D6** 요청 취소·삭제 시 라인 잠금 해제·재요청 가능. 활성 요청 라인은 AS 쪽 변경 전부 409.
