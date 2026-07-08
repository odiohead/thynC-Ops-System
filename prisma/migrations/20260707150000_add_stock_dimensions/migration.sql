-- 자재관리(WMS) Phase 7: 재고 구분 2차원 (소유 × 용도)
-- function_wms.md §4-8. 재고 = 품목 × 위치 × 소유 × 용도. 구분 간 전환 없음.

-- 구분 마스터 시드 (StatusCode)
INSERT INTO "public"."status_codes" ("name", "order", "color", "category") VALUES
    ('씨어스 재고', 0, '#3B82F6', 'STOCK_OWNER'),
    ('대웅제약 재고', 1, '#F59E0B', 'STOCK_OWNER'),
    ('판매용', 0, '#10B981', 'STOCK_PURPOSE'),
    ('평가용', 1, '#8B5CF6', 'STOCK_PURPOSE'),
    ('기타', 2, '#6B7280', 'STOCK_PURPOSE')
ON CONFLICT ("name", "category") DO NOTHING;

-- inventory_stocks: 컬럼 추가 → 백필(씨어스 재고, 기타) → NOT NULL → PK 재구성
ALTER TABLE "public"."inventory_stocks"
    ADD COLUMN "owner_id" INTEGER,
    ADD COLUMN "purpose_id" INTEGER;
UPDATE "public"."inventory_stocks" SET
    "owner_id"   = (SELECT id FROM "public"."status_codes" WHERE category = 'STOCK_OWNER'   AND name = '씨어스 재고'),
    "purpose_id" = (SELECT id FROM "public"."status_codes" WHERE category = 'STOCK_PURPOSE' AND name = '기타');
ALTER TABLE "public"."inventory_stocks"
    ALTER COLUMN "owner_id" SET NOT NULL,
    ALTER COLUMN "purpose_id" SET NOT NULL;
ALTER TABLE "public"."inventory_stocks" DROP CONSTRAINT "inventory_stocks_pkey";
ALTER TABLE "public"."inventory_stocks"
    ADD CONSTRAINT "inventory_stocks_pkey" PRIMARY KEY ("item_id", "warehouse_id", "owner_id", "purpose_id");
ALTER TABLE "public"."inventory_stocks"
    ADD CONSTRAINT "inventory_stocks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."status_codes"("id") ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_stocks"
    ADD CONSTRAINT "inventory_stocks_purpose_id_fkey" FOREIGN KEY ("purpose_id") REFERENCES "public"."status_codes"("id") ON UPDATE CASCADE;

-- inventory_transactions
ALTER TABLE "public"."inventory_transactions"
    ADD COLUMN "owner_id" INTEGER,
    ADD COLUMN "purpose_id" INTEGER;
UPDATE "public"."inventory_transactions" SET
    "owner_id"   = (SELECT id FROM "public"."status_codes" WHERE category = 'STOCK_OWNER'   AND name = '씨어스 재고'),
    "purpose_id" = (SELECT id FROM "public"."status_codes" WHERE category = 'STOCK_PURPOSE' AND name = '기타');
ALTER TABLE "public"."inventory_transactions"
    ALTER COLUMN "owner_id" SET NOT NULL,
    ALTER COLUMN "purpose_id" SET NOT NULL;
ALTER TABLE "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."status_codes"("id") ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_purpose_id_fkey" FOREIGN KEY ("purpose_id") REFERENCES "public"."status_codes"("id") ON UPDATE CASCADE;

-- inventory_units
ALTER TABLE "public"."inventory_units"
    ADD COLUMN "owner_id" INTEGER,
    ADD COLUMN "purpose_id" INTEGER;
UPDATE "public"."inventory_units" SET
    "owner_id"   = (SELECT id FROM "public"."status_codes" WHERE category = 'STOCK_OWNER'   AND name = '씨어스 재고'),
    "purpose_id" = (SELECT id FROM "public"."status_codes" WHERE category = 'STOCK_PURPOSE' AND name = '기타');
ALTER TABLE "public"."inventory_units"
    ALTER COLUMN "owner_id" SET NOT NULL,
    ALTER COLUMN "purpose_id" SET NOT NULL;
ALTER TABLE "public"."inventory_units"
    ADD CONSTRAINT "inventory_units_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."status_codes"("id") ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_units"
    ADD CONSTRAINT "inventory_units_purpose_id_fkey" FOREIGN KEY ("purpose_id") REFERENCES "public"."status_codes"("id") ON UPDATE CASCADE;

-- 네비: 재고 구분 관리 설정 페이지
INSERT INTO "public"."nav_menu_items" ("menu_key", "label", "href", "icon_key", "parent_key", "allowed_roles", "allowed_org_codes", "is_active", "sort_order") VALUES
    ('settings/stock-types', '재고 구분 관리', '/settings/stock-types', NULL, 'settings', '{SUPER_ADMIN,ADMIN}', '{}', true, 163)
ON CONFLICT ("menu_key") DO NOTHING;
