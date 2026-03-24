-- 1. 새 컬럼 추가
ALTER TABLE daewoong_hospital_assignments
  ADD COLUMN assigned_user_id TEXT REFERENCES users(id);

-- 2. 데이터 마이그레이션 (migrate-daewoong-to-user.ts + update-daewoong-fk.ts 스크립트로 처리)

-- 3. 기존 컬럼 제거
ALTER TABLE daewoong_hospital_assignments
  DROP CONSTRAINT IF EXISTS daewoong_hospital_assignments_staff_id_fkey;
ALTER TABLE daewoong_hospital_assignments
  DROP COLUMN staff_id;

-- 4. NOT NULL 제약 추가
ALTER TABLE daewoong_hospital_assignments
  ALTER COLUMN assigned_user_id SET NOT NULL;
