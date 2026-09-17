# 기기 상태·위치 축(Device Condition & Location) — 설계안

> **상태: 완료 (PROD 배포 2026-09-17, 커밋 26a0ba1 — 마이그·백필 적용)** — 후속: 화면 확인·Phase 2(§10) (§13 구현 노트) · 작성 2026-09-17 · 개정 2.1(2026-09-17 — 1차 적대 검증 43건 + 재검증 27건 + 종결 확인 12건 반영) · **개정 2.2(2026-09-17 — P2 코드 리뷰 1회차 16건 반영: §4.2 각주²·§6.3·§7.1·§7.3·§7.4·§8.2·§9.1·§9.5·A.0·부록 C)** · **A-1~A-6 사용자 확정 2026-09-17: A-5 외 전부 추천안, A-5는 "AS 업무 권한(VIEWER 제외 USER 이상)"으로 수정**
> 경위: 사용자 문제 제기(AS 회수 기기의 수리 진행·상세 이력을 기기 단위로 보고 싶다 — 자재관리와 무관) → 브리핑(HTML) → 사용자 확정 5건(§0) → 코드베이스 7영역 병렬 독해 + DEV 데이터 실태 조사 → 초안 → 5렌즈 적대 검증(코드 정합·AS 흐름 전수·백필 DEV 실측·원칙 충돌·배포 리스크, 확정 43건) → 개정 1 → 3렌즈 재검증(확정 27건, 백필 수치 DEV 재실측 일치) → 본 개정.
> 관련 문서: `hospital_device_registry_design.md`(HDR — 원장 3층 구조·불변식·B-20~B-25), `as_work_design.md`(ASW — 라인 처리 게이트 §14), `thync_as_migration_design.md`(MIG), `stock_out_request_design.md` §13(SOR — WMS 출고 등록), `channeltalk_as_intake_design.md`(CTK).
> 재개 방법: "projects/device_condition_location_design.md 읽고 기기 상태·위치 축 이어서 진행해줘"
> 설계 검토 게이트 통과(2026-09-17 착수 승인). 빌드·git push·PROD 반영은 명시 요청 시에만.

---

## 0. 확정 결정(D1~D5) — 사용자 답변(2026-09-17)

| # | 결정 |
|---|---|
| D1 | 기기 상태는 **6종**: 사용중 · AS접수(수리 전) · 수리완료 · **출고 전** · 분실 · 폐기 |
| D2 | 수리 후 반환 기기는 센터에 있는 동안에도 **병원 배치를 유지**하고 다시 그 병원으로 돌아간다 |
| D3 | 병원 외 위치는 큰 틀에서 **'리프레시센터'·'thynC Connected Hub' 2곳**. 자재관리 인벤토리는 추후 Hub의 하위 개념으로 편입(자재관리 인벤토리 개념과는 별개) |
| D4 | 수리반환으로 처리되지 않은 **회수 기기는 모두 위치 '리프레시센터'**로 백필 (분실은 I-1에 따라 위치 없음 — §9.1 규칙 5 각주) |
| D5 | 수리완료 체크는 **입고된 라인만** 가능(입고 전 체크 불가) |

설계자 판단(B-26~B-37)은 §12 B에, 사용자 확인 쟁점(A-1~A-6, 2026-09-17 확정)은 §12 A에 둔다. **A-5 확정값: 폐기는 AS 업무 권한과 동일(VIEWER 제외 USER 이상)** — 이하 본문의 'A-5'는 이 값을 뜻한다.

**용어**(문서 전체 공통)
- **배치 상태 이벤트** = `DEVICE_STATE_EVENT_TYPES` 3종(REGISTER·MOVE_WARD·RECOVER) — 배치 fold의 EMPTY 판정·`last_event` 대상.
- **배치 축 이벤트** = REGISTER·MOVE_WARD·RECOVER·AS_OPEN·AS_CLEAR — 배치 프로젝션을 접는 이벤트(`assertSuffix` 대상).
- **스냅샷 이벤트** = `changes.condition`을 싣는 이벤트 — REGISTER·RECOVER·AS_OPEN·AS_CLEAR·INTAKE·REPAIR_DONE·SCRAP·SITE_MOVE·상태 CORRECT(condition/location 키 보유). **MOVE_WARD는 제외**(상태·위치를 바꾸지 않음). I-6·취소 규약의 대상.

---

## 1. 배경·목적

원장(`hospital_devices`)은 **"어느 병원 몫인가"(배치)** 만 기록한다. 그래서 다음을 답할 수 없다.

| 질문 | 현재 | DEV 실측(2026-09-17, PROD 동기화본) |
|---|---|---|
| 수리 후 반환할 기기가 지금 센터에 있나 | 배치 '사용중' + AS 표시 — 위치 없음 | ACTIVE인데 입고(RECEIVED) 미종결 라인 보유 130대 |
| 교체로 회수된 기기는 그 뒤 어떻게 됐나 | '회수됨'·사유 '불량(AS 회수)' — 이후 기록 없음 | RECOVERED DEFECT 1,340대(1,339는 교체됨) |
| 수리가 끝나 교체품으로 쓸 수 있는 기기 목록 | 없음 | 교체기의 **48%(1,267대)가 회수 이력 있는 수리품 재사용**, 453대는 2회 이상 재사용 |
| 10대 접수 중 몇 대가 수리됐나 | 라인엔 결과(수리반환/교체)만 | ≥10대 접수 325건, 최대 61대 |
| 폐기·분실 기기 | 회수 사유로만 흔적 | 분실 128대, 폐기 0(사유 '현장 폐기' 사용 0건) |

핵심 차별점 한 문장: **배치(병원 몫)·상태(실물 상태)·위치(실제 소재)를 세 축으로 분리**하고, AS 흐름의 각 단계가 상태·위치를 자동으로 옮기며, 수리담당자는 라인 체크 한 번으로 '수리완료'를 남긴다.

---

## 2. 이 기능이 답해야 할 질문

| Q | 설계 반영 |
|---|---|
| 이 접수 10대 중 몇 대 수리됐나 | 3번 카드 라인 '수리완료' 체크 + 카드 헤더 `수리완료 n/m` (§6.1) |
| 이 시리얼은 지금 어떤 상태·어디 있나 | `device_units.condition` + `location_*` (§5.1), /devices 열·배지·드로어 (§6.2) |
| 교체품으로 쓸 수 있는 기기가 몇 대인가 | 파생 정의 I-5 — v1은 회수 목록 필터, 목록 화면은 Phase 2 |
| 이 기기가 어떤 경로를 거쳤나 | 이벤트 4종 추가 + 모든 스냅샷 이벤트에 상태·위치 before/after (§4.1·§5.3) |
| 회수됐는데 수리·폐기 판정이 안 된 기기 | condition NULL = '미확인'(백필 전용) — Phase 2 일괄 정리 대상 (§9.1, A-1) |

기여하지 않는 필드·화면은 만들지 않는다: 수리 소요·수리 내역(부품) 필드, 거점 설정 UI, Hub 재고 목록은 v1 비범위(§10).

---

## 3. 기존 기능과의 경계

| 기존 자산 | 성격 | 관계 |
|---|---|---|
| 배치 프로젝션 `hospital_devices.status`(ACTIVE/RECOVERED) + CHECK `(status='ACTIVE')=(hospital_code IS NOT NULL)` | 이벤트 fold 파생값(HDR 불변식 1) | **불변**. 6종 상태를 여기에 넣지 않는다. 회수·교체는 계속 `recoverDevice`/`replaceDevice` 경유 |
| AS진행중 플래그 `as_started_on`/`as_ref_code` + AS_OPEN/AS_CLEAR(B-24) | 배치의 업무 마커 | **유지**. condition은 실물 상태(§4.4). IN_USE 복귀의 단일 소스는 AS 서비스 훅 `setUnitInUse`(§7.3 — 플래그 없는 기기에서도 성립, 되돌림 게이트 통과 시에만) |
| 회수 사유 `DEVICE_RECOVERY_REASON`(value DEFECT/LOST/RETURN/DISPOSE/TRANSFER, B-8) | StatusCode 마스터 | 신규 사유 없음. value → 상태 매핑 §5.6 |
| 용도 `device_units.usage_type_id`(B-21 "물건의 속성") | 유닛 속성, 직접 UPDATE + CORRECT 이벤트 | **선례**. condition·location도 같은 규약(B-26) |
| CORRECT 이벤트 `changes {field:{before,after}}` + 취소 시 before 복원 | 유닛 속성 정정 규약 | 스냅샷 형식은 재사용, 취소 판정·복원은 **신설 규약**(§8.2 — 기존 CORRECT-only 판정·occurred_on 순 접미 판정과 다름) |
| AS 라인 게이트 `intake_state × outcome`(ASW §14) | 2축 | 수리완료는 **제3축**(`repaired_at`) — outcome·헤더 전이·완료 판정에 절대 개입하지 않음(§7.2) |
| 비상태 이벤트 제외 하드코딩(`stateEventsAfter`·`assertSuffix`·요약 lastEvent·임포트 `lastStateOn`) | CORRECT(일부 AS_*) 제외 | 신규 4종은 배치 fold 비상태 이벤트, 갱신 지점을 §7.0에 전수 열거 |
| WMS `inventory_units`(D9 읽기 전용) · SOR §13 출고 시 `registerDevicesIn(source WMS)` | 창고 개체·출고 등록 | **불변**. 출고 확정 REGISTER가 암묵으로 IN_USE·위치 병원. SCRAPPED 시리얼은 출고 **사전 검증**에서 라인 오류(§9.3) |
| MIG(과거 3,537행 소급 — PROD 반영 완료 2026-09-05) | RECOVER DEFECT·재REGISTER·AS_OPEN/AS_CLEAR만 생성 | 백필은 이 이벤트만으로 계산(§9.1). 잔여 replay는 §9.4 |
| 채널톡 동기화(CTK) | 역기입은 outcome·resolvedAt·shippedAt·receivedAt 축만 | 역기입 **비영향**. 인입(`createAsReceipt`→`openDeviceAs`→AS_WAITING)은 **영향 경로**(1분 폴링 — §7.4) |

---

## 4. 개념 모델

### 4.1 3축과 단일 소스

```
device_info(모델) → device_units(시리얼 정체성)      ← ② condition ③ location  ★신규(유닛 속성)
                        └ hospital_devices(배치 프로젝션) ← ① 배치 status/hospital/ward (기존, fold 파생)
                        └ hospital_device_events(이력)   ← 기존 6종 + 신규 4종, 스냅샷 이벤트에 changes.condition/location
```

| 축 | 질문 | 저장 | 진실 소스 |
|---|---|---|---|
| ① 배치 | 어느 병원 몫인가 | `hospital_devices` | 이벤트 fold(불변) |
| ② 상태(condition) | 어떤 상태인가 | `device_units.condition` | **유닛 컬럼 직접 갱신(낙관 가드) + 스냅샷 이벤트** — B-26 |
| ③ 위치(location) | 지금 어디 있나 | `device_units.location_hospital_code` / `location_site_id` | 동일 |

**B-26 유닛 상태·위치는 fold 파생값이 아니라 유닛 속성이다** — **HDR 불변식 1·3의 명시 예외**(재계산 불가, id 순 마지막 쓰기 승).
- 배치 fold(`rebuildUnitProjection`)의 쓰기 대상은 `hospital_devices`뿐이며(core.ts:775-785) 배치 행 없는 유닛(PRE_SHIP·배치 상태 이벤트 0)은 파생값을 둘 행이 없다.
- `hospital_devices_active_hospital_check`가 ACTIVE↔hospital_code를 묶어 배치 행에 위치를 넣을 수 없다(교체 후 구기기는 RECOVERED·hospital_code NULL).
- 유닛 속성(용도·메모·MAC·CORRECT)은 이미 "직접 UPDATE + 이벤트 append + 취소 시 before 복원" 규약(write.ts `correctDevice`, admin.ts `cancelCorrectEvent`).
- 대가: 이벤트 취소·정정·소급 삽입 후 유닛 값을 fold로 재계산할 수 없다 → §8.2 **재도출 규칙**과 I-6로 대신한다.

**스냅샷 규약(B-28)**: 상태·위치를 바꾸거나 바꿀 수 있는 모든 이벤트(= 스냅샷 이벤트, §0 용어)에 `changes.condition {before,after}`·`changes.location {before,after}`를 쓴다 — **값이 같아도 기록**. 이벤트 **수**는 늘리지 않는다(기존 이벤트 행에 싣는다). **I-6 / 스모크 [1e-8]: 스냅샷 이벤트가 1건 이상인 유닛에 한해, 유닛의 condition/location = 그 유닛의 스냅샷 이벤트 중 id 최대 행의 after**(백필 직후 1,470대, 이후 스냅샷 이벤트가 쌓일수록 확대).

**쓰기 순서(순서 변경 금지)** — 두 모드:
1. **신규 4 서비스**(intake·repair·scrap·move — 자체 이벤트를 만드는 경우): 유닛 조회(non-undefined before — `undefined`는 Prisma where에서 생략되므로 반드시 `UnitRow`/확장 `DeviceRow`에서 읽음) → **배치 축 판정·condition 판정·prepareCtx·validateRef 전부** → `deviceUnit.updateMany({ where: { id, condition: before, locationHospitalCode: before, locationSiteId: before } })` count≠1이면 **아무 쓰기 없이** 409 `RegistryError`(AS 서비스가 경고로 흡수 가능 — 가드 앞의 모든 409도 쓰기 없음) → 성공 시 `insertEvent`(changes 스냅샷).
2. **기존 함수에 얹는 암묵 전이**(REGISTER·RECOVER·AS_OPEN·AS_CLEAR — 공용 헬퍼 `applyImplicitTransition`): 그 함수의 **모든 검증(assertTransition·stateAt·prepareCtx·insertEvent null 판정)과 `rebuildUnitProjection(guard)` 이후**에 유닛 가드 UPDATE를 실행한다. changes(before/after)는 검증 통과 직후 이벤트 INSERT 전에 계산해 이벤트 행에 싣는다(2-phase: `{changes, apply()}` — 일괄 함수는 `insertEvents`·rebuild 루프 뒤 `apply()`). 이 시점의 유닛 가드 실패는 이벤트·배치가 이미 써진 뒤이므로 **`RegistryTxAbort`(RegistryError의 하위가 아닌 별도 클래스 — AS 서비스 흡수 경로가 잡지 않음)를 던져 tx 전체를 실패**시킨다(라우트는 409 '동시에 변경되어 다시 시도하세요'). 흡수되는 RegistryError 409는 모두 유닛 쓰기 전에만 발생한다.

### 4.2 상태 6종과 전이

