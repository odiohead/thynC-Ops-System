# 사용량 — 기기 사용 구간 표 (원본 상태 이력을 읽지 않는 집계) 설계안

> **상태: 구현 완료 — dev2 · DEV 서버 반영 (2026-11-26), PROD 미반영.** 사용자 "모두 다 개발해서 DEV까지" — 결정 항목은 제안값으로 진행. S5(원본 보관 6개월)는 정리 스크립트만 만들었고 **아무 환경에서도 지우지 않았다**(지금은 6개월보다 오래된 달이 없다). 구현 노트 §8.
> 관련: [usage_collection_design.md](usage_collection_design.md)(수집·원본 DB) · [usage_overview_design.md](usage_overview_design.md) §5(일별 집계) · CLAUDE.md 규칙 9

---

## 1. 왜 필요한가

사용자 제안(2026-11-26): "로우 데이터에서 정제된 통계 데이터를 별도 테이블로 관리하면 어떨까."

지금 구조에는 정제 단계가 **하나만** 있다.

```
병원 서버 ──▶ 원본 DB (측정 · 측정 기기 · 기기 상태 이력) ──▶ 일별 집계 (본체 DB) ──▶ 전체 병원 대시보드
                          │
                          └────────────── 열 때마다 계산 ──────────────▶ 병원별 화면
```

일별 집계를 채울 때도, 병원별 화면을 열 때도 **기기 상태 이력 원본을 그대로 읽는다.** 그런데 계산이 이 표에서 실제로 쓰는 것은 "측정 × 기기 × 시리얼마다 **첫 기록 시각과 마지막 기록 시각**" 두 값뿐이다(기기 사용 구간의 시작과 끝).

PROD 실측 (2026-11-26):

| 항목 | 값 |
|---|---|
| 기기 상태 이력 | 4개월 6,200만 행 · 20GB (한 달 약 2,000만 행 · 7GB) |
| 그 가운데 계산이 쓰는 정보 | 측정 × 기기 × 시리얼당 2개 값 — 목포중앙 167만 행 → 1,220구간 (약 1/1,400) |
| 전체 집계 한 바퀴 (188곳 · 91일) | 14분 — 2026-11-26 '매시간 최근 3일 + 하루 한 번 전체'로 나눠 매시간 부하는 줄였지만 전체 집계는 그대로 |
| 병원 하나 91일 (무거운 부분만) | 목포중앙 23.9초 · 문산중앙 7.2초 · 김포우리 3.5초 — 병원별 화면을 90일로 열 때도 같은 조회 |

즉 느린 원인은 "집계를 자주 한다"가 아니라 **매번 원본 수십만~백만 행에서 두 값을 다시 뽑는다**는 데 있다. 그 두 값을 받을 때 한 번만 뽑아 두면 된다.

## 2. 검토가 필요한 결정 (제안값)

| # | 결정 | 제안 | 이유 · 대안 |
|---|---|---|---|
| S1 | 무엇을 정제해 둘 것인가 | **기기 사용 구간 표** 하나 — (서버, 측정, 기기 종류, 시리얼)마다 첫·마지막 기록 시각 | 계산이 원본에서 쓰는 전부다. 일별 집계는 이미 있으므로 그 사이의 빈 단계만 채운다. 날짜별 중간 집계를 더 만들지 않는다 — 산정 기준(하루의 경계 · 제외 규칙)이 바뀌어도 구간 표는 그대로 쓸 수 있다 |
| S2 | 누가 유지하나 | **수신부** — 상태 이력을 저장하는 같은 트랜잭션에서 구간 표를 함께 갱신 | 원본 DB에 쓰는 것은 수신부뿐이다(규칙 9). 본체가 주기적으로 만드는 방식은 본체가 원본 DB에 쓰게 되고, 다시 원본을 훑어야 한다 |
| S3 | 기존 6,200만 행 | **1회 변환** — 달 조각마다 한 번씩 묶어 구간 표에 넣는다 | 구간 갱신이 '더 이른 첫 시각 · 더 늦은 마지막 시각'이라 수신부가 떠 있는 동안 돌려도, 여러 번 돌려도 결과가 같다. 예상 15분 안쪽(업무 외 시간) |
| S4 | 계산이 읽는 곳 | 일별 집계와 병원별 화면 **모두 구간 표** (`lib/usage/metrics.ts` 한 곳만 바뀜) | 계산 규칙은 그대로다. 읽는 표만 바뀐다 |
| S5 | **원본 상태 이력 보관 기간** | **최근 6개월** 보관, 그보다 오래된 달은 달 조각째 삭제 (삭제 전 대상 · 크기를 보여 주고 실행) | 지금 원칙은 "원본 행은 지우지 않는다"인데 월 7GB씩 늘어 60GB 상한이 5~6개월 뒤 다시 찬다. 대안 — ⓐ 계속 전부 보관(디스크 증설 필요) ⓑ 3개월(병원 서버 보존 기간 90일과 같음, 약 21GB) ⓒ 삭제 전 S3에 압축 보관. **이 항목은 원칙을 바꾸는 것이라 따로 확인이 필요하다** |
| S6 | 집계 주기 | 지금 그대로(매시간 최근 3일 + 새벽 전체) | 구간 표를 쓰면 전체 집계도 1분 안쪽이 될 것으로 보지만, 실제 시간을 본 뒤 정리한다 |

