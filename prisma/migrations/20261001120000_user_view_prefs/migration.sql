-- 사용자별 화면 설정 (2026-10-01) — 목록 열 선택·순서·폭 등 뷰 단위 JSON. 첫 사용처 AS접수 목록(view_key 'as_receipts_list')
CREATE TABLE IF NOT EXISTS user_view_prefs (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_key   VARCHAR(60) NOT NULL,
  prefs      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, view_key)
);
