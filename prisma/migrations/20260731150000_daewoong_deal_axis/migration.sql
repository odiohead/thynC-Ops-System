-- 대웅 축 필드 분리 (2026-07-31) — thynC_status_DW.xlsx(대웅 원장) 기반 딜 재적재 대비
-- DW 원장: 거래처코드·카운팅/오더구분·판매모델2·디바이스수·계약금액(총견적가)·공사일
-- 구파일(thynC_status.xlsx) 보강: 제품가·공사비·실판매액·세금계산서·정산(원문 텍스트)
-- 기존 amount_service·price_type_text는 대웅 값이었으므로 대웅 필드로 개명 (전 환경 0행 시점)
ALTER TABLE sales_deals
  ADD COLUMN IF NOT EXISTS daewoong_client_code TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_count_type TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_order_status TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_model_kind TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_model TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_device_count INTEGER,
  ADD COLUMN IF NOT EXISTS daewoong_amount_total BIGINT,
  ADD COLUMN IF NOT EXISTS daewoong_build_date DATE,
  ADD COLUMN IF NOT EXISTS daewoong_amount_product BIGINT,
  ADD COLUMN IF NOT EXISTS daewoong_amount_construction BIGINT,
  ADD COLUMN IF NOT EXISTS daewoong_amount_actual BIGINT,
  ADD COLUMN IF NOT EXISTS daewoong_tax_invoice TEXT,
  ADD COLUMN IF NOT EXISTS daewoong_settlement TEXT;
ALTER TABLE sales_deals RENAME COLUMN amount_service TO daewoong_amount_service;
ALTER TABLE sales_deals RENAME COLUMN price_type_text TO daewoong_price_type;

COMMENT ON COLUMN sales_deals.daewoong_client_code IS '대웅 거래처코드 (DW 원장 매핑 키)';
COMMENT ON COLUMN sales_deals.daewoong_count_type IS '대웅 카운팅 구분 (병원/추가/로컬/이슈 — 원본 보존)';
COMMENT ON COLUMN sales_deals.daewoong_order_status IS '대웅 오더 구분 (완료/미완료)';
COMMENT ON COLUMN sales_deals.daewoong_model_kind IS '대웅 판매모델 구분 (일반/사용량)';
COMMENT ON COLUMN sales_deals.daewoong_model IS '대웅 판매모델 (구독형/구축형/분납형/사용량/씨어스 월 납입)';
COMMENT ON COLUMN sales_deals.daewoong_device_count IS '대웅 디바이스수';
COMMENT ON COLUMN sales_deals.daewoong_amount_total IS '대웅 계약금액(총견적가) 원';
COMMENT ON COLUMN sales_deals.daewoong_build_date IS '대웅 공사일 (원장 정렬기준)';
COMMENT ON COLUMN sales_deals.daewoong_amount_product IS '대웅 제품(구성품) 금액 원 (구파일)';
COMMENT ON COLUMN sales_deals.daewoong_amount_construction IS '대웅 공사비 원 (구파일)';
COMMENT ON COLUMN sales_deals.daewoong_amount_actual IS '대웅 실판매액 원 (구파일)';
COMMENT ON COLUMN sales_deals.daewoong_tax_invoice IS '대웅 세금계산서 발행 (구파일 원문)';
COMMENT ON COLUMN sales_deals.daewoong_settlement IS '대웅 정산 상태 (구파일 원문)';
