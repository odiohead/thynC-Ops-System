# 병원별 웨어러블 디바이스 원장(Device Registry) — 설계안

> **상태: 설계 확정 — 구현 중(P1, feature 브랜치 `feat/device-registry`)** — 2026-09-01 쟁점 A-1~A-8 추천안 확정 후 같은 날 사용자 착수 지시("dev2에서 형상을 보고 수정보완"). P0 완료: PROD 09-01 01:00 덤프로 dev2 동기화(hospital_devices 132·딜 249·units 21,085), 브랜치 생성. 형상 확인 후 수정·보완 예정
> 작성 2026-09-01. 경위: 코드베이스·PROD 데이터(09-01 읽기 전용 재검증)·온프렘 thynC WAR/DDL 조사 → 열린 쟁점 12개에 대한 제품 책임자 답변 확정(D1~D12, §0) → 관점별 초안 3종(데이터 정합 / 운영자 UX / 통합 훅) → 심사·통합 → 코드 대조 검증 2라운드(스키마·결정 정합·운영 리스크·운영자 시나리오, 지적 107건 반영) → 본 문서.
> 조사 원문은 `projects/hospital_device_registry_brief.md`(참조 자료). **설계 검토 게이트: 사용자 명시 착수 승인 전 코드 작성 금지.**

---

## 0. 확정 결정(D1~D12) — 본 문서의 전제

| # | 결정 |
|---|---|
| D1 | 기존 `hospital_devices`(병원×모델 **수량**, PROD 132행/67병원 — 8월 수동 센서스)는 **폐기**. 새 시리얼 개체 테이블이 `hospital_devices` 이름을 승계. 센서스는 백업만. '기대 수량' 대조 기준 = Σ계약완료 딜 `daewoong_device_count`(ECG 수와 일치 — hard), SpO2는 참고(soft). `hospitals.intro_beds`는 현행 유지 |
| D2 | 대상: ECG MC200M-T(`A######`)·SpO2 MP100W(`P######`) + 게이트웨이 MGW1010(키 `B######`, WMS 합성 `GW####-B######`는 자동 분해) + 제3자(링BP SL-MPF1K07·참BP H2-ABPM·RTLS 태그) → `device_info` 시드. MT100D/MBP100U는 코드만. 비시리얼 소모품 범위 밖 |
| D3 | 시리얼 = **전역 물리 개체 1행**(현재 병원·병동·상태) + append 이벤트 이력. 활성 배치는 시리얼당 1건. 회수 후 타 병원 재등록 시 이력이 이어짐 |
| D4 | **병원별 병동 마스터 `hospital_wards` 신설**. 관리 UI는 `/devices` 병원 뷰의 패널. 임포트 시 새 병동명 자동 생성. `hospital_servers.ward_info`·딜 `wards_text`는 불변 |
| D5 | 이벤트 타입은 코드 상수, **회수 사유는 StatusCode 카테고리**(설정에서 편집, 시스템 의미는 `value`) |
| D6 | 초기 적재 = **병원별 검토형 임포트**(Excel + 붙여넣기, 미리보기 행별 판정, 온프렘 export 목록을 '초안'으로 붙여넣고 사람이 제외). 백필은 신규 go-live + 장애 발생 병원부터 점진 |
| D7 | 이벤트 일자 = **업무일자 직접 입력**(기본 오늘, 과거 허용). 유지보수 연결 시 그 일자를 기본 제안 |
| D8 | AS 연동은 **유지보수 하위 흐름 우선** — 이벤트에 `ref_type/ref_code` 예약, 이번 범위엔 자리·계약만. 원장은 티켓 도메인 아님 |
| D9 | WMS는 **조인 키만**(`inventory_unit_id` nullable + 시리얼 자동 매칭 읽기 표시). 쓰기 훅·`link_hospital` 확대는 후속. WMS 테이블에 쓰기 없음 — `inventory_units.status`는 **원장 상태(ACTIVE/RECOVERED)·이벤트 생성·fold의 입력으로 절대 미사용**(매칭 후보 우선순위·⚠ 표시용 읽기만 허용, §9.2) |
| D10 | 읽기 로그인 전체 / 등록·회수·이동·임포트 `isUserOrAbove` / 정정·삭제·배치 취소 `isAdminOrAbove OR device.admin` / nav SEERS 게이트 |
| D11 | 원장은 **'이 병원에서 나감(사유)'까지만**. 회수 후 수리·폐기·재출고는 WMS 영역 |
| D12 | 전용 페이지 `/devices`. 병원 상세 '도입 현황' 수량 입력 → **모델별 요약행 + 링크**로 교체, `InventoryUsageCard` 제거 |

---

## 1. 배경·목적

thynC 도입 병원에는 시리얼이 부여된 웨어러블 본체·게이트웨이·제3자 기기가 병동 단위로 배치되고, go-live 이후 AS로 회수·교체·병동 이동이 계속 일어난다.

**온프렘 데이터를 원장으로 쓸 수 없는 이유(WAR·DDL 검증)**: `device_register.date_time`은 UPDATE마다 덮어써지는 마지막 쓰기 시각(등록일 시드 불가) / `device_return_status`는 어느 콘솔도 1로 쓰지 않는 사문이고 관리자 콘솔 '삭제'는 물리 DELETE → **회수됐지만 삭제되지 않은 기기를 구분할 수 없음**(실무 증상 `MNT-202608-0020/0021` "반납된 기기 삭제 요청") / 교체 연결·등록 이력·회수 상태 개념 전무, 델타 API 없음 / 서버는 시리얼 형식을 검증하지 않음(`MNT-202608-0023` "A12016" 5자리).

**오늘의 진실**은 유지보수 자유 텍스트("P018363(삭제) → P020418(등록)", "A126861기기 252병동→101병동")와 WMS `destination` 텍스트에만 있고, WMS는 병원 연결 0%·반품 시 `hospital_code` 소실. 기존 `hospital_devices`는 수량뿐이라 시리얼·이력·감사가 없다.

**핵심 차별점 한 문장**: **"시리얼 1개 = 물리 개체 1행(현재 병원·병동·상태) + 지워지지 않는 이벤트 이력"** — 병원을 옮겨도, 회수 후 재등록해도 같은 시리얼의 이력이 이어지고, 현재 상태는 언제든 이벤트로부터 재계산할 수 있다. 온프렘은 '지금 켜져 있는 것', WMS는 '창고 안팎'을 말하고, 이 원장만이 **'이 병원에 무엇이 있어야 하며 무엇이 언제 왜 나갔는가'**를 말한다.

## 2. 이 기능이 답해야 할 질문

| Q | 질문 | 설계 반영 |
|---|---|---|
| Q1 | 지금 이 병원에 어떤 시리얼이 어느 병동에 있나 | `hospital_devices` 프로젝션(status·hospital_code·ward_id) + `/devices?hospital=` 목록(기본 정렬 병동→시리얼) |
| Q2 | 이 시리얼은 지금 어디 있고 과거엔 어디를 거쳤나 | 전역 UNIQUE `serial_no` + 헤더 '시리얼 조회' + 병원 경계 무관 이력 드로어 + 개체 `memo`(각인·스티커 번호 등 현장 식별 보조) |
| Q3 | AS로 무엇을 회수·교체했나, 언제·왜·어느 유지보수에서 | RECOVER+REGISTER 쌍(`action_group`·`related_device_id`), 사유 마스터, `occurred_on`(유지보수 선택 시 일자 자동 제안), `ref_type/ref_code`, 개체 행 `recovered_on`·`recover_reason_id` |
| Q4 | 계약 디바이스 수와 맞는가 | 요약: 모델별 배치 중 n / 계약 m — ECG hard(Σ계약완료 딜), SpO2 soft(ECG 동수 가정). GW·제3자는 계약 축 없음('—') |
| Q5 | 초기 목록을 빠르고 안전하게 넣을 수 있나, 온프렘 export를 초안으로 쓸 수 있나 | 검토형 임포트(미리보기 판정 6종·제외 체크·단일 트랜잭션·배치 취소). 온프렘 export 모드는 열 매핑·org 제외·'이 병원에서 회수된' 시리얼 기본 제외까지 |
| Q6 | 어느 병원이 백필됐고 어디가 어긋났나 | 전역 뷰 커버리지 표(계약/배치 중/차이/마지막 이벤트·임포트, 필터 미등록만·차이 있음) |
| Q7 | 누가 언제 기록·정정했나 | 이벤트 `actor_*`·`created_at`·`edited_*` + `logAudit` + CORRECT 이벤트 + 배치 `cancel_summary` |
| Q8 | 창고(WMS)에 같은 개체가 있나 | `inventory_unit_id` 조인 키 + 시리얼 배치 매칭 → '창고 개체' 열(IN_STOCK이면 ⚠). WMS 쓰기 없음 |

기여하지 않는 필드·화면은 만들지 않는다. 온프렘 `device_register`의 사용량·자동모드·병실/병상·premium은 복제하지 않는다. 온프렘 동기화 예약 컬럼(`mac_address`·`ext_*`)은 v1에 **수기 입력 표면을 두지 않고** 온프렘 export 붙여넣기로 유입된 값만 저장한다(드로어의 '온프렘 스냅샷' 행은 값이 있을 때만 렌더 — '빈 상태 전 필드 노출' 원칙은 원장 필드에 적용).

## 3. 기존 기능과의 경계(중복 검토)

| 기존 자산 | 성격 | 관계 |
|---|---|---|
| 기존 `hospital_devices`(`prisma/schema.prisma:456-468`, PROD 132행) | 병원×모델 수량. 유일 쓰기 `PUT /api/hospitals/[code]/devices`(`route.ts:42-103`, `logAudit` 없음, `intro_beds` 결합 저장) | **D1 폐기** — 테이블·모델명 승계. 132행은 마이그 안에서 백업 테이블로 보존 후 DROP(§5d). 기대 수량은 딜 |
| `HospitalDevicesSection`(`app/hospitals/[code]/page.tsx:252-257`) | 도입 병상 수 + 모델별 수량 입력 | **D12** 읽기 전용 요약 표 + 링크. `intro_beds` 입력은 병원 등록·수정 폼(`edit/page.tsx:227-231`)·Excel 가져오기·병원 PUT에 이미 있음 → 손실 없음(카드에 '도입 병상 수 — 수정은 병원 수정 폼' 읽기 줄 유지) |
| `InventoryUsageCard`(`page.tsx:17,341`) | WMS 병원 연결 0건이라 렌더된 적 없음 | 제거(D12) |
| WMS `inventory_units`(UNIQUE(item_id, serial_no), `hospital_code` 데이터 0) | 창고 안 수명주기 | 원장은 창고 밖. WMS 테이블 **쓰기·인덱스 추가 금지**(D9). 조인 키 + 읽기 배치 매칭만(§9.2). 훅(`lib/inventory.ts` OUT 스탬프 518-526 / RETURN 435-452 / 취소 608-660)은 후속, 서비스 계약(§7.0)만 고정 |
| `bulk-serial`(`app/api/inventory/transactions/bulk-serial/route.ts`, `BulkSerialTxModal`) | Excel 일괄 선례(preview·MAX 2000·오류 시 거부·단일 tx) | 패턴 복제 + 붙여넣기·판정 6종·행별 제외·배치 취소 |
| AI `find_serial_unit`(`lib/ai/tools.ts:328`) / `get_hospital_overview`(`:602,621-623`) | 창고 개체 조회 / 수량표 문자열 | 신규 도구는 v2. `get_hospital_overview`의 `quantity` 참조는 P1 컴파일 팬아웃으로 원장 집계 문자열로 치환 |
| 유지보수 텍스트 / VOC 하위 티켓 생성(`lib/ticket-domains/meta.ts:118`) | AS 사실이 기록되는 곳 | 원장이 구조화. 액션 UI는 후속(D8) — v1 폼은 유지보수 코드 선택 + 일자 자동 제안까지. Tiptap 불변, `tickets`·`maintenances`에 기기 컬럼 금지 |
| `HospitalServer.wardInfo`·딜 `wardsText` | 병동 텍스트 | **D4 `hospital_wards` 신설**, 텍스트는 불변 |
| `device_info`(2행) / `/settings/devices` '기기 관리'(nav 38) | 모델 마스터. GET은 `isActive` 필터 없이 전량, 쓰기 게이트 인라인 `role==='VIEWER'` | 5컬럼 확장 + 4행 시드(D2). **수량 폼 3곳**(`app/sales/deals/[id]/page.tsx:67`·`app/projects/[code]/page.tsx:211`·`app/projects/new/page.tsx:75`)은 `quantity_tracked=false` 행을 숨김. 자재 품목 폼 '연결 장비' 셀렉터는 필터하지 않음(GW 품목을 MGW1010에 연결할 수 있게 — 연결은 WMS 사용자 행위). `DELETE /api/settings/devices/[id]` 사용량 가드에 원장 개체·딜 참조 합산 |
| 병원 삭제(`app/api/hospitals/[code]/route.ts:125-161`) / 일괄 이전(`lib/workItemReassign.ts:235-364`) | RESTRICT FK를 비우는 deleteMany(L145) / 업무만 이동 | RESTRICT + 409 선검사 + transferAll 편입(§9.6). `hospitalDevice.deleteMany`(L145) 제거 |
| 2.0 기획안 A1 '장비 개체 수명주기 관리'(`projects/ops_system_2.0_plan.html`) | 기획(미착수), 미결 = "기존 HospitalDevice와의 관계" | **본 설계가 A1을 구체화·대체** — 미결은 D1로 해소, 소급 범위는 D6과 동일 |
| 티켓·Slack | 워크플로 | 원장은 티켓 도메인 아님 — 어댑터·CTI·Slack 의무 없음 |

## 4. 개념 모델

```
DeviceInfo(확장: device_class·onprem_device_type·serial_pattern·serial_tracked·quantity_tracked)   HospitalWard(신설)
   1 ──▶ N                                                                                             1 ──▶ N
DeviceUnit — 시리얼 정체성(1층), 시리얼당 1행, 전역 UNIQUE serial_no  ← API 공개 device id = device_units.id
  [식별]   device_info_id · serial_no · serial_raw · mac_address · memo · source(MANUAL|IMPORT|WMS|ONPREM|BACKFILL)
   1 ──▶ 0..1 (device_id UNIQUE)                                    1 ──▶ 0..1 (후속: inventory_units.device_id — WMS 편입, 본 설계 범위 밖)
HospitalDevice — 병원 배치 프로젝션(2층 상태 하위표) = fold(이벤트)
  [프로젝션]  status ACTIVE|RECOVERED · hospital_code · ward_id · placed_on · last_hospital_code
              · recovered_on · recover_reason_id · last_event_type/on · replaced_by_id(→ DeviceUnit) · ext_device_code · ext_*
DeviceUnit 1 ──▶ N (append-first — 정정은 §8.2 한정)
HospitalDeviceEvent — device_id(→ DeviceUnit) · event_type REGISTER|MOVE_WARD|RECOVER|CORRECT · hospital_code(사건 병원 비정규화) · from/to_ward_id
   · reason_code_id · occurred_on · memo · ref_type/ref_code · related_device_id(→ DeviceUnit) · action_group · source · import_batch_id · changes · actor
HospitalDeviceImportBatch — 취소 단위 · mode · 카운트 · summary · cancel_summary
```
**3층 구조(B-20, 2026-09-01 사용자 결정)**: `device_info`(모델 마스터) → `device_units`(시리얼 정체성) → 상태 하위표 `hospital_devices`(병원 배치) / `inventory_units`(WMS — `inventory_units.device_id` 편입은 후속). 시리얼·모델·MAC·메모는 유닛의 속성, 병원·병동·상태는 배치 프로젝션의 속성. 이벤트·교체 상대는 유닛을 가리킨다.

### 4.1 단일 소스 불변식
1. **이벤트가 단일 소스, 프로젝션은 파생값.** `rebuildUnitProjection`이 `(occurred_on ASC, id ASC)` fold로 언제든 재계산. 이벤트 INSERT + 프로젝션 UPDATE는 같은 트랜잭션, 라우트의 직접 UPDATE 금지.
2. **시리얼 1개 = 유닛 1행**(`device_units.serial_no` 전역 UNIQUE) + 유닛당 배치 프로젝션 0..1행(`hospital_devices.device_id` UNIQUE) → D3 '활성 배치 1건'이 구조적으로 성립.
3. **소급 입력 허용 + 결정적 fold**(D7): 과거 `occurred_on` 허용(미래 400). 삽입 위치 시점 상태로 전이 검증 후 **이후 이벤트를 다시 접어 전부 성립하는지 확인**, 불성립이면 409("이 일자에 기록하면 이후 이벤트(08-20 병동 이동)가 성립하지 않습니다"). 같은 일자 순서는 id. go-live 임포트 뒤에 그보다 이른 AS 회수를 나중에 정리 입력하는 실무가 막히지 않는다.
4. **이벤트는 append-first** — 지우는 경로는 §8.2의 취소 4종(① 마지막 이벤트 취소 ② 교체·이관 그룹 짝 취소 ③ CORRECT 취소 ④ 임포트 배치 취소)뿐이고 인플레이스 UPDATE는 admin 허용 필드에 한정(D10이 명시한 예외). 사실의 번복은 새 이벤트.
5. **병동은 병원에 속한다** — `(ward_id, hospital_code)` 복합 FK. 이벤트는 병동이 있으면 `hospital_code` 필수 CHECK.
6. **교체 = RECOVER + REGISTER 쌍**(같은 `action_group`, 상호 `related_device_id`). **타 병원 이관도 같은 구조**(RECOVER 사유 `TRANSFER` + REGISTER). REPLACE/TRANSFER 이벤트 타입은 없다. 구기기가 원장에 없으면 같은 그룹에 소급 REGISTER를 앞세워 3이벤트; 구기기가 이미 이 병원에서 회수돼 있으면 RECOVER를 다시 만들지 않고 신 REGISTER 1이벤트 + 구 RECOVER 이벤트에 `related_device_id` 연결(§7.0 교체 계약).
7. **회수 후 원장 책임 종료**(D11): RECOVERED는 `hospital_code NULL`, `last_hospital_code`에 마지막 병원. 재등록 시 이력은 잇되 프로젝션은 현재 배치만 말한다(`last_hospital_code`·`replaced_by_id` NULL).
8. **자동 출처 멱등 키**: `source IN ('WMS','ONPREM')`이고 ref가 있으면 `(ref_type, ref_code, device_id, event_type)` 부분 UNIQUE(훅 재실행 no-op). MANUAL에는 적용하지 않는다(같은 MNT에서 같은 기기를 정당하게 2회 이동하는 입력을 버리면 안 됨).

### 4.2 상태 머신
```
(행 없음) ─REGISTER→ ACTIVE ⟲ MOVE_WARD(같은 병원, to≠현재)      ACTIVE ─RECOVER(사유 필수)→ RECOVERED ─REGISTER(재등록: 같은/타 병원)→ ACTIVE
CORRECT: 어느 상태에서나(admin), 식별 속성만, 전이 없음
```
| 현재 \ 이벤트 | REGISTER | MOVE_WARD | RECOVER | CORRECT |
|---|---|---|---|---|
| (없음) | 행 생성 → ACTIVE | 404 | 404 | 404 |
| ACTIVE(같은 병원) | **skip**(변경 없음 — §7.3 규약) | ✅ | ✅ → RECOVERED | ✅ |
| ACTIVE(타 병원) | **409 + `conflicts[]`**(이관 opt-in 시 RECOVER TRANSFER + REGISTER) | 409 | 직접 불가(예외: 이관 opt-in의 TRANSFER) | ✅ |
| RECOVERED | ✅ → ACTIVE | 409 | 409 | ✅ |

