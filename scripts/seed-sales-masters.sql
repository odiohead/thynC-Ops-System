-- 영업/CRM 마스터 시드 (idempotent — 재실행 안전, 기존 행 무변경)
-- StatusCode 카테고리 7종 + nav 메뉴 2행 (projects/sales_crm_design.md)
-- 실행: npx prisma db execute --file scripts/seed-sales-masters.sql

-- 병원 판매모델
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('구축형', 'SALES_MODEL_HOSPITAL', 1, now()),
  ('구독형', 'SALES_MODEL_HOSPITAL', 2, now()),
  ('분납형', 'SALES_MODEL_HOSPITAL', 3, now()),
  ('사용량비례형', 'SALES_MODEL_HOSPITAL', 4, now())
ON CONFLICT (name, category) DO NOTHING;

-- 씨어스 판매방식
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('구축형', 'SALES_MODEL_SEERS', 1, now()),
  ('구독형', 'SALES_MODEL_SEERS', 2, now())
ON CONFLICT (name, category) DO NOTHING;

-- 판매가 유형
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('기존판매가', 'SALES_PRICE_TYPE', 1, now()),
  ('권장판매가', 'SALES_PRICE_TYPE', 2, now()),
  ('최소판매가', 'SALES_PRICE_TYPE', 3, now()),
  ('사용량비례형', 'SALES_PRICE_TYPE', 4, now()),
  ('미정', 'SALES_PRICE_TYPE', 5, now())
ON CONFLICT (name, category) DO NOTHING;

-- 정산 상태
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('미정산', 'SALES_SETTLEMENT', 1, now()),
  ('진행중', 'SALES_SETTLEMENT', 2, now()),
  ('완료', 'SALES_SETTLEMENT', 3, now())
ON CONFLICT (name, category) DO NOTHING;

-- 세금계산서 발행
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('미발행', 'SALES_TAX_INVOICE', 1, now()),
  ('완료', 'SALES_TAX_INVOICE', 2, now()),
  ('씨어스 계약', 'SALES_TAX_INVOICE', 3, now())
ON CONFLICT (name, category) DO NOTHING;

-- 매출 인식
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('수금시작', 'SALES_REVENUE_RECOG', 1, now()),
  ('입금완료', 'SALES_REVENUE_RECOG', 2, now()),
  ('수금완료', 'SALES_REVENUE_RECOG', 3, now())
ON CONFLICT (name, category) DO NOTHING;

-- 영업 활동 유형
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('방문', 'SALES_ACTIVITY_TYPE', 1, now()),
  ('전화', 'SALES_ACTIVITY_TYPE', 2, now()),
  ('메일', 'SALES_ACTIVITY_TYPE', 3, now()),
  ('데모/시연', 'SALES_ACTIVITY_TYPE', 4, now()),
  ('기타', 'SALES_ACTIVITY_TYPE', 5, now())
ON CONFLICT (name, category) DO NOTHING;

-- nav: 설정 하위 '영업' 그룹
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, group_label, allowed_roles, sort_order, is_active)
VALUES
  ('settings/sales-offices', '영업 조직 관리', '/settings/sales-offices', 'settings', '영업', '{SUPER_ADMIN,ADMIN}', 60, true),
  ('settings/sales-codes', '영업 코드 관리', '/settings/sales-codes', 'settings', '영업', '{SUPER_ADMIN,ADMIN}', 61, true)
ON CONFLICT (menu_key) DO NOTHING;

-- 확인
SELECT category, count(*) FROM status_codes WHERE category LIKE 'SALES_%' GROUP BY category ORDER BY category;
