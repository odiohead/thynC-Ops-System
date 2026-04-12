-- CreateTable
CREATE TABLE IF NOT EXISTS "consultation_queue" (
  "id" SERIAL PRIMARY KEY,
  "hospital_code" VARCHAR REFERENCES "hospitals"("hospital_code"),
  "consultation_type_id" INT REFERENCES "status_codes"("id"),
  "document_type_id" INT REFERENCES "status_codes"("id"),
  "conclusion" TEXT,
  "chat_history" JSONB NOT NULL DEFAULT '[]',
  "ai_summary" TEXT,
  "status" VARCHAR NOT NULL DEFAULT 'PENDING',
  "consulted_by_id" VARCHAR NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);
