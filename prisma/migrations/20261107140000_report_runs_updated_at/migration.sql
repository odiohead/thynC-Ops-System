-- 레포트 실행 상태 마지막 변경 시각 (중단 감지용 — AI 재실행 포함)
ALTER TABLE "report_runs" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now();
