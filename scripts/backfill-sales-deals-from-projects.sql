-- 영업/CRM v4 — 운영 데이터 기반 딜(도입 현황) 백필 (idempotent)
-- 프로젝트 1건 = 도입 1건(차수) 전제:
--   round_no = projects.order_number (병원 내 차수와 동일 의미)
--   계약일·병동/병상 스냅샷 = 프로젝트 값, 병원 판매모델 = 도입형태(INTRO_TYPE) 이름 매칭
--   딜 상태 = 계약일 있으면 '계약완료', 없으면 미지정
--   금액·도입병동/진료과·세금계산서·정산·씨어스 판매방식 = 누락(수기 입력 대상)
-- 재실행 안전: 이미 딜이 연결된 프로젝트/(병원,차수)는 건너뜀. 비고에 자동생성 마커.

WITH src AS (
  SELECT
    p.project_code,
    p.hospital_code,
    p.order_number,
    p.contract_date,
    p.ward_count,
    p.bed_count,
    it.name AS intro_type_name,
    to_char(COALESCE(p.contract_date, p.created_at), 'YYYYMM') AS ym,
    row_number() OVER (
      PARTITION BY to_char(COALESCE(p.contract_date, p.created_at), 'YYYYMM')
      ORDER BY p.contract_date NULLS LAST, p.project_code
    ) AS seq
  FROM projects p
  LEFT JOIN status_codes it ON it.id = p.intro_type_id
  WHERE NOT EXISTS (SELECT 1 FROM sales_deals d WHERE d.project_code = p.project_code)
    AND NOT EXISTS (SELECT 1 FROM sales_deals d2 WHERE d2.hospital_code = p.hospital_code AND d2.round_no = p.order_number)
)
INSERT INTO sales_deals (
  deal_code, hospital_code, round_no, project_code, status_id, hospital_model_id,
  ward_count, bed_count, contract_date, remark, created_at, updated_at
)
SELECT
  'DEAL-' || s.ym || '-' || lpad((s.seq + COALESCE((
    SELECT max(substring(d.deal_code from 13)::int)
    FROM sales_deals d WHERE d.deal_code LIKE 'DEAL-' || s.ym || '-%'
  ), 0))::text, 4, '0'),
  s.hospital_code,
  s.order_number,
  s.project_code,
  CASE WHEN s.contract_date IS NOT NULL
       THEN (SELECT id FROM status_codes WHERE category = 'SALES_DEAL_STATUS' AND name = '계약완료')
       ELSE NULL END,
  (SELECT id FROM status_codes sm WHERE sm.category = 'SALES_MODEL' AND sm.name = s.intro_type_name),
  s.ward_count,
  s.bed_count,
  s.contract_date,
  '운영 데이터 자동 생성 (프로젝트 기반, 2026-07-29) — 금액·도입병동·세금계산서·정산 수기 입력 필요',
  now(), now()
FROM src s;

-- 확인
SELECT count(*) AS total_deals,
       count(status_id) AS with_status,
       count(hospital_model_id) AS with_model,
       count(contract_date) AS with_contract,
       count(ward_count) AS with_ward,
       count(bed_count) AS with_bed
FROM sales_deals;