| 코드 | 표기 | 정의 | 진입 | 위치 규칙 |
|---|---|---|---|---|
| `IN_USE` | 사용중 | 병원에서 정상 사용 | REGISTER(등록·재등록·이관·교체기·WMS 출고), `setUnitInUse`(수리반환 확정·미회수·라인 취소·제거·삭제·시리얼 보정 — 게이트 통과 시), AS_CLEAR(수동 해제) | 병원(배치 병원). 라인 취소·수동 해제는 위치 유지 |
| `AS_WAITING` | AS접수 | AS 접수 후 수리 전 | AS_OPEN(접수 등록), RECOVER(사유 DEFECT), INTAKE(IN_USE·NULL·LOST·PRE_SHIP·새 ref의 REPAIRED) | 접수 시 병원 유지 → INTAKE 시 센터. DEFECT 회수는 **A-4** |
| `REPAIRED` | 수리완료 | 수리 완료 | REPAIR_DONE(라인 체크·/devices 액션) | 유지(센터) |
| `PRE_SHIP` | 출고 전 | 신품·미출고 | **v1 공식 진입로: admin CORRECT(condition PRE_SHIP + 위치 HUB, 배치 RECOVERED/없음만)** — 생성 경로(Hub 입고·WMS 편입)는 Phase 2 (A-6) | Hub |
| `LOST` | 분실 | 분실 확정 | RECOVER(사유 LOST — 라인 분실종결·분실 접수의 교체) | 없음. 발견 시 REGISTER(재등록) 또는 INTAKE(센터 도착) |
| `SCRAPPED` | 폐기 | 폐기(최종) | SCRAP(회수 기기 폐기 액션), RECOVER(사유 DISPOSE — 현장 폐기) | 없음. 되돌림은 admin CORRECT·LIFO 취소 |
| `NULL` | 미확인 | **백필·재도출 전용** — 회수됐으나 판정 근거 없음 | 마이그 백필(§9.1)·취소 재도출(§8.2) | 센터(회수 기기) |

**판정 순서**: ① 배치 status × 이벤트(`DEVICE_TRANSITIONS`, §5.6 — SAME/OTHER는 **호출부 ctx.hospitalCode(접수 병원)** 와 배치 병원 비교) → ② condition × 이벤트(아래 표). ①에서 막히면 ②는 보지 않는다.

condition × 이벤트. 범례: `ok`=전이 · `keep`=condition 유지(배치 축 열은 그 이벤트 행에 before=after 스냅샷 기록, 신규 4종 열은 이벤트 없음 — INTAKE ref 규칙 B-37 예외) · `409`=거부 · `—`=①에서 도달 불가.

| 현재 \ 이벤트 | REGISTER | AS_OPEN¹ | INTAKE | REPAIR_DONE | AS_CLEAR¹ ⁴ | RECOVER(DEFECT)¹ | RECOVER(LOST)¹ | RECOVER(DISPOSE)¹ | RECOVER(RETURN·데모·기타)¹ | RECOVER(TRANSFER)¹ | SCRAP² | SITE_MOVE² |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| IN_USE | ok(IN_USE·병원) | ok→AS_WAITING | ok→AS_WAITING·센터 | 409 '사용중' | keep(위치 ⁴) | ok→AS_WAITING·위치 **A-4** | ok→LOST | ok→SCRAPPED | keep(경고 '위치를 이동하세요' → [위치 이동]) | keep(짝 REGISTER가 정함) | ok→SCRAPPED | ok |
| AS_WAITING | ok→IN_USE | keep | ok(위치 센터) | ok→REPAIRED | ok→IN_USE | keep(위치 A-4) | ok→LOST | ok→SCRAPPED | keep | keep | ok→SCRAPPED | ok |
| REPAIRED | ok→IN_USE | ok→AS_WAITING³ | **새 ref: ok→AS_WAITING·센터(재입고)** / 같은 ref: keep | keep | ok→IN_USE | keep(위치 A-4) | ok→LOST | ok→SCRAPPED | keep | keep | ok→SCRAPPED | ok |
| PRE_SHIP | ok→IN_USE | — | — | 409 | — | — | — | — | — | — | ok→SCRAPPED | ok |
| LOST | ok→IN_USE(발견) | — | ok→AS_WAITING·센터(발견) | 409 | — | — | — | — | — | — | 409 | 409 |
| SCRAPPED | **409 '폐기된 기기'** | — | 409 | 409 | — | — | — | — | — | — | keep | 409 |
| NULL(미확인)⁵ | ok→IN_USE | ok→AS_WAITING | ok→AS_WAITING·센터 | ok→REPAIRED | ok→IN_USE(위치 ⁴) | ok→AS_WAITING·위치 A-4 | ok→LOST | ok→SCRAPPED | keep | keep | ok→SCRAPPED | ok |

¹ AS_OPEN/AS_CLEAR/RECOVER는 배치 **ACTIVE_SAME**에서만 성립(기존 전이표) — PRE_SHIP/LOST/SCRAPPED 행은 배치가 ACTIVE일 수 없어 '—'.
⁵ NULL 행의 배치 축 열은 **배포 창**(코드 기동 후 백필 전 — ACTIVE 26,887대 전부 NULL)에서 도달한다. '위치 유지'에서 before 위치가 NULL이면 배치 병원으로 채운다(location NULL 잔존 방지).
² SCRAP·SITE_MOVE(병원→거점·거점↔거점)는 **배치 ACTIVE면 모든 행에서 409** '배치 중 기기는 먼저 회수하세요'(I-3). SITE_MOVE의 **병원 반환**(위치 거점 → 배치 병원)만 ACTIVE에서 허용하되 **condition=IN_USE일 때만**(AS_WAITING/REPAIRED는 409 '미종결 입고 라인 — AS 상세에서 확정하세요', NULL(미확인 — 배포 창·재도출)은 409 '기기 상태 미확인 — 관리 보정으로 상태를 지정한 뒤 반환하세요').
³ 도달 경로: 플래그 없이 RECEIVED된 라인(타병원 매칭 후 이관·다른 접수 플래그) — DEV 실측 5대.
⁴ AS_CLEAR의 위치: AS 서비스 훅(`setUnitInUse(locationToHospital:true)`)이면 병원, /devices 단건·일괄 **수동 해제는 위치 유지** + 경고 '미종결 입고 라인(AS-…) 있음'.

- **수리완료 해제** = **CORRECT**(`changes.condition {REPAIRED→AS_WAITING}`, memo '수리완료 해제') — B-27. 취소 판정은 §8.2.
- 암묵 전이(B-28): REGISTER/RECOVER/AS_OPEN/AS_CLEAR의 상태·위치 갱신은 그 이벤트 행에 스냅샷을 싣는 부수 갱신(이벤트 미추가). 단건·일괄(`bulkDeviceAction`)·교체·임포트·WMS 출고가 **공용 헬퍼 `applyImplicitTransition`** 을 쓴다(§7.0).

### 4.3 배치↔상태↔위치 정합 불변식

| # | 불변식 | 강제 |
|---|---|---|
| I-1 | `condition ∈ {LOST, SCRAPPED}` ⇒ 위치 둘 다 NULL | DB CHECK |
| I-2 | 위치는 병원 또는 거점 중 **하나만** | DB CHECK |
| I-3 | 배치 ACTIVE ⇒ `condition ∉ {LOST, SCRAPPED, PRE_SHIP}` | 서비스 assert(SCRAP/SITE_MOVE·CORRECT 검증, SCRAPPED에 REGISTER 409) + 취소 후 재도출(§8.2, 위반 시 warnings) + 스모크 |
| I-4 | 배치 ACTIVE ∧ condition IN_USE ⇒ 위치 = 배치 병원. **예외**: 라인 CANCELED·수동 AS_CLEAR(실물이 센터에 남았음을 드러냄 — [병원 반환]으로 해소) | 서비스 + 스모크. 검증 SQL은 0 기대가 아니라 **예외 목록 리포트**(부록 B) |
| I-5 | **교체품 가용** ≡ `condition='REPAIRED'` ∧ (배치 행 없음 ∨ `status='RECOVERED'`) ∧ 위치 거점=REFRESH_CENTER ∧ **미종결 라인(outcome NULL) 없음** | 파생 정의. v1 회수 목록 필터는 **근사**(배치 없는 유닛 비노출·PENDING 미종결 라인 보유분 포함 — 정확한 목록은 Phase 2) |
| I-6 | 스냅샷 이벤트가 있는 유닛의 값 = id 최대 스냅샷 이벤트의 after ([1e-8]) | 스냅샷 규약(§4.1) + 취소 규약(§8.2) + 스모크 + 부록 B SQL |

### 4.4 AS 플래그(B-24)와 condition의 관계

| | AS 플래그 `as_started_on` | condition |
|---|---|---|
| 의미 | 이 **배치**에 열린 AS 접수가 있다(업무 마커) | 이 **실물**이 어떤 상태인가 |
| 켜짐 | AS_OPEN | AS_OPEN → AS_WAITING(부수) |
| 꺼짐 | AS_CLEAR·RECOVER·재REGISTER(fold) | `setUnitInUse`(게이트 통과 시) — 플래그 유무 무관 |
| 회수 후 | 항상 꺼짐 | AS_WAITING·REPAIRED·NULL이 남아 "센터에서 수리 대기/완료"를 말한다 |

라벨(B-29): /devices 기존 '상태' 열은 **헤더만 '배치'로** 바꾸고 값(사용중/AS진행중/회수됨)은 유지(`placementStatusLabel` 불변), 새 열 **'기기 상태'**(condition)·**'위치'**를 추가한다(A-3).

### 4.5 AS 흐름별 상태·위치 (기준 시나리오)

| 단계 | 수리 후 반환 | 교체 / 선교체(구기기) | 신기기 |
|---|---|---|---|
| 접수 등록 | AS_WAITING · 병원 | AS_WAITING · 병원 | — |
| 입고처리 | AS_WAITING · **센터** (배치 ACTIVE 유지 — D2) | AS_WAITING · 센터 (선교체는 교체 확정 뒤 사후 입고 — 종결 접수도 조건부 허용, §7.3) | — |
| 수리완료 체크 | REPAIRED · 센터 | REPAIRED · 센터 → **교체품 가용** | — |
| 처리 확정 | 수리반환: **IN_USE · 병원**(`setUnitInUse`, 게이트 통과 시) | 교체: 배치 RECOVERED(DEFECT) · AS_WAITING(IN_USE였으면 승격) · 위치 **A-4** | IN_USE · 병원 (REGISTER) |
| 분실종결 / 분실 접수의 교체 | — | LOST · 위치 없음 | (교체 시) IN_USE · 병원 |
| 라인 취소 | IN_USE · **위치 유지**(센터면 센터 — [병원 반환] 안내) | — | — |
| 미회수 확정 · 라인 제거 · 접수 삭제 · 시리얼 보정 | IN_USE · 병원(실물 이동 근거 없음) — 게이트 통과 시 | — | — |
| 폐기 | — | SCRAPPED · 위치 없음 (회수 기기만, A-5 권한) | — |
| 교체품 재사용 | — | REPAIRED 유닛을 다른 접수의 교체기로 입력 → `replaceDevice` reregister → IN_USE · 해당 병원. REPAIRED가 아니면 경고 1건 | |
| 교체품 재접수(재불량) | — | 새 접수의 라인/EXTRA로 입고 → AS_WAITING·센터(가용 제외) | |
| 취소 라인 실물 도착 | 새 접수로 처리(또는 EXTRA 편입) | | |

---

## 5. 데이터 모델

### 5.1 `device_units` 확장

| 컬럼 | 타입/제약 | 근거 |
|---|---|---|
| `condition` | TEXT NULL, CHECK IN ('IN_USE','AS_WAITING','REPAIRED','PRE_SHIP','LOST','SCRAPPED') | 6종(D1). NULL=미확인(백필·재도출 전용). 신규 경로는 항상 값 설정 |
| `condition_changed_on` | DATE NULL | 상태 진입 업무일자 |
| `location_hospital_code` | TEXT NULL, FK `hospitals(hospital_code)` ON DELETE RESTRICT ON UPDATE CASCADE | 병원 위치 — 병원은 코드로(B-30) |
| `location_site_id` | INT NULL, FK `status_codes(id)` ON DELETE RESTRICT | 거점(DEVICE_SITE) |
| `location_changed_on` | DATE NULL | 위치 진입 업무일자 |
| CHECK `device_units_location_single_check` | `location_hospital_code IS NULL OR location_site_id IS NULL` | I-2 |
| CHECK `device_units_terminal_no_location_check` | `condition IS NULL OR condition NOT IN ('LOST','SCRAPPED') OR (location_hospital_code IS NULL AND location_site_id IS NULL)` | I-1 |
| 인덱스 | `(condition)`, 부분 `(location_site_id, condition) WHERE … NOT NULL`, 부분 `(location_hospital_code) WHERE … NOT NULL` | 목록 필터는 `unit:` 관계 조건 — DEV EXPLAIN에서 부분 인덱스 사용 확인(P1 검증) |

유닛 형상 체인(빠뜨리면 UI가 조용히 '미확인'으로 보임 — tsc가 잡지 않음): `UNIT_SELECT`(read.ts:944) → `UnitView`/`toUnitView` → `DeviceRaw`·`DeviceRef`/`toDeviceRef`(`app/devices/_components/types.ts`) → `projectionSnapshot`(deviceRegistryRoute.ts) · `DeviceRow`/`flattenDevice`(core.ts) · AS `detailInclude.items.select`(repairedAt·repairedBy·device.unit 3필드)·`listInclude`(repairedAt).

### 5.2 거점 마스터 — StatusCode `DEVICE_SITE` (B-30)

| name | value | order |
|---|---|---|
| 리프레시센터 | `REFRESH_CENTER` | 1 |
| thynC Connected Hub | `HUB` | 2 |

HDR D5·B-21 선례. 추후 WMS 편입은 `inventories.site_id → status_codes(id)`(Hub 하위) 한 컬럼(D3). 리프레시센터는 WMS 창고가 아니다(RECOVERED 1,468대 중 WMS 존재 2건). 설정 UI는 v1 비범위(2행 고정, seed·마이그 양쪽 INSERT).

### 5.3 `hospital_device_events` 확장

| 항목 | 변경 |
|---|---|
| `event_type` CHECK | 6종 → **10종**: + `INTAKE`(센터 입고) · `REPAIR_DONE`(수리 완료) · `SCRAP`(폐기) · `SITE_MOVE`(**위치 이동** — 거점↔거점 · 병원→거점(배치 RECOVERED/없음) · 거점→배치 병원(ACTIVE, 병원 반환)) |
| `hospital_check` | `event_type IN ('CORRECT','INTAKE','REPAIR_DONE','SCRAP','SITE_MOVE') OR hospital_code IS NOT NULL` — 회수 기기 이벤트 허용. 서비스는 **알 수 있으면 채운다**(ACTIVE면 배치 병원, RECOVERED면 `last_hospital_code`) — B-31 |
| `changes_check` | `event_type NOT IN ('CORRECT','INTAKE','REPAIR_DONE','SCRAP','SITE_MOVE') OR changes IS NOT NULL` — 신규 4종 스냅샷을 DB가 강제 |
| `changes` JSONB | `{ condition: {before, after}, location: {before, after, note?} }` — location 값 `{ kind: 'HOSPITAL'\|'SITE'\|null, code: hospitalCode\|siteValue\|null }`, `note`는 A-4(a)의 '입고 미확인' 표시(memo 컬럼이 아님 — 사용자 회수 메모와 분리, before 위치가 병원일 때만). 스냅샷 이벤트 전부에 실림(§0 용어, MOVE_WARD 제외). 기존 파서 `productTypeAfterOf/dealCodeAfterOf`는 키가 달라 무영향. 표시는 **문장화 헬퍼 1곳(`deviceDisplay.ts`)** 을 `changeSummaryLines`·`DeviceHistoryDrawer EventSummary`·`groupd-shared eventContent`·이벤트 export·PATCH 감사가 공유('위치 병원 A → 리프레시센터') |
| 신규 컬럼 | **없음** |
| fold | 4종 모두 배치 fold **비상태 이벤트**(`foldStepOk` true, `foldEvents` `continue`). **배치 상태 이벤트 0건 + 신규 4종/CORRECT만 남은 유닛의 재-fold는 EMPTY 처리**(현행 `events.length===0` 판정을 `DEVICE_STATE_EVENT_TYPES` 0건으로 — `projectionData`의 `status ?? 'ACTIVE'` CHECK 위반 차단, `cancelLastEvent`·`cancelImportBatch` 모두 `rebuildOrDelete` 경유, §7.0) |

