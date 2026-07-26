-- 상담이력(consultations) — AI 어시스턴트 상담 정리 결과의 원본 저장소
-- 기존 위키 '병원 노트' append 방식을 대체한다. consultation_queue(v1 대기열)는 동결 보존.
CREATE TABLE IF NOT EXISTS "consultations" (
  "id"                   SERIAL PRIMARY KEY,
  "consultation_code"    VARCHAR(20)  NOT NULL,
  "hospital_code"        TEXT         NOT NULL,
  "consultation_type_id" INTEGER,
  "document_type_id"     INTEGER,
  "title"                VARCHAR(200) NOT NULL,
  "content"              TEXT         NOT NULL,
  "ai_summary"           TEXT,
  -- AiChatSession id. FK를 걸지 않는다 — 대화를 삭제해도 상담이력은 보존(ai_usage_logs 선례)
  "session_id"           TEXT,
  "consulted_by_id"      TEXT         NOT NULL,
  "consulted_by_name"    VARCHAR(100) NOT NULL,
  "consulted_at"         DATE         NOT NULL,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "consultations_consultation_code_key"
  ON "consultations" ("consultation_code");
CREATE INDEX IF NOT EXISTS "consultations_hospital_code_consulted_at_idx"
  ON "consultations" ("hospital_code", "consulted_at" DESC);
CREATE INDEX IF NOT EXISTS "consultations_consulted_by_id_consulted_at_idx"
  ON "consultations" ("consulted_by_id", "consulted_at" DESC);
CREATE INDEX IF NOT EXISTS "consultations_consulted_at_idx"
  ON "consultations" ("consulted_at" DESC);

-- 축2 전문 검색(search_operation_history) 가속 — 다른 운영 테이블과 달리 계속 누적되므로 선제 부여
CREATE INDEX IF NOT EXISTS "consultations_content_trgm_idx"
  ON "consultations" USING GIN ("content" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "consultations_title_trgm_idx"
  ON "consultations" USING GIN ("title" gin_trgm_ops);

DO $$ BEGIN
  ALTER TABLE "consultations" ADD CONSTRAINT "consultations_hospital_code_fkey"
    FOREIGN KEY ("hospital_code") REFERENCES "hospitals"("hospital_code")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "consultations" ADD CONSTRAINT "consultations_consultation_type_id_fkey"
    FOREIGN KEY ("consultation_type_id") REFERENCES "status_codes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "consultations" ADD CONSTRAINT "consultations_document_type_id_fkey"
    FOREIGN KEY ("document_type_id") REFERENCES "status_codes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "consultations" ADD CONSTRAINT "consultations_consulted_by_id_fkey"
    FOREIGN KEY ("consulted_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
