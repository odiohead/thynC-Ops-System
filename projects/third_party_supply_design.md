# 제3자 기기 비계약 공급 현황 (대웅 직판) — 설계안

> **상태: 구현 완료 — dev2 (2026-11-02, 제안대로 승인 후 착수). PROD 반영은 사용자 지시 시.** 마이그 `20261102170000_device_info_supply_tracked` · `20261102170100_hospital_device_supplies`. 쟁점 1~5 전부 제안안 채택(편집 USER+, 합산, 0/삭제 구분, 공급처 고정, 커버리지 툴팁만).
> 요청 요지: 카트온(링 혈압계)처럼 **우리가 계약하지 않고 대웅제약이 병원에 직접 파는 기기**의 병원별 수량을 어딘가에 기록·조회해야 한다. 딜(계약 기반)은 부적합. 기기 품목 제어는 `/settings/devices`에서, 병원 상세에서 현재 기기 현황을 볼 수 있어야 함.
> 사용자 결정(2026-11-02 Q&A): ① 마스터에 **새 체크박스 '공급 현황 관리'** ② 병원×기기 **현재 수량 1행**(덮어쓰기, 이력은 감사 로그) ③ 병원 상세 **'도입 현황' 카드에 행으로 통합** ④ 1차는 **수기 입력만**(엑셀 적재는 2차, 초기 자료는 1회성 스크립트)

---

## 1. 배경 · 현재 구조

| 이미 있는 것 | 위치 | 비고 |
|---|---|---|
| 제3자 기기 마스터 3종 | `device_info` (`device_class=THIRD_PARTY`): 링 혈압계(CART BP) `SL-MPF1K07`=카트온 · 참 혈압계 `H2-ABPM` · RTLS 태그 `RTLS-TAG` | `quantity_tracked=false` → 딜·프로젝트 수량 폼에 **숨김**(계약 축 없음, 원장 설계 B-18) |
| 시리얼 개체 원장 | `device_units` + `hospital_devices` | 카트온 개체는 유지보수 요청으로 이미 등록·교체 중(MNT-202608-0020/0021). 기기현황 커버리지 표 '혈압계' 열 = 링BP ACTIVE 배치 수 |
| 병원 상세 '도입 현황' 카드 | `HospitalDeviceSummary` ← `getHospitalDeviceSummary` (`lib/deviceRegistry/read.ts`) | 모델 \| 배치 중 \| 계약 \| 차이 \| 최근 이벤트. **링BP 기대 = Σ딜 BP 행**(코드는 있으나 폼에 숨겨져 사실상 항상 없음 → `compare:'none'`, '—') |

**빠진 것 = 기대치(분모)**: 심전계·산소포화도는 계약완료 딜 수량이 "병원에 몇 대 있어야 한다"를 말해 주는데, 카트온은 계약이 없어 배치 수만 있고 비교 대상이 없다. 이 설계는 그 자리에 **대웅 직판 공급 수량**을 넣는다.

**왜 병원 테이블 필드가 아닌가**: 제3자 기기가 이미 3종이고 앞으로 늘어남(우리가 직접 파는 3rd Party 포함) → 기기별 행이 필요. 모델·파악일·출처가 남아야 하고, 기존 원장 요약과 같은 표에서 비교돼야 함.
**왜 딜이 아닌가**: 딜은 계약·매출 집계(실판매액·도입 병상 KPI)의 원천. 비계약 공급을 섞으면 KPI 오염 + 방금 필수화한 상품유형·기기 수량 규칙과 충돌.

---

## 2. 범위

