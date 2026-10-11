-- ChemiConnect database schema (MySQL 5.7+ / MariaDB 10.3+)
-- Import:  mysql -u root -p < backend/schema.sql     (or use phpMyAdmin -> Import)

CREATE DATABASE IF NOT EXISTS chemiconnect CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE chemiconnect;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role ENUM('pharmacy','wholesaler') NOT NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(30) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT '',   -- door no / street / landmark
  area VARCHAR(100) NOT NULL DEFAULT '',
  city VARCHAR(100) NOT NULL DEFAULT '',
  state VARCHAR(100) NOT NULL DEFAULT '',
  pincode CHAR(6) NOT NULL DEFAULT '',
  stock_seeded TINYINT(1) NOT NULL DEFAULT 0,  -- 1 once the starter dummy inventory was added
  stock_seed_v TINYINT UNSIGNED NOT NULL DEFAULT 0,  -- version of the starter medicine list already added (SEED_VER in api.php)
  district VARCHAR(100) NOT NULL DEFAULT '',   -- Tamil Nadu district; a PHC pharma's indents go only to the District Main PHC of its own district
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(11, 7) NULL,
  pw_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_role (email, role),
  INDEX idx_user_coords (latitude, longitude),
  INDEX idx_role_district (role, district)
) ENGINE=InnoDB;

-- Pharmacy inventory: ONE ROW PER BATCH (medicine name + batch number + expiry date)
CREATE TABLE IF NOT EXISTS stock (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  batch_no VARCHAR(50) NOT NULL DEFAULT '',
  expiry_date DATE NULL,                       -- NULL only for old rows created before batches existed
  qty INT UNSIGNED NOT NULL DEFAULT 0,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_user_batch (user_id, name, batch_no, expiry_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Pharmacy billing
CREATE TABLE IF NOT EXISTS bills (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  bill_no VARCHAR(20) NOT NULL,
  customer VARCHAR(150) NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bill_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  qty INT UNSIGNED NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Wholesaler catalogue
CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_user_prod (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Stock requests: pharmacy -> pharmacy  OR  pharmacy -> wholesaler
CREATE TABLE IF NOT EXISTS requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_user_id INT UNSIGNED NOT NULL,
  to_user_id INT UNSIGNED NOT NULL,
  product VARCHAR(150) NOT NULL,
  qty INT UNSIGNED NOT NULL,
  -- Pending -> Approved (supplier accepted) -> Dispatched (supplier handed the units over)
  --         -> Received (requester confirmed; stock moves NOW: requester +qty, supplier -qty)
  status ENUM('Pending','Approved','Dispatched','Received','Rejected') NOT NULL DEFAULT 'Pending',
  auto TINYINT(1) NOT NULL DEFAULT 0,          -- 1 = created automatically when stock hit the low level
  chain_id INT UNSIGNED NULL,                  -- first request of an auto chain (rejected -> next pharmacy)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_to (to_user_id, status),
  KEY idx_chain (chain_id),
  KEY idx_from (from_user_id),
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

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
  qty_issued INT UNSIGNED NULL,               -- filled by the District Main PHC when approving
  batch_no VARCHAR(50) NOT NULL DEFAULT '',   -- batch / expiry of the issued units (entered at approval,
  expiry_date DATE NULL,                      --   copied into the PHC pharma's inventory automatically)
  remarks VARCHAR(255) NOT NULL DEFAULT '',
  FOREIGN KEY (indent_id) REFERENCES indents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Contact form messages
CREATE TABLE IF NOT EXISTS messages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Offline mode: entries made without internet are sent later; this table stops a retried entry from being applied twice
CREATE TABLE IF NOT EXISTS sync_log (
  user_id INT UNSIGNED NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  result TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_id)
) ENGINE=InnoDB;

-- Medicine tracking: QR scan shows a batch's journey from manufacturing to expiry

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
