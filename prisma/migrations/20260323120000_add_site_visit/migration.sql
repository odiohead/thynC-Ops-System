-- 1. status_codes: category 컬럼 추가 (기존 데이터는 HOSPITAL)
ALTER TABLE "status_codes" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'HOSPITAL';

-- 2. status_codes: 기존 name unique 제약 제거
ALTER TABLE "status_codes" DROP CONSTRAINT IF EXISTS "status_codes_name_key";

-- 3. status_codes: (name, category) 복합 unique 추가
ALTER TABLE "status_codes" ADD CONSTRAINT "status_codes_name_category_key" UNIQUE ("name", "category");

-- 4. site_visits 테이블 생성
CREATE TABLE "site_visits" (
    "id"                   SERIAL       NOT NULL,
    "hospital_code"        TEXT         NOT NULL,
    "daewoong_staff_id"    TEXT,
    "assignee_id"          TEXT,
    "request_date"         TIMESTAMP(3),
    "visit_date"           TIMESTAMP(3),
    "reply_date"           TIMESTAMP(3),
    "status_id"            INTEGER,
    "install_plan_url"     TEXT,
    "install_plan_file_id" TEXT,
    "floor_plan_url"       TEXT,
    "floor_plan_file_id"   TEXT,
    "notes"                TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_visits_pkey" PRIMARY KEY ("id")
);

-- 5. FK 제약 추가
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_hospital_code_fkey"
    FOREIGN KEY ("hospital_code") REFERENCES "hospitals"("hospital_code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_daewoong_staff_id_fkey"
    FOREIGN KEY ("daewoong_staff_id") REFERENCES "daewoong_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_assignee_id_fkey"
    FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_status_id_fkey"
    FOREIGN KEY ("status_id") REFERENCES "status_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
