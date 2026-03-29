-- AlterTable: hira_hospitals에 누락된 컬럼 추가
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "homepage" TEXT;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "mdept_gdr_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "mdept_intn_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "mdept_resdnt_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "mdept_sdr_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "dety_gdr_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "dety_intn_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "dety_resdnt_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "dety_sdr_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "cmdc_gdr_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "cmdc_intn_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "cmdc_resdnt_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "cmdc_sdr_cnt" INTEGER;
ALTER TABLE "hira_hospitals" ADD COLUMN IF NOT EXISTS "midwife_cnt" INTEGER;
