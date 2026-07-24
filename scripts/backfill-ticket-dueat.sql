-- P11: 열린 티켓 dueAt 백필 (Sev 기반 SLA — ticket_dev_schedule.md P11)
-- 기준: dueAt = created_at + Sev별 기본 SLA 목표일 (SEV1:1, SEV2:1, SEV3:3, SEV4:7)
-- 제외: SEV5(백로그 — SLA 미적용), PROJECT(endDateExpected가 dueAt 소유), 종결/해결 티켓, 이미 dueAt 보유분
-- 재실행 안전 (due_at IS NULL 조건). PROD 반영 시 이 파일 실행.

UPDATE tickets
SET due_at = created_at + (CASE severity
    WHEN 'SEV1' THEN 1
    WHEN 'SEV2' THEN 1
    WHEN 'SEV3' THEN 3
    WHEN 'SEV4' THEN 7
  END) * interval '1 day'
WHERE status NOT IN ('RESOLVED', 'CLOSED')
  AND severity <> 'SEV5'
  AND ref_type IS DISTINCT FROM 'PROJECT'
  AND due_at IS NULL;
