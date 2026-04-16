CREATE TABLE site_visit_queue (
  id SERIAL PRIMARY KEY,
  gmail_message_id TEXT NOT NULL UNIQUE,
  received_at TIMESTAMPTZ NOT NULL,
  hospital_name_raw TEXT NOT NULL,
  request_date TIMESTAMPTZ,
  manager_name TEXT NOT NULL,
  manager_phone TEXT NOT NULL,
  manager_email TEXT NOT NULL,
  total_beds TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  file_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  site_visit_id INT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_site_visit FOREIGN KEY (site_visit_id) REFERENCES site_visits(id)
);
