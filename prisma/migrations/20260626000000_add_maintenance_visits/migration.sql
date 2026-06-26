-- 유지보수 방문일정: 단일 visit_date → 다건(maintenance_visits) 확장
-- 각 방문 항목은 단일일(start=end) 또는 기간(start~end), 항목별 Google Calendar 이벤트ID 보유

CREATE TABLE "public"."maintenance_visits" (
    "id" SERIAL NOT NULL,
    "maintenance_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "calendar_event_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "maintenance_visits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "maintenance_visits_maintenance_id_idx" ON "public"."maintenance_visits"("maintenance_id");

ALTER TABLE "public"."maintenance_visits"
    ADD CONSTRAINT "maintenance_visits_maintenance_id_fkey"
    FOREIGN KEY ("maintenance_id") REFERENCES "public"."maintenances"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 단일 방문일을 방문 항목 1건으로 이관 (start=end=visit_date), 캘린더 이벤트ID 승계
INSERT INTO "public"."maintenance_visits" ("maintenance_id", "start_date", "end_date", "calendar_event_id", "sort_order")
SELECT "id", "visit_date", "visit_date", "calendar_event_id", 0
FROM "public"."maintenances"
WHERE "visit_date" IS NOT NULL;

-- 이관된 캘린더 이벤트ID는 방문 항목이 소유하므로 유지보수 본체의 중복 참조를 해제
UPDATE "public"."maintenances" SET "calendar_event_id" = NULL WHERE "visit_date" IS NOT NULL;