### 5.4 `as_receipt_items` 확장

| 컬럼 | 타입/제약 | 근거 |
|---|---|---|
| `repaired_at` | DATE NULL | 수리완료 체크 업무일자 — 서버가 오늘 KST(B-34) |
| `repaired_by_id` | TEXT NULL, FK `users(id)` ON DELETE SET NULL | 체크한 사용자 |

라인 `repaired_at`은 접수 문맥의 기록, 기기 `condition=REPAIRED`는 실물 상태 — 같은 tx에서 함께 쓰되 단일 소스는 각자. 어긋나는 경로(시리얼 보정·원장 확정·병원 변경·드로어 수리완료/해제/폐기)는 §7.1·§7.3에서 재적용·동기화 규칙으로 닫는다.

### 5.5 Prisma 스케치

```prisma
model DeviceUnit {
  // … 기존
  condition            String?   // DEVICE_CONDITION 6종 (SQL CHECK) · NULL=미확인 — 유닛 속성(B-26, HDR 불변식 1·3 예외)
  conditionChangedOn   DateTime? @map("condition_changed_on") @db.Date
  locationHospitalCode String?   @map("location_hospital_code")
  locationSiteId       Int?      @map("location_site_id")     // DEVICE_SITE (REFRESH_CENTER/HUB)
  locationChangedOn    DateTime? @map("location_changed_on") @db.Date
  locationHospital     Hospital?   @relation("DeviceLocationHospital", fields: [locationHospitalCode], references: [hospitalCode], onDelete: Restrict, onUpdate: Cascade)
  locationSite         StatusCode? @relation("DeviceLocationSite", fields: [locationSiteId], references: [id], onDelete: Restrict)
  @@index([condition])
}
model AsReceiptItem {
  // … 기존
  repairedAt   DateTime? @map("repaired_at") @db.Date // 수리완료 체크(2026-09-17) — outcome과 독립인 제3축
  repairedById String?   @map("repaired_by_id")
  repairedBy   User?     @relation("AsItemRepairedBy", fields: [repairedById], references: [id], onDelete: SetNull)
}
```
Hospital(`deviceLocationUnits`)·StatusCode(`deviceSiteUnits`)·User(`asItemsRepaired`) 역관계 필수. 부분 인덱스·CHECK는 SQL-only(모델 헤더 주석에 열거).

### 5.6 코드 상수 (`lib/deviceRegistryShared.ts`)

- `DEVICE_EVENT_TYPES` += `'INTAKE' | 'REPAIR_DONE' | 'SCRAP' | 'SITE_MOVE'` + LABELS(입고·수리 완료·폐기·위치 이동)·COLORS. `DEVICE_STATE_EVENT_TYPES` 불변(3종).
- `DEVICE_TRANSITIONS` 4행 확장(배치 축 — SAME/OTHER는 호출부 ctx.hospitalCode 기준):

| from \ | INTAKE | REPAIR_DONE | SCRAP | SITE_MOVE |
|---|---|---|---|---|
| NONE | ok | ok | ok | ok |
| ACTIVE_SAME | ok | ok | invalid('배치 중 기기는 먼저 회수하세요') | ok(병원 반환만·condition IN_USE — 서비스 검증) |
| ACTIVE_OTHER | conflict(스킵+경고, 원장 확정에서 이관 후 재입고) | conflict | invalid | conflict |
| RECOVERED | ok | ok | ok | ok |

  `transitionMessage`에 신규 4종 invalid 문구 분기 추가.
- `DEVICE_CONDITIONS`·`DEVICE_CONDITION_LABELS`(사용중/AS접수/수리완료/출고 전/분실/폐기)·`DEVICE_CONDITION_UNKNOWN_LABEL='미확인'`·COLORS, `CONDITION_FILTERS`(6종 + `none`).
- `DEVICE_SITE_CATEGORY='DEVICE_SITE'`, `DEVICE_SITE_VALUES=['REFRESH_CENTER','HUB']`, 폴백 라벨. `LOCATION_FILTERS=['HOSPITAL','REFRESH_CENTER','HUB','none']`.
- `RECOVERY_REASON_CONDITION: Partial<Record<RecoveryReasonValue, DeviceCondition>> = { DEFECT:'AS_WAITING', LOST:'LOST', DISPOSE:'SCRAPPED' }` — RETURN·TRANSFER·value NULL은 keep(§4.2). DEFECT의 위치는 A-4. `REGISTRY_SOURCES` 주석 'BACKFILL = 유닛 생성·상태축 소급 백필'로 개정.
- `lib/asReceiptShared.ts`: `canMarkAsLineRepaired({intakeState, outcome})` = `intakeState==='RECEIVED' && !['LOST','CANCELED','NOT_RECEIVED'].includes(outcome)`.

---

## 6. 화면

### 6.1 AS 상세 3번 카드 (`app/as-receipts/[id]/page.tsx`)

- 헤더 컬럼 배열(`:274`) `['시리얼','입고','병동','증상','처리내용','수리완료','결과','교체기','발송']` — **'처리내용'과 '결과' 사이**. 셀은 `:311` 처리내용 `</td>` 직후(헤더 배열과 셀 나열이 분리된 정적 구조 — 동시 수정).
- 셀: 체크박스 + 체크 시 `d10(repairedAt)`·툴팁 `수리완료 09-16 홍길동`. 활성 조건 = `!VIEWER && !busy && canMarkAsLineRepaired(item)`. 비활성 사유 툴팁: '입고 후 체크할 수 있습니다' / '분실·취소·미회수 라인'. 판정은 `intakeState` 필드로 직접(`intakeBadge`는 outcome 있으면 숨겨짐).
- 체크 → `POST /api/as-receipts/[id]/repair-done { itemId, repaired }` → `router.refresh()` + `load()`. 응답 `warnings`는 amber 배너.
- 카드 헤더 칩(`:257-261`): `수리완료 n/m` — **m = 체크 가능 라인 수**(`canMarkAsLineRepaired`), n = `repairedAt` 있음. m=0이면 숨김. n<m amber, n=m green.
- 시리얼 셀 배지: 유닛 condition `REPAIRED`(green)·`SCRAPPED`(gray)·`LOST`(red) 소형 배지 + 툴팁에 위치.
- **[폐기]**: 수리완료 셀 오른쪽 소형 텍스트 버튼 — 조건 `canMarkAsLineRepaired(item) && placement.status==='RECOVERED' && condition ∉ {SCRAPPED, LOST}`, 권한은 체크박스와 동일(`!VIEWER` — A-5). `confirm()` + **memo 필수** 프롬프트(오폐기 완화) → `POST /api/as-receipts/[id]/scrap-line`. 라인 `repaired_at`은 같은 tx에서 NULL(비고 이력).
- 결과 확정된 라인(REPAIR_RETURN·REPLACE)도 체크 가능(선교체). 접수 종결 후에도 체크 가능(§7.2, A-2).
- 목록: '기기' 셀 기기군 배지에 `수리 n/m` 병기(`summarizeAsItemsByGroup` 확장, m>0일 때만). 엑셀 export: '처리내용' 뒤 '수리완료일' 열(+`!cols` 폭 배열 동기화).
- 타임라인(5번 카드): audit `resourceLabel` 접미어 `수리완료` / `수리완료 해제` / `폐기` 분기(`summarizeAudit`).

### 6.2 기기현황 `/devices`

- 목록(`DeviceTable`·`DeviceListTab`): 기존 '상태' 열 헤더 → **'배치'**(값 불변), 새 열 **'기기 상태'**(condition 배지, NULL='미확인' gray) · **'위치'**(병원명/리프레시센터/thynC Connected Hub/—). compact 기본 7열에는 '기기 상태'만 추가.
- 필터: `condition=`·`location=` — 서버 `UnitsQuery`/`buildUnitsWhere`(`unit:` 관계 조건)·`_read.ts` 파서·클라이언트 `unitsQuery`/`ListFilters`/`GlobalListFilters`/`urlState` 1:1 확장. 회수 목록 `condition=REPAIRED&location=REFRESH_CENTER` = 교체품 가용(I-5 v1 부분집합).
- 드로어 헤더: 배치 배지 뒤 condition 배지 + 설명 줄 `· 위치: 리프레시센터 (09-14~)`. 액션(병원 문맥 무관 경로 — `onAction` asOpen/asClear 패턴):
  - 배치 RECOVERED/없음: **[수리완료]**(AS_WAITING/NULL) · **[수리완료 해제]**(REPAIRED) · **[폐기]**(write USER+ — A-5, SCRAPPED·LOST 아님, memo 필수) · **[위치 이동]**(현재 위치 무관 → 목적지 거점 리프레시센터/Hub)
  - 배치 ACTIVE ∧ 위치 거점 ∧ **condition IN_USE**: **[병원 반환]**(위치 → 배치 병원, SITE_MOVE) — 취소 라인·수동 해제 등 I-4 예외 해소 경로. AS_WAITING/REPAIRED에는 노출하지 않음(AS 상세에서 확정)
  - 드로어 [수리완료]·[수리완료 해제]·[폐기]는 **라인 동기화**: 그 기기의 `intake_state='RECEIVED' ∧ outcome ∉ {LOST, CANCELED, NOT_RECEIVED}` 라인(= `canMarkAsLineRepaired`, 종결 접수 포함 — A-2, 선교체 REPLACE·RECEIVED 19건 포함)에 대해 수리완료는 그중 `repaired_at IS NULL`인 라인에 기록, 해제·폐기는 전부 NULL — 같은 tx + 접수 비고 이력. 드로어 경로의 이벤트는 **ref 없음**(어느 접수든 `ownsDeviceState` 통과).
- 이벤트 행(`EventSummary`, `EVENT_BADGE_VARIANT` Record 확장, `groupd-shared eventContent`): INTAKE '리프레시센터 입고(AS-…)' · REPAIR_DONE '수리 완료' · SCRAP '폐기' · SITE_MOVE '위치 이동 A→B' · CORRECT에 condition/location 변경 문장 · REGISTER/RECOVER/AS_* 행에 `→ 사용중·병원`(changes 스냅샷). 드로어는 occurred_on 정렬이라 소급 확정(초안 발송일) 시 REPAIR_DONE이 AS_CLEAR 뒤에 보일 수 있음(주석).
- 정정(`EventEditForm`/admin.ts `EVENT_PATCH_KEYS`): 신규 4종은 `occurredOn`·`memo`·`ref`만(현행 키 집합). CORRECT PATCH(`CorrectChanges`)에 `condition`·`location` 추가 — admin/device.admin 보정 경로(§8.1), 배치 무관 조회. 라우트 감사 라벨 '기기 상태 보정'/'위치 보정'(`OPS_KEYS` 확장, 스냅샷은 문장화 값).
- 엑셀 export: '상태' 열 뒤 '기기 상태'·'위치' 열 + `colWidths` 배열 동기화. 이벤트 export 요약 switch에 4종 + changes 문장('내용' 열 폭 30→48 — 스냅샷 병기로 길어짐).
- `SerialLookup`·`registryFormKit.StatusBadge`: condition 병기. ReplaceModal 추천 콤보는 Phase 2(교체기 REPAIRED 아님 경고는 서비스 warnings로 v1 노출).

### 6.3 공통

- 라벨 표: condition 6종+미확인 / 위치 3종(병원·리프레시센터·thynC Connected Hub)+'—' / 이벤트 4종(입고·수리 완료·폐기·위치 이동).
- 오류 문구 표: '입고된 라인만 수리완료 처리할 수 있습니다'(400) · '분실·취소·미회수 라인은 수리완료 대상이 아닙니다'(400) · '사용중 기기는 수리완료 처리할 수 없습니다'(409) · '배치 중 기기는 먼저 회수하세요'(409) · '폐기된 기기입니다 — 정정 후 등록하세요'(409) · '동시에 변경되어 다시 시도하세요'(409) · '미종결 입고 라인 — AS 상세에서 확정하세요'(409) · '기기 상태 미확인 — 관리 보정으로 상태를 지정한 뒤 반환하세요'(409) · '업무일자 순서와 기록 순서가 어긋나 정정할 수 없습니다 — 최근 이벤트를 먼저 취소하세요'(409, 이벤트 정정) · '다른 병원에 배치 중인 기기입니다 — 원장 확정에서 이관 후 입고하세요'(경고) · '다른 접수(AS-…)가 최근 상태를 기록 — 유지'(경고).
- 빈 상태: 회수 목록 필터 결과 0 → '조건에 맞는 기기가 없습니다'. 모바일: 드로어 액션은 세로 스택, AS 표는 가로 스크롤(열 숨김 없음).

---

## 7. API

### 7.0 서비스 계층 (`lib/deviceRegistry`)

신규 모듈 `lib/deviceRegistry/condition.ts`(index.ts 재export). **공통 규약**: 조회는 `deviceUnit.findUnique` + `hospitalDevice.findUnique`(nullable) — `getDeviceOr404` 사용 금지(배치 없는 유닛 404). 배치 축 판정(`assertTransition`)은 **호출부 ctx.hospitalCode(접수 병원)** 와 배치 병원을 비교해 먼저 수행(ACTIVE_OTHER conflict 도달 가능)하고, 통과 후 이벤트 hospital_code·`prepareCtx(tx, {...ctx, hospitalCode: 배치 병원 ?? last_hospital_code ?? null}, {requireHospital:false})` 문맥만 채운다; `validateRef`의 '다른 병원' 경고는 배치 RECOVERED/없음일 때 억제. 호출부는 `ctx.actionGroup`을 넘기지 않는다(REGISTER 그룹 합류 시 LIFO 취소 확장에 휘말림).

| 함수 | 동작 | 게이트 |
|---|---|---|
| `applyUnitState(tx, unit, next, ev)` (내부) | §4.1 쓰기 순서 1(가드 → 이벤트). 변화 없으면 `{changed:false}`·이벤트 없음(멱등). **INTAKE 예외(B-37)**: 변화가 없어도 **첫 ref면 기록**(접수 연결 이력); 같은 (ref, device, INTAKE)가 있고 **변화도 없을 때만** 스킵; 변화가 있으면 같은 ref가 있어도 갱신·기록. 스킵 판정에서 `source='BACKFILL'` 이벤트는 제외 | 낙관 가드(409 RegistryError, 쓰기 없음) |
| `applyImplicitTransition(tx, unit, placement, eventType, reasonValue?)` (내부) | §4.1 쓰기 순서 2 — 2-phase `{changes, apply()}`: 검증 후 changes 계산(이벤트 행에 실림) → 호출부 insert·rebuild → `apply()` 가드 UPDATE, 실패 시 `RegistryTxAbort`. 단건·일괄·교체·임포트·WMS 출고 공용 | |
| `intakeDevice(ctx, {deviceId, site='REFRESH_CENTER'})` | §4.2 INTAKE 열. hospital_code = 배치 병원 ?? last_hospital_code | ①배치 축(ACTIVE_OTHER conflict) ②condition |
| `markDeviceRepaired(ctx, {deviceId})` | AS_WAITING/NULL→REPAIRED(REPAIR_DONE). REPAIRED면 `{changed:false}`. IN_USE 409, PRE_SHIP/LOST/SCRAPPED 409 | |
| `undoDeviceRepaired(ctx, {deviceId})` | REPAIRED→AS_WAITING **CORRECT**를 condition.ts 안에서 직접 적재(`correctDevice` 미경유). 그 외 409 | B-27 |
| `scrapDevice(ctx, {deviceId, memo?})` | 배치 ACTIVE 409(I-3) · LOST 409 → SCRAPPED·위치 NULL(SCRAP) | A-5 권한은 라우트 |
| `moveDeviceLocation(ctx, {deviceId, to: 'REFRESH_CENTER'\|'HUB'\|'HOSPITAL'})` | 배치 ACTIVE: `to='HOSPITAL'`(배치 병원)만·condition IN_USE만(§4.2 각주 ²). RECOVERED/없음: 현재 위치 무관, 목적지 거점만. SITE_MOVE | |

