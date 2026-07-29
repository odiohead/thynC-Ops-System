-- 영업/CRM v4 P2 — 차수 축: 딜 확장 + 운영 축 교육일 (sales_crm_design.md v4 §3.3~3.4)
-- sales_deals는 0행 상태에서 실행 — 데이터 유실 없음

ALTER TABLE sales_deals
  DROP COLUMN IF EXISTS intro_type_id,
  DROP COLUMN IF EXISTS amount_total,
  DROP COLUMN IF EXISTS amount_service,
  ADD COLUMN wards_text TEXT,
  ADD COLUMN depts_text TEXT,
  ADD COLUMN hospital_model_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  ADD COLUMN seers_model_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  ADD COLUMN amount_product BIGINT,
  ADD COLUMN amount_construction BIGINT,
  ADD COLUMN amount_actual BIGINT,
  ADD COLUMN tax_invoice_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  ADD COLUMN settlement_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL;

-- 운영 축: 교육일 (프로젝트)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS education_date TIMESTAMP(3);
