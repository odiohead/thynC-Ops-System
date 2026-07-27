-- 설치계획 단일 상태 축 전환 (ticket_status_map_design.md §7 — 결정②B)
-- 2축(write_status×reply_status) → 단일 status_id. 기존 컬럼은 백업 보존(deprecated, 앱 미사용)
-- 티켓 상태 매핑(ticket_status 컬럼)은 scripts/seed-ticket-status-map.sql에서 채운다

INSERT INTO status_codes (name, category, color, "order") VALUES
  ('접수',     'INSTALL_PLAN_STATUS', '#3B82F6', 1),
  ('작성완료', 'INSTALL_PLAN_STATUS', '#F59E0B', 2),
  ('회신완료', 'INSTALL_PLAN_STATUS', '#10B981', 3),
  ('보류',     'INSTALL_PLAN_STATUS', '#9CA3AF', 4)
ON CONFLICT (name, category) DO NOTHING;

ALTER TABLE install_plans ADD COLUMN status_id INT NULL REFERENCES status_codes(id);
CREATE INDEX install_plans_status_id_idx ON install_plans(status_id);

-- 백필: (완료,완료)→회신완료 / (완료,그 외)→작성완료 / 나머지→접수
UPDATE install_plans SET status_id = (SELECT id FROM status_codes WHERE category = 'INSTALL_PLAN_STATUS' AND name = '회신완료')
WHERE write_status = '완료' AND reply_status = '완료';
UPDATE install_plans SET status_id = (SELECT id FROM status_codes WHERE category = 'INSTALL_PLAN_STATUS' AND name = '작성완료')
WHERE status_id IS NULL AND write_status = '완료';
UPDATE install_plans SET status_id = (SELECT id FROM status_codes WHERE category = 'INSTALL_PLAN_STATUS' AND name = '접수')
WHERE status_id IS NULL;