S5를 정하지 않아도 S1~S4는 진행할 수 있다(구간 표는 원본을 지우든 말든 같다). 다만 **원본을 지운 달의 구간은 다시 만들 수 없다** — 구간의 정의 자체를 바꾸게 되면(예: 특정 상태의 기록만 사용으로 본다) 보관 기간 안의 달만 다시 계산된다.

## 3. 설계

### 3.1 구간 표 (원본 DB — `usage-ingest/migrations/0003_device_usage_spans.sql`)

```sql
CREATE TABLE device_usage_spans (
  hospital_code    text         NOT NULL,
  server           bigint       NOT NULL REFERENCES agent_servers (id),
  measurement_code text         NOT NULL,
  device_type      smallint     NOT NULL DEFAULT 0,
  serial_number    text         NOT NULL DEFAULT '',      -- 원본의 NULL 은 '' 로
  first_event_at   timestamp(3) NOT NULL,                 -- 이 측정에서 이 기기의 첫 상태 기록
  last_event_at    timestamp(3) NOT NULL,                 -- 마지막 상태 기록
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (server, measurement_code, device_type, serial_number)
);
CREATE INDEX device_usage_spans_hospital_meas_idx ON device_usage_spans (hospital_code, measurement_code);
```

- 단위는 지금 계산의 묶음 기준과 같다(서버 · 측정 코드 · 기기 종류 · 시리얼).
- 시각이 없는 기록(원본에 `1970-01-01`로 들어간 것)은 지금 계산도 빼므로 구간 표에 넣지 않는다.
- 예상 크기: 수십만 행, 수십 MB.

### 3.2 수신부 (`usage-ingest/store.mts` `pushDeviceStatus`)

상태 이력을 넣는 문장 하나에 구간 갱신을 붙인다. **새로 들어간 행만** 구간에 반영한다(다시 보낸 행은 이미 반영돼 있다).

```sql
WITH ins AS (
  INSERT INTO raw_device_status (...) SELECT ... ON CONFLICT (server, table_year, source_id, event_at) DO NOTHING
  RETURNING measurement_code, device_type, serial_number, event_at
)
INSERT INTO device_usage_spans (hospital_code, server, measurement_code, device_type, serial_number, first_event_at, last_event_at)
SELECT $1, $2, measurement_code, COALESCE(device_type, 0), COALESCE(serial_number, ''), min(event_at), max(event_at)
  FROM ins WHERE event_at >= timestamp '2000-01-01'
 GROUP BY 3, 4, 5
ON CONFLICT (server, measurement_code, device_type, serial_number) DO UPDATE SET
  first_event_at = LEAST(device_usage_spans.first_event_at, EXCLUDED.first_event_at),
  last_event_at  = GREATEST(device_usage_spans.last_event_at, EXCLUDED.last_event_at),
  updated_at     = now()
```

- 받은 위치(`status_cursors`) 갱신과 같은 트랜잭션이다 — 원본만 들어가고 구간은 빠지는 일이 없다.
- 하루 한 번의 대조로 위치가 되돌아가 같은 행을 다시 받아도, 이미 있는 행은 `ins`에 나오지 않으므로 구간은 그대로다.
- Agent 변경 없음(병원 서버 재설치 없음).

### 3.3 기존 행 변환 (`scripts/usage-spans-backfill.mts`)

