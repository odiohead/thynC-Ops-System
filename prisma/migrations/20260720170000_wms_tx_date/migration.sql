-- 자재관리 — 전표 입출고일(tx_date) 추가 (2026-07-20)
-- 시스템 처리시각(created_at)과 별개의 업무 기준일. 소급 등록 지원. 기존 전표는 created_at의 KST 날짜로 백필
ALTER TABLE inventory_transactions ADD COLUMN tx_date DATE NOT NULL DEFAULT CURRENT_DATE;
UPDATE inventory_transactions SET tx_date = (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date;
