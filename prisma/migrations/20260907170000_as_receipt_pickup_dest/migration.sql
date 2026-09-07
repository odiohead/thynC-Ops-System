-- AS접수 회수지 필드 (CX 확인사항 #13/#6 — 2026-09-07)
-- 채널톡 인입 시 발송지와 동일 자동 기재, '회수지 상이' 체크 시 별도 수정
ALTER TABLE as_receipts
  ADD COLUMN pickup_dest_differs boolean NOT NULL DEFAULT false,
  ADD COLUMN pickup_dest_info text;
