-- 위키 페이지 아이콘(이모지) + 커버 이미지 (Phase 10 / A2)
ALTER TABLE wiki.wiki_pages ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE wiki.wiki_pages ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE wiki.wiki_pages ADD COLUMN IF NOT EXISTS cover_offset_y INTEGER NOT NULL DEFAULT 50;
