CREATE TABLE app_settings (
  key   VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
INSERT INTO app_settings (key, value) VALUES ('mail_sync_interval', 'off');