기존 함수의 암묵 전이(공용 헬퍼, 적재 이벤트 순서대로 1건씩):

| 함수 | 부수 갱신 |
|---|---|
| `registerDevicesIn` (created·reregistered·transferred) | REGISTER → IN_USE·위치 병원(changed_on = occurredOn). transfer는 RECOVER(TRANSFER, keep) → REGISTER. **SCRAPPED 유닛 409** '폐기된 기기입니다 — 정정 후 등록'. skipped 무변경. 재등록 유닛 condition ∉ {REPAIRED, IN_USE}면 warnings 1건 '{serial}: 기기 상태 {AS접수\|미확인} — 수리완료 체크 없이 재사용' |
| `replaceDevice` | backfill 구기기: **SCRAPPED 409** → REGISTER(IN_USE·병원) → RECOVER(사유 매핑) / active_here 구기기: RECOVER(사유 매핑: DEFECT→AS_WAITING·위치 **A-4**((a)면 `changes.location.note='입고 미확인'` — before 위치가 병원일 때만; 이미 센터면 note 없음), LOST→LOST·NULL, DISPOSE→SCRAPPED·NULL) / recovered_here 구기기: **무변경** / 신기기 create·reregister: REGISTER(IN_USE·병원, SCRAPPED 409 — resolveAsLines 관례상 전체 중단, REPAIRED 아니면 경고) / transfer: RECOVER(TRANSFER)→REGISTER / active_here 신기기: 무변경 |
| `recoverDevice` · `bulkDeviceAction`(RECOVER·AS_OPEN·AS_CLEAR 분기 — 현재 단건 함수 미경유·`insertEvents` 직접) | 사유 value 매핑 §5.6(DEFECT 위치는 **A-4 — 단건·일괄·교체 동일**) + 스냅샷. 일괄도 단건과 동일 결과 |
| `openDeviceAs` | IN_USE/REPAIRED/NULL→AS_WAITING(위치 유지) |
| `clearDeviceAs(ctx, {deviceId, locationToHospital=false})` | AS_WAITING/REPAIRED/NULL→IN_USE. `locationToHospital=true`는 **AS 서비스 훅(`setUnitInUse`)이 호출할 때만**; /devices 단건·일괄 수동 AS_CLEAR는 위치 유지 + warnings '미종결 입고 라인(AS-…) 있음' |
| `correctDevice` `CorrectChanges` | `condition?`, `location?: {kind, code}` 추가 — 검증(I-1·I-3·전이표), `CORRECT_UNIT_FIELDS` 일반 루프에서 제외하고 전용 매핑(location `{kind,code}` → 2컬럼, SITE는 value→id). 배치 무관 조회 |
| `cancelLastEvent` · `cancelCorrectEvent` | §8.2 신설 규약(`assertNoLaterSnapshot`·`cancelUnitStateEvent` 분기·재도출). `cancelCorrectEvent` 조회(admin.ts:145·:177)는 배치 무관으로 |
| `cancelImportBatch` · `cancelEventsOfRef`(스텁) | `rebuildOrDelete` 경유, 배치 행이 삭제되는 유닛은 §8.2 재도출(NULL) + warnings |
| `rebuildUnitProjection` / `rebuildOrDelete` | EMPTY 판정 = **배치 상태 이벤트 0건**(fold `state.status==null`이면 배치 행 삭제). `cancelLastEvent`(admin.ts:258-266)의 자체 `count` 판정을 `rebuildOrDelete` 경유로 교체, `status ?? 'ACTIVE'` 제거 |

**ref 규칙**: AS 라우트 경유 이벤트(INTAKE·REPAIR_DONE·SCRAP·해제 CORRECT·setUnitInUse 폴백)는 `ref={AS, asCode}`; /devices 드로어·PATCH 경유는 ref 없음. `ownsDeviceState`·B-37 스킵이 ref_code에 의존하므로 **이벤트 ref 정정(§8.2 3)은 게이트·스킵 판정을 바꾼다**(admin 주의 문구).

**갱신 지점 전수(코드 대조)**: `RegistryTxAbort` → 409 매핑(공통 `toRegistryErrorResponse` 헬퍼 — core.ts, `app/api/devices/_read.ts`, `lib/deviceRegistryRoute.ts`, `app/api/hospitals/[code]/devices/shared.ts`, AS 라우트 6파일 `app/api/as-receipts/[id]/{route,intake-confirm,registry-confirm,confirm-lines,resolve-items,correct-serial}` — P1 완료; `route.ts` DELETE의 `if (!(e instanceof RegistryError)) throw e`는 TxAbort를 전파해야 하므로 유지) · `foldStepOk`(신규 4종 true) · `foldEvents`(continue) · `stateEventsAfter`(core.ts:496 — 4종 제외, AS_*는 현행 유지) · `import.ts:485-492·536-537 lastStateOn`(같은 필터) · `import.ts:496-509` 유닛 판정에 `condition==='SCRAPPED'` → error(미리보기/실행 일치) · `admin.ts assertSuffix`(**배치 축 이벤트만** occurred_on 순 검사, 신규 4종·CORRECT 제외 — 스냅샷 판정은 §8.2 1) · `admin.ts cancelImportBatch`(:349-358·378-392 CORRECT-only 필터 — 상태 스냅샷 CORRECT는 보존, 스냅샷 판정은 `laterSnapshotOutside` 메모리 1회) · `admin.ts:258-266 cancelLastEvent` 배치 삭제 판정 · `admin.ts:145·:177 cancelCorrectEvent` 조회 · `editEvent` 반환 device nullable · read.ts 요약 lastEvent(:337·:707 제외) · events30d(:807)·lastRef(:1141) **포함 유지** · `correctDevice` sole 판정(자동) · `DeviceHistoryDrawer.tsx:64-71 EVENT_BADGE_VARIANT`(Record — 컴파일 강제) · `transitionMessage` · `deviceDisplay.ts` 문장화 헬퍼(단일) → `changeSummaryLines`·`groupd-shared.tsx:73-103 eventContent`·`events/export/route.ts:35-43`·`app/api/devices/units/[id]/route.ts:150-175`(라벨·OPS_KEYS) · `scripts/smoke-device-registry-shared.mts:117-125` 전이표 기대표 · `DeviceRow/flattenDevice`·`projectionSnapshot` · `UNIT_SELECT`→`toUnitView`→`DeviceRaw`·`DeviceRef` · AS `detailInclude`·`listInclude` · `/api/health`에 `eventTypes`·빌드 커밋 노출(A.0 가드).

### 7.1 엔드포인트

| 메서드·경로 | 동작 | 권한 | 감사 |
|---|---|---|---|
| `POST /api/as-receipts/[id]/repair-done` `{itemId, repaired}` | §7.2 게이트 → `repaired_at/by` → `markDeviceRepaired`/`undoDeviceRepaired`(RegistryError→warnings — 단 낙관 가드 409 '동시에 변경'은 **전파**해 tx 롤백·409 응답, §7.4) → 비고 `[수리완료 09-17 홍길동] P018330` / `[수리완료 해제 …]`(라인·기기 중 하나라도 바뀐 호출만 — 재체크는 멱등·경고 '변경 사항 없음', P2 리뷰 2026-09-17) | **`!VIEWER`만(ship-info 골격, `canEditAsReceipt` 미사용)** — 종결 접수 허용(A-2) | `as_receipt` `${asCode} 수리완료`/`수리완료 해제`, after `{itemId, serialNo, repaired, repairedAt, warnings}` + `syncTicketClocksSafe` |
| `POST /api/as-receipts/[id]/scrap-line` `{itemId, memo}` | 라인 소속·`canMarkAsLineRepaired`·deviceId 필수(미등록 400)·condition ∉ {LOST,SCRAPPED}·**memo 필수(400)** → `scrapDevice`(배치 ACTIVE 409; **배치 행 없는 유닛**(REGISTER 취소 등)은 허용 — UI [폐기]는 RECOVERED만 노출(§6.1)이라 화면에서 도달하지 않는 서버 허용 집합) → 라인 `repaired_at/by` NULL → 비고 `[폐기 …] memo` | `!VIEWER`(A-5 — 라인 처리와 동일) | `${asCode} 폐기` |
| `POST /api/devices/units/[id]/repair-done` / `repair-undo` / `scrap` / `location` `{to}` | 드로어 액션 — `recover/route.ts` 골격. **repair-done·repair-undo·scrap 모두 라인 동기화**(§6.2). scrap은 memo 필수 | write(USER+) — scrap 포함(A-5) | `hospital_device` `deviceAuditLabel + '수리 완료'/'수리완료 해제'/'폐기'/'위치 이동'`, before/after `projectionSnapshot`(condition/location 포함) |
| `GET /api/devices/units?condition=&location=` · `/export` | 필터 확장 | 기존 | — |
| `PATCH /api/devices/units/[id]` `{condition?, location?}` | CORRECT 보정(PRE_SHIP 진입로 — A-6) | admin OR device.admin | '기기 상태 보정'/'위치 보정' 라벨 |
| `GET /api/as-receipts/[id]` · 목록 | `items[].repairedAt/repairedBy{id,name}`, `device.unit{condition, locationSiteValue, locationHospitalCode}` | 기존 | — |
| `GET /api/health` | 응답에 `eventTypes`(DEVICE_EVENT_TYPES)·`buildCommit`(next.config `env.GIT_COMMIT` — 빌드 시 `git rev-parse --short HEAD`를 번들에 인라인, git 없으면 null) 추가 | 기존 | — |

### 7.2 수리완료 게이트 (라인 단위 — 접수 상태 무관)

| 조건 | 판정 |
|---|---|
| 라인이 이 접수 소속 아님 | 400 |
| `intake_state ≠ 'RECEIVED'` | 400 '입고된 라인만 수리완료 처리할 수 있습니다' (D5) |
| `outcome ∈ {LOST, CANCELED, NOT_RECEIVED}` | 400 |
| `outcome ∈ {NULL, REPAIR_RETURN, REPLACE}` | 허용(선교체·확정 후 수리) |
| 접수 상태 종결(완료·취소) | **허용**(A-2) — 근거: 완료 전 사후 입고된 선교체 REPLACE·RECEIVED 라인 19건 실존, 선교체 구기기는 접수 완료 후 수리됨. 짝으로 `intakeAsLines` 종결 게이트 조건부 완화(§7.3). 다른 라인 API의 409 규약과 다름을 라우트 주석에 명시 |
| `deviceId NULL`(미등록) | 라인만 기록 + 경고. 이후 원장 확정 시 재적용(§7.3) |
| 기기 condition IN_USE (이미 반환 확정) | 라인 기록 + 경고 '기기는 이미 사용중' |
| 해제(`repaired=false`) | `repaired_at` NULL; 기기 REPAIRED면 CORRECT로 AS_WAITING, 아니면 경고 |

이 API는 `outcome`·`draft_*`·헤더 상태·`advanceToShippedDone`·`completeAsReceipt`·`reopen`을 **절대 건드리지 않는다**.

### 7.3 AS 서비스 훅 (`lib/asReceiptService.ts`)

**되돌림 게이트** `ownsDeviceState(asCode, unit)` = 그 유닛의 **id 순 마지막 스냅샷 이벤트**의 ref가 `{AS, asCode}` 이거나 **AS ref가 아님**(ref 없음 — REGISTER·드로어 경유 — 과 INVENTORY_TX·MAINTENANCE 등 비AS ref 모두), **또는 스냅샷 이벤트가 0건**(배포 전 이벤트만 가진 유닛 — 규칙 1·2·5·6 대상 26,885대의 첫 확정). 불통과는 **타 접수**(`ref_type='AS' ∧ ref_code ≠ asCode`)뿐(P2 리뷰 2026-09-17: ref_type 미검사로 WMS 출고 REGISTER 등 비AS ref를 '다른 접수'로 오판·오도하던 결함 수정). **공통 헬퍼** `setUnitInUse(tx, ctx, deviceId, {locationToHospital})`: 게이트 **통과 시에만**, 배치 **ACTIVE_SAME에서만**(RECOVERED/타병원 ACTIVE면 경고만) `applyUnitState({condition:'IN_USE', location: locationToHospital ? 배치 병원 : 유지})`를 플래그 유무와 무관하게 실행. 스냅샷을 싣는 이벤트는 **플래그 소유 여부로 분기**: `as_ref_code === asCode`(이 접수가 켠 플래그)면 `clearDeviceAs(locationToHospital)`의 AS_CLEAR 행 / 플래그가 없거나 **타 접수 플래그**면 **CORRECT** + 플래그 유지 + 경고 '다른 접수(AS-…)의 AS 표시가 남아 있습니다'(§4.4 "플래그 = 열린 접수가 있음" 보존 — 현행 resolveAsLines의 소유 무관 해제를 소유 판정으로 조인다). 게이트 불통과면 경고 '다른 접수(AS-…)가 최근 상태를 기록 — 유지'(이 접수가 켠 플래그가 남는 경우 ' · 이 접수의 AS 표시가 남아 있습니다 — 기기현황에서 해제하세요'를 덧붙임 — 플래그는 유지, /devices 수동 AS 해제로 해소. 스모크 [C-3]). 마지막 쓰기 승(§7.4)은 입고·수리처럼 실물 근거가 있는 쓰기에 한하며, **IN_USE 복귀는 게이트를 통과한 접수만** 수행한다. **처리일 클램프**(P2 리뷰 2026-09-17): 플래그 소유 분기에서 처리일(`ctx.occurredOn`)이 `as_started_on`보다 앞서면 AS_CLEAR 업무일자를 `max(처리일, as_started_on)`으로 기록하고 경고 '처리일(D-1)이 AS 표시 시작일(D0)보다 앞서 AS 해제를 D0로 기록했습니다' 1건 — '미등록 라인 → 발송(D-1) → 원장 확정(AS_OPEN=오늘) → 최종확정(effectiveDate=발송일)' 흐름에서 소급 차단(§8.2 1) 409가 흡수돼 기기가 AS_WAITING·센터·플래그로 남던 결함 해소(이전 문구 '처리일을 표시 시작일 이후로 다시 처리'의 자동화). CORRECT 폴백은 배치 축이 아니라 클램프 대상이 아님(스모크 [C-16]).

체크된 라인(`repaired_at` 있음)이 이후 LOST·CANCELED·NOT_RECEIVED로 확정되면 해당 분기(resolveAsLines·confirmAsIntake)에서 `repaired_at/by`를 NULL로 + 비고 이력 — n/m의 n이 m 집합 밖에 남지 않게 한다.

