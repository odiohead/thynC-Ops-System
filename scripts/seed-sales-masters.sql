-- 영업/CRM 마스터 시드 v4 (idempotent — 재실행 안전, 기존 행 무변경)
-- StatusCode 7카테고리 + nav (projects/sales_crm_design.md v4 §3.5)
-- 실행: npx prisma db execute --file scripts/seed-sales-masters.sql

-- 영업 단계 (파이프라인)
INSERT INTO status_codes (name, category, "order", color, created_at) VALUES
  ('리드',        'SALES_STAGE', 1, '#94a3b8', now()),
  ('접촉·상담',   'SALES_STAGE', 2, '#60a5fa', now()),
  ('제안·견적',   'SALES_STAGE', 3, '#a78bfa', now()),
  ('계약 진행',   'SALES_STAGE', 4, '#fbbf24', now()),
  ('도입·운영중', 'SALES_STAGE', 5, '#34d399', now()),
  ('확장 협의',   'SALES_STAGE', 6, '#2dd4bf', now()),
  ('보류·중단',   'SALES_STAGE', 7, '#f87171', now())
ON CONFLICT (name, category) DO NOTHING;

-- 딜(계약 건) 상태
INSERT INTO status_codes (name, category, "order", color, created_at) VALUES
  ('영업중',    'SALES_DEAL_STATUS', 1, '#fbbf24', now()),
  ('계약완료',  'SALES_DEAL_STATUS', 2, '#34d399', now()),
  ('해지·중단', 'SALES_DEAL_STATUS', 3, '#94a3b8', now())
ON CONFLICT (name, category) DO NOTHING;

-- 영업 활동 유형
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('방문',      'SALES_ACTIVITY_TYPE', 1, now()),
  ('전화',      'SALES_ACTIVITY_TYPE', 2, now()),
  ('메일',      'SALES_ACTIVITY_TYPE', 3, now()),
  ('데모/시연', 'SALES_ACTIVITY_TYPE', 4, now()),
  ('기타',      'SALES_ACTIVITY_TYPE', 5, now())
ON CONFLICT (name, category) DO NOTHING;

-- 직군 (인적정보)
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('의사', 'PERSON_GROUP', 1, now()),
  ('간호', 'PERSON_GROUP', 2, now()),
  ('의공', 'PERSON_GROUP', 3, now()),
  ('전산', 'PERSON_GROUP', 4, now()),
  ('구매', 'PERSON_GROUP', 5, now()),
  ('원무', 'PERSON_GROUP', 6, now()),
  ('기타', 'PERSON_GROUP', 7, now())
ON CONFLICT (name, category) DO NOTHING;

-- 판매모델 (병원/씨어스 관점 공용 단일 마스터)
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('구축형',       'SALES_MODEL', 1, now()),
  ('구독형',       'SALES_MODEL', 2, now()),
  ('분납형',       'SALES_MODEL', 3, now()),
  ('사용량비례형', 'SALES_MODEL', 4, now())
ON CONFLICT (name, category) DO NOTHING;

-- 세금계산서 발행
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('미발행',      'SALES_TAX_INVOICE', 1, now()),
  ('발행완료',    'SALES_TAX_INVOICE', 2, now()),
  ('씨어스 계약', 'SALES_TAX_INVOICE', 3, now())
ON CONFLICT (name, category) DO NOTHING;

-- 정산 상태
INSERT INTO status_codes (name, category, "order", created_at) VALUES
  ('미정산', 'SALES_SETTLEMENT', 1, now()),
  ('진행중', 'SALES_SETTLEMENT', 2, now()),
  ('완료',   'SALES_SETTLEMENT', 3, now())
ON CONFLICT (name, category) DO NOTHING;

-- nav: 설정 하위 '영업' 그룹 + 도입 현황 목록(P3)
INSERT INTO nav_menu_items (menu_key, label, href, parent_key, group_label, allowed_roles, sort_order, is_active, icon_key)
VALUES
  ('settings/sales-codes', '영업 코드 관리', '/settings/sales-codes', 'settings', '영업', '{SUPER_ADMIN}', 60, true, NULL),
  ('sales', '영업현황', '/sales', NULL, NULL, '{SUPER_ADMIN}', 21, true, 'trending-up')
ON CONFLICT (menu_key) DO NOTHING;

-- 확인
SELECT category, count(*) FROM status_codes WHERE category LIKE 'SALES_%' OR category = 'PERSON_GROUP' GROUP BY category ORDER BY category;
