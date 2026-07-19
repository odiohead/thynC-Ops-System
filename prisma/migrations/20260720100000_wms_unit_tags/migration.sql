-- 자재관리 — 태그를 품목이 아닌 개체(시리얼 단품) 단위로 관리 (2026-07-20)
-- inventory_items.tags는 deprecated (백업 보존, UI 미사용)
ALTER TABLE inventory_units ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
