CREATE TABLE hira_sync_jobs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  total_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE hira_sync_logs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES hira_sync_jobs(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  stats JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
