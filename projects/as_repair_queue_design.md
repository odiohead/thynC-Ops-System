# AS 수리대기 큐 (AS담당자 화면) — 설계안

> **상태: 구현 완료 (dev2, 2026-09-28) — 사용자 화면 검토 후 수정 예정, PROD 배포 대기** (추천안 §8 A~F 전건 채택)
> 상위 문서: `as_work_design.md`(AS업무 본체), `device_condition_location_design.md`(기기 상태·위치 축)

---

## 1. 배경·요청 (2026-09-28 사용자)

- 기기 수리를 담당하는 **AS담당자**는 "지금 센터에 들어와 있어서 내가 고쳐야 하는 기기"와 "곧 들어올 기기"를 알아야 하는데, 현재 `/as-receipts`는 **접수(병원) 단위** 목록이라 기기 단위로 보기 어렵다.
- 요청 사항
  1. 입고 완료됐지만 수리 전인 기기 — 수량 + 리스트
  2. 접수돼서 입고 예정인 기기 — 수량 + 리스트
  3. 별도 탭 → 별도 페이지
  4. 그 페이지에서 수리처리·교체처리 등 기기 상태 변경 가능
  5. 심전계·산소포화도 따로 보기

## 2. 결론 요약 (추천안)

| 항목 | 추천 |
|---|---|
| 화면 | 신규 페이지 **`/as-receipts/queue`** ("수리대기"). `/as-receipts` 상단에 탭 스트립 `접수 목록 | 수리대기` 추가(양쪽 페이지 공통). nav 신규 행 없음 |
| 단위 | **라인(`as_receipt_items`) 1행 = 기기 1대** (접수 단위 아님) |
| 버킷 | 서브탭 2개 **수리 대기 · 입고 예정** (+ 헤더에 건수). 3번째 버킷 '수리완료·발송 대기'는 v1 제외(§9) |
| 기기군 | 세그먼트 **심전계 / 산소포화도 / 기타** — 기본 심전계, URL `?group=` 보존. 건수는 3군 전부 항상 표시 |
| 액션 (수리 대기) | 행 **[수리완료] 체크**(단건·선택 일괄), **처리방법 초안**(수리반환 / 교체+발송기기), **[폐기]**. 모두 **기존 API 재사용** |
| 액션 (입고 예정) | 없음(읽기) — 입고처리는 실물 시리얼 대조라 접수 상세에서만 |
| 최종확정·발송정보 | **접수 상세에 유지**(큐에서 안 함) — §5.3 근거 |
| DB | **스키마 변경 없음**, 마이그레이션 없음 |
| 신규 API | `GET /api/as-receipts/queue` 1개 + `POST /api/as-receipts/queue/repair-done`(일괄) 1개 |

## 3. 버킷 정의 (단일 소스 → `lib/asReceiptShared.ts`에 판정 함수로 둠)

기존 3축(`intake_state` × `outcome` × `repaired_at`, `as_work_design.md` §14·§17)만으로 정의 — 새 상태 컬럼 없음.

### 3.1 수리 대기 (WAITING) — "입고됐고 아직 수리 안 함"

```
intake_state = 'RECEIVED'
AND repaired_at IS NULL
AND outcome IS NULL 또는 'REPLACE'          -- 선교체 구기기(교체 확정 후 사후 입고)는 여전히 수리 대상
```
- `canMarkAsLineRepaired`(§17)에서 `REPAIR_RETURN`만 뺀 집합. 수리반환이 확정된 라인은 이미 병원으로 돌아간 기기라 센터 대기가 아니다.
- **접수 종결 여부 무관**(A-2 선례 — 완료된 선교체 접수의 구기기가 센터에 남아 있음).
- 정렬: `priority_repair`(우선수리 태그) 먼저 → 라인 `received_at` 오래된 순.

### 3.2 입고 예정 (INCOMING) — "접수됐고 아직 안 들어옴"

