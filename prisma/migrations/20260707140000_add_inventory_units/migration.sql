-- 자재관리(WMS) Phase 3: 시리얼 개체 + 전표-개체 조인
-- function_wms.md §4-5

-- 시리얼 개체 (품목별 개별 추적)
CREATE TABLE "public"."inventory_units" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "serial_no" VARCHAR(100) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'IN_STOCK',
    "warehouse_id" INTEGER,
    "hospital_code" TEXT,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_units_item_id_serial_no_key" ON "public"."inventory_units"("item_id", "serial_no");
CREATE INDEX "inventory_units_item_id_status_idx" ON "public"."inventory_units"("item_id", "status");
CREATE INDEX "inventory_units_hospital_code_idx" ON "public"."inventory_units"("hospital_code");

ALTER TABLE "public"."inventory_units"
    ADD CONSTRAINT "inventory_units_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_units"
    ADD CONSTRAINT "inventory_units_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_units"
    ADD CONSTRAINT "inventory_units_hospital_code_fkey"
    FOREIGN KEY ("hospital_code") REFERENCES "public"."hospitals"("hospital_code") ON DELETE SET NULL ON UPDATE CASCADE;

-- 전표 ↔ 개체 조인 (개체 이력 산출용)
CREATE TABLE "public"."inventory_transaction_units" (
    "transaction_id" INTEGER NOT NULL,
    "unit_id" INTEGER NOT NULL,
    CONSTRAINT "inventory_transaction_units_pkey" PRIMARY KEY ("transaction_id", "unit_id")
);
CREATE INDEX "inventory_transaction_units_unit_id_idx" ON "public"."inventory_transaction_units"("unit_id");

ALTER TABLE "public"."inventory_transaction_units"
    ADD CONSTRAINT "inventory_transaction_units_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_transaction_units"
    ADD CONSTRAINT "inventory_transaction_units_unit_id_fkey"
    FOREIGN KEY ("unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
