-- 채널톡 시트 X열(완료여부) 역기입 이벤트화 (2026-09-11 — channeltalk_as_intake_design.md §7.1 개정)
-- 마지막으로 시트에 기입한 완료 상태('완료'/'취소'/'미완료'). DB 상태가 이 값과 다를 때만 1회 기입 → 시트 수동 변경을 덮어쓰지 않음
ALTER TABLE as_receipts ADD COLUMN sheet_done_synced TEXT;
