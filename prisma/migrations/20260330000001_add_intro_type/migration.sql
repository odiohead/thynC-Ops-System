-- CreateTable: HospitalIntroType junction table
CREATE TABLE IF NOT EXISTS "hospital_intro_types" (
  "id" SERIAL PRIMARY KEY,
  "hospital_id" INTEGER NOT NULL REFERENCES "hospitals"("id") ON DELETE CASCADE,
  "status_code_id" INTEGER NOT NULL REFERENCES "status_codes"("id") ON DELETE CASCADE,
  UNIQUE("hospital_id", "status_code_id")
);

-- AlterTable: Add intro_type_id to projects
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "intro_type_id" INTEGER REFERENCES "status_codes"("id");

-- Seed: INTRO_TYPE StatusCodes
INSERT INTO "status_codes" ("name", "category", "order")
VALUES
  ('구축형', 'INTRO_TYPE', 1),
  ('구독형', 'INTRO_TYPE', 2),
  ('사용량비례형', 'INTRO_TYPE', 3)
ON CONFLICT ("name", "category") DO NOTHING;
