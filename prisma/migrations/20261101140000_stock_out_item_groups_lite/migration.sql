-- 출고 품목 마스터 — 그룹 2종(ELECTRONICS 전자제품 / ETC 기타) 추가 + 웨어러블 '(라이트)' 품목 5종 (2026-11-01)
ALTER TABLE stock_out_items DROP CONSTRAINT IF EXISTS stock_out_items_group_check;
ALTER TABLE stock_out_items ADD CONSTRAINT stock_out_items_group_check CHECK (item_group IN ('SYSTEM','WEARABLE','ELECTRONICS','ETC'));

-- 라이트 품목: 원 품목 바로 뒤 정렬, WMS 매핑(wms_model_name)은 NULL(별도 결정)
INSERT INTO stock_out_items (name, item_group, sort_order) VALUES
  ('MC200M-T (라이트)', 'WEARABLE', 111),
  ('MP100W (라이트)',   'WEARABLE', 121),
  ('MP1000F (라이트)',  'WEARABLE', 131),
  ('MP2000F (라이트)',  'WEARABLE', 141),
  ('MP2000R (라이트)',  'WEARABLE', 151)
ON CONFLICT (name) DO NOTHING;
