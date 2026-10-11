-- Offline mode: remembers which offline entries were already applied, so a retry after a weak connection never double-counts.
-- Safe to run any number of times. (The API also creates this table by itself on first login.)
USE chemiconnect;

CREATE TABLE IF NOT EXISTS sync_log (
  user_id INT UNSIGNED NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  result TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_id)
) ENGINE=InnoDB;
