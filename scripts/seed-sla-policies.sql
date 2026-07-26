-- 1.1 P1 — SLA 폴백 정책 시드 (projects/notification_v1.1_design.md §4.6·§4.7)
-- 재실행 안전(idempotent). 기존 AppSetting notify_sla_rules 값(SEV1 1일/SEV2 1일/SEV3 3일/SEV4 7일/SEV5 미적용)을
-- 그대로 옮겨 1.0과 동일한 판정 기준을 유지한다. 유형별·상태별 세부 기준은 설정 화면(P2)에서 관리자가 입력.
--
-- 주의: PROD 실행은 사용자 명시 허락 후 (CLAUDE.md 절대규칙 #5)

-- ① 폴백 정책 — 전 티켓 대상(빈 배열 = 제한 없음), 우선순위 100(가장 낮음 = 다른 정책이 없을 때만 적용)
INSERT INTO sla_policies (name, description, priority, ref_types, queue_ids, cti_ids, severities, clock_type, is_active)
SELECT '기본(전체)', '1.0 notify_sla_rules 이관 — Sev별 해결 목표. 유형별 기준은 별도 정책으로 추가', 100,
       '{}', '{}', '{}', '{}', 'CALENDAR_24H', true
WHERE NOT EXISTS (SELECT 1 FROM sla_policies WHERE name = '기본(전체)');

-- ② RESOLVE 타깃 — Sev별 목표일(분 단위로 저장). SEV5는 1.0에서 미적용이므로 행 자체를 만들지 않음
WITH p AS (SELECT id FROM sla_policies WHERE name = '기본(전체)'),
     v(severity, days) AS (VALUES ('SEV1', 1), ('SEV2', 1), ('SEV3', 3), ('SEV4', 7))
INSERT INTO sla_targets (policy_id, metric, status_scope, severity, threshold_min, warn_ratio, is_active)
SELECT p.id, 'RESOLVE', NULL, v.severity, v.days * 24 * 60, 80, true
FROM p CROSS JOIN v
WHERE NOT EXISTS (
  SELECT 1 FROM sla_targets t
  WHERE t.policy_id = p.id AND t.metric = 'RESOLVE' AND t.severity = v.severity AND t.status_scope IS NULL
);

-- ③ PROJECT 정책 — 1.0의 하드코딩 예외(완료예정일이 기한 소유)를 정책으로 승격
INSERT INTO sla_policies (name, description, priority, ref_types, queue_ids, cti_ids, severities, clock_type, is_active)
SELECT '구축 프로젝트', 'PROJECT는 생성→완료 시간이 SLA가 아니다. 완료예정일(도메인 기한)만 사용', 40,
       '{PROJECT}', '{}', '{}', '{}', 'CALENDAR_24H', true
WHERE NOT EXISTS (SELECT 1 FROM sla_policies WHERE name = '구축 프로젝트');

WITH p AS (SELECT id FROM sla_policies WHERE name = '구축 프로젝트')
INSERT INTO sla_targets (policy_id, metric, status_scope, severity, threshold_min, warn_ratio, is_active)
SELECT p.id, 'DOMAIN_DUE', NULL, NULL, 0, 80, true FROM p
WHERE NOT EXISTS (SELECT 1 FROM sla_targets t WHERE t.policy_id = p.id AND t.metric = 'DOMAIN_DUE');

-- 확인
SELECT p.priority, p.name, p.ref_types, t.metric, t.severity, t.threshold_min,
       round(t.threshold_min / 1440.0, 2) AS days
FROM sla_policies p LEFT JOIN sla_targets t ON t.policy_id = p.id
ORDER BY p.priority, t.metric, t.severity;
