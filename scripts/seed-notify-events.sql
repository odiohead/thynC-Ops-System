-- 도메인 이벤트 알림 시드 (2026-10-27, projects/domain_event_notify_design.md) — idempotent, PROD 최초 반영·데이터 동기화 후 재실행 가능
-- AS 입고확인 → 'AS업무' 채널 (사용자 결정 2026-10-27). 채널이 없으면 아무것도 하지 않음(채널은 설정 화면에서 먼저 등록)
INSERT INTO notify_routes (name, event_type, channel_id, ref_types, queue_ids, cti_ids, severities, status_to, metrics, mention_mode, is_active, sort_order)
SELECT 'AS 입고확인 → AS업무', 'AS_INTAKE_CONFIRMED', c.id, '{}', '{}', '{}', '{}', '{}', '{}', 'none', true, 40
FROM notify_channels c
WHERE c.name = 'AS업무'
  AND NOT EXISTS (SELECT 1 FROM notify_routes r WHERE r.event_type = 'AS_INTAKE_CONFIRMED');
