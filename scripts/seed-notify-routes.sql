-- 1.1 P3 — Slack 채널·라우팅 시드 (projects/notification_v1.1_design.md §5.1)
--
-- 목적: 채널을 env 상수에서 DB로 옮기면서 **배포 직후 동작을 1.0과 동일하게** 유지한다.
--   1.0: 이벤트 → SLACK_CHANNEL_MAIN 단일 / 지연 요약 → SLACK_CHANNEL_DELAY
--   1.1: 아래 규칙 4행이 그것을 재현. 유형별 분리는 운영자가 설정 화면에서 규칙을 추가하며 점진 적용
--
-- 사용법 (채널 ID를 env 값으로 치환해 실행):
--   psql -v main_ch="'C079...'" -v delay_ch="'C079...'" -f scripts/seed-notify-routes.sql
-- 또는 아래 :main_ch / :delay_ch 를 직접 채널 ID 문자열로 바꿔 실행.
-- 재실행 안전(idempotent).
--
-- 주의: PROD 실행은 사용자 명시 허락 후 (CLAUDE.md 절대규칙 #5)

-- ① 채널 마스터
INSERT INTO notify_channels (name, slack_channel_id, description, sort_order)
SELECT '운영 공지', :main_ch, '티켓 등록·상태 변경 등 일반 업무 알림 (1.0 SLACK_CHANNEL_MAIN)', 10
WHERE NOT EXISTS (SELECT 1 FROM notify_channels WHERE name = '운영 공지');

INSERT INTO notify_channels (name, slack_channel_id, description, sort_order)
SELECT 'SLA 지연', :delay_ch, 'SLA 초과·임박·일일 요약 (1.0 SLACK_CHANNEL_DELAY)', 20
WHERE NOT EXISTS (SELECT 1 FROM notify_channels WHERE name = 'SLA 지연');

-- ② 라우팅 규칙 — 1.0 동작 재현
WITH main AS (SELECT id FROM notify_channels WHERE name = '운영 공지'),
     delay AS (SELECT id FROM notify_channels WHERE name = 'SLA 지연')
INSERT INTO notify_routes (name, event_type, channel_id, mention_mode, digest_hour, digest_opts, sort_order)
SELECT v.name, v.event_type, v.channel_id, v.mention_mode, v.digest_hour, v.digest_opts::jsonb, v.sort_order
FROM (
  SELECT '전체 티켓 등록'      AS name, 'TICKET_CREATED'           AS event_type, (SELECT id FROM main)  AS channel_id, 'queue_members' AS mention_mode, NULL::smallint AS digest_hour, NULL AS digest_opts, 10 AS sort_order
  UNION ALL SELECT '전체 상태 변경',      'TICKET_STATUS_CHANGED',     (SELECT id FROM main),  'none',          NULL, NULL, 20
  UNION ALL SELECT '전체 그룹 이관',      'TICKET_QUEUE_TRANSFERRED',  (SELECT id FROM main),  'queue_members', NULL, NULL, 30
  UNION ALL SELECT 'Sev1·2 에스컬레이션', 'SEV_ESCALATED',             (SELECT id FROM main),  'queue_members', NULL, NULL, 40
  -- 하루 1회 지연 요약 — 기본 09:00 KST, 초과+임박 포함, Assignment Group별 그룹
  UNION ALL SELECT 'SLA 일일 요약',       'DAILY_DIGEST',              (SELECT id FROM delay), 'none',          9,
                   '{"kinds":["overdue","warning"],"groupBy":"queue","maxPerSection":20}', 50
  -- SLA 초과 즉시 알림 — 초과된 그 시점에 1건씩
  UNION ALL SELECT 'SLA 초과 즉시',       'SLA_BREACH',                (SELECT id FROM delay), 'none',          NULL, NULL, 60
) v
WHERE NOT EXISTS (SELECT 1 FROM notify_routes r WHERE r.name = v.name);

-- 확인
SELECT r.sort_order, r.name, r.event_type, c.name AS 채널, r.mention_mode, r.digest_hour, r.is_active
FROM notify_routes r JOIN notify_channels c ON c.id = r.channel_id
ORDER BY r.sort_order;
