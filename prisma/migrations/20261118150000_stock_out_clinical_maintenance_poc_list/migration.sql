-- 출고업무 유형 추가 (2026-11-18)
--  · 임상연구용(CLINICAL) 신설 — 출고업무 [출고요청](납품처) + 프로젝트 출고요청(프로젝트 연결) 양쪽에서 사용
--  · 유지보수(MAINTENANCE)를 프로젝트 필수 유형(미사용)에서 납품처로 요청하는 유형으로 전환
--  · 데모(PoC) 품목 목록(POC) 신설 — 요청은 purpose BUILD + sub_purpose POC 그대로, 품목 목록만 따로

-- 1) 품목 목록(설정 > 출고 품목 관리 탭)
ALTER TABLE "public"."stock_out_item_purposes" DROP CONSTRAINT "stock_out_item_purposes_purpose_check";
ALTER TABLE "public"."stock_out_item_purposes" ADD CONSTRAINT "stock_out_item_purposes_purpose_check"
  CHECK ("purpose" IN ('BUILD', 'POC', 'MAINTENANCE', 'BUSINESS', 'EVALUATION', 'SALES', 'OSAN_OFFICE', 'CLINICAL'));

-- 2) 요청 유형
ALTER TABLE "public"."stock_out_requests" DROP CONSTRAINT "stock_out_requests_purpose_check";
ALTER TABLE "public"."stock_out_requests" ADD CONSTRAINT "stock_out_requests_purpose_check"
  CHECK ("purpose" IN ('BUILD', 'MAINTENANCE', 'BUSINESS', 'EVALUATION', 'SALES', 'OSAN_OFFICE', 'CLINICAL'));

-- 3) 유형별 필수 항목 — 납품처 유형: 프로젝트 없음 + 목적 + 납품처 / 임상연구용: 프로젝트 연결(납품처 없음) 또는 납품처 / 그 외: 프로젝트 필수
ALTER TABLE "public"."stock_out_requests" DROP CONSTRAINT "stock_out_requests_kind_check";
ALTER TABLE "public"."stock_out_requests" ADD CONSTRAINT "stock_out_requests_kind_check" CHECK (
  CASE
    WHEN "purpose" IN ('EVALUATION', 'SALES', 'OSAN_OFFICE', 'MAINTENANCE')
      THEN ("project_code" IS NULL AND "sub_purpose" IS NOT NULL AND "dest_type" IS NOT NULL)
    WHEN "purpose" = 'CLINICAL'
      THEN ("sub_purpose" IS NOT NULL AND (("project_code" IS NOT NULL AND "dest_type" IS NULL) OR ("project_code" IS NULL AND "dest_type" IS NOT NULL)))
    ELSE ("project_code" IS NOT NULL)
  END);

-- 4) 데모(PoC) 목록 초기값 = 지금 데모 요청에 보이는 품목(구축 목록 중 대웅제약재고 제외)
INSERT INTO "public"."stock_out_item_purposes" ("inventory_item_id", "purpose")
SELECT p."inventory_item_id", 'POC'
FROM "public"."stock_out_item_purposes" p
JOIN "public"."inventory_items" it ON it."id" = p."inventory_item_id"
JOIN "public"."inventories" i ON i."id" = it."inventory_id"
WHERE p."purpose" = 'BUILD' AND i."name" <> '대웅제약재고'
ON CONFLICT DO NOTHING;