```
intake_state IN ('PENDING', 'MISMATCH')
AND outcome IS NULL
AND 접수 헤더 미종결 (status.ticket_status NOT IN ('RESOLVED','CLOSED'), status NULL 포함)
AND 헤더 category <> 'LOST' AND pickup_method IS DISTINCT FROM 'NONE'   -- 회수할 기기가 없는 접수 제외
```
- `MISMATCH`(입고처리 했는데 그 시리얼이 없었음)는 **포함하되 '미입고' 배지** — 담당자 입장에선 "와야 하는데 안 온 기기". 확인·치환은 접수 상세의 접수자 확인 절차 그대로.
- `draft_outcome='REPLACE'`(선교체 초안)도 포함 — 신기기는 나가지만 구기기는 들어와야 함.
- 정렬: 헤더 `receipt_date` 오래된 순(체류 경과 큰 것부터). 헤더 상태(접수/수거중/발송 등)·수거방법·송장 노출.

### 3.3 기기군 판정

기존 `asDeviceGroupOf(원장 모델명, deviceKind, serialNo)` 그대로(목록 `?group=` 필터 SQL과 동일 규칙 — 모델명 → 미등록 기기종류 → 시리얼 접두 A/P). 서버 SQL은 `app/api/as-receipts/route.ts`의 group 필터 조각을 함수로 추출해 공용.

### 3.4 dev2 실측 (2026-09-05 동기화 데이터 — 낡음, PROD는 9/21 일괄 완료 이후라 다름)

| 버킷 | 심전계 | 산소포화도 | 기타 |
|---|---|---|---|
| 수리 대기 | 0 | 4 | 0 |
| 입고 예정 | 230 | 762 | 1 |

입고 예정이 큰 이유는 헤더 '접수' 상태로 남은 과거 임포트 건(수거·입고 미기록). PROD 기준 수치는 착수 시 읽기 전용으로 재실측(§10).

## 4. 화면 (`app/as-receipts/queue/page.tsx`) — 초기 단순 원칙

```
[접수 목록] [수리대기]                                   ← 탭 스트립 (두 페이지 공통, 신규 소형 컴포넌트)
─────────────────────────────────────────────────────────
수리 대기  심전계 12 · 산소포화도 5 · 기타 0     입고 예정  심전계 230 · 산소포화도 762 · 기타 1
( 수리 대기 (17) | 입고 예정 (993) )   [심전계 | 산소포화도 | 기타]   병원 🔍  □ 우선수리만
```

### 4.1 수리 대기 표
| 열 | 내용 |
|---|---|
| ☐ | 선택(쓰기 권한자) — 헤더 전체선택(현재 페이지) |
| 시리얼 | + 기기 상태 배지(AS접수/수리완료 등 `conditionBadge` 재사용) + 위치 툴팁 |
| 접수번호 | 링크 → `/as-receipts/[id]`(새 탭 아님, 복귀는 큐 URL sessionStorage — `AS_LIST_QS_KEY` 선례와 별도 키) |
| 병원 | |
| 입고일 · 경과 | 라인 `received_at`, 오늘−입고일(일). 7일↑ 주황, 14일↑ 빨강(목록 overdue2w 기준 차용) |
| 접수사유 | 라인 `symptom` 1줄 말줄임, 툴팁 전체 |
| 태그 | 우선수리·선교체·펌웨어·부속품(접수 태그 배지 재사용) |
| 처리방법 | 확정(`outcome`) 또는 초안(`draft_outcome`) 배지. 미정이면 셀렉트 `수리반환 / 교체` + 교체 시 발송기기 입력 → blur/Enter 시 **초안 저장** |
| 수리완료 | 체크박스(즉시 `repair-done`). 체크되면 다음 조회부터 이 버킷에서 빠짐 → 행이 사라지기 전 초록 플래시 |
| … | [폐기](memo prompt → `scrap-line`) — 원장 연결·회수 상태 기기만 활성 |

선택이 있으면 표 위 파란 바: **[수리완료 n건 적용]** (bulk-status 선례 UI).

