-- 1. 새 컬럼 추가
ALTER TABLE site_visits
  ADD COLUMN daewoong_user_id TEXT REFERENCES users(id);

-- 2. 데이터 마이그레이션 (update-daewoong-fk.ts 스크립트로 처리)

-- 3. 기존 컬럼 제거
ALTER TABLE site_visits
  DROP CONSTRAINT IF EXISTS site_visits_daewoong_staff_id_fkey;
ALTER TABLE site_visits
  DROP COLUMN daewoong_staff_id;
