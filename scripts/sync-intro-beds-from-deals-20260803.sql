-- 2026-08-03 | hospitals.intro_beds를 딜(영업 원장) 기준으로 동기화
--
-- 원칙 변경(사용자 확정 2026-08-03): 도입 병상의 기준을 프로젝트 bed_count 합
--   (sync-intro-beds-from-projects.sql, 2026-07-13 원칙)에서
--   **계약완료 딜의 대웅 디바이스 수량 합**으로 전환.
--   intro_beds = SUM(sales_deals.daewoong_device_count) (status '계약완료' 딜)
-- 범위: 계약완료 딜을 보유한 병원만. 딜 없는 병원(광주보훈 등)은 건드리지 않는다.
-- 재실행: 항상 현재 딜 데이터로 재계산하므로 멱등.
-- 주의: sync-intro-beds-from-projects.sql을 이후에 실행하면 이 결과를 프로젝트
--   기준으로 되덮는다 — 두 스크립트는 기준이 상충하므로 함께 쓰지 말 것.
--   실행 전 백업 필수. PROD 실행은 사용자 명시 허락 필수(CLAUDE.md 절대 규칙 5).
-- 백업: ~/backups/hospitals_before_intro_beds_deal_sync_20260803.dump (PROD, 실행 전 생성)

BEGIN;

WITH deal_beds AS (
  SELECT sd.hospital_code,
         SUM(COALESCE(sd.daewoong_device_count, 0)) AS dev_sum
  FROM sales_deals sd
  JOIN status_codes sc ON sc.id = sd.status_id
  WHERE sc.name = '계약완료'
  GROUP BY sd.hospital_code
)
UPDATE hospitals h
SET intro_beds = d.dev_sum,
    updated_at = NOW()
FROM deal_beds d
WHERE h.hospital_code = d.hospital_code
  AND h.intro_beds IS DISTINCT FROM d.dev_sum;

COMMIT;