- 달 조각을 하나씩 묶어 구간 표에 넣는다(3.2와 같은 `ON CONFLICT … LEAST/GREATEST`). 갱신이 순서와 횟수에 무관하므로 수신부 교체 시각을 따질 필요가 없고, 다시 실행해도 결과가 같다.
- `--dry`로 조각별 행 수(추정)를 먼저 보여 준다. `--partition=<이름>`으로 한 조각만 돌릴 수 있다.
- `--verify [병원코드]`: 병원마다 `구간 표` = `원본에서 다시 묶은 값`(구간 수 · 첫/마지막 시각)인지 확인하고 다른 병원을 출력한다(읽기 전용).

### 3.4 본체 (`lib/usage/metrics.ts`)

- 기기 사용 구간을 읽는 조회의 `raw_device_status`를 묶는 부분을 `device_usage_spans` 조회로 바꾼다. 나머지(측정 기기 목록과 맞춰 시작 · 끝을 정하는 규칙)는 그대로다.
- '기기 상태 이력을 어디까지 받았는가'(따라잡는 중인 서버)도 구간 표의 가장 늦은 `last_event_at`으로 읽는다.
- 그 밖에 원본 상태 이력을 읽는 곳은 운영 스크립트(`usage-status.mts` — 조각 수 · 크기)와 검증 스크립트뿐이다.

### 3.5 원본 보관 (S5 채택 시 — `scripts/usage-status-retention.mts`)

- `--dry`: 보관 기간 밖의 달 조각과 크기를 보여 준다. 실행하면 그 조각을 떼어 내고 지운다(조각 단위라 빠르고 빈 공간이 바로 돌아온다).
- 수신부의 대조는 '지난 대조 이후에 받은 번호'만 보므로 오래된 달을 지워도 영향이 없다.
- 지운 달의 기록이 뒤늦게 다시 들어오면(병원 서버가 오래 꺼져 있다 켜진 경우) 조각이 다시 생기고 구간에도 반영된다. 다음 정리 때 다시 지운다.
- 규칙 9의 "원본 행은 지우지 않는다"를 "기기 상태 이력만 보관 기간을 둔다(측정 · 측정 기기 · 기기 등록은 지우지 않는다)"로 고친다.

## 4. 기대 효과 (실측 뒤 확정)

| | 지금 | 구간 표 적용 뒤 (예상) |
|---|---|---|
| 목포중앙 91일의 무거운 조회 | 23.9초 (조회 상한 초과) | 0.1초 안쪽 — 1,220행을 색인으로 읽음 |
| 전체 집계 한 바퀴 (188곳 · 91일) | 14분 | 1분 안쪽 |
| 병원별 화면 90일 | 병원에 따라 3~20초+ | 1초 안쪽 |
| 원본 DB 크기 | 월 7GB 증가 | 구간 표는 수십 MB. 원본은 S5에 따라 6개월 약 42GB에서 멈춤 |

예상값은 "읽는 행 수가 약 1/1,000이 된다"에서 나온 것이고, 실제 시간은 변환 뒤 PROD에서 잰다.

## 5. 검증

1. **수신 시나리오** — `scripts/usage-collect-smoke.mts`에 추가: 새 기록 수신 · 같은 기록 재전송 · 위치 되돌린 뒤 재수신 · 기기 교체 · 용량 상한 뒤 재개 각각에서 `구간 표 = 원본에서 다시 묶은 값`.
2. **변환 대조** — 3.3의 병원별 대조가 전 병원 일치.
3. **계산 값** — `scripts/usage-metrics-test.mts <병원코드>`(화면 계산과 별도 SQL 계산 대조)를 변환 전후로 돌려 같은 값. 저장된 일별 집계도 `usage-stats-rebuild.mts --check`로 일치.
4. **시간** — 큰 병원 3곳(목포중앙 · 김포우리 · 문산중앙)과 전체 집계 한 바퀴를 전후로 잰다.

## 6. 진행 순서 (승인 후)

1. 표 · 수신부 · 변환 스크립트 · 본체 조회 구현, dev2 검증(스모크 · 문산중앙 실데이터)
2. DEV 서버: 수신부 빌드 → 스키마 적용 → 수신부 재시작 → 변환 → 본체 배포, 값 · 시간 대조
3. PROD: 같은 순서(업무 외 시간). 스키마 적용과 변환은 원본 DB 쓰기라 명시 허락 후
4. (S5 채택 시) 보관 정리 스크립트 `--dry` 결과를 보고 실행 여부 결정

