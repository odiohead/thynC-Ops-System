-- 영업/CRM Phase 1+2 — 병원 영업 프로필·키맨·대웅 채널·딜 원장·디바이스 수량·영업일지
-- (projects/sales_crm_design.md — 순수 추가 DDL)

CREATE TABLE hospital_sales_profiles (
  id SERIAL PRIMARY KEY,
  hospital_code TEXT NOT NULL UNIQUE REFERENCES hospitals(hospital_code) ON DELETE CASCADE,
  total_beds INTEGER,
  total_wards INTEGER,
  grade TEXT,
  sales_memo TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hospital_contacts (
  id SERIAL PRIMARY KEY,
  hospital_code TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  department TEXT,
  phone TEXT,
  email TEXT,
  role_note TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX hospital_contacts_hospital_code_idx ON hospital_contacts(hospital_code);

CREATE TABLE sales_offices (
  id SERIAL PRIMARY KEY,
  division TEXT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales_reps (
  id SERIAL PRIMARY KEY,
  office_id INTEGER REFERENCES sales_offices(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sales_reps_office_id_idx ON sales_reps(office_id);

CREATE TABLE hospital_daewoong_channels (
  id SERIAL PRIMARY KEY,
  hospital_code TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE CASCADE,
  office_id INTEGER REFERENCES sales_offices(id) ON DELETE SET NULL,
  rep_id INTEGER REFERENCES sales_reps(id) ON DELETE SET NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX hospital_daewoong_channels_hospital_code_idx ON hospital_daewoong_channels(hospital_code);

CREATE TABLE sales_deals (
  id SERIAL PRIMARY KEY,
  deal_code TEXT NOT NULL UNIQUE,
  hospital_code TEXT NOT NULL REFERENCES hospitals(hospital_code),
  round_no INTEGER NOT NULL,
  project_code TEXT UNIQUE REFERENCES projects(project_code) ON DELETE SET NULL,
  hospital_sale_model_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  seers_sale_model_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  ward_count INTEGER,
  bed_count INTEGER,
  wards_text TEXT,
  depts_text TEXT,
  amount_product BIGINT,
  amount_construction BIGINT,
  amount_total BIGINT,
  amount_service BIGINT,
  amount_actual BIGINT,
  price_type_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  first_contact_date DATE,
  contract_date DATE,
  delivery_date DATE,
  warranty_months INTEGER,
  settlement_status_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  tax_invoice_status_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  revenue_recognition_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  remark TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_deals_hospital_code_round_no_key UNIQUE (hospital_code, round_no)
);
CREATE INDEX sales_deals_hospital_code_idx ON sales_deals(hospital_code);

CREATE TABLE sales_deal_devices (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES sales_deals(id) ON DELETE CASCADE,
  device_info_id INTEGER NOT NULL REFERENCES device_info(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_price BIGINT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_deal_devices_deal_id_device_info_id_key UNIQUE (deal_id, device_info_id)
);

CREATE TABLE sales_activities (
  id SERIAL PRIMARY KEY,
  hospital_code TEXT NOT NULL REFERENCES hospitals(hospital_code) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  activity_type_id INTEGER REFERENCES status_codes(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  deal_id INTEGER REFERENCES sales_deals(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sales_activities_hospital_code_activity_date_idx ON sales_activities(hospital_code, activity_date DESC);