CORRECT 폴백의 기록 규칙: `ref = {AS, asCode}`(DELETE 접수도 삭제 전 삽입이라 `validateRef` 통과 — 삭제 후 소프트 참조로 잔존), `hospital_code = 배치 병원 ?? last_hospital_code`, memo:

| 경로 | memo |
|---|---|
| resolveAsLines REPAIR_RETURN | `수리반환 확정 AS-…` |
| resolveAsLines CANCELED | `라인 취소 AS-…` |
| confirmAsIntake NOT_RECEIVED | `미회수 확정 AS-…` |
| applyItemChanges 제거 | `라인 제거 AS-…` |
| DELETE 접수 | `접수 삭제 AS-…` |
| correctAsLineSerial 구기기 | `시리얼 보정 AS-… (A → B)` |
| confirmAsIntake REMAP 치환 전 기기 | `시리얼 치환 AS-… (A → B)` — 치환 전 기기는 실물 미도착이라 IN_USE·병원 복귀(시리얼 보정과 동일), 치환된 기기는 `intakeDevice`(스모크 [C-15]) |

| 지점 | 추가 |
|---|---|
| `createAsReceipt`/`openAsFlags` | 변경 없음(`openDeviceAs` 부수 갱신 AS_WAITING). 플래그 스킵이면 condition 무변경 |
| `intakeAsLines` 일치 라인 RECEIVED 전환·종결 라인 사후 입고 | deviceId 있고 `outcome ∈ {NULL, REPLACE}`만 `intakeDevice(ctx(receivedAt))`; `outcome ∈ {REPAIR_RETURN, CANCELED, LOST, NOT_RECEIVED}`는 원장 스킵+경고(라인 intake_state만). **EXTRA 생성 시점은 원장 무기록**(기존 원칙). **종결 접수 사후 입고(조건부 완화)**: (i) 입력 시리얼 전부가 `outcome='REPLACE' ∧ intake_state ∈ {PENDING, RECEIVED}` 라인과 일치할 때만(RECEIVED는 무변경 통과 — 재입력 멱등; 불일치 시리얼 1건이라도 있으면 400, EXTRA 생성 금지), 전환 0건이면 비고도 기록하지 않고 경고 '변경 사항 없음'(호출마다 비고 줄 누적 방지 — P2 리뷰 2026-09-17) (ii) 입력에 없는 라인의 MISMATCH 전환 없음 (iii) 헤더 status/received_at/checked_at 갱신 없음·비고 이력만 (iv) `advanceToShippedDone` 미호출 |
| `confirmAsIntake` | MARK_RECEIVED·ACCEPT_EXTRA(`occurredOn = 라인 receivedAt ?? today`)·REMAP(치환된 deviceId, `occurredOn = extra.receivedAt`)에서 `intakeDevice` — REMAP은 **치환 전 기기**에 `setUnitInUse(true, memo '시리얼 치환')`도 수행(위 memo 표); DISCARD_EXTRA 원장 무변경; NOT_RECEIVED → `ownsDeviceState`면 `setUnitInUse(true)`, 아니면 경고 |
| `resolveAsLines` | REPAIR_RETURN → `ownsDeviceState`면 `setUnitInUse(true)` / CANCELED → `ownsDeviceState`면 `setUnitInUse(false)` / 불통과는 경고 / REPLACE·LOST → 원장 함수 내부 암묵 전이(REPLACE 구기기 위치는 A-4) |
| `applyItemChanges` 제거 라인·DELETE 접수·`correctAsLineSerial` 구기기 | `ownsDeviceState`면 `setUnitInUse(true)`(실물 이동 근거 없음 → 병원 복귀), 아니면 경고 |
| `correctAsLineSerial` 신기기·`confirmAsRegistry`·병원 변경 재생성 라인 | 라인 `intake_state='RECEIVED'`면 새 deviceId에 `intakeDevice(occurredOn=received_at)`; `repaired_at`이 있으면 `markDeviceRepaired(occurredOn=repaired_at)`까지 **재적용**. 병원 변경 재생성 data에 `intake_state/received_at/receipt_serial_no/repaired_at/by` **보존**(기존 유실 결함 동반 수정) |
| 신규 `setAsLineRepaired`, `scrapAsLineDevice` | §7.1 |
| 종결 우회 경로(PUT statusId·티켓 전이 동기화)로 '취소' 진입 | **v1 비범위** — `--dry` 리포트에 '취소 접수의 AS_WAITING 기기 목록' 출력(§9.1) |

### 7.4 멱등·트랜잭션·동시성

- 신규 서비스는 모두 `withRegistryTx(opts)`로 호출부 tx 합류(AS 서비스는 `{client: tx}` — savepoint 없음). 그래서 §4.1 쓰기 순서 두 모드가 정합의 전제다.
- 이벤트 멱등 UNIQUE는 WMS/ONPREM만(불변식 8) — 신규 함수는 변화 없으면 이벤트를 만들지 않는다(INTAKE B-37 예외).
- 장기 tx(intake 60s·resolve 120s)와 체크박스 연타·채널톡 1분 폴링의 경합은 가드 409(신규 서비스) 또는 `RegistryTxAbort`(암묵 전이) → 화면 재시도 안내. `setAsLineRepaired`는 가드 409를 경고로 흡수하지 않고 **전파**한다(라인 `repaired_at`만 커밋되고 기기 미반영인 반쪽 상태 방지 — P2 리뷰 2026-09-17). 채널톡 인입의 `RegistryTxAbort`는 §9.5.
- 한 기기가 여러 미종결 접수에 걸린 10대: 입고·수리 등 실물 근거가 있는 쓰기는 기기 단위 마지막 쓰기 승; IN_USE 복귀는 `ownsDeviceState` 통과 접수만. 접수 등록 시 차단하지 않는다(경고만).

---

## 8. 권한·감사

### 8.1 권한 합성
- 수리완료 체크·해제(AS 상세·드로어): `isUserOrAbove` — 라인 처리와 동일, 신규 권한 키 없음.
- **폐기(A-5 — 사용자 결정 2026-09-17)**: AS 업무 권한과 동일 — AS 상세는 `!VIEWER`, /devices는 write(USER+). 되돌리기(CORRECT·LIFO 취소)는 admin 경로(D10)라 오폐기 완화책을 둔다: confirm + **memo 필수**, 폐기 기기는 등록·교체기·출고 사전 검증에서 즉시 드러남(§7.0·§9.3), 감사 로그·타임라인에 실행자 기록.
- /devices [위치 이동]·[병원 반환]: write(USER+).
- condition/location 직접 보정(PATCH CORRECT)·이벤트 정정·취소: admin OR `device.admin`(D10).

### 8.2 취소·정정 규약 (신설 — 단일 정렬 기준 = id)
1. **스냅샷 이벤트 취소**(§0 정의의 스냅샷 이벤트 전부 — MOVE_WARD 제외): 같은 유닛에 **id가 더 큰 스냅샷 이벤트**가 취소 집합 밖에 있으면 409 — 공통 헬퍼 `assertNoLaterSnapshot`를 `cancelCorrectEvent`·generic 경로에 함께 적용. `assertSuffix`는 **배치 축 이벤트만 occurred_on 순**으로 검사하고 신규 4종·CORRECT는 제외한다(B-35). 신규 4종은 `cancelUnitStateEvent` 분기(단건, action_group 확장 없음)에서 `changes.before` 복원(location은 전용 매핑). 예: 소급 AS_CLEAR(id n+1) 뒤 REPAIR_DONE(id n) 취소 → 409(AS_CLEAR 먼저); REGISTER(오늘, id n) + INTAKE(과거일, id n+1) → REGISTER 취소 409. **소급 삽입 차단(P1 리뷰 반영 2026-09-17)**: AS_OPEN·AS_CLEAR(단건·일괄)는 업무일자 이후에 **스냅샷 배치 축 이벤트**(REGISTER·RECOVER·AS_OPEN·AS_CLEAR — changes 보유)가 있으면 409 '업무일자 이후 배치 이벤트가 있어 소급 기록할 수 없습니다 — 최근 이벤트를 먼저 취소하세요'(`assertNoLaterSnapshotAxisEvent`). 허용하면 occurred_on 순(`assertSuffix`)과 id 순(`assertNoLaterSnapshot`)이 역전된 쌍이 생겨 두 이벤트 모두 취소 불가(교착)가 되기 때문. MOVE_WARD(비스냅샷)·배포 전 이벤트(스냅샷 없음)는 취소 순서로 풀리므로 대상 아님. REGISTER·RECOVER 소급은 `stateEventsAfter`·`assertReregisterConsistent`·retroIllegal이 이미 차단.
2. **배치 축 이벤트 취소 후 유닛 재도출**(B-32) — 우선순위: ① 남은 이벤트 중 **id 최대 스냅샷 이벤트의 after**(I-6 그대로) → ② 없으면 **취소된 이벤트 자신의 `changes.before` 복원**(B-28로 배포 후 이벤트는 항상 보유 — 배포 전 이벤트만 남은 유닛에서 AS_CLEAR를 취소해도 AS_WAITING으로 돌아가 §4.4 정합) → ③ 그것도 없으면(구 이벤트·`cancelImportBatch`) 배치 rebuild 결과로 파생: ACTIVE→IN_USE·배치 병원(플래그 켜져 있으면 AS_WAITING) / RECOVERED→NULL·위치 센터 / 배치 행 삭제→condition·location NULL. 재도출 결과가 I-3·I-4를 깨면 409가 아니라 응답 `warnings`에 기재. 취소·재도출 후 `condition_changed_on`/`location_changed_on`은 **축별**(`axisChangedOnFrom`) — 남은 스냅샷 중 그 축을 마지막으로 바꾼(before≠after) 이벤트의 업무일자(정방향 `applyUnitState`의 축별 갱신과 대칭; 바꾼 이벤트가 없으면 id 최대 스냅샷 일자로 근사, ②는 NULL, ③은 배치 일자 — P2 리뷰 2026-09-17, 스모크 [1e-4](h)). `cancelImportBatch`도 동일(`rebuildOrDelete` 경유) — 단, 배치 행이 사라지는 유닛의 CORRECT 중 **상태 스냅샷 CORRECT(condition/location 키)는 보존**하고 유닛·배치 속성 CORRECT만 삭제한다(재도출 ①이 취소 전 값을 되찾도록, A-6 PRE_SHIP 진입 이력 보호 — P1 리뷰 반영 2026-09-17; 유닛 속성 CORRECT 삭제는 기존 동작 유지, 별건 재검토). 배치 취소의 스냅샷 판정은 기기당 메모리 1회(`laterSnapshotOutside`, 적재된 전 이벤트) — 배치 행 수만큼 쿼리하지 않는다.
3. 이벤트 정정(`editEvent`): 신규 4종은 `occurredOn`·`memo`·`ref`만(현행 `EVENT_PATCH_KEYS`). occurredOn 정정은 유닛 값에 영향 없음(id 순). **배치 축 스냅샷 이벤트(REGISTER·RECOVER·AS_OPEN·AS_CLEAR, changes 보유)의 occurredOn 정정은 같은 유닛의 다른 배치 축 스냅샷 이벤트와 (id < 대상 ∧ occurred_on > 새 일자) 또는 (id > 대상 ∧ occurred_on < 새 일자) 쌍을 만들면 409** '업무일자 순서와 기록 순서가 어긋나 정정할 수 없습니다 — 최근 이벤트를 먼저 취소하세요'(`assertNoAxisInversion` — B-35 생성 시점 차단과 같은 규칙; 허용하면 fold는 성립해도 `assertSuffix`(일자 순)·`assertNoLaterSnapshot`(id 순)이 서로를 막아 양쪽 취소 불가 교착). `editImportBatchDate`도 배치 밖 이벤트에 대해 같은 검사(배치 안 이벤트는 같은 일자로 함께 이동해 서로 역전 없음). 신규 4종·CORRECT·MOVE_WARD·배포 전 이벤트는 취소 순서로 풀리므로 대상 아님(P2 리뷰 2026-09-17, 스모크 [1e-4](g)).

### 8.3 감사 자원명
`as_receipt`(접미어 수리완료·수리완료 해제·폐기) / `hospital_device`(액션어 수리 완료·수리완료 해제·폐기·위치 이동·기기 상태 보정·위치 보정) / `hospital_device_event`(정정·취소 기존). `projectionSnapshot`에 `condition`·`locationKind`·`locationCode` 추가.

---

## 9. 기존 데이터·모듈 연동

### 9.1 백필 — `scripts/backfill-device-condition.mts --dry | --apply` (마이그는 DDL·seed만)

규칙은 **특수→일반 순(3 → 2 → 1, 5 → 6 → 7 → 8)** 으로 적용하며 모든 규칙의 대상 조건에 **미처리 유닛 가드** `u.condition IS NULL AND u.location_site_id IS NULL AND u.location_hospital_code IS NULL`을 붙인다(첫 실행에서 먼저 적용된 규칙이 나중 규칙을 자연히 제외하고, 재실행 시 전부 0건). DEV 실측 2026-09-17(PROD는 배포 시 `--dry`로 재산출):

| # | 대상 | 규칙 | DEV 건수 |
|---|---|---|---|
| 3 | 배치 ACTIVE ∧ **비종결 접수의 `outcome IS NULL ∧ intake_state='RECEIVED'` 라인 보유(플래그·as_ref_code 무관)** — 여러 라인이면 `DISTINCT ON (device_id) ORDER BY received_at DESC NULLS LAST, id DESC` | AS_WAITING · 위치 리프레시센터 · changed_on = received_at | 130 (규칙 2 교집합 125 — 그중 플래그가 옛 접수를 가리키는 4 · 플래그 없음 5) |
| 2 | 배치 ACTIVE ∧ 플래그 ∧ (연결 AS 접수 **없음** OR 비종결) — `LEFT JOIN as_receipts r ON r.as_code=d.as_ref_code … WHERE r.id IS NULL OR s.ticket_status NOT IN ('RESOLVED','CLOSED')` | AS_WAITING(changed_on = as_started_on) · 위치 병원 | 859 − 125 = 734 (AS- 858 + ref NULL 1·테스트) |
| 1 | 배치 ACTIVE(나머지) | IN_USE · 위치 병원 · changed_on = placed_on | 26,887 − 864 = 26,023 |
| 4 | 목록 출력(값 변경 없음) | (a) 플래그 ∧ 연결 접수 종결 → IN_USE: P031192/AS-202609-0041 (b) 미종결 라인인데 플래그 없음 PENDING 7대 (c) '발송완료' 접수 미확정 라인 23건(AS_WAITING으로 남음 — 라인 확정으로 정리) (d) 취소 접수 미종결 라인 6·완료 접수 2(전부 PENDING) (e) 테스트 데이터 A999999·A222222·SMP0006 | 리포트 |
| 5 | RECOVERED ∧ 사유 LOST | LOST · 위치 NULL · changed_on = recovered_on (**D4 예외** — I-1) | 128 |
| 6 | RECOVERED ∧ 사유 DISPOSE | SCRAPPED · 위치 NULL | 0 |
| 7 | RECOVERED ∧ 사유 DEFECT | **condition NULL(미확인, A-1)** · 위치 리프레시센터 · changed_on = `COALESCE(해당 접수 라인 received_at, recovered_on)`(라인 여러 건이면 `ORDER BY received_at DESC NULLS LAST, id DESC LIMIT 1`) | 1,340 (RECEIVED 19는 사후 입고일) |
| 8 | RECOVERED ∧ 그 외 사유(RETURN·데모·TRANSFER·value NULL) | NULL · 위치 리프레시센터(D4 일괄 — 실시간 keep과 다름, 0건이라 무해) | 0 |
| 9 | RECOVERED ∧ 미종결 라인 보유(재접수) | 규칙 7 결과 유지 + 목록 출력(P002875·P029765) | 2 |

