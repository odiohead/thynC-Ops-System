-- 2026-07-13 | hospitals.intro_beds를 완료 프로젝트 bed_count 합계로 동기화
--
-- 원칙(사용자 확정): 프로젝트의 bed_count가 도입 병상의 기준 데이터.
--   2차·3차 도입(완료 프로젝트 여러 건)은 차수별 bed_count를 합산한다.
-- 범위: 완료 프로젝트(구축완료·완료, end_date_expected 있음)가 1건 이상인 병원.
--       완료 프로젝트가 없는 병원의 intro_beds는 건드리지 않는다.
-- 재실행: 항상 현재 프로젝트 데이터로 재계산하므로 여러 번 실행해도 안전(멱등).
--         프로젝트를 구축완료로 변경한 뒤 이 스크립트를 재실행하면 intro_beds가 따라온다.
-- 주의: 실행 전 백업 권장. PROD 실행은 사용자 명시 허락 필수(CLAUDE.md 절대 규칙 5).

BEGIN;

WITH done AS (
  SELECT p.hospital_code, p.bed_count
  FROM projects p
  JOIN build_statuses b ON b.id = p.build_status_id
  WHERE p.end_date_expected IS NOT NULL
    AND b.label IN ('완료', '구축완료')
),
sums AS (
  SELECT hospital_code, COALESCE(SUM(bed_count), 0) AS beds_sum
  FROM done
  GROUP BY hospital_code
)
UPDATE hospitals h
SET intro_beds = s.beds_sum,
    updated_at = NOW()
FROM sums s
WHERE h.hospital_code = s.hospital_code
  AND h.intro_beds IS DISTINCT FROM s.beds_sum;

COMMIT;
