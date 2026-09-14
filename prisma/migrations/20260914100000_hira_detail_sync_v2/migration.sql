-- 심평원 병원상세정보연동 v2 — 의원급 확장 + 진료과목·전문의 + 일일 한도 분할 실행 (projects/hira_detail_sync_v2_design.md)

ALTER TABLE hira_hospitals
  ADD COLUMN IF NOT EXISTS dept_synced_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS sdr_synced_at TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS hira_hospital_depts (
  id SERIAL PRIMARY KEY,
  hira_hospital_id INTEGER NOT NULL REFERENCES hira_hospitals(id) ON DELETE CASCADE,
  dgsbjt_cd VARCHAR(10) NOT NULL,
  dgsbjt_nm VARCHAR(100) NOT NULL,
  pr_sdr_cnt INTEGER,
  cdiag_dr_cnt INTEGER,
  dtl_sdr_cnt INTEGER,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hira_hospital_depts_hospital_dept_key UNIQUE (hira_hospital_id, dgsbjt_cd)
);

ALTER TABLE hira_sync_jobs
  ADD COLUMN IF NOT EXISTS params JSONB,
  ADD COLUMN IF NOT EXISTS total_targets INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS done_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_quota INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calls_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quota_date VARCHAR(10),
  ADD COLUMN IF NOT EXISTS day_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS hira_sync_job_targets (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES hira_sync_jobs(id) ON DELETE CASCADE,
  hira_hospital_id INTEGER NOT NULL REFERENCES hira_hospitals(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  error TEXT,
  processed_at TIMESTAMP(3),
  CONSTRAINT hira_sync_job_targets_job_hospital_key UNIQUE (job_id, hira_hospital_id)
);
CREATE INDEX IF NOT EXISTS hira_sync_job_targets_job_status_idx ON hira_sync_job_targets(job_id, status);