- **이벤트 백필**(같은 스크립트): 규칙 3·7·8 대상에 `INTAKE`(source **BACKFILL**, `occurred_on` = changed_on, memo '상태·위치 축 도입 백필', hospital_code = 배치/last 병원). `changes.before` = 규칙 3: 규칙 2·1을 먼저 적용했을 때의 값(AS_WAITING·병원 또는 IN_USE·병원 — 스크립트가 계산) / 규칙 7·8: `condition NULL`·`location {HOSPITAL, last_hospital_code}`; `after` = 백필 결과. ref = 규칙 3은 라인 접수 코드; 규칙 7·8은 그 유닛의 RECOVER 이벤트 중 `occurred_on = recovered_on`인 1건(복수면 id 최대 — DEV 실측 전 1,468대 정확히 1건)의 ref_type/ref_code, 없으면 둘 다 NULL(`ref_check`). **중복 가드** `NOT EXISTS (… event_type='INTAKE' AND source='BACKFILL' AND device_id=u.id)`. DEV 1,470건.
- `--dry`: 규칙별 '이번 실행 대상' 건수(위 순서) + 규칙 4 목록 + RECOVER 후보 0/2건 이상 유닛 + 접수 상태별 AS_WAITING 분포 + **배포 창 보정 대상**(`condition IS NOT NULL ∧ 위치 둘 다 NULL ∧ condition ∉ {LOST,SCRAPPED}` — 코드 기동 후 백필 전에 AS_OPEN·회수 등이 건드린 유닛; 배치 ACTIVE면 위치 병원, RECOVERED면 센터로 보정) 출력. `--apply`: 단일 tx, **실행 중 서버 가드** — `GET /api/health`의 `eventTypes`에 INTAKE 포함 + `buildCommit`(next.config `env.GIT_COMMIT` — 빌드 시 `git rev-parse --short HEAD`를 번들에 인라인)이 있으면 스크립트 트리의 HEAD와 대조(불일치 = 재시작 누락·다른 체크아웃; tsx가 디스크 소스를 읽으므로 상수 검사만으로는 못 잡음), 실패 시 즉시 중단(DEV만 `--skip-health-check`). git 없는 배포나 이 보강 전 빌드는 buildCommit null → eventTypes만 판정(P2 리뷰 2026-09-17).
- 부록 B 기대(DEV): IN_USE/hosp 26,023 · AS_WAITING/hosp 734 · AS_WAITING/site 130 · LOST/none 128 · NULL/site 1,340 — 규칙 2·3 합집합 864(A999999 포함). P4 게이트는 `--dry` 재산출값과 일치.

### 9.2 AS업무(ASW) 개정
- ASW §14 게이트 표에 '수리완료(repaired_at)' 행, 말미 **§17 수리완료 체크·기기 상태 연동(2026-09-17)** 신설 + 초안/최종확정·선교체 사후 입고·종결 게이트 조건부 완화(문서 미반영분) 동반 기재.

### 9.3 SOR §13·WMS
- 출고 확정 `registerDevicesIn(source WMS)` → 암묵 IN_USE·병원(코드 변경 없음, 문서 명시). **SCRAPPED 시리얼은 출고 확정 사전 검증(tx 진입 전)에서 라인 단위 오류**.
- `inventory_units.status`로 위치 파생 금지(D9 유지). Hub 하위 인벤토리 편입(`inventories.site_id`)은 후속.

### 9.4 MIG 잔여 replay
- replay는 신규 이벤트를 만들지 않으므로 스크립트 변경 없음. replay가 만드는 RECOVER(DEFECT)는 실시간 규칙(AS_WAITING·위치 A-4)을 받는다. 잔여 보류 병원 replay 후 `backfill-device-condition.mts --dry`를 재실행하면 미처리 유닛 가드에 걸리는 유닛(replay가 만든 신규 유닛 중 상태 미설정분)만 정리된다 — 실시간 결과는 덮지 않는다.

### 9.5 채널톡·유지보수·AI
- 채널톡 역기입 비영향(CTK §7에 1줄), 인입은 §3 참조 — 인입 `createAsReceipt`가 `RegistryTxAbort`(AS_OPEN 암묵 전이의 유닛 가드 실패 = 동시 변경)로 실패하면 행을 '실패'가 아니라 **'대기'** 로 두고 다음 틱 재시도(필수값 누락 '대기'와 같은 규약·24h 한도 — P2 리뷰 2026-09-17). 유지보수 도메인은 원장에 쓰지 않음. AI 병원 요약은 배치 기준 — 변경 없음.

### 9.6 동반 갱신 체크리스트
`prisma/schema.prisma` · 마이그 폴더 · `scripts/seed-device-registry.sql`(DEVICE_SITE 2행) · `scripts/backfill-device-condition.mts` · `scripts/smoke-device-registry.mts`([1e] 섹션·AUDIT_RESOURCES·cleanup·DEVICE_SITE 존재 검증) · `scripts/smoke-device-registry-shared.mts`(전이표 기대) · `scripts/as-receipt-smoke.mts`('▶ 수리완료') · README(스키마 §디바이스 원장·§AS업무, 기능 §기기 현황·§AS업무, API 표 2곳, 디렉토리) · DEV_HISTORY · `projects/README.md`(본 문서 행 + MIG 행 상태 「완료(PROD 2026-09-05) — 잔여 보류 병원」 현행화) · HDR:23(D11)·:95(불변식 7)·§10·B-표 개정 참조 + 'B-20 미결정(회수 요약 이동)은 여전히 미결' · ASW §14/§17 · CTK §7 · SOR §13 · `lib/deviceRegistryShared.ts` BACKFILL 주석.

---

## 10. 비범위 (v1)

| 제외 | 이유 |
|---|---|
| PRE_SHIP **생성 경로**(Hub 입고 폼·WMS 편입) | v1 진입로는 admin CORRECT뿐(A-6) — 배치 없는 유닛 목록이 선행 |
| 리프레시센터/Hub **재고 목록 화면**·교체품 가용 카드·추천 콤보 | 기존 목록·조회가 전부 `hospital_devices` 기준. v1은 회수 목록 필터로 대체 |
| 일괄 수리완료/폐기(bulk) | 기존 bulk는 '같은 병원 ACTIVE' 불변 — 유닛 기준 bulk 별도 설계 |
| 거점 설정 UI | 2행 고정 |
| 종결 우회(취소) 진입 시 미종결 라인 기기 정리 | `--dry` 목록으로 대체 |
| 수리 내역(부품·소요)·수리 횟수 집계 | 질문(§2)에 없음 |
| WMS 편입(`inventory_units.device_id`)·Hub 하위 인벤토리 | D9·HDR 후속 |
| `hospital_devices_qty_backup_202609` DROP | 별도 승인 — 이번 마이그에 포함하지 않음 |

---

## 11. 구현 단계

| 단계 | 산출물 | 검증 |
|---|---|---|
| P1 스키마·서비스 | 마이그 `20260917HHMMSS_device_condition_location`(DDL+seed) · schema.prisma · 상수 · fold 무해화·EMPTY 판정 · `condition.ts` · 공용 헬퍼 2-phase·암묵 전이(단건·일괄·교체·임포트) · `RegistryTxAbort` · 취소 규약·재도출 · `projectionSnapshot` · `/api/health` eventTypes | 부록 A를 DEV에서 BEGIN/ROLLBACK 타이밍·락 측정(실측 0.96s) · 임포트 2,000행 실행 시간 회귀(유닛별 가드 UPDATE 비용) · `smoke-device-registry.mts` [1e]: 2축 전이 조합·가드 409 후 이벤트 0·흡수 409 후 유닛 무변경·`RegistryTxAbort` 전체 롤백·취소 복원·재도출·I-1~I-6·배치 상태 이벤트 0 유닛 재-fold·기존 [1]~[14] 회귀 |
| P2 AS 연동·상세 UI | 훅 8곳 · `setUnitInUse`/`ownsDeviceState` · `setAsLineRepaired`/`scrapAsLineDevice` · 라우트 2종 · 타임라인 · 상세 체크박스·n/m·배지·[폐기] · 목록 `수리 n/m` · 엑셀 | `as-receipt-smoke.mts` '▶ 수리완료'(부록 C) · dev E2E |
| P3 기기현황 UI | 열·필터·배지·드로어 액션 5종·라우트 4종·이벤트 요약·export | tsc·eslint·dev 화면(condition이 '미확인' 외로 보이는지 — select 누락 검출) |
| P4 백필 | `--dry` 리포트 → `--apply` → 부록 B | `--dry` 재산출값 = 부록 B |
| P5 문서 | README·DEV_HISTORY·projects/README·HDR/ASW/CTK/SOR 개정 참조 | — |
| **결과(dev 2026-09-17)** | P1~P5 완료 — tsc 0 · 원장 스모크 686 pass([1e] 123항목) · AS 스모크 86 pass('▶ 수리완료' 39항목) · 백필 `--dry`/`--rehearse`: 규칙 3/2/1/5/6/7/8 = 130/734/26,023/128/0/1,340/0 · INTAKE 1,470 · 배포 창 0 · 재산출 전부 0(= 부록 B) | 빌드·`--apply`·PROD 미실행. SOR 출고 사전 검증은 미구현(§13.7) |

DEV 마이그 적용 후 PROD 반영 전까지 **PROD→DEV 데이터 동기화는 스키마 diff로 abort**(`sync-prod-data-to-dev.sh`) — 필요하면 PROD 반영 선행 또는 A.0 롤백. 빌드·PM2 재시작·git push·PROD 마이그는 사용자 명시 요청 시에만.

---

## 12. 쟁점

### A. 검토 요청 — **2026-09-17 사용자 확정: A-5 외 전부 추천안. A-5는 "AS 업무 할당되면 가능" = AS 업무 권한(VIEWER 제외 USER 이상)으로 확정**

| # | 쟁점 | 추천 | 기각 대안 | 근거 |
|---|---|---|---|---|
| A-1 | 회수 DEFECT 1,340대의 초기 condition | **NULL '미확인'** + Phase 2 일괄 정리 | AS_WAITING 일괄 / REPAIRED 일괄 | 수리 근거 없음, 두 대안 모두 '수리 대기'·'교체품 가용' 수치 오염 |
| A-2 | 수리완료 체크의 종결 접수 허용 + 종결 접수 REPLACE 라인 사후 입고 조건부 허용 | **허용**(라인 조건만, `!VIEWER`) | 다른 라인 API처럼 409 | 완료 전 사후 입고된 선교체 RECEIVED 19건 실존, 선교체 구기기는 완료 후 수리 |
| A-3 | /devices 열 라벨 | 기존 '상태'→**'배치'** 헤더 변경 + '기기 상태'·'위치' 신설 | 기존 열 유지·'기기 상태'만 추가 | '사용중'이 두 열에 다른 뜻으로 보이는 혼동 방지. 값 라벨 불변 |
| A-4 | **DEFECT 회수(교체 확정·/devices 단건·일괄 회수 전부) 시 미입고 기기의 위치** — 실측 REPLACE 2,875건 중 입고처리된 라인 19건(0.7%), 09-08 이후도 PENDING 22/RECEIVED 19 | **(a) D4 계승 — RECOVER 행 스냅샷에 위치 after=리프레시센터·memo「입고 미확인」만 싣고 INTAKE는 만들지 않는다.** 실제 입고처리가 그 ref의 첫 INTAKE로 기록되어 `received_at`·'입고 확인'이 남는다(B-28·B-37 정합) | (b) 병원 유지 + '회수됐으나 입고 미확인' 필터로 사후 입고 유도 | (b)면 교체품 가용·센터 체류 수치가 체계적으로 과소, 백필(센터)과 실시간(병원) 산출물이 배포 직후부터 공존 |
| A-5 | **폐기 권한** | ~~ADMIN+ OR `device.admin`~~ → **확정: AS 업무 권한(VIEWER 제외 USER 이상)** — 사용자 결정 | write 등급 '폐기 취소' 경로 신설(미채택) | 완화책: confirm + memo 필수, 등록·출고 사전 검증이 오폐기를 드러냄, 되돌림은 admin CORRECT(D10) |
| A-6 | **출고 전(PRE_SHIP)** — v1은 값·CHECK·라벨 예약 + admin CORRECT 진입만, 생성 경로(Hub 입고·WMS 편입)는 Phase 2 | **동의** | v1에 Hub 신품 등록 폼 | 배치 없는 유닛이 어느 목록에도 안 보여 폼을 만들어도 확인 불가 — 목록 화면과 함께 Phase 2 |

### B. 설계 결정(HDR B-25 다음)

| # | 결정 | 근거 |
|---|---|---|
| B-26 | condition/location은 유닛 속성(신규 서비스: 가드→이벤트 / 암묵 전이: 검증·이벤트·rebuild→가드, 실패 시 `RegistryTxAbort`), 배치 fold 확장 안 함 — HDR 불변식 1·3 명시 예외 | §4.1 |
| B-27 | 수리완료 해제 = CORRECT(changes.condition) — 신규 타입 없음. 취소 판정은 §8.2 | 정정 규약 재사용, 판정만 신설 |
| B-28 | 스냅샷 이벤트 전부에 changes.condition/location(값이 같아도 기록, 이벤트 수 불변); REGISTER/RECOVER/AS_*의 갱신은 공용 헬퍼 부수 갱신 | I-6 정의 가능, 등록 경로 2이벤트화 회피 |
| B-29 | 표시: '배치'(기존 값 불변) + '기기 상태' + '위치' 3열 | §4.4 |
| B-30 | 거점 = StatusCode `DEVICE_SITE`; 병원 위치는 병원 코드 FK | D5·B-21 선례, Hub 하위 편입은 `inventories.site_id` |
| B-31 | 회수 기기 이벤트 hospital_code NULL 허용, 알 수 있으면 `last_hospital_code` | 병원별 이력 조회 유지 |
| B-32 | 배치 축 이벤트 취소 후 유닛 값 = ① id 최대 남은 스냅샷 after → ② 취소 이벤트의 before → ③ 배치에서 파생(§8.2 2) | I-6·I-3·§4.4 보호 |
| B-33 | 폐기 권한 = AS 업무 권한(USER+, A-5 사용자 결정); 완화책 confirm + memo 필수 | 물리 삭제가 아니고 admin 복구 경로 존재 |
| B-34 | `repaired_at`은 서버 오늘(KST) 고정 | 체크박스 UX |
| B-35 | 신규 4종은 배치 fold 비상태 이벤트(continue); `stateEventsAfter`·임포트 `lastStateOn`·`assertSuffix`(배치 축만 occurred_on 순)에서 제외, 스냅샷 판정은 id 순 `assertNoLaterSnapshot`. 두 기준이 역전된 쌍은 **생성 시점에 차단** — 소급 AS_OPEN/AS_CLEAR는 이후 스냅샷 배치 축 이벤트가 있으면 409(§8.2 1, P1 리뷰 2026-09-17) | 단일 정렬 기준, 교착 방지 |
| B-36 | **HDR D11 개정**: 회수 후 상태·위치는 원장 유닛 축이 추적(WMS 재고·전표 불변) — HDR:23·:95·§10에 개정 참조 | 2.0 기획 A1 "창고 밖 상태 추가" |
| B-37 | INTAKE는 ref별 1회 기록(변화 없어도 첫 ref면 기록; 같은 ref ∧ 무변화만 스킵; BACKFILL 제외) | 접수 연결 이력 보존 + 사후 입고 승격 |