**포함 (1차)**
1. 기기 마스터 플래그 `supply_tracked`(비계약 공급 현황 관리) — `/settings/devices` ADMIN+ 체크박스
2. 테이블 `hospital_device_supplies` — 병원 × 기기 현재 공급 수량 1행(공급처·파악일·비고)
3. 병원 상세 '도입 현황' 카드: `supply_tracked` 기기 행 상시 노출 + '계약' 열 자리에 **'공급(대웅) m'** + 차이 계산 + 행 옆 연필 → 작은 모달로 수량 입력/수정/삭제
4. API 3종(목록·upsert·삭제) + 감사 로그 `hospital_device_supply`
5. 기기현황(`/devices`) 커버리지 표 '혈압계' 열 툴팁에 공급 수량 병기(expected 소스 확장 — 표 구조 변경 없음)

**제외 (후속, 사용자가 꺼낼 때만)**
- 엑셀 일괄 적재 화면(2차) — 초기 대웅 자료는 1회성 스크립트(`scripts/tmp-*` dry-run → --apply → 삭제, 메모리 규칙)
- 파악 이력 테이블(현재 수량 1행 결정 — 변경 추적은 감사 로그)
- 대웅 담당자(대웅 소속 계정)의 직접 입력 — 1차는 씨어스 USER+ 만
- AS 한도 분모 연동(분실 10%·라이트 100%는 계약 딜 기준 유지 — 제3자 기기는 AS 기기군 밖)
- 우리가 직접 파는 3rd Party 기기: 이 설계 밖. 그 기기는 `quantity_tracked=true`로 켜서 **딜 수량**으로 관리(기존 축) — 두 플래그는 서로 배타가 아니지만 보통 하나만 켠다

---

## 3. 데이터 모델

### 3.1 `device_info.supply_tracked` (추가)
```sql
ALTER TABLE public.device_info ADD COLUMN supply_tracked BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.device_info.supply_tracked IS '비계약 공급 현황 관리 대상(대웅 직판 등) — 병원 상세 공급 수량 입력·도입 현황 기대치 축';
UPDATE public.device_info SET supply_tracked = true WHERE device_model = 'SL-MPF1K07'; -- 카트온(링BP) 시드
```
- Prisma `DeviceInfo.supplyTracked Boolean @default(false) @map("supply_tracked")`
- ADMIN+ 전용 필드 목록(`app/api/settings/devices/shared.ts` `ADMIN_ONLY_FIELD_KEYS`)에 추가 — 기존 5필드와 같은 취급
- 어휘 의미 정리 (마스터 3플래그):

| 플래그 | 뜻 | 노출 |
|---|---|---|
| `serial_tracked` | 시리얼 원장 대상 | `/devices` 임포트·배치 |
| `quantity_tracked` | **계약** 수량 축 | 딜·프로젝트 수량 폼 |
| `supply_tracked` (신설) | **비계약 공급** 수량 축 | 병원 상세 공급 수량 입력 + 도입 현황 기대치 |

### 3.2 `hospital_device_supplies` (신설)
```sql
CREATE TABLE public.hospital_device_supplies (
  id             SERIAL PRIMARY KEY,
  hospital_code  TEXT    NOT NULL REFERENCES public.hospitals(hospital_code) ON DELETE CASCADE,
  device_info_id INTEGER NOT NULL REFERENCES public.device_info(id),
  quantity       INTEGER NOT NULL CHECK (quantity >= 0),
  supplier       VARCHAR(40) NOT NULL DEFAULT '대웅제약',        -- 공급처 (1차 고정값, 셀렉트 아님)
  checked_on     DATE,                                           -- 파악일 (대웅 자료 기준일)
  note           TEXT,
  updated_by_id  TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (hospital_code, device_info_id)
);
CREATE INDEX hospital_device_supplies_device_idx ON public.hospital_device_supplies(device_info_id);
```
- 병원×기기 1행 **upsert**. 수량 0 저장 허용(= "팔았다가 회수" 명시) vs 행 삭제(= 파악 안 됨) 구분
- `device_info_id`는 `supply_tracked=true` 인 기기만 허용(API 검증). 플래그를 나중에 끄면 기존 행은 보존·표시만 유지(숨기지 않음 — 데이터 유실 방지, 원장 `quantity_tracked` 선례와 동일)
- Prisma `HospitalDeviceSupply` + 역관계 `Hospital.deviceSupplies`, `DeviceInfo.hospitalSupplies`, `User.deviceSuppliesUpdated @relation("DeviceSupplyUpdater")`

