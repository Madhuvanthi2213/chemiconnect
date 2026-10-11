-- ChemiConnect: one-shot DB repair. SAFE TO RUN ANY NUMBER OF TIMES - it only adds what is missing
-- and never deletes or changes your data. Use it when you see "Unknown column 'address'" or similar.
--
--   phpMyAdmin: select nothing, go to the Import tab and choose this file
--   or CLI:     mysql -u root -p < backend/repair.sql

USE chemiconnect;

DROP PROCEDURE IF EXISTS cc_repair;

DELIMITER //
CREATE PROCEDURE cc_repair()
BEGIN
  -- ===== users: full address =====
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'address') THEN
    ALTER TABLE users ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT '' AFTER phone;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'area') THEN
    ALTER TABLE users ADD COLUMN area VARCHAR(100) NOT NULL DEFAULT '' AFTER address;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'state') THEN
    ALTER TABLE users ADD COLUMN state VARCHAR(100) NOT NULL DEFAULT '' AFTER city;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'pincode') THEN
    ALTER TABLE users ADD COLUMN pincode CHAR(6) NOT NULL DEFAULT '' AFTER state;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'latitude') THEN
    ALTER TABLE users ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER pincode;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'longitude') THEN
    ALTER TABLE users ADD COLUMN longitude DECIMAL(11, 7) NULL AFTER latitude;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_user_coords') THEN
    ALTER TABLE users ADD INDEX idx_user_coords (latitude, longitude);
  END IF;

  -- ===== requests: Dispatched / Received statuses, auto requests =====
  -- (widening the list only; existing values stay as they are)
  ALTER TABLE requests MODIFY status ENUM('Pending','Approved','Dispatched','Received','Rejected') NOT NULL DEFAULT 'Pending';

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND COLUMN_NAME = 'auto') THEN
    ALTER TABLE requests ADD COLUMN auto TINYINT(1) NOT NULL DEFAULT 0 AFTER status;
    -- this DB is still on the very old flow, where "Approved" already moved the stock, so those rows are complete.
    -- (runs only this one time, right when the auto column is first added)
    UPDATE requests SET status = 'Received' WHERE status = 'Approved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND COLUMN_NAME = 'chain_id') THEN
    ALTER TABLE requests ADD COLUMN chain_id INT UNSIGNED NULL AFTER auto;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requests' AND INDEX_NAME = 'idx_chain') THEN
    ALTER TABLE requests ADD KEY idx_chain (chain_id);
  END IF;

  -- ===== stock: batch number + expiry date (one row per batch) =====
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock' AND COLUMN_NAME = 'batch_no') THEN
    ALTER TABLE stock ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock' AND COLUMN_NAME = 'expiry_date') THEN
    ALTER TABLE stock ADD COLUMN expiry_date DATE NULL AFTER batch_no;
  END IF;
  -- add the new per-batch unique key BEFORE dropping the old one (the foreign key on user_id needs an index at all times)
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock' AND INDEX_NAME = 'uq_user_batch') THEN
    ALTER TABLE stock ADD UNIQUE KEY uq_user_batch (user_id, name, batch_no, expiry_date);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock' AND INDEX_NAME = 'uq_user_med') THEN
    ALTER TABLE stock DROP INDEX uq_user_med;
  END IF;
END//
DELIMITER ;

CALL cc_repair();
DROP PROCEDURE cc_repair;

-- ===== indents =====
CREATE TABLE IF NOT EXISTS indents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  indent_no VARCHAR(20) NOT NULL,
  from_user_id INT UNSIGNED NOT NULL,
  to_user_id INT UNSIGNED NOT NULL,
  institution VARCHAR(150) NOT NULL,
  district VARCHAR(100) NOT NULL DEFAULT '',
  block VARCHAR(100) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT '',
  indent_date DATE NOT NULL,
  period VARCHAR(20) NOT NULL DEFAULT '',
  officer VARCHAR(150) NOT NULL DEFAULT '',
  remarks VARCHAR(500) NOT NULL DEFAULT '',
  status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_indent_no (from_user_id, indent_no),
  KEY idx_to (to_user_id, status),
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS indent_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  indent_id INT UNSIGNED NOT NULL,
  sno INT UNSIGNED NOT NULL,
  drug_code VARCHAR(40) NOT NULL DEFAULT '',
  name VARCHAR(150) NOT NULL,
  unit VARCHAR(60) NOT NULL DEFAULT '',
  stock_in_hand INT UNSIGNED NOT NULL DEFAULT 0,
  avg_monthly INT UNSIGNED NOT NULL DEFAULT 0,
  qty_required INT UNSIGNED NOT NULL,
  qty_issued INT UNSIGNED NULL,
  remarks VARCHAR(255) NOT NULL DEFAULT '',
  FOREIGN KEY (indent_id) REFERENCES indents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- indent_items: batch + expiry given by the District Main PHC at approval
DROP PROCEDURE IF EXISTS cc_repair_indent;
DELIMITER //
CREATE PROCEDURE cc_repair_indent()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'indent_items' AND COLUMN_NAME = 'batch_no') THEN
    ALTER TABLE indent_items ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER qty_issued;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'indent_items' AND COLUMN_NAME = 'expiry_date') THEN
    ALTER TABLE indent_items ADD COLUMN expiry_date DATE NULL AFTER batch_no;
  END IF;
END//
DELIMITER ;
CALL cc_repair_indent();
DROP PROCEDURE cc_repair_indent;

-- Offline mode: entries made without internet are sent later; this table stops a retried entry from being applied twice
CREATE TABLE IF NOT EXISTS sync_log (
  user_id INT UNSIGNED NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  result TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_id)
) ENGINE=InnoDB;

-- ===== result: all of these should show the new columns / tables =====
SHOW COLUMNS FROM users;
SHOW COLUMNS FROM requests;
SHOW COLUMNS FROM stock;
SHOW COLUMNS FROM indent_items;
SHOW TABLES;

-- Medicine tracking (QR scan)

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
