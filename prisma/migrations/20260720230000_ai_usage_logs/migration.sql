-- AI 어시스턴트 사용량 원장 — 대화(세션/메시지) 삭제와 무관하게 사용량 집계 보존
-- 계정 삭제 대비 이름·이메일 스냅샷, 세션/메시지는 FK 없이 ID만 보관 (삭제 후에도 세션 수 집계 가능)
CREATE TABLE ai_usage_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name VARCHAR(100) NOT NULL DEFAULT '',
  user_email VARCHAR(255) NOT NULL DEFAULT '',
  session_id UUID,
  message_id UUID UNIQUE,
  hospital_code TEXT REFERENCES hospitals(hospital_code) ON DELETE SET NULL,
  model VARCHAR(50) NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_logs_created_at_idx ON ai_usage_logs (created_at);
CREATE INDEX ai_usage_logs_user_id_created_at_idx ON ai_usage_logs (user_id, created_at);

-- 기존 대화 백필 (assistant 답변 1건 = 원장 1행, 답변 시각 유지)
INSERT INTO ai_usage_logs (user_id, user_name, user_email, session_id, message_id, hospital_code, model,
                           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at)
SELECT s.user_id, COALESCE(u.name, ''), COALESCE(u.email, ''), m.session_id, m.id, s.hospital_code, 'claude-opus-4-8',
       COALESCE((m.usage->>'inputTokens')::int, 0),
       COALESCE((m.usage->>'outputTokens')::int, 0),
       COALESCE((m.usage->>'cacheReadTokens')::int, 0),
       COALESCE((m.usage->>'cacheWriteTokens')::int, 0),
       m.created_at
FROM ai_chat_messages m
JOIN ai_chat_sessions s ON s.id = m.session_id
LEFT JOIN users u ON u.id = s.user_id
WHERE m.role = 'assistant';