---

## 4. 설정 화면 — `/settings/devices`

- 기기 행/폼에 체크박스 **'공급 현황 관리'** 추가(기존 '원장 대상'·'수량 집계 대상' 옆, ADMIN+ 전용 힌트 문구 갱신)
- 목록 배지: `공급` (기존 `원장`·`수량` 배지 패턴과 동일)
- 사용 건수(`usageCount`)에 `hospitalSupplies` 행 수 가산 → 사용 중 기기 삭제 409 보호 유지
- 시드/마이그에서 링BP만 true. 참BP·RTLS는 사용자가 필요 시 체크

---

## 5. 병원 상세 '도입 현황' 카드 통합

### 5.1 행 구성 (`getHospitalDeviceSummary` 확장)
- 현재: `serial_tracked` 모델 중 배치/딜이 있는 행. **추가**: `supply_tracked` 기기는 배치·공급 수량이 0이어도 **항상 행 노출**(입력 진입점이 여기뿐이므로 빈 상태도 보여야 함 — 기능 설계 원칙 '빈 상태 필드 노출')
- 기대치 계산(모델별):
  - `expectedDeal` = Σ계약완료 딜 행(기존) · `expectedSupply` = 공급 수량 행(없으면 null)
  - `expected` = 둘 중 있는 것의 합(둘 다 null → `compare:'none'`), `expectedSource: 'DEAL' | 'SUPPLY' | 'BOTH'`
  - 링BP처럼 딜이 없으면 `expected = 공급 수량`, `compare:'hard'` → 차이 = 배치(평가용 제외) − 공급
- `ModelSummary`에 `supply: { quantity, supplier, checkedOn, note, updatedBy, updatedAt } | null`, `expectedSource` 추가(additive — 기존 소비처 영향 없음)

### 5.2 표시
```
모델                     | 배치 중 | 계약/공급        | 차이 | 최근 이벤트
심전계 MC200M-T          | 120     | 120              | 0    | 10-28 교체
산소포화도 MP100W        | 118     | 120              | -2   | 10-30 회수
링 혈압계(CART BP) ✎     | 12      | 공급(대웅) 15    | -3   | 08-20 교체
                           └ 파악 2026-10-15 · 비고 "2차 추가분 포함"        (소행, 값 있을 때만)
```
- 열 헤더 '계약' → **'계약/공급'**. 공급 셀은 `공급(대웅) m` + 툴팁(파악일·비고·수정자). 공급 수량 없으면 `— (공급 수량 미입력)` + 연필
- 연필(✎)은 `canWrite`(ADMIN 또는 USER+ — 병원 상세 다른 카드와 동일 기준, 서버 컴포넌트가 판정해 prop) 일 때만. 클릭 → **작은 모달**: 수량(필수, 0 이상 정수)·파악일(기본 오늘)·비고 / [저장] [행 삭제](행 있을 때)
- 저장 후 `router.refresh()` → 서버 컴포넌트 재계산(카드가 서버 컴포넌트라 클라 상태 없음 — 모달만 클라 컴포넌트 `HospitalDeviceSupplyModal`)
- 상품유형(일반/라이트) 소행은 공급 행에 **적용하지 않음**(대웅 직판은 상품유형 개념 밖)

### 5.3 `/devices` 커버리지 표
- '혈압계' 열 툴팁에 `배치 n / 공급(대웅) m` 병기(`expectedByType`과 별도 `supplyExpected`). 열 추가 없음(표 구조 유지)

---

## 6. API

