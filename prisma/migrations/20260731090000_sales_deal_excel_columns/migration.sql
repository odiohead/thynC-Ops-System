-- 딜 입력 전용 페이지(/sales/deals) — 엑셀(thynC_status.xlsx) B~AK 중 v4 미반영 컬럼 신설 (2026-07-31)
-- 보증기간·최초 인입일·용역매출·판매가 유형·대웅 영업조직 4종. 운영 축 조인 컬럼(답사·공사·교육일 등)은 기존대로 저장 안 함
ALTER TABLE sales_deals
  ADD COLUMN IF NOT EXISTS warranty_text TEXT,
  ADD COLUMN IF NOT EXISTS first_contact_date DATE,
  ADD COLUMN IF NOT EXISTS amount_service BIGINT,
  ADD COLUMN IF NOT EXISTS price_type_text TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_division TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_office TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_manager TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_phone TEXT;

COMMENT ON COLUMN sales_deals.warranty_text IS '보증기간 (엑셀 J열)';
COMMENT ON COLUMN sales_deals.first_contact_date IS '최초 인입일 (엑셀 R열)';
COMMENT ON COLUMN sales_deals.amount_service IS '용역매출 원 (엑셀 AB열)';
COMMENT ON COLUMN sales_deals.price_type_text IS '판매가 유형 (엑셀 AE열 — 기존/권장/최소판매가 등)';
COMMENT ON COLUMN sales_deals.daewoong_division IS '대웅 사업부 (엑셀 AG열)';
COMMENT ON COLUMN sales_deals.daewoong_office IS '대웅 사무소 (엑셀 AH열)';
COMMENT ON COLUMN sales_deals.daewoong_manager IS '대웅 담당자 (엑셀 AI열)';
COMMENT ON COLUMN sales_deals.daewoong_phone IS '대웅 담당자 연락처 (엑셀 AJ열)';
