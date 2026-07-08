-- 자재관리(WMS) Phase 8: 계층형 분류(대>중>소) + 제조사
-- function_wms.md §4-9. 기존 StatusCode ITEM_CATEGORY → inventory_categories 대분류로 이관.

CREATE TABLE "public"."inventory_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "parent_id" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "public"."inventory_categories"
    ADD CONSTRAINT "inventory_categories_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "public"."inventory_categories"("id") ON UPDATE CASCADE;
-- 같은 부모 아래 중복명 방지 (대분류는 parent NULL끼리)
CREATE UNIQUE INDEX "inventory_categories_parent_name_key" ON "public"."inventory_categories" (COALESCE("parent_id", 0), "name");
CREATE INDEX "inventory_categories_parent_id_idx" ON "public"."inventory_categories"("parent_id");

-- 기존 단일 분류(StatusCode ITEM_CATEGORY) → 대분류로 이관
INSERT INTO "public"."inventory_categories" ("name", "sort_order")
SELECT "name", "order" FROM "public"."status_codes" WHERE "category" = 'ITEM_CATEGORY' ORDER BY "order";

-- 품목 FK 교체: status_codes → inventory_categories (이름 매칭으로 id 리매핑)
ALTER TABLE "public"."inventory_items" DROP CONSTRAINT "inventory_items_category_id_fkey";
UPDATE "public"."inventory_items" i
SET "category_id" = c."id"
FROM "public"."status_codes" s
JOIN "public"."inventory_categories" c ON c."name" = s."name" AND c."parent_id" IS NULL
WHERE i."category_id" = s."id" AND s."category" = 'ITEM_CATEGORY';
ALTER TABLE "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 이관 완료된 구 StatusCode 행 제거
DELETE FROM "public"."status_codes" WHERE "category" = 'ITEM_CATEGORY';

-- 제조사 (StatusCode MANUFACTURER — 시드 없음, 설정에서 등록)
ALTER TABLE "public"."inventory_items" ADD COLUMN "manufacturer_id" INTEGER;
ALTER TABLE "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_manufacturer_id_fkey"
    FOREIGN KEY ("manufacturer_id") REFERENCES "public"."status_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 네비: 제조사 관리 설정 페이지
INSERT INTO "public"."nav_menu_items" ("menu_key", "label", "href", "icon_key", "parent_key", "allowed_roles", "allowed_org_codes", "is_active", "sort_order") VALUES
    ('settings/manufacturers', '제조사 관리', '/settings/manufacturers', NULL, 'settings', '{SUPER_ADMIN,ADMIN}', '{}', true, 164)
ON CONFLICT ("menu_key") DO NOTHING;
