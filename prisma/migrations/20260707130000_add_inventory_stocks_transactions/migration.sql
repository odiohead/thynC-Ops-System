-- 자재관리(WMS) Phase 2: 현재고 스냅샷 + 입출고 원장
-- function_wms.md §4-3, §4-4

-- 현재고 스냅샷 (품목 × 위치). 전표 처리와 같은 트랜잭션에서 증감, CHECK가 음수 최종 방어선
CREATE TABLE "public"."inventory_stocks" (
    "item_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_stocks_pkey" PRIMARY KEY ("item_id", "warehouse_id"),
    CONSTRAINT "inventory_stocks_quantity_check" CHECK ("quantity" >= 0)
);
ALTER TABLE "public"."inventory_stocks"
    ADD CONSTRAINT "inventory_stocks_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_stocks"
    ADD CONSTRAINT "inventory_stocks_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON UPDATE CASCADE;

-- 입출고 원장 (append-only + 취소 마킹)
CREATE TABLE "public"."inventory_transactions" (
    "id" SERIAL NOT NULL,
    "tx_code" VARCHAR(20) NOT NULL,
    "tx_type" VARCHAR(10) NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "item_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "to_warehouse_id" INTEGER,
    "quantity" INTEGER NOT NULL,
    "hospital_code" TEXT,
    "work_type" VARCHAR(20),
    "ref_code" VARCHAR(50),
    "note" TEXT,
    "actor_id" TEXT NOT NULL,
    "canceled_at" TIMESTAMP(3),
    "canceled_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_transactions_quantity_check" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "inventory_transactions_tx_code_key" ON "public"."inventory_transactions"("tx_code");
CREATE INDEX "inventory_transactions_item_id_created_at_idx" ON "public"."inventory_transactions"("item_id", "created_at" DESC);
CREATE INDEX "inventory_transactions_hospital_code_idx" ON "public"."inventory_transactions"("hospital_code");
CREATE INDEX "inventory_transactions_work_type_ref_code_idx" ON "public"."inventory_transactions"("work_type", "ref_code");
CREATE INDEX "inventory_transactions_created_at_idx" ON "public"."inventory_transactions"("created_at" DESC);

ALTER TABLE "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_to_warehouse_id_fkey"
    FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_hospital_code_fkey"
    FOREIGN KEY ("hospital_code") REFERENCES "public"."hospitals"("hospital_code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE;
ALTER TABLE "public"."inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_canceled_by_id_fkey"
    FOREIGN KEY ("canceled_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
