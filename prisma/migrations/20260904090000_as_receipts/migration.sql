-- AS업무(AS접수) — projects/as_work_design.md §4 (2026-09-04)
-- as_receipts(헤더, 8번째 티켓 도메인 AS) / as_receipt_items(기기 라인 — 라인 단위 결과·부분 발송)

CREATE TABLE as_receipts (
  id SERIAL PRIMARY KEY,
  as_code VARCHAR(20) NOT NULL,
  hospital_code TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'FAULT',
  receipt_date DATE NOT NULL,
  reporter_name TEXT,
  pickup_method TEXT,
  pickup_tracking_no TEXT,
  picked_up_at DATE,
  received_at DATE,
  pre_replace BOOLEAN NOT NULL DEFAULT false,
  dest_type TEXT,
  dest_info TEXT,
  expected_ship_date DATE,
  status_id INTEGER,
  status_changed_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  note TEXT,
  resolved_at DATE,
  created_by_id TEXT,
  ticket_id INTEGER,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT as_receipts_as_code_key UNIQUE (as_code),
  CONSTRAINT as_receipts_ticket_id_key UNIQUE (ticket_id),
  CONSTRAINT as_receipts_category_check CHECK (category IN ('FAULT','LOST')),
  CONSTRAINT as_receipts_pickup_method_check CHECK (pickup_method IS NULL OR pickup_method IN ('PARCEL','VISIT')),
  CONSTRAINT as_receipts_dest_type_check CHECK (dest_type IS NULL OR dest_type IN ('HOSPITAL','OTHER')),
  CONSTRAINT as_receipts_hospital_code_fkey FOREIGN KEY (hospital_code) REFERENCES hospitals(hospital_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT as_receipts_status_id_fkey FOREIGN KEY (status_id) REFERENCES status_codes(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT as_receipts_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT as_receipts_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX as_receipts_hospital_code_idx ON as_receipts(hospital_code);
CREATE INDEX as_receipts_status_id_idx ON as_receipts(status_id);
CREATE INDEX as_receipts_receipt_date_idx ON as_receipts(receipt_date);
CREATE INDEX as_receipts_created_at_idx ON as_receipts(created_at);

CREATE TABLE as_receipt_items (
  id SERIAL PRIMARY KEY,
  receipt_id INTEGER NOT NULL,
  serial_no TEXT NOT NULL,
  device_id INTEGER,
  new_device_id INTEGER,
  device_kind TEXT,
  ward_name TEXT,
  symptom TEXT,
  process_note TEXT,
  outcome TEXT,
  new_serial_no TEXT,
  ship_method TEXT,
  ship_tracking_no TEXT,
  shipped_at DATE,
  CONSTRAINT as_receipt_items_receipt_serial_key UNIQUE (receipt_id, serial_no),
  CONSTRAINT as_receipt_items_outcome_check CHECK (outcome IS NULL OR outcome IN ('REPAIR_RETURN','REPLACE','LOST','CANCELED')),
  CONSTRAINT as_receipt_items_ship_method_check CHECK (ship_method IS NULL OR ship_method IN ('PARCEL','VISIT')),
  CONSTRAINT as_receipt_items_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES as_receipts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT as_receipt_items_device_id_fkey FOREIGN KEY (device_id) REFERENCES device_units(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT as_receipt_items_new_device_id_fkey FOREIGN KEY (new_device_id) REFERENCES device_units(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX as_receipt_items_device_id_idx ON as_receipt_items(device_id);
CREATE INDEX as_receipt_items_new_device_id_idx ON as_receipt_items(new_device_id);
CREATE INDEX as_receipt_items_serial_no_idx ON as_receipt_items(serial_no);
