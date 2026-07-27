# 도메인↔티켓 상태 매핑 설정화 설계 (2026-07-27)

> 승인: 2026-07-27 사용자 검토 완료 ("설계안 괜찮네") — 결정①A(완료→CLOSED 유지)·②B(설치계획 단일 축 전환)·③미병기 채택.

## 1. 배경·진단

도메인↔티켓 상태 동기화(`lib/ticketDomain.ts`)가 하드코딩 switch + 이름/라벨 문자열 매칭이라:

| # | 결함 | 증상 |
|---|---|---|
| ① | 신규 상태코드 조용히 오매핑 | 운영자가 상태를 추가하면 default 분기로 OPEN/ASSIGNED 처리, 경고 없음 |
| ② | 라벨 문자열 의존(프로젝트) | BuildStatus 라벨 `완료`/`보류`/`준비` 포함 여부 판정 — 라벨 변경 시 무경고 파손 (CTI 규칙에서 고친 장애유형 이름 매칭과 동일 부류) |
| ③ | 역방향 손실(답사) | `작성완료`·`보류` 둘 다 PENDING, 역방향은 무조건 `보류` — 회신대기가 보류로 강등 |
| ④ | RESOLVED 건너뜀 | 도메인 완료 → CLOSED 직행 (결정①A로 현행 유지 확정) |
| ⑤ | 설치계획 2축 | writeStatus×replyStatus ↔ 단일 상태 — 역방향 리셋·`-` 유실·owner 시 ASSIGNED 아닌 IN_PROGRESS 비일관 |

## 2. 방향

**티켓 6종(Open~Closed)을 상위 분류(기준 축)로 확정**하고, 각 도메인 상태코드가 소속 티켓 상태를 DB 컬럼으로 명시 선언 — 도메인 상태 = 티켓 상태의 하위 세분류. 도메인 어휘(답사예정·구축완료 등)는 유지. `ticket_domain_cti_rules`(이름 매칭→FK)와 동일 원리의 상태 버전.

## 3. 데이터 모델 (순수 추가 DDL)

```sql
ALTER TABLE status_codes
  ADD COLUMN ticket_status ticket_status NULL,
  ADD COLUMN ticket_pending_reason_id INT NULL REFERENCES ticket_pending_reasons(id) ON DELETE SET NULL;
ALTER TABLE build_statuses
  ADD COLUMN ticket_status ticket_status NULL;
```

- `ticket_status` 선택지는 **5종** — OPEN(접수 계열)·IN_PROGRESS·PENDING·RESOLVED·CLOSED. **ASSIGNED는 컬럼에 없음**: OPEN 계열에서 owner 유무로 엔진이 자동 판정 (티켓 자체의 OPEN↔ASSIGNED 자동 연동과 동일 규칙)
- `ticket_pending_reason_id`: PENDING 매핑 상태의 대기 사유 — 답사 `작성완료`(외부 회신 대기) vs `보류`(기타) 구분·역방향 모호성 해소의 열쇠
- 워크플로 카테고리(SITE_VISIT·MAINTENANCE_STATUS·ETC_TASK_STATUS·INSTALL_PLAN_STATUS)만 사용, 그 외 카테고리는 NULL

## 4. 매핑 시드 (`scripts/seed-ticket-status-map.sql`, idempotent)

| 카테고리 | 상태 | ticket_status | pending_reason |
|---|---|---|---|
| MAINTENANCE_STATUS / ETC_TASK_STATUS | 접수 | OPEN | |
| | 처리중 | IN_PROGRESS | |
| | 보류 | PENDING | 기타 |
| | 완료 | CLOSED | |
| SITE_VISIT | 접수 | OPEN | |
| | 답사예정 | IN_PROGRESS | |
| | 작성완료 | PENDING | 외부 회신 대기 |
| | 보류 | PENDING | 기타 |
| | 회신완료 | CLOSED | |
| INSTALL_PLAN_STATUS (신설, §7) | 접수 | OPEN | |
| | 작성완료 | PENDING | 외부 회신 대기 |
| | 회신완료 | CLOSED | |
| | 보류 | PENDING | 기타 |
| build_statuses | 준비 | OPEN | |
| | 진행중 / 업데이트 필요 | IN_PROGRESS | |
| | 보류 | PENDING | |
| | 구축완료 | CLOSED | |

