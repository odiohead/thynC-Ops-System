-- 감사 로그 (AuditLog) 테이블 생성
-- 모든 mutation(CREATE/UPDATE/DELETE) 및 인증(LOGIN/LOGOUT) 액션을 기록
-- actorId는 User.id(uuid) 참조이지만 사용자 삭제 후에도 로그가 남도록 FK는 두지 않고 스냅샷(actorEmail/Name/Role)을 함께 보관

CREATE TABLE audit_logs (
  id              SERIAL PRIMARY KEY,

  actor_id        TEXT,
  actor_email     TEXT,
  actor_name      TEXT,
  actor_role      TEXT,

  action          TEXT NOT NULL,
  resource        TEXT NOT NULL,
  resource_id     TEXT,
  resource_label  TEXT,

  "before"        JSONB,
  "after"         JSONB,

  ip_address      TEXT,
  user_agent      TEXT,

  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX audit_logs_actor_id_created_at_idx
  ON audit_logs(actor_id, created_at DESC);

CREATE INDEX audit_logs_resource_resource_id_created_at_idx
  ON audit_logs(resource, resource_id, created_at DESC);

CREATE INDEX audit_logs_created_at_idx
  ON audit_logs(created_at DESC);
