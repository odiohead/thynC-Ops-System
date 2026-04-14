-- site_visits: site_visit_code 컬럼 추가 (VISIT-YYYYMM-NNNNN 코드체계)
ALTER TABLE "site_visits" ADD COLUMN "site_visit_code" VARCHAR(50);
CREATE UNIQUE INDEX "site_visits_site_visit_code_key" ON "site_visits"("site_visit_code");

-- 기존 데이터 백필
WITH numbered AS (
  SELECT id, created_at,
    TO_CHAR(created_at, 'YYYYMM') AS ym,
    ROW_NUMBER() OVER (PARTITION BY TO_CHAR(created_at, 'YYYYMM') ORDER BY id) AS rn
  FROM site_visits
)
UPDATE site_visits sv
SET site_visit_code = 'VISIT-' || n.ym || '-' || LPAD(n.rn::text, 5, '0')
FROM numbered n
WHERE sv.id = n.id;
