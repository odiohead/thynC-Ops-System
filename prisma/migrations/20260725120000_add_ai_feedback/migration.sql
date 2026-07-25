-- AI 어시스턴트 답변 피드백 (v3 G2)
-- ai_usage_logs 선례와 동일하게 FK 없이 ID만 보관 — 대화(세션/메시지)를 삭제해도 피드백은 보존한다.
-- 이 데이터가 "어느 축·어느 도구에서 실패했는가"의 근거이자 벡터DB 도입 판단의 입력이 된다.
CREATE TABLE ai_feedback (
  id         SERIAL PRIMARY KEY,
  message_id UUID NOT NULL UNIQUE,
  session_id UUID,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name  VARCHAR(100) NOT NULL DEFAULT '',
  verdict    VARCHAR(10)  NOT NULL,
  reason     VARCHAR(20),
  comment    TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ai_feedback_created_at_idx ON ai_feedback (created_at);
CREATE INDEX ai_feedback_verdict_reason_idx ON ai_feedback (verdict, reason);