### 4.2 입고 예정 표
시리얼 · 접수번호 · 병원 · 접수일·경과 · 헤더 상태 배지 · 수거(방법·수거일·송장) · 입고대조(`대기`/`미입고` 배지) · 접수사유 · 태그. 액션 없음.

### 4.3 공통
- 페이지당 50행, 페이지네이션. URL 동기화 `?bucket=WAITING|INCOMING&group=ECG|SPO2|ETC&hospital=&priority=1&page=`
- 모바일: 접수 목록 페이지의 카드 레이아웃 규칙 그대로
- 권한: 조회는 AS업무 nav와 동일(전원). 액션은 **VIEWER 제외 USER 이상**(repair-done·draft-lines·scrap-line 라우트의 기존 규칙 그대로 — 큐 화면이 새 권한을 만들지 않음)

## 5. API

### 5.1 `GET /api/as-receipts/queue`
- 쿼리: `bucket`(필수) · `group` · `hospital`(코드 또는 이름 부분일치) · `priority=1` · `page` · `pageSize`
- 응답
```json
{
  "counts": { "WAITING": { "ECG": 12, "SPO2": 5, "ETC": 0 }, "INCOMING": { "ECG": 230, "SPO2": 762, "ETC": 1 } },
  "items": [ { "id", "serialNo", "symptom", "outcome", "draftOutcome", "draftNewSerialNo", "intakeState", "receivedAt", "repairedAt",
               "device": { "id", "unit": { "condition", "locationSiteValue", "locationHospitalCode", "locationHospitalName" }, "placement": {...}, "deviceInfo": {"deviceName"} },
               "receipt": { "id", "asCode", "hospitalCode", "hospitalName", "receiptDate", "category", "pickupMethod", "pickupTrackingNo", "pickedUpAt",
                            "status": { "id","name","color","ticketStatus" }, "tags": ["PRIORITY_REPAIR", ...], "canEdit": true } } ],
  "total": 17, "page": 1, "pageSize": 50
}
```
- `counts`는 필터(group·hospital·priority) 무관한 전체 건수 — 헤더용. 라인 select는 상세 API `detailInclude.items` + `shapeDetailItems`를 **export해 재사용**(유닛 형상 체인 §5.1 — 복제 금지).
- 버킷 WHERE는 §3을 Prisma where로 표현(raw SQL은 기기군 판정 조각만).
- `receipt.canEdit`은 `canEditAsReceipt` 결과 — 초안 저장 버튼 활성 판정용(repair-done·scrap은 종결 무관이라 role만 봄).

### 5.2 `POST /api/as-receipts/queue/repair-done` (일괄)
- `{ itemIds: number[] }` ≤100. 라인별 `setAsLineRepaired(receiptId, actor, { itemId, repaired: true })`를 **개별 트랜잭션**으로 호출(bulk-status 선례: 일부 실패해도 나머지 반영) → `{ updated, skipped: [{ itemId, serialNo, reason }], warnings }`.
- 감사·비고·기기 REPAIR_DONE 이벤트는 단건 함수가 이미 처리 — 라우트는 루프와 응답 조립만.

### 5.3 기존 API 재사용 (변경 없음)
| 액션 | 호출 |
|---|---|
| 수리완료 단건 | `POST /api/as-receipts/[receiptId]/repair-done { itemId, repaired }` |
| 처리방법 초안 | `POST /api/as-receipts/[receiptId]/draft-lines { lines:[{itemId, outcome, newSerial?}] }` |
| 폐기 | `POST /api/as-receipts/[receiptId]/scrap-line { itemId, memo }` |

**최종확정(`confirm-lines`)·발송정보(`ship-info`)는 큐에 두지 않는다.** 근거: ① 확정은 접수의 초안 전 라인을 한 트랜잭션으로 묶고 기기군별 발송정보(방법·송장·발송일)를 요구해 **접수 단위 작업**이다. ② 수리담당자의 판단은 "고쳐서 돌려보낼지(수리반환) / 못 고쳐 교체할지"까지이고, 발송·확정은 접수담당자 몫 — 기존 초안/확정 2단계(2026-09-14)와 역할 분리가 정확히 맞는다. 큐 행의 처리방법 배지에 '초안'이 붙으면 접수담당자가 상세에서 [최종확정]한다.

