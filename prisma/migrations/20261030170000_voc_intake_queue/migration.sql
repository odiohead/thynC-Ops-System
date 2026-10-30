-- VOC 등록대기 큐 + 시트 적재 식별자 (projects/voc_sheet_import_design.md)
ALTER TABLE voc_receipts ADD COLUMN IF NOT EXISTS source_ref VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS voc_receipts_source_ref_key ON voc_receipts (source_ref);

CREATE TABLE IF NOT EXISTS voc_intake_items (
  id             SERIAL PRIMARY KEY,
  source         VARCHAR(16) NOT NULL,                 -- SHEET / CHANNELTALK
  chat_id        VARCHAR(40) UNIQUE REFERENCES channeltalk_user_chats(id) ON DELETE CASCADE,
  source_ref     VARCHAR(40) UNIQUE,                   -- 'sheet:VOC현황_NEW:r1234' (시트 행 멱등 키)
  state          VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  fail_class     VARCHAR(24),                          -- lib/vocIntakeShared.ts VOC_INTAKE_FAIL_LABEL
  fail_note      TEXT,
  draft          JSONB,                                -- 프리필 초안(VocIntakeDraft)
  voc_id         INTEGER REFERENCES voc_receipts(id) ON DELETE SET NULL,
  decided_by_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at     TIMESTAMPTZ,
  ignore_reason  VARCHAR(24),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voc_intake_items_state_check CHECK (state IN ('PENDING','REGISTERED','IGNORED')),
  CONSTRAINT voc_intake_items_source_check CHECK (source IN ('SHEET','CHANNELTALK'))
);
CREATE INDEX IF NOT EXISTS voc_intake_items_state_idx ON voc_intake_items (state);
CREATE INDEX IF NOT EXISTS voc_intake_items_voc_id_idx ON voc_intake_items (voc_id);