## 5. 동기화 엔진 규칙 (`lib/ticketDomain.ts`)

**순방향 (도메인 → 티켓)**
1. 도메인 상태 행의 `ticket_status` 사용. OPEN 계열은 owner 있으면 ASSIGNED
2. PENDING이면 행의 `ticket_pending_reason_id` + 도메인별 pendingNote(현행 문구) 기입
3. 컬럼 NULL(시드 유실·신규 환경) → **기존 하드코딩 switch 폴백** — 티켓 생성·동기화는 절대 실패하지 않음 (CTI 규칙과 동일 안전망)

**역방향 (티켓 → 도메인)**
1. **일치 유지(keep-if-consistent)**: 현재 도메인 상태의 매핑이 티켓 새 상태와 이미 일치하면 도메인 상태 변경 없음 (RESOLVED·CLOSED는 같은 버킷으로 간주 — 결정①A)
2. 변경 필요 시 같은 버킷 행 중 ① 티켓 pendingReason 일치 행 → ② `order`(sort) 최소 행 선택
3. 해당 버킷에 행이 없으면 도메인 상태 유지(no-op) — 설정 UI 경고로 노출
4. 전이표(`canTransition`) 면제·담당자 동기화 등 나머지 현행 유지

## 6. 설정 UI

- `/settings/maintenance-status`·`etc-task-status`·`site-visit-status`·`install-plan-status`(신설) — StatusCodeManager 공용 + `/settings/build-status`: **'티켓 상태' 필수 셀렉트** (PENDING 선택 시 대기 사유 셀렉트 노출)
- 미매핑 기존 행 `매핑 미지정` 앰버 배지 + 폴백 동작 안내, 역방향 도달 상태(OPEN/IN_PROGRESS/PENDING/CLOSED) 매핑 부재 시 상단 경고 배너

## 7. 설치계획 단일 축 전환 (결정②B)

- `install_plans.status_id` FK(status_codes) 신설, `INSTALL_PLAN_STATUS` 카테고리 4종 시드(접수·작성완료·회신완료·보류)
- 백필: `(완,완)→회신완료`, `(완,미완료|-)→작성완료`, 그 외→`접수`
- `writeStatus`/`replyStatus` 컬럼은 **백업 보존(deprecated, 앱 미사용)** — `issueNote`·`cause` 선례
- UI: 목록 2배지(작성완료여부/회신여부) → 단일 상태 배지, 폼 2셀렉트 → 1셀렉트, 필터·정렬 동반 수정. 메일큐 승격 경로 포함
- owner 있는 접수 → ASSIGNED (기존 IN_PROGRESS 비일관 해소)

## 8. 원칙

- **비소급**: 매핑 변경은 이후 저장·전이부터. 기존 티켓 상태 백필 없음 (CTI 규칙·SLA 정책 동일 원칙)
- 매핑 마스터 변경 시 `scripts/seed-ticket-status-map.sql` 동반 갱신 (idempotent 유지, PROD 최초 반영 시 실행)
- 결정③: 도메인 화면에 티켓 상태 병기하지 않음 (LinkedWorkBanner로 충분)

## 9. 검증

- 스모크 `scripts/ticket-status-map-smoke.mts`: 순방향(컬럼·폴백)·역방향(keep-if-consistent·사유 구분·버킷 부재 no-op)·설치계획 백필 대조
- 실 API E2E: 답사·유지보수·설치계획 등록→상태 변경→티켓 확인, 티켓 전이→도메인 확인
