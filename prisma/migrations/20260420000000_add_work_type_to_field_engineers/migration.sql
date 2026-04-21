-- FieldEngineer 테이블 업무 유형별 분리 (PROJECT / INSTALL_PLAN / MAINTENANCE)
-- 기존 userId UNIQUE 제거 → (userId, workType) 복합 UNIQUE
-- 기존 row는 PROJECT로 유지하고, INSTALL_PLAN·MAINTENANCE로 복제

ALTER TABLE field_engineers DROP CONSTRAINT field_engineers_user_id_key;
ALTER TABLE field_engineers ADD COLUMN work_type TEXT NOT NULL DEFAULT 'PROJECT';

INSERT INTO field_engineers (user_id, work_type, created_at)
SELECT user_id, 'INSTALL_PLAN', created_at FROM field_engineers WHERE work_type = 'PROJECT';

INSERT INTO field_engineers (user_id, work_type, created_at)
SELECT user_id, 'MAINTENANCE', created_at FROM field_engineers WHERE work_type = 'PROJECT';

ALTER TABLE field_engineers ADD CONSTRAINT field_engineers_user_id_work_type_key UNIQUE (user_id, work_type);
CREATE INDEX field_engineers_work_type_idx ON field_engineers(work_type);
