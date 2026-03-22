-- AlterTable: rename name column and add hospital_name column
ALTER TABLE "hospitals" RENAME COLUMN "name" TO "hira_hospital_name";
ALTER TABLE "hospitals" ADD COLUMN "hospital_name" TEXT NOT NULL DEFAULT '';
UPDATE "hospitals" SET "hospital_name" = "hira_hospital_name";
ALTER TABLE "hospitals" ALTER COLUMN "hospital_name" DROP DEFAULT;
