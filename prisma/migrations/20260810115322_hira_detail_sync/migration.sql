-- 병원상세정보연동 (심평원 MadmDtlInfoService2.8 getEqpInfo — 허가병상수)
ALTER TABLE hira_hospitals ADD COLUMN perm_sbd_cnt INTEGER, ADD COLUMN detail_synced_at TIMESTAMP(3);
ALTER TABLE hira_sync_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'basis';