수신부가 바뀌는 배포이므로 `npm run build:usage-ingest` → `node usage-ingest/dist/migrate.mjs` → `pm2 restart thync-usage-ingest-<env>` 절차를 따른다. 재시작 중 실패한 전송은 Agent가 다음 실행 때 다시 보낸다.

## 7. 이번 범위가 아닌 것

- 원본 DB 백업(PROD `thync_usage`는 일일 백업 대상이 아님 — 미결정 그대로)
- 측정 기기 레코드의 일반/사용량 값(`device_info.premium`) 수집 — Agent 재배포가 필요해 별도 결정
- 일별 집계 표의 구조 변경, 병원별 화면의 화면 구성 변경

---

## 8. 구현 노트 (2026-11-26, dev2 · DEV)

### 8.1 만든 것

| 위치 | 내용 |
|---|---|
| `usage-ingest/migrations/0003_device_usage_spans.sql` | 구간 표 + 색인 (원본 DB) |
| `usage-ingest/store.mts` `pushDeviceStatus` | 원본 저장 문장에 구간 갱신을 붙임 — 새로 들어간 행만 반영 |
| `scripts/usage-spans-backfill.mts` | 기존 행 변환(`--dry` · `--partition`) · 원본과 대조(`--verify`) |
| `scripts/usage-status-retention.mts` | 원본 상태 이력 보관 기간 정리 — 기본은 미리 보기, `--apply`로만 지움. 지우기 전에 그 조각의 구간이 구간 표에 모두 있는지 확인하고 하나라도 빠지면 멈춤 |
| `lib/usage/metrics.ts` | 기기 사용 구간 · '상태 이력을 어디까지 받았는가'를 구간 표에서 읽음 |
| `scripts/usage-lib.mts` | 병원 코드를 가진 표 목록에 구간 표 추가(병원 코드 변경 · 스모크 정리) |

### 8.2 설계에서 달라진 것

- **기록 수(`event_count`)를 두지 않았다.** 기록 수는 더하는 값이라 변환과 수신이 겹치면 맞추기 위해 '교체 시각'을 따져야 한다. 첫 · 마지막 시각만 두면 갱신이 순서 · 횟수와 무관해져 변환을 언제든, 몇 번이든 돌릴 수 있다. 대조도 시각으로 충분하다.

### 8.3 검증 결과 (dev2)

- 수신 시나리오 `usage-collect-smoke.mts` 99/99 — 구간 표 검사 6개 추가(첫 수신 · 기기 교체 · 대조로 위치를 되돌려 다시 받음 · 전체 재전송 · 나눠 받음 · 용량 상한 뒤 재개 각각에서 구간 표 = 원본에서 다시 묶은 값)
- 변환: dev2 원본 168만 행 → 2,063구간, 1초. `--verify` 전 병원 일치, 다시 돌려도 그대로
- 계산 값: 문산중앙의 저장된 일별 집계(원본으로 계산한 값) = 구간 표로 다시 계산한 값(`usage-stats-rebuild.mts HOSP-000046 --check`), 실데이터 대조 `usage-metrics-test.mts HOSP-000046` 통과
- 시간(dev2): 병원 하나 91일 계산 문산중앙 1,965ms → 21ms · 화순성심 20ms · 동수원 7ms
- 보관 정리: 임시로 만든 2024-01 조각으로 미리 보기 → 구간이 없을 때 중단 → 변환 뒤 삭제 → 구간은 남음 확인

### 8.4 PROD에 올릴 때 (요청 시 — 원본 DB 쓰기라 명시 허락 필요)

1. `git pull` → `npm run build:usage-ingest` → `node usage-ingest/dist/migrate.mjs`(0003 — 표 생성) → `pm2 restart thync-usage-ingest-prod`
2. `npx tsx scripts/usage-spans-backfill.mts --dry` → 실행(6,200만 행 — 업무 외 시간 권장, 예상 15분 안쪽) → `--verify`
3. 본체 빌드 → `pm2 restart thync-prod`. **2번이 끝나기 전에 본체를 먼저 올리면 안 된다** — 구간 표가 비어 있으면 기기 사용이 측정 기기 목록 기준으로만 계산된다
4. 확인: `usage-stats-rebuild.mts --check`(표본 병원), 서버 로그의 집계 시간
5. 보관 정리(`usage-status-retention.mts`)는 따로 결정한 뒤에만

