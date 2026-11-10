# 분실기기 되찾음 처리 + 분실 제공 수량 표기 통일 설계안

> **상태**: 완료 — PROD 배포 2026-11-10 (a969559, 마이그 적용). 결정: D1 숨김 · D2 즉시 회수 · D3 outcome FOUND · §4 단일 정의 · 작성 2026-11-09
> 선행: `as_receipt_design.md`(라인 결과·원장 연동), `lib/asLostQuota.ts`(분실 10% 한도), `hospital_device_registry_design.md`(기기 상태 전이표)

---

## 1. 배경 — PROD 실측 (2026-11-09)

- 분실 제공 한도의 분자 = "취소가 아닌 분실 접수의 교체 확정 라인 수"(`AS_LOST_PROVIDED_OUTCOMES` = REPLACE·REPAIR_RETURN). **기기현황은 보지 않는다.**
- 되찾은 기기를 되돌릴 경로가 **접수 취소**뿐이다. 리오픈은 헤더만 되돌리고 확정 라인은 변경 불가(409), 기기현황 관리자 보정은 AS 라인에 쓰지 않는다 → 둘 다 집계 불변.
- 원장 가동(9-02) 이후 분실 교체 확정 59대 중 1대(분당제생 A117497, AS-202611-0026)가 되찾아 재접수됐으나 원 접수의 교체 1대는 그대로 집계.
- 병원 상세 'AS 현황 > 분실' 블록(확정만)과 AS 상세 '구분' 필드("이전 → 처리 후", 미종결 라인을 교체 예정으로 가산)가 다른 숫자를 보여 혼동 (더자인 0 vs 0→5, 문산중앙 2 vs 2→4).

## 2. 정책 (2026-11-09 사용자 확정)

| 되찾은 시점 | 처리 | 비고 |
|---|---|---|
| **교체기기 발송 전** (라인 미종결) | 기존 **라인 취소**로 종결 | 기능 추가 없음. 기기는 사용중 복귀(현행) |
| **교체기기 발송 후** (라인 교체 확정) | **되찾은 기기를 병원이 계속 사용, 교체기기는 회수** | 병원에 2대를 두지 않는다. 교체 제공은 무효 → 분실 한도 분자에서 제외 |

"교체기기를 쓰게 하고 분실기기를 회수"하는 분기는 정책상 없다 → 기능은 분기 선택 없이 **되찾음 1종**.

## 3. 기능 A — 라인 [되찾음]

### 3.1 대상·권한
- 접수 구분 **분실**, 라인 결과 **교체(REPLACE)** 확정 라인. (수리반환으로 분류된 마이그 라인은 D1 참조)
- 권한: 접수 수정 권한(`canEditAsReceipt`). 접수가 완료 상태여도 가능(선교체 사후 입고와 같은 예외 — 헤더는 손대지 않음).

### 3.2 데이터
- `as_receipt_items.outcome` CHECK에 **`FOUND`('되찾음')** 추가. 되찾음 처리 시 `REPLACE → FOUND`. 교체 이력(`new_serial_no`·`new_device_id`·발송 송장·발송일)은 **그대로 보존**(어떤 기기가 나갔다가 돌아왔는지 추적).
- 신규 컬럼: `found_at DATE`(되찾은 날, 기본 오늘 KST), `found_by_id`, `recall_tracking_no VARCHAR(50)`(교체기기 회수 송장, 선택), `recall_received_at DATE`(교체기기 센터 입고일, 선택 — 사후 기입).
- `AS_LOST_PROVIDED_OUTCOMES`는 변경 없음 → FOUND는 자동으로 한도 분자에서 빠진다(`computeAsLostQuota`·병원 블록 동시 반영, 코드 수정 없음).
- `AS_REPAIR_EXCLUDED_OUTCOMES`(수리완료 3택 대상 제외)에 FOUND 추가 — 되찾은 기기는 회수기기가 아니다.

### 3.3 원장 (한 트랜잭션, 실패 시 전체 중단)
1. **되찾은 기기**(`device_id`, condition LOST·위치 없음): 전이표 LOST 행은 `REGISTER → IN_USE`만 허용 → 기존 **재배치 등록 경로**(`registerDevicesIn`, AS 원장확정의 `reregistered`와 동일)로 접수 병원에 ACTIVE 배치. 병동 = 모달 입력(기본: 라인 `placementWard ?? wardName`). 계약건·상품유형은 **교체 시 신 배치가 상속했던 값**을 그대로 승계. 이벤트 ref = 이 접수, memo `되찾음 ${asCode}`.
2. **교체기기**(`new_device_id`, 접수 병원 ACTIVE): `recoverDevice` 사유 **RETURN(반품)**, `related_device_id` = 되찾은 기기, ref = 이 접수. 위치는 RETURN 규칙대로 센터. (D2: 되찾음 시점에 즉시 회수 기록 — 회수 송장·입고일은 정보 필드)
3. 교체기기가 이미 다른 병원 ACTIVE·폐기 등 "이 접수가 소유하지 않은 상태"면 409로 막고 사유 안내(`ownsDeviceState` 게이트 재사용).

### 3.4 접수·티켓·알림
- 라인 비고 이력 `[되찾음 YYYY-MM-DD 처리자] 교체기기 B 회수(반품), 분실기기 A 사용중 복귀 · 송장 …`. 헤더 상태 불변(완료면 완료 유지 — 모든 라인이 종결값).
- 감사 로그 `UPDATE` resourceLabel `${asCode} 되찾음`, 타임라인 항목 '분실기기 되찾음 (A → 사용중, B 회수)'. Slack은 `notifyTicketChanged`(코멘트성) 1회 — 도메인 이벤트 신설 없음.
- 채널톡 시트 역기입: 영향 없음(헤더 상태 기준).

