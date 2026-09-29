-- 채널톡 상담 → VOC 승격 (2026-09-28, projects/voc_channeltalk_promotion_design.md)
-- voc_receipts: 출처·자동생성 표시 / voc_channeltalk_chats: VOC 1 : 상담 N 연결(상담은 최대 1 VOC) / channeltalk_user_chats: 수동 제외 표시

ALTER TABLE voc_receipts ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'MANUAL';        -- MANUAL / CHANNELTALK
ALTER TABLE voc_receipts ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT false;         -- 태그 트리거 자동 생성

CREATE TABLE IF NOT EXISTS voc_channeltalk_chats (
  id           SERIAL PRIMARY KEY,
  voc_id       INTEGER NOT NULL REFERENCES voc_receipts(id) ON DELETE CASCADE,
  chat_id      VARCHAR(40) NOT NULL UNIQUE REFERENCES channeltalk_user_chats(id) ON DELETE CASCADE,
  link_reason  VARCHAR(16) NOT NULL,   -- AUTO_TAG(태그 트리거 신규) / AUTO_FOLLOWUP(같은 고객 미종결 VOC에 추가) / MANUAL
  linked_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voc_channeltalk_chats_voc_id_idx ON voc_channeltalk_chats (voc_id);

ALTER TABLE channeltalk_user_chats ADD COLUMN IF NOT EXISTS voc_excluded_at TIMESTAMPTZ;
ALTER TABLE channeltalk_user_chats ADD COLUMN IF NOT EXISTS voc_excluded_by_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE channeltalk_user_chats ADD COLUMN IF NOT EXISTS first_user_message_at TIMESTAMPTZ;      -- 고객 첫 텍스트 발화 시각 (VOC receivedAt 원천)
ALTER TABLE channeltalk_user_chats ADD COLUMN IF NOT EXISTS manager_initiated BOOLEAN NOT NULL DEFAULT false; -- 첫 메시지가 담당자(발송안내 등)
