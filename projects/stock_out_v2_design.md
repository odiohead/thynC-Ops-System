# 출고업무 v2 — 품목 소스를 자재관리(WMS) 품목으로 전환 + 업무별 노출 설정

> 상태: **dev2 구현 완료 (2026-11-01, 빌드·PROD 미반영)** — 2026-11-01 승인, 관리자 화면은 체크박스 3열에서 업무 탭으로 개정. 1.0 출고업무 설계(`stock_out_request_design.md`)의 품목 마스터(§4.1·결정 1)와 출고 처리 출고유형(§13)을 대체한다.

## 1. 배경·목표
- 출고요청은 두 갈래 — ① 구축 프로젝트 자재출고 ② 영업·사업·유지보수 측면의 비주기 자재출고. 업무에 따라 **나가야 할 인벤토리(창고)가 다르다**.
- 현행은 출고 전용 품목 마스터(`stock_out_items` 12종, 오늘 17종)를 따로 두고 `wms_model_name`으로 자재관리 품목을 해석 → 마스터 이중 관리, 라이트 품목처럼 WMS에 이미 있는 품목(`L-MC200M-T` 등 4종)을 또 등록해야 하는 구조.
- 목표: **품목 소스 = 자재관리 품목(`inventory_items`, 인벤토리×품목 행)** 하나로 통일하고, 관리자 화면에서 **업무 탭(구축 / 유지보수 / 사업업무)** 마다 전체 품목을 보여 주고 행별 '노출' 체크로 "어느 업무의 출고요청에 노출할지"를 제어한다. 체크 = "이 업무는 이 인벤토리에서 이 품목을 출고". (2026-11-01 개정 — 체크박스 3열은 업무가 늘면 표가 옆으로 길어져 탭으로 변경)

## 2. 확정 결정 (2026-11-01 사용자 답변)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 체크 단위 | **인벤토리×품목 행 단위** (같은 MP100W라도 대웅제약재고·판매용재고 행은 별개) |
| 2 | 출고 처리 출고유형 | **품목의 인벤토리로 자동 결정** — 처리 화면의 출고유형(판매(대웅)/판매(자체)/DEMO) 선택 제거 |
| 3 | 기존 품목 마스터 | **폐기** — `stock_out_items` 삭제, 요청 라인은 WMS 품목 FK로 이관. 요청 폼 그룹은 자재관리 품목 분류(`inventory_categories`) 사용 |
| 4 | 이번 범위 | **구축(프로젝트) 요청 흐름 + 관리자 탭 3종(구축·유지보수·사업업무)**. 사업업무·유지보수 요청의 진입점·연결 대상은 다음 단계(탭 설정은 그때 참조) |
| 5 | 관리자 화면 구조 | **업무 탭** — 탭 순서 구축(1순위) → 유지보수 → 사업업무, 각 탭에 전체 활성 품목 + '노출' 체크 1열. 업무가 늘면 탭만 추가 |

## 3. 명명
- 업무 구분 `purpose`: `BUILD` 구축 / `MAINTENANCE` 유지보수 / `BUSINESS` 사업업무 (탭 순서) — 어휘·라벨은 `lib/stockOutShared.ts` 단일 소스(`STOCK_OUT_PURPOSES`)
- 노출 설정 테이블: `stock_out_item_purposes` (행 존재 = 체크)
- 화면 라벨: 설정 메뉴 '출고 품목 관리' 유지(경로 `/settings/stock-out-items` 유지), 화면 제목 '출고 품목 노출 설정'

## 4. 데이터 모델 (public)

### 4.1 신규 `stock_out_item_purposes`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| inventory_item_id | INT FK `inventory_items(id)` ON DELETE CASCADE | 자재관리 품목 행 |
| purpose | VARCHAR(16) CHECK (`BUILD`,`BUSINESS`,`MAINTENANCE`) | |
| created_at | timestamptz | |
| PK (inventory_item_id, purpose) | | 체크박스 토글 = INSERT / DELETE |

### 4.2 `stock_out_requests` 변경
- `purpose VARCHAR(16) NOT NULL DEFAULT 'BUILD'` CHECK 동일 어휘. 이번 범위에선 프로젝트 팝업이 항상 BUILD로 생성. `project_code`는 그대로 NOT NULL(사업업무·유지보수 편입 시 nullable화는 그 설계에서)

