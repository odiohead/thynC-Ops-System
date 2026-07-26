-- 티켓 자동생성 규칙 초기 시드 (ticket_cti_rule_design.md §8)
-- 현행 하드코딩과 동일한 규칙을 넣어 배포 직후 동작이 100% 같도록 한다.
-- 재실행 안전(idempotent) — 이미 있는 규칙은 건드리지 않는다(운영자가 바꾼 값을 되돌리지 않기 위해).
--
-- 실행: psql -U thync -d thync_ops_dev -f scripts/seed-ticket-cti-rules.sql
--
-- 환경마다 ID가 다르므로 전부 이름 조회 기반. 1회성 이관이라 이름 매칭이 안전한 유일한 지점이다.

-- ── 업무 기본 규칙 5행 ────────────────────────────────────────
WITH cti AS (
  SELECT i.id, c.name AS cat, t.name AS typ, i.name AS item
  FROM ticket_cti i
  JOIN ticket_cti t ON i.parent_id = t.id
  JOIN ticket_cti c ON t.parent_id = c.id
  WHERE i.level = 3
), q AS (
  SELECT id, name FROM ticket_queues
), src(ref_type, cat, typ, item, queue_name) AS (
  VALUES
    ('SITE_VISIT',   '영업',     '신규도입', '답사요청',             '설치·답사'),
    ('INSTALL_PLAN', '영업',     '신규도입', '설치계획(가안)요청',   '설치·답사'),
    ('PROJECT',      '영업',     '신규도입', '구축',                 '설치·답사'),
    ('ETC',          '내부',     '기타업무', '일반',                 '내부운영'),
    ('MAINTENANCE',  '고객지원', '장애',     '기타',                 '유지보수')
)
INSERT INTO ticket_domain_cti_rules (ref_type, match_status_code_id, cti_id, queue_id, fill_description, is_active)
SELECT src.ref_type, NULL, cti.id, q.id, true, true
FROM src
JOIN cti ON cti.cat = src.cat AND cti.typ = src.typ AND cti.item = src.item
LEFT JOIN q ON q.name = src.queue_name
WHERE NOT EXISTS (
  SELECT 1 FROM ticket_domain_cti_rules r
  WHERE r.ref_type = src.ref_type AND r.match_status_code_id IS NULL
);

-- ── 유지보수 장애유형별 규칙 (이름이 같은 CTI Item과 짝지음) ──
-- 현행 코드(maintTypeToCtiId)가 하던 이름 매칭을 여기서 1회 수행해 ID로 고정한다.
-- 이후 장애유형 이름을 바꿔도 규칙은 유지된다 — 이름 매칭이 조용히 깨지던 문제 해소.
WITH fault AS (
  SELECT i.id, i.name
  FROM ticket_cti i
  JOIN ticket_cti t ON i.parent_id = t.id AND t.level = 2 AND t.name = '장애'
  JOIN ticket_cti c ON t.parent_id = c.id AND c.level = 1 AND c.name = '고객지원'
  WHERE i.level = 3
), mt AS (
  SELECT id, name FROM status_codes WHERE category = 'MAINTENANCE_TYPE'
), q AS (
  SELECT id FROM ticket_queues WHERE name = '유지보수'
)
INSERT INTO ticket_domain_cti_rules (ref_type, match_status_code_id, cti_id, queue_id, fill_description, is_active)
SELECT 'MAINTENANCE', mt.id, fault.id, (SELECT id FROM q), true, true
FROM mt
JOIN fault ON fault.name = mt.name
WHERE NOT EXISTS (
  SELECT 1 FROM ticket_domain_cti_rules r
  WHERE r.ref_type = 'MAINTENANCE' AND r.match_status_code_id = mt.id
);

-- ── 결과 확인 ────────────────────────────────────────────────
SELECT r.ref_type,
       COALESCE(sc.name, '(기본)') AS 조건,
       c.name || ' / ' || t.name || ' / ' || i.name AS cti,
       COALESCE(qq.name, '(CTI 기본)') AS assignment_group,
       r.fill_description
FROM ticket_domain_cti_rules r
JOIN ticket_cti i ON r.cti_id = i.id
JOIN ticket_cti t ON i.parent_id = t.id
JOIN ticket_cti c ON t.parent_id = c.id
LEFT JOIN status_codes sc ON r.match_status_code_id = sc.id
LEFT JOIN ticket_queues qq ON r.queue_id = qq.id
ORDER BY r.ref_type, r.match_status_code_id NULLS FIRST;
