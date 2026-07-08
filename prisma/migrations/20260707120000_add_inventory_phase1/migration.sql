-- 자재관리(WMS) Phase 1: 품목 마스터 / 위치(창고) 마스터 / 재고 담당자 풀
-- function_wms.md §4-1, §4-2, §4-6

-- 위치(창고) 마스터
CREATE TABLE "public"."warehouses" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "memo" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warehouses_name_key" ON "public"."warehouses"("name");

-- 품목 마스터
CREATE TABLE "public"."inventory_items" (
    "id" SERIAL NOT NULL,
    "item_code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category_id" INTEGER,
    "spec" VARCHAR(200),
    "unit" VARCHAR(20) NOT NULL DEFAULT 'EA',
    "is_serial_managed" BOOLEAN NOT NULL DEFAULT false,
    "device_info_id" INTEGER,
    "ref_price" INTEGER,
    "safety_stock" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_items_item_code_key" ON "public"."inventory_items"("item_code");
CREATE INDEX "inventory_items_category_id_idx" ON "public"."inventory_items"("category_id");

ALTER TABLE "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "public"."status_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_device_info_id_fkey"
    FOREIGN KEY ("device_info_id") REFERENCES "public"."device_info"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 재고 담당자 풀 (FieldEngineer와 별개 직무)
CREATE TABLE "public"."inventory_managers" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_managers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_managers_user_id_key" ON "public"."inventory_managers"("user_id");
ALTER TABLE "public"."inventory_managers"
    ADD CONSTRAINT "inventory_managers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 품목 분류 시드 (StatusCode category='ITEM_CATEGORY')
INSERT INTO "public"."status_codes" ("name", "order", "color", "category") VALUES
    ('자사기기', 0, '#2563EB', 'ITEM_CATEGORY'),
    ('전자제품', 1, '#7C3AED', 'ITEM_CATEGORY'),
    ('네트워크', 2, '#0891B2', 'ITEM_CATEGORY'),
    ('잡자재', 3, '#6B7280', 'ITEM_CATEGORY')
ON CONFLICT ("name", "category") DO NOTHING;

-- 위치 시드
INSERT INTO "public"."warehouses" ("name", "sort_order") VALUES
    ('본사 창고', 0),
    ('불량/수리 대기', 1)
ON CONFLICT ("name") DO NOTHING;

-- 네비게이션 메뉴: 메인 '자재관리'(기타업무 47과 간트 50 사이) + 설정 하위 3종
INSERT INTO "public"."nav_menu_items" ("menu_key", "label", "href", "icon_key", "parent_key", "allowed_roles", "allowed_org_codes", "is_active", "sort_order") VALUES
    ('inventory', '자재관리', '/inventory', 'package', NULL, '{}', '{SEERS}', true, 48),
    ('settings/warehouses', '창고(위치) 관리', '/settings/warehouses', NULL, 'settings', '{SUPER_ADMIN,ADMIN}', '{}', true, 160),
    ('settings/inventory-managers', '재고 담당자 관리', '/settings/inventory-managers', NULL, 'settings', '{SUPER_ADMIN,ADMIN}', '{}', true, 161),
    ('settings/item-category', '품목 분류 관리', '/settings/item-category', NULL, 'settings', '{SUPER_ADMIN,ADMIN}', '{}', true, 162)
ON CONFLICT ("menu_key") DO NOTHING;
