-- 1. 프로젝트 담당자 N:M 테이블 생성
CREATE TABLE project_assignees (
  id SERIAL PRIMARY KEY,
  project_code VARCHAR(50) NOT NULL REFERENCES projects(project_code) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_code, user_id)
);

-- 2. 설치계획 담당자 N:M 테이블 생성
CREATE TABLE install_plan_assignees (
  id SERIAL PRIMARY KEY,
  install_plan_id INTEGER NOT NULL REFERENCES install_plans(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(install_plan_id, user_id)
);

-- 3. 답사 담당자 N:M 테이블 생성
CREATE TABLE site_visit_assignees (
  id SERIAL PRIMARY KEY,
  site_visit_id INTEGER NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(site_visit_id, user_id)
);

-- 4. 기존 단일 FK 데이터를 N:M 테이블로 이관 (데이터 유실 방지)
INSERT INTO project_assignees (project_code, user_id)
SELECT project_code, builder_user_id FROM projects WHERE builder_user_id IS NOT NULL;

INSERT INTO install_plan_assignees (install_plan_id, user_id)
SELECT id, author_id FROM install_plans WHERE author_id IS NOT NULL;

INSERT INTO site_visit_assignees (site_visit_id, user_id)
SELECT id, assignee_id FROM site_visits WHERE assignee_id IS NOT NULL;

-- 5. 기존 단일 FK 컬럼 제거
ALTER TABLE projects DROP COLUMN IF EXISTS builder_user_id;
ALTER TABLE install_plans DROP COLUMN IF EXISTS author_id;
ALTER TABLE site_visits DROP COLUMN IF EXISTS assignee_id;
