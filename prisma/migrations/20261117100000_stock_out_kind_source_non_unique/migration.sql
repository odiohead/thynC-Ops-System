-- 시스템 구성품 종류 — 편입 대상(원본 품목) 1개에 구성품 종류 여러 개 허용 (2026-11-17, projects/system_server_split_design.md §4)
-- 대웅제약재고 서버(10·20·30·40병상) 4종이 모두 thynC운영팀재고 서버(워크스테이션)으로 편입된다.
DROP INDEX "stock_out_component_kinds_source_item_id_key";
CREATE INDEX "stock_out_component_kinds_source_item_id_idx" ON "stock_out_component_kinds"("source_item_id");
