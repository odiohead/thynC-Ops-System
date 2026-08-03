-- 알림 v2 P5 — 구체계 데이터 정리
-- 1) 폐기된 설정 키 제거 (delay-rules·DM 경로·구 SLA 규칙)
DELETE FROM app_settings WHERE key IN (
  'notify_delay_interval', 'notify_dm_enabled', 'notify_dm_policy',
  'notify_assign_dm', 'notify_sla_rules', 'notify_status_dwell'
);

-- 2) 구 규칙별 일일 요약(DAILY_DIGEST) 비활성 — 전역 요약(notify_digest_hour/channel)으로 대체
UPDATE notify_routes SET is_active = false WHERE event_type = 'DAILY_DIGEST' AND is_active = true;
