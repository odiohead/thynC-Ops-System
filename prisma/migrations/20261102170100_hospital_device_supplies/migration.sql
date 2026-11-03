-- 병원 × 기기 비계약 공급 현황 (대웅 직판) — 현재 수량 1행, 변경 이력은 감사 로그 (projects/third_party_supply_design.md §3.2, 2026-11-02)
CREATE TABLE public.hospital_device_supplies (
  id             SERIAL PRIMARY KEY,
  hospital_code  TEXT        NOT NULL REFERENCES public.hospitals(hospital_code) ON DELETE CASCADE,
  device_info_id INTEGER     NOT NULL REFERENCES public.device_info(id),
  quantity       INTEGER     NOT NULL CHECK (quantity >= 0),
  supplier       VARCHAR(40) NOT NULL DEFAULT '대웅제약',
  checked_on     DATE,
  note           TEXT,
  updated_by_id  TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (hospital_code, device_info_id)
);
CREATE INDEX hospital_device_supplies_device_idx ON public.hospital_device_supplies(device_info_id);
