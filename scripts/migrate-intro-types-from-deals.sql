-- 도입형태(hospital_intro_types)를 딜 판매모델(sales_deals.daewoong_model) 기준으로 재구성 (2026-08-31)
-- 매핑: 사용량→사용량비례형 / 구축형·분납형→구축형 / 구독형·씨어스 월 납입→구독형
-- 딜이 있는 병원만 전체 교체, 딜 없는 병원은 현행 유지. idempotent — 재실행 안전.
BEGIN;

DELETE FROM hospital_intro_types
WHERE hospital_id IN (
  SELECT DISTINCT h.id
  FROM hospitals h
  JOIN sales_deals d ON d.hospital_code = h.hospital_code
);

INSERT INTO hospital_intro_types (hospital_id, status_code_id)
SELECT DISTINCT h.id, sc.id
FROM sales_deals d
JOIN hospitals h ON h.hospital_code = d.hospital_code
JOIN status_codes sc ON sc.category = 'INTRO_TYPE'
  AND sc.name = CASE d.daewoong_model
    WHEN '사용량'         THEN '사용량비례형'
    WHEN '구축형'         THEN '구축형'
    WHEN '분납형'         THEN '구축형'
    WHEN '구독형'         THEN '구독형'
    WHEN '씨어스 월 납입' THEN '구독형'
  END
WHERE d.daewoong_model IS NOT NULL;

COMMIT;
