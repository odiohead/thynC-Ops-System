# 심평원 병원상세정보연동 v2 — 의원급 확장 + 진료과목·전문의 + 일일 한도 분할 실행

> **상태**: 구현 완료 (dev2, 2026-09-14) — 빌드·PROD 배포 대기. 착수: 사용자 지시 "개발시작해"
> 대상 화면: 설정 > 심평원 연동 관리(`/settings/hira-sync`) · HIRA 병원 상세(`/hira-hospitals/[id]`) · 병원 상세(`/hospitals/[code]`)

---

## 1. 배경·목적

- 현행 병원상세정보연동은 **허가병상수 1항목**만, **병원급 7종**만 가져온다(의원급은 일일 호출 한도 때문에 2026-08-10에 제외).
- 심평원 의료기관별상세정보서비스(`MadmDtlInfoService2.8`)에는 같은 키로 호출 가능한 **진료과목정보(`getDgsbjtInfo2.8`)**·**전문과목별 전문의수(`getSpcSbjtSdrInfo2.8`)** 오퍼레이션이 있다(2026-09-14 기존 키로 호출 검증 완료). 셋 다 기관코드(ykiho) 단위 1콜.
- 요구: ① 의원(31)도 대상에 포함, 병상수도 저장 ② 항목을 병상수·진료과목·전문의수로 확장 ③ 일일 한도(10,000콜) 안에서 **수일에 걸쳐 자동 분할 실행** ④ 요청(잡) 상세 화면에서 진행 상황 확인.

## 2. 호출 예산·분할 규칙

| 항목 | 값 |
|---|---|
| 일일 호출 예산 | **9,000콜** (한도 10,000의 안전 마진) |
| 병원당 호출 수 | 선택한 항목 수 (1~3) |
| 일일 병원 처리량 | `floor(9000 / 항목수)` → 3항목 3,000곳 / 2항목 4,500곳 / 1항목 9,000곳 |
| 일 경계 | KST 자정 (공공데이터포털 한도 리셋 기준). 다음 실행 = 익일 **00:10 KST** |
| 호출 간격 | 100ms (현행 유지) |

- 예산 소진 전이라도 API가 한도 초과(`22`) 등 치명 코드를 주면 즉시 그날 실행을 멈추고 익일 대기.
- 하루 처리 후 남은 대상이 있으면 잡 상태 `waiting`(다음날 대기) → 서버 내 스케줄러(5분 tick)가 `next_run_at` 도달 시 자동 재개. 1주가 걸리든 2주가 걸리든 잡 1건이 끝까지 이어진다.

## 3. 데이터 모델

### 3.1 `hira_hospitals` 컬럼 추가
| 컬럼 | 의미 |
|---|---|
| `dept_synced_at` | 진료과목 마지막 연동 시각 |
| `sdr_synced_at` | 전문의수 마지막 연동 시각 |
| (기존) `perm_sbd_cnt`·`detail_synced_at` | 허가병상수·연동 시각 — 의미 유지 |

### 3.2 신규 `hira_hospital_depts` (병원별 진료과목·전문의)
| 컬럼 | 의미 |
|---|---|
| `hira_hospital_id` FK(cascade) | 대상 병원 |
| `dgsbjt_cd` / `dgsbjt_nm` | 진료과목 코드·명 (두 오퍼레이션이 같은 코드 체계 사용) |
| `pr_sdr_cnt` | 진료과목별 전문의수 (`getDgsbjtInfo`) |
| `cdiag_dr_cnt` | 선택진료의사수 (`getDgsbjtInfo`) |
| `dtl_sdr_cnt` | 전문과목별 전문의수 (`getSpcSbjtSdrInfo`) |
| unique(`hira_hospital_id`, `dgsbjt_cd`) | |

- 두 오퍼레이션 결과를 **과목 코드 기준 한 행에 병합**. 각 항목 연동 시 응답에 없는 과목은 해당 항목 컬럼만 NULL 처리, 두 컬럼 모두 NULL이면 행 삭제.
- 진료과목정보는 "표방 과목"(전문의 0명 포함), 전문과목별 전문의수는 실제 전공 인원 — 둘의 차이가 그대로 화면에 드러나도록 두 컬럼을 분리 보관.

### 3.3 `hira_sync_jobs` 컬럼 추가 (분할 실행·진행 상황)
| 컬럼 | 의미 |
|---|---|
| `params` jsonb | `{ typeCodes: string[], items: ('bed'|'dept'|'sdr')[] }` |
| `total_targets` / `done_count` / `failed_count` | 대상·완료·실패 병원 수 |
| `daily_quota` | 일일 병원 처리량 |
| `calls_today` / `quota_date` | 오늘(KST) 사용 호출 수·기준일 |
| `day_count` | 실행 일차 |
| `next_run_at` | 대기 중일 때 재개 예정 시각 |

- `status`: `running` | **`waiting`**(신규, 다음날 대기) | `done` | `error` | **`cancelled`**(신규)

