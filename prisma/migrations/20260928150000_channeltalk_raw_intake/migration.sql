-- 채널톡 상담 원천 적재 (projects/voc_channeltalk_intake_design.md §3, 2026-09-28)
-- 원문 JSONB(raw) + 조회·정합용 추출 컬럼. 채널톡 id를 그대로 PK로 사용. VOC 승격층(voc_receipts)은 본 마이그에서 무변경.

-- 고객 (최신 스냅샷 1행) — profile.OpsCode = hospital_code(HOSP-xxxxxx, 실측 §9)
CREATE TABLE IF NOT EXISTS channeltalk_users (
  id                 VARCHAR(40) PRIMARY KEY,
  channel_id         VARCHAR(40),
  member_id          VARCHAR(80),
  unified_id         VARCHAR(80),
  name               TEXT,
  mobile_number      VARCHAR(40),
  landline_number    VARCHAR(40),
  email              VARCHAR(200),
  ops_code           TEXT,
  hospital_name_raw  TEXT,
  ward               TEXT,
  address            TEXT,
  profile            JSONB,
  tags               TEXT[] NOT NULL DEFAULT '{}',
  raw                JSONB NOT NULL,
  raw_hash           VARCHAR(64) NOT NULL,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channeltalk_users_ops_code_idx ON channeltalk_users (ops_code);

-- 매니저(담당자 이름 표시용 마스터)
CREATE TABLE IF NOT EXISTS channeltalk_managers (
  id             VARCHAR(40) PRIMARY KEY,
  channel_id     VARCHAR(40),
  name           TEXT,
  email          VARCHAR(200),
  raw            JSONB NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 상담 1건 = 1행
CREATE TABLE IF NOT EXISTS channeltalk_user_chats (
  id                   VARCHAR(40) PRIMARY KEY,
  channel_id           VARCHAR(40),
  user_id              VARCHAR(40) REFERENCES channeltalk_users(id) ON DELETE SET NULL,
  state                VARCHAR(16) NOT NULL,
  assignee_id          VARCHAR(40),
  manager_ids          TEXT[] NOT NULL DEFAULT '{}',
  tags                 TEXT[] NOT NULL DEFAULT '{}',
  name                 TEXT,
  description          TEXT,
  contact_medium_type  VARCHAR(32),
  source_type          VARCHAR(32),
  first_ask_text       TEXT,
  first_asked_at       TIMESTAMPTZ,
  opened_at            TIMESTAMPTZ,
  closed_at            TIMESTAMPTZ,
  created_at_ct        TIMESTAMPTZ,
  updated_at_ct        TIMESTAMPTZ,
  raw                  JSONB NOT NULL,
  raw_hash             VARCHAR(64) NOT NULL,
  message_cursor       TEXT,
  message_count        INTEGER NOT NULL DEFAULT 0,
  messages_synced_at   TIMESTAMPTZ,
  hospital_code        TEXT REFERENCES hospitals(hospital_code) ON DELETE SET NULL,
  hospital_match_source VARCHAR(16),
  hospital_match_note  TEXT,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channeltalk_user_chats_state_idx ON channeltalk_user_chats (state);
CREATE INDEX IF NOT EXISTS channeltalk_user_chats_closed_at_idx ON channeltalk_user_chats (closed_at);
CREATE INDEX IF NOT EXISTS channeltalk_user_chats_first_asked_at_idx ON channeltalk_user_chats (first_asked_at);
CREATE INDEX IF NOT EXISTS channeltalk_user_chats_user_id_idx ON channeltalk_user_chats (user_id);
CREATE INDEX IF NOT EXISTS channeltalk_user_chats_hospital_code_idx ON channeltalk_user_chats (hospital_code);
CREATE INDEX IF NOT EXISTS channeltalk_user_chats_tags_gin ON channeltalk_user_chats USING GIN (tags);

-- 메시지 1건 = 1행 (파일은 메타만)
CREATE TABLE IF NOT EXISTS channeltalk_messages (
  id             VARCHAR(40) PRIMARY KEY,
  chat_id        VARCHAR(40) NOT NULL REFERENCES channeltalk_user_chats(id) ON DELETE CASCADE,
  person_type    VARCHAR(16),
  person_id      VARCHAR(40),
  plain_text     TEXT,
  has_files      BOOLEAN NOT NULL DEFAULT false,
  file_meta      JSONB,
  created_at_ct  TIMESTAMPTZ NOT NULL,
  raw            JSONB NOT NULL,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channeltalk_messages_chat_created_idx ON channeltalk_messages (chat_id, created_at_ct);

-- 틱 실행 로그 (30일 보관)
CREATE TABLE IF NOT EXISTS channeltalk_sync_runs (
  id                SERIAL PRIMARY KEY,
  mode              VARCHAR(16) NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  scanned_chats     INTEGER NOT NULL DEFAULT 0,
  upserted_chats    INTEGER NOT NULL DEFAULT 0,
  fetched_messages  INTEGER NOT NULL DEFAULT 0,
  api_calls         INTEGER NOT NULL DEFAULT 0,
  rate_limited      INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  stats             JSONB
);
CREATE INDEX IF NOT EXISTS channeltalk_sync_runs_started_at_idx ON channeltalk_sync_runs (started_at);
