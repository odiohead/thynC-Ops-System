-- 회원가입 신청 (2026-11-13) — 공개 가입 신청 → 관리자 승인 시 users 행 생성
-- 승인 전에는 users에 넣지 않는다(담당자 후보·권한 판정 등 users를 보는 곳에 미승인 계정이 섞이지 않게).
CREATE TABLE public.signup_requests (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL,                 -- 소문자 정규화 (users.email과 같은 불변식)
  password_hash   TEXT NOT NULL,                 -- bcrypt. 승인(users로 이동)·반려 시 '' 로 비움
  name            VARCHAR(50) NOT NULL,
  phone           VARCHAR(30) NOT NULL DEFAULT '',
  organization_id INTEGER,                       -- 신청자가 고른 소속 (승인 때 관리자가 확정)
  memo            TEXT,                          -- 신청 메모 (부서·용도 등)
  status          VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  reject_reason   TEXT,
  reviewed_by_id  TEXT,
  reviewed_at     TIMESTAMP(3),
  user_id         TEXT,                          -- 승인으로 만들어진 계정
  ip_address      VARCHAR(64),
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT signup_requests_status_chk CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT signup_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT signup_requests_reviewed_by_id_fkey FOREIGN KEY (reviewed_by_id) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT signup_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE
);
-- 같은 이메일의 대기 신청은 1건만
CREATE UNIQUE INDEX signup_requests_pending_email_key ON public.signup_requests (email) WHERE status = 'PENDING';
CREATE INDEX signup_requests_status_created_at_idx ON public.signup_requests (status, created_at DESC);
