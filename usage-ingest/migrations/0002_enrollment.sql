-- 수집 병원 등록과 서버별 키 (projects/usage_agent_enroll_design.md)
--
-- 0001 까지는 사람이 병원 토큰을 발급해 설치자에게 전달했다. 여기부터는
--   1) 운영관리시스템에서 병원을 등록하고 서버 대수를 적는다 (agent_enrollments)
--   2) 설치 스크립트가 병원코드·서버 이름으로 등록을 요청하면, 등록된 병원이고 자리가 남아 있을 때만
--      그 서버 전용 키를 발급한다 (agent_servers.key_hash — 원문은 저장하지 않는다)
-- 병원 토큰(agent_tokens)은 그대로 동작한다 — 이미 설치된 서버는 바꿀 것이 없다.

CREATE TABLE agent_enrollments (
  hospital_code    text        PRIMARY KEY,                -- 본체의 병원 코드 (DB 가 달라 참조 제약 없음)
  hospital_name    text,                                   -- 설치 중 확인 문구에 쓰는 병원명 사본 (본체가 맞춘다)
  expected_servers integer     NOT NULL CHECK (expected_servers BETWEEN 1 AND 50),
  note             text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_servers
  ADD COLUMN key_hash            text UNIQUE,              -- 서버 키의 SHA-256. NULL = 병원 토큰으로 접속하는 서버(0001 방식)
  ADD COLUMN key_prefix          text,                     -- 앞 8자 (목록 표시용)
  ADD COLUMN key_issued_at       timestamptz,
  ADD COLUMN enrolled_at         timestamptz,              -- 설치 스크립트로 등록한 시각
  ADD COLUMN enroll_ip           text,
  ADD COLUMN reenroll_allowed_at timestamptz,              -- 관리자가 재등록을 허용한 시각 — 같은 이름으로 키를 다시 받을 수 있다(재설치)
  ADD COLUMN blocked_at          timestamptz;              -- 차단 — 접속을 거부하고 자리 계산에서 뺀다

-- 이미 수집 중인 병원은 지금 서버 수로 등록해 둔다
INSERT INTO agent_enrollments (hospital_code, expected_servers, created_by)
SELECT hospital_code, count(*)::int, 'migration' FROM agent_servers GROUP BY hospital_code;

-- 본체 앱이 수신부의 관리 호출(/internal/v1/*)을 부를 때 내는 값. 원본 DB 를 읽을 수 있는 쪽만 알 수 있다.
CREATE TABLE agent_admin_secret (
  id         boolean     PRIMARY KEY DEFAULT true CHECK (id),
  secret     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO agent_admin_secret (secret) VALUES (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
