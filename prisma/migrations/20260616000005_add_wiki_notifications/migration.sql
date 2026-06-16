-- 위키 알림 (댓글/멘션) (Phase 13 / B7)
CREATE TABLE IF NOT EXISTS wiki.wiki_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES wiki.wiki_pages(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name TEXT,
  page_title TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wiki_notifications_user_idx ON wiki.wiki_notifications (user_id, read_at, created_at DESC);