---

---

## 13. 구현 노트(2026-09-17)

구현 결과와 본문이 다른 곳을 단계별로 적는다(본문 §4~§9는 리뷰 반영분까지 개정돼 있고, 아래는 **코드가 최종 기준**인 항목). 빌드·PM2 재시작·백필 `--apply`·PROD 마이그는 미실행.

### 13.1 결과 요약
- `npx tsc --noEmit` 0 · eslint 변경 파일 0 · 원장 스모크 `smoke-device-registry.mts` **686 pass / 0 fail**([1e-1]~[1e-11] 123항목 + 기존 [1]~[14] 회귀 + 라우트 섹션 repair-done/scrap-line/PATCH/이벤트 export) · AS 스모크 `as-receipt-smoke.mts` **86 pass / 0 fail**('▶ 수리완료' [C-1]~[C-16]·[C-I6] 39항목).
- 백필 DEV `--dry`·`--rehearse`: 규칙 3/2/1/5/6/7/8 = 130 / 734 / 26,023 / 128 / 0 / 1,340 / 0 · INTAKE(BACKFILL) 1,470 · 배포 창 보정 0 · 리허설 재산출 전부 0 · I-3/I-6 0 · I-4 예외 0 — 부록 B 기대와 일치.
- 마이그 `20260917120000_device_condition_location` DEV 적용(psql 직접 → `migrate resolve --applied` → `prisma generate`), BEGIN/ROLLBACK 실측 0.96s.

### 13.2 P1 원장 서비스
- **지적 5(cancelImportBatch 스냅샷 판정)**: 리뷰는 '단일 findMany 후 메모리 판정'을 제안했으나, `cancelImportBatch`가 이미 `loadDeviceEvents`로 대상 유닛의 전 이벤트(changes 포함)를 적재하므로 추가 쿼리 없이 `laterSnapshotOutside(eventsMap.get(id), batchIds)`로 판정 — 결과는 per-event `assertNoLaterSnapshot` 합집합과 동치(집합 내 스냅샷 id 최소값 기준). `cancelLastEvent`의 per-event 호출(≤4건)은 지적 범위 밖이라 그대로 둠.
- **지적 1 메시지**: 리뷰 문안에 업무일자와 차단 이벤트 라벨(`eventLabel`)을 덧붙여 `"{serial}: 업무일자(YYYY-MM-DD) 이후 배치 이벤트(MM-DD 라벨)가 있어 소급 기록할 수 없습니다 — 최근 이벤트를 먼저 취소하세요"`로 함(기존 소급 409 문구 관례와 동일 형식). 핵심 구절 '소급 기록할 수 없습니다'는 유지.
- §7.0 '갱신 지점 전수'의 `RegistryTxAbort` 매핑 항목을 '완료' 상태로 고쳐 씀(P1 대상 8파일 중 AS 라우트 6파일이 이번에 완료). `cancelImportBatch`의 'CORRECT-only 필터' 문구에 '상태 스냅샷 CORRECT 보존' 단서 추가 — 리뷰가 요구한 B-35 제약 명시와 함께 §8.2 1·2에도 반영.
- 원장 스모크 기존 케이스 '배치 업무일자 → 이관 원 병원 이후 이벤트 앞으로(불성립)'의 기대 메시지를 '성립하지'→'어긋나'로 변경 — 신설 `assertNoAxisInversion`이 fold 재검증보다 먼저 같은 역전을 409로 잡음(둘 다 409, 판정 순서만 바뀜). 신규 [1e-4](g)(h)는 A9900 80~82가 라우트 섹션 신규 등록에 쓰여 B9900 접두(S(80,'B')·S(81,'B'))로 등록.

### 13.3 P2 AS 연동
- **종결 접수 사후 입고 조건 (i)**: 문서 원안은 `outcome='REPLACE' ∧ intake_state='PENDING'` 라인만 허용이나, 이미 RECEIVED인 REPLACE 라인의 재입력은 무변경 통과(멱등)로 완화 — 그 외 시리얼(미일치·비REPLACE·MISMATCH 등)은 문서대로 400·EXTRA 생성 금지. 통합 리뷰(지적 3)에서 원안으로 조이지 않고 완화를 유지하되 전환 0건이면 비고 무기록 + 경고 '변경 사항 없음'으로 멱등화(재입력·더블클릭이 400이 되는 UX 회피) — §7.3 (i) 개정 완료.
- `confirmAsIntake` REMAP의 치환 전(구) 기기: 원안 §7.3 표에 명시 없음(기존은 clearOwnFlag) → 시리얼 보정과 동일 원칙으로 `setUnitInUse(true, memo '시리얼 치환 AS-… (A → B)')` 적용(게이트·플래그 소유 판정 동일). memo 표에 1종 추가.
- `resolveAsLines` REPAIR_RETURN/CANCELED 분기: 원장 훅 호출 전에 라인 outcome을 먼저 기록(기존은 뒤) — AS_CLEAR의 '미종결 입고 라인 있음' 경고가 취소되는 라인 자신을 세지 않게 함. 결과는 동일하며 REPLACE 분기는 기존 순서 유지.
- `setUnitInUse`에서 플래그 소유 AS_CLEAR 경로가 RegistryError(소급 일자·이후 배치 이벤트 409 등)로 실패하면 문서대로 경고만 남기고 CORRECT 폴백을 시도하지 않음(기존 resolveAsLines 경고 동작 유지).
- 병원 변경 재생성 보존 필드: 문서의 5개(intake_state/received_at/receipt_serial_no/repaired_at/by)에 `intake_source`도 함께 보존(무해). draft_* 는 문서대로 보존하지 않음.
- repair-done 라우트는 `notifyTicketChanged`를 호출하지 않음(문서 표는 `syncTicketClocksSafe`만 명시, ship-info 선례) — 라인 토글은 티켓 시그니처를 바꾸지 않아 실제 발송도 없음.
- 감사 라벨 검증·타임라인 표시는 라우트 경유라 AS 스모크(서비스 직접 호출)에서는 검증하지 않음 — 비고 이력·이벤트 ref/memo로 대체(라우트 감사 라벨은 원장 스모크 라우트 섹션이 검증). '드로어 [수리완료]/[해제]/[폐기] 라인 동기화'는 `/api/devices/units` 소유라 AS 스모크 범위 밖.
- `setAsLineRepaired` 가드 409(지적 5): 경고 흡수가 아니라 재throw(tx 롤백 → 라우트 409 '동시에 변경되어 다시 시도하세요') — 라인만 커밋되는 반쪽 상태 원천 차단(§7.1·§7.4 개정).
- `ownsDeviceState`(지적 1): `latest.refType !== 'AS'`면 통과. `by`에 refType 병기는 하지 않음(AS ref만 by에 실리므로 불필요).
- 채널톡(지적 8): '대기' 전환 시 AL(최초 대기 시각)은 기존 규약대로 보존하고 24h 초과면 '실패 … 24시간 경과'로 마감 — §9.5 1줄·CTK §7 1줄만 추가.

### 13.4 P3 기기현황 UI·라우트
- `ConditionBadge` React 컴포넌트는 `deviceDisplay.ts`(순수 함수 전용 파일)가 아니라 `registryFormKit.tsx`에 두고, 톤 헬퍼 `conditionBadgeVariant`·위치/문장화 헬퍼만 `deviceDisplay.ts`에 둠(단일 소스 유지). DeviceTable·DeviceListTab·드로어·SerialLookup·ReplaceModal이 registryFormKit의 ConditionBadge/StatusBadge를 공용.
- 서버 라우트(PATCH units/[id]·events/export·location)가 `@/app/devices/_components/deviceDisplay`(React 없는 순수 TS)를 import — '문장화 헬퍼 1곳' 준수를 위한 API→app/devices 순수 모듈 의존. `lib/deviceRegistryShared`로 옮기려면 P1 소유 파일 변경 필요(후속).
- **[위치 이동]**은 별도 모달 없이 드로어 버튼 ▾ 플로팅 패널(`RegistryFloatingPanel`)에서 목적지 거점(리프레시센터/Hub, 현재 위치는 disabled) 선택 → `onAction('moveLocation', ref, { to })`. 이를 위해 `onAction`(DeviceAction)에 3번째 인자 `DeviceActionOptions { to? }` 추가(DeviceTable/드로어/오케스트레이터 시그니처 확장, 기존 호출 호환).
- **[폐기]**는 confirm + `window.prompt`로 memo 입력(간이 UX, 모달 없음). 빈 memo면 호출 전 차단, 서버도 400.
- 라인 동기화의 `repaired_at` 날짜 = 이벤트 occurredOn(드로어는 날짜를 보내지 않아 실질 오늘 KST) — B-34 '서버 오늘 고정'과 결과는 같고, body occurredOn이 오면 그 날짜(§7.3 재적용 규칙 `markDeviceRepaired(occurredOn=repaired_at)`과 정합).
- scrap 라인 동기화의 비고 이력은 repaired_at 유무와 무관하게 대상 라인(`canMarkAsLineRepaired`)이 있는 접수 전부에 `[폐기 …] memo (기기현황)` 기록(폐기 사실을 접수에 남김). done/undo는 실제 갱신된 라인의 접수만.
- `device.status !== 'ACTIVE'`(RECOVERED/배치 없음)에서만 [수리완료][해제][폐기][위치 이동] 노출; ACTIVE ∧ 위치 거점 ∧ AS_WAITING/REPAIRED에는 버튼 대신 안내 문구 '미종결 입고 라인 — 실물 반환은 AS 상세에서 확정하세요'(서비스 409 문구와 동일 의미).
- 병원 뷰 compact(v1 기본) 필터 행에도 기기 상태·위치 인라인 셀렉트 2종 노출(원안은 필터 2종 존재만 명시). 전체 모드 필터 행에도 동일 추가.
- `DevicePatchResponse.device`를 `DeviceRaw | null`로 변경(배치 없는 유닛의 상태·위치 보정 시 device null) — 드로어 인라인 저장(용도/상품유형/계약건)은 `r.device?.` 처리.
- PATCH `condition: null`('미확인'으로 되돌림) 허용 — 원안 미명시(admin 되돌림 용도, 서비스 `CorrectChanges`가 null 허용). `location`은 `{kind:'HOSPITAL'|'SITE', code}` 또는 null, 거점 value·형태 오류는 라우트 400.
- 라우트 응답 `device`는 배치 행 있는 유닛만 DeviceRow(`flattenDevice(unit, placement)`), 배치 없는 유닛은 null — audit before/after는 `projectionSnapshot` + 문장화 값(conditionLabel/locationLabel) 병기.
- **scrap-line 배치 없음(지적 9)**: 서버를 RECOVERED만으로 조이지 않고 §7.1에 '배치 행 없는 유닛(REGISTER 취소 등)은 허용, UI [폐기]는 RECOVERED만 노출'을 명시 — 라인 deviceId는 `matchSerials`(배치 행 기준)로만 채워져 배치 없는 라인 기기는 REGISTER 취소 뒤에만 생기는 희귀 케이스이고 폐기 자체는 무해.
- **buildCommit(지적 11)**: package.json build에 `GIT_COMMIT=$(git rev-parse)`를 넣는 대신 `next.config.mjs` `env.GIT_COMMIT`(execSync)로 번들에 인라인 — 서버 코드의 process.env는 빌드 시 인라인되지 않아 PM2 런타임에 값이 없기 때문(Next `define-env-plugin.js`에서 config.env가 DefinePlugin에만 쓰이고 런타임 process.env에 주입되지 않음을 확인 → 값이 '실행 중 빌드'를 나타냄). health는 `||`로 빈 문자열을 null 처리. 백필은 buildCommit이 있으면 HEAD와 prefix 대조(불일치 → 중단, `--skip-health-check`로만 우회).
- **changed_on 축별(지적 12)**: 근사값 주석 대신 실제 축별 산출 구현(`axisChangedOnFrom` — 남은 스냅샷 중 그 축을 마지막으로 바꾼 이벤트 일자). 바꾼 이벤트가 없으면 id 최대 스냅샷 일자로 근사(§8.2 2).

### 13.5 P4 백필
- **`--rehearse` 플래그 추가(문서 외)**: `--apply`와 동일 경로를 끝까지 실행하고 같은 tx에서 부록 B·재산출(0건 확인)까지 한 뒤 롤백. A.0의 'dev2 리허설'·PROD 사전 점검용이며 쓰기 없음. 이번 검증도 이 플래그로 수행(`--apply` 미실행).
- 규칙 2의 `location_changed_on = COALESCE(placed_on, as_started_on)`: 원안은 condition changed_on=as_started_on만 명시. AS 접수는 위치를 바꾸지 않으므로(§4.2 AS_OPEN 병원 유지) 위치 진입일은 배치일로 두었음. condition_changed_on은 원안대로 as_started_on.
- 규칙 3 changed_on = `COALESCE(라인 received_at, 접수 received_at, 접수 receipt_date)`: 원안은 라인 received_at. DEV 실측 NULL 0건이라 결과 동일하며, 결측 시 occurred_on NOT NULL 위반을 막는 방어(리포트에 ⚠ 건수 표시).
- 배포 창 보정 대상: 원안은 `--dry` 리포트 항목으로만 기술하고 `--apply` 동작을 명시하지 않음. 리포트에 더해 `--apply`에서 위치 컬럼만 채우도록 구현(condition 불변·이벤트 없음·`location_changed_on=COALESCE(condition_changed_on, CURRENT_DATE)`). 배치 행 없는 유닛은 목적지가 없어 제외. DEV 현재 0건.
- INTAKE 백필 이벤트 actor: `actor_id NULL`·`actor_name '백필 스크립트'`(원안 미명시). `migrate-thync-as-history.mts`는 SUPER_ADMIN을 actor로 썼으나 시스템 백필을 개인에게 귀속하지 않기 위해 분리.
- 접수 종결 판정에 `ticket_status NULL`(status_id NULL 접수)은 원안 SQL 그대로 '종결 아님'에 포함되지 않음(NOT IN이 NULL) — DEV 실측 status_id NULL 접수 0건이라 영향 없음. 필요 시 COALESCE로 보완 가능.

### 13.6 AS 상세 UI
- 수리완료 해제(체크 해제) 시 `confirm()` 1회 추가 — 원안에 없음. 해제가 기기 CORRECT 이벤트(AS_WAITING 복귀)를 남기므로 오클릭 완화 목적. 불필요하면 `toggleRepaired`의 confirm 한 줄 제거로 원복 가능.
- 수리완료 체크 권한 판정을 `canRepair = !!me && me.role !== 'VIEWER'`로 두어 접수 종결 여부(`isTerminal`)·`canEdit`·`canResolve`와 분리 — §6.1('!VIEWER', A-2 종결 접수 허용)과 서버 repair-done/scrap-line 게이트에 맞춘 것이며 기존 canEdit 계열과 다름.
- condition 배지 색은 `lib/deviceRegistryShared`의 `DEVICE_CONDITION_COLORS`(-100 톤·dark 변형)를 쓰지 않고 AS 상세의 기존 소형 배지 톤(-50)으로 `lib/asReceiptShared.ts`에 `AS_LINE_CONDITION_BADGE_CLS`를 별도 정의 — 라벨은 `deviceConditionLabel` 단일 소스.
- 위치 툴팁: 초기 구현은 GET 응답에 병원명이 없어 '병원 {코드}'로 표기했으나, 통합 단계에서 상세 응답 `device.unit`에 `locationHospitalName`을 병기(§7.1 계약 + 병원명)해 현재는 병원명(없으면 코드)으로 표기.
- 폐기 성공 시 warnings 배너에 '{시리얼} 폐기 처리됨' 안내 1줄을 앞에 추가(시리얼 보정 선례와 동일 패턴).