### 3.5 화면 (AS 상세)
- 분실 접수의 교체 확정 라인에 **[되찾음]** 소형 버튼. 모달: 되찾은 날짜 · 복귀 병동(기본 원래 병동) · 교체기기 회수 송장(선택) · 메모. 요약문 "A123 → 사용중 복귀 · 교체기기 B456 회수(반품) · 분실 제공 −1대" 확인 후 실행.
- 라인 배지 '되찾음'(회색), 교체기기 시리얼은 취소선 + 툴팁 '회수(반품) MM-DD'. 처리 후 '구분' 필드의 한도 숫자가 즉시 갱신.
- 목록 처리 요약(`summarizeAsItemsBy*`)에 되찾음 포함(종결 라인).

## 4. 기능 B — 분실 수량 단일 정의 (2026-11-09 사용자 지시: 병원 화면과 AS업무가 같은 병원이면 **같은 숫자**)

- **단일 정의**: 분실 수량 = 그 병원의 취소 아닌 분실 접수에서 **교체 확정된 라인 수 − 되찾음 라인 수** (= `outcome IN (REPLACE, REPAIR_RETURN)`; FOUND는 outcome이 바뀌므로 자동 제외). 미종결 라인은 포함하지 않는다. 산출은 `computeAsLostQuota` 한 함수만 쓰고, **현재 접수를 빼는 분기(`r.id <> receipt.id`)를 없앤다.**
- **병원 상세 블록**: `n / 구매 p (%)` — 정의 그대로. 변경 없음(이미 모든 접수 기준).
- **AS 상세 '구분' 필드**: 주 숫자를 **병원 블록과 동일한 n / p (%)** 로 표기(이 접수의 확정 라인 포함). 이 접수에 미종결 라인이 있을 때만 보조 문구로 `이 접수 미종결 k대 처리 시 n+k (%)`를 작은 글씨로 덧붙이고, 한도 초과 경고(빨간 테두리)는 종전대로 n+k 기준으로도 판정한다(처리 전 경고 목적).
- **되찾음 반영**: [되찾음] 실행 즉시 n이 1 감소하며, 같은 함수를 쓰므로 두 화면이 동시에 같은 값을 보인다.
- 목록(`/as-receipts`)에는 분실 수량 표기가 없다 — 추가하지 않는다.

## 5. 변경 범위

| 구분 | 파일 | 내용 |
|---|---|---|
| DB | `prisma/migrations/…_as_item_found/migration.sql` | outcome CHECK `FOUND` 추가, `found_at`·`found_by_id`·`recall_tracking_no`·`recall_received_at` |
| 스키마 | `prisma/schema.prisma` AsReceiptItem | 필드 4개 + `foundBy` 관계 |
| 공용 | `lib/asReceiptShared.ts` | `AS_OUTCOMES`·라벨·배지에 FOUND, `AS_REPAIR_EXCLUDED_OUTCOMES`, 요약 함수 |
| 서비스 | `lib/asReceiptService.ts` | `markAsLineFound(receiptId, actor, {itemId, foundAt, wardName, recallTrackingNo, memo})` — 3.3 원장 2단계 + 라인·비고 |
| API | `app/api/as-receipts/[id]/found/route.ts`(신규 POST) | 권한·감사·타임라인·알림 |
| 타임라인 | `app/api/as-receipts/[id]/timeline/route.ts` | suffix '되찾음' |
| 한도 | `lib/asLostQuota.ts`, `lib/asReceiptShared.ts`(AsLostQuota 타입) | B — 현재 접수 제외 분기 제거, `thisOpen`(미종결 k) 보조값 |
| 화면 | `app/as-receipts/[id]/page.tsx`(+ `AsFoundModal.tsx` 신규), `app/hospitals/[code]/_components/HospitalAsSummary.tsx` | A 버튼·모달·배지, B 표기 |
| 문서 | README(스키마·API·기능), DEV_HISTORY, projects/README | |

작업량 중형(1일). 스모크: 분실 접수 생성 → 교체 확정(원장 2대) → 되찾음 → 한도 −1, 되찾은 기기 IN_USE·ACTIVE·원 병동, 교체기기 RECOVER(RETURN)·센터, 재되찾음 400, 고장 접수 400, 소유 아닌 교체기기 409. Playwright: 버튼 노출 조건·모달·배지, 되찾음 전후 **AS 상세 '구분' 숫자 = 병원 블록 숫자** 대조.

## 6. 결정 필요 (D)

- **D1 마이그 라인**: thynC 이력 IMPORT 분실 라인은 "교체기기 = 분실기기 시리얼 라벨 승계"라 `new_device_id`가 없거나 같은 기기다. 되찾음 버튼을 **숨김**(원장 2대 처리가 불가능) — 필요하면 접수 취소로 처리. 추천: 숨김.
- **D2 교체기기 회수 시점**: 되찾음 처리 시 **즉시 RECOVER(RETURN)** 기록(추천 — 별도 수거·입고 파이프라인 신설 회피, 회수 송장·입고일은 정보 필드) vs 회수 입고 확인 시 RECOVER(2단계, 미회수 추적 정확하나 새 큐 필요).
- **D3 결과값**: outcome `FOUND` 신설(추천 — 집계·목록·타임라인이 모두 outcome 축이라 자연스럽다) vs REPLACE 유지 + `found_at` 플래그(한도 산식 수정 필요, 목록 요약에 '교체'로 남아 혼동).
- ~~D4~~ **확정 (2026-11-09)**: 두 화면의 분실 수량은 같은 정의·같은 함수로 **동일 숫자**. 되찾음은 즉시 감소. (§4)
