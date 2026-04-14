CREATE TABLE maintenances (
  id SERIAL PRIMARY KEY,
  maintenance_code VARCHAR UNIQUE,
  hospital_code VARCHAR NOT NULL REFERENCES hospitals(hospital_code),
  type_id INTEGER REFERENCES status_codes(id),
  status_id INTEGER REFERENCES status_codes(id),
  priority VARCHAR NOT NULL DEFAULT '보통',
  title VARCHAR NOT NULL,
  reporter_name VARCHAR,
  is_remote BOOLEAN NOT NULL DEFAULT false,
  reported_at DATE,
  visit_date DATE,
  resolved_at DATE,
  symptoms TEXT,
  cause TEXT,
  resolution TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE maintenance_assignees (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER NOT NULL REFERENCES maintenances(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(maintenance_id, user_id)
);

CREATE TABLE maintenance_files (
  id SERIAL PRIMARY KEY,
  maintenance_id INTEGER NOT NULL REFERENCES maintenances(id) ON DELETE CASCADE,
  file_category VARCHAR NOT NULL,
  file_name VARCHAR NOT NULL,
  s3_key VARCHAR NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);
