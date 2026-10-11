-- Run this ONCE after migration.sql (adds the "Dispatched" step + the Indent tables).
--   mysql -u root -p chemiconnect < backend/migration_2.sql
USE chemiconnect;

ALTER TABLE requests
  MODIFY status ENUM('Pending','Approved','Dispatched','Received','Rejected') NOT NULL DEFAULT 'Pending';


-- Indents: pharmacy / PHC style requisition sent to a wholesaler (shown under the wholesaler's Orders)
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
  qty_issued INT UNSIGNED NULL,               -- filled by the wholesaler when approving
  remarks VARCHAR(255) NOT NULL DEFAULT '',
  FOREIGN KEY (indent_id) REFERENCES indents(id) ON DELETE CASCADE
) ENGINE=InnoDB;