### 4.3 `stock_out_request_items` 변경
- `item_id`(→ `stock_out_items`) 제거, `inventory_item_id INT NOT NULL FK inventory_items(id)` 추가, UNIQUE (request_id, inventory_item_id)
- 백필: 기존 라인의 `stock_out_items.wms_model_name`을 **대웅제약재고**의 같은 `model_name` 품목으로 매핑(현재 PROD 요청 1건 SOR-202609-0001 라인 5개 — 시스템30·MGW1010·MC200M-T·MP100W·MP1000F 전부 대웅제약재고에 존재, 처리 전표도 대웅제약재고). 매핑 실패 행이 있으면 마이그레이션 중단(수동 확인)

### 4.4 삭제
- `stock_out_items` DROP (오늘 추가한 그룹 2종·라이트 5종 포함 — 라이트는 WMS `L-*` 품목으로 대체). 시드 `scripts/seed-stock-out-masters.sql`에서 품목 섹션 제거 → **노출 초기값 시드**로 교체(§9)

## 5. 출고 처리(fulfill) 변경 — `lib/stockOutFulfill.ts`
- 입력에서 `outType` 제거. 라인마다 WMS 품목이 확정돼 있으므로 **인벤토리 = 품목 행의 inventory**. 한 요청에 인벤토리가 2개 이상이면 **인벤토리별 전표 1건씩** 생성(지금은 요청당 전표 1건)
- 전표 출고 유형(`STOCK_OUT_TYPE`)·기기현황 용도(`DEVICE_USAGE_TYPE`)는 **인벤토리명 기준 매핑** `INVENTORY_OUT_META`(코드 단일 소스, `OUT_TYPE_META` 대체) — 검토 포인트 §10-①:
  - 대웅제약재고 → 판매 / 판매용 · 판매용재고 → 판매 / 판매용 · 평가용재고 → 영업 / 평가용 · 오산영업소 → 영업 / 평가용 · thynC운영팀재고 → 기타 / 판매용 · 그 외 → 기타 / 판매용
- 기기현황 등록 대상 판정: 현행 `itemGroup === 'WEARABLE'` → **WMS 품목의 `device_info` 연결 + 시리얼 추적(`serialTracked`)** 으로 대체(품목 행이 이미 `device_info_id`를 가짐 — MC200M-T·MP100W·L-* 본체가 해당, MGW1010은 device_info 미연결이라 자연히 제외)
- 라인 모드(serial / lot / qty)·버킷·시리얼 검증·타 병원 배치 차단·전량 일치 단일 트랜잭션은 그대로

## 6. API
| Method | Endpoint | 변경 |
|---|---|---|
| GET | `/api/settings/stock-out-items` | **WMS 품목 전체(활성) + 체크 상태** 반환: `{ inventories: [{ id, name, items: [{ id, itemCode, name, modelName, category, isSerialManaged, stockTotal, purposes: ['BUILD', ...] }] }] }`. `?purpose=BUILD` 지정 시 **그 업무에 체크된 품목만**(요청 폼용, 로그인 전원) |
| PUT | `/api/settings/stock-out-items/[inventoryItemId]` | body `{ purpose, enabled }` 토글 (ADMIN). 기존 POST/DELETE(마스터 CRUD)·PUT(이름/그룹 수정) 제거 |
| POST/PUT | `/api/stock-out-requests`, `[id]` | 라인 `{ inventoryItemId, quantity }`. 생성 시 `purpose`(BUILD 고정) 체크 품목만 허용(400). 수정 시 이미 담긴 라인은 체크 해제돼도 유지(현행 비활성 품목 처리와 동일) |
| POST | `/api/stock-out-requests/[id]/fulfill` | body에서 `outType` 제거. 미리보기 응답에 인벤토리별 그룹·전표 유형·용도 표시 |