| 메서드 | 경로 | 권한 | 동작 |
|---|---|---|---|
| GET | `/api/hospitals/[code]/device-supplies` | 로그인 | 이 병원 공급 행 목록 + `supply_tracked` 기기 마스터(빈 행 포함 렌더용) |
| PUT | `/api/hospitals/[code]/device-supplies/[deviceInfoId]` | ADMIN 이상 또는 USER+ (VIEWER 불가) | upsert `{quantity, checkedOn?, note?}` — 기기 `supply_tracked` 검증(꺼진 기기도 **기존 행이 있으면** 수정 허용), 감사 로그 UPDATE/CREATE |
| DELETE | 동일 | 동일 | 행 삭제(= 파악 안 됨으로 되돌림), 감사 로그 |

- 병원 상세는 서버 컴포넌트가 lib 직접 호출(`getHospitalDeviceSummary` 안에서 join) — API는 모달 저장용
- `supplier`는 1차 고정 '대웅제약'(body 미수신). 공급처가 늘면 StatusCode 카테고리로 승격(2차)

---

## 7. 권한 · 감사

- 조회: 병원 상세 접근자 전원(기존 카드와 동일)
- 편집: VIEWER 제외(`isUserOrAbove`). 병원 상세 다른 입력 카드(`HospitalTagsCard`·`SystemStatusCard`)는 `isAdmin`만 허용 → **공급 수량은 USER+ 허용**(영업·운영 실무자가 대웅 자료 받아 바로 기입) — 더 엄격하게 두고 싶으면 ADMIN으로 좁힘(쟁점 1)
- 감사 로그 resource `hospital_device_supply`, label `병원명 / 기기명 / n대`

---

## 8. 마이그레이션 · 시드

- `YYYYMMDD_device_info_supply_tracked` : §3.1 ALTER + 링BP UPDATE
- `YYYYMMDD_hospital_device_supplies` : §3.2 CREATE
- 둘 다 DDL(+마스터 1행 UPDATE)만 — 기존 데이터 변환 없음. CLAUDE.md 규칙대로 psql → migration.sql → `migrate resolve` → `generate`
- 초기 대웅 자료 적재는 별도 1회성 스크립트(dry-run → --apply), PROD는 명시 허락 시

---

## 9. 구현 순서 · 검증

1. 마이그 2건 + Prisma + 설정 화면 체크박스·배지·ADMIN 전용 필드 (반나절)
2. `getHospitalDeviceSummary` 확장(expectedSupply·supply·항상 노출) + 카드 '계약/공급' 열 + 모달 + API 3종 (1일)
3. `/devices` 커버리지 툴팁 병기 (소)
4. 검증: 서비스 스모크(upsert·플래그 검증·expected 합성·compare 전환), 카드 렌더는 dev2 빌드 후 사용자 확인. README(스키마·API·기능)·DEV_HISTORY·원장 설계 B-18 각주 갱신

---

## 10. 쟁점 (검토 요청)

| # | 쟁점 | 제안 |
|---|---|---|
| 1 | 공급 수량 편집 권한 — USER+ vs ADMIN | **USER+** (실무자 직접 기입). 병원 상세 다른 카드는 ADMIN이라 예외가 됨 |
| 2 | 딜 수량과 공급 수량이 둘 다 있는 기기(미래, 우리가 팔면서 대웅도 파는 경우) | 기대치 = **합산**, 셀에 `계약 a + 공급 b` 병기. 1차엔 발생 안 함 |
| 3 | 수량 0 행 vs 행 삭제 | 둘 다 허용 — 0 = "확인했는데 없음", 삭제 = "파악 안 됨". 셀 표시가 다름(`공급(대웅) 0` vs `— 미입력`) |
| 4 | 공급처 고정 '대웅제약' | 1차 고정. 공급처가 2곳 이상 되면 StatusCode 카테고리 `DEVICE_SUPPLIER` 승격 |
| 5 | 기기현황 커버리지 표에 공급 열을 새로 둘지 | 1차 툴팁만(신규 화면 단순 원칙). 요청 시 열 추가 |
