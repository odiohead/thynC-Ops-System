-- 주간업무 kind 구조 개정: 주요 안건(PROJECT)/주요 이슈(ISSUE) → 사업(BIZ)/운영(OPS)/개발(DEV) 안건
-- 기존 데이터 매핑: PROJECT→BIZ, ISSUE→OPS (DEV는 신규 섹션 — 기존 데이터 없음)
UPDATE weekly_items SET kind = 'BIZ' WHERE kind = 'PROJECT';
UPDATE weekly_items SET kind = 'OPS' WHERE kind = 'ISSUE';