## 6. 파일 목록 (예정)

| 구분 | 파일 |
|---|---|
| 신규 | `app/as-receipts/queue/page.tsx`, `app/as-receipts/_components/AsTabs.tsx`(탭 스트립), `app/api/as-receipts/queue/route.ts`, `app/api/as-receipts/queue/repair-done/route.ts` |
| 수정 | `lib/asReceiptShared.ts`(버킷 상수·라벨·`asQueueBucketOf` 판정, 큐 QS 보관 키), `lib/asReceiptSearch.ts` 또는 `route.ts`(기기군 SQL 조각 추출), `app/api/as-receipts/[id]/route.ts`(`detailInclude`·`shapeDetailItems` export), `app/as-receipts/page.tsx`(탭 스트립 삽입), README·DEV_HISTORY |
| 스모크 | `scripts/as-receipt-smoke.mts`에 '▶ 수리대기 큐' 항목 추가(버킷 판정·일괄 수리완료 skipped) |

## 7. 검증 계획
- tsc·eslint 0, 4GB 빌드·`pm2 restart thync-dev`
- curl: 버킷×기기군 건수가 §3 SQL 직접 집계와 일치 / VIEWER 일괄 403 / 101건 400 / 종결 접수 선교체 구기기가 수리 대기에 포함 / 수리반환 확정 라인 미포함 / 분실·수거없음 접수가 입고 예정에서 제외 / MISMATCH '미입고' 배지 / 일괄 수리완료 중 이미 체크된 라인 skipped(멱등) / 체크 후 재조회 시 행 소실·counts 감소
- 화면: 심전계↔산소포화도 전환 시 건수·표 일치, 상세 이동 후 [← 목록]이 큐 URL로 복귀

## 8. 결정 요청 (사용자)

| # | 질문 | 추천 |
|---|---|---|
| A | 탭 스트립 방식(nav 행 없음) vs nav에 '수리대기' 별도 메뉴 | **탭 스트립** — 요청 문구 그대로, nav 시드·PROD 반영 없음 |
| B | 수리 대기에 **교체 확정된 선교체 구기기(outcome=REPLACE)** 포함 | **포함** — 센터에 있고 안 고쳐진 기기 |
| C | 입고 예정에 **미입고(MISMATCH)** 포함 | **포함 + '미입고' 배지** |
| D | 큐에서 최종확정·발송정보까지 허용 | **불허(상세 유지)** — §5.3 |
| E | 기본 기기군 | **심전계** (또는 마지막 선택 localStorage) |
| F | 입고 예정 정렬 | **접수일 오래된 순** |

## 9. v1 제외·후속
- '수리완료·발송 대기'(repaired_at 있고 outcome NULL) 3번째 버킷 — 발송 담당 관점 화면이라 요청 시 추가(같은 API에 bucket 하나 추가로 끝남)
- 입고 예정의 '예상 입고일'(수거일+택배 리드타임) 추정 — 데이터 없음
- 병원별 그룹핑·Excel — 요청 시
- 기기현황(`/devices`)의 `condition=AS_WAITING&location=REFRESH_CENTER` 뷰와의 정합 검사 도구 — 큐(라인 기준)와 원장(유닛 기준)이 어긋난 기기 목록. 미등록 라인은 큐에만 잡힘

## 10. 구현 순서
1. PROD 읽기 전용 실측(§3 SQL) → 건수 확인·§3.4 갱신
2. `lib/asReceiptShared.ts` 버킷 판정 + `GET /api/as-receipts/queue`
3. 페이지 + 탭 스트립 + 단건 액션 3종
4. 일괄 수리완료 API + 선택 바
5. 스모크·문서
