-- Run this ONCE if you already imported the old schema.sql (keeps your existing data).
--   mysql -u root -p chemiconnect < backend/migration.sql
USE chemiconnect;

ALTER TABLE users
  ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT '' AFTER phone,
  ADD COLUMN area    VARCHAR(100) NOT NULL DEFAULT '' AFTER address,
  ADD COLUMN state   VARCHAR(100) NOT NULL DEFAULT '' AFTER city,
  ADD COLUMN pincode CHAR(6)      NOT NULL DEFAULT '' AFTER state;

-- Old flow credited stock at "Approved" time, so those requests are already complete.
ALTER TABLE requests
  MODIFY status ENUM('Pending','Approved','Received','Rejected') NOT NULL DEFAULT 'Pending',
  ADD COLUMN auto TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN chain_id INT UNSIGNED NULL AFTER auto,
  ADD KEY idx_chain (chain_id);

UPDATE requests SET status = 'Received' WHERE status = 'Approved';
