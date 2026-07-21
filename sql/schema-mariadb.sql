-- EG Launcher private CMS (MariaDB)
-- Database: client116_launcher
-- Auth tables are private — never expose via public HTTP/GitHub.

CREATE TABLE IF NOT EXISTS news_items (
  id VARCHAR(128) NOT NULL,
  feed_kind ENUM('launcher','partners') NOT NULL,
  title VARCHAR(512) NOT NULL,
  summary TEXT NULL,
  body MEDIUMTEXT NULL,
  published_at DATETIME(3) NOT NULL,
  tag VARCHAR(128) NOT NULL DEFAULT 'info',
  url VARCHAR(1024) NULL,
  sort_date DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id, feed_kind),
  KEY idx_news_kind_date (feed_kind, sort_date),
  KEY idx_news_tag (feed_kind, tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feed_meta (
  feed_kind ENUM('launcher','partners') NOT NULL PRIMARY KEY,
  title VARCHAR(256) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_config (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(256) NOT NULL,
  menu_label VARCHAR(256) NOT NULL,
  description TEXT NULL,
  game_version VARCHAR(64) NOT NULL,
  loader VARCHAR(32) NOT NULL DEFAULT 'fabric',
  server_address VARCHAR(256) NOT NULL,
  server_name VARCHAR(256) NOT NULL,
  instance_name VARCHAR(256) NOT NULL,
  news_tag VARCHAR(128) NOT NULL,
  news_username VARCHAR(128) NOT NULL,
  default_mods_json JSON NOT NULL,
  modrinth_pack_slug VARCHAR(256) NULL,
  icon_url VARCHAR(1024) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_auth (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  username VARCHAR(128) NOT NULL,
  -- bcrypt / argon2id (legacy SHA-256 hex upgraded on next login)
  password_hash VARCHAR(255) NOT NULL,
  news_tag VARCHAR(128) NOT NULL,
  display_name VARCHAR(256) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_partner_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS offline_settings (
  id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
  unlock_password_hash VARCHAR(255) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS offline_users (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  username VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  uuid CHAR(36) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_offline_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Brute-force protection (IP + action buckets)
CREATE TABLE IF NOT EXISTS cms_rate_limits (
  bucket_key CHAR(64) NOT NULL PRIMARY KEY,
  hits INT NOT NULL DEFAULT 0,
  window_start INT NOT NULL,
  KEY idx_rl_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO offline_settings (id, unlock_password_hash) VALUES (1, NULL);
INSERT IGNORE INTO feed_meta (feed_kind, title) VALUES
  ('launcher', 'EG Launcher News'),
  ('partners', 'EG Partner News');
