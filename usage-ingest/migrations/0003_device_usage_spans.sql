-- 기기 사용 구간 표 (2026-11-26, projects/usage_spans_design.md)
--
-- 기기 상태 이력(raw_device_status)에서 계산이 실제로 쓰는 것은 "측정 × 기기 종류 × 시리얼마다 첫 기록 시각과 마지막 기록 시각"뿐이다.
-- 수신부가 상태 이력을 저장하는 같은 트랜잭션에서 이 표를 함께 갱신하고(store.mts pushDeviceStatus),
-- 본체의 계산(lib/usage/metrics.ts)은 원본 대신 이 표를 읽는다.
--   · 시각이 없는 기록(1970-01-01 로 들어온 것)은 넣지 않는다 — 계산도 그 기록을 쓰지 않는다
--   · 갱신은 LEAST / GREATEST 라 같은 기록을 몇 번 받아도, 변환을 몇 번 돌려도 결과가 같다
-- 이 스키마 파일 적용 전에 받은 행은 scripts/usage-spans-backfill.mts 로 한 번 변환한다.

CREATE TABLE device_usage_spans (
  hospital_code    text         NOT NULL,
  server           bigint       NOT NULL REFERENCES agent_servers (id),
  measurement_code text         NOT NULL,
  device_type      smallint     NOT NULL DEFAULT 0,   -- 원본의 NULL 은 0
  serial_number    text         NOT NULL DEFAULT '',  -- 원본의 NULL 은 ''
  first_event_at   timestamp(3) NOT NULL,             -- 이 측정에서 이 기기의 첫 상태 기록
  last_event_at    timestamp(3) NOT NULL,             -- 마지막 상태 기록
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (server, measurement_code, device_type, serial_number)
);
CREATE INDEX device_usage_spans_hospital_meas_idx ON device_usage_spans (hospital_code, measurement_code);
