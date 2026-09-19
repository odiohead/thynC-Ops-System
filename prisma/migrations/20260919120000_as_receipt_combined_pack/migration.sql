-- 합포장 태그 (2026-09-19) — 수동 체크 + 같은 수거 송장번호 접수 발견 시 자동 켬. 정규화 송장 표현식 인덱스는 자동 태그·송장 검색(lib/asReceiptSearch) 공용
ALTER TABLE as_receipts ADD COLUMN IF NOT EXISTS combined_pack BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS as_receipts_pickup_tracking_norm_idx
  ON as_receipts (upper(regexp_replace(coalesce(pickup_tracking_no, ''), '[^0-9A-Za-z]', '', 'g')))
  WHERE pickup_tracking_no IS NOT NULL;