## 7. 화면
- **설정 > 출고 품목 관리** (`app/settings/stock-out-items/page.tsx` 교체): 상단 **업무 탭** [구축 | 유지보수 | 사업업무](탭 라벨에 체크 수). 탭 안은 인벤토리별 섹션 → 표 [노출 ☐ | 품목코드 | 품목명 | 모델 | 분류 | 시리얼 | 현재고]. 체크 즉시 저장(낙관적 갱신, 실패 시 되돌림), 인벤토리 섹션 헤더에 '전체 선택/해제'. 비활성 WMS 품목은 표시하지 않음(체크는 남아 있어도 요청 폼에 안 나옴). URL `?tab=BUILD`로 탭 유지
- **프로젝트 상세 출고요청 팝업** (`StockOutRequestFormModal`): `?purpose=BUILD` 품목을 **인벤토리 → 분류** 순으로 섹션 표시, 행 = 품목명(모델) + 현재고 + 수량 입력. 체크된 품목이 0이면 "설정 > 출고 품목 관리에서 구축 품목을 지정하세요" 안내
- **출고요청 상세·목록**: 라인 표기 `품목명 (모델) · 인벤토리`. FulfillCard에서 출고유형 버튼 3개 제거 → 바로 미리보기, 인벤토리별 소계 표시
- 티켓 제목·요약(`summarizeStockOutItems`)은 WMS 품목명 사용

## 8. 코드 영향
`lib/stockOutShared.ts`(PURPOSES 추가, OUT_TYPE_META → INVENTORY_OUT_META, 품목 그룹 상수 삭제) · `lib/stockOut.ts` · `lib/stockOutFulfill.ts` · `lib/ticket-domains/stockOut.ts` · `app/api/settings/stock-out-items/**` · `app/api/stock-out-requests/**` · `app/settings/stock-out-items/page.tsx` · `app/stock-out-requests/**`(목록·상세·FormModal·FulfillCard) · `app/projects/[code]/page.tsx`(이력 행 품목 표기) · `prisma/schema.prisma` · 시드 · README·DEV_HISTORY

## 9. 마이그레이션·시드 (절대 규칙 1)
1. `stock_out_item_purposes` 생성 · `stock_out_requests.purpose` 추가
2. `stock_out_request_items.inventory_item_id` 추가 → 백필(§4.3, 실패 시 RAISE) → NOT NULL · FK · UNIQUE, `item_id` 제거
3. `stock_out_items` DROP
4. **노출 초기값 시드**(`seed-stock-out-masters.sql` 품목 섹션 교체, 멱등): 구축(BUILD) = 대웅제약재고의 현 마스터 대응 모델 10종(thynC시스템 10~100·MGW1010·MC200M-T·MP100W·MP1000F) + L-* 4종. 사업업무·유지보수는 비워 두고 관리자가 지정 — 검토 포인트 §10-②

## 10. 검토 포인트 (승인 전 확인)
① 인벤토리별 전표 유형·기기 용도 매핑(§5) — 특히 thynC운영팀재고(유지보수 자재)를 '기타/판매용'으로 둘지
② 초기 구축 체크 범위(§9-4) — 대웅제약재고 14종 제안. 32/65inch 대시보드·MT100D 2종은 제외했는데 포함할지
③ 요청 폼 섹션 순서 — 인벤토리 → 분류(제안) vs 분류만(인벤토리는 행 뒤에 작게)
④ 오늘 추가한 그룹 2종·라이트 5종은 이 전환으로 사라짐(전자제품·기타는 자재관리 분류로 이미 존재) — 이대로 진행해도 되는지

2026-11-01 구현 착수 시 ①~④는 제안값으로 진행(사용자: '전체 품목 노출' 동의, 화면은 탭으로 개정 지시). 변경 요청 시 설정 화면·상수에서 조정

## 11. 구현 순서·검증
1. 마이그레이션(dev2) + Prisma 모델 → 2. 공용 상수·API → 3. 설정 화면 → 4. 요청 폼·상세·목록·티켓 요약 → 5. fulfill 재작성 + FulfillCard → 6. 스모크 `scripts/stock-out-smoke.mts`·`stock-out-fulfill-smoke.mts` 갱신 → 7. Playwright: 설정 체크 토글 → 프로젝트 팝업 품목 반영 → 요청 생성 → 출고 처리(인벤토리 2개 섞인 요청 포함) → 전표·재고·기기현황 확인
PROD 반영 시: 마이그 백필 대상 1건 사전 확인, 시드 재실행, 협업 서버 무관

