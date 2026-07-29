-- 영업/CRM v3 재구성 (projects/sales_crm_design.md v3 — 원점 재검토)
-- 엑셀 이식형 모델 폐기: 테이블 4종 삭제, 프로필·딜 개편, StatusCode 6카테고리 정리
-- (v2 테이블은 전부 0행 상태에서 실행 — 데이터 유실 없음)

DROP TABLE IF EXISTS hospital_daewoong_channels;
DROP TABLE IF EXISTS sales_deal_devices;
DROP TABLE IF EXISTS sales_reps;
DROP TABLE IF EXISTS sales_offices;

ALTER TABLE hospital_sales_profiles
  DROP COLUMN IF EXISTS grade,
  ADD COLUMN stage_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN next_action TEXT,
  ADD COLUMN next_action_date DATE;

ALTER TABLE sales_deals
  DROP COLUMN IF EXISTS hospital_sale_model_id,
  DROP COLUMN IF EXISTS seers_sale_model_id,
  DROP COLUMN IF EXISTS price_type_id,
  DROP COLUMN IF EXISTS settlement_status_id,
  DROP COLUMN IF EXISTS tax_invoice_status_id,
  DROP COLUMN IF EXISTS revenue_recognition_id,
  DROP COLUMN IF EXISTS amount_product,
  DROP COLUMN IF EXISTS amount_construction,
  DROP COLUMN IF EXISTS amount_actual,
  DROP COLUMN IF EXISTS wards_text,
  DROP COLUMN IF EXISTS depts_text,
  DROP COLUMN IF EXISTS first_contact_date,
  DROP COLUMN IF EXISTS delivery_date,
  DROP COLUMN IF EXISTS warranty_months,
  ADD COLUMN status_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  ADD COLUMN intro_type_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL;

-- 폐기 카테고리 코드 삭제 (참조 컬럼은 위에서 제거됨)
DELETE FROM status_codes WHERE category IN
  ('SALES_MODEL_HOSPITAL','SALES_MODEL_SEERS','SALES_PRICE_TYPE',
   'SALES_SETTLEMENT','SALES_TAX_INVOICE','SALES_REVENUE_RECOG');

-- nav: 영업 조직 관리 메뉴 제거
DELETE FROM nav_menu_items WHERE menu_key = 'settings/sales-offices';
