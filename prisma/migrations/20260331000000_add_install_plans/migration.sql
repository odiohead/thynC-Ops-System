CREATE TABLE install_plans (
  id          SERIAL PRIMARY KEY,
  hospital_code VARCHAR(50) REFERENCES hospitals(hospital_code) ON DELETE SET NULL,
  request_date  DATE,
  write_status  VARCHAR(20) NOT NULL DEFAULT '-',
  reply_status  VARCHAR(20) NOT NULL DEFAULT '-',
  author_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  reply_date    DATE,
  note          TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
