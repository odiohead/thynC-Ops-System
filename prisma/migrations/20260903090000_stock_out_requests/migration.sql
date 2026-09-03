-- 출고업무(출고요청) — projects/stock_out_request_design.md §4 (2026-09-03)
-- stock_out_items(품목 마스터) / stock_out_requests(도메인 레코드, 7번째 티켓 도메인 STOCK_OUT) / stock_out_request_items(품목×수량 라인)

CREATE TABLE stock_out_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  item_group TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stock_out_items_name_key UNIQUE (name),
  CONSTRAINT stock_out_items_group_check CHECK (item_group IN ('SYSTEM','WEARABLE'))
);

CREATE TABLE stock_out_requests (
  id SERIAL PRIMARY KEY,
  sor_code VARCHAR(20) NOT NULL,
  project_code TEXT NOT NULL,
  status_id INTEGER,
  status_changed_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  request_date DATE NOT NULL,
  note TEXT,
  resolved_at DATE,
  created_by_id TEXT,
  ticket_id INTEGER,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stock_out_requests_sor_code_key UNIQUE (sor_code),
  CONSTRAINT stock_out_requests_ticket_id_key UNIQUE (ticket_id),
  CONSTRAINT stock_out_requests_project_code_fkey FOREIGN KEY (project_code) REFERENCES projects(project_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT stock_out_requests_status_id_fkey FOREIGN KEY (status_id) REFERENCES status_codes(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT stock_out_requests_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT stock_out_requests_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX stock_out_requests_project_code_idx ON stock_out_requests(project_code);
CREATE INDEX stock_out_requests_status_id_idx ON stock_out_requests(status_id);
CREATE INDEX stock_out_requests_request_date_idx ON stock_out_requests(request_date);
CREATE INDEX stock_out_requests_created_at_idx ON stock_out_requests(created_at);

CREATE TABLE stock_out_request_items (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  CONSTRAINT stock_out_request_items_qty_check CHECK (quantity > 0),
  CONSTRAINT stock_out_request_items_request_item_key UNIQUE (request_id, item_id),
  CONSTRAINT stock_out_request_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES stock_out_requests(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT stock_out_request_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES stock_out_items(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX stock_out_request_items_item_id_idx ON stock_out_request_items(item_id);
