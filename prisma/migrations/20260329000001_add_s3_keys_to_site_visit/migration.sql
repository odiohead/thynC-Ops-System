-- AlterTable
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "install_plan_s3_key" TEXT;
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "floor_plan_s3_key" TEXT;
