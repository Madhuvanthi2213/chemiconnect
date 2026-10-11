-- Run this ONCE (safe to re-run) after migration.sql / migration_2.sql.
-- Adds BATCH NUMBER + EXPIRY DATE to the PHC pharma inventory (one stock row per batch)
-- and to indent items (filled by the District Main PHC when it approves an indent).
--   mysql -u root -p chemiconnect < backend/migration_3.sql
-- Existing stock rows are kept: they get an empty batch number and no expiry date (shown as "-" in the app).
USE chemiconnect;

DROP PROCEDURE IF EXISTS cc_migrate3;

DELIMITER //
CREATE PROCEDURE cc_migrate3()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock' AND COLUMN_NAME = 'batch_no') THEN
    ALTER TABLE stock ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock' AND COLUMN_NAME = 'expiry_date') THEN
    ALTER TABLE stock ADD COLUMN expiry_date DATE NULL AFTER batch_no;
  END IF;
  -- new per-batch unique key first, then drop the old (user_id, name) key (the foreign key needs an index on user_id at all times)
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock' AND INDEX_NAME = 'uq_user_batch') THEN
    ALTER TABLE stock ADD UNIQUE KEY uq_user_batch (user_id, name, batch_no, expiry_date);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock' AND INDEX_NAME = 'uq_user_med') THEN
    ALTER TABLE stock DROP INDEX uq_user_med;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'indent_items' AND COLUMN_NAME = 'batch_no') THEN
    ALTER TABLE indent_items ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER qty_issued;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'indent_items' AND COLUMN_NAME = 'expiry_date') THEN
    ALTER TABLE indent_items ADD COLUMN expiry_date DATE NULL AFTER batch_no;
  END IF;
END//
DELIMITER ;

CALL cc_migrate3();
DROP PROCEDURE cc_migrate3;

SHOW COLUMNS FROM stock;
SHOW COLUMNS FROM indent_items;
