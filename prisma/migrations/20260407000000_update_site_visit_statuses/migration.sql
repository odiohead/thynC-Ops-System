-- '대기' → '접수' 이름 변경
UPDATE status_codes SET name = '접수' WHERE name = '대기' AND category = 'SITE_VISIT';

-- 기존 order 밀기
UPDATE status_codes SET "order" = 4 WHERE name = '회신완료' AND category = 'SITE_VISIT';
UPDATE status_codes SET "order" = 3 WHERE name = '작성완료' AND category = 'SITE_VISIT';

-- '답사예정' 신규 추가
INSERT INTO status_codes (name, "order", color, category)
VALUES ('답사예정', 2, '#F59E0B', 'SITE_VISIT')
ON CONFLICT DO NOTHING;