fold 규칙: REGISTER → ACTIVE·hospital_code·ward_id=to·placed_on·(recovered_on·recover_reason·last_hospital_code·replaced_by_id NULL) / MOVE_WARD → ward_id / RECOVER → RECOVERED·last_hospital_code·(hospital_code·ward NULL)·recovered_on·recover_reason_id·replaced_by_id=RECOVER의 `related_device_id` / CORRECT → 식별 컬럼만. `last_event_type/on`은 CORRECT를 제외한 마지막 이벤트. 전이 검증은 `assertTransition` 단일 소스(`canTransition` 선례). 개체 라우트(`/units/[id]/*`)의 병원 문맥은 body가 아니라 `device.hospital_code`에서 서버가 유도한다.

## 5. 데이터 모델
공통: `public` 스키마, FK는 `hospitals.hospital_code` + ON UPDATE CASCADE. **CHECK는 무결성 어휘(상태·타입·상태↔병원·병동↔병원·RECOVER 사유·CORRECT changes·ref 쌍·임포트 source_kind)만**; `ref_type`·`source`·`device_class`·`mode`는 코드 상수만(편입 어휘 확장 시 마이그 불필요). DDL 전문은 부록 A.1.

### 5.1 `device_info` 확장(5컬럼)
| 컬럼 | 타입/제약 | 근거 |
|---|---|---|
| `device_class` | TEXT NOT NULL DEFAULT 'WEARABLE' (WEARABLE/GATEWAY/THIRD_PARTY) | GW 합성 분해·대조 축·요약 그룹 |
| `onprem_device_type` | INTEGER NULL | 온프렘 코드(1 ECG·2 TEMP·3 SpO2·6 BP·8 TAG·10 RING·11 CHARM). 접두 자동 판별·export 매핑. MT100D/MBP100U는 코드로만 열림 |
| `serial_pattern` | TEXT NULL | 경고용 정규식 |
| `serial_tracked` | BOOLEAN NOT NULL DEFAULT false | **원장 대상 모델의 단일 소스**(선택지·요약 스트립·대조 행). 시드 6행 true |
| `quantity_tracked` | BOOLEAN NOT NULL DEFAULT true | 프로젝트·딜 수량 폼 노출 여부. 시드 4행(GW·제3자) false |

기존 2행 UPDATE + 4행 INSERT(MGW1010·SL-MPF1K07·H2-ABPM·RTLS-TAG). `/settings/devices`에 5필드 편집 추가(정규식 컴파일 검증 400). **5필드 변경은 `isAdminOrAbove`**(원장 대상·수량 폼 범위를 바꾸는 시스템 플래그), 기존 필드는 USER+ 유지(인라인 `role==='VIEWER'` → `isUserOrAbove` 헬퍼 교체). `DELETE /api/settings/devices/[id]` usageCount에 `deviceUnit.count`(3층 구조 후 — 구 `hospitalDevice.count`)·`salesDealDevice.count` 합산.

### 5.2 `hospital_wards`(신설)
`id` PK / `hospital_code` NOT NULL FK **RESTRICT** / `name` NOT NULL(원문 trim, 표시) / **`name_norm` NOT NULL**(`normalizeWardName` 결과 — 매칭·유니크 키) / `ext_ward_code` NULL(온프렘 예약) / `is_active` DEFAULT true(폐병동은 비활성) / `sort_order` INTEGER NOT NULL DEFAULT 0 / `created_at`·`updated_at`.
- **UNIQUE(hospital_code, name_norm)** — '6병동'='6 병동' 표기 차이 중복을 DB가 차단. UNIQUE(id, hospital_code)(복합 FK 대상). 부분 UNIQUE(hospital_code, ext_ward_code).
- `normalizeWardName` = trim + 내부 공백 제거 + 대소문자 무시 + 전각/반각 통일. 임포트 해석·동명 409·transferAll 병합이 같은 함수.
- 자동 생성은 `INSERT … ON CONFLICT (hospital_code, name_norm) DO UPDATE SET name_norm=EXCLUDED.name_norm RETURNING id, is_active`(동시 임포트 안전). `is_active=false`가 돌아오면 폐쇄 병동 매칭 → 409 `폐쇄된 병동입니다`(임포트는 `error`). 생성 예정 병동이 여럿이면 `name_norm` 오름차순 순차 INSERT(락 순서 고정).
- 삭제는 참조 0건만(409). 층·병실·병상 계층 없음.

### 5.2b `device_units`(신설 — 시리얼 정체성, 1층)
| 컬럼 | 타입/제약 | 근거 |
|---|---|---|
| `id` | SERIAL PK | **API 공개 device id**(`/api/devices/units/[id]` 등의 `id`는 유닛 id — 서비스 리팩터 결정) |
| `device_info_id` | NOT NULL FK RESTRICT | 모델 축 |
| `serial_no` | TEXT NOT NULL **UNIQUE(전역)**, CHECK `serial_no <> '' AND serial_no = upper(btrim(serial_no))` | 정규화 키(대문자·trim, GW는 `B######`) — Q2. 정규화되지 않은 키 저장을 DB가 차단 |
| `serial_raw` | TEXT NULL, 부분 인덱스 WHERE NOT NULL | 키와 다른 원문(`GW4C11-B008381`, 바코드형) — WMS 매칭·표시 |
| `mac_address` | TEXT NULL | 온프렘 export 식별자(예약 — 붙여넣기 유입값만) |
| `memo` | TEXT NULL | 개체 속성(이벤트 아님) — 현장 식별 보조 |
| `source` | TEXT NOT NULL DEFAULT 'MANUAL' (MANUAL/IMPORT/WMS/ONPREM/BACKFILL — 코드 상수, CHECK 없음) | 유닛이 처음 생긴 경로(후속 WMS 편입 시 유닛을 만든 쪽 구분) |
| `usage_type_id` | INTEGER NULL FK `status_codes` RESTRICT (category `DEVICE_USAGE_TYPE` — value `SALE` 판매용 / `EVAL` 평가용, NULL=미지정) | **용도는 위치가 아닌 물건의 속성**(B-21, 2026-09-01 결정) — 병원 배치·창고 어디에 있든 유닛에 붙어 다닌다. 계약 대조(§9.1)에서 `EVAL`은 제외. 변경은 CORRECT 이벤트(`changes.usageTypeId`) — 라우트 권한은 write(USER+) |
| `created_at` / `updated_at` | | |

인덱스: (device_info_id) / serial_no `text_pattern_ops` / 부분 (serial_raw) / (usage_type_id). 유닛 삭제는 배치·이벤트 참조 0건일 때만(FK RESTRICT). `inventory_unit_id` 컬럼은 두지 않는다 — WMS 편입은 반대 방향(`inventory_units.device_id → device_units`, 후속 마이그).

### 5.3 `hospital_devices`(이름 승계 — 병원 배치 프로젝션, 2층)
유닛당 0..1행. 식별 속성은 5.2b로 이동했고 이 표는 **상태만** 가진다.
| 컬럼 | 타입/제약 | 근거 |
|---|---|---|
| `id` | SERIAL PK | 내부 키(API에는 노출하지 않음 — 공개 id는 `device_id`) |
| `device_id` | NOT NULL FK `device_units` RESTRICT, **UNIQUE** | 유닛당 배치 1행 |
| `ext_device_code` | TEXT NULL | 온프렘 닉네임(병원 문맥 값이라 유닛이 아닌 배치에 둠) |
| `ext_last_seen_at` / `ext_synced_at` | TIMESTAMP(3) NULL | 온프렘 스냅샷 예약(v2 '온프렘 미확인 n일' 근거, 자동 회수 금지) |
| `status` | NOT NULL DEFAULT 'ACTIVE' CHECK (ACTIVE, RECOVERED) | |
| `hospital_code` | NULL FK RESTRICT, **CHECK `(status='ACTIVE') = (hospital_code IS NOT NULL)`** | 현재 배치 병원의 단일 의미 |
| `ward_id` | NULL, **복합 FK `(ward_id, hospital_code) → hospital_wards(id, hospital_code)` DEFERRABLE INITIALLY DEFERRED**, CHECK `ward_id IS NULL OR status='ACTIVE'` | 타 병원 병동 배치를 DB가 거부 |
| `placed_on` | DATE | 현재 REGISTER 일자 |
| `last_hospital_code` | NULL FK **SET NULL** | 회수 시 마지막 병원('회수됨' 필터 축), 재등록 시 NULL. 회수 이력 병원의 삭제 보호는 §9.6 앱 선검사 409로 |
| `recovered_on` / `recover_reason_id` | DATE / FK status_codes RESTRICT | 목록 '회수일·사유' 열(조인 없이) |
| `last_event_type` / `last_event_on` | TEXT / DATE | 목록 '최근 이벤트' |
| `replaced_by_id` | FK **`device_units`** SET NULL | "→ A130001로 교체됨" — 교체 상대는 유닛 |
| `product_type` | TEXT NULL, CHECK `product_type IS NULL OR product_type IN ('일반','라이트')` (`sales_deals.product_type`과 같은 어휘) | **상품유형은 자리의 판매 조건 — 배치 속성**(B-22, 2026-09-01 결정). 물건(유닛)이 아니라 팔린 자리에 붙는다: 한 병원에 일반 50 + 라이트 50이 공존할 수 있고 같은 기기가 다른 병원으로 가면 다시 정해진다. REGISTER 이벤트 값의 fold 파생(CORRECT `changes.productType`으로 갱신) · **교체 상속**(신 배치 = 구 배치 값) · **회수 시 배치 행은 마지막 값을 보존**(표시 '회수 전 라이트')하되 재등록의 REGISTER가 다시 정한다(승계 없음) |
| `created_at` / `updated_at` | | |

**제거된 컬럼(구 단일 테이블 초안 대비)**: `device_info_id`·`serial_no`·`serial_raw`·`mac_address`·`memo`(→ `device_units`), `inventory_unit_id`(→ 후속 `inventory_units.device_id`로 방향 반전). 함께 제거된 제약·인덱스: `hospital_devices_serial_no_key`, `hospital_devices_inventory_unit_id_key`, `hospital_devices_serial_no_pattern_idx`, `hospital_devices_device_info_id_status_idx`, `hospital_devices_hospital_model_status_idx`(모델 축 조회는 `device_units` 조인).
인덱스: (hospital_code, status) / (ward_id) / (last_hospital_code, status) / (hospital_code, product_type, status)(B-22 매트릭스·필터).
**미결정(B-20)**: ACTIVE-only 변형(회수 요약 `last_hospital_code`·`recovered_on`·`recover_reason_id`를 유닛으로 옮기고 배치 행은 ACTIVE만 보유)은 채택하지 않았고 추후 검토.

### 5.4 `hospital_device_import_batches`(신설 — 임포트 취소 단위)
`id` PK(이벤트 `import_batch_id` 하드 FK 대상) / `hospital_code` NOT NULL FK RESTRICT / `source_kind` NOT NULL CHECK(EXCEL, PASTE) / `mode` DEFAULT 'REGISTER'(REGISTER / ONPREM_DRAFT) / `file_name` / `occurred_on` NOT NULL(배치 업무일자, admin 일괄 정정 가능) / `note` / `row_count`·`registered_count`·`reregistered_count`·`skipped_count`·`transferred_count` / `summary` JSONB(미리보기 요약·생성 병동·병동 별칭·선택 org·취소된 단건) / `created_by`·`created_at` / `cancelled_at`·`cancelled_by` / `cancel_summary` JSONB(삭제 시리얼·복원 개체·복원 이관·남긴 병동). 인덱스 (hospital_code, created_at DESC).

### 5.5 `hospital_device_events`(신설 — 이력)
| 컬럼 | 타입/제약 | 근거 |
|---|---|---|
| `id` | SERIAL PK(같은 일자 순서 키) | |
| `device_id` | NOT NULL FK **`device_units`** RESTRICT | 유닛 삭제는 이벤트 0일 때만 |
| `event_type` | TEXT NOT NULL CHECK (REGISTER, MOVE_WARD, RECOVER, CORRECT) | |
| `hospital_code` | NULL FK RESTRICT, CHECK `event_type='CORRECT' OR hospital_code IS NOT NULL`, CHECK `hospital_code IS NOT NULL OR (from_ward_id IS NULL AND to_ward_id IS NULL)` | **사건 병원 비정규화(D8)** — 유지보수 병원 변경·하드 삭제에 불변(유일한 예외: §9.6 일괄 이전 — 같은 실체의 병원 코드 통합이므로 이벤트도 대상 병원으로 이동, 드로어의 '이전 병원' 구분은 사라짐). 두 번째 CHECK는 복합 FK MATCH SIMPLE 우회 차단 |
| `from_ward_id` / `to_ward_id` | 각각 복합 FK (x, hospital_code) RESTRICT DEFERRABLE | MOVE(from→to)·REGISTER(to)·RECOVER(from). RESTRICT라 병동 개명이 이력에 자연 반영 |
| `reason_code_id` | FK status_codes RESTRICT, CHECK `event_type<>'RECOVER' OR reason_code_id IS NOT NULL` | 회수 사유 필수 |
| `occurred_on` | DATE NOT NULL | 업무일자(과거 허용·미래 400) |
| `memo` | TEXT | |
| `ref_type` / `ref_code` | TEXT, CHECK `(ref_type IS NULL)=(ref_code IS NULL)`; 어휘 상수 MAINTENANCE/VOC/INVENTORY_TX/ONPREM_SYNC | 소프트 참조. 임포트는 `import_batch_id` 하드 FK |
| `related_device_id` | FK **`device_units`** SET NULL | 교체·이관 상대(유닛) |
| `action_group` | UUID | 한 액션의 묶음(교체 2건·이관 2건·소급 교체 3건·일괄 N건) |
| `source` | NOT NULL DEFAULT 'MANUAL'(MANUAL/IMPORT/WMS/ONPREM) | |
| `import_batch_id` | FK RESTRICT | 배치 취소 단위(이관 쌍의 RECOVER에도 부여) |
| `changes` | JSONB, CHECK `event_type<>'CORRECT' OR changes IS NOT NULL` | `{field:{before,after}}` |
| `actor_id` / `actor_name` | FK SET NULL / TEXT | 계정 삭제 뒤에도 읽히도록 이름 스냅샷 |
| `edited_at` / `edited_by` | | 인플레이스 정정 흔적 |
| `product_type` | TEXT NULL, CHECK `IS NULL OR IN ('일반','라이트')` | **이벤트 시점 상품유형 스냅샷**(B-22) — REGISTER=이 배치에 지정된 값(fold 소스) · MOVE_WARD/RECOVER=기록 시점 배치 값 · CORRECT=변경 후 값. RECOVER 스냅샷이 교체 집계(`countReplacements`)의 상품유형 축 |
| `created_at` | | 기록 시각(업무일자와 분리 — D7) |

인덱스: (device_id, occurred_on, id) fold / (hospital_code, occurred_on DESC, id DESC) / 부분 (ref_type, ref_code) / 부분 (import_batch_id) / 부분 (action_group) / (event_type, occurred_on DESC) / **멱등 부분 UNIQUE (ref_type, ref_code, device_id, event_type) WHERE ref_type IS NOT NULL AND source IN ('WMS','ONPREM')**.

### 5.6 FK 정책 요약
- **→ hospitals**: devices.hospital_code / events.hospital_code / batches / wards = **RESTRICT**(DELETE 라우트 409 선검사 — 병동만 있는 병원도 409, §9.6) / devices.last_hospital_code = **SET NULL**.
- devices·events → wards: 복합 FK RESTRICT, ON UPDATE CASCADE, DEFERRABLE INITIALLY DEFERRED. **DEFERRED가 유예하는 것은 참조 존재 검사뿐**이고 RESTRICT/CASCADE 동작은 즉시 실행된다 → transferAll은 반드시 '재지정 → 원본 병동 삭제' 순서. 위반은 COMMIT 시 발생하므로 `$transaction` 예외의 P2003/23503을 409 `병동이 이 병원에 속하지 않습니다`로 매핑.
- **복합 FK ON UPDATE CASCADE의 의미**: 병동의 `hospital_code`를 바꾸면 그 병동을 참조하는 기기·이벤트의 `hospital_code`가 함께 바뀐다 — 일괄 이전(§9.6) 전용 경로이며 의도된 동작. 따라서 `PUT /api/hospitals/[code]/wards/[id]`는 `hospital_code`를 받지 않는다.
- devices.device_id·events.device_id → **device_units RESTRICT** / device_units → device_info RESTRICT / → status_codes RESTRICT / devices.replaced_by_id·events.related_device_id → device_units SET NULL / → users SET NULL(+actor_name). inventory_units 방향 FK는 본 마이그에 없음(후속 `inventory_units.device_id`).

