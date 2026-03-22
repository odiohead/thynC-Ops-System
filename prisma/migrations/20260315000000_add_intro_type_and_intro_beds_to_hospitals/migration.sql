-- AlterTable: add intro_type and intro_beds columns to hospitals
ALTER TABLE "hospitals" ADD COLUMN "intro_type" TEXT;
ALTER TABLE "hospitals" ADD COLUMN "intro_beds" INTEGER;
