-- Medicine tracking (scan the QR of a batch: manufacturing -> expiry).
-- Safe to run any number of times. The API also creates these tables by itself on first login.
USE chemiconnect;

CREATE TABLE IF NOT EXISTS trace_batches (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(20) NOT NULL,                       -- short code printed in the QR of the batch
  name VARCHAR(150) NOT NULL,
  batch_no VARCHAR(50) NOT NULL DEFAULT '',
  expiry_date DATE NULL,
  mfg_date DATE NULL,                               -- filled when a District Main PHC registers the batch
  manufacturer VARCHAR(150) NOT NULL DEFAULT '',
  mfg_qty INT UNSIGNED NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_trace_token (token),
  KEY idx_trace_batch (batch_no),
  KEY idx_trace_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- one row per step of a batch's journey: manufactured, received, issued, transferred, stocked, dispensed
CREATE TABLE IF NOT EXISTS trace_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trace_id INT UNSIGNED NOT NULL,
  kind VARCHAR(20) NOT NULL,
  from_user_id INT UNSIGNED NULL,
  to_user_id INT UNSIGNED NULL,
  qty INT UNSIGNED NOT NULL DEFAULT 0,
  note VARCHAR(255) NOT NULL DEFAULT '',
  happened_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_trace_time (trace_id, happened_at),
  FOREIGN KEY (trace_id) REFERENCES trace_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
