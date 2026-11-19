-- 사용량 일별 집계 (전체 병원 화면용 — projects/usage_overview_design.md §5)
-- 원본은 사용량 원본 DB(thync_usage*)에 있고, 이 표는 lib/usage/metrics.ts 로 계산한 일별 값을 저장한 것이다.
-- lib/usage/stats.ts 가 주기적으로 최근 91일을 다시 계산해 덮어쓴다 (본체 DB — 원본 DB 에는 쓰지 않는다).

-- 병원 × 날짜 × 판매모델: 측정 환자 수 · 신규 측정 수 · 최대 동시측정 수
CREATE TABLE "usage_daily_stats" (
  "hospital_code" TEXT        NOT NULL,
  "date"          DATE        NOT NULL,
  "model"         VARCHAR(10) NOT NULL,
  "measured"      INTEGER     NOT NULL,
  "started"       INTEGER     NOT NULL,
  "peak"          INTEGER     NOT NULL,
  "computed_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_daily_stats_pkey" PRIMARY KEY ("hospital_code", "date", "model"),
  CONSTRAINT "usage_daily_stats_model_check" CHECK ("model" IN ('all', 'general', 'usage'))
);

-- 병원 × 날짜 × 판매모델 × 기기 종류(제품 device_type): 사용 횟수 · 최대 동시사용 수 · 그날의 계약·공급 수량
-- uses·peak 가 NULL = 기기별 수치를 알 수 없는 날, capacity 가 NULL = 계약·공급 수량 없음
CREATE TABLE "usage_daily_device_stats" (
  "hospital_code" TEXT        NOT NULL,
  "date"          DATE        NOT NULL,
  "model"         VARCHAR(10) NOT NULL,
  "device_type"   INTEGER     NOT NULL,
  "uses"          INTEGER,
  "peak"          INTEGER,
  "capacity"      INTEGER,
  CONSTRAINT "usage_daily_device_stats_pkey" PRIMARY KEY ("hospital_code", "date", "model", "device_type"),
  CONSTRAINT "usage_daily_device_stats_model_check" CHECK ("model" IN ('all', 'general', 'usage'))
);

CREATE INDEX "usage_daily_device_stats_model_device_type_date_idx" ON "usage_daily_device_stats" ("model", "device_type", "date");