## 12. 구현 기록 (2026-11-01)
- 마이그 `20261101160000_stock_out_v2_wms_items`: `stock_out_item_purposes` 생성 · `stock_out_requests.purpose` · 라인 `inventory_item_id` 백필(PROD 1건 라인 5개 → 대웅제약재고 동일 모델, 실패 시 RAISE)·`item_id` 제거 · `stock_out_items` DROP (같은 날 오전 추가한 그룹 2종·라이트 5종도 함께 소멸)
- 검증 함수는 route 파일 export 불가(Next 타입 검사)라 `lib/stockOut.validateStockOutLines`로 배치. 기존 라인은 노출 해제돼도 유지(keepIds)
- 스모크: `scripts/stock-out-smoke.mts` 31/31 · `scripts/stock-out-fulfill-smoke.mts` 23/23 — 후자는 판매용재고(시리얼·LOT) + 대웅제약재고(수량) 혼합 요청으로 인벤토리 자동 해석 검증
- 검토 포인트 ①~④는 제안값 적용. tsc는 `NODE_OPTIONS=--max-old-space-size=4096` 필요(기본 힙에서 OOM)

## 13. 구성 안내 — 'thynC 시스템 XX' 부자재 포함 수량 (2026-11-01 추가)
- 요구: 대웅제약재고 'thynC 시스템 10/20/30/40/50/100'은 thynC운영팀재고 품목(서버·매니저PC·27인치 모니터·50인치 사이니지)으로 구성된다. 관리는 따로 하되, 요청 팝업에서 시스템 수량을 적으면 운영팀재고 품목 행에 "이미 n개 포함"을 알려 줄 것. 기존 현재고 표시는 제거
- WMS `inventory_item_components`는 같은 인벤토리끼리만 허용(API 409)·대량 출고 로직이 참조하므로 쓰지 않고, 안내 전용 테이블 `stock_out_item_components`(parent 대웅 시스템 품목 → child 운영팀 품목, quantity) 신설. 시드 `scripts/seed-stock-out-components.sql`(멱등 upsert)
- 화면: 설정 GET이 품목별 `components`를 내려주고, 팝업이 입력 수량 × 구성 수량을 child별로 합산해 입력란 왼쪽에 **'포함 n'** 배지(툴팁 = 출처별 수량). 안내일 뿐 요청 라인은 사용자가 적은 수량만 생성 — 부자재 행이 '구축' 탭에 노출돼 있어야 배지가 보인다
- 시스템 100의 서버는 **서버(100병상)**(2026-11-01 사용자 정정 — 최초 구성표의 워크스테이션 표기는 오기). 구성 변경 UI는 §14(같은 날 추가)

## 14. '구성 안내' 탭 (2026-11-01 추가 — 사용자 질문 "별도 설정화면으로 빼는 건?" → 찬성·착수)
- 위치: 설정 > 출고 품목 관리의 업무 탭 옆 **[구성 안내]** 탭(`?tab=COMPONENTS`). 출고요청 팝업 관련 설정을 한 화면에 모음
- 화면: 좌측 주 품목 목록(구성 행이 있는 품목, 인벤토리 표기·구성품 수) + 하단 [+ 주 품목 추가] 선택(어떤 활성 자재관리 품목이든) / 우측 선택 주 품목의 구성품 표 [인벤토리 | 구성품 | 모델 | 1개당 포함 수량(blur·Enter 저장) | 삭제] + 하단 구성품 선택·수량·[+ 구성품 추가] + [구성 전체 삭제]. ADMIN만 편집(VIEWER·USER 열람)
- API `app/api/settings/stock-out-components/route.ts`: GET(주 품목별 그룹) · PUT 업서트(parent≠child, qty≥1, **1단계 깊이** — 구성품이 주 품목이거나 주 품목이 다른 구성의 구성품이면 409) · DELETE(행 또는 주 품목 전체). 감사 로그 `setting:stock_out_item_component`
- WMS 품목 상세의 부자재 구성(같은 인벤토리 한정·대량 출고가 참조)과 별개인 이유는 §13 그대로. 행이 없는 주 품목은 존재하지 않음(첫 구성품을 넣어야 저장됨 — 화면 안내 문구)
