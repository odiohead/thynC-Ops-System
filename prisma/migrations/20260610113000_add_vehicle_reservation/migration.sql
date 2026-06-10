-- 차량예약시스템: vehicles + vehicle_reservations
-- EXCLUDE 제약(더블부킹 DB 안전망)용 확장 — 슈퍼유저 권한 필요할 수 있음
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateTable
CREATE TABLE "public"."vehicles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "model" TEXT,
    "seat_count" INTEGER,
    "color" TEXT,
    "memo" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "public"."vehicles"("plate_number");

-- CreateTable
CREATE TABLE "public"."vehicle_reservations" (
    "id" SERIAL NOT NULL,
    "vehicle_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_reservations_vehicle_id_start_at_idx" ON "public"."vehicle_reservations"("vehicle_id", "start_at");
CREATE INDEX "vehicle_reservations_user_id_start_at_idx" ON "public"."vehicle_reservations"("user_id", "start_at");

-- AddForeignKey
ALTER TABLE "public"."vehicle_reservations" ADD CONSTRAINT "vehicle_reservations_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."vehicle_reservations" ADD CONSTRAINT "vehicle_reservations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 더블부킹 방지 DB 안전망: 같은 차량의 RESERVED 예약끼리 시간 구간 겹침 금지
-- (앱 레벨 검사와 이중. 컬럼이 timestamp without time zone이므로 tsrange 사용)
ALTER TABLE "public"."vehicle_reservations" ADD CONSTRAINT "vehicle_reservations_no_overlap"
    EXCLUDE USING gist ("vehicle_id" WITH =, tsrange("start_at", "end_at") WITH &&)
    WHERE ("status" = 'RESERVED');
