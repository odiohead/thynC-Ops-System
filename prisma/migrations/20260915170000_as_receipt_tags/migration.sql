-- AS접수 태그 3종 (2026-09-15) — 선교체(pre_replace)와 같은 성격의 접수 플래그: 우선수리 · 펌웨어 업데이트 · 부속품 동봉
ALTER TABLE as_receipts
  ADD COLUMN IF NOT EXISTS priority_repair BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS firmware_update BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accessory_included BOOLEAN NOT NULL DEFAULT false;
