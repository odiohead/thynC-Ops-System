-- 주간업무 안건 개정 (2026-08-19, 1차 검토 반영) — 프로젝트 연결 제거 + 담당 팀·업무구분 추가
-- 업무구분 값('thynC'|'mobiCARE'|'공통')은 lib/weekly.ts 코드 상수

ALTER TABLE weekly_items DROP COLUMN project_code;
ALTER TABLE weekly_items ADD COLUMN owner_team_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE weekly_items ADD COLUMN biz_type TEXT NOT NULL DEFAULT '공통';
