-- ChemiConnect Map Migration: Add latitude and longitude to users table
-- Run: mysql -u root -p chemiconnect < backend/migration_map.sql

USE chemiconnect;

-- Add latitude and longitude columns if they do not exist
SET @dbname = DATABASE();
SET @tablename = 'users';

-- Add latitude
SET @colname = 'latitude';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @colname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER pincode'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add longitude
SET @colname = 'longitude';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @colname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN longitude DECIMAL(11, 7) NULL AFTER latitude'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Index on coordinates for fast geospatial proximity queries
SET @indexname = 'idx_user_coords';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND INDEX_NAME = @indexname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE users ADD INDEX idx_user_coords (latitude, longitude)'
));
PREPARE alterIndexIfNotExists FROM @preparedStatement;
EXECUTE alterIndexIfNotExists;
DEALLOCATE PREPARE alterIndexIfNotExists;
