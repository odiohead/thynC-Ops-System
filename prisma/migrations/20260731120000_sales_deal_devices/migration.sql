-- 딜(계약 이력)별 도입 기기 수량 (2026-07-31) — 딜 상세 '규모·계약'에 기기 마스터(설정>장비 정보) 수량 입력
-- ProjectDevice(운영 실측)와 별개인 계약 스냅샷. 수량 0은 행 미저장(마스터에 새 기기가 늘어나면 기존 딜은 0으로 표시)
CREATE TABLE IF NOT EXISTS sales_deal_devices (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES sales_deals(id) ON DELETE CASCADE,
  device_info_id INTEGER NOT NULL REFERENCES device_info(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_deal_devices_deal_id_device_info_id_key UNIQUE (deal_id, device_info_id)
);

COMMENT ON TABLE sales_deal_devices IS '딜(계약 이력)별 도입 기기 수량 — 설정>장비 정보 마스터 기준, 계약 스냅샷 (운영 실측은 ProjectDevice)';
