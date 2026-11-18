-- thynC 사용량 원본 DB 초기 스키마 (projects/usage_collection_design.md §7)
-- 대상 DB: thync_usage(_dev) — 본체 DB(thync_ops)와 별개. 본체 테이블을 참조하지 않는다.
-- 적용: node usage-ingest/dist/migrate.mjs (schema_migrations 에 기록, 1회만 실행됨)
--
-- 규칙
--   · 모든 원본 테이블에 hospital_code (병원 구분) + server (병원 아래 서버 구분)
--   · 시각 중 source 값은 병원 DB에 있는 그대로 — 시간대 없는 timestamp
--   · 원본 행은 지우지 않는다. 병원에서 사라진 것은 gone_at / source_gone_at / removed_at 만 기록

-- ── 식별 ─────────────────────────────────────────────────────────────

CREATE TABLE agent_tokens (
  id            bigserial PRIMARY KEY,
  hospital_code text        NOT NULL,           -- 본체의 병원 코드(HOSP-…). 발급 스크립트가 본체 DB에서 확인
  token_hash    text        NOT NULL UNIQUE,    -- 토큰 원문의 SHA-256(hex). 원문은 저장하지 않는다
  token_prefix  text        NOT NULL,           -- 앞 8자 (목록·문의 대응용)
  label         text,
  active        boolean     NOT NULL DEFAULT true,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  last_used_at  timestamptz
);
CREATE INDEX agent_tokens_hospital_idx ON agent_tokens (hospital_code);

CREATE TABLE agent_servers (
  id                        bigserial PRIMARY KEY,
  hospital_code             text        NOT NULL,
  server_id                 text        NOT NULL,    -- Agent가 보낸 서버 이름 (병원 안에서 유일)
  hostname                  text,
  agent_version             text,
  db_version                text,
  db_time_zone              text,
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  last_success_at           timestamptz,
  measurements_synced_until timestamp,               -- 병원 DB 시각 기준. 다음 실행의 측정 기준 시각 = 이 값 − 2일
  reconciled_at             timestamptz,             -- 마지막 대조 완료 시각
  UNIQUE (hospital_code, server_id)
);

CREATE TABLE agent_runs (
  id               bigserial PRIMARY KEY,
  hospital_code    text        NOT NULL,
  server           bigint      NOT NULL REFERENCES agent_servers (id),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  agent_version    text,
  source_now       timestamp,                        -- 실행 시작 때 병원 DB의 NOW()
  full_sync        boolean     NOT NULL DEFAULT false,
  reconcile        boolean     NOT NULL DEFAULT false,
  stats            jsonb,
  reconcile_result jsonb,
  error            text,
  remote_ip        text
);
CREATE INDEX agent_runs_server_idx ON agent_runs (server, started_at DESC);
CREATE INDEX agent_runs_hospital_idx ON agent_runs (hospital_code, started_at DESC);

-- 상태 이력 수신 위치 (서버 × 연도 테이블)
CREATE TABLE status_cursors (
  server      bigint      NOT NULL REFERENCES agent_servers (id),
  table_year  smallint    NOT NULL,
  last_id     bigint      NOT NULL DEFAULT 0,        -- 여기까지 받았다
  verified_id bigint      NOT NULL DEFAULT 0,        -- 여기까지 대조를 마쳤다
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server, table_year)
);

-- ── 원본: 작은 테이블 (매 실행 전체 수신) ─────────────────────────────

CREATE TABLE raw_organizations (
  hospital_code     text        NOT NULL,
  server            bigint      NOT NULL REFERENCES agent_servers (id),
  organization_code text        NOT NULL,
  organization_name text,
  organization_type integer,
  level             integer,
  expiration        integer,
  source_created_at timestamp,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_run     bigint,
  gone_at           timestamptz,
  PRIMARY KEY (server, organization_code)
);
CREATE INDEX raw_organizations_hospital_idx ON raw_organizations (hospital_code);

CREATE TABLE raw_wards (
  hospital_code     text        NOT NULL,
  server            bigint      NOT NULL REFERENCES agent_servers (id),
  ward_code         text        NOT NULL,
  organization_code text,
  ward_name         text,
  deactivate        integer,
  bed_count         integer,
  bed_active_count  integer,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_run     bigint,
  gone_at           timestamptz,
  PRIMARY KEY (server, ward_code)
);
CREATE INDEX raw_wards_hospital_idx ON raw_wards (hospital_code);

CREATE TABLE raw_device_registers (
  hospital_code     text        NOT NULL,
  server            bigint      NOT NULL REFERENCES agent_servers (id),
  serial_number     text        NOT NULL,
  organization_code text,
  device_type       integer,
  device_code       text,
  ward_code         text,
  premium           integer,                         -- 구독형 1 / 일반 0 (현재 값)
  return_status     integer,
  total_use_time    integer,
  total_use_count   integer,
  registered_at     timestamp,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_run     bigint,
  gone_at           timestamptz,
  PRIMARY KEY (server, serial_number)
);
CREATE INDEX raw_device_registers_hospital_idx ON raw_device_registers (hospital_code, serial_number);

