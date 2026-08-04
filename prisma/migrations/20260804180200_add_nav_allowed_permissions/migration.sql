-- RBAC Lite Phase 2 (projects/rbac_design.md §8) — 메뉴 노출을 권한 단위로도 제어
-- 판정: 비어 있으면 통과, 값이 있으면 사용자가 그중 1개 이상 보유(또는 SUPER_ADMIN)해야 노출

ALTER TABLE "nav_menu_items" ADD COLUMN "allowed_permissions" TEXT[] NOT NULL DEFAULT '{}';