### 13.7 미구현·후속
- **SOR §9.3 폐기 시리얼 출고 사전 검증(라인 단위 오류)은 `lib/stockOutFulfill.ts`에 미구현** — 현재는 출고 확정 tx 안의 `registerDevicesIn`이 409 '폐기된 기기입니다'로 tx 전체를 실패시켜 폐기 기기 출고 자체는 막히나, `?preview=true` 라인 판정에는 드러나지 않는다. `findUnitsBySerial` 결과의 `condition==='SCRAPPED'`를 라인 err로 올리는 1분기 추가가 필요(자재관리 모듈 소유자).
- ReplaceModal 추천 콤보·Hub/센터 재고 목록·PRE_SHIP 생성 경로·일괄 수리완료/폐기·거점 설정 UI는 §10 그대로 Phase 2.
- `deviceDisplay.ts` 문장화 헬퍼의 `lib/deviceRegistryShared` 이전(API→app 의존 제거)은 후속.

## 부록 A. 마이그레이션 SQL · 배포 런북

### A.0 배포 순서 (PROD — 규칙 5 명시 허락)
1. 전체 덤프(`pg_dump -Fc`) · `SELECT pid, now()-xact_start FROM pg_stat_activity WHERE state<>'idle'`로 장기 tx 확인 · 채널톡 스케줄러 `channeltalk_as_interval='off'`
2. `git pull`
3. 마이그 SQL `psql --single-transaction -v ON_ERROR_STOP=1 -f …`(파일 첫 줄 `SET lock_timeout='5s'` — 대기 5초 초과 시 전체 롤백·재시도. 락 보유 ≈1초(AccessExclusive 3테이블), 무정지 가능하나 업무 외 시간 권장)
4. `npx prisma migrate resolve --applied …` → **`npx prisma generate`**(빌드 스크립트에 포함되지 않음) → 힙 4GB 빌드 → `pm2 restart thync-prod` → `/api/health`(eventTypes에 INTAKE·`buildCommit` = 배포 커밋 확인)·/devices·AS 상세 확인
5. `npx tsx scripts/backfill-device-condition.mts --dry` → 리포트 확인(배포 창 보정 대상 포함) → `--apply`(**반드시 4 이후** — 스크립트가 `/api/health`로 실행 중 서버 버전을 확인하고 아니면 중단) → **스케줄러 복구는 5 이후**(백필 전 채널톡 인입이 NULL 유닛을 건드리는 창을 최소화)
- 순서 역전 금지: 코드가 먼저 올라가면 select 없는 유닛 조회가 P2022로 실패해 AS 등록·입고·확정·WMS 출고·/devices 전면 500. 3~4 사이 구 코드가 새 스키마로 도는 것은 안전(컬럼 전부 NULL 허용, 신규 타입 0건). 백필·신규 이벤트가 구 코드 위에 생기면 `foldStepOk` default false로 해당 유닛 rebuild 409 — 5는 4 이후.
- **롤백**: ① 코드 롤백(`git checkout <prev>` → generate → 빌드 → restart; 구 코드는 추가 컬럼 무시) ② DB: `BEGIN; DELETE FROM hospital_device_events WHERE event_type IN ('INTAKE','REPAIR_DONE','SCRAP','SITE_MOVE'); UPDATE hospital_device_events SET changes = changes - 'condition' - 'location' WHERE changes ? 'condition'; DELETE FROM hospital_device_events WHERE event_type='CORRECT' AND changes='{}'::jsonb; DROP/ADD type_check·hospital_check·changes_check(20260901120000:111·113·116 원문); ALTER TABLE device_units DROP COLUMN condition, condition_changed_on, location_hospital_code, location_site_id, location_changed_on; ALTER TABLE as_receipt_items DROP COLUMN repaired_at, repaired_by_id; DELETE FROM status_codes WHERE category='DEVICE_SITE'; COMMIT;` → `migrate resolve --rolled-back`. dev2 리허설 후 헤더에 기재.

### A.1 `prisma/migrations/20260917HHMMSS_device_condition_location/migration.sql`

```sql
-- 기기 상태·위치 축 (2026-09-17 — projects/device_condition_location_design.md §5): 3축 = 배치(hospital_devices, 불변) / 상태 condition·위치 location(device_units, B-26)
-- 거점 마스터는 status_codes DEVICE_SITE(value가 시스템 의미). seed-device-registry.sql에도 동일 INSERT. 백필은 scripts/backfill-device-condition.mts(--dry/--apply)
-- 적용: psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f <this> → npx prisma migrate resolve --applied <dir> → npx prisma generate. 롤백 런북: 설계안 부록 A.0
-- DEV BEGIN…ROLLBACK 실측: 0.96s, 2회 연속 실행 오류 0(멱등)
SET lock_timeout = '5s';

-- 1) 거점 마스터
INSERT INTO status_codes (name, category, "order", value) VALUES
  ('리프레시센터','DEVICE_SITE',1,'REFRESH_CENTER'), ('thynC Connected Hub','DEVICE_SITE',2,'HUB')
ON CONFLICT (name, category) DO NOTHING;

-- 2) device_units — 상태·위치 (유닛 속성)
ALTER TABLE device_units
  ADD COLUMN IF NOT EXISTS condition TEXT,
  ADD COLUMN IF NOT EXISTS condition_changed_on DATE,
  ADD COLUMN IF NOT EXISTS location_hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS location_site_id INTEGER REFERENCES status_codes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS location_changed_on DATE;
ALTER TABLE device_units DROP CONSTRAINT IF EXISTS device_units_condition_check;
ALTER TABLE device_units ADD CONSTRAINT device_units_condition_check
  CHECK (condition IS NULL OR condition IN ('IN_USE','AS_WAITING','REPAIRED','PRE_SHIP','LOST','SCRAPPED'));
ALTER TABLE device_units DROP CONSTRAINT IF EXISTS device_units_location_single_check;
ALTER TABLE device_units ADD CONSTRAINT device_units_location_single_check
  CHECK (location_hospital_code IS NULL OR location_site_id IS NULL);
ALTER TABLE device_units DROP CONSTRAINT IF EXISTS device_units_terminal_no_location_check;
ALTER TABLE device_units ADD CONSTRAINT device_units_terminal_no_location_check
  CHECK (condition IS NULL OR condition NOT IN ('LOST','SCRAPPED') OR (location_hospital_code IS NULL AND location_site_id IS NULL));
CREATE INDEX IF NOT EXISTS device_units_condition_idx         ON device_units(condition);
CREATE INDEX IF NOT EXISTS device_units_location_site_idx     ON device_units(location_site_id, condition) WHERE location_site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS device_units_location_hospital_idx ON device_units(location_hospital_code) WHERE location_hospital_code IS NOT NULL;

-- 3) 이벤트 어휘 확장 (CHECK는 DROP 후 재생성 — 20260911 선례) + 회수 기기(hospital_code NULL) 이벤트 허용 + 스냅샷 강제
ALTER TABLE hospital_device_events DROP CONSTRAINT IF EXISTS hospital_device_events_type_check;
ALTER TABLE hospital_device_events ADD CONSTRAINT hospital_device_events_type_check
  CHECK (event_type IN ('REGISTER','MOVE_WARD','RECOVER','CORRECT','AS_OPEN','AS_CLEAR','INTAKE','REPAIR_DONE','SCRAP','SITE_MOVE'));
ALTER TABLE hospital_device_events DROP CONSTRAINT IF EXISTS hospital_device_events_hospital_check;
ALTER TABLE hospital_device_events ADD CONSTRAINT hospital_device_events_hospital_check
  CHECK (event_type IN ('CORRECT','INTAKE','REPAIR_DONE','SCRAP','SITE_MOVE') OR hospital_code IS NOT NULL);
ALTER TABLE hospital_device_events DROP CONSTRAINT IF EXISTS hospital_device_events_changes_check;
ALTER TABLE hospital_device_events ADD CONSTRAINT hospital_device_events_changes_check
  CHECK (event_type NOT IN ('CORRECT','INTAKE','REPAIR_DONE','SCRAP','SITE_MOVE') OR changes IS NOT NULL);

-- 4) as_receipt_items — 수리완료 (outcome과 독립인 제3축)
ALTER TABLE as_receipt_items
  ADD COLUMN IF NOT EXISTS repaired_at DATE,
  ADD COLUMN IF NOT EXISTS repaired_by_id TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
```

### A.2 seed 추가분 (`scripts/seed-device-registry.sql`, DDL 없음·멱등)
```sql
-- 3'') 거점 마스터 (DEVICE_SITE — 2026-09-17 기기 상태·위치 축)
INSERT INTO status_codes (name, category, "order", value) VALUES
  ('리프레시센터','DEVICE_SITE',1,'REFRESH_CENTER'), ('thynC Connected Hub','DEVICE_SITE',2,'HUB')
ON CONFLICT (name, category) DO NOTHING;
```

## 부록 B. 검증 SQL (백필 후)

```sql
SELECT condition, (location_site_id IS NOT NULL) AS at_site, (location_hospital_code IS NOT NULL) AS at_hosp, count(*) FROM device_units GROUP BY 1,2,3 ORDER BY 1,2,3;
-- 기대(DEV, --dry 재산출로 확정): IN_USE/hosp 26,023 · AS_WAITING/hosp 734(= 859 − 125) · AS_WAITING/site 130 · LOST/none 128 · NULL/site 1,340
SELECT count(*) FROM device_units u JOIN hospital_devices d ON d.device_id=u.id WHERE d.status='ACTIVE' AND u.condition IN ('LOST','SCRAPPED','PRE_SHIP');  -- I-3: 0
SELECT count(*) FROM device_units u JOIN hospital_devices d ON d.device_id=u.id WHERE d.status='ACTIVE' AND u.condition IS NULL;                          -- 0
SELECT u.serial_no, u.location_site_id FROM device_units u JOIN hospital_devices d ON d.device_id=u.id
 WHERE d.status='ACTIVE' AND u.condition='IN_USE' AND u.location_hospital_code IS DISTINCT FROM d.hospital_code;                                          -- I-4 예외 리포트(취소 라인·수동 해제 유닛만 허용)
SELECT count(*) FROM device_units u JOIN LATERAL (SELECT changes FROM hospital_device_events e WHERE e.device_id=u.id AND e.changes ? 'condition' ORDER BY id DESC LIMIT 1) l ON true
 WHERE (l.changes->'condition'->>'after') IS DISTINCT FROM u.condition;                                                                                   -- I-6: 0
SELECT count(*) FROM hospital_device_events WHERE event_type='INTAKE' AND source='BACKFILL';                                                              -- 1,470 · 재실행 후 증가 0
```

## 부록 C. 스모크 항목(초안)

- [1e-1] 2축 전이 조합(배치 status × condition × 이벤트) 전수 — 기대 결과/409 문구 · [1e-2] `changed:false` 멱등(이벤트 0건)·INTAKE ref 규칙(첫 ref 기록·같은 ref 무변화 스킵·변화 시 기록) · [1e-3] 신규 서비스 가드 409 후 **해당 유닛 신규 이벤트 0건**; 암묵 전이 경로에서 소급 검증 409(흡수) 후 유닛 무변경·이벤트 0, 배치 가드 409(흡수) 후 유닛 무변경, 유닛 가드 실패 → `RegistryTxAbort` 전체 롤백 · [1e-4] 스냅샷 이벤트 LIFO 취소 → before 복원, id 더 큰 스냅샷 있으면 409(소급 AS_CLEAR 뒤 REPAIR_DONE 취소 409·AS_CLEAR 취소 ok), REGISTER(오늘)+INTAKE(과거일) → REGISTER 취소 409, RECOVER(LOST) 취소 → 재도출(① 남은 스냅샷 after ② 취소 이벤트 before ③ IN_USE·병원), 배포 전 이벤트만 가진 유닛의 AS_CLEAR 취소 → before(AS_WAITING), REGISTER 취소(배치 삭제) → NULL · [1e-5] SCRAPPED 유닛 REGISTER 409(등록·교체기·backfill 3경로) · [1e-6] 배치 ACTIVE SCRAP/SITE_MOVE(거점) 409, [병원 반환] IN_USE ok·AS_WAITING 409 · [1e-7] 배치 상태 이벤트 0 + INTAKE만 남은 유닛 재-fold → 배치 행 없음·CHECK 위반 없음(`cancelLastEvent`·`cancelImportBatch` 경유), 기존 [14] 회귀 · [1e-8] I-6 · [1e-9] 일괄 회수(LOST)·일괄 AS 표시·일괄 AS 해제(위치 유지)가 단건과 동일 · [1e-10] DEVICE_SITE 마스터 존재 검증 · [1e-11] ACTIVE_OTHER INTAKE conflict(접수 병원≠배치 병원) · [1e-4](g) 배치 축 스냅샷 occurredOn 정정 역전 → 409(역전 없는 정정 성립) · [1e-4](h) SITE_MOVE 취소 후 축별 changed_on(condition 유지·location 복원).
- AS '▶ 수리완료': 입고 전 400 → 입고 → 체크(라인·기기 REPAIRED·비고·감사 라벨) → 확정(REPAIR_RETURN) → IN_USE·위치 병원 → **플래그 없는 기기**(타병원 매칭 후 이관) 수리반환 확정 → IN_USE·병원(CORRECT 폴백) → **접수 A 입고·체크 후 접수 B(옛 플래그) 라인 취소/미회수/수리반환 확정 → 기기 상태 불변·경고 1건** → 선교체(REPLACE 확정 → 구기기 RECOVER 스냅샷 위치 A-4 → 완료 → 종결 사후 입고 허용(불일치 시리얼 400) → INTAKE 기록·received_at → 체크 → 구기기 REPAIRED·센터·가용 → 다른 접수 교체기로 재사용 → IN_USE) → 재접수 입고 → AS_WAITING·가용 제외 → 해제(CORRECT) → 취소 라인 400·취소 후 위치 센터 유지·[병원 반환] → 미등록 라인 경고 → 원장 확정 시 INTAKE·REPAIR_DONE(occurredOn=repaired_at) 재적용 → 드로어 [수리완료]/[해제]/[폐기] 라인 동기화 → 폐기(RECOVERED만, LOST 라인 400) → **[C-15] 입고 확인 REMAP**(치환 전 기기 IN_USE·병원 AS_CLEAR memo '시리얼 치환'·플래그 해제, 치환 후 기기 INTAKE·플래그, 라인 원 시리얼 보존) → **[C-16] 소급 수리반환**(처리일 < 표시 시작일 → AS_CLEAR 업무일자 클램프·경고 1건) → 재체크 멱등(이벤트·비고 줄 수 불변) · [C-3] 게이트 불통과 시 AS 표시 잔존 안내.