-- ── 원본: 측정 ───────────────────────────────────────────────────────

CREATE TABLE raw_measurements (
  hospital_code           text        NOT NULL,
  server                  bigint      NOT NULL REFERENCES agent_servers (id),
  measurement_code        text        NOT NULL,
  parent_measurement_code text,
  parent_type             integer,                   -- 0 부모 / 1 자식(심전도 리드 추가)
  lead                    integer,
  organization_code       text,
  ward_code               text,
  sickroom_code           text,
  sickbed_code            text,
  measurement_type        text,                      -- BM 병상 모니터링 / ET 응급이송
  measurement_status      integer,                   -- 1 대기 · 2 측정 중 · 3 종료 · 8 완료 · 10 삭제(보관 기한 경과)
  patient_status          integer,
  start_at                timestamp,
  end_at                  timestamp,                 -- 진행 중이면 예정 종료 시각
  duration_hours          integer,
  elapsed_seconds         bigint,
  source_created_at       timestamp,
  source_modified_at      timestamp,
  shard                   text,
  first_seen_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  last_changed_at         timestamptz NOT NULL DEFAULT now(),
  source_gone_at          timestamptz,               -- 병원 DB에서 행이 사라진 것을 대조로 확인한 시각
  PRIMARY KEY (server, measurement_code)
);
CREATE INDEX raw_measurements_hospital_start_idx  ON raw_measurements (hospital_code, start_at);
CREATE INDEX raw_measurements_hospital_end_idx    ON raw_measurements (hospital_code, end_at);
CREATE INDEX raw_measurements_hospital_status_idx ON raw_measurements (hospital_code, measurement_status);

-- 측정에 붙은 기기. 키에 시리얼이 들어 있어 기기 교체 시 이전 행이 남는다(removed_at 만 기록)
CREATE TABLE raw_measurement_devices (
  id                    bigserial PRIMARY KEY,
  hospital_code         text        NOT NULL,
  server                bigint      NOT NULL REFERENCES agent_servers (id),
  measurement_code      text        NOT NULL,
  device_type           integer     NOT NULL DEFAULT 0,
  serial_number         text        NOT NULL DEFAULT '',
  source_device_info_id bigint,
  device_code           text,
  lead                  text,
  attached_at           timestamp,
  premium               integer,                     -- 전송 시점의 기기 등록 값. 등록 정보가 없으면 NULL
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  removed_at            timestamptz,                 -- 측정의 현재 기기 목록에서 빠진 것을 확인한 시각
  UNIQUE (server, measurement_code, device_type, serial_number)
);
CREATE INDEX raw_measurement_devices_hospital_serial_idx ON raw_measurement_devices (hospital_code, serial_number);
CREATE INDEX raw_measurement_devices_hospital_meas_idx   ON raw_measurement_devices (hospital_code, measurement_code);

-- ── 원본: 기기 상태 이력 (월별 분할) ──────────────────────────────────
-- 분할 기준은 발생 시각. 같은 원본 행은 발생 시각이 같으므로 다시 받아도 같은 조각에서 걸러진다.
-- 달 조각은 수신부가 필요할 때 만든다 (raw_device_status_yYYYYmMM).

CREATE TABLE raw_device_status (
  hospital_code    text         NOT NULL,
  server           bigint       NOT NULL,
  table_year       smallint     NOT NULL,            -- 원본 테이블 device_status_info_<연도>
  source_id        bigint       NOT NULL,            -- 원본 기본 키
  measurement_code text         NOT NULL,
  device_type      smallint,
  serial_number    text,
  status           smallint,                         -- 1 측정 시작 · 2 블루투스 연결 · 3 리드 부착 · 4 리드 탈락 · 5 블루투스 끊김 · 6 정지 · 7 사용자 정지
  battery_value    smallint,
  device_kind      smallint,
  event_at         timestamp(3) NOT NULL,            -- 원본에 시각이 없으면 1970-01-01
  received_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (server, table_year, source_id, event_at)
) PARTITION BY RANGE (event_at);

CREATE TABLE raw_device_status_default PARTITION OF raw_device_status DEFAULT;
CREATE INDEX raw_device_status_hospital_meas_idx ON raw_device_status (hospital_code, measurement_code, event_at);

-- ── 대조용 임시 적재 (실행이 끝나면 비운다) ────────────────────────────

CREATE TABLE recon_measurement_index (
  run_id             bigint    NOT NULL,
  measurement_code   text      NOT NULL,
  measurement_status integer,
  source_modified_at timestamp,
  PRIMARY KEY (run_id, measurement_code)
);
