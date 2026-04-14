CREATE TABLE tasks (
  id            SERIAL PRIMARY KEY,
  task_code     VARCHAR(20)  NOT NULL UNIQUE,
  task_type     VARCHAR(20)  NOT NULL,
  ref_code      VARCHAR(50)  NOT NULL,
  hospital_code VARCHAR(50)  REFERENCES hospitals(hospital_code),
  title         TEXT,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tasks_task_type     ON tasks(task_type);
CREATE INDEX idx_tasks_ref_code      ON tasks(ref_code);
CREATE INDEX idx_tasks_hospital_code ON tasks(hospital_code);
