-- 알림 v2 P1 — 변경 감지 시그니처를 notification_logs에서 tickets 컬럼으로 이전 (F6)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS notify_sig TEXT;

-- 기존 티켓 백필: 현재 상태로 기준선 확보 (첫 변경 알림 누락 방지)
UPDATE tickets
SET notify_sig = 'v2|' || status::text || '|' || COALESCE(owner_id, '') || '|' || severity::text || '|' || queue_id::text
WHERE notify_sig IS NULL;
