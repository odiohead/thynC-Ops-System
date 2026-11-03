-- 기기 마스터 '공급 현황 관리' 플래그 — 비계약 공급(대웅 직판 등) 수량 축 (projects/third_party_supply_design.md §3.1, 2026-11-02)
ALTER TABLE public.device_info ADD COLUMN supply_tracked BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.device_info.supply_tracked IS '비계약 공급 현황 관리 대상(대웅 직판 등) — 병원 상세 공급 수량 입력·도입 현황 기대치 축';
-- 카트온(링 혈압계) 시드
UPDATE public.device_info SET supply_tracked = true WHERE device_model = 'SL-MPF1K07';
