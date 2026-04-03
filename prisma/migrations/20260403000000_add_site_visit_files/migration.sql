CREATE TABLE site_visit_files (
  id SERIAL PRIMARY KEY,
  site_visit_id INT NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  file_category TEXT NOT NULL,
  file_name TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  uploaded_at TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