### 5b. Prisma 모델 스케치
5모델 모두 `@@schema("public")`. CHECK·DEFERRABLE·부분 인덱스는 SQL이 단일 소스(모델 주석으로만 표기 — `udi_di` 선례). 아래는 실제 `schema.prisma`와 동일 형상(2026-09-01 3층 구조 반영, `validate`·`generate` 통과).
```prisma
model DeviceInfo {            // 기존 + 5필드
  deviceClass       String   @default("WEARABLE") @map("device_class")
  onpremDeviceType  Int?     @map("onprem_device_type")
  serialPattern     String?  @map("serial_pattern")
  serialTracked     Boolean  @default(false) @map("serial_tracked")
  quantityTracked   Boolean  @default(true)  @map("quantity_tracked")
  deviceUnits       DeviceUnit[]             // 구 hospitalDevices HospitalDevice[] 역관계 대체 (usageCount는 _count.deviceUnits)
}
model HospitalWard {
  id Int @id @default(autoincrement())
  hospitalCode String @map("hospital_code");  hospital Hospital @relation(fields:[hospitalCode], references:[hospitalCode], onDelete: Restrict)
  name String;  nameNorm String @map("name_norm");  extWardCode String? @map("ext_ward_code")
  isActive Boolean @default(true) @map("is_active");  sortOrder Int @default(0) @map("sort_order");  createdAt/updatedAt
  devices HospitalDevice[] @relation("DeviceWard");  eventsFrom HospitalDeviceEvent[] @relation("EventFromWard");  eventsTo HospitalDeviceEvent[] @relation("EventToWard")
  @@unique([hospitalCode, nameNorm])  @@unique([id, hospitalCode])  @@map("hospital_wards")  @@schema("public")
}
model DeviceUnit {           // 1층 — 시리얼 정체성
  id Int @id @default(autoincrement())
  deviceInfoId Int @map("device_info_id");  deviceInfo DeviceInfo @relation(fields:[deviceInfoId], references:[id], onDelete: Restrict)
  serialNo String @unique @map("serial_no");  serialRaw String? @map("serial_raw");  macAddress String? @map("mac_address");  memo String?
  source String @default("MANUAL");  createdAt/updatedAt
  placement HospitalDevice? @relation("UnitPlacement")                 // 배치 프로젝션 0..1
  replacedPlacements HospitalDevice[] @relation("DeviceReplacement")   // 이 유닛이 교체기로 들어간 구기기 배치들
  events HospitalDeviceEvent[] @relation("DeviceEvents");  relatedEvents HospitalDeviceEvent[] @relation("EventRelatedDevice")
  @@index([deviceInfoId])  @@map("device_units")  @@schema("public")
}
model HospitalDevice {       // 2층 — 병원 배치 프로젝션
  id Int @id @default(autoincrement())
  deviceId Int @unique @map("device_id");  unit DeviceUnit @relation("UnitPlacement", fields:[deviceId], references:[id], onDelete: Restrict)
  extDeviceCode String? @map("ext_device_code");  extLastSeenAt DateTime? @map("ext_last_seen_at");  extSyncedAt DateTime? @map("ext_synced_at")
  status String @default("ACTIVE")
  hospitalCode String? @map("hospital_code");  hospital Hospital? @relation("DeviceCurrentHospital", fields:[hospitalCode], references:[hospitalCode], onDelete: Restrict)
  wardId Int? @map("ward_id");  ward HospitalWard? @relation("DeviceWard", fields:[wardId, hospitalCode], references:[id, hospitalCode], onDelete: Restrict)
  placedOn DateTime? @map("placed_on") @db.Date
  lastHospitalCode String? @map("last_hospital_code");  lastHospital Hospital? @relation("DeviceLastHospital", fields:[lastHospitalCode], references:[hospitalCode], onDelete: SetNull)
  recoveredOn DateTime? @map("recovered_on") @db.Date;  recoverReasonId Int? @map("recover_reason_id");  recoverReason StatusCode? @relation("DeviceRecoverReason", …, onDelete: Restrict)
  lastEventType String? @map("last_event_type");  lastEventOn DateTime? @map("last_event_on") @db.Date
  replacedById Int? @map("replaced_by_id");  replacedBy DeviceUnit? @relation("DeviceReplacement", fields:[replacedById], references:[id], onDelete: SetNull)
  createdAt/updatedAt
  @@index([hospitalCode, status])  @@index([wardId])  @@index([lastHospitalCode, status])  @@map("hospital_devices")  @@schema("public")
}
model HospitalDeviceImportBatch { …§5.4 컬럼, summary Json?, cancelSummary Json?;  hospital(Restrict);  createdById String? @map("created_by");  createdBy User? @relation("DeviceImportCreatedBy", …, onDelete: SetNull);  cancelledById String? @map("cancelled_by");  cancelledBy User? @relation("DeviceImportCancelledBy", …, onDelete: SetNull);  events HospitalDeviceEvent[];  @@map("hospital_device_import_batches")  @@schema("public") }
model HospitalDeviceEvent {
  …§5.5 컬럼;  actionGroup String? @db.Uuid @map("action_group");  changes Json?
  device DeviceUnit @relation("DeviceEvents", …, onDelete: Restrict);  hospital Hospital?;  fromWard/toWard HospitalWard? (복합, "EventFromWard"/"EventToWard")
  reasonCode StatusCode? @relation("DeviceEventReason");  relatedDevice DeviceUnit? @relation("EventRelatedDevice", onDelete: SetNull);  importBatch HospitalDeviceImportBatch?
  actor User? @relation("DeviceEventActor");  editedBy User? @relation("DeviceEventEditor")
  @@index(…§5.5)  @@map("hospital_device_events")  @@schema("public")
}
```
- 관계명(서비스 계층이 그대로 쓰는 이름): `DeviceUnit.placement` ↔ `HospitalDevice.unit`("UnitPlacement") / `HospitalDevice.replacedBy` ↔ `DeviceUnit.replacedPlacements`("DeviceReplacement") / `HospitalDeviceEvent.device` ↔ `DeviceUnit.events`("DeviceEvents") / `HospitalDeviceEvent.relatedDevice` ↔ `DeviceUnit.relatedEvents`("EventRelatedDevice").
- 역관계: `Hospital`의 기존 무명 `hospitalDevices HospitalDevice[]`(L82)를 `@relation("DeviceCurrentHospital")`로 교체 + `lastHospitalDevices @relation("DeviceLastHospital")` 추가(같은 모델 쌍 관계 2개 → 이름 필수) + `hospitalWards`·`deviceEvents`·`deviceImportBatches` / `User` 4개(DeviceImportCreatedBy·DeviceImportCancelledBy·DeviceEventActor·DeviceEventEditor) / `StatusCode` 2개 / `DeviceInfo.deviceUnits`. **`InventoryUnit.hospitalDevice?` 역관계는 제거**(WMS 편입은 후속 `inventory_units.device_id`).
- **복합 FK와 Prisma 5.22**: 두 관계가 `hospitalCode`를 공유하는 형태는 `validate`·`generate` 통과 확인. checked/unchecked 입력 혼용 불가 → **서비스는 전부 스칼라(unchecked) 입력**으로 쓴다.

### 5c. 코드 상수 vs DB 마스터
| 어휘 | 위치 |
|---|---|
| 상태·이벤트 타입·전이표·라벨 | `lib/deviceRegistryShared.ts`(클라이언트 안전 `as const`) + DB CHECK |
| `source`·`ref_type`(+링크 빌더)·`device_class`·배치 `mode`·온프렘 코드표·임포트 판정 상태 | 같은 파일, CHECK 없음(상수 1줄로 확장) |
| `normalizeSerial`·`parseSerialLines`·`detectOnpremHeader`·`normalizeWardName`·`suggestOccurredOnFromMaintenance` | 같은 파일(서버·클라이언트·후속 유지보수 라우트가 같은 함수). 일자 제안 = `max(visits.endDate ≤ 오늘)`(없으면 startDate) ?? `resolvedAt` ?? `reportedAt` ?? null — `MaintenanceVisit`은 `startDate/endDate`(기간형), 미래 방문은 제안하지 않음 |
| 모델별 시리얼 형식·플래그 | `device_info` 행 |
| **회수 사유** | StatusCode `DEVICE_RECOVERY_REASON` + `/api/settings/device-recovery-reason`(+`[id]`) + `StatusCodeManager` 페이지 + nav + seed. `value` 5개: `DEFECT`(교체 기본)·`LOST`(WMS 대조 제외)·`RETURN`(반납 — WMS `STOCK_IN_TYPE` RETURN과 동일 의미, 후속 반품 입고 훅이 사용)·`DISPOSE`·`TRANSFER`(이관). value 행·사용 중 행 삭제 불가 |
| **용도(usage type)** | StatusCode `DEVICE_USAGE_TYPE` + `/api/settings/device-usage-type`(+`[id]`) + `StatusCodeManager` 페이지(`/settings/device-usage-type`) + nav 42 + seed. `value` 2개: `SALE`(판매용)·`EVAL`(평가용 — 계약 대조 제외). 유닛 속성 `device_units.usage_type_id`(NULL=미지정). 상수·별칭·매칭(`DEVICE_USAGE_TYPE_CATEGORY`·`USAGE_TYPE_VALUES`·`USAGE_TYPE_INPUT_ALIASES`·`matchUsageType`·`usageValueFromInput`)은 `lib/deviceRegistryShared.ts`. value 행(시스템 용도)·사용 중(`device_units.usage_type_id`) 행 삭제 불가(409). '대웅제약재고'는 판매용 창고이지 제3의 값이 아님 |
| 계약완료 딜 상태명 | 상수 `DEAL_STATUS_CONTRACTED`(08-03 스크립트와 동일 규칙 주석) |

### 5d. 기존 `hospital_devices` 폐기 경로(D1)
1. 마이그레이션 첫 문장에서 **`CREATE TABLE hospital_devices_qty_backup_202609 AS SELECT * FROM hospital_devices`** → `DROP TABLE hospital_devices`(나가는 FK 2개뿐) → 새 테이블 CREATE. 같은 DB 안에 원본 행이 그대로 남으므로 별도 게이트 없이 어느 DB에서 실행해도 안전하고, 롤백은 백업 테이블 RENAME + 제약·시퀀스 복원(부록 A.0 ②, 8문장 — `CREATE TABLE AS`는 PK·FK·UNIQUE·NOT NULL·DEFAULT·시퀀스를 복사하지 않음). PROD 배포 직전 전체 덤프(`pg_dump -Fc`)는 표준 절차대로 추가.
2. Prisma는 `HospitalDevice`를 새 형상(배치 프로젝션)으로 재정의(모델명 유지) + `DeviceUnit` 신설. **tsc는 `quantity` 참조(`page.tsx:133`, `tools.ts:622`)만 잡는다** — where-only 호출(`route.ts:145` deleteMany, `page.tsx:91` findMany)은 새 모델에도 `hospitalCode`가 있어 통과하므로 아래 팬아웃을 수동 제거하고 P1 검증에서 `grep -rn "hospitalDevice\." app lib`가 신규 코드 외 0건임을 확인한다.
3. **팬아웃**: `app/api/hospitals/[code]/devices/route.ts` **파일 삭제**(GET·PUT — 소비처는 재작성되는 상세 페이지·교체되는 섹션뿐) / `app/hospitals/[code]/page.tsx:9,17,47,90-91,133-138,252-257,341` / `HospitalDevicesSection.tsx`(교체)·`InventoryUsageCard.tsx`(삭제) / `app/api/hospitals/[code]/route.ts:145` / `lib/ai/tools.ts:602,621-623` / 수량 폼 3곳 필터 / `app/settings/devices/*`·`app/api/settings/devices/*`(5필드·헬퍼·usageCount·DELETE 가드) / `schema.prisma:82,352-367,456-468` / `README.md`(369·491·538·929-949·1490-1491) / `projects/hospitals_erd.html` / 문서 3건(`inventory_udi_ledger_design.md:166` 정오표 1줄, `ops_system_2.0_plan.html` A1 링크, `projects/README.md` 2.0 행).
4. **구현 중 위험 — 파괴적 마이그레이션이 main에 있는 동안의 핫픽스 배포**: dev/dev2는 main을 공유하고 "prod에 반영해줘" 절차는 `migrate deploy`를 동반하므로, P1~P4 변경분이 P5 전에 main에 올라가면 무관한 핫픽스 배포가 이 마이그를 함께 실행한다(백업 테이블 덕에 데이터는 남지만 구 코드가 있으면 병원 상세 500). **확정(A-6): feature 브랜치 `feat/device-registry`에서 P1~P4 진행, P5에 마이그 폴더 포함 일괄 머지. dev2 DB는 `thync_ops_dev`에 바로 적용**(P1~P5 사이 main 체크아웃 시 병원 상세만 로컬 500 — 감수). 마이그 폴더명은 P1에 고정(`20260901120000_hospital_device_registry`)하고 개명하지 않음. 긴급 핫픽스는 main에서 만들어 브랜치로 cherry-pick.

## 6. 화면 설계
원칙: 빈 상태에서도 전 헤더·필드 노출, 요약 스트립 + 탭/패널(카드 나열 아님), 병원은 검색 콤보, 서버 페이지네이션. `app/devices/page.tsx` + `_components/*`. **URL 동기화** `?hospital=&tab=list|history|wards|import`(병원 선택 시) / `?tab=coverage|events`(병원 미선택 시) `&status=&model=&ward=&q=&page=&device=<id>`(드로어 딥링크).

### 6.1 `/devices`

**v1 단순화(2026-09-01 사용자 피드백 — "기능이 너무 많아 복잡하다. 구현된 기능은 지우지 말고 UI는 단순한 초기 버전으로 시작해 개선")**

현재 노출 형상은 **메인 탭 2개**(`?view=hospital|devices`, 기본 hospital)이며, 아래 원 와이어프레임(A·B)은 '전체 기능 레이아웃(후속 노출)'로 보존한다 — 컴포넌트·API는 전부 살아 있고 오케스트레이터(`DevicesClient`)가 그리지 않을 뿐이다.
- **헤더**: 제목 '디바이스 원장' + 메인 탭 **[병원별] [디바이스]**만. 전역 요약 줄·헤더 시리얼 조회(`SerialLookup`)·헤더 [Excel]은 제거(Excel은 각 뷰 안으로 이동).
- **[병원별]**(`?view=hospital&hospital=&tab=list|history|wards|import&status=&model=&ward=&q=&page=&device=`)
  - 1행 병원 콤보(기존 `HospitalPicker`, '전체 병원 검색' 토글 유지) … 우측(USER+) **[+ 등록] [임포트]**(임포트는 하위 탭 전환). 헤더 [교체]는 제거 — 행 ⋯·드로어 [교체]로만.
  - 2행 **요약 한 줄** `배치 중 18 · 계약 60 · 회수 2 · 병동 3` — '계약' 클릭 → 팝오버(모델별 hard/soft 대조·근거 딜 목록·평가용 제외 문구·상품유형별·교체 집계 = 구 `SummaryStrip` 내용). 매트릭스 표·WMS 열·평가용 칩은 노출하지 않음(`SummaryStrip.tsx`는 보존, 미사용).
  - 3행 소형 탭 **기기 목록 | 이력 | 병동 | 임포트**(기본 기기 목록) — `EventsTab`/`WardPanel`/`ImportPanel`은 그대로. 우측에 [선택] 토글(USER+, 기기 목록 탭) + [Excel](기기 목록/이력 탭 기준).
  - 기기 목록 = `DeviceTable compact showSelection={선택 토글}`: 기본 열 `시리얼 | 모델 | 병동 | 상태 | 상품유형 | 배치일 | 최근 이벤트 | ⋯`, 용도·회수일·사유·연결·창고 개체·메모·원문 2행은 **[열 더보기]**; 필터는 상태(배치 중/회수됨/전체) + 시리얼 검색만 기본, 모델 칩·병동·WMS·용도·상품유형·정렬·행수는 **[필터 더보기]**(숨은 필터에 값이 있으면 자동 펼침). 체크박스·선택 바(`BulkActionBar`)는 [선택] 토글을 켤 때만(기본 off). 행 ⋯ 메뉴(이동/회수/교체/정정)·빈 상태 문구는 동일.
  - 병원 미선택(첫 화면): **축약 병원 커버리지 표**(`GlobalCoverage compact` — 2026-09-01 피드백 "첫 페이지에 아무것도 안 보이는 건 별로" → 09-02 "일반·라이트 수량을 따로" → 09-02 3차 개정 "병원당 1행"). 열 `병원명 | 상태 | 판매유형 | 심전계 | 심전계(라이트) | 산소포화도 | 산소포화도(라이트) | 혈압계 | 혈압계(라이트) | 마지막 이벤트` — 병원당 **1행**. **혈압계 = 링 혈압계(CART BP) SL-MPF1K07**(`onprem_device_type` 10 — MBP100U 아님, id 하드코딩 없음). 판매유형 = 일반/라이트 배지((계약완료 딜 유형 ∪ ACTIVE 배치 유형) 합집합, 일반 먼저, 없으면 '—'). 기기 6셀 = **ACTIVE 배치 수(평가용 포함 — 배치 현황이지 계약 대조가 아님)**, 기본 열 = '일반'·(라이트) 열 = '라이트', 고정 폭(w-20) 우측 정렬 tabular-nums로 그리드 정렬, **0은 회색 '0'**(원장 없는 병원도 '미등록' 문구 없이 전부 0), 심전계 셀 툴팁에 그 유형 계약 수(`expectedByType`). 미지정 ACTIVE 배치는 어느 열에도 합산하지 않고 병원명 옆 warning 배지 `미지정 n`(툴팁 '기기 목록에서 지정하세요'). **[임포트] 퀵 액션 없음**(등록은 병원 진입 후). GW·제3자(링 제외) 수는 이 표에 없음. 툴바 = 필터 [전체|등록 0|차이 있음|등록 완료]('unregistered' 값·동작 유지, 라벨만 '등록 0') + 검색 [병원명/코드](정렬 '차이 큰 순' 고정, 셀렉트 숨김), 50행, 행 클릭 → 병원 선택(setHospital). 모바일 카드: 병원+상태+판매유형 배지 + '일반 E n · S n · BP n'/'라이트 …' 두 줄. 데이터: `getGlobalCoverage` 행의 `byProductType{일반|라이트|미지정}{ecg,spo2,bp}`·`expectedByType{일반,라이트}`(09-02 additive 확장 — 기존 grouped 쿼리에 FILTER 카운트, N+1 없음, 기존 필드 전부 유지 = 전체 12열 모드 계속 동작). 전체 12열 모드·전역 최근 이벤트 탭은 v1 UI에 없음(파일·API 보존). `MobileActionBar`도 렌더하지 않음. URL: 병원 미선택 시 `q`/`page`는 이 표의 병원명 검색·페이지(병원 선택 시 초기화).
- **[디바이스]**(`?view=devices&status=&model=&usage=&productType=&q=&page=&device=`) — 신규 `DeviceListTab`: 병원 무관 전 기기 평면 목록. 툴바 검색 [시리얼/병원명] · 모델 · 상태(배치 중|회수됨|전체) · 용도 · 상품유형 · [Excel](같은 필터 `/api/devices/export`). 표 `시리얼 | 모델 | 용도 | 상품유형 | 현재 병원(RECOVERED는 '회수 전 X') | 병동 | 상태 | 배치일 | 최근 이벤트`, 행 클릭 → `DeviceHistoryDrawer`(양쪽 뷰 `?device=` 딥링크 공통), 페이지 50. 쓰기 버튼 없음(등록·이동·회수는 병원 문맥 — 드로어에서 액션을 누르면 그 기기의 병원별 뷰로 전환 안내). 시리얼 검색이 구 헤더 '시리얼 조회'를 대체: `GET /api/devices/units?q=`가 hospital 미지정이면 현재/마지막 **병원명**도 매치하고, 정렬 기본 시리얼 오름차순 + 페이지 내 정확 일치 행 상단 고정.
- URL 구 링크(`tab=coverage|events`, `view` 없음)는 기본값(view=hospital, tab=list)으로 관대하게 매핑.

