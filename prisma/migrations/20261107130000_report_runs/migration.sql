-- 레포트 — 병원 운영 이력 보고서 (projects/hospital_report_design.md §8)
CREATE TABLE "report_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(40) NOT NULL DEFAULT 'HOSPITAL_HISTORY',
    "hospital_code" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'COLLECTING',
    "facts" JSONB,
    "ai_result" JSONB,
    "ai_error" TEXT,
    "error" TEXT,
    "model" VARCHAR(50),
    "effort" VARCHAR(20),
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "doc_number" VARCHAR(50),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "finished_at" TIMESTAMPTZ,
    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_runs_status_check" CHECK ("status" IN ('COLLECTING','ANALYZING','DONE','FAILED'))
);
CREATE INDEX "report_runs_kind_created_at_idx" ON "report_runs"("kind", "created_at" DESC);
CREATE INDEX "report_runs_hospital_code_idx" ON "report_runs"("hospital_code");
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_hospital_code_fkey" FOREIGN KEY ("hospital_code") REFERENCES "hospitals"("hospital_code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AI 사용량 구분 (assistant / report)
ALTER TABLE "ai_usage_logs" ADD COLUMN "feature" VARCHAR(20) NOT NULL DEFAULT 'assistant';
