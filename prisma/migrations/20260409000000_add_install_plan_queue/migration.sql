CREATE TABLE install_plan_queue (
  id                SERIAL PRIMARY KEY,
  gmail_message_id  VARCHAR(255) UNIQUE NOT NULL,
  received_at       TIMESTAMP(3) NOT NULL,
  hospital_name_raw VARCHAR(500) NOT NULL DEFAULT '',
  request_date      TIMESTAMP(3),
  manager_name      VARCHAR(100) NOT NULL DEFAULT '',
  manager_phone     VARCHAR(50)  NOT NULL DEFAULT '',
  manager_email     VARCHAR(255) NOT NULL DEFAULT '',
  total_beds        VARCHAR(50)  NOT NULL DEFAULT '',
  model             VARCHAR(200) NOT NULL DEFAULT '',
  raw_body          TEXT         NOT NULL DEFAULT '',
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
  install_plan_id   INTEGER REFERENCES install_plans(id),
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