**전체 기능 레이아웃(후속 노출)** — 아래는 P3~P4에서 구현된 원 설계. 컴포넌트는 전부 존재하며 사용자 피드백에 따라 단계적으로 다시 노출한다.
```
┌ PageHeader: 디바이스 원장 ─────────────────────────────── [Excel]  시리얼 조회 [A126861     ] ↵ ┐
│ 병원: [🔎 병원 검색 (고객 병원 사전 로드 · ☐ 전체 병원 검색) ▾ ]                                     │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **병원 콤보**: 고객(운영·계약완료·보류) ∪ 원장 보유 ≈215 사전 로드 + '전체 병원 검색' 토글(`/api/hospitals?search=`). `SearchSelect`(`app/weekly/_components/SearchSelect.tsx`) 재사용(표시 50건 캡) + `onSearch?(q)` 비동기 옵션 1개 추가(토글 on이면 `/api/hospitals?search=` 호출, 20건 표시). URL `hospital=`은 모집단과 무관하게 `/api/hospitals/[code]`로 조회해 렌더.
- **시리얼 조회**(`GET /api/devices/lookup?serial=`): 입력은 `normalizeSerial` 통과 후 `serial_no`=키 OR `serial_raw`=원문으로 조회. ACTIVE 1건 → 그 병원으로 전환 + 드로어 / RECOVERED 1건 → `last_hospital_code` 병원 + 상태 필터 '회수됨' + 드로어 / 0건 → "원장에 없음" + 원장 접두 일치 ≤10건(`serial_no LIKE '키 앞 5자%'`, `text_pattern_ops` — 오타 임포트 발견 경로, 병원·상태 표시) + WMS 개체 ≤10건(§9.2 배치 매칭 쿼리 재사용, WMS 라우트 무변경).
- **가시성**: 읽기 전원 / [등록][교체][이동][회수][임포트]·병동 추가·메모 USER+(`GET /api/devices/can-manage` 프로브) / 정정·취소·배치 취소·식별 보정·병동 비활성/삭제 admin(드로어 '관리'·행 ⋯에만). VIEWER에게 임포트 탭은 노출하되 입력 영역 대신 EmptyState "임포트는 USER 등급부터 가능합니다" + 임포트 이력(읽기). `canWrite=false`면 USER+ 컨트롤(병동 탭 ✎·↑↓·추가, 메모 입력 포함)을 렌더하지 않고 읽기 값만 표시.

**A. 전역 뷰(병원 미선택 = 백필 진행판)**
```
요약: 고객 병원 214 · 원장 등록 병원 21 · 배치 중 ECG 3,812 / SpO2 3,640 / GW 402 / 제3자 15 · 최근 30일 이벤트 148 · 회수(30일) 12
탭 [병원 커버리지] [최근 이벤트]
필터 [전체 ▾ | 미등록만 | 차이 있음 | 등록 완료]   검색 [병원명/코드]   정렬 [차이 큰 순 ▾ | 병원명 | 마지막 이벤트]
| 병원 | 상태 | 계약 ECG | 배치 중 ECG | 차이 | 평가용 | SpO2(참고) | GW | 회수(30일) | 마지막 이벤트 | 마지막 임포트 | → |
| 세란병원 | 운영 | 127 | 127 | 0 ✔ | 4 | 127 | 18 | 0 | 08-20 등록 | 08-20 (127행) | 열기 |
| 한양대병원 | 운영 | 370 | 358 | −12 ▲ | 185 | 41 | 3 | 08-28 회수 | 08-12 | 열기 |
| 제주한라병원 | 운영 | 500 | — | 미등록 | — | — | — | — | — | 임포트 |
| 데모병원 | 보류 | — (계약완료 딜 없음) | 12 | — | 12 | 2 | 0 | 08-30 등록 | — | 열기 |
(page/limit 50 · 원장 0건이어도 계약 열은 채워지고 나머지 '—'/'미등록' — 이 표 자체가 D6 백필 진행판. 배치 중 ECG·차이는 평가용(EVAL) 제외, '평가용' 열은 전 모델 EVAL 합계 — §9.1)
```
`GET /api/devices/summary`(병원별 groupBy 1회 + 딜 Σ). '회수(30일)' = RECOVER `occurred_on ≥ 오늘−30일`(업무일자 기준). '차이 있음'은 계약완료 딜이 있는 병원만. '최근 이벤트' 탭 = 전역 이벤트 목록(기본 30일).

**B. 병원 뷰 — 요약 스트립 + 탭**
```
| 모델 | 배치 중 | 계약 | 차이 | 회수(30일) | WMS 매칭(출고/재고⚠/미매칭) |
| 심전계 MC200M-T | 198 | 200 | −2 ▲ | 3 | 190 / 1 / 7 |    ← hard: 계약완료 딜 Σ대웅 디바이스 수(클릭 → 근거 딜 팝오버)
| 산소포화도 MP100W | 185 | (참고 200) | — | 1 | 180 / 0 / 5 | ← soft: ECG 동수 가정, 회색
| 게이트웨이 MGW1010 | 41 | — | — | 0 | 41 / 0 / 0 |       ← 계약 축 없음
| 제3자 기기 ▸ | 12 | — | — | 0 | — |                        ← 링BP 12 · 참BP 0 · RTLS 0
| 병동 7개 (미지정 3대) · 평가용 4 |                ← 배치 중 열은 계약 축 행에서 평가용 제외 수 + '(평가용 n 별도)', 병동 줄에 '평가용 n' 칩(evalTotal>0)
탭 [기기 목록 (424)] [이력 (612)] [병동 (7)] [임포트 (2)]      우측(USER+): [+ 등록] [교체] [임포트]   선택 시: [병동 이동] [회수] [상품유형 지정]
```
**상품유형 매트릭스(B-22)** — 병원이 혼합(계약 딜 일반+라이트)이거나 배치에 상품유형이 하나라도 있으면 모델 행 아래 소행:
```
| 심전계 MC200M-T | 100 | 100 | 0 ✔ | 3 | … |
|   └ 일반        |  50 |  50 | 0 ✔ | — | — |
|   └ 라이트      |  48 |  50 | −2 ▲ | — | — |
|   └ 미지정      |   2 |  — | — | — | — |        ← 혼합 병원의 미지정 배치(선택 바 [상품유형 지정]으로 정리)
| 병동 7개 (미지정 3대) · [상품유형 혼합] · 교체: 전체 6 (일반 4 · 라이트 2) · 최근 30일 1 |
```
혼합이 아니면 단일 행 그대로, 계약 팝오버에 '상품유형: 일반 60대(3건)' 라벨. [상품유형 지정] → 소형 모달(일반/라이트/미지정으로 · 업무일자 · 메모) → `bulk SET_PRODUCT_TYPE`. 커버리지 표 병원명 옆 '상품유형 혼합' 배지 + '미지정 n'.
계약 열 팝오버: "계약 = 계약완료 딜의 대웅 디바이스 수 합(ECG 기준). `1차 2025-03 40대 · 2차 2026-01 20대` → 딜 링크. SpO2는 참고, GW는 계약 축 없음. 도입 병상 수와 무관. 배치 중·차이는 평가용(EVAL) 제외". 계약완료 딜이 없으면 '— (계약완료 딜 없음)'. 대조는 참고 신호임을 문구로 명시(딜 데이터 정정 요구가 운영팀으로 유입되지 않게).

- **기기 목록 탭**: 필터 상태(● 배치 중 / 회수됨(미재배치) / 전체)·모델 칩·병동(미지정·폐쇄 포함)·시리얼 검색(키·원문·닉네임)·WMS·용도(`usage=SALE|EVAL|none`)·상품유형(`productType=일반|라이트|none`). 컬럼 `☐ | 시리얼(mono, ⚠형식, 원문 2행) | 모델 | 용도(판매용 default·평가용 warning 배지, 미지정 '—') | 상품유형(일반 default·라이트 primary 배지, 미지정 '—', 회수 행은 '회수 전 라이트' outline — B-22) | 병동 | 상태 | 배치일 | 회수일·사유 | 최근 이벤트 | 연결(MNT 링크) | 창고 개체 | 메모 | ⋯`. 정렬 병동→시리얼(기본)/시리얼/배치일/최근 이벤트. page/limit 50(≤500). **다중 선택 + '검색 결과 전체 선택 N건'**(≤2,000) → 일괄 이동/회수(252병동 → 101병동 통째 이동이 ≤5 입력, 병동 탭 [기기 일괄 이동] 기준 4). 빈 상태: 헤더 + "등록된 기기가 없습니다. [+ 등록] 또는 [임포트] 탭에서 시작하세요."
- **이력 드로어**(기기 클릭 · 우측 슬라이드 / 모바일 바텀시트) — 병원 경계 무관 전체 이벤트, 최신순
```
A126861 · 심전계 MC200M-T · 배치 중 @ 순천향대부천병원 101병동 (배치일 2026-05-12) · 창고 개체: 대웅제약재고 OUT
온프렘 스냅샷 ▸ (닉네임 S12 · MAC 08:D5:C0:5…)   ← 값이 있는 항목만, 전부 비면 행 미노출    메모 [           ] (USER+ 인라인 저장)
[병동 이동] [회수] [교체]                                                  관리 ▾ (ADMIN/device.admin)
2026-05-30  병동 이동   252병동 → 101병동     MNT-202605-0047   김○○ (기록 05-30 14:02)   [정정]
2026-05-12  등록        → 252병동  (임포트 #12, go-live)                                  (배치 취소로만)
─ 이전 병원 ─
2025-11-20  회수        ○○병원 6병동 · 불량(AS 회수) → 교체 A130001   MNT-202511-0009
2025-02-01  등록        ○○병원 6병동
```
각 행: 업무일자 · 타입 배지 · 요약(병동 from→to / 사유 / 교체·이관 상대 링크) · 연결 · 기록자 · 기록 시각(업무일자와 다르면 회색 병기 — D7). 관리: 이벤트 정정(§8.2 허용 필드)·마지막 이벤트 취소·모델/시리얼 정정.
- **폼**(`Modal`, 모바일 바텀시트) — 스캐너 친화(autoFocus·자동 대문자·Enter 줄 추가·중복 줄 병합·⌘/Ctrl+Enter 제출). 공통: 업무일자(기본 오늘·과거 허용) · 메모 · **유지보수 코드 자동완성**(`GET /api/devices/maintenance-lookup?hospital=&q=` — 선택 시 업무일자를 §5c 규칙으로 자동 채움(사용자가 이미 고친 값은 유지, 출처 툴팁); `MNT-YYYYMM-NNNN` 정확 입력이면 타 병원 건도 선택 가능 + '다른 병원으로 기록된 건' 경고) · 대상 지정 = 선택 칩 + **시리얼 입력줄**(↵/스캔마다 lookup → 이 병원 ACTIVE면 칩 추가, 아니면 인라인 오류). 병동 입력은 모든 폼에서 같은 '콤보 + 새 병동' 컴포넌트(비활성 병동 미노출).
  - **등록**: 시리얼 textarea · 모델(자동/고정) · 병동 · 용도 [미지정|판매용|평가용](폼 공통 기본 미지정 — 줄의 3열 이후 '판매용/평가용' 셀이 우선 → `body.usageTypeId`/`items[].usageType`) · **상품유형 [기본값 (계약 딜 기준: 라이트)|일반|라이트]**(B-22 — 라벨이 기본값 출처를 보여준다: 1종 '계약 딜 기준: X' · 0종 '계약완료 딜 없음: 미지정' · 혼합 '선택 필수' + 빨간 안내; 줄의 '일반/라이트/lite' 셀이 우선 → `body.productType`/`items[].productType`; 문맥은 preview 응답 `productTypeContext`) · 업무일자 · 메모 · 코드. 실시간 판별은 임포트와 같은 `?preview=true` 엔진(디바운스, 200줄 초과 시 수동 [판별]). 판별 패널: 모델별 카운트 · ⚠형식 · 재등록(이전 회수 사유·일자) · 이미 배치 중(skip) · ✖ 타 병원 배치 중 → 행별 [제외][이관 처리] · 폐쇄 병동 → [미지정으로 등록](임포트와 동일 `rowActions`).
  - **병동 이동**: 대상(칩+입력줄, 현재 병동 요약) · 병동 · 업무일자 · 메모 · 코드.
  - **회수**: 대상 · 사유(마스터) · 업무일자 · 메모 · 코드. `LOST` 안내 "분실 — 창고 반입 대상 아님", **`DEFECT` 선택 시 [교체 폼으로 전환]** 원클릭.
  - **교체(1폼 → 2이벤트)**: 상품유형은 읽기 전용 '구 기기와 동일(라이트)'(신 배치 상속, B-22 — 신 기기가 이미 이 병원 배치 중이면 상속하지 않음 안내), 구 기기 소급 등록 경로에서만 select(기본값 라벨·혼합 필수). 구 시리얼 ↵ 조회 → (a) 이 병원 ACTIVE: 모델·병동·상품유형 표시 / (b) **원장에 없음**(점진 백필 병원의 첫 AS — 가장 흔한 경로): '원장에 없는 시리얼 — 이 병원에 업무일자로 소급 등록한 뒤 교체합니다(실제 설치일은 기록되지 않음)' 안내 + 모델(접두 자동)·병동 입력 → 같은 `action_group`으로 REGISTER(구, 소급) → RECOVER(구) → REGISTER(신) 3이벤트 / (c) 타 병원 ACTIVE: **409** "구 기기가 {병원}에 배치 중 — 그 병원에서 회수(또는 이관) 기록 후 신 기기를 등록으로 처리하세요" / (d) 이 병원에서 이미 RECOVERED(먼저 회수 처리, 교체기 뒤늦게 도착): 'RECOVER 없이 교체 기기만 등록' 안내 → REGISTER(신) 1이벤트 + 구 RECOVER에 `related_device_id` 연결 → 신 시리얼(모델 자동·⚠접두 불일치·회수 이력 있으면 "재등록으로 이력 연결" 힌트·타 병원 ACTIVE면 [이관 처리]·**이 병원 배치 중이면 '이미 등록된 기기 — 회수만 기록하고 병동을 맞춥니다' 안내**(§7.0 (5))) · 병동(구 기본) · 사유(DEFECT 기본) · 업무일자 · 코드. Tab 구→신→제출, 토스트 "교체 기록: P018363 회수(불량) · P020418 등록(3병동)".
- **이력 탭**: 기간·유형·시리얼·연결 유형 필터. 컬럼 `업무일자 | 유형 | 시리얼 | 모델 | 내용(병동 from→to·교체 상대) | 사유 | 연결 | 기록자 | 메모`. 교체·이관 쌍은 1행 '교체 B033167→B035120', 임포트 배치는 1행 '등록 127대 (배치 #12) ▸'. Excel.
- **임포트 탭**(입력 → 미리보기 → 결과 + 이력)
```
모드 (● 신규 등록  ○ 온프렘 export 초안)   ← 헤더에 시리얼 별칭 + (wardCode|deviceType 별칭)이 있거나 deviceRegisterList JSON이면 초안 모드 제안
[텍스트 붙여넣기] | [Excel 업로드 · 템플릿 ↓]   업무일자 [2026-08-20] ("이 목록이 병원에 배치된 날(go-live·설치일)" — 오늘이고 행 ≥50이면 확인 배지)
병동 [열에서 읽기 ▾ | 고정]  (열 모드 빈 셀: ● 미지정으로 등록(warn) / ○ 오류)   모델 [자동 ▾]   용도 [미지정 ▾](E열/붙여넣기 용도 셀 우선)   상품유형 [기본값(계약 딜 기준: 일반) ▾](F열/붙여넣기 '일반·라이트' 셀 우선 — 혼합 병원은 미지정 행 error)   메모 [go-live 1차]
[미리보기]
요약: 총 131 · 신규 118 · 재등록 2 · 건너뜀(이미 배치) 7 · 경고 3 · 충돌 1(기본 제외) · 오류 1     [전체|정상|재등록|경고|충돌|오류|건너뜀]
생성 예정 병동: | 입력명 | 처리 [새로 생성 ▾ | 기존 병동으로 매핑: 6병동 / 61병동 …] |     ← 오타 병동을 실행 전에 흡수(wardAliases)
(초안 모드) 이 export에 기관 코드가 2개 있습니다 — 이 병원 소속만 선택: ☑ BSHOSP (412행) ☑ BSHOSP1 (388행) [이 기관만 등록]   ← 기본 전부 체크, ≥2이면 이 버튼(재검증)을 누르기 전까지 [실행] 비활성
| ☑ | 행 | 시리얼(정규화) | 원문 | 모델 | 용도 | 상품유형 | 병동(해석) | 판정 | 메시지 / 행 액션 |
| ☑ | 2 | A126861 | a126861 | 심전계 | 6병동 | ok | |
| ☑ | 3 | B008381 | GW4C11-B008381 | 게이트웨이 | 6병동 | ok | 합성 시리얼 분해 · 원문 보존 |
| ☑ | 4 | A12016 | | 심전계 | 62병동(신규) | warn | 형식 불일치(A+6자리) · 병동 자동 생성 |
| ☑ | 9 | P018363 | | 산소포화도 | 3병동 | reregister | ○○병원에서 08-05 반납 회수 → 재등록으로 이력 연결 |
| ☐ | 11 | P018370 | | 산소포화도 | 3병동 | reregister | 회수 후보 — 08-05 불량 회수됨(이 병원), 온프렘 삭제 요청 대상 (초안 모드 기본 제외) |
| ☐ | 5 | A126870 | | 심전계 | 101병동 | conflict | 인천백병원 71병동 배치 중(08-14) — [제외 ▾ | 이관] |
| ☑ | 6 | A100001 | | 심전계 | 6병동 | skip | 이 병원에 이미 배치 중(변경 없음) |
| ☐ | 12 | A100002 | | 심전계 | 5병동(폐쇄) | error | 폐쇄된 병동 — 재활성 후 재검증 [미지정으로 등록] |
| ☐ | 14 | P018401 | | 산소포화도 | 3병동 | error | 업무일자(2025-03-01) < 회수일(2026-08-05) — 업무일자 조정 또는 제외 |
| ☐ | 30 | A126861 | | | | error | 파일 내 중복(2행) |
[입력으로 돌아가기]  [오류 행 제외하고 다시 검증]  [실행 (118 등록 · 2 재등록)]   ← 미제외 오류가 1건이라도 있으면 비활성
임포트 이력: | # | 일시 | 작성자 | 출처·모드 | 선택 org | 업무일자 | 행/등록/재등록/건너뜀/이관 | 상태 | [업무일자 정정] [취소](admin) |
```
미리보기에 셀 편집은 없다 — 오타 행은 [제외]로 빼고 실행한 뒤 등록 폼에서 같은 업무일자로 추가(별도 action_group, 배치 카운트 미포함)하거나, 원본을 고쳐 [입력으로 돌아가기] 후 다시 검증. 제외 체크 상태는 실행 body `excludeRows`로 명시 전송. 실행은 단일 트랜잭션(all-or-nothing). 결과 "118대 등록 · 2대 재등록 · 병동 2개 생성 (배치 #13)". **초안 모드는 사람이 검토하는 도구일 뿐 자동 이벤트를 만들지 않는다** — 온프렘 대비 누락 diff·선택 회수는 v1에 없음(§10). 실행 후 병동 오타를 발견하면 '배치 취소 → 매핑 지정 재임포트'(배치 밖 이벤트가 없을 때).
- **병동 탭**: `순서 ↑↓ | 병동명 ✎ | 온프렘 코드 | 배치 중 | 회수(누계) | 활성 | [기기 일괄 이동] [비활성](admin, 배치 0) [삭제](admin, 참조 0)` + 추가. 동명(`name_norm`) 409. 이름 변경은 이력 표시에 즉시 반영(같은 실체의 개명). 빈 상태 안내: "병동이 없습니다 — 임포트 시 자동 생성되거나 여기서 추가".
- **Excel**: 헤더 [Excel]은 활성 탭 기준 — 기기 목록(`GET /api/devices/export?<units 필터>`), 이력(`/events/export`), 전역 커버리지(`/summary/export`). 같은 where 빌더 재사용, 캡 10,000/10,000/1,000행(초과 400 "필터를 좁혀…"). 열: 기기 목록 = 병원코드·병원명·시리얼(키)·원문·모델·용도·병동·상태·배치일·회수일·회수 사유·최근 이벤트(유형·일자)·연결(ref)·창고 개체(인벤토리·상태 — export 1회당 배치 매칭 1쿼리)·메모 / 이력 = 이력 탭 컬럼 + 기록자·기록 시각·배치 # / 커버리지 = 전역 뷰 표 컬럼 그대로. 파일명 `디바이스원장_<병원명>_<필터>_YYYYMMDD.xlsx`.
- **모바일**: `md:hidden` 카드(시리얼 크게+상태, 모델·병동, 최근 이벤트), 카드 체크박스, 바텀시트 드로어, **하단 고정 액션바 [등록][교체][회수]**([회수]는 선택 0건이면 시리얼 입력줄 autoFocus 스캔 모드). 임포트·Excel은 데스크톱 권장 문구.

### 6.2 병원 상세 '도입 현황' 교체(D12)
```
도입 현황                                                     [디바이스 원장 열기 →]
도입 병상 수 200병상 (수정은 [병원 수정] 폼)                    ← 표시 유지, 입력만 제거
| 모델 | 배치 중 | 계약 | 차이 | 최근 이벤트 |
| 심전계 | 198 | 200 | −2 ▲ | 08-28 회수 |   | 산소포화도 | 185 | 참고 200 | — | … |   | 게이트웨이 | 41 | — | — | … |
최근 30일 회수 4건 · 마지막 임포트 08-12     (원장 없음: 헤더 유지 + 계약 열 + "[디바이스 원장에서 임포트]" / 계약완료 딜 없음: 계약 열 '—')
```
서버 컴포넌트 `HospitalDeviceSummary`가 `getHospitalDeviceSummary(code)`를 **직접 호출**(API 경유 아님 — 상세 페이지 권한을 따름). `InventoryUsageCard` 렌더·파일 삭제, 카드 순서 불변.

### 6.3 설정
`/settings/device-recovery-reason`(`StatusCodeManager`, "value 행은 삭제 불가") / `/settings/devices`에 분류·온프렘 코드·시리얼 형식·원장 대상·수량 집계 대상 편집(ADMIN+만 편집, USER는 읽기 표시).

## 7. API
규약: `force-dynamic`, 수동 파싱, `{ error: '한국어' }` 400/401/403/404/409, 목록 `{ data, total, page, limit }`, mutation은 단일 `$transaction` + `logAudit`, 클라이언트 `router.refresh()`, 병원 스코프 404 선검사.

### 7.0 서비스 계층 `lib/deviceRegistry.ts`(유일한 쓰기자)
```ts
type RegistryActor = { userId: string|null; name: string|null }           // 훅은 { null, 'system' }
type RegistryRef   = { type: 'MAINTENANCE'|'VOC'|'INVENTORY_TX'|'ONPREM_SYNC'; code: string }
interface RegistryCtx  { hospitalCode; actor; occurredOn: 'YYYY-MM-DD'(기본 todayKst, 미래 400); ref?; source?('MANUAL'); memo?; actionGroup? }
interface RegistryOpts { client?: Prisma.TransactionClient; autoCreateWard?: boolean /* 기본 true */ }
class RegistryError extends Error { status: 400|404|409; conflicts?: Conflict[] }

previewRows(hospitalCode, rows, defaults{deviceInfoId?, wardMode, wardId?, emptyWardCell, mode, orgs?, wardAliases?}) → PreviewRow[]   // ok|reregister|skip|warn|conflict|error
registerDevices(ctx, items[], opts & { conflicts?: Record<serial,'TRANSFER'>; importBatchId? }) → { actionGroup, created, reregistered, transferred, skipped, events }
moveDeviceWard(ctx, { deviceId, toWardId?|toWardName? }) · recoverDevice(ctx, { deviceId, reasonCodeId, relatedDeviceId? })
replaceDevice(ctx, { oldDeviceId?|oldSerial, oldDeviceInfoId?, oldWardId?|oldWardName?, newSerial, newDeviceInfoId?, toWardId?|toWardName?, reasonCodeId?(기본 DEFECT), newConflict?: 'TRANSFER' })
  → { actionGroup, backfillEvent?, recoverEvent?, transferRecoverEvent?, registerEvent, newDevice, linkedRecoverEventId? }
bulkDeviceAction(ctx, { action: 'MOVE_WARD'|'RECOVER', deviceIds, toWardId?|toWardName?, reasonCodeId? }) → { actionGroup, events, skipped }
importBatch(ctx, { rows, excludeRows: number[], rowActions: Record<number,'TRANSFER'|'UNASSIGN_WARD'>, wardAliases, orgs, sourceKind, mode, fileName?, defaults }) → { batch, result }
correctDevice(ctx, { deviceId, changes }) → CORRECT · editEvent · cancelLastEvent · cancelImportBatch · editImportBatchDate · rebuildUnitProjection · updateDeviceMemo
getHospitalDeviceSummary(code) · getGlobalCoverage(params) · matchInventoryUnits(client, devices[], { persist })
// 후속 훅 진입점(시그니처 고정, 본체 throw '후속'): registerFromInventoryOut(client, txId, actor) · recoverFromInventoryReturn(client, txId, actor) · cancelEventsOfRef(client, ref, actor) · applyOnpremSnapshot(ctx, rows)
```
규칙: `opts.client`가 있으면 그 안에서만(중첩 `$transaction` 금지), 없으면 자체 `$transaction({ timeout: 120_000, maxWait: 10_000 })`(bulk-serial 선례) / 삽입 위치 시점 전이 검증 + 후속 fold 재검증 / 동시성은 `updateMany({ where:{ id, status: prev, hospitalCode: prev, wardId: prev } })` count===1 아니면 409(`inventory.ts:518-535` 선례), serial P2002 → 409 '이미 등록된 시리얼' / 폐쇄 병동 → 409 / 멱등은 WMS·ONPREM+ref만 / 서비스는 `logAudit`을 부르지 않음(라우트가 반환값으로) / Slack 없음.

**교체 계약(§4.1-6·§6.1 교체와 동일)**: (1) `newConflict:'TRANSFER'`는 **신 시리얼**이 타 병원 ACTIVE일 때만 — RECOVER(TRANSFER)@그 병원 + REGISTER@이 병원; 미지정이면 409 `conflicts[]`. (2) **구기기가 타 병원 ACTIVE면 항상 409**(구기기 이관 옵션 없음). (3) 구기기가 RECOVERED이고 `last_hospital_code`=이 병원이면 RECOVER 없이 REGISTER(신, `related_device_id`=구) 1이벤트 + 구 RECOVER 이벤트의 `related_device_id`=신 연결; `occurredOn < 구.recovered_on`이면 400; `last_hospital_code`≠이 병원이면 409. (4) 구=신 400. (5) **신 시리얼이 이미 이 병원 ACTIVE**(go-live 임포트에 예비기가 포함됐거나 등록을 먼저 한 경우)면 REGISTER를 만들지 않고 RECOVER(구, `related_device_id`=신) 1이벤트 + 병동이 다르면 MOVE_WARD(신 → 구 병동) 1이벤트를 같은 `action_group`으로 기록(응답 `registered:null, movedNew?`). (6) 구기기 소급 등록(원장에 없음) 경로의 소급 REGISTER(구)는 `occurred_on`=ctx.occurredOn(같은 일자, 순서는 id)·`memo`='교체 시 소급 등록'·`source`='MANUAL' — **구기기의 실제 배치일은 기록하지 않는다**(D6 점진 백필; 정확한 배치일이 필요하면 임포트로 먼저 등록).
**상품유형 규칙(B-22, 2026-09-01)**: `getHospitalProductTypeContext(code)` → `{ types, default, mixed, deals, byType[{type,deals,devices}] }`(§9.1 SQL을 `sales_deals.product_type`으로 그룹). 순수 규칙 `resolveProductTypeDefault(ctx, explicit)`(`lib/deviceRegistryShared`): 명시값 > (1종 → 기본값 · 0종 → 미지정 + 경고 `병원 계약완료 딜 없음 — 상품유형 미지정` · 혼합 → 오류 `상품유형 필수 — 이 병원은 일반·라이트 딜이 함께 있습니다`). `registerDevices` items[].productType(별칭 일반/standard·라이트/lite, 미매칭 400 `상품유형 값이 올바르지 않습니다 (일반/라이트)`) — skip 항목은 규칙 제외, 혼합 병원에서 하나라도 미지정이면 400(단건·다건 동일 메시지). 임포트는 `previewRows`가 같은 규칙으로 행 판정(혼합 미지정 = error, 딜 0건 = warn)하고 실행은 `productTypeResolved`로 재적용하지 않는다. `replaceDevice`: 신 배치는 **구 배치 값 상속**(입력값은 경고 후 무시), 구 기기 소급 경로만 입력 `productType` + 기본값 규칙, TRANSFER opt-in은 상대 병원 RECOVER에 그 병원 배치 값 스냅샷. `bulkDeviceAction({ action:'SET_PRODUCT_TYPE', deviceIds, productType|null })`: 같은 병원 ACTIVE만, 기기마다 CORRECT(`changes.productType {before,after}`, 스냅샷=after) + 배치 행 갱신, 이미 같은 값은 `skipped[]`(전부면 409) — write(USER+). `correctDevice.changes.productType`도 동일(취소 시 before 복원). 테스트 전용 `productTypeContextOverride`(register/replace/previewRows)로 혼합 문맥을 주입한다(실데이터 딜 수정 금지). **교체 허용량(quota) 규칙은 보류** — 데이터·집계(`countReplacements`)만 둔다.
**등록 중복 규약**: 타 병원 ACTIVE에 `conflicts[serial]`이 없으면 register·import 모두 409 `{ error, conflicts[] }`. 이 병원 ACTIVE는 `skipped[]` — items가 1건이거나 전부 skip이면 409 `이미 이 병원에 배치 중인 시리얼입니다`, 일부면 201+`skipped[]`; 임포트는 `skip` 판정으로 집계.

### 7.1 엔드포인트
| 메서드·경로 | 동작 | 권한 | 비고 |
|---|---|---|---|
| `GET /api/devices/can-manage` | `{canWrite, canAdmin}` | 로그인 | UI 게이트 프로브 |
| `GET /api/devices/summary?page&limit&filter&q&sort` | 커버리지 표 + 전역 요약 | 로그인 | 딜 Σ 조인 |
| `GET /api/devices/units?hospital&model&ward&status&q&wms&usage&page&limit&sort&idsOnly` | 기기 목록 | 로그인 | limit 50(≤500), `idsOnly` ≤2,000. `wms=linked|unlinked|in_stock` 필터는 **영속 `inventory_unit_id`(+`inventory_units` 조인)만 기준**; 페이지 단위 임시 매칭은 `inventory_unit_id IS NULL`인 행의 '창고 개체' 열 표시 보조일 뿐 필터·집계에 쓰지 않음(DB 쓰기 없음) |
| `GET /api/devices/units/[id]` | 개체 + 이벤트 전체 + WMS + 상대 | 로그인 | 드로어 |
| `GET /api/devices/lookup?serial=` | 개체 1건 / 0건이면 원장 접두 일치 ≤10 + WMS 정확·접미 일치 ≤10 | 로그인 | 입력 `normalizeSerial` 적용 |
| `GET /api/devices/maintenance-lookup?hospital=&q=` | 이 병원 유지보수 자동완성 `{ id, maintenanceCode, title, hospitalMismatch, suggestedOccurredOn, basis }` | 로그인 | 정확 코드 입력 시 병원 필터 무시 + `hospitalMismatch:true` |
| `GET /api/devices/events?hospital&device&type&from&to&refType&refCode&page&limit` | 이벤트 목록 | 로그인 | 후속 유지보수 패널이 그대로 사용 |
| `GET /api/devices/export` · `/events/export` · `/summary/export` | xlsx(같은 where 빌더, page/limit 무시) | 로그인 | 10,000/10,000/1,000행 캡 |
| ~~`GET·PUT /api/hospitals/[code]/devices`~~ | **파일 삭제** | — | README 1490-1491 두 행 삭제 |
| `GET /api/hospitals/[code]/devices/summary` | 모델별 배치/계약/차이·WMS·최근 | 로그인 | `/devices` 요약 스트립(상세 카드는 lib 직접 호출) |
| `POST /api/hospitals/[code]/devices/register[?preview=true]` | N개 등록(신규·재등록·opt-in 이관) | write | `{ items[], occurredOn, memo?, ref?, conflicts? }` — §7.0 규약 |
| `POST /api/hospitals/[code]/devices/replace` | 교체 | write | `{ oldDeviceId?|oldSerial, oldDeviceInfoId?, oldWardId?|oldWardName?, newSerial, newDeviceInfoId?, toWardId?|toWardName?, reasonCodeId?, occurredOn, memo?, ref?, newConflict? }` — §7.0 교체 계약 |
| `POST /api/devices/units/[id]/move` · `/recover` | 이동 / 회수 | write | 병원은 개체에서 유도. 같은 병동 400, 사유 없음 400, 이미 회수 409 |
| `POST /api/devices/units/bulk` | 일괄 이동/회수 | write | 같은 병원 ACTIVE만, 단일 tx. 이미 대상 병동인 개체는 `skipped[]`; 타 병원·RECOVERED가 섞이면 전체 409 |
| `PATCH /api/devices/units/[id]` | memo / 용도(`usageTypeId`, null=미지정) → CORRECT / 식별 보정 → CORRECT | write(memo·usageTypeId) / admin(식별 — 모델·시리얼·MAC·닉네임, usageTypeId와 함께 보내도 admin) | 시리얼 충돌 409, 없는 용도 400 '용도 값이 올바르지 않습니다 (판매용/평가용)', WMS 재매칭(영속) |
| `PATCH /api/devices/events/[id]` · `DELETE /api/devices/events/[id]` | 인플레이스 정정 / 마지막 이벤트 취소 | admin | §8.2 |
| `POST /api/hospitals/[code]/devices/import?preview=true` | file 또는 `{text}` + 옵션 → 행별 판정 | write | MAX 2,000, DB 쓰기 없음 |
| `POST /api/hospitals/[code]/devices/import` | 서버 재검증 후 실행 | write | 미제외 오류 400 · 미지정 conflict 409 · 소급 불성립(미리보기 이후 변동) 409 `{ error, rows:[{row, serial, message}] }` · 초안 모드에서 distinct org ≥2인데 `orgs[]` 없음 400 · 120s tx |
| `GET …/devices/imports` · `PATCH …/imports/[id]` · `POST …/imports/[id]/cancel` | 배치 목록 / 업무일자 일괄 정정 / 취소 | 로그인 / admin / admin | §8.2 |
| `GET/POST /api/hospitals/[code]/wards` · `PUT/DELETE …/wards/[id]` | 병동 CRUD(PUT은 hospital_code 불가) | 로그인 / write / write(비활성은 admin) / admin | 참조 있으면 409, 동명 409 |
| `GET/POST /api/settings/device-recovery-reason` · `PUT/DELETE …/[id]` | 사유 마스터 | 로그인 / ADMIN+ | value·사용 중 삭제 불가 |
| `GET/POST /api/settings/device-usage-type` · `PUT/DELETE …/[id]` | 용도 마스터(SALE/EVAL) | 로그인 / ADMIN+ | value 행 409 '시스템 용도는 삭제할 수 없습니다' · 사용 중 409 '사용 중인 용도입니다' · audit `setting:device_usage_type` |
| `/api/settings/devices`(기존) | +5필드, usageCount 합산, DELETE 가드 | 기존 필드 USER+ / 5필드 ADMIN+ | 정규식 검증 400 |

**응답 요지**: register 201 `{ actionGroup, created[{id, serialNo, eventId}], reregistered[], transferred[{id, serialNo, fromHospitalCode}], skipped[{serialNo, reason}], warnings[] }`; 409 `{ error, conflicts:[{serial, hospitalCode, hospitalName, wardName, placedOn}] }`. replace 201 `{ actionGroup, backfilled?, recovered?, transferRecovered?, registered, movedNew?, linkedRecoverEventId?, eventIds[1..4] }`. summary `{ hospitalCode, introBeds, expectedDeviceCount|null, contractedDeals[{dealCode,count}], models[{deviceInfoId, deviceModel, deviceClass, active, recovered30d, expected|null, diff|null, compare:'hard'|'soft'|'none', wms{out,inStock,unmatched}, lastEvent}], wards[], unassigned, lastEventOn, lastImportAt, activeTotal }` — `wms{…}`는 영속 `inventory_unit_id` 조인 1쿼리로 집계(임시 매칭 미사용).

### 7.2 임포트 판정(서버 단일 소스)
`previewRows`는 행마다 **`assertTransition`(업무일자 시점 상태) + 후속 fold 재검증을 실제로 수행**한다(실행과 같은 함수) — 실행 시 409는 미리보기 이후 데이터가 바뀐 경우에만 발생. 등록 폼의 실시간 판별도 같은 엔진.
| 판정 | 조건 | 기본 제외 | 실행 |
|---|---|---|---|
| `ok` | 원장에 없음, 모델 판별됨 | 아니오 | REGISTER |
| `reregister` (a) | RECOVERED이고 **`last_hospital_code` = 이 병원**(이 병원에서 회수됐는데 목록에 있음 = 온프렘 유령) | 신규 모드 아니오 / **초안 모드 예** — '회수 후보 — {일자} {사유} 회수됨, 온프렘 삭제 요청 대상' | REGISTER(재활성) |
| `reregister` (b) | RECOVERED이고 `last_hospital_code` ≠ 이 병원(타 병원에서 회수 후 정당한 재배치) | 아니오 — '{병원}에서 {일자} {사유} 회수 → 재등록으로 이력 연결'(LOST면 warn 동반) | REGISTER(재활성) |
| `skip` | 이 병원 ACTIVE, 또는 해제된 org의 행 | 자동 | 변경 없음(병동이 달라도 안 고침 — MOVE_WARD로만), `skipped_count` |
| `warn` | 형식 불일치·병동 신규·모델/접두 불일치·WMS IN_STOCK·병동 빈 셀(미지정 등록) | 아니오 | 가능 |
| `conflict` | 타 병원 ACTIVE | **예** | 해제 시 행별 `TRANSFER` 필수 → RECOVER(TRANSFER, 그 병원) + REGISTER(이 병원) 같은 group·같은 배치 |
| `error` | 빈 값·파일 내 중복·모델 판별 불가·미래 일자·MAX 초과·(옵션) 빈 병동·폐쇄 병동 매칭·**소급 불성립**(재등록 행: 업무일자 < `recovered_on`; 이관 행: 업무일자 < 상대 병원 `placed_on` 또는 상대 병원에 업무일자 이후 이벤트 존재; 그 밖에 이후 이벤트가 성립하지 않음 — 메시지 "업무일자(2025-03-01)가 이 기기의 회수일(2026-08-05)보다 이릅니다 — 업무일자를 조정하거나 행을 제외하세요") | 중복은 자동 | 미제외면 실행 거부 |

실행 규칙(서버 재검증 결과 기준, 클라이언트 판정 불신): `rowActions[row] ∈ {'TRANSFER'(conflict 전용), 'UNASSIGN_WARD'(폐쇄·미매칭 병동 error 전용 — 병동 NULL로 REGISTER, 판정은 warn으로 재계산)}`, 그 외 값·판정 불일치는 400. `conflict` = 제외면 건너뜀 / `TRANSFER`면 이관 / 둘 다 없으면 409 `conflicts[]`; `error` = 제외면 건너뜀 / `UNASSIGN_WARD`면 warn 실행 / 아니면 400; `skip` = 항상 집계; 나머지 = 제외 아니면 실행. `row` = 시트의 실제 행 번호(헤더 자동 인식 시 2부터, 헤더 없는 파일은 1부터) / 붙여넣기 원문 줄 번호(1부터). 병동 해석: `wardMode=column`(빈 셀은 옵션) / `fixed`(열 무시), 이름 매칭은 `name_norm`, `wardAliases{입력명: wardId}`가 있으면 생성 대신 매핑. `mac_address`·`ext_device_code`는 입력에 있으면 저장(CORRECT 이벤트 없음 — 식별 보조값).

### 7.3 멱등·트랜잭션
개체 단위 낙관적 가드 / 교체·이관·일괄·임포트는 단일 tx(부분 성공 없음) / 같은 병원 재등록 skip·타 병원 미지정 409(register·import 동일) / 자동 출처 부분 UNIQUE / 소급 허용 + fold 재검증, 미래 400 / `ref MAINTENANCE`는 코드 존재 검사(400), 병원 불일치는 경고만 / 병동 자동 생성은 `ON CONFLICT (hospital_code, name_norm)`, 데드락 40P01 → 409 `동시 임포트 충돌 — 다시 실행하세요` / 업무일자 UTC 자정 파스.

## 8. 권한·감사
### 8.1 `lib/deviceRegistryAccess.ts` — `checkDeviceRegistryAccess(user, {write?, admin?})`
read = 로그인 전체(조직 게이트 없음 — nav `{SEERS}`는 UX) / write = `isUserOrAbove` / admin = `isAdminOrAbove || (isUserOrAbove && hasPermission('device.admin'))`. `lib/permissions.ts` v1.4: `'device.admin': { label:'디바이스 원장 관리', module:'디바이스 원장', description:'기기 이벤트 정정·취소, 임포트 배치 취소·업무일자 정정, 개체 식별정보 보정, 병동 비활성·삭제 (조회는 전원, 등록·회수·이동·교체·임포트는 USER 등급 전원)' }`. 마스터: 회수 사유 `isAdminOrAbove`; 모델 마스터 5필드 `isAdminOrAbove`, 기존 필드 USER+ 유지(가산 원칙). 병원 상세 요약행은 서버 컴포넌트가 lib를 직접 호출하므로 상세 페이지 권한을 따른다.

### 8.2 정정 정책 — "사실은 이벤트로, 실수는 취소로"
| 대상 | 허용 | 방식 |
|---|---|---|
| 이벤트 `occurred_on`·`memo`·`reason_code_id`·`ref`·`to_ward_id`(REGISTER/MOVE)·`from_ward_id`(RECOVER) | admin | 인플레이스 UPDATE + `edited_*` + audit, **fold 재검증(불성립 409)** → 프로젝션 재계산 |
| `event_type`·`device_id`·`hospital_code`·`related_device_id`·`import_batch_id`·`action_group` | ❌ | 취소 후 재입력(`related_device_id`는 §7.0 (3)의 시스템 짝 연결만 예외) |
| 마지막 이벤트 취소 `DELETE /events/[id]` | admin | fold 순서상 마지막만(LIFO, CORRECT는 판정 제외). 임포트 이벤트의 단건 취소는 **그 REGISTER가 개체 fold상 마지막 이벤트일 때** 허용 — 신규 행이면 개체 삭제, reregister 행이면 fold 재계산으로 RECOVERED 복원(배치 취소와 같은 함수), transfer 행은 짝 RECOVER(TRANSFER)와 함께 취소(원 병원 ACTIVE 복원); 셋 다 배치 카운트 감소 + `summary.cancelledRows[]`. 교체·이관 그룹은 **짝 동시 취소**(신기기에 다른 이벤트 있으면 409; 소급 REGISTER가 있으면 3건 함께). 물리 DELETE → 재계산 → 이벤트 0 개체 삭제, 1 tx, audit `before` 전문 |
| CORRECT 취소 | admin | `changes.before`로 식별 컬럼 복원(유니크 충돌 409) + 이벤트 DELETE + WMS 재매칭 |
| 임포트 배치 취소 | admin | 배치 밖 **상태 이벤트(REGISTER/MOVE_WARD/RECOVER)** 가 있는 기기가 있으면 409 "배치 밖 이벤트가 있는 기기 n대 — A126861(08-20 병동 이동) … 해당 이벤트를 드로어에서 먼저 취소하면 배치를 취소할 수 있습니다"(≤10개 표시); 배치 개체의 CORRECT 이벤트·memo·inventory_unit_id는 차단 사유가 아니며 개체와 함께 삭제(`cancel_summary.correctedSerials[]`에 기록); 이미 취소된 배치 409. 이벤트→개체 DELETE(이관 쌍의 RECOVER도 같은 배치 → 원 병원 ACTIVE 복원), 재등록 개체는 RECOVERED 복원, 자동 생성 병동은 남김(참조 0이면 병동 탭에서 삭제), `cancel_summary{serials[], restoredDeviceIds[], restoredTransfers[], newWardsKept[]}` |
| 임포트 배치 업무일자 정정 `PATCH …/imports/[id]` | admin | 배치 이벤트 전체 `occurred_on` 일괄 UPDATE + 각 개체 fold 재검증 — 기본값(오늘)으로 잘못 넣은 백필 구제 |
| 식별 속성(모델·시리얼·MAC·닉네임 오타) | admin | `PATCH` → CORRECT + UPDATE(유니크 409). 시리얼 정정 시 `normalizeSerial` 재통과로 `serial_raw` 재계산, `inventory_unit_id` 초기화 후 재매칭. **시리얼 정정은 개체의 상태 이벤트가 현재 병원 REGISTER 1건뿐일 때만 허용** — 타 병원·회수 이력이 있으면 409 '이력이 있는 개체 — 오입력이면 이벤트 취소를 사용하세요'(실존 개체의 이력 오염 방지) |
| 개체 `memo` | write | UPDATE + audit |
| 사실의 번복 | write | 새 이벤트 |
| 작성자 본인 직전 이벤트 취소 | v1 ❌ | B-13(후속 후보) |

### 8.3 `logAudit`
`hospital_device`(id=serial, `{병원} {모델} {시리얼}`) — CREATE 감사는 단건 register·PATCH·취소 삭제에만; items ≥2·임포트·일괄은 `hospital_device_event`(action_group, API 호출당 1건, `after.eventIds[]`·시리얼 ≤50) 또는 `hospital_device_import`(batch id) 1행만(1,000건 임포트에 audit 1,000행을 만들지 않음 — bulk-serial 선례) / `hospital_ward` / `setting:device_recovery_reason`·`setting:device_info`. audit_logs는 타임라인이 아님 — 이벤트 테이블이 담당. 읽기 GET은 감사 대상 아님.

## 9. 기존 데이터·모듈 연동
### 9.1 딜 기대 수량
`SELECT count(*), SUM(COALESCE(daewoong_device_count,0)) FROM sales_deals sd JOIN status_codes sc ON sc.id=sd.status_id WHERE sd.hospital_code=$1 AND sc.category='SALES_DEAL_STATUS' AND sc.name='계약완료'`(08-03 스크립트 조건). `daewoong_count_type` 4종 전부 합산(쟁점 A-5). **`deals=0`이면 `expected=null`, `compare='none'`**(신규 go-live 직후·보류·데모 병원이 '+240 초과'로 표시되지 않게). ECG hard / SpO2 soft(ECG 동수 참고) / GW·제3자 `none`. `intro_beds`는 표시만. 딜 저장 시 파생 없음(매번 조인). **평가용 제외(2026-09-01, B-21)**: `models[].active`는 배치 중 전체, `activeEval`은 그중 `usage_type=EVAL`, `activeForCompare = active − activeEval`, **`diff = activeForCompare − expected`**(hard). 병원 `evalTotal`, 커버리지 행 `activeEcg`(EVAL 제외)·`activeEcgEval`·`evalTotal`·`diff = activeEcg − expected`, 전역 합계 `active.eval`. 미지정(NULL)은 판매용과 같이 대조에 포함.
**상품유형별 기대 수량(2026-09-01, B-22)**: 같은 조인을 `GROUP BY sd.product_type`으로 — `SELECT sd.product_type, count(*), SUM(COALESCE(sd.daewoong_device_count,0)) FROM sales_deals sd JOIN status_codes sc ON sc.id=sd.status_id WHERE sd.hospital_code=$1 AND sc.category='SALES_DEAL_STATUS' AND sc.name='계약완료' GROUP BY 1`(`getHospitalProductTypeContext.byType`). 요약 `models[].byProductType[type|'미지정'] = { active, activeForCompare, expected(그 유형 딜 Σ — ECG hard·SpO2 soft·그 외 null), diff(hard만) }`(키 = 계약 딜 유형 ∪ 배치 유형, '미지정'은 배치가 있을 때만; 모델 합계는 기존 필드 그대로), 병원 `productTypes[]`(ECG 기준 축)·`productTypeMixed`(딜 2종 또는 배치에 상품유형 존재 → UI 매트릭스)·`productTypeContext`·`replacements{ total, byType, last30d }`(`countReplacements(code,{from,to})` = 같은 병원 RECOVER 가운데 REGISTER와 교체 짝(`related_device_id` 또는 같은 action_group)이 있는 것, RECOVER 스냅샷 상품유형 기준 — 이관 쌍 제외). 커버리지 행 `productTypeMixed`(딜 2종)·`unassignedProductType`(혼합 병원의 NULL ACTIVE 수), 전역 `mixedProductTypeHospitals`.

### 9.2 WMS 매칭(읽기) + 후속 훅
**원칙**: 집계·필터는 영속 `inventory_unit_id`만 기준, 페이지 단위 임시 매칭은 표시 보조일 뿐. `inventory_units.status`는 후보 선별·⚠ 배지에만 읽고 원장 상태에 영향을 주지 않는다(D9).
**배치 매칭(행 단위 금지)**: 미리보기·임포트·목록 페이지당 1쿼리 — `SELECT u.id, u.serial_no, u.status, u.inventory_id, i.device_info_id, i.model_name FROM inventory_units u JOIN inventory_items i ON i.id=u.item_id WHERE i.is_serial_managed AND (i.device_info_id = ANY($modelIds) OR i.model_name = ANY($modelNames)) AND (u.serial_no = ANY($keys ∪ $raws) OR right(u.serial_no, 7) = ANY($keys))` → 메모리에서 행별 판정(GW 합성은 접미 7자 비교 — `serial_no` 단독 인덱스가 없어 선행 와일드카드 LIKE 금지) → `device_info_id` 일치 우선, `model_name` 폴백 → 1건 또는 OUT 1건이면 연결. **GW 품목 3개(ITEM-0004/0014/0021)는 `device_info_id NULL`이지만 `model_name='MGW1010'`이라 WMS 마스터를 쓰지 않고 매칭**(실측). `inventory_unit_id` 영속 기록은 **쓰기 경로에서만**(register/import/replace/CORRECT); GET은 표시용 매칭만 계산하고 DB에 쓰지 않는다(VIEWER의 GET이 감사 없이 UPDATE하는 일 없음). 표시 `{인벤토리}·{상태}`, ACTIVE+IN_STOCK ⚠·DISPOSED ⚠, LOST 제외.
**후속 훅 지점**: OUT → `registerFromInventoryOut`(`lib/inventory.ts` `applyInventoryTransaction` 말미, `applySerialUnits` OUT 스탬프 L518-526 이후; 조건 `OUT && hospitalCode && linkHospital && isSerialManaged && serialTracked`, 병동 NULL, ref INVENTORY_TX, source WMS, 충돌은 skip) / RETURN(L435-452) → `recoverFromInventoryReturn`(사유 `value='RETURN'` 고정) / `reverseTransaction`(L608-660) → `cancelEventsOfRef`(이후 이벤트 있으면 409). 선결 3+1(`link_hospital`·bulk 라우트 hospitalCode·전표 PUT 전파·병동 텍스트)은 WMS 설계 변경으로 별도.

### 9.3 유지보수/VOC 훅 계약(D8 — 자리·계약만)
v1에 있는 것: 폼의 유지보수 코드 선택(`ref MAINTENANCE`) + 업무일자 자동 제안 + `GET /api/devices/events?refType=MAINTENANCE&refCode=`. 후속(P6) 붙일 자리: `app/maintenances/[id]/page.tsx:186-195`(HospitalCard 옆) '기기 조치' 패널 — 연결 이벤트 칩 + [교체][회수][이동][등록] → `/devices`의 Modal 재사용, 제출은 도메인 라우트:
```ts
// POST /api/maintenances/[id]/device-actions (후속) — action은 폼 액션명(REPLACE → replaceDevice 호출), 이벤트 타입 아님(§4.1-6)
body { action: 'REPLACE'|'RECOVER'|'MOVE_WARD'|'REGISTER', occurredOn?, …각 폼 필드 }
ctx  = { hospitalCode: m.hospitalCode, actor, source:'MANUAL', occurredOn: body.occurredOn ?? suggestOccurredOnFromMaintenance(m)?.date ?? today, ref:{ type:'MAINTENANCE', code: m.maintenanceCode } }
prisma.$transaction(tx => { replaceDevice(ctx, …, { client: tx }); tx.maintenanceLog.create({ content: '<p>기기 교체: P018363 → P020418 (3병동)</p>' }) })   // 처리 기록은 Tiptap HTML → <p> 문장 append
logAudit(resource:'maintenance', …); 알림은 기존 notifyTicketChanged 경로만
```
유지보수 병원 변경·삭제에 이벤트 불변. VOC: `childCreate.formPath`에 `?hospital=&deviceId=` 예약 또는 `POST /api/voc/[id]/device-actions`(hospitalCode NULL이면 400). `tickets`·`maintenances`·`voc_receipts`에 기기 컬럼 금지. 'AS 교체요청' 도메인화 시에도 원장은 ref 상수 1개 추가로 무변경.

### 9.4 온프렘 동기화 예약
예약 완료: `mac_address`·`ext_device_code`·`ext_last_seen_at`·`ext_synced_at`·`hospital_wards.ext_ward_code`·`onprem_device_type`·`source ONPREM`·`ref_type ONPREM_SYNC`·`applyOnpremSnapshot`. v1 초안 모드는 붙여넣기 열 매핑(JSON `deviceRegisterList` 또는 TSV 별칭 헤더 — 부록 B-3)·org 제외·회수 후보 제외까지(diff 없음). v2 = 전량 스냅샷(붙여넣기 또는 API) → 시리얼 3분류(양쪽/원장만/온프렘만) **제안 목록**, ext_* 갱신(이벤트 없음), '온프렘 미확인 n일' 배지, **자동 RECOVER 없음**. 병원↔org 1:N은 `hospital_servers` 자식 테이블로 후속(PROD `hospital_servers` 0행 — 그때까지 org 선택은 사람이 책임).

### 9.5 AI — v2
P1: `get_hospital_overview` devices 문자열 → `'심전계(MC200M-T) 배치 198대 / 계약 200'`. v2: `find_hospital_device`·`get_hospital_device_summary`·`list_device_events`(도구 등록 4개소 + README), "창고 개체 vs 병원 등록 기기" 구분 문구.

### 9.6 병원 삭제·일괄 이전
- DELETE(`app/api/hospitals/[code]/route.ts`): 선검사 devices(`hospital_code` OR `last_hospital_code`)·events·이벤트 남은 배치·**병동** 카운트 → 409 "연결된 디바이스 원장(등록 n대·이력 m건·병동 k개)이 있어 삭제할 수 없습니다"; 이벤트 0인 배치 행은 트랜잭션에서 deleteMany; `hospitalDevice.deleteMany`(L145) 제거.
- `transferAllWorkItems`(`lib/workItemReassign.ts:235`, `$transaction` 호출 L259에 옵션 인자 없음 = 기본 timeout 5s → `{ timeout: 60_000, maxWait: 10_000 }` 명시; ①②는 단일 tx, '재지정 → 원본 삭제' 순서): ① 병동 — 원본 병동의 `name_norm`이 대상 병원에 이미 있으면 devices.`(wardId, hospitalCode)`·events.`(fromWardId, hospitalCode)`·events.`(toWardId, hospitalCode)`를 각각 한 문장으로 재지정 후 원본 병동 delete; 없으면 병동 행의 `hospital_code`만 이동(**ON UPDATE CASCADE로 소속 기기·이벤트가 함께 옮겨지는 것은 의도**); `ext_ward_code` 충돌이 남으면 원본 값을 NULL로 비우고 이동 ② 병동 미지정·RECOVERED 행과 이벤트·배치의 `hospital_code`·`last_hospital_code` updateMany ③ `TransferAllResult.moved`에 `devices·deviceEvents·wards`, `TransferAllWorkButton.tsx` 안내 문구에 '디바이스 원장' + "딜은 이동하지 않으므로 대상 병원 계약 대조에 차이가 표시될 수 있음" 1줄. 단건 재지정·유지보수 PUT은 원장 무영향.

### 9.7 체크리스트
nav `('devices','디바이스 원장','/devices','device','operations',55,'{SEERS}')`(**`icon_key='device'`는 `NavIcons.tsx` `ICON_MAP`에 키 1개 + SVG 추가** — `wifi`는 GW 배치 플래너가 사용 중) + `('settings/device-recovery-reason','기기 회수 사유 관리',…,'settings',41,'병원·구축','{SUPER_ADMIN,ADMIN}')`(38 devices·39 emr-vendor·40 site-visit-status 다음) + `('settings/device-usage-type','기기 용도 관리','/settings/device-usage-type','settings',42,'병원·구축','{SUPER_ADMIN,ADMIN}')` — 마이그 `ON CONFLICT (menu_key)` + `scripts/seed-device-registry.sql`(DDL 없음·idempotent, PROD→DEV 동기화 후 재실행) / `permissions.ts` `device.admin` / status_codes 7행 + 용도 2행 `DEVICE_USAGE_TYPE`(판매용 SALE·평가용 EVAL, `ON CONFLICT (name, category)`) / device_info 4행 + 소비처(수량 폼 3곳 필터·품목 폼 전 행) / 팬아웃 §5d 전부 / README(디렉토리·스키마·주요 기능·API 표·AI 도구 수·권한 카탈로그 v1.3 누락분 보충 + v1.4)·ERD·DEV_HISTORY·`projects/README.md`(본 문서 행 + 2.0 행 'A1 → 원장 설계' 표기) / **착수 전 "PROD 데이터 동기화"로 DEV 갱신**(현재 DEV 08-10 스냅샷은 hospital_devices 15행/8병원/1,547대 — PROD의 8월 센서스 132행/67병원·8월 WMS 출고·8월 유지보수가 없음) / **P0에 실제 온프렘 export 샘플 1건 확보**(B-3 헤더 별칭 확정).

## 10. 비범위
| 제외 | 이유 |
|---|---|
| 유지보수 '기기 조치' 패널·`device-actions`·VOC 핸드오프 | D8 후속 P6 — 계약·`events?ref`·폼의 코드 선택+일자 제안까지만 |
| WMS 쓰기 훅·`link_hospital` 확대·bulk hospitalCode·반품 입고 초안·`inventory_items` UPDATE·`inventory_units` 인덱스 | D9, 선결 3+1. `model_name` 매칭으로 마스터 쓰기 불필요 |
| WMS 8월 이후 84건 백필 제안·admin 'WMS 재매칭' 일괄 | v2, 자동 기록 금지 |
| 온프렘 스냅샷 diff(원장 ACTIVE인데 목록에 없는 기기·선택 회수) | '동기화는 예약만'(쟁점 A-7). v1 초안 모드는 D6 그대로 |
| 온프렘 API 자동 동기화·org 매핑 테이블·인증 | 예약만 |
| AI 도구 3종 | v2 |
| 회수 후 수리·폐기·재출고 상태 | D11 WMS 영역 |
| 비시리얼 소모품·MT100D/MBP100U 시드 | D2, 코드만 |
| `intro_beds` 재계산·센서스 이관 | D1 |
| 병실·병상 계층·사용량·온프렘 닉네임 부여 기능 | 참고 구조 이식 금지 |
| 유지보수 텍스트 소급 파싱 | 명시 시리얼 12건·오타 — 사람이 임포트 |
| 티켓 도메인화·Slack | 원장은 워크플로 아님 |
| 소프트 void·별도 이력 테이블 | §8.2로 충분 |
| 병동 병합·이벤트 일괄 병동 정정·형식 강제·본인 취소 | v2 후보(오타 병동은 '배치 취소 → 매핑 재임포트') |

후속 후보(짧게): 서버 현황 카드 병동 텍스트 → 마스터 선택 / 'WMS 제안' 임포트 소스 / 개체별 장애 횟수(2.0 A1 잔여) / 온프렘 스냅샷 diff / '이 병원에서 나간 기기' 이력 필터.

## 11. 구현 단계
| 단계 | 산출물 | 검증 |
|---|---|---|
| P0 준비 | "PROD 데이터 동기화" → §9.1 기준값 표 → 실제 온프렘 export 샘플 1건 → feature 브랜치 `feat/device-registry` 생성(A-6) → RTLS 태그 실제 모델명 확인(A-3, 미확인이면 `RTLS-TAG` 가칭 시드 후 CORRECT 없이 `device_model` UPDATE) | 132/67/13,119 확인, 딜 Σ>0 병원 수, export 헤더 기록 |
| P1 스키마 | 마이그 `20260901120000_hospital_device_registry`(부록 A.1 — psql `--single-transaction -v ON_ERROR_STOP=1` + `migrate resolve --applied`) / `seed-device-registry.sql` / schema(§5b) / `generate` / `permissions.ts` / `deviceRegistryShared.ts` / **컴파일 팬아웃 수정**(레거시 route 삭제·page.tsx 임시 요약·DELETE 409·tools.ts·필터 3곳·settings/devices) | `tsc --noEmit` 0 + `grep -rn "hospitalDevice\." app lib` 잔존 0(신규 제외), CHECK 부정 테스트, seed 2회 idempotent, 수량 화면 GW 미노출·품목 폼 노출, 부분 인덱스·`name_norm` 유니크 확인 |
| P2 API | `deviceRegistry.ts`(§7.0, 훅 4종 스텁) / `deviceRegistryAccess.ts` / 라우트 전부 / 사유 설정 API / settings/devices 5필드 | 스모크 `scripts/smoke-device-registry.mts`(`npx tsx`): 등록→이동→회수→타 병원 재등록 연속, 불법 전이 409, 소급 삽입 성공+후속 불성립 409, 미래 400, 교체 그룹 5케이스(기본 2·소급 3·소급+신 이관 4(최대)·기회수 1·신 시리얼 이 병원 ACTIVE 1~2) + 구기기 타 병원 409, 이관 opt-in, 임포트 preview/execute/skip/conflict 409/폐쇄 병동/wardAliases/orgs 누락/cancel 409+cancel_summary, sole-event 취소·reregister 행 409, 소급 그룹 3건 동시 취소, 취소 후 프로젝션=fold, 동시 회수 409, 동시 병동 생성(표기 상이 동명 → 1행), 복합 FK 커밋 위반 409 매핑, WMS 멱등 키, GET 후 `inventory_unit_id` 무변경, expected=§9.1(딜 0건 null), GW `model_name` 매칭, 권한 매트릭스 |
| P3 UI | `app/devices/*`(HospitalPicker·GlobalCoverage·SummaryStrip·DeviceTable·BulkActionBar·DeviceHistoryDrawer·Register/MoveWard/Recover/Replace/CorrectionModal·ImportPanel·WardPanel·EventsTab·SerialLookup·MobileActionBar) / 설정 페이지 2종 / `NavIcons` `device` 아이콘 | 빈 상태 3종, URL·딥링크, 375px 카드+액션바, 시나리오 클릭 수(교체 ≤6입력, 252→101 ≤5입력, 5자리 오타 경고 후 등록, 행별 이관, org ≥2 배너, 병동 별칭 매핑, 유지보수 선택 시 일자 자동), VIEWER 임포트 EmptyState, PROD 규모(units 21k)에서 2,000행 미리보기 <5s, Excel 열 |
| P4 정리 | `HospitalDeviceSummary` / `InventoryUsageCard` 제거 / transferAll·버튼 / `get_hospital_overview` 최종 | 상세 렌더(있음/없음/딜 없음), DELETE 409(병동만 있는 병원 포함), 일괄 이전(병동 충돌·ext_ward_code 충돌·3컬럼, 단일 tx), 카드 순서 불변 |
| P5 배포 | 머지(마이그 폴더 포함) / dev2 `thync_ops_dev`는 P1에서 이미 적용(재적용 없음) / EC2 dev `git pull` → `migrate deploy` → `generate` → 힙 4GB 빌드 → `pm2 restart thync-dev` → seed / 문서(DEV_HISTORY·README·projects/README·2.0 A1 링크·UDI 정오표·ERD) / **PROD = 부록 A.0**(사용자 허락 후) | 리허설: PROD 최신 정기 덤프를 scratch DB에 복원 → `migrate deploy` → seed → 스모크 → `pg_dump --schema-only`를 DEV와 diff 0줄 → DROP(브랜치 DB에서는 이미 applied라 파괴 경로를 검증할 수 없음); 스트립 계약 Σ = PROD 딜; 첫 병원 임포트 실측; 롤백 런북을 scratch DB에서 실제 실행 후 구 `PUT /api/hospitals/[code]/devices` upsert 1회 성공 확인 |
| (P6 후속) | 유지보수 패널·`device-actions`, VOC, WMS 훅·재매칭, AI, 온프렘 diff | 별도 개정 |

빌드·push·PROD 반영은 명시 요청 시에만.

## 12. 쟁점

### A. 검토 요청 — **전부 추천안으로 확정(2026-09-01)**
| # | 쟁점 | 확정(추천) | 기각된 대안 | 근거 |
|---|---|---|---|---|
| A-1 | 수량표 백업 방식 | **마이그 안에서 `hospital_devices_qty_backup_202609` 테이블 생성 후 DROP**(+PROD 전체 덤프). 원장이 채워진 뒤 후속 마이그로 백업 테이블 삭제 | 덤프+CSV만 남기고 즉시 DROP / RENAME 보존(PK·시퀀스·인덱스 개명 6문장 필요) | D1 준수. 같은 DB 안에 남아 롤백이 RENAME+제약 복원(A.0 ②)으로 끝나고 어느 DB에서 실행해도 안전 |
| A-2 | nav 라벨·위치 | **'디바이스 원장'** operations sort 55(유지보수 50·기타업무 60 사이), `{SEERS}`, 새 아이콘 키 `device` | '기기 관리'로 하고 기존 `/settings/devices`를 '기기 모델 관리'로 개명 / '병원 기기 현황' / sort 75(자재관리 인접) | 기존 '기기 관리'(설정 38)와 충돌 회피. 개명은 PROD nav UPDATE 1건이면 가능 |
| A-3 | 제3자 모델 코드 | `SL-MPF1K07`(링BP, 온프렘 10)·`H2-ABPM`(참BP, 11)·**`RTLS-TAG`(가칭, 8)** 시드 — 실제 모델명은 P0에서 확인해 확정 | MT100D·MBP100U 포함 | RTLS 태그 모델명 미확인(P0 후속 확인) |
| A-4 | 임포트·등록 시 타 병원 ACTIVE 시리얼 | **`conflict` 기본 제외 + 행별 '이관' opt-in**(RECOVER TRANSFER + REGISTER) | 항상 error(그 병원에서 먼저 회수 기록 강제) | 회수 누락된 채 재출고된 실물이 실제로 있음(WMS 18개체 2회 이상 OUT). 강제하면 백필이 막힘 |
| A-5 | 기대 수량에 넣을 딜 | **계약완료 딜의 `daewoong_count_type` 4종(병원/추가/로컬/이슈) 전부 합산** | '이슈' 제외 | 08-03 스크립트와 연속성. '이슈' 3딜 328대의 성격 확인 필요 |
| A-6 | 구현 중 DB 격리(§5d-4) | **feature 브랜치 + dev2 DB는 `thync_ops_dev`에 바로 적용**(P1~P4 중 main 체크아웃 시 병원 상세만 로컬 500 — 짧은 핫픽스는 감수) | `thync_ops_dev`를 복제한 브랜치 전용 DB + git worktree / 브랜치 없이 main에서 진행하되 P5까지 커밋 보류 | 파괴적 마이그가 P5 전에 main에 올라가면 안 됨 |
| A-7 | 온프렘 초안 모드 범위 | **열 매핑·org 제외·'이 병원 회수 후보' 기본 제외까지**(diff 없음) | 미리보기 시점 '온프렘 목록에 없는 배치 중 기기' diff 표 + 선택 회수 처리 포함 | D6 그대로. diff는 부록 C v2 알고리즘을 앞당기는 것이라 별도 승인 사안 |
| A-8 | 모델 마스터 5필드 권한 | **필드별 `isAdminOrAbove`, 기존 필드 USER+ 유지** | 라우트 전체 ADMIN+ 상향 + nav 38 allowed_roles 축소 | 원장 대상·수량 폼 범위를 바꾸는 시스템 플래그. 전체 상향은 USER의 기존 권한을 빼앗음(가산 원칙) |

### B. 설계 결정(참고 — 이견 시 조정)
| # | 결정 | 근거 |
|---|---|---|
| B-1 | 시리얼 **전역 UNIQUE**(모델 스코프 아님) | 회수 후 모델 오지정 재등록의 이력 분열을 DB가 차단. 온프렘도 전역 UNIQUE, 접두 충돌 없음 |
| B-2 | RECOVERED는 `hospital_code NULL` + `last_hospital_code` | 현재 배치의 단일 의미 + CHECK |
| B-3 | 정정 = 인플레이스(허용 필드) + 취소 4종(마지막 이벤트·그룹 짝·CORRECT·임포트 배치 — 물리 삭제+audit) + CORRECT | D10의 승인된 예외. 소프트 void는 유령 개체·유니크 충돌 규칙을 늘림. WMS 취소 사상과 동일 |
| B-4 | CHECK는 무결성 어휘만, `ref_type`·`source` 등은 상수 | 편입 어휘는 마이그 없이 확장 |
| B-5 | 병동↔병원 정합은 복합 FK DEFERRABLE + 이벤트 CHECK, 서비스는 unchecked 입력 | Prisma 5.22 `validate`·`generate` 확인 완료 |
| B-6 | 소급 = 자유 입력 + (occurred_on, id) fold + 후속 재검증 409 | D7·D6과 정합 |
| B-7 | 병원 삭제 RESTRICT + 409, transferAll 편입(병동 FK도 RESTRICT) | 이력·마스터 보호 |
| B-8 | 회수 사유 `value`: DEFECT·LOST·RETURN·DISPOSE·TRANSFER | 폼 기본·이관·WMS 대조·후속 반품 입고 훅이 코드에서 필요 |
| B-9 | 시리얼 형식은 경고만 + 정규화 저장 | 온프렘 무검증, 5자리 실례 |
| B-10 | WMS 매칭은 배치 1쿼리, `device_info_id` 우선 → `model_name` 폴백, 영속 기록은 쓰기 경로만 | 행 단위 LIKE는 21k seq scan; 읽기 경로 부작용 금지 |
| B-11 | 라벨 스냅샷은 `actor_name`만 | 병동·사유 FK가 RESTRICT라 조인 항상 성립 |
| B-12 | 병원 콤보 = 고객∪원장 보유 사전 로드 + 전체 검색 토글 | 215건, SearchSelect 표시 50 캡 |
| B-13 | 본인 직전 이벤트 취소는 v1 admin만 | 폼 실시간 판별로 완화, 후속 후보 |
| B-14 | 일괄 액션은 이동·회수(+병동 일괄 이동)만, 일괄 교체 없음 | 교체는 1:1 짝 |
| B-15 | 멱등 키는 WMS·ONPREM + ref만 | 수동 정당 입력 무시 방지 |
| B-16 | 병동 유니크 기준 `name_norm` | 동시 임포트의 표기 차이 중복을 DB가 차단 |
| B-17 | 기회수 상태 구기기의 교체는 RECOVER 재생성 없이 신 REGISTER + 시스템 연결 | '먼저 회수 → 교체기 뒤늦게 도착'이 실무 흔함 |
| B-18 | GW·제3자 기대치 축 없음(`compare:'none'`) | D1은 ECG hard·SpO2 soft만 정의. 구축 계획 수량(projects.gateway_count)은 계약이 아님 |
| B-19 | 자재 품목 폼 모델 셀렉터는 필터하지 않음 | GW 품목을 MGW1010에 연결할 수 있게(연결은 WMS 사용자 행위) |
| B-20 | **3층 구조** `device_info` → `device_units` → `hospital_devices` / `inventory_units` — 2026-09-01 사용자 결정: 시리얼 정체성은 `device_units`, 병원 상태는 `hospital_devices`(device_id UNIQUE 프로젝션), WMS 편입(`inventory_units.device_id`)은 후속. **API 공개 device id = `device_units.id`**. ACTIVE-only 변형(회수 요약을 유닛으로)은 미결정 | 한 시리얼이 병원 배치와 창고 개체 양쪽에 같은 정체성으로 걸리도록 — 단일 테이블 초안은 WMS 편입 시 `inventory_unit_id` 양방향 링크가 필요했음. dev2에서 롤백 런북(A.0 ②) 리허설 후 마이그 폴더 그대로 재적용 |
| B-22 | **상품유형(product type) = 배치 속성 2값** `hospital_devices.product_type` TEXT CHECK('일반','라이트', NULL=미지정 — `sales_deals.product_type`과 같은 어휘) + 이벤트 스냅샷 `hospital_device_events.product_type` — 2026-09-01 사용자 결정. 자리의 판매 조건이지 물건의 속성이 아니다(한 병원에 일반 50 + 라이트 50 공존 — 별개 딜). REGISTER가 정하고(fold), 교체는 상속, 회수는 배치 행에 마지막 값만 남기며 재등록 시 새 REGISTER가 다시 정한다. 기본값 = 병원 계약완료 딜의 상품유형 분포(1종 기본 · 0종 미지정+경고 · 혼합 명시 필수 400/판정 error). 변경은 CORRECT(`changes.productType`) — 단건 PATCH·일괄 `SET_PRODUCT_TYPE` 모두 write(USER+). 요약은 유형별 매트릭스(`byProductType`, 유형별 기대 수량 §9.1)·교체 집계(`replacements`, RECOVER 스냅샷 기준). **교체 허용량 규칙은 보류 — 데이터·집계만 구축** | 라이트 계약은 자리(좌석) 조건이라 기기를 바꿔 끼워도 자리의 유형은 유지되고, 다른 병원으로 옮기면 그 병원의 조건이 적용된다. 마스터(StatusCode) 대신 딜과 같은 TEXT 어휘를 써서 딜↔배치 대조가 조인 없이 성립 |
| B-21 | **용도(usage type) = 유닛 속성 2값** `device_units.usage_type_id` → StatusCode `DEVICE_USAGE_TYPE`(value `SALE` 판매용 / `EVAL` 평가용, NULL=미지정) — 2026-09-01 사용자 결정. WMS 인벤토리 '대웅제약재고'는 **판매용 창고**이지 제3의 용도 값이 아니다. 계약 대조(§9.1)에서 EVAL 제외(`activeForCompare`). 변경은 CORRECT(`changes.usageTypeId`)이며 PATCH 권한은 write(USER+) — 나머지 식별 보정(admin)과 분리. 등록·임포트·교체는 폼 공통 기본값 + 행/항목 우선, 기존 유닛에 다른 용도를 명시하면 유지 + 경고(모델 규약과 동일), 비어 있으면 채움. 교체 신 기기는 구 기기 용도 승계 | 용도는 위치(병원/병동/창고)가 아니라 물건의 속성 — 평가용 기기가 병원에 배치돼 있어도 계약 수량과 비교하면 안 되고, 회수돼 창고로 가도 평가용으로 남는다. 같은 마스터 패턴(회수 사유)을 재사용해 설정 페이지·seed·감사 자원명만 추가 |

---

## 부록 A. 마이그레이션 SQL 초안

### A.0 PROD 배포 순서(파괴적 마이그 — 마이그 → 재시작 창을 초 단위로)
```bash
cd /home/ubuntu/thynC-Ops-System/thynC-Ops-PROD
# 0) 전체 덤프(표준) — 참고값(09-01): hospital_devices 132행/67병원/13,119대
pg_dump -h localhost -U thync -d thync_ops -Fc -f ~/backups/db/thync_ops_pre_device_registry_$(date +%Y%m%d_%H%M).dump
# 1) 코드 준비 — DB를 만지지 않음(generate는 schema.prisma만 읽음)
git pull origin main && npx prisma generate
NODE_OPTIONS="--max-old-space-size=4096" npm run build
# 2) 마이그 + 즉시 재시작 — 두 명령 사이가 병원 상세·AI 병원 요약 500 창(구 프로세스가 quantity SELECT). 연달아 실행
npx prisma migrate deploy && pm2 restart thync-prod
# 3) 시드·스모크
psql -h localhost -U thync -d thync_ops -f scripts/seed-device-registry.sql      # DDL 없음, 재실행 안전
curl -sI https://ops.seersthync.com/devices | head -1                              # 307
```
**롤백**(down 스크립트가 없는 수동 패턴): ① 코드 `git revert` → pull → generate → build ② DB 단일 트랜잭션: `DROP TABLE hospital_device_events, hospital_device_import_batches, hospital_devices, hospital_wards; DROP TABLE IF EXISTS device_units; ALTER TABLE device_info DROP COLUMN device_class, DROP COLUMN onprem_device_type, DROP COLUMN serial_pattern, DROP COLUMN serial_tracked, DROP COLUMN quantity_tracked; DELETE FROM device_info WHERE device_model IN ('MGW1010','SL-MPF1K07','H2-ABPM','RTLS-TAG')`(딜·프로젝트·품목 참조가 생겼으면 DELETE 대신 `is_active=false`)`; DELETE FROM status_codes WHERE category='DEVICE_RECOVERY_REASON'; DELETE FROM nav_menu_items WHERE menu_key IN ('devices','settings/device-recovery-reason'); ALTER TABLE hospital_devices_qty_backup_202609 RENAME TO hospital_devices; ALTER TABLE hospital_devices ALTER COLUMN id SET NOT NULL, ALTER COLUMN hospital_code SET NOT NULL, ALTER COLUMN device_info_id SET NOT NULL, ALTER COLUMN quantity SET NOT NULL, ALTER COLUMN quantity SET DEFAULT 0, ALTER COLUMN updated_at SET NOT NULL, ADD CONSTRAINT hospital_devices_pkey PRIMARY KEY (id), ADD CONSTRAINT hospital_devices_hospital_code_fkey FOREIGN KEY (hospital_code) REFERENCES hospitals(hospital_code) ON UPDATE CASCADE ON DELETE RESTRICT, ADD CONSTRAINT hospital_devices_device_info_id_fkey FOREIGN KEY (device_info_id) REFERENCES device_info(id) ON UPDATE CASCADE ON DELETE RESTRICT; CREATE UNIQUE INDEX hospital_devices_hospital_code_device_info_id_key ON hospital_devices(hospital_code, device_info_id); CREATE SEQUENCE hospital_devices_id_seq OWNED BY hospital_devices.id; ALTER TABLE hospital_devices ALTER COLUMN id SET DEFAULT nextval('hospital_devices_id_seq'); SELECT setval('hospital_devices_id_seq', COALESCE((SELECT max(id) FROM hospital_devices),0)+1, false);` `DELETE FROM _prisma_migrations WHERE migration_name='20260901120000_hospital_device_registry'` ③ `pm2 restart`. migrate deploy가 중간 실패한 상태면 먼저 `npx prisma migrate resolve --rolled-back <이름>`.
**롤백 리허설 결과(dev2 `thync_ops_dev`, 2026-09-01 — 3층 구조 전환 시 실행)**: 위 ② 전체를 `psql --single-transaction -v ON_ERROR_STOP=1` 1회로 실행 → 성공. 사전 검사: 시드 4모델(MGW1010·SL-MPF1K07·H2-ABPM·RTLS-TAG)을 참조하는 `project_devices`·`sales_deal_devices`·`inventory_items` 0건(참조가 있으면 `inventory_items.device_info_id`는 같은 트랜잭션에서 NULL 처리 — FK가 SET NULL이라 DELETE도 통과하지만 명시). 결과: 구 `hospital_devices` 132행 복원(컬럼 5개 전부 NOT NULL, quantity DEFAULT 0, PK·FK 2·UNIQUE(hospital_code, device_info_id)·시퀀스 156 복원), device_info 6→2행, `_prisma_migrations` 1행 삭제, 회수 사유 7행·nav 2행 삭제. 테스트로 넣었던 배치 22행·이벤트 25행·병동 4행·배치 1건은 함께 소실(의도). 이후 수정된 A.1을 같은 방식으로 재적용 → `migrate resolve --applied` → `migrate status` up to date → `seed-device-registry.sql` 재실행 UPDATE 0/INSERT 0(no-op 확인). 재적용 후 카운트: 백업 132 / device_units 0 / hospital_devices 0 / wards 0 / events 0 / batches 0 / device_info 6 / 회수 사유 7 / nav 2. **주의**: 롤백 DELETE 뒤 재시드하면 4모델의 `device_info.id`가 바뀐다(시퀀스 미복원 — 7~10 → 11~14). 코드가 모델 id를 하드코딩하지 않으므로 무해하나, PROD 롤백 후 재배포 시 딜·품목이 그 사이 새 id를 참조했을 가능성만 확인. 부정 테스트(롤백 트랜잭션): 시리얼 미정규화(공백·소문자·빈 문자열) → `device_units_serial_no_normalized_check`, 중복 시리얼 → `device_units_serial_no_key`, 없는 device_id 배치 → `hospital_devices_device_id_fkey`, 유닛당 배치 2행 → `hospital_devices_device_id_key`, RECOVERED+hospital_code → `hospital_devices_active_hospital_check`, RECOVER 사유 없음 → `hospital_device_events_reason_check`, hospital_code NULL+to_ward_id → `hospital_device_events_ward_requires_hospital_check`(CORRECT는 `changes` 없으면 `changes_check`가 먼저 걸림), 없는 device_id 이벤트 → `hospital_device_events_device_id_fkey` — 8건 전부 기대대로 거부.
**DEV**: dev2 `psql -d thync_ops_dev --single-transaction -v ON_ERROR_STOP=1 -f prisma/migrations/…/migration.sql` → `migrate resolve --applied` → schema → generate → seed. EC2 dev: `git pull` → `migrate deploy` → `generate` → 힙 4GB 빌드 → `pm2 restart thync-dev` → seed. **P1 적용 후 P5 전까지 PROD→DEV 데이터 동기화 금지**(dev2 절차는 TRUNCATE 후 data-only 복원이라 구 `hospital_devices` TABLE DATA가 새 형상에 COPY되며 실패 → 전체 롤백; 불가피하면 TOC 필터에 그 라인 제거 후 seed 재실행).

### A.1 `prisma/migrations/20260901120000_hospital_device_registry/migration.sql`
파일 전문(2026-09-01 3층 구조 최종형 — 파일과 1:1 동일).
```sql
-- 병원별 웨어러블 디바이스 원장 (projects/hospital_device_registry_design.md 부록 A.1)
-- 3층 구조(B-20, 2026-09-01): device_info(모델 마스터) → device_units(시리얼 정체성, 전역 UNIQUE) → 상태 하위표
--   hospital_devices(병원 배치 프로젝션, device_id UNIQUE 1:1) / inventory_units.device_id(WMS 편입 — 후속 마이그, 본 파일 범위 밖)
-- 파괴적 마이그: 기존 hospital_devices(병원×모델 수량)를 같은 DB에 백업 후 DROP → 배치 프로젝션 테이블이 이름 승계(D1)
-- 적용: psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f <this file> → npx prisma migrate resolve --applied 20260901120000_hospital_device_registry
-- 롤백 런북: 설계안 부록 A.0 ② (dev2에서 2026-09-01 리허설 완료)

-- 1) D1: 수량표 백업(같은 DB) 후 DROP — 백업 테이블은 원장이 채워진 뒤 후속 마이그에서 삭제
CREATE TABLE hospital_devices_qty_backup_202609 AS SELECT * FROM hospital_devices;
DROP TABLE hospital_devices;

-- 2) D2: device_info 확장 (DDL — seed 스크립트에는 넣지 않음)
ALTER TABLE device_info
  ADD COLUMN device_class TEXT NOT NULL DEFAULT 'WEARABLE', ADD COLUMN onprem_device_type INTEGER, ADD COLUMN serial_pattern TEXT,
  ADD COLUMN serial_tracked BOOLEAN NOT NULL DEFAULT false, ADD COLUMN quantity_tracked BOOLEAN NOT NULL DEFAULT true;
-- 2') 시드(scripts/seed-device-registry.sql에도 동일 — onprem_device_type IS NULL 가드로 사용자 편집 보존)
UPDATE device_info SET onprem_device_type=1, serial_pattern='^A[0-9]{6}$', serial_tracked=true WHERE device_model='MC200M-T' AND onprem_device_type IS NULL;
UPDATE device_info SET onprem_device_type=3, serial_pattern='^P[0-9]{6}$', serial_tracked=true WHERE device_model='MP100W'   AND onprem_device_type IS NULL;
INSERT INTO device_info (device_model, device_name, device_class, onprem_device_type, serial_pattern, serial_tracked, quantity_tracked, is_active, sort_order, updated_at) VALUES
  ('MGW1010','게이트웨이','GATEWAY',NULL,'^B[0-9]{6}$',true,false,true,3,NOW()),
  ('SL-MPF1K07','링 혈압계(CART BP)','THIRD_PARTY',10,'^[FGK][-A-Za-z0-9]{6}-[-A-Za-z0-9]{5}$',true,false,true,10,NOW()),
  ('H2-ABPM','참 혈압계(Charm BP)','THIRD_PARTY',11,'^H2-BPM-[A-Z0-9]{4}$',true,false,true,11,NOW()),
  ('RTLS-TAG','RTLS 태그','THIRD_PARTY',8,NULL,true,false,true,12,NOW())
ON CONFLICT (device_model) DO NOTHING;

-- 3) D4: 병동
CREATE TABLE hospital_wards (
  id SERIAL PRIMARY KEY,
  hospital_code TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  name TEXT NOT NULL, name_norm TEXT NOT NULL, ext_ward_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hospital_wards_hospital_code_name_norm_key UNIQUE (hospital_code, name_norm),
  CONSTRAINT hospital_wards_id_hospital_code_key UNIQUE (id, hospital_code));
CREATE UNIQUE INDEX hospital_wards_hospital_code_ext_ward_code_key ON hospital_wards(hospital_code, ext_ward_code) WHERE ext_ward_code IS NOT NULL;

-- 4) 시리얼 정체성(유닛) — 시리얼당 1행, 전역 UNIQUE. source 어휘 MANUAL/IMPORT/WMS/ONPREM/BACKFILL는 코드 상수(CHECK 없음)
CREATE TABLE device_units (
  id SERIAL PRIMARY KEY,
  device_info_id INTEGER NOT NULL REFERENCES device_info(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  serial_no TEXT NOT NULL, serial_raw TEXT, mac_address TEXT, memo TEXT,
  source TEXT NOT NULL DEFAULT 'MANUAL',
  usage_type_id INTEGER REFERENCES status_codes(id) ON DELETE RESTRICT,   -- 용도(판매용/평가용, DEVICE_USAGE_TYPE) — 유닛 속성, NULL=미지정
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT device_units_serial_no_key UNIQUE (serial_no),
  CONSTRAINT device_units_serial_no_normalized_check CHECK (serial_no <> '' AND serial_no = upper(btrim(serial_no))));
CREATE INDEX device_units_device_info_id_idx   ON device_units(device_info_id);
CREATE INDEX device_units_serial_no_pattern_idx ON device_units(serial_no text_pattern_ops);
CREATE INDEX device_units_serial_raw_idx        ON device_units(serial_raw) WHERE serial_raw IS NOT NULL;
CREATE INDEX device_units_usage_type_id_idx     ON device_units(usage_type_id);

-- 4') D1/D3: 병원 배치 프로젝션(이름 승계) — 유닛당 0..1행, 상태 컬럼은 이벤트 fold의 파생값
CREATE TABLE hospital_devices (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES device_units(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ext_device_code TEXT, ext_last_seen_at TIMESTAMP(3), ext_synced_at TIMESTAMP(3),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  ward_id INTEGER, placed_on DATE,
  last_hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE SET NULL ON UPDATE CASCADE,
  recovered_on DATE, recover_reason_id INTEGER REFERENCES status_codes(id) ON DELETE RESTRICT,
  last_event_type TEXT, last_event_on DATE,
  replaced_by_id INTEGER REFERENCES device_units(id) ON DELETE SET NULL,
  product_type TEXT,                                                       -- 상품유형(일반/라이트, B-22) — 자리의 판매 조건: 배치 속성. REGISTER 이벤트에서 fold, 교체 상속, 회수 시 마지막 값 보존(재등록 시 재지정)
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hospital_devices_device_id_key UNIQUE (device_id),
  CONSTRAINT hospital_devices_status_check CHECK (status IN ('ACTIVE','RECOVERED')),
  CONSTRAINT hospital_devices_product_type_check CHECK (product_type IS NULL OR product_type IN ('일반','라이트')),
  CONSTRAINT hospital_devices_active_hospital_check CHECK ((status='ACTIVE') = (hospital_code IS NOT NULL)),
  CONSTRAINT hospital_devices_ward_only_active_check CHECK (ward_id IS NULL OR status='ACTIVE'),
  CONSTRAINT hospital_devices_ward_fkey FOREIGN KEY (ward_id, hospital_code) REFERENCES hospital_wards(id, hospital_code)
    ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX hospital_devices_hospital_code_status_idx      ON hospital_devices(hospital_code, status);
CREATE INDEX hospital_devices_ward_id_idx                   ON hospital_devices(ward_id);
CREATE INDEX hospital_devices_last_hospital_code_status_idx ON hospital_devices(last_hospital_code, status);
CREATE INDEX hospital_devices_hospital_product_type_status_idx ON hospital_devices(hospital_code, product_type, status);

-- 5) D6: 임포트 배치
CREATE TABLE hospital_device_import_batches (
  id SERIAL PRIMARY KEY,
  hospital_code TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  source_kind TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'REGISTER', file_name TEXT, occurred_on DATE NOT NULL, note TEXT,
  row_count INTEGER NOT NULL DEFAULT 0, registered_count INTEGER NOT NULL DEFAULT 0, reregistered_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0, transferred_count INTEGER NOT NULL DEFAULT 0, summary JSONB,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP(3), cancelled_by TEXT REFERENCES users(id) ON DELETE SET NULL, cancel_summary JSONB,
  CONSTRAINT hospital_device_import_batches_source_kind_check CHECK (source_kind IN ('EXCEL','PASTE')));
CREATE INDEX hospital_device_import_batches_hospital_created_idx ON hospital_device_import_batches(hospital_code, created_at DESC);

-- 6) 이벤트(append-first) — device_id·related_device_id는 유닛(device_units) 참조
CREATE TABLE hospital_device_events (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES device_units(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  event_type TEXT NOT NULL,
  hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  from_ward_id INTEGER, to_ward_id INTEGER,
  reason_code_id INTEGER REFERENCES status_codes(id) ON DELETE RESTRICT,
  occurred_on DATE NOT NULL, memo TEXT, ref_type TEXT, ref_code TEXT,
  related_device_id INTEGER REFERENCES device_units(id) ON DELETE SET NULL,
  action_group UUID, source TEXT NOT NULL DEFAULT 'MANUAL',
  import_batch_id INTEGER REFERENCES hospital_device_import_batches(id) ON DELETE RESTRICT,
  changes JSONB, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, actor_name TEXT,
  edited_at TIMESTAMP(3), edited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  product_type TEXT,                                                       -- 이벤트 시점 상품유형 스냅샷(REGISTER=지정값, MOVE_WARD/RECOVER=당시 배치 값, CORRECT=변경 후 값)
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hospital_device_events_type_check CHECK (event_type IN ('REGISTER','MOVE_WARD','RECOVER','CORRECT')),
  CONSTRAINT hospital_device_events_product_type_check CHECK (product_type IS NULL OR product_type IN ('일반','라이트')),
  CONSTRAINT hospital_device_events_hospital_check CHECK (event_type='CORRECT' OR hospital_code IS NOT NULL),
  CONSTRAINT hospital_device_events_ward_requires_hospital_check CHECK (hospital_code IS NOT NULL OR (from_ward_id IS NULL AND to_ward_id IS NULL)),
  CONSTRAINT hospital_device_events_reason_check CHECK (event_type<>'RECOVER' OR reason_code_id IS NOT NULL),
  CONSTRAINT hospital_device_events_changes_check CHECK (event_type<>'CORRECT' OR changes IS NOT NULL),
  CONSTRAINT hospital_device_events_ref_check CHECK ((ref_type IS NULL) = (ref_code IS NULL)),
  CONSTRAINT hospital_device_events_from_ward_fkey FOREIGN KEY (from_ward_id, hospital_code) REFERENCES hospital_wards(id, hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT hospital_device_events_to_ward_fkey   FOREIGN KEY (to_ward_id,   hospital_code) REFERENCES hospital_wards(id, hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX hospital_device_events_device_idx       ON hospital_device_events(device_id, occurred_on, id);
CREATE INDEX hospital_device_events_hospital_idx     ON hospital_device_events(hospital_code, occurred_on DESC, id DESC);
CREATE INDEX hospital_device_events_ref_idx          ON hospital_device_events(ref_type, ref_code) WHERE ref_type IS NOT NULL;
CREATE INDEX hospital_device_events_import_batch_idx ON hospital_device_events(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX hospital_device_events_action_group_idx ON hospital_device_events(action_group) WHERE action_group IS NOT NULL;
CREATE INDEX hospital_device_events_type_date_idx    ON hospital_device_events(event_type, occurred_on DESC);
CREATE UNIQUE INDEX hospital_device_events_auto_ref_idem_key ON hospital_device_events(ref_type, ref_code, device_id, event_type)
  WHERE ref_type IS NOT NULL AND source IN ('WMS','ONPREM');          -- 불변식 8 (MANUAL 제외)

-- 7) D5: 회수 사유 마스터 + 용도 마스터(DEVICE_USAGE_TYPE — 2026-09-01 결정: 판매용/평가용 2값, value가 시스템 의미)
INSERT INTO status_codes (name, category, "order", value) VALUES
  ('불량(AS 회수)','DEVICE_RECOVERY_REASON',1,'DEFECT'), ('분실','DEVICE_RECOVERY_REASON',2,'LOST'),
  ('반납(계약 종료·축소)','DEVICE_RECOVERY_REASON',3,'RETURN'), ('데모 종료','DEVICE_RECOVERY_REASON',4,NULL),
  ('현장 폐기','DEVICE_RECOVERY_REASON',5,'DISPOSE'), ('타 병원 이관','DEVICE_RECOVERY_REASON',6,'TRANSFER'),
  ('기타','DEVICE_RECOVERY_REASON',9,NULL)
ON CONFLICT (name, category) DO NOTHING;
INSERT INTO status_codes (name, category, "order", value) VALUES
  ('판매용','DEVICE_USAGE_TYPE',1,'SALE'), ('평가용','DEVICE_USAGE_TYPE',2,'EVAL')
ON CONFLICT (name, category) DO NOTHING;

-- 8) nav (icon 'device'는 P3에서 ICON_MAP에 추가)
INSERT INTO nav_menu_items (menu_key, label, href, icon_key, parent_key, sort_order, allowed_org_codes) VALUES
  ('devices','디바이스 원장','/devices','device','operations',55,'{SEERS}') ON CONFLICT (menu_key) DO NOTHING;
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/device-recovery-reason','기기 회수 사유 관리','/settings/device-recovery-reason','settings',41,'병원·구축','{SUPER_ADMIN,ADMIN}') ON CONFLICT (menu_key) DO NOTHING;
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, sort_order, group_label, allowed_roles) VALUES
  ('settings/device-usage-type','기기 용도 관리','/settings/device-usage-type','settings',42,'병원·구축','{SUPER_ADMIN,ADMIN}') ON CONFLICT (menu_key) DO NOTHING;
```
### A.2 `scripts/seed-device-registry.sql`
A.1의 **2') UPDATE·INSERT + 7)(회수 사유 + 용도 DEVICE_USAGE_TYPE) + 8)(nav 55·41·42)** 만(DDL 없음) + 확인 SELECT. 상단 주석 "마이그레이션 적용 후 재실행 안전 — DDL 없음"(`seed-cs-masters.sql` 선례 형식). WMS 테이블 문장 없음.

## 부록 B. 임포트 템플릿·붙여넣기
- **B-1 Excel**(첫 시트, 1행 헤더 skip, MAX 2,000): `A 시리얼(필수) | B 모델(MC200M-T/심전계, 비우면 자동) | C 병동(이름 또는 ext_ward_code) | D 메모(→ REGISTER 이벤트 `memo`; 개체 `memo`는 드로어에서만 입력)`. 관리자 콘솔 xlsx(A열만·헤더 없음)는 A1이 시리얼 형식이면 자동 인식.
- **B-2 붙여넣기**: 줄당 1건 — `A126861` / `A126862<TAB>6병동` / `A126863, A126864 A126865`(탭 없으면 토큰 전부 시리얼) / `gw4c11-b008381<TAB>6병동<TAB>신관 GW`. 탭 또는 2칸 공백이면 열 모드, `#` 주석·빈 줄 무시.
- **정규화 `normalizeSerial`**: trim → 공백 제거 → 대문자 → GW 합성 `^GW[0-9A-Z]{4}-(B\d{6})$` → 키 그룹1·raw 원문 / 바코드 `^[A-Z0-9]+-([APCE]\d{6})$` → 키 그룹1 / 그 외 원문. 접두 추정 `A`→ECG, `P`→SpO2, `B`/`GW`→GATEWAY, `C`·`E`→미시드 모델 error("MT100D 모델이 등록되어 있지 않습니다"), `H2-BPM-`→참BP, `^[FGK]`→링BP. 패턴 불일치는 warn.
- **B-3 온프렘 export 초안 — 입력 2종**(P0에서 실제 샘플로 별칭표 확정): ① `deviceRegisterList` JSON 배열 붙여넣기 — `SelectAllDeviceRegisterPage` 응답 키(`organizationCode, deviceCode, serialNumber, macAddress, wardCode, deviceType, dateTime`) 그대로 매핑 ② TSV/CSV — 헤더 별칭 `serialNumber|serial_number|시리얼|시리얼번호` / `wardCode|ward_code|병동코드` / `deviceType|device_type|기기유형` / `organizationCode|기관코드` / `macAddress|MAC` / `deviceCode|장치코드|닉네임`. 감지: 시리얼 별칭 + (wardCode 또는 deviceType 별칭)이 있으면 초안 모드 제안. 매핑: `organizationCode` distinct ≥2 → 경고 배너 + org 체크박스(해제 org 행 skip) / `deviceType` → `onprem_device_type`(2·6 error) / `wardCode` → `ext_ward_code` 일치 없으면 **이름=코드로 병동 생성 + warn "병동명 확인 필요"**(생성 예정 목록에서 기존 병동으로 매핑 가능 — **매핑 선택 시 대상 병동의 `ext_ward_code`가 비어 있으면 그 wardCode를 기록**(다음 export부터 자동 일치), 이미 다른 코드가 있으면 warn 후 기록하지 않음; 첫 임포트(병동 0개)는 코드명으로 생성되고 병동 탭 ✎ 개명은 `ext_ward_code`를 유지 — 결과 메시지 '병동 n개가 코드명으로 생성됨 — 병동 탭에서 이름을 정리하세요') / `deviceCode`·`macAddress` 저장 / `dateTime` 무시. 게이트웨이 export는 별도 붙여넣기(모델 고정).

## 부록 C. 온프렘 대조 참고 — `SelectAllDeviceRegisterPage(ForManager)` 매핑
| 온프렘 필드 | 원장 | 비고 |
|---|---|---|
| `serialNumber` | `serial_no`(정규화) | 서버 무검증 → 정규화 필수 |
| `deviceType` | `device_info.onprem_device_type` → 모델 | 1/3/8/10/11; 2·6은 코드만 |
| `wardCode` | `hospital_wards.ext_ward_code` → ward_id(미매칭 시 생성+warn) | `<org>_<4자>`, 대소문자 혼재 |
| `macAddress` / `deviceCode` | `mac_address` / `ext_device_code` | 붙여넣기 유입만 |
| `organizationCode` | v1: 초안 모드 org 체크박스 / v2: org 매핑 테이블 | 1서버 N org |
| `dateTime` / `deviceReturnStatus` | **대응 없음** | 마지막 쓰기 시각 / 사문 |
| `deviceUseStatus`·`totalUse*` | (v2) `ext_last_seen_at` 단서 | 자동 이벤트 금지 |
| `sickBed/RoomCode`·`premium`·`etc` | 비범위 | |
| 게이트웨이 `SelectGatewayInfoPage` `serialNumber`(B######)·`macAddress`·`wardCode` | `serial_no`·`mac_address`·`ext_ward_code` | FW·접속 상태 비범위 |
v2 알고리즘(쟁점 A-7 승인 후): 병원(org 집합)별 전량 조회 → `serial_no` 3분류(양쪽/원장만/온프렘만) → **제안 목록**, 사람이 확정 시에만 REGISTER/RECOVER(`source='ONPREM'`, `ref_type='ONPREM_SYNC'`).
