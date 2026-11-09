-- 출고업무 알림 유형별 규칙 (2026-11-09 — projects/stock_out_notify_subtype_design.md)
-- 규칙 조건 축 '도메인 세부 유형'(출고 유형 등) + 멘션 모드 '지정 Assignment Group 멤버'
ALTER TABLE notify_routes ADD COLUMN IF NOT EXISTS sub_types TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE notify_routes ADD COLUMN IF NOT EXISTS mention_queue_id INTEGER REFERENCES ticket_queues(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notify_routes_mention_queue_idx ON notify_routes(mention_queue_id);
