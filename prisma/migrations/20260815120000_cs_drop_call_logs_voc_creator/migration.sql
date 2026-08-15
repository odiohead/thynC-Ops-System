-- CS 워크플로 수정 (2026-08-15 사용자 결정 — cs_ticket_workflow_design.md 개정)
-- 1) 콜기록 기능 제거: 콜센터 원장 불요 — CS 접수는 VOC 직접 등록으로 시작
-- 2) VOC 담당자 지정 제거: 배정은 티켓이 단독 소유, 도메인에는 생성자만 기록

DROP TABLE IF EXISTS call_logs;
DROP TABLE IF EXISTS voc_receipt_assignees;

ALTER TABLE voc_receipts ADD COLUMN created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- 콜기록 마스터·nav 정리
DELETE FROM status_codes WHERE category = 'CALL_INQUIRY_TYPE';
DELETE FROM nav_menu_items WHERE menu_key IN ('call-logs', 'settings/call-inquiry-type');
