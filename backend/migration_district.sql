-- District-wise accounts. Run ONCE (safe to re-run). The API also does this automatically on first login,
-- so running this file is optional.
--   mysql -u root -p chemiconnect < backend/migration_district.sql
USE chemiconnect;

DROP PROCEDURE IF EXISTS cc_migrate_district;
DELIMITER //
CREATE PROCEDURE cc_migrate_district()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'district') THEN
    ALTER TABLE users ADD COLUMN district VARCHAR(100) NOT NULL DEFAULT '' AFTER pincode;
    UPDATE users SET district = city WHERE district = '';   -- old accounts: best guess = their city, fix by hand if wrong
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_role_district') THEN
    ALTER TABLE users ADD INDEX idx_role_district (role, district);
  END IF;
END//
DELIMITER ;
CALL cc_migrate_district();
DROP PROCEDURE cc_migrate_district;

SELECT id, role, name, city, district FROM users;