### 3.4 신규 `hira_sync_job_targets` (잡별 대상 병원 진행 상태)
| 컬럼 | 의미 |
|---|---|
| `job_id` FK(cascade), `hira_hospital_id` FK(cascade) | |
| `status` | `pending` / `done` / `failed` |
| `error`, `processed_at` | 실패 사유·처리 시각 |
| unique(`job_id`,`hira_hospital_id`), index(`job_id`,`status`) | |

- 잡 생성 시 대상 병원을 스냅샷으로 적재. 재개·재시작 시 `pending`만 이어서 처리하므로 **진행 상태가 DB에만 의존**(프로세스 재시작에 안전).

## 4. 실행기 — `lib/hira-detail-sync.ts` (단일 소스)

- `startDetailSyncJob(typeCodes, items)`: 잡 + 대상 적재 → 즉시 `runDay` 백그라운드 실행.
- `runDay(jobId)`: KST 날짜가 바뀌었으면 `calls_today` 리셋·`day_count`+1 → `pending` 대상을 순회하며 항목별 오퍼레이션 호출(bed → dept → sdr) → 병원 행·과목 행 갱신·대상 `done` → 카운터 갱신. 100건마다 진행 로그. 20건마다 잡 상태 재조회(취소 감지).
  - 오늘 처리량 도달 & 남은 대상 有 → `waiting` + `next_run_at`=익일 00:10 KST + `day_done` 로그
  - 남은 대상 無 → `done`
  - 치명 API 오류 → `waiting`(익일) + error 로그(비치명이 아닌데도 잡을 죽이지 않음 — 다음날 이어감)
  - 병원 단위 실패(파싱·HTTP) → 대상 `failed` 기록 후 계속
- `cancelDetailSyncJob(id)`: `running`/`waiting` → `cancelled`.
- 스케줄러 `startHiraDetailScheduler()` (instrumentation에서 기동, 5분 tick): `waiting` & `next_run_at <= now` 잡을 재개. 다른 잡이 `running`이면 이번 tick 건너뜀.
- 서버 재시작 고아 처리(instrumentation): 상세 잡(`params` 있음)은 `error`가 아니라 **`waiting` + `next_run_at=now`** 로 전환해 즉시 재개. 구 방식 잡(목록 연동·params 없는 상세)은 종전대로 `error`.
- 배타 규칙: 목록 연동·상세 연동 모두 `running` 잡이 있으면 409(현행). 상세 연동은 추가로 `waiting` 상세 잡이 있으면 409(한 번에 한 요청).

## 5. API

| 메서드 | 경로 | 변경 |
|---|---|---|
| POST | `/api/hira-hospitals/detail-sync` | body `{ typeCodes, items }` — 종별에 `31 의원` 추가, 항목 1개 이상 필수 |
| POST | `/api/hira-hospitals/detail-sync/[id]/cancel` | 신규 — 진행/대기 잡 취소 |
| GET | `/api/hira-hospitals/sync/[id]` | 응답에 진행 요약(`progress`)·실패 병원 표본(최대 20) 추가 |
| GET | `/api/hira-hospitals/sync` | 변경 없음(신규 컬럼 포함 반환) |

## 6. 화면

### 6.1 설정 > 심평원 연동 관리
- 병원상세정보연동 카드: 종별 체크박스에 **의원** 추가, **항목 체크박스(허가병상수·진료과목·전문의수, 기본 전체)** 추가. 예상치 표시: 총 호출 수·일일 처리량·예상 소요 일수.
- 히스토리 표: 상태 배지에 `대기(다음날)`·`취소` 추가, 연동건수 열은 상세 잡이면 `완료/대상`.
- 로그 패널(요청 상세): 상세 잡이면 상단에 **진행 요약** — 진행률 바, 대상/완료/실패, 일차, 오늘 호출 사용량, 다음 실행 예정, 예상 완료일, 종별·항목, **취소 버튼**(진행/대기 중). 로그는 현행 스트림 유지 + `day_done` 강조.

### 6.2 HIRA 병원 상세
- 의료진 섹션에 허가병상수 표시, **진료과목·전문의 섹션**(표: 과목 / 진료과목 전문의 / 전문과목 전문의) + 항목별 연동 시각.

### 6.3 병원 상세(`/hospitals/[code]`)
- 기본 정보에 `진료과목 (심평원)` 한 줄 요약 — `내과(전문의 1) · 정형외과 …`. 데이터 없으면 '-'.

## 7. 비범위

- 치과의원(51)·한의원(93)·보건기관 등은 이번 대상에서 제외(종별 목록에 추가만 하면 확장 가능).
- 세션·페이지 권한 변경 없음(SUPER_ADMIN 전용 유지).
- 기존 `perm_sbd_cnt` 표시(병원 목록·상세)는 그대로.

## 8. 검증 계획

- tsc·eslint 0. dev2에서 의원 소수 대상(항목 3개)으로 실제 호출 → 과목 행 생성·병합 확인, 일일 처리량을 임시로 낮춰 `waiting` 전환·스케줄러 재개·취소·재시작 고아 재개 확인.
- PROD 반영 시: 마이그레이션 4건(컬럼·테이블) + 첫 실행은 의원 3.8만 곳 × 3항목 = 13일 예상.
