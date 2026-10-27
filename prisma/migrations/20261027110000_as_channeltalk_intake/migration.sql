-- AS접수 인입 소스 전환: 구글시트 → 채널톡 상담 원문 (2026-10-27, projects/as_channeltalk_intake_design.md §3)
-- as_receipts: 출처·VOC 마스터 / as_intake_links: 상담 ↔ AS접수 연결 + 등록대기 큐 / voc_receipt_types: VOC 복수 분류

ALTER TABLE as_receipts ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'MANUAL'; -- MANUAL 화면 / SHEET 시트 폴링 / CHANNELTALK 상담 자동 / INTAKE_QUEUE 등록대기 수동 확정 / IMPORT 마이그
ALTER TABLE as_receipts ADD COLUMN IF NOT EXISTS voc_id INTEGER REFERENCES voc_receipts(id) ON DELETE SET NULL; -- 마스터 VOC
ALTER TABLE as_receipts DROP CONSTRAINT IF EXISTS as_receipts_source_check;
ALTER TABLE as_receipts ADD CONSTRAINT as_receipts_source_check CHECK (source IN ('MANUAL','SHEET','CHANNELTALK','INTAKE_QUEUE','IMPORT'));
CREATE INDEX IF NOT EXISTS as_receipts_voc_id_idx ON as_receipts (voc_id);
-- 기존 행 출처 1회 백필 (note 태그 기준)
UPDATE as_receipts SET source = 'SHEET'  WHERE source = 'MANUAL' AND note LIKE '%[채널톡 r%';
UPDATE as_receipts SET source = 'IMPORT' WHERE source = 'MANUAL' AND (note LIKE '마스터 AS이력%' OR note LIKE '메디인 AS이력%');

CREATE TABLE IF NOT EXISTS as_intake_links (
  id                   SERIAL PRIMARY KEY,
  chat_id              VARCHAR(40) NOT NULL UNIQUE REFERENCES channeltalk_user_chats(id) ON DELETE CASCADE, -- 멱등 키
  receipt_id           INTEGER REFERENCES as_receipts(id) ON DELETE SET NULL,
  state                VARCHAR(16) NOT NULL DEFAULT 'PENDING', -- PENDING 등록대기 / LINKED 연결됨 / IGNORED AS 아님
  fail_class           VARCHAR(24),  -- NO_CONFIRM / PARSE_INCOMPLETE / HOSPITAL_UNMATCHED / HOSPITAL_CONFLICT / NO_SERIAL / BAD_SERIAL / UNKNOWN_DEVICE / MIXED_CATEGORY / NO_COMPLETION / ALREADY_EXISTS / TX_ABORT / ERROR
  fail_note            TEXT,
  extracted            JSONB,        -- 추출 결과 (AsExtract) — 큐 상세 프리필 원천
  extract_layer        VARCHAR(8) NOT NULL DEFAULT 'NONE', -- L1 / L2 / NONE
  source_message_ids   TEXT[] NOT NULL DEFAULT '{}',
  seen_message_id      VARCHAR(40),  -- 마지막으로 추출에 사용한 메시지 id — 변경 감지 기준
  change_detected_at   TIMESTAMPTZ,
  change_diff          JSONB,
  ai_requested_at      TIMESTAMPTZ,
  ai_requested_by_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_by_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at           TIMESTAMPTZ,
  ignore_reason        VARCHAR(24),  -- IGNORED 사유: PROGRESS / ACCESSORY / DUPLICATE / OTHER
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT as_intake_links_state_check CHECK (state IN ('PENDING','LINKED','IGNORED')),
  CONSTRAINT as_intake_links_layer_check CHECK (extract_layer IN ('L1','L2','NONE'))
);
CREATE INDEX IF NOT EXISTS as_intake_links_state_idx ON as_intake_links (state);
CREATE INDEX IF NOT EXISTS as_intake_links_receipt_id_idx ON as_intake_links (receipt_id);

CREATE TABLE IF NOT EXISTS voc_receipt_types (
  id          SERIAL PRIMARY KEY,
  voc_id      INTEGER NOT NULL REFERENCES voc_receipts(id) ON DELETE CASCADE,
  voc_type_id INTEGER NOT NULL REFERENCES status_codes(id) ON DELETE CASCADE,
  tag         VARCHAR(80), -- 원 채널톡 태그명
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voc_id, voc_type_id)
);
CREATE INDEX IF NOT EXISTS voc_receipt_types_type_idx ON voc_receipt_types (voc_type_id);
-- 기존 VOC의 대표 분류를 복수 분류 테이블에 시드
INSERT INTO voc_receipt_types (voc_id, voc_type_id, tag)
SELECT v.id, v.voc_type_id, sc.value FROM voc_receipts v JOIN status_codes sc ON sc.id = v.voc_type_id
WHERE v.voc_type_id IS NOT NULL ON CONFLICT DO NOTHING;
