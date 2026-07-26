-- 티켓 자동생성 규칙 (ticket_cti_rule_design.md §3)
-- 도메인 업무 → 티켓 자동생성 시 붙는 CTI·Assignment Group·설명 자동입력을 코드 하드코딩에서 DB로 옮긴다.
-- 순수 추가 마이그레이션. 롤백은 DROP TABLE.

CREATE TABLE "ticket_domain_cti_rules" (
  "id"                   SERIAL PRIMARY KEY,
  -- SITE_VISIT | INSTALL_PLAN | PROJECT | ETC | MAINTENANCE
  "ref_type"             VARCHAR(20) NOT NULL,
  -- 유지보수 장애유형별 규칙용. NULL = 해당 업무의 기본 규칙
  "match_status_code_id" INTEGER REFERENCES "status_codes"("id") ON DELETE CASCADE,
  -- ★ RESTRICT: 규칙에 물린 CTI는 DB 레벨에서도 삭제되지 않는다 (앱 검증과 이중 방어)
  "cti_id"               INTEGER NOT NULL REFERENCES "ticket_cti"("id") ON DELETE RESTRICT,
  -- NULL이면 CTI의 default_queue → 그것도 없으면 코드 폴백
  "queue_id"             INTEGER REFERENCES "ticket_queues"("id") ON DELETE SET NULL,
  -- 도메인 비고 → 티켓 설명 자동 입력 (기본 행에만 의미)
  "fill_description"     BOOLEAN NOT NULL DEFAULT true,
  "is_active"            BOOLEAN NOT NULL DEFAULT true,
  "updated_by"           TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 같은 업무 × 같은 조건은 1행
CREATE UNIQUE INDEX "ticket_domain_cti_rules_scope_uniq"
  ON "ticket_domain_cti_rules" ("ref_type", "match_status_code_id");
-- 업무당 기본 규칙(조건 없음)은 1행 — NULL이 UNIQUE를 통과하므로 부분 유니크로 별도 강제
CREATE UNIQUE INDEX "ticket_domain_cti_rules_default_uniq"
  ON "ticket_domain_cti_rules" ("ref_type") WHERE "match_status_code_id" IS NULL;
CREATE INDEX "ticket_domain_cti_rules_cti_idx" ON "ticket_domain_cti_rules" ("cti_id");
CREATE INDEX "ticket_domain_cti_rules_ref_idx" ON "ticket_domain_cti_rules" ("ref_type");
