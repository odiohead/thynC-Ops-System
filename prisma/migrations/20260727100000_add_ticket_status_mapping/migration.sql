-- 도메인↔티켓 상태 매핑 설정화 (ticket_status_map_design.md §3)
-- 도메인 상태코드가 소속 티켓 상태를 명시 선언 — 이름/라벨 문자열 매칭 제거
-- ticket_status: OPEN(접수 계열, owner 시 ASSIGNED 엔진 판정)·IN_PROGRESS·PENDING·RESOLVED·CLOSED
-- ticket_pending_reason_id: PENDING 매핑 상태의 대기 사유 (역방향 모호성 해소)
ALTER TABLE status_codes
  ADD COLUMN ticket_status ticket_status NULL,
  ADD COLUMN ticket_pending_reason_id INT NULL REFERENCES ticket_pending_reasons(id) ON DELETE SET NULL;

ALTER TABLE build_statuses
  ADD COLUMN ticket_status ticket_status NULL;
