-- AS 라인 '회수기기 처리' 3택 (2026-11-02): 수리완료 체크박스 → 수리(REPAIRED) / 문제없음(NO_FAULT) / 폐기(SCRAPPED)
-- repaired_at/by 는 세 값 공통의 처리일·처리자로 쓴다. 처리값이 있으면 처리일도 있다(CHECK) — 모든 쓰기 경로 정합 강제
ALTER TABLE as_receipt_items ADD COLUMN IF NOT EXISTS repair_result VARCHAR(16);

-- 백필 ① 기존 수리완료 체크 라인 → 수리
UPDATE as_receipt_items SET repair_result = 'REPAIRED' WHERE repaired_at IS NOT NULL AND repair_result IS NULL;

-- 백필 ② 이 접수(ref AS)로 폐기된 기기의 라인 → 폐기 + 처리일·처리자 = 폐기 이벤트
UPDATE as_receipt_items i
SET repair_result = 'SCRAPPED', repaired_at = s.occurred_on, repaired_by_id = s.actor_id
FROM (
  SELECT DISTINCT ON (it.id) it.id AS item_id, ev.occurred_on, ev.actor_id
  FROM as_receipt_items it
  JOIN as_receipts r ON r.id = it.receipt_id
  JOIN device_units du ON du.id = it.device_id AND du.condition = 'SCRAPPED'
  JOIN hospital_device_events ev ON ev.device_id = it.device_id AND ev.event_type = 'SCRAP' AND ev.ref_type = 'AS' AND ev.ref_code = r.as_code
  ORDER BY it.id, ev.id DESC
) s
WHERE i.id = s.item_id;

ALTER TABLE as_receipt_items DROP CONSTRAINT IF EXISTS as_receipt_items_repair_result_check;
ALTER TABLE as_receipt_items ADD CONSTRAINT as_receipt_items_repair_result_check
  CHECK (repair_result IS NULL OR repair_result IN ('REPAIRED', 'NO_FAULT', 'SCRAPPED'));
ALTER TABLE as_receipt_items DROP CONSTRAINT IF EXISTS as_receipt_items_repair_result_date_check;
ALTER TABLE as_receipt_items ADD CONSTRAINT as_receipt_items_repair_result_date_check
  CHECK ((repair_result IS NULL) = (repaired_at IS NULL));
