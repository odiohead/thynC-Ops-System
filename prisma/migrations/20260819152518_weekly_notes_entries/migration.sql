-- 주간 특이사항 보드 전환 (2026-08-19) — 주차당 1건 리뷰 메모 → 주차별 N건 특이사항 엔트리
-- (weekly_ops_design.md §6a 개정 — 엄격한 관리 항목이 아닌 '그 주에 말할 컨텐츠' 수용처)

ALTER TABLE weekly_week_notes DROP CONSTRAINT weekly_week_notes_week_start_key;
CREATE INDEX weekly_week_notes_week_start_idx ON weekly_week_notes(week_start);
ALTER TABLE weekly_week_notes ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
