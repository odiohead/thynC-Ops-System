-- CS 티켓 워크플로 (cs_ticket_workflow_design.md) — 콜기록지 원장 + VOC접수 도메인
-- P1: call_logs (콜센터 인바운드 콜 원장 — 티켓 아님, 승격/연결만 티켓 N:1)
-- P2: voc_receipts + voc_receipt_assignees (6번째 도메인 — 연결 티켓 refType 'VOC' = CS 마스터)

CREATE TABLE call_logs (
  id                SERIAL PRIMARY KEY,
  call_code         VARCHAR(20) NOT NULL UNIQUE,
  received_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  direction         TEXT NOT NULL DEFAULT 'IN',
  received_by_id    TEXT NOT NULL REFERENCES users(id),
  hospital_code     TEXT REFERENCES hospitals(hospital_code) ON DELETE SET NULL,
  hospital_name_raw TEXT,
  caller_name       TEXT,
  caller_phone      TEXT,
  inquiry_type_id   INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  content           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'DONE',
  ticket_id         INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP(3) NOT NULL
);

CREATE INDEX call_logs_received_at_idx ON call_logs(received_at);
CREATE INDEX call_logs_hospital_code_idx ON call_logs(hospital_code);
CREATE INDEX call_logs_status_idx ON call_logs(status);
CREATE INDEX call_logs_ticket_id_idx ON call_logs(ticket_id);

CREATE TABLE voc_receipts (
  id                SERIAL PRIMARY KEY,
  voc_code          VARCHAR(20) NOT NULL UNIQUE,
  hospital_code     TEXT REFERENCES hospitals(hospital_code) ON DELETE SET NULL,
  hospital_name_raw TEXT,
  customer_name     TEXT,
  customer_phone    TEXT,
  channel_id        INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  voc_type_id       INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  status_id         INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  status_changed_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  title             TEXT NOT NULL,
  content           TEXT,
  resolution        TEXT,
  received_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at       DATE,
  ticket_id         INTEGER UNIQUE REFERENCES tickets(id) ON DELETE SET NULL,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP(3) NOT NULL
);

CREATE INDEX voc_receipts_received_at_idx ON voc_receipts(received_at);
CREATE INDEX voc_receipts_hospital_code_idx ON voc_receipts(hospital_code);
CREATE INDEX voc_receipts_status_id_idx ON voc_receipts(status_id);

CREATE TABLE voc_receipt_assignees (
  id         SERIAL PRIMARY KEY,
  voc_id     INTEGER NOT NULL REFERENCES voc_receipts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (voc_id, user_id)
);
