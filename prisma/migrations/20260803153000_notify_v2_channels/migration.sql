-- 알림 v2 P2·P3 — 그룹·SLA 정책별 알림 채널
ALTER TABLE ticket_queues ADD COLUMN IF NOT EXISTS notify_channel_id INT REFERENCES notify_channels(id) ON DELETE SET NULL;
ALTER TABLE sla_policies ADD COLUMN IF NOT EXISTS notify_channel_id INT REFERENCES notify_channels(id) ON DELETE SET NULL;
